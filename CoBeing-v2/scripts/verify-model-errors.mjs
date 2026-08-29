#!/usr/bin/env node
/**
 * 模型错误系统真实 E2E（2.0.7：取消 mock 静默回退 → 全链路报错）
 *
 * 真实内核子进程 + 真实配置：
 *   A. 无 key 数据目录 → 启动 stderr 明确提示 + notify 报错 + 但丁发言 [工作失败] LLM_CONFIG_MISSING
 *   B. 坏 key → 但丁发言 LLM_API_401（真实 API 调用 401）
 *   C. 好 key（真实配置）→ 但丁真实回复（非 mock）
 *   D. 工作智能体无 provider → 默认继承 deepseek → 群组真实调用（非 mock 硬回复）
 *
 * 用法：node scripts/verify-model-errors.mjs
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

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

/** 起内核：返回 stdio RPC 客户端 + stderr 收集 */
function startKernel(dataRoot, extraArgs = []) {
  const child = spawn(
    process.execPath,
    [join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'), join(root, 'packages', 'bridge', 'src', 'cli.ts'), '--data', dataRoot, ...extraArgs],
    { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] },
  )
  let stderr = ''
  child.stderr.on('data', (d) => (stderr += d.toString('utf8')))
  const notifyLog = []
  const rl = createInterface({ input: child.stdout })
  let seq = 0
  const pending = new Map()
  rl.on('line', (line) => {
    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      return
    }
    if (msg.id !== undefined) {
      const p = pending.get(msg.id)
      if (p) {
        pending.delete(msg.id)
        p(msg)
      }
    }
    if (msg.method === 'notify') notifyLog.push(msg.params)
  })
  const req = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++seq
      pending.set(id, resolve)
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    })
  const ready = new Promise((resolve) => {
    const timer = setTimeout(() => resolve('timeout'), 15000)
    const poll = () => {
      if (stderr.includes('server.start') || stderr.includes('[model]') || stderr.includes('[remote]') || /listening|notify|mock|model/.test(stderr)) {
        // 等内核真正就绪：ping 通
        void req('ping').then(() => {
          clearTimeout(timer)
          resolve('ready')
        })
      } else {
        setTimeout(poll, 100)
      }
    }
    child.on('exit', (code) => {
      clearTimeout(timer)
      resolve(`exited:${code}`)
    })
    poll()
  })
  return { child, req, stderr: () => stderr, notifyLog, ready }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 发消息并等待但丁/成员回复（投影轮询） */
async function speakAndWait(kernel, method, params, actor = 'butler', timeoutMs = 60000) {
  const before = (await kernel.req('butlerProjection')).result?.publicMessages?.length ?? 0
  await kernel.req(method, params)
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await sleep(1500)
    const proj = (await kernel.req('butlerProjection')).result
    const msgs = proj?.publicMessages ?? []
    const last = msgs[msgs.length - 1]
    if (msgs.length > before && last && last.actor === actor) return last
    // 等 [工作失败] 发言（actor 可能是智能体名）
    if (msgs.length > before && last && /工作失败|模型/.test(last.content)) return last
  }
  return null
}

