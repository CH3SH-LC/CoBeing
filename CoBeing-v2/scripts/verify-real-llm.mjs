/**
 * DeepSeek 真实调用验证（2026-08-23 待办收口）
 *
 * 用法：DEEPSEEK_API_KEY=<key> node scripts/verify-real-llm.mjs [--data <dir>]
 * 覆盖（真实子进程 + JSON-RPC 行协议 + 真实 DeepSeek API）：
 *   1. 主窗口但丁 mainWindowSpeak → 真实回复（非 mock、非失败占位）
 *   2. 群组工作智能体（显式 provider: deepseek）mention 工作 → 真实回复
 *   3. 事件日志证据：request/header 记录 provider/model，assistant/complete 带 usage（真实调用必有 token 计数）
 *   4. 错误面：无效 key → 但丁回复 [工作失败] DeepSeek API error 401（错误摘要透出）
 * 不写任何文件到项目目录（数据目录默认临时目录）；key 仅经环境变量传递，绝不落盘。
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = process.argv.includes('--data')
  ? process.argv[process.argv.indexOf('--data') + 1]
  : mkdtempSync(join(tmpdir(), 'cb-llm-'))

const apiKey = process.env.DEEPSEEK_API_KEY ?? ''
if (!apiKey) {
  console.error('✗ 需要 DEEPSEEK_API_KEY 环境变量')
  process.exit(2)
}

let failures = 0
function assert(cond, message, extra = '') {
  if (cond) {
    console.log(`  ✓ ${message}`)
  } else {
    failures++
    console.error(`  ✗ ${message}${extra ? `\n    ${extra}` : ''}`)
  }
}

/** 启动一个 kernel 子进程，返回 RPC 客户端（dataDir 按场景隔离，避免旧日志污染轮询） */
function launch(label, envKey, dataRoot = dataDir) {
  const child = spawn(
    'node',
    [join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'), join(root, 'packages', 'bridge', 'src', 'cli.ts'), '--data', dataRoot],
    { cwd: root, stdio: ['pipe', 'pipe', 'pipe'], shell: false, env: { ...process.env, DEEPSEEK_API_KEY: envKey } },
  )
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
      } catch { /* 排队 */ }
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
  const request = (method, params, timeoutMs = 90_000) =>
    new Promise((resolve, reject) => {
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
  const stop = async () => {
    try { await request('stop', undefined, 5000) } catch { /* ignore */ }
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 3000)
      child.on('exit', () => { clearTimeout(timer); resolve() })
    })
  }
  return { request, stop, label, get stdout() { return stdoutBuf }, get stderr() { return stderrBuf } }
}

async function pollProjection(rpc, fn, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await fn()) return true
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

/** 收集事件日志中的 LLM 调用证据（request/header + assistant/complete usage） */
function collectLlmEvidence(dir) {
  const evidence = []
  const walk = (file) => {
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean)
    for (const line of lines) {
      try {
        const ev = JSON.parse(line)
        if (ev.type === 'request/header') {
          evidence.push({ kind: 'request', actor: ev.actor, provider: ev.provider, model: ev.model })
        } else if (ev.type === 'assistant/complete' && ev.usage) {
          evidence.push({ kind: 'complete', actor: ev.actor, usage: ev.usage })
        }
      } catch { /* 忽略坏行 */ }
    }
  }
  for (const file of [join(dir, 'butler', 'log.jsonl'), join(dir, 'group', 'llm-check', 'log.jsonl')]) {
    try { walk(file) } catch { /* 文件不存在则跳过 */ }
  }
  return evidence
}

