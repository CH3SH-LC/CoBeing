#!/usr/bin/env node
/**
 * 模型配置（model-config.json 多来源）真实 E2E 验证：
 *
 *  1. 无配置文件 + 无环境 key → 内核 mock 模式（但丁真实回复）
 *  2. 多来源文件，active=坏 key 来源 → 走 DeepSeek provider → 投影出现
 *     `[工作失败] DeepSeek API error 401`（证明 active 来源生效且优先于环境变量）
 *  3. active 切到空 key 来源 → 回退无 key → mock 模式
 *  4. 删除配置文件 → 回退 mock 模式
 *
 * 判定通道：mainWindowSpeak 异步返回，LLM 结果/错误经事件日志落投影
 * （回复 = butler 发言；错误 = `[工作失败] <错误>`），轮询投影观察。
 *
 * 用法：node scripts/verify-model-config.mjs
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

// 显式移除系统/项目环境中的 DEEPSEEK_API_KEY（隔离：本脚本只测文件配置语义）
const env = { ...process.env }
delete env.DEEPSEEK_API_KEY
delete env.DEEPSEEK_API_BASE_URL

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

function nextMessage(ws, predicate, timeoutMs = 15000) {
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

/** 鉴权 + 等待 hello 推送 */
async function authAndHello(ws, token) {
  const hello = nextMessage(ws, (m) => m.method === 'hello')
  await request(ws, 'auth', { token })
  await hello
}

/** 轮询主窗口投影直到出现匹配消息（reply 或 [工作失败]） */
async function pollProjection(ws, predicate, waitMs = 90000) {
  const start = Date.now()
  while (Date.now() - start < waitMs) {
    const proj = await request(ws, 'butler/conversationProjection', { id: 'current' })
    const msgs = proj.result?.publicMessages ?? []
    const hit = msgs.find((m) => predicate(m))
    if (hit) return hit
    await new Promise((r) => setTimeout(r, 1500))
  }
  return null
}

async function main() {
  const dataDir = mkdtempSync(join(tmpdir(), 'cb-verify-model-config-'))
  console.log('=== 场景 1：无配置文件 + 无环境 key → mock 模式 ===')
  let ctx = await startKernel(dataDir)
  let ws = await connect(`ws://127.0.0.1:${ctx.port}`)
  await authAndHello(ws, ctx.token)
  await request(ws, 'mainWindowSpeak', { content: '请只回复两个字：收到' })
  const mockReply = await pollProjection(ws, (m) => m.actor === 'butler' || /\[工作失败\]/.test(m.content ?? ''), 60000)
  check('mock 模式但丁真实回复（非失败）', mockReply !== null && mockReply.actor === 'butler', mockReply ? `content=${JSON.stringify(mockReply.content).slice(0, 100)}` : '60s 无消息')
  ws.close()
  await ctx.child.kill()

  console.log('=== 场景 2：多来源 model-config.json（active=坏 key 来源）→ DeepSeek provider 生效 ===')
  writeFileSync(
    join(dataDir, 'model-config.json'),
    JSON.stringify({
      sources: [
        { id: 'good', name: '好 Key 来源', api_key: 'sk-should-not-be-used', base_url: '', model: 'deepseek-v4-flash' },
        { id: 'bad', name: '坏 Key 来源', api_key: 'sk-invalid-for-test', base_url: 'https://api.deepseek.com', model: 'deepseek-v4-flash' },
      ],
      active_source: 'bad',
    }),
    'utf8',
  )
  ctx = await startKernel(dataDir)
  ws = await connect(`ws://127.0.0.1:${ctx.port}`)
  await authAndHello(ws, ctx.token)
  await request(ws, 'mainWindowSpeak', { content: '请只回复两个字：收到' })
  let failedMsg = await pollProjection(ws, (m) => /\[工作失败\]/.test(m.content ?? ''), 60000)
  check('active=坏 key 来源 → 触发 DeepSeek 401（active 来源生效）', failedMsg !== null && /DeepSeek API error/.test(failedMsg.content), failedMsg ? `content=${JSON.stringify(failedMsg.content).slice(0, 160)}` : '60s 无失败消息')
  check('错误含 401', failedMsg !== null && /401/.test(failedMsg.content), failedMsg?.content ?? '(无失败消息)')
  ws.close()
  await ctx.child.kill()

  console.log('=== 场景 3：active 切到无 key 来源 → 回退环境变量（无 env）→ mock 模式 ===')
  writeFileSync(
    join(dataDir, 'model-config.json'),
    JSON.stringify({
      sources: [
        { id: 'good', name: '好 Key 来源', api_key: 'sk-should-not-be-used', base_url: '', model: 'deepseek-v4-flash' },
        { id: 'empty', name: '空 Key 来源', api_key: '', base_url: '', model: 'deepseek-v4-flash' },
      ],
      active_source: 'empty',
    }),
    'utf8',
  )
  ctx = await startKernel(dataDir)
  ws = await connect(`ws://127.0.0.1:${ctx.port}`)
  await authAndHello(ws, ctx.token)
  await request(ws, 'mainWindowSpeak', { content: '请只回复两个字：收到' })
  const mockReply2 = await pollProjection(ws, (m) => m.actor === 'butler' || /\[工作失败\]/.test(m.content ?? ''), 60000)
  check('active=空 Key 来源 → 回退 mock 模式（但丁真实回复）', mockReply2 !== null && mockReply2.actor === 'butler', mockReply2 ? `content=${JSON.stringify(mockReply2.content).slice(0, 100)}` : '60s 无消息')
  ws.close()
  await ctx.child.kill()

  console.log('=== 场景 4：无配置文件 → 回退无 key → mock 模式 ===')
  rmSync(join(dataDir, 'model-config.json'), { force: true })
  ctx = await startKernel(dataDir)
  ws = await connect(`ws://127.0.0.1:${ctx.port}`)
  await authAndHello(ws, ctx.token)
  await request(ws, 'mainWindowSpeak', { content: '请只回复两个字：收到' })
  const mockReply3 = await pollProjection(ws, (m) => m.actor === 'butler' || /\[工作失败\]/.test(m.content ?? ''), 60000)
  check('无配置回退 mock 模式（但丁真实回复）', mockReply3 !== null && mockReply3.actor === 'butler', mockReply3 ? `content=${JSON.stringify(mockReply3.content).slice(0, 100)}` : '60s 无消息')
  ws.close()
  await ctx.child.kill()

  // 清理竞态：内核子进程可能仍在释放句柄，等待后重试
  await new Promise((r) => setTimeout(r, 500))
  try {
    rmSync(dataDir, { recursive: true, force: true })
  } catch {
    // 忽略
  }
  console.log(`\n===== 结果: ${passed}/${passed + failed} 通过 =====`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('脚本失败:', err.message)
  process.exit(1)
})