async function main() {
  console.log('CoBeing 模型错误系统真实 E2E（2.0.7）')
  console.log('='.repeat(60))
  const dirs = []
  const realConfigDir = join(homedir(), 'AppData', 'Roaming', 'com.cobeing.v2')

  // ---------- 场景 A：无 key ----------
  console.log('\n[A] 无 API Key：启动提示 + 但丁报错（不再 mock）')
  {
    const dir = mkdtempSync(join(tmpdir(), 'cb-model-nokey-'))
    dirs.push(dir)
    const kernel = startKernel(dir)
    await kernel.ready
    await sleep(500)
    check('A1 启动 stderr 含未配置提示', /未配置 API Key|未找到有效的模型配置/.test(kernel.stderr()), kernel.stderr().slice(0, 200))
    check('A2 启动 notify 报错广播', kernel.notifyLog.some((n) => n.type === 'text' && /模型/.test(n.content)), JSON.stringify(kernel.notifyLog[0]))
    const reply = await speakAndWait(kernel, 'mainWindowSpeak', { content: '你好' })
    check('A3 但丁回复为明确错误（非 mock 硬回复）', reply !== null && /LLM_CONFIG_MISSING|未配置模型服务/.test(reply.content), reply?.content?.slice(0, 160))
    check('A4 回复不是 "(mock) 收到"', reply?.content ? !reply.content.includes('(mock) 收到') : true)
    kernel.child.kill()
    await sleep(300)
  }

  // ---------- 场景 B：坏 key ----------
  console.log('\n[B] 坏 API Key：但丁报 LLM_API_401（真实 API 调用）')
  {
    const dir = mkdtempSync(join(tmpdir(), 'cb-model-badkey-'))
    dirs.push(dir)
    writeFileSync(join(dir, 'model-config.json'), JSON.stringify({
      sources: [{ id: 's1', name: 'bad', api_key: 'sk-invalid-key-000', base_url: '', model: 'deepseek-v4-flash' }],
      active_source: 's1',
    }))
    const kernel = startKernel(dir)
    await kernel.ready
    check('B1 启动 stderr 显示 provider=deepseek', /provider=deepseek/.test(kernel.stderr()), kernel.stderr().slice(0, 200))
    const reply = await speakAndWait(kernel, 'mainWindowSpeak', { content: '你好' })
    check('B2 但丁回复 LLM_API_401 中文错误', reply !== null && /LLM_API_401|API Key 无效/.test(reply.content), reply?.content?.slice(0, 200))
    kernel.child.kill()
    await sleep(300)
  }

  // ---------- 场景 C：好 key（用户真实配置；极小调用费用） ----------
  console.log('\n[C] 真实 API Key：但丁真实回复')
  {
    const dir = mkdtempSync(join(tmpdir(), 'cb-model-goodkey-'))
    dirs.push(dir)
    // 复用用户安装版真实配置（key/base_url/model）
    const cfgPath = join(realConfigDir, 'model-config.json')
    if (existsSync(cfgPath)) {
      const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'))
      const active = cfg.sources?.find((s) => s.id === cfg.active_source)
      if (active?.api_key) {
        writeFileSync(join(dir, 'model-config.json'), JSON.stringify({
          sources: [{ id: 's1', name: 'real', api_key: active.api_key, base_url: active.base_url ?? '', model: active.model ?? 'deepseek-v4-flash' }],
          active_source: 's1',
        }))
        const kernel = startKernel(dir)
        await kernel.ready
        const reply = await speakAndWait(kernel, 'mainWindowSpeak', { content: '请只回复四个字：真实调用' })
        check('C1 但丁真实回复（非 mock/非错误）', reply !== null && !/工作失败|LLM_|\(mock\)/.test(reply.content), reply?.content?.slice(0, 160))
        kernel.child.kill()
        await sleep(300)
      } else {
        check('C1 跳过：无真实 key 配置', true, '（未找到有效 key，跳过）')
      }
    } else {
      check('C1 跳过：无安装版配置', true)
    }
  }

  // ---------- 场景 D：工作智能体默认继承 deepseek（无 provider 不落 mock） ----------
  console.log('\n[D] 工作智能体无 provider → 默认继承真实模型（群组内非 mock）')
  {
    const dir = mkdtempSync(join(tmpdir(), 'cb-model-worker-'))
    dirs.push(dir)
    const cfgPath = join(realConfigDir, 'model-config.json')
    if (existsSync(cfgPath)) {
      const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'))
      const active = cfg.sources?.find((s) => s.id === cfg.active_source)
      if (active?.api_key) {
        writeFileSync(join(dir, 'model-config.json'), JSON.stringify({
          sources: [{ id: 's1', name: 'real', api_key: active.api_key, base_url: active.base_url ?? '', model: active.model ?? 'deepseek-v4-flash' }],
          active_source: 's1',
        }))
        const kernel = startKernel(dir)
        await kernel.ready
        // 创建无 provider 的智能体（名录默认继承内核默认）
        await kernel.req('requestCreateAgent', { def: { name: 'worker1', role: '测试工作智能体', createdAt: Date.now() } })
        await kernel.req('confirmAgent', { name: 'worker1' })
        const group = await kernel.req('createGroup', { name: 'g1', label: ['user', 'butler', 'worker1'] })
        check('D1 群组创建成功', group.result?.status === 'working', JSON.stringify(group.result))
        await kernel.req('speakToGroup', { group: 'g1', actor: 'user', content: '请回复两个字：收到' })
        // 轮询群组投影等 worker1 回复
        let workerReply = null
        const deadline = Date.now() + 90000
        while (Date.now() < deadline) {
          await sleep(2000)
          const proj = (await kernel.req('groupProjection', { group: 'g1' })).result
          const last = proj?.publicMessages?.at(-1)
          if (last && last.actor === 'worker1') {
            workerReply = last
            break
          }
        }
        check('D2 worker1 真实回复（非 mock 硬回复）', workerReply !== null && !/\(mock\) 收到/.test(workerReply.content), workerReply?.content?.slice(0, 160))
        check('D3 worker1 回复非错误', workerReply !== null && !/工作失败|LLM_/.test(workerReply.content), workerReply?.content?.slice(0, 160))
        kernel.child.kill()
        await sleep(300)
      } else {
        check('D 跳过：无真实 key', true)
      }
    } else {
      check('D 跳过：无安装版配置', true)
    }
  }

  // ---------- 清理 ----------
  for (const dir of dirs) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // 忽略
    }
  }
  console.log('='.repeat(60))
  console.log(`结果：${passed} 通过 / ${failed} 失败`)
  process.exit(failed > 0 ? 1 : 0)
}

await main()