async function main() {
  console.log(`\n=== 场景 1：真实 key，主窗口但丁 + 群组工作智能体 ===`)
  const rpc = launch('real', apiKey)
  try {
    const ping = await rpc.request('ping')
    assert(ping.result?.pong === true, 'ping')

    await rpc.request('requestCreateAgent', { def: { name: 'reporter', role: '验证员', provider: 'deepseek', model: 'deepseek-chat', maxTokens: 1024, createdAt: Date.now() } })
    await rpc.request('confirmAgent', { name: 'reporter' })
    console.log('  ✓ 智能体 reporter 创建（provider: deepseek / deepseek-chat 显式指定）')

    const created = await rpc.request('createGroup', { name: 'llm-check', label: ['user', 'butler', 'reporter'] })
    assert(created.result?.status === 'working', '群组 llm-check working')

    console.log('  … 群组 mention reporter 工作（真实 DeepSeek 调用，可能需 10-60s）')
    await rpc.request('speakToGroup', {
      group: 'llm-check', actor: 'user',
      content: '请 reporter 用中文写一句话自我介绍，直接回复即可',
      mention: ['reporter'], task: '写一句中文自我介绍',
    })
    let groupMsgs = []
    const gotGroupReply = await pollProjection(rpc, async () => {
      const proj = await rpc.request('groupProjection', { group: 'llm-check' })
      groupMsgs = proj.result.publicMessages
      return groupMsgs.some((m) => m.actor === 'reporter')
    })
    assert(gotGroupReply, 'reporter 发言进入投影（真实 key 下为真实 DeepSeek 回复）')
    const reporterMsg = groupMsgs.find((m) => m.actor === 'reporter')
    if (reporterMsg) {
      console.log(`    reporter 发言内容: ${reporterMsg.content.slice(0, 200)}`)
      assert(!reporterMsg.content.startsWith('(mock)'), 'reporter 回复非 mock 占位', `实际: ${reporterMsg.content.slice(0, 80)}`)
      assert(!reporterMsg.content.startsWith('[工作失败]'), 'reporter 回复非失败占位', `实际: ${reporterMsg.content.slice(0, 80)}`)
    }

    console.log('  … 主窗口但丁对话（真实 DeepSeek 调用）')
    await rpc.request('mainWindowSpeak', { content: '你好，请用一句话介绍你自己' })
    let butlerMsgs = []
    const gotButler = await pollProjection(rpc, async () => {
      const proj = await rpc.request('butlerProjection')
      butlerMsgs = proj.result.publicMessages
      return butlerMsgs.some((m) => m.actor === 'butler')
    })
    assert(gotButler, '但丁发言进入投影')
    const butlerMsg = butlerMsgs.find((m) => m.actor === 'butler')
    if (butlerMsg) {
      console.log(`    但丁发言内容: ${butlerMsg.content.slice(0, 200)}`)
      assert(!butlerMsg.content.startsWith('(mock)'), '但丁回复非 mock 占位', `实际: ${butlerMsg.content.slice(0, 80)}`)
      assert(!butlerMsg.content.startsWith('[工作失败]'), '但丁回复非失败占位', `实际: ${butlerMsg.content.slice(0, 80)}`)
    }

    await rpc.stop()

    // 事件日志证据
    console.log('\n  — 事件日志 LLM 证据（request/header + usage）—')
    const evidence = collectLlmEvidence(dataDir)
    const requests = evidence.filter((e) => e.kind === 'request')
    const completes = evidence.filter((e) => e.kind === 'complete')
    for (const e of requests) console.log(`    request  ${e.actor.padEnd(10)} provider=${e.provider} model=${e.model}`)
    for (const e of completes) console.log(`    complete ${e.actor.padEnd(10)} usage=${JSON.stringify(e.usage)}`)
    assert(requests.some((e) => e.provider === 'deepseek'), '事件日志记录 provider=deepseek（真实路由证据）')
    assert(completes.length >= 2 && completes.every((e) => e.usage), 'assistant/complete 带 usage（真实 API token 计数，mock 无此字段）', JSON.stringify(completes))
  } catch (err) {
    failures++
    console.error(`  ✗ 场景 1 异常: ${err.message}`)
    console.error(`    stderr tail: ${rpc.stderr.slice(-1500)}`)
  }

  console.log(`\n=== 场景 2：无效 key，错误面（DeepSeek API error 401 摘要透出） ===`)
  const badDataDir = mkdtempSync(join(tmpdir(), 'cb-llm-bad-'))
  const bad = launch('bad', 'sk-invalid-key-for-test', badDataDir)
  try {
    const ping = await bad.request('ping')
    assert(ping.result?.pong === true, 'ping（内核仍可启动，key 无效不阻塞启动）')
    await bad.request('mainWindowSpeak', { content: '你好' })
    let butlerMsgs = []
    const gotFailure = await pollProjection(bad, async () => {
      const proj = await bad.request('butlerProjection')
      butlerMsgs = proj.result.publicMessages
      return butlerMsgs.some((m) => m.actor === 'butler' && m.content.startsWith('[工作失败]'))
    }, 60_000)
    assert(gotFailure, '但丁回复 [工作失败] 占位（真实 API 失败被捕获并转用户可见消息）')
    const butlerMsg = butlerMsgs.find((m) => m.actor === 'butler')
    if (butlerMsg) {
      console.log(`    但丁发言内容: ${butlerMsg.content.slice(0, 200)}`)
      assert(/DeepSeek API error 401/.test(butlerMsg.content), '回复含 DeepSeek API error 401 错误摘要（非静默吞错）', `实际: ${butlerMsg.content.slice(0, 120)}`)
    }
    await bad.stop()
    rmSync(badDataDir, { recursive: true, force: true })
  } catch (err) {
    failures++
    console.error(`  ✗ 场景 2 异常: ${err.message}`)
  }

  console.log(`\n${failures === 0 ? 'VERIFY-REAL-LLM ALL PASSED' : `VERIFY-REAL-LLM FAILED (${failures})`}`)
  if (process.argv.includes('--keep')) {
    console.log(`数据目录保留: ${dataDir}`)
  } else {
    rmSync(dataDir, { recursive: true, force: true })
  }
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('✗ verify failed:', err.message)
  process.exit(1)
})
