/**
 * 真实验证：基础编程工具面（真实 DeepSeek 端到端）
 *
 * 场景：创建群组 [user, butler, coder]，coder 使用真实 DeepSeek 完成编程任务：
 *   "用 JS 写一个 fibonacci.js（递归+缓存），写完后用 node 运行验证输出前 10 项"
 * 断言：
 *   1. coder 至少调用一次 write（或 str-replace-editor 写命令）落盘 fibonacci.js
 *   2. 群组空间存在 fibonacci.js 且可被 node 运行（真实产物）
 *   3. coder 使用持久 shell 运行 node 验证
 *   4. coder 至少使用 todo-list 规划任务（基础编程能力新面）
 * 用法：node scripts/verify-coding-tools.mjs
 * key：同目录 .env 的 DEEPSEEK_API_KEY（系统环境变量优先）
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = mkdtempSync(join(tmpdir(), 'cb-coding-'))

// 读取 .env（系统环境变量优先）
let apiKey = process.env.DEEPSEEK_API_KEY ?? ''
if (!apiKey) {
  try {
    const env = readFileSync(join(root, '.env'), 'utf8')
    const m = env.match(/^DEEPSEEK_API_KEY=(.+)$/m)
    if (m) apiKey = m[1].trim()
  } catch {}
}
if (!apiKey) {
  console.error('✗ 未找到 DEEPSEEK_API_KEY（.env 或系统环境变量）')
  process.exit(1)
}

const child = spawn('node', [join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'), join(root, 'packages', 'bridge', 'src', 'cli.ts'), '--data', dataDir], {
  cwd: root,
  stdio: ['pipe', 'pipe', 'pipe'],
  shell: false,
  env: { ...process.env, DEEPSEEK_API_KEY: apiKey },
})

let stdoutBuf = ''
let stderrBuf = ''
child.stdout.setEncoding('utf8')
child.stderr.setEncoding('utf8')
child.stdout.on('data', (d) => { stdoutBuf += d })
child.stderr.on('data', (d) => { stderrBuf += d })

let seq = 0
const pending = new Map()
const lineQueue = []
let onLine = null

child.stdout.on('data', (chunk) => {
  for (const line of chunk.split('\n').filter((l) => l.trim())) {
    let matched = false
    try {
      const parsed = JSON.parse(line)
      if (parsed.id !== undefined && pending.has(parsed.id)) {
        const { resolve } = pending.get(parsed.id)
        pending.delete(parsed.id)
        resolve(parsed)
        matched = true
      }
    } catch {}
    if (!matched) lineQueue.push(line)
  }
  flushLines()
})

function flushLines() {
  while (lineQueue.length && onLine) {
    const line = lineQueue.shift()
    onLine(line)
  }
}

function request(method, params, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve, reject })
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id)
        reject(new Error(`timeout waiting reply for ${method}`))
      }
    }, timeoutMs)
  })
}

async function poll(fn, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await fn()) return true
    await new Promise((r) => setTimeout(r, 1000))
  }
  return false
}

function assert(cond, message) {
  if (!cond) {
    console.error(`✗ ${message}`)
    dumpAndExit(1)
  }
  console.log(`✓ ${message}`)
}

function dumpAndExit(code) {
  console.error('--- kernel stdout tail ---')
  console.error(stdoutBuf.slice(-3000))
  console.error('--- kernel stderr tail ---')
  console.error(stderrBuf.slice(-3000))
  child.kill()
  process.exit(code)
}

child.on('error', (err) => {
  console.error('spawn error:', err)
  process.exit(1)
})

async function main() {
  const started = Date.now()
  await request('ping')

  // 1. 创建 coder 智能体（真实 DeepSeek）
  await request('requestCreateAgent', { def: { name: 'coder', role: '编程智能体', provider: 'deepseek', model: 'deepseek-chat', maxTokens: 2048, createdAt: Date.now() } })
  await request('confirmAgent', { name: 'coder' })
  console.log('✓ coder 智能体创建/批准（deepseek/deepseek-chat）')

  // 2. 群组 + 编程任务
  await request('createGroup', { name: 'coding-verify', label: ['user', 'butler', 'coder'] })
  await request('speakToGroup', {
    group: 'coding-verify',
    actor: 'user',
    content: '请完成一个编程任务：用 todo-list 工具规划步骤，然后用 str-replace-editor 的 write 命令创建 fibonacci.js（实现 fibonacci(n)，递归+缓存），再用 persistent-bash 运行 node 验证输出前 10 项。完成后在群组报告。',
    mention: ['coder'],
    task: '编写并验证 fibonacci.js',
  })
  console.log('✓ 编程任务已下发，等待 coder 工作（真实 LLM，最长 5 分钟）…')

  // 3. 等待 coder 发言（工作完成信号）
  const spoke = await poll(async () => {
    const p = await request('groupProjection', { group: 'coding-verify' }, 15000)
    return p.result.publicMessages.some((m) => m.actor === 'coder' && m.content.length > 0)
  }, 300_000)
  assert(spoke, 'coder 完成发言')

  // 4. 从事件日志（append-only JSONL）收集工具调用记录
  const logFile = join(dataDir, 'group', 'coding-verify', 'log.jsonl')
  const events = readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const calls = events.filter((e) => e.type === 'tool/call' && e.actor === 'coder')
  const results = events.filter((e) => e.type === 'tool/result' && e.actor === 'coder')
  const names = new Set(calls.map((c) => c.name))
  console.log('  工具调用:', [...names].join(', ') || '（无）')

  // 断言 1：使用 todo-list 规划（基础编程新面）
  assert(names.has('todo-list'), 'coder 使用 todo-list 规划任务')

  // 断言 2：使用编辑器写文件
  assert(names.has('str-replace-editor'), 'coder 使用 str-replace-editor 写文件')

  // 断言 3：使用持久 shell 运行验证
  assert(names.has('persistent-bash'), 'coder 使用 persistent-bash 运行 node 验证')

  // 断言 4：真实产物存在且可运行
  const space = join(dataDir, 'group', 'coding-verify')
  const fibFile = join(space, 'fibonacci.js')
  assert(existsSync(fibFile), `真实产物 fibonacci.js 落盘（${fibFile}）`)
  const out = await runNode(fibFile)
  // 前 10 项（fib 0..9）= 0,1,1,2,3,5,8,13,21,34；断言末三项序列
  assert(out.ok && /13[\s\S]*21[\s\S]*34/.test(out.stdout), `产物可运行且输出正确（前 10 项以 13/21/34 结尾）:\n${out.stdout.slice(0, 300)}`)

  // 断言 5：至少一次工具成功结果
  const okResults = results.filter((r) => r.ok)
  assert(okResults.length >= 2, `工具结果成功 ${okResults.length} 次`)

  // 6. 报告 + 清理
  const elapsed = ((Date.now() - started) / 1000).toFixed(1)
  console.log(`\nCODING TOOLS VERIFY PASSED (${elapsed}s, data=${dataDir})`)
  await request('stop')
  await new Promise((resolve) => {
    const timer = setTimeout(() => { console.log('⚠ stop 后未退出'); resolve() }, 3000)
    child.on('exit', () => { clearTimeout(timer); resolve() })
  })
  process.exit(0)
}

function runNode(file) {
  return new Promise((resolve) => {
    const proc = spawn('node', [file], { cwd: dirname(file), stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    proc.stdout.setEncoding('utf8')
    proc.stderr.setEncoding('utf8')
    proc.stdout.on('data', (d) => { stdout += d })
    proc.stderr.on('data', (d) => { stderr += d })
    proc.on('exit', (code) => resolve({ ok: code === 0, stdout, stderr }))
    proc.on('error', (e) => resolve({ ok: false, stdout: '', stderr: String(e) }))
  })
}

main().catch((err) => {
  console.error('✗ verify failed:', err.message)
  dumpAndExit(1)
})
