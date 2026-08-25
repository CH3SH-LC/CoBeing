/**
 * CLI 冒烟：spawn cobeing-kernel 子进程，走 JSON-RPC 行协议完整用户路径。
 *
 * 用法：node scripts/smoke-cli.mjs [--data <dir>]
 * 覆盖：ping → 智能体创建/批准 → 群组创建 → mention 工作 → 投影 → 归档 → 复用建议 → stop
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = process.argv.includes('--data')
  ? process.argv[process.argv.indexOf('--data') + 1]
  : mkdtempSync(join(tmpdir(), 'cb-smoke-'))

const child = spawn('node', [join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'), join(root, 'packages', 'bridge', 'src', 'cli.ts'), '--data', dataDir], {
  cwd: root,
  stdio: ['pipe', 'pipe', 'pipe'],
  shell: false,
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
    // 优先按 id 匹配 pending 请求
    let matched = false
    try {
      const parsed = JSON.parse(line)
      if (parsed.id !== undefined && pending.has(parsed.id)) {
        const { resolve } = pending.get(parsed.id)
        pending.delete(parsed.id)
        resolve(parsed)
        matched = true
      }
    } catch {
      // 非法行 → 排队
    }
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

function request(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve, reject })
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id)
        reject(new Error(`timeout waiting reply for ${method}`))
      }
    }, 10000)
  })
}

function waitLine(timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('waitLine timeout')), timeoutMs)
    onLine = (line) => {
      clearTimeout(timer)
      onLine = null
      resolve(line)
    }
    flushLines()
  })
}

async function main() {
  // 1. ping
  const ping = await request('ping')
  assert(ping.result?.pong === true, 'ping 返回 pong')
  console.log('✓ ping')

  // 2. 智能体创建 + 批准
  await request('requestCreateAgent', { def: { name: 'writer', role: '写作者', createdAt: Date.now() } })
  const pendingList = await request('listPendingApprovals')
  assert(pendingList.result.some((a) => a.name === 'writer'), '待批准含 writer')
  await request('confirmAgent', { name: 'writer' })
  console.log('✓ 智能体创建/批准')

  // 3. 群组创建 + mention 工作（mock 回复，写入群空间）
  const created = await request('createGroup', { name: 'smoke-demo', label: ['user', 'butler', 'writer'] })
  assert(created.result.status === 'working', '群组 working')
  await request('speakToGroup', {
    group: 'smoke-demo',
    actor: 'user',
    content: '请 writer 写一段欢迎语',
    mention: ['writer'],
    task: '写一段欢迎语',
  })
  // 轮询投影直到 writer 发言
  const deadline = Date.now() + 8000
  let projection = null
  while (Date.now() < deadline) {
    const proj = await request('groupProjection', { group: 'smoke-demo' })
    projection = proj.result
    if (projection.publicMessages.some((m) => m.actor === 'writer')) break
    await new Promise((r) => setTimeout(r, 200))
  }
  assert(projection.publicMessages.some((m) => m.actor === 'writer'), 'writer 发言进投影')
  console.log('✓ 群组 mention 工作链')
  console.log('   群消息:', projection.publicMessages.map((m) => `${m.actor}: ${m.content.slice(0, 40)}`).join(' | '))

  // 4. 主窗口对话（但丁回复）
  await request('mainWindowSpeak', { content: '你好' })
  const butlerProj = await pollProjection(async () => {
    const p = await request('butlerProjection')
    return p.result.publicMessages.some((m) => m.actor === 'butler')
  })
  assert(butlerProj, '但丁回复')
  console.log('✓ 主窗口对话')

  // 5. 归档 + 复用建议
  await request('archiveGroup', { name: 'smoke-demo' })
  const archived = await request('listArchivedGroups')
  assert(archived.result.some((g) => g.name === 'smoke-demo'), '归档索引')
  const suggestions = await request('listReuseSuggestions')
  assert(suggestions.result.length > 0, '复用建议')
  console.log('✓ 归档 + 复用建议')

  // 6. 错误面
  const unknown = await request('noSuchMethod')
  assert(unknown.error?.code === -32601, '未知方法 -32601')
  const missing = await request('speakToGroup', { group: 'nope', actor: 'user', content: 'x' })
  assert(missing.error?.code === -32000, '业务错误 -32000')
  console.log('✓ 错误面')

  // 7. stop（应触发 kernel.stop + 进程退出）
  await request('stop')
  await new Promise((resolve) => {
    const timer = setTimeout(() => { console.log('⚠ stop 后进程未退出'); resolve() }, 3000)
    child.on('exit', () => { clearTimeout(timer); resolve() })
  })
  console.log('✓ stop 优雅退出')

  console.log('\nSMOKE ALL PASSED')
  process.exit(0)
}

async function pollProjection(fn, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await fn()) return true
    await new Promise((r) => setTimeout(r, 200))
  }
  return false
}

function assert(cond, message) {
  if (!cond) {
    console.error(`✗ ${message}`)
    console.error('--- stdout ---')
    console.error(stdoutBuf.slice(-2000))
    console.error('--- stderr ---')
    console.error(stderrBuf.slice(-2000))
    child.kill()
    process.exit(1)
  }
}

child.on('error', (err) => {
  console.error('spawn error:', err)
  process.exit(1)
})

main().catch((err) => {
  console.error('✗ smoke failed:', err.message)
  console.error('--- stderr ---')
  console.error(stderrBuf.slice(-2000))
  child.kill()
  process.exit(1)
})
