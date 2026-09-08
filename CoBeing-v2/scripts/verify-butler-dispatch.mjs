/**
 * 真实验证 2.0.14：管家端到端任务闭环（真实 DeepSeek）
 *
 * 场景（一次用户请求 → 管家全自主推进，无需用户进群手操）：
 *   1. 主窗口对但丁说"建 websearcher + 建群 + 派活开工"——但丁自主 create-agent 提交
 *   2. 用户批准（桥 confirmAgent）→ 名录登记
 *   3. **批准后不再发任何消息** → 但丁应被自动唤醒续步，自主建群 + speak-to-group 派活
 *   4. 群组 worker 被唤醒并真实开工（发言/产出）
 * 用法：node scripts/verify-butler-dispatch.mjs
 * key：同目录 .env 的 DEEPSEEK_API_KEY（系统环境变量优先）
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = mkdtempSync(join(tmpdir(), 'cb-butler-dispatch-'))

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

  // 1. 用户一次提出完整任务：建智能体 + 建群 + 派活开工
  await request('mainWindowSpeak', {
    content: '请创建一个搜索智能体 websearcher（角色：网络搜索），批准后建群并让它在群里开工调研搜索技术方案。',
  })
  const s1 = (await request('butlerProjection')).result.publicMessages.at(-1)?.seq ?? 0
  assert(await waitButlerReply(s1, 150_000), '但丁真实回复（收到创建请求）')

  // 2. 待批准队列出现 websearcher
  assert(
    await poll(async () => {
      const p = await request('listPendingApprovals')
      return Array.isArray(p.result) && p.result.some((a) => a.name === 'websearcher')
    }, 90_000),
    '待批准队列出现 websearcher（管家自主发起创建）',
  )

  // 3. 用户批准（GUI 同桥方法）→ 名录登记；此后再无任何用户发言
  await request('confirmAgent', { name: 'websearcher' })
  const agents = await request('listAgents')
  assert(agents.result.some((a) => a.name === 'websearcher'), '批准后名录登记 websearcher')

  // 4. 关键：批准后不发言 → 但丁应被自动唤醒续步，自主建群（模型自主定群名，含 websearcher 成员）
  const s2 = (await request('butlerProjection')).result.publicMessages.at(-1)?.seq ?? 0
  assert(
    await poll(async () => {
      const p = await request('butlerProjection', undefined, 15000)
      return p.result.publicMessages.some((m) => m.actor === 'butler' && m.seq > s2)
    }, 150_000),
    '批准后但丁被自动唤醒（无用户发言仍续步）',
  )
  // 建群：批准后出现新的 working 群组且含 websearcher 成员
  assert(
    await poll(async () => {
      const g = await request('listGroups')
      return Array.isArray(g.result) && g.result.some((x) => x.status === 'working' && x.label.includes('websearcher'))
    }, 120_000),
    '但丁自动建群（working 群组含 websearcher 成员）',
  )
  // 派活：任一含 websearcher 的群组出现任务摘要或但丁/成员群内发言
  assert(
    await poll(async () => {
      const g = await request('listGroups')
      const meta = Array.isArray(g.result) ? g.result.find((x) => x.status === 'working' && x.label.includes('websearcher')) : null
      if (!meta) return false
      if (meta.taskSummary) return true
      const proj = await request('groupProjection', { group: meta.name }).catch(() => null)
      if (proj?.result?.publicMessages?.some((m) => m.actor !== 'user')) return true
      return false
    }, 150_000),
    '但丁向群组派活（任务摘要/群内发言出现）',
  )

  // 5. 群组工作成员被唤醒并真实开工（发言/产出）
  assert(
    await poll(async () => {
      const g = await request('listGroups')
      const meta = Array.isArray(g.result) ? g.result.find((x) => x.status === 'working' && x.label.includes('websearcher')) : null
      if (!meta) return false
      const proj = await request('groupProjection', { group: meta.name }).catch(() => null)
      return !!proj?.result?.publicMessages?.some((m) => m.actor !== 'user' && m.actor !== 'butler')
    }, 180_000),
    '群组工作智能体被唤醒并发言/开工',
  )

  const elapsed = ((Date.now() - started) / 1000).toFixed(1)
  console.log(`
BUTLER-DISPATCH VERIFY PASSED (${elapsed}s, data=${dataDir})`)
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
