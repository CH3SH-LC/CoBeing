/**
 * 真实验证：主窗口会话（新对话窗口 + 自动压缩可见性）——真实 DeepSeek 端到端
 *
 * 场景：
 *   1. 主窗口与但丁真实对话两轮（真实 key）
 *   2. butler/newConversation 开启新对话：当前归档为历史会话
 *   3. butler/listConversations：当前 + 历史
 *   4. butler/conversationProjection(历史)：旧消息完整可回看
 *   5. 新会话中继续真实对话（但丁在新会话正常工作，上下文归零）
 *   6. butlerProjection.context：估算 token / 阈值（自动压缩可见性）
 * 用法：node scripts/verify-conversation.mjs
 * key：同目录 .env 的 DEEPSEEK_API_KEY（系统环境变量优先）
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = mkdtempSync(join(tmpdir(), 'cb-conv-'))

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

  // 1. 第一会话：两轮真实对话（上下文延续）
  await request('mainWindowSpeak', { content: '你好但丁，请记住一句话：北极熊的皮肤是黑色的。' })
  const s1 = (await request('butlerProjection')).result.publicMessages.at(-1)?.seq ?? 0
  assert(await waitButlerReply(s1, 120_000), '第一会话第一轮但丁真实回复')
  console.log('  回复:', ((await request('butlerProjection')).result.publicMessages.at(-1)?.content ?? '').slice(0, 80))

  await request('mainWindowSpeak', { content: '我上一句让你记住什么？请直接回答。' })
  const s2 = (await request('butlerProjection')).result.publicMessages.at(-1)?.seq ?? 0
  assert(await waitButlerReply(s2, 120_000), '第一会话第二轮但丁真实回复（延续上下文）')
  const reply2 = (await request('butlerProjection')).result.publicMessages.at(-1)?.content ?? ''
  console.log('  回复:', reply2.slice(0, 80))
  assert(/北极熊|黑色/.test(reply2), '但丁记住了上一轮信息（会话内上下文有效）')

  const before = await request('butlerProjection')
  const beforeCount = before.result.publicMessages.length
  assert(beforeCount >= 4, `第一会话公共消息 ${beforeCount} 条`)

  // 2. 开启新对话（真实归档 + 记忆总结经真实 LLM）
  console.log('  开启新对话（归档总结经真实 DeepSeek）…')
  const created = await request('butler/newConversation', undefined, 120000)
  assert(/^conv-/.test(created.result.id), `newConversation 返回会话 id ${created.result.id}`)
  const convId = created.result.id

  // 3. 会话列表：当前 + 历史
  const list = await request('butler/listConversations')
  assert(list.result[0].current === true, '列表首位为当前会话')
  const hist = list.result.find((c) => !c.current)
  assert(hist && hist.id === convId, `历史会话在列表中（${convId}）`)
  assert(hist.messageCount >= beforeCount, `历史会话完整事件数 ${hist.messageCount} >= ${beforeCount}`)

  // 4. 历史只读投影：旧消息完整可回看
  const histProj = await request('butler/conversationProjection', { id: convId })
  const histUsers = histProj.result.publicMessages.filter((m) => m.actor === 'user')
  assert(histUsers.length === 2, `历史投影含第一会话 2 条用户消息（实际 ${histUsers.length}）`)
  assert(histUsers[0].content.includes('北极熊'), '历史第一条用户消息完整保留')
  assert(histProj.result.publicMessages.some((m) => m.content.includes('黑色')), '历史含但丁记忆回复')

  // 5. 新会话：投影清空 + 继续真实对话（上下文归零）
  const cur = await request('butlerProjection')
  assert(cur.result.publicMessages.length === 0, '新会话投影为空（上下文归零）')
  await request('mainWindowSpeak', { content: '新会话的第一句话：现在是全新对话，请用一句话确认。' })
  const s3 = (await request('butlerProjection')).result.publicMessages.at(-1)?.seq ?? 0
  assert(await waitButlerReply(s3, 120_000), '新会话中但丁继续真实回复')
  const reply3 = (await request('butlerProjection')).result.publicMessages.at(-1)?.content ?? ''
  console.log('  回复:', reply3.slice(0, 80))

  // 6. 自动压缩可见性：context 估算 token / 阈值
  const ctx = await request('butlerProjection')
  assert(ctx.result.context && ctx.result.context.thresholdTokens === 100_000, `context 阈值 100k（实际 ${ctx.result.context?.thresholdTokens}）`)
  assert(ctx.result.context.estimatedTokens > 0, `context 估算 token ${ctx.result.context.estimatedTokens}`)

  const elapsed = ((Date.now() - started) / 1000).toFixed(1)
  console.log(`\nCONVERSATION VERIFY PASSED (${elapsed}s, data=${dataDir})`)
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
