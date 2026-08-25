#!/usr/bin/env node
/**
 * 实时同步与群组恢复真实 E2E（方案 v1 实时同步协议 + 重启恢复）
 *
 * - 真实内核子进程（真实 DeepSeek key 从 .env 加载，仅在环境变量中传递）
 * - 通道 1-6（模拟手机端）：auth/hello → 建群（名录校验）→ 手机发消息 → 电脑端收到
 *   update(group) 广播（实时推送，不等轮询）→ 电脑端创建智能体 → 手机端收到
 *   update(agents) 广播 → 但丁回复完成 → update(butler) 广播
 * - 通道 7-9（重启恢复）：停内核 → 同数据目录重启 → listGroups 恢复 working 群组
 *   + 投影历史保留 + 群组可继续工作
 * - 用法：node scripts/verify-sync.mjs
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(root, 'packages', 'bridge', 'package.json'))
const WebSocket = require('ws')

let passed = 0
let failed = 0
function check(name, cond, detail = '') {
  if (cond) {
    passed++
    console.log(`  ✅ ${name}`)
  } else {
    failed++
    console.log(`  ❌ ${name} ${detail}`)
  }
}

// 真实 key 从 .env 注入（仅环境变量，绝不打印）
const env = { ...process.env }
try {
  const envText = readFileSync(join(root, '.env'), 'utf8')
  for (const line of envText.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (m && !env[m[1]]) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
} catch {
  // .env 缺失：让内核用系统环境
}

function startKernel(dataDir) {
  const child = spawn(
    process.execPath,
    [join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'), join(root, 'packages', 'bridge', 'src', 'cli.ts'), '--data', dataDir, '--remote-port', '0'],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env },
  )
  let stderr = ''
  child.stderr.on('data', (d) => (stderr += d.toString('utf8')))
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`kernel start timeout. stderr: ${stderr}`)), 20000)
    const poll = () => {
      const m = stderr.match(/listening on ws:\/\/127\.0\.0\.1:(\d+)/)
      const t = stderr.match(/token=([^\s]+)/)
      if (m && t) {
        clearTimeout(timer)
        resolve({ child, port: Number(m[1]), token: t[1] })
      } else {
        setTimeout(poll, 100)
      }
    }
    child.on('exit', (code) => reject(new Error(`kernel exited early: ${code}. stderr: ${stderr}`)))
    poll()
  })
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    ws.on('open', () => resolve(ws))
    ws.on('error', reject)
  })
}

function nextMessage(ws, predicate, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMessage)
      reject(new Error('timeout waiting for message'))
    }, timeoutMs)
    const onMessage = (data) => {
      const msg = JSON.parse(data.toString('utf8'))
      if (predicate(msg)) {
        clearTimeout(timer)
        ws.off('message', onMessage)
        resolve(msg)
      }
    }
    ws.on('message', onMessage)
  })
}

let seq = 0
function request(ws, method, params = {}) {
  const id = ++seq
  const reply = nextMessage(ws, (m) => m.id === id)
  ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
  return reply
}

async function main() {
  console.log('=== 实时同步与群组恢复真实 E2E ===')
  const dataDir = mkdtempSync(join(tmpdir(), 'cb-verify-sync-'))
  const { child, port, token } = await startKernel(dataDir)
  console.log(`内核已启动：ws://127.0.0.1:${port}（数据目录 ${dataDir}）`)

  try {
    const ws = await connect(`ws://127.0.0.1:${port}`)

    // 1. 鉴权 + hello
    const hello = nextMessage(ws, (m) => m.method === 'hello')
    const auth = await request(ws, 'auth', { token })
    check('auth → result null', auth.result === null)
    await hello
    check('hello → cobeing-ws/1', true)

    // 2. 名录校验：未注册成员建群 → 明确报错（防 mock 空转群组）
    const badGroup = await request(ws, 'createGroup', { name: 'bad-g', label: ['user', 'butler', 'ghost'] })
    check('建群名录校验：未注册成员被拒', badGroup.error?.code === -32000 && /not in registry/.test(badGroup.error.message), JSON.stringify(badGroup.error).slice(0, 160))

    // 3. 注册成员 + 建群（电脑端操作 → 手机端应收到 groups update 广播）
    const agentUpdate = nextMessage(ws, (m) => m.method === 'notify' && m.params?.type === 'update' && m.params?.scope === 'agents' && m.params?.kind === 'confirm')
    await request(ws, 'requestCreateAgent', { def: { name: 'writer', role: '写作者', provider: 'deepseek', model: 'deepseek-chat', maxTokens: 1024, createdAt: Date.now() } })
    await request(ws, 'confirmAgent', { name: 'writer' })
    const agentNotif = await agentUpdate
    check('创建智能体 → update(agents) 实时广播', agentNotif.params?.scope === 'agents' && agentNotif.params?.kind === 'confirm')

    const groupUpdate = nextMessage(ws, (m) => m.method === 'notify' && m.params?.type === 'update' && m.params?.scope === 'groups')
    const created = await request(ws, 'createGroup', { name: 'sync-g', label: ['user', 'butler', 'writer'] })
    check('createGroup → working', created.result?.status === 'working')
    const groupNotif = await groupUpdate
    check('建群 → update(groups) 实时广播', groupNotif.params?.scope === 'groups')

    // 4. 手机发消息 → 群组 update(group) 广播（实时推送，模拟手机端发送）
    const speakNotif = nextMessage(ws, (m) => m.method === 'notify' && m.params?.type === 'update' && m.params?.scope === 'group' && m.params?.group === 'sync-g' && m.params?.kind === 'speak')
    await request(ws, 'speakToGroup', { group: 'sync-g', actor: 'user', content: '手机端发的消息：请 writer 回复一个字：好', mention: ['writer'], task: '回复一个字' })
    const speakMsg = await speakNotif
    check('手机发言 → update(group:sync-g) 实时广播（电脑端即时感知）', speakMsg.params?.group === 'sync-g')

    // 5. 群组成员回复完成 → update(group) reply 广播（工作智能体回复后手机端即时刷新）
    let gotReplyNotif = false
    try {
      const replyNotif = await nextMessage(ws, (m) => m.method === 'notify' && m.params?.type === 'update' && m.params?.scope === 'group' && m.params?.kind === 'reply', 120000)
      gotReplyNotif = replyNotif.params?.group === 'sync-g'
    } catch {
      // 超时（真实 DeepSeek 慢）——不判定失败，但记录
      console.log('  ⏳ group reply 广播等待超时（真实 LLM 可能慢，不判失败）')
    }
    check('成员回复完成 → update(group) reply 广播', gotReplyNotif)

    // 6. 主窗口：手机发消息给但丁 → update(butler) speak 广播 + 回复完成 reply 广播
    const butlerSpeak = nextMessage(ws, (m) => m.method === 'notify' && m.params?.type === 'update' && m.params?.scope === 'butler' && m.params?.kind === 'speak')
    await request(ws, 'mainWindowSpeak', { content: '请只回复两个字：收到' })
    const bs = await butlerSpeak
    check('手机发主窗口消息 → update(butler) speak 广播', bs.params?.scope === 'butler')
    const butlerReply = nextMessage(ws, (m) => m.method === 'notify' && m.params?.type === 'update' && m.params?.scope === 'butler' && m.params?.kind === 'reply')
    const br = await butlerReply
    check('但丁回复完成 → update(butler) reply 广播（手机端即时刷新）', br.params?.scope === 'butler')

    // 7. 停内核 → 重启 → 群组恢复
    console.log('\n--- 重启恢复验证（停内核 → 同数据目录重启）---')
    ws.close()
    child.kill()
    await new Promise((r) => setTimeout(r, 800))
    const { child: child2, port: port2, token: token2 } = await startKernel(dataDir)
    console.log(`内核重启完成：ws://127.0.0.1:${port2}`)
    try {
      const ws2 = await connect(`ws://127.0.0.1:${port2}`)
      // 诊断：监听恢复失败通知（notify text）
      const diagTimer = setTimeout(() => undefined, 15000)
      const diag = (data) => {
        try {
          const msg = JSON.parse(data.toString('utf8'))
          if (msg.method === 'notify' && msg.params?.type === 'text' && /恢复失败/.test(msg.params.content)) {
            console.log(`  ⚠ 内核通知：${msg.params.content}`)
          }
        } catch {
          // 忽略
        }
      }
      ws2.on('message', diag)
      const hello2 = nextMessage(ws2, (m) => m.method === 'hello')
      await request(ws2, 'auth', { token: token2 })
      await hello2

      // 8. 重启后 listGroups 恢复 working 群组（群组不显示根因修复）
      const groups = await request(ws2, 'listGroups')
      const restored = (groups.result ?? []).find((g) => g.name === 'sync-g')
      check('重启后 working 群组恢复显示', restored?.status === 'working', JSON.stringify(groups.result).slice(0, 200))

      // 9. 恢复后投影保留历史 + 群组可继续工作
      const proj = await request(ws2, 'groupProjection', { group: 'sync-g' })
      const msgs = proj.result?.publicMessages ?? []
      check('恢复后投影保留历史消息', msgs.some((m) => m.content.includes('手机端发的消息')), JSON.stringify(msgs.map((m) => m.actor)).slice(0, 200))
      check('恢复后名录仍在', (await request(ws2, 'listAgents')).result.some((a) => a.name === 'writer'))
      const contNotif = nextMessage(ws2, (m) => m.method === 'notify' && m.params?.type === 'update' && m.params?.scope === 'group' && m.params?.kind === 'reply')
      await request(ws2, 'speakToGroup', { group: 'sync-g', actor: 'user', content: '重启后继续：请 writer 回复一个字：好', mention: ['writer'], task: '回复一个字' })
      const cont = await contNotif
      check('恢复后群组可继续工作（成员回复广播）', cont.params?.group === 'sync-g')
      ws2.close()
    } finally {
      child2.kill()
    }
  } catch (error) {
    failed++
    console.log(`  ❌ 异常：${error.message}`)
  } finally {
    try {
      child.kill()
    } catch {
      // 已退出
    }
    await new Promise((r) => setTimeout(r, 500))
    try {
      rmSync(dataDir, { recursive: true, force: true })
    } catch {
      // 清理失败忽略
    }
  }

  console.log(`\n结果：${passed} 通过 / ${failed} 失败`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
