#!/usr/bin/env node
/**
 * 真实 E2E：群组默认唤醒 + 结构性防偷懒链修复验证（修复 1/2/3/4，真实 DeepSeek）
 *
 * 用户旅程（模拟手机端交互面，WS 全链路）：
 *   1. 连接内核（auth/hello）→ 创建写作者智能体 → 批准
 *   2. 建群 wake-team（user + butler + waker）
 *   3. 用户发言**不带 mention**（修复 1：mention 空 → 默认 @all 唤醒工作智能体）
 *   4. 等待 waker 被唤醒并真实工作（工具调用 + 产物 hello.txt 落盘）
 *   5. 等待 waker 完成汇报（诚实审查：有成功工具记录才放行）
 *   6. 异常扫描：无 [工作失败]/[mention 失败]/request-error
 * 断言：不带 mention 的任务也会被真实执行（"没人叫就不干活"的偷懒通道被结构性关闭）
 * 用法：node scripts/verify-group-wake.mjs
 * key：同目录 .env 的 DEEPSEEK_API_KEY（系统环境变量优先）
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(root, 'packages', 'bridge', 'package.json'))
const WebSocket = require('ws')

const dataDir = mkdtempSync(join(tmpdir(), 'cb-wake-'))

// .env 注入（系统环境变量优先）
const env = { ...process.env }
try {
  const envText = readFileSync(join(root, '.env'), 'utf8')
  for (const line of envText.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (m && !env[m[1]]) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
} catch {}
if (!env.DEEPSEEK_API_KEY) {
  console.error('✗ 未找到 DEEPSEEK_API_KEY（.env 或系统环境变量）')
  process.exit(1)
}

let passed = 0
let failed = 0
const anomalies = []
function check(name, cond, detail = '') {
  if (cond) {
    passed++
    console.log(`  ✅ ${name}`)
  } else {
    failed++
    console.log(`  ❌ ${name} ${detail}`)
  }
}
function anomaly(name, detail) {
  anomalies.push(`${name}: ${detail}`)
  console.log(`  ⚠ 异常记录：${name} — ${detail}`)
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
    const timer = setTimeout(() => reject(new Error(`kernel start timeout. stderr: ${stderr.slice(-800)}`)), 25000)
    const poll = () => {
      const m = stderr.match(/listening on ws:\/\/127\.0\.0\.1:(\d+)/)
      const t = stderr.match(/token=([^\s]+)/)
      if (m && t) {
        clearTimeout(timer)
        resolve({ child, port: Number(m[1]), token: t[1] })
      } else setTimeout(poll, 100)
    }
    child.on('exit', (code) => reject(new Error(`kernel exited early: ${code}. stderr: ${stderr.slice(-800)}`)))
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

function nextMessage(ws, filter, timeoutMs = 60000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      ws.off('message', onMsg)
      resolve(null)
    }, timeoutMs)
    const onMsg = (data) => {
      let msg
      try {
        msg = JSON.parse(data.toString('utf8'))
      } catch {
        return
      }
      if ((msg.method === 'notify' || msg.method === 'hello') && filter(msg.params)) {
        clearTimeout(timer)
        ws.off('message', onMsg)
        resolve(msg.params)
      }
    }
    ws.on('message', onMsg)
  })
}

async function main() {
  const started = Date.now()
  const { child, port, token } = await startKernel()
  console.log(`内核已启动：ws://127.0.0.1:${port}`)
  const ws = await connect(`ws://127.0.0.1:${port}`)
  let seq = 0
  const pending = new Map()
  ws.on('message', (data) => {
    let msg
    try {
      msg = JSON.parse(data.toString('utf8'))
    } catch {
      return
    }
    if (msg.id !== undefined && msg.id !== null && pending.has(msg.id)) {
      const { resolve, reject, timer } = pending.get(msg.id)
      pending.delete(msg.id)
      clearTimeout(timer)
      if (msg.error) reject(new Error(`[${msg.error.code}] ${msg.error.message}`))
      else resolve(msg.result)
    }
  })
  const request = (method, params = {}, timeoutMs = 60000) =>
    new Promise((resolve, reject) => {
      const id = ++seq
      const timer = setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id)
          reject(new Error(`timeout: ${method}`))
        }
      }, timeoutMs)
      pending.set(id, { resolve, reject, timer })
      ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
    })

  try {
    // ---------- 1. 连接 + 创建智能体 ----------
    const helloP = nextMessage(ws, (p) => p?.protocol === 'cobeing-ws/1' && p?.name !== undefined, 15000)
    await request('auth', { token })
    const hello = await helloP
    check('auth/hello：连接成功（协议 cobeing-ws/1）', hello?.protocol === 'cobeing-ws/1', JSON.stringify(hello).slice(0, 120))

    await request('requestCreateAgent', { def: { name: 'waker', role: '写作者：文件撰写与代码编辑', provider: 'deepseek', model: 'deepseek-chat', maxTokens: 8192, createdAt: Date.now() } })
    await request('confirmAgent', { name: 'waker' })
    check('智能体创建/批准（waker，deepseek 真实路由）', true)

    // ---------- 2. 建群 + 不带 mention 发言（修复 1 核心场景） ----------
    const created = await request('createGroup', { name: 'wake-team', label: ['user', 'butler', 'waker'] })
    check('建群 wake-team（user+butler+waker）', created?.status === 'working')

    const speakNotif = nextMessage(ws, (p) => p?.type === 'update' && p?.scope === 'group' && p?.group === 'wake-team' && p?.kind === 'speak', 15000)
    // ⚠ 关键：不带 mention——修复 1 前此消息零唤醒（群组偷懒最直接原因）
    await request('speakToGroup', {
      group: 'wake-team',
      actor: 'user',
      content:
        '在群组空间写一个 hello.txt 文件，内容为 "Hello CoBeing - wake test"。用 str-replace-editor 的 create 写入（一次写完即可），然后用 persistent-bash 运行 type hello.txt 验证内容。完成后报告文件路径与内容。',
      task: '写 hello.txt 并验证内容',
    })
    const speakMsg = await speakNotif
    check('用户发言（无 mention）→ update(group) speak 实时广播', speakMsg?.group === 'wake-team')

    console.log('⏳ 等待 waker 被默认唤醒并真实工作（真实 DeepSeek，最长 4 分钟）…')

    // ---------- 3. 等待真实工作收敛（工具调用 + 产物落盘 + 完成汇报） ----------
    const space = join(dataDir, 'group', 'wake-team')
    const logFile = join(space, 'log.jsonl')
    const product = join(space, 'hello.txt')
    const deadline = Date.now() + 240000
    let sawToolCalls = false
    let productReady = false
    let doneMsg = null
    while (Date.now() < deadline) {
      const proj = await request('groupProjection', { group: 'wake-team' }, 15000)
      const msgs = proj.publicMessages ?? []
      for (const m of msgs) {
        if (m.content.includes('[工作失败]')) anomaly('投影出现 [工作失败]', `${m.actor}: ${m.content.slice(0, 200)}`)
        if (m.content.includes('[mention 失败]')) anomaly('投影出现 [mention 失败]', `${m.actor}: ${m.content.slice(0, 200)}`)
      }
      if (existsSync(logFile)) {
        try {
          const evs = readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
          sawToolCalls = sawToolCalls || evs.some((e) => e.type === 'tool/call' && e.actor === 'waker')
        } catch {}
      }
      productReady = productReady || existsSync(product)
      // 完成报告（waker 发言）
      const report = msgs.find((m) => m.actor === 'waker' && /完成|已写|路径|hello\.txt/.test(m.content))
      if (report) doneMsg = report
      if (productReady && sawToolCalls && doneMsg) break
      await new Promise((r) => setTimeout(r, 3000))
    }

    // ---------- 4. 断言 ----------
    check('不带 mention 的任务被默认唤醒执行（工具调用发生）', sawToolCalls)
    check('产物 hello.txt 落盘于群组空间', existsSync(product), `路径: ${product}`)
    if (existsSync(product)) {
      const content = readFileSync(product, 'utf8').trim()
      check('产物内容为 Hello CoBeing - wake test', content.includes('Hello CoBeing'), content.slice(0, 80))
    }
    check('waker 完成汇报发言（经【诚实】审查放行）', Boolean(doneMsg), doneMsg?.content?.slice(0, 200) ?? '（未找到完成汇报）')

    // ---------- 5. 异常与工具面检查 ----------
    const events = existsSync(logFile)
      ? readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
      : []
    const calls = events.filter((e) => e.type === 'tool/call' && e.actor === 'waker')
    const names = new Set(calls.map((c) => c.name))
    const denied = events.filter((e) => e.type === 'tool/result' && e.actor === 'waker' && String(e.content ?? '').includes('TOOL_DENIED'))
    const reqErrors = events.filter((e) => e.type === 'request/error' && e.actor === 'waker')
    console.log(`  工具调用: ${[...names].join(', ') || '（无）'}；request/error ${reqErrors.length} 次`)
    check('waker 使用了真实工作工具（str-replace-editor/persistent-bash）', names.has('str-replace-editor') || names.has('persistent-bash'), `实际: ${[...names].join(',')}`)
    check('无 TOOL_DENIED（工具面收敛后不出现被拒协调工具调用）', denied.length === 0, `被拒 ${denied.length} 次`)
    check('无 request/error', reqErrors.length === 0, `错误 ${reqErrors.length} 次`)
    if (anomalies.length > 0) {
      for (const a of anomalies) console.log(`  ⚠ ${a}`)
    }
    check('投影无 [工作失败]/[mention 失败] 异常', anomalies.length === 0, anomalies.join(' | '))

    const elapsed = ((Date.now() - started) / 1000).toFixed(1)
    console.log(`\n结果：${passed} 通过 / ${failed} 失败（${elapsed}s）`)
  } finally {
    try {
      ws.close()
    } catch {}
    try {
      child.kill()
    } catch {}
    await new Promise((r) => setTimeout(r, 500))
    try {
      rmSync(dataDir, { recursive: true, force: true })
    } catch {}
  }
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('✗ verify failed:', e)
  process.exit(1)
})
