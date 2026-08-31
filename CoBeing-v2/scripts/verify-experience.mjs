/**
 * 真实验证：经验总结方案（方案 v0.1）——真实 DeepSeek 端到端
 *
 * 场景：
 *   1. 主窗口与但丁真实对话（沉淀用户偏好素材）
 *   2. butler/newConversation 归档 → 自适总结（scope=但丁人格）写管家经验档案
 *   3. experience/info(butler)：条目数 / 最近更新时间
 *   4. 创建 writer（真实 DeepSeek）群组任务：真实工具写 hello.txt + bash 验证
 *   5. archiveGroup 归档 → 自适总结（scope=writer 定义）写工作智能体经验档案
 *   6. experience/info(writer)：条目存在，含 group:<群组名> 来源
 * 用法：node scripts/verify-experience.mjs
 * key：同目录 .env 的 DEEPSEEK_API_KEY（系统环境变量优先）
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = mkdtempSync(join(tmpdir(), 'cb-exp-'))

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

  // 1. 主窗口真实对话（沉淀素材）
  await request('mainWindowSpeak', { content: '你好铃音，请记住一条用户偏好：汇报时用中文、简洁、先说结论。' })
  const s1 = (await request('butlerProjection')).result.publicMessages.at(-1)?.seq ?? 0
  assert(await poll(async () => {
    const p = await request('butlerProjection', undefined, 15000)
    return p.result.publicMessages.some((m) => m.actor === 'butler' && m.seq > s1)
  }, 120_000), '第一轮但丁真实回复')
  console.log('  回复:', ((await request('butlerProjection')).result.publicMessages.at(-1)?.content ?? '').slice(0, 80))

  // 2. 归档开启新对话 → 自适总结（scope=但丁）写管家经验档案
  console.log('  开启新对话（归档总结经真实 DeepSeek + 但丁 scope）…')
  const created = await request('butler/newConversation', undefined, 120000)
  assert(/^conv-/.test(created.result.id), `newConversation 归档 ${created.result.id}`)

  // 3. 管家经验档案存在且有条目（来源 main-window-conversation）
  const butlerFile = join(dataDir, 'memory', 'butler.md')
  assert(existsSync(butlerFile), `管家经验档案存在（${butlerFile}）`)
  const butlerText = readFileSync(butlerFile, 'utf8')
  assert(butlerText.includes('main-window-conversation'), '管家档案含 main-window-conversation 来源条目')
  const butlerEntry = butlerText.match(/- 来源：main-window-conversation[\s\S]*?内容：\n> ([\s\S]*?)(?=\n## |\n- 标签：|$)/)
  const butlerContent = butlerEntry ? butlerEntry[1].trim() : ''
  assert(butlerContent.length > 10, `管家经验内容非空（${butlerContent.length} 字符）`)
  console.log('  管家经验内容:', butlerContent.replace(/\n/g, ' ').slice(0, 120))

  const expInfo = await request('experience/info', { agent: 'butler' })
  assert(expInfo.result.count >= 1, `experience/info(butler) count=${expInfo.result.count}`)
  assert(expInfo.result.lastUpdated > 0, 'experience/info(butler) lastUpdated 存在')

  // 4. 工作智能体群组任务（真实 DeepSeek + 真实工具）
  await request('requestCreateAgent', { def: { name: 'writer', role: '写作者（文件撰写）', provider: 'deepseek', model: 'deepseek-chat', maxTokens: 2048, createdAt: Date.now() } })
  await request('confirmAgent', { name: 'writer' })
  await request('createGroup', { name: 'exp-verify', label: ['user', 'butler', 'writer'] })
  await request('speakToGroup', {
    group: 'exp-verify',
    actor: 'user',
    content: '请完成：用 str-replace-editor 的 write 命令创建 hello.txt（内容 hello world），再用 persistent-bash 运行 type hello.txt 验证，完成后在群组报告。',
    mention: ['writer'],
    task: '创建并验证 hello.txt',
  })
  console.log('  任务已下发，等待 writer 工作（真实 LLM）…')
  const spoke = await poll(async () => {
    const p = await request('groupProjection', { group: 'exp-verify' }, 15000)
    return p.result.publicMessages.some((m) => m.actor === 'writer' && m.content.length > 0)
  }, 300_000)
  assert(spoke, 'writer 完成发言')
  const helloFile = join(dataDir, 'group', 'exp-verify', 'hello.txt')
  assert(existsSync(helloFile), `真实产物 hello.txt 落盘（${helloFile}）`)

  // 5. 群组归档 → 自适总结（scope=writer 定义）写工作智能体经验档案
  await request('archiveGroup', { name: 'exp-verify' }, 120000)
  const writerFile = join(dataDir, 'memory', 'writer.md')
  assert(existsSync(writerFile), `writer 经验档案存在（${writerFile}）`)
  const writerText = readFileSync(writerFile, 'utf8')
  assert(writerText.includes('group:exp-verify'), 'writer 档案含 group:exp-verify 来源条目（任务边界沉淀）')
  const writerEntry = writerText.match(/- 来源：group:exp-verify[\s\S]*?内容：\n> ([\s\S]*?)(?=\n## |\n- 标签：|$)/)
  const writerContent = writerEntry ? writerEntry[1].trim() : ''
  assert(writerContent.length > 10, `writer 经验内容非空（${writerContent.length} 字符）`)
  console.log('  writer 经验内容:', writerContent.replace(/\n/g, ' ').slice(0, 120))

  const writerInfo = await request('experience/info', { agent: 'writer' })
  assert(writerInfo.result.count >= 1, `experience/info(writer) count=${writerInfo.result.count}`)

  // 6. 无档案智能体 count=0
  const ghostInfo = await request('experience/info', { agent: 'ghost' })
  assert(ghostInfo.result.count === 0, 'experience/info(ghost) count=0')

  const elapsed = ((Date.now() - started) / 1000).toFixed(1)
  console.log(`\nEXPERIENCE VERIFY PASSED (${elapsed}s, data=${dataDir})`)
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
