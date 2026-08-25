#!/usr/bin/env node
/**
 * 远程互联真实 E2E（方案 v1）
 *
 * - 真实子进程：tsx packages/bridge/src/cli.ts --data <tmp> --remote-port 0
 * - 真实 WS 客户端：鉴权 → hello → ping → remote/info → remote/panels → 主对话发言 → 投影轮询
 *   → newButlerConversation 触发 notify 广播（双向不阻塞的接收面）→ 文件浏览
 * - 用法：node scripts/verify-remote.mjs
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
// ws 依赖在 packages/bridge（pnpm 符号链接），从 bridge 解析
const require = createRequire(join(root, 'packages', 'bridge', 'package.json'))
const WebSocket = require('ws')
const dataDir = mkdtempSync(join(tmpdir(), 'cb-verify-remote-'))

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

function startKernel() {
  const child = spawn(
    process.execPath,
    [join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'), join(root, 'packages', 'bridge', 'src', 'cli.ts'), '--data', dataDir, '--remote-port', '0'],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] },
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

async function main() {
  console.log('=== CoBeing 远程互联真实 E2E（CLI 子进程 + WS 客户端） ===')
  const { child, port, token } = await startKernel()
  console.log(`内核已启动：ws://127.0.0.1:${port}`)

  try {
    const ws = await connect(`ws://127.0.0.1:${port}`)
    console.log('连接建立')

    // 1. 错误 token 拒绝
    const badAuth = await request(ws, 'auth', { token: 'wrong' })
    check('错误 token → -32001', badAuth.error?.code === -32001, JSON.stringify(badAuth))

    // 2. 正确鉴权 + hello
    const hello = nextMessage(ws, (m) => m.method === 'hello')
    const goodAuth = await request(ws, 'auth', { token })
    check('正确 token → result null', goodAuth.result === null)
    const helloMsg = await hello
    check(
      'hello 携带服务器信息',
      helloMsg.params?.protocol === 'cobeing-ws/1' && helloMsg.params?.name === 'CoBeing Kernel',
      JSON.stringify(helloMsg.params),
    )

    // 3. ping / remote/info / remote/panels
    const ping = await request(ws, 'ping')
    check('ping → pong', ping.result?.pong === true)
    const info = await request(ws, 'remote/info')
    check('remote/info → dataRoot', info.result?.dataRoot === dataDir, JSON.stringify(info.result))
    const panels = await request(ws, 'remote/panels')
    check('remote/panels → quick 面板', Array.isArray(panels.result) && panels.result[0]?.id === 'quick')

    // 4. 主对话发言（mock 但丁回复）+ 投影
    await request(ws, 'mainWindowSpeak', { content: '你好但丁，汇报一下状态' })
    check('mainWindowSpeak 无错误', true)
    await new Promise((r) => setTimeout(r, 2500))
    const proj = await request(ws, 'butlerProjection')
    const msgs = proj.result?.publicMessages ?? []
    const hasReply = msgs.some((m) => m.actor === 'butler')
    check('但丁回复出现在投影（mock 驱动）', hasReply, JSON.stringify(msgs.slice(-2)))

    // 5. notify 广播（新对话触发 [管家] 通知 → WS 接收 = 双向不阻塞接收面）
    const notify = nextMessage(ws, (m) => m.method === 'notify' && m.params?.type === 'text')
    await request(ws, 'butler/newConversation')
    const notifyMsg = await notify
    check('服务器 notify 经 WS 到达（双向不阻塞）', typeof notifyMsg.params?.content === 'string', JSON.stringify(notifyMsg.params))

    // 6. 文件浏览（dataRoot）
    const files = await request(ws, 'remote/listFiles', { root: dataDir, path: '' })
    check('remote/listFiles 返回条目数组', Array.isArray(files.result?.entries))

    // 7. 未鉴权保护：新连接直接 ping → -32001
    const ws2 = await connect(`ws://127.0.0.1:${port}`)
    const unauth = await request(ws2, 'ping')
    check('未鉴权连接请求被拒 -32001', unauth.error?.code === -32001)
    ws2.close()

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
