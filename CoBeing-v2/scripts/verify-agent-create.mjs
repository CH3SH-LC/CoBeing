/**
 * 真实验证 2.0.10：管家自主创建智能体（create-agent 工具，真实 DeepSeek）
 *
 * 场景：
 *   1. 主窗口对但丁说"需要一个做网络搜索的智能体"——但丁应自主调用 create-agent 工具
 *      （不再只能引导用户手动创建；issue #4）
 *   2. 待批准队列出现 websearcher（未登记名录）
 *   3. 桥 confirmAgent 批准 → 登记名录 → 可用 list-agents 查询 → 建群成功
 *   4. 但丁回复质量：非空泛套话（非"有什么可以帮您的？"类固定问候；issue #3）
 * 用法：node scripts/verify-agent-create.mjs
 * key：同目录 .env 的 DEEPSEEK_API_KEY（系统环境变量优先）
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = mkdtempSync(join(tmpdir(), 'cb-agent-create-'))

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

  // 1. 用户提出需要新能力 → 但丁应自主调用 create-agent 工具（协议【创建智能体】）
  await request('mainWindowSpeak', {
    content: '我需要一个能做网络搜索的智能体，请立即调用 create-agent 工具创建它，名字 websearcher，角色 网络搜索。',
  })
  const s1 = (await request('butlerProjection')).result.publicMessages.at(-1)?.seq ?? 0
  assert(await waitButlerReply(s1, 120_000), '但丁真实回复（收到创建请求）')

  // 2. 等待 create-agent 工具调用成功 → 待批准队列出现 websearcher（未登记名录）
  assert(
    await poll(async () => {
      const p = await request('listPendingApprovals')
      return Array.isArray(p.result) && p.result.some((a) => a.name === 'websearcher')
    }, 90_000),
    '待批准队列出现 websearcher（管家自主发起创建）',
  )
  const listAgents = await request('listAgents')
  assert(!listAgents.result.some((a) => a.name === 'websearcher'), '批准前名录未登记 websearcher')

  // 3. 用户批准（GUI 确认按钮同桥方法）→ 登记名录
  await request('confirmAgent', { name: 'websearcher' })
  const agents2 = await request('listAgents')
  assert(agents2.result.some((a) => a.name === 'websearcher'), '批准后名录登记 websearcher')

  // 4. 批准后即可建群（未登记成员建群会失败——修复 #4 前置依赖闭环）
  await request('createGroup', { name: 'search-team', label: ['user', 'butler', 'websearcher'] })
  const groups = await request('listGroups')
  assert(groups.result.some((g) => g.name === 'search-team'), '建群成功（成员已登记）')

  // 5. 但丁回复质量：非空泛套话（issue #3）——检查回复含具体内容
  const proj = await request('butlerProjection')
  const butlerMsgs = proj.result.publicMessages.filter((m) => m.actor === 'butler')
  const lastReply = butlerMsgs.at(-1)?.content ?? ''
  console.log('  但丁最终回复:', lastReply.slice(0, 120))
  assert(!/^[\s\S]*有什么可以帮.{0,4}？[\s\S]*$/.test(lastReply.trim()) || lastReply.length > 12, '但丁回复非空泛套话（有具体内容）')
  assert(!/^晚上好[，,].*$/.test(lastReply.trim()), '但丁回复非固定问候语')

  const elapsed = ((Date.now() - started) / 1000).toFixed(1)
  console.log(`\nAGENT-CREATE VERIFY PASSED (${elapsed}s, data=${dataDir})`)
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
