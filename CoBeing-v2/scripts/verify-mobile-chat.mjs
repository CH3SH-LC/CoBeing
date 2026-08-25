#!/usr/bin/env node
/**
 * 手机端对话链路真实 E2E（模拟手机 App 的完整请求序列）
 *
 * - 真实内核子进程（真实 DeepSeek key 从 .env 加载，仅在环境变量中传递）
 * - 模拟手机端：auth → hello → butler/conversationProjection → mainWindowSpeak
 *   → 轮询投影直到但丁真实回复 → 会话列表 → 新对话 → 历史投影
 * - 用法：node scripts/verify-mobile-chat.mjs
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(root, 'packages', 'bridge', 'package.json'))
const WebSocket = require('ws')
const dataDir = mkdtempSync(join(tmpdir(), 'cb-verify-mobile-chat-'))

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
if (!env.DEEPSEEK_API_KEY) {
  console.log('⚠ 未找到 DEEPSEEK_API_KEY（.env 或系统环境），但丁将无法真实回复')
}

function startKernel() {
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

/** 模拟手机端轮询：等待指定 actor 的回复出现（最多 waitMs） */
async function pollForReply(ws, predicate, waitMs = 90000) {
  const start = Date.now()
  while (Date.now() - start < waitMs) {
    const proj = await request(ws, 'butler/conversationProjection', { id: 'current' })
    const msgs = proj.result?.publicMessages ?? []
    const hit = msgs.find((m) => predicate(m))
    if (hit) return hit
    await new Promise((r) => setTimeout(r, 2000))
  }
  return null
}

async function main() {
  console.log('=== 手机端对话链路真实 E2E（真实 DeepSeek） ===')
  const { child, port, token } = await startKernel()
  console.log(`内核已启动：ws://127.0.0.1:${port}（临时数据目录）`)

  try {
    const ws = await connect(`ws://127.0.0.1:${port}`)

    // 1. 鉴权 + hello（模拟手机端 App 启动）
    const hello = nextMessage(ws, (m) => m.method === 'hello')
    const auth = await request(ws, 'auth', { token })
    check('auth → result null', auth.result === null)
    const helloMsg = await hello
    check('hello → cobeing-ws/1', helloMsg.params?.protocol === 'cobeing-ws/1')

    // 2. 初始投影（对话页打开时）——手机端 ChatView 用 butler/conversationProjection
    const proj0 = await request(ws, 'butler/conversationProjection', { id: 'current' })
    check(
      'butler/conversationProjection(current) 可读',
      proj0.result && Array.isArray(proj0.result.publicMessages),
      JSON.stringify(proj0).slice(0, 200),
    )

    // 3. 发送消息（对话页发送按钮）——mainWindowSpeak 应立即返回
    const t0 = Date.now()
    const speak = await request(ws, 'mainWindowSpeak', { content: '请只回复两个字：收到' })
    const latency = Date.now() - t0
    check('mainWindowSpeak 快速返回（<5s，非等待回合）', latency < 5000, `latency=${latency}ms error=${JSON.stringify(speak.error)}`)

    // 4. 轮询投影等待但丁真实回复（真实 DeepSeek，最多 90s）
    const reply = await pollForReply(ws, (m) => m.actor === 'butler')
    check('但丁真实回复出现在投影', reply !== null, reply ? `content=${JSON.stringify(reply.content).slice(0, 120)}` : '90s 无回复')

    // 5. 会话列表（手机端会话管理）
    const convs = await request(ws, 'butler/listConversations')
    check('butler/listConversations 返回数组', Array.isArray(convs.result), JSON.stringify(convs).slice(0, 200))

    ws.close()
  } catch (error) {
    failed++
    console.log(`  ❌ 异常：${error.message}`)
  } finally {
    child.kill()
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
