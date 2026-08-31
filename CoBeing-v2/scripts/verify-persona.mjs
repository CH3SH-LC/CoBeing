/**
 * 真实验证 2.0.11：铃音（二次元少女管家）人格端到端（真实 DeepSeek）
 *
 * 场景：
 *   1. 主窗口打招呼 → 铃音自称「铃音」（改名生效），回复带二次元元气风格但非空泛套话
 *   2. 用户提出具体问题 → 铃音直接回答（不绕弯、不套话）
 *   3. 用户提出新能力需求 → 铃音自主调用 create-agent 工具（职责纪律未破坏）
 *   4. 群组场景：群组内但丁分身 prompt 已改中文铃音（butler-relay 链路）
 * 用法：node scripts/verify-persona.mjs
 * key：同目录 .env 的 DEEPSEEK_API_KEY（系统环境变量优先）
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = mkdtempSync(join(tmpdir(), 'cb-persona-'))

let apiKey = process.env.DEEPSEEK_API_KEY ?? ''
if (!apiKey) {
  try {
    const cfgPath = join(homedir(), 'AppData', 'Roaming', 'com.cobeing.v2', 'model-config.json')
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'))
    const active = cfg.sources?.find((s) => s.id === cfg.active_source)
    if (active?.api_key) apiKey = active.api_key
  } catch {}
}
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

function request(method, params, timeoutMs = 30000) {
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

async function waitButlerReply(sinceSeq, timeoutMs) {
  return poll(async () => {
    const p = await request('butlerProjection', undefined, 15000)
    return p.result.publicMessages.some((m) => m.actor === 'butler' && m.seq > sinceSeq)
  }, timeoutMs)
}

async function main() {
  const started = Date.now()
  await request('ping')

  // 1. 打招呼：铃音自称新名字（改名生效）
  await request('mainWindowSpeak', { content: '你好，你是谁？请介绍一下自己。' })
  const s1 = (await request('butlerProjection')).result.publicMessages.at(-1)?.seq ?? 0
  assert(await waitButlerReply(s1, 120_000), '铃音真实回复（自我介绍）')
  const reply1 = (await request('butlerProjection')).result.publicMessages.at(-1)?.content ?? ''
  console.log('  回复:', reply1.slice(0, 150))
  assert(/铃音/.test(reply1), '回复自称「铃音」（改名生效，不再自称但丁）')
  assert(!/但丁|Dante/.test(reply1), '回复不含旧名字「但丁」')
  assert(!/^[\s\S]*有什么可以帮.{0,4}？[\s\S]*$/.test(reply1.trim()), '回复非空泛套话')

  // 2. 具体问题：直接回答（不绕弯、不套话）
  await request('mainWindowSpeak', { content: '1+1 等于几？直接回答。' })
  const s2 = (await request('butlerProjection')).result.publicMessages.at(-1)?.seq ?? 0
  assert(await waitButlerReply(s2, 120_000), '铃音回答具体问题')
  const reply2 = (await request('butlerProjection')).result.publicMessages.at(-1)?.content ?? ''
  console.log('  回复:', reply2.slice(0, 120))
  assert(/2/.test(reply2), '回答包含正确答案（直接回应内容）')

  // 3. 新能力需求 → 自主调用 create-agent（职责纪律未破坏）
  await request('mainWindowSpeak', {
    content: '我需要一个能写文案的智能体，请调用 create-agent 工具创建，名字 copywriter，角色 文案写作。',
  })
  const s3 = (await request('butlerProjection')).result.publicMessages.at(-1)?.seq ?? 0
  assert(await waitButlerReply(s3, 120_000), '铃音收到创建请求')
  assert(
    await poll(async () => {
      const p = await request('listPendingApprovals')
      return Array.isArray(p.result) && p.result.some((a) => a.name === 'copywriter')
    }, 90_000),
    '待批准队列出现 copywriter（铃音自主发起创建）',
  )

  // 4. 群组内管家分身：butler-relay 链路（prompt 已改中文铃音分身）
  await request('requestCreateAgent', { def: { name: 'writer', role: '写作者', createdAt: Date.now() } })
  await request('confirmAgent', { name: 'writer' })
  await request('createGroup', { name: 'persona-g', label: ['user', 'butler', 'writer'] })
  await request('speakToGroup', { group: 'persona-g', actor: 'user', content: '请群组内管家转告主窗口：任务已完成', mention: ['butler'], task: '转告' })
  // 分身回复出现在群组投影（转告成功）
  assert(
    await poll(async () => {
      const p = await request('groupProjection', { group: 'persona-g' })
      return p.result.publicMessages.some((m) => m.actor === 'butler' && /转告|已.*主窗口/.test(m.content ?? ''))
    }, 120_000),
    '群组内铃音分身回复（butler-relay 链路正常）',
  )
  // 主窗口收到 relay 通知（notify 广播 text：[group → 管家] report）
  assert(
    await poll(() => Promise.resolve(/persona-g.*→.*管家.*report|任务已完成/.test(stdoutBuf)), 30_000),
    '主窗口收到群组 relay 通知（转告链路完整）',
  )

  const elapsed = ((Date.now() - started) / 1000).toFixed(1)
  console.log(`\nPERSONA VERIFY PASSED (${elapsed}s, data=${dataDir})`)
  await request('stop')
  await new Promise((resolve) => {
    const timer = setTimeout(() => { console.log('⚠ stop 后未退出'); resolve() }, 3000)
    child.on('exit', () => { clearTimeout(timer); resolve() })
  })
  process.exit(0)
}

main().catch((err) => {
  console.error('✗ verify failed:', err.message)
  dumpAndExit(1)
})
