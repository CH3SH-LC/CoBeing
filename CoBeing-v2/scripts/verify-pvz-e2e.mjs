#!/usr/bin/env node
/**
 * 真实 E2E：用户视角全程操控 CoBeing 开发植物大战僵尸（目标任务 4）
 *
 * 用户旅程（模拟手机端/桌面端交互面，WS 全链路）：
 *   1. 用户连接内核（auth/hello）→ 智能体页创建游戏开发智能体 → 批准（update agents 广播）
 *   2. 用户建群 pvz-team（user + butler + game-dev）→ 群组页发言下发任务
 *      （mention + 任务说明；真实 DeepSeek 驱动 game-dev 完整开发）
 *   3. 实时同步检查：发言/回复 update 广播（不依赖轮询）
 *   4. 工作异常扫描：投影内 [工作失败]/[mention 失败]/工具错误率；事件日志 request/error 链
 *   5. 产物真实验证：群组空间出现可运行 HTML 游戏（canvas + 植物/僵尸元素 + 体积合理）
 *   6. 群组工作状态 group/status：成员忙碌标记随工作变化
 *   7. 记忆机制：归档群组 → game-dev 经验档案写入（experience/info count>0）
 *   8. 重启恢复：停内核 → 同数据目录重启 → 归档群组不恢复（listGroups 空）+ 名录/经验保留
 *   9. 主窗口会话：与但丁对话 → 真实回复 → 新对话归档（经验沉淀）
 * 用法：node scripts/verify-pvz-e2e.mjs
 * key：同目录 .env 的 DEEPSEEK_API_KEY（系统环境变量优先）
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(root, 'packages', 'bridge', 'package.json'))
const WebSocket = require('ws')

const dataDir = mkdtempSync(join(tmpdir(), 'cb-pvz-e2e-'))

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

function startKernel(dataDirArg) {
  const child = spawn(
    process.execPath,
    [join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'), join(root, 'packages', 'bridge', 'src', 'cli.ts'), '--data', dataDirArg, '--remote-port', '0'],
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

/** 等待下一条满足条件的服务器消息（notify 或 hello；timeoutMs 上限；超时返回 null） */
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
  const { child, port, token } = await startKernel(dataDir)
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

  // ---------- 1. 用户连接 + 创建智能体（手机端智能体页） ----------
  const helloP = nextMessage(ws, (p) => p?.protocol === 'cobeing-ws/1' && p?.name !== undefined, 15000)
  await request('auth', { token })
  const hello = await helloP
  check('auth/hello：连接成功（协议 cobeing-ws/1）', hello?.protocol === 'cobeing-ws/1', JSON.stringify(hello).slice(0, 120))

  const agentUpdate = nextMessage(ws, (p) => p?.type === 'update' && p?.scope === 'agents' && p?.kind === 'confirm', 15000)
  await request('requestCreateAgent', { def: { name: 'game-dev', role: '游戏开发工程师：HTML/CSS/JS 网页游戏开发', provider: 'deepseek', model: 'deepseek-chat', maxTokens: 8192, createdAt: Date.now() } })
  await request('confirmAgent', { name: 'game-dev' })
  const agentNotif = await agentUpdate
  check('智能体创建/批准 + update(agents) 实时广播', agentNotif?.kind === 'confirm')

  // ---------- 2. 用户建群 + 下发 PvZ 任务 ----------
  const groupUpdate = nextMessage(ws, (p) => p?.type === 'update' && p?.scope === 'groups' && p?.kind === 'create', 15000)
  const created = await request('createGroup', { name: 'pvz-team', label: ['user', 'butler', 'game-dev'] })
  check('建群 pvz-team（user+butler+game-dev）', created?.status === 'working')
  const groupNotif = await groupUpdate
  check('建群 → update(groups) 实时广播', groupNotif?.kind === 'create')

  const speakNotif = nextMessage(ws, (p) => p?.type === 'update' && p?.scope === 'group' && p?.group === 'pvz-team' && p?.kind === 'speak', 15000)
  await request('speakToGroup', {
    group: 'pvz-team',
    actor: 'user',
    content:
      '开发一个完整可玩的植物大战僵尸网页游戏（单文件 HTML index.html，代码量约 10KB+）：必须实现以下全部功能才算完成——①Canvas 绘制游戏画面；②点击种植向日葵/豌豆射手（addEventListener 或 onclick 交互）；③阳光自动掉落与收集；④僵尸从右侧生成并移动；⑤豌豆射手自动攻击僵尸；⑥波次与胜负判定（僵尸进家失败/消灭全部波次胜利）。用 str-replace-editor 创建文件：先用 create/write 写 HTML 骨架，再用 str_replace/insert 分多次追加 JS 逻辑（不要一次 write 全部内容）。todo-list 每个任务只添加一次。写完后用 persistent-bash 运行 node --check 做语法自检。**未实现全部 6 项功能前不要报告完成**；全部实现后报告文件路径与玩法说明。',
    mention: ['game-dev'],
    task: '开发完整可玩植物大战僵尸网页游戏（10KB+ 单文件 HTML）',
  })
  const speakMsg = await speakNotif
  check('用户发言 → update(group:pvz-team) speak 实时广播', speakMsg?.group === 'pvz-team')

  console.log('⏳ 等待 game-dev 开发（真实 DeepSeek，最长 8 分钟）…')

  // 段 3-5 共用路径
  const space = join(dataDir, 'group', 'pvz-team')
  const logFile = join(space, 'log.jsonl')
  const candidates = ['index.html', 'pvz.html', 'pvz-game.html', 'plants-vs-zombies.html', 'game.html']
  /** 空间内是否已有任何 HTML 产物（含兜底扫描） */
  const anyHtml = async () => {
    try {
      return (await listDir(space)).some((f) => f.toLowerCase().endsWith('.html'))
    } catch {
      return false
    }
  }

  // ---------- 3. 等待群组工作收敛（轮询投影 + reply 广播 + 产物落盘） ----------
  const replyNotif = nextMessage(ws, (p) => p?.type === 'update' && p?.scope === 'group' && p?.group === 'pvz-team' && p?.kind === 'reply', 480000)
  const deadline = Date.now() + 480000
  let lastSeen = 0
  let sawToolCalls = false
  let productReady = false
  while (Date.now() < deadline) {
    const proj = await request('groupProjection', { group: 'pvz-team' }, 15000)
    const msgs = proj.publicMessages ?? []
    // 工作异常扫描：投影中的失败/异常发言
    for (const m of msgs.slice(lastSeen)) {
      if (m.content.includes('[工作失败]')) anomaly('投影出现 [工作失败]', `${m.actor}: ${m.content.slice(0, 200)}`)
      if (m.content.includes('[mention 失败]')) anomaly('投影出现 [mention 失败]', `${m.actor}: ${m.content.slice(0, 200)}`)
      if (m.content.includes('error') && /tool|failed|异常/i.test(m.content)) anomaly('投影出现疑似错误', `${m.actor}: ${m.content.slice(0, 200)}`)
    }
    lastSeen = msgs.length
    // 工具调用发生（事件日志实时检查）
    if (existsSync(logFile)) {
      try {
        const evs = readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
        sawToolCalls = sawToolCalls || evs.some((e) => e.type === 'tool/call' && e.actor === 'game-dev')
      } catch {}
    }
    // 产物落盘（真实完成信号——不依赖模型"完成"措辞）
    productReady = productReady || candidates.some((f) => existsSync(join(space, f))) || (await anyHtml())
    // 完成判定：产物落盘 且（有工具调用 或 game-dev 报告完成）
    const devReport = msgs.some((m) => m.actor === 'game-dev' && /完成|已开发|报告|玩法/.test(m.content))
    if (productReady && sawToolCalls) break
    if (productReady && devReport) break
    await new Promise((r) => setTimeout(r, 3000))
  }
  const reply = await replyNotif
  check('game-dev 回复完成 → update(group) reply 实时广播', reply?.group === 'pvz-team', '（超时但产物存在也可接受）')

  const finalProj = await request('groupProjection', { group: 'pvz-team' }, 15000)
  const devMsgs = (finalProj.publicMessages ?? []).filter((m) => m.actor === 'game-dev')
  check('game-dev 在群组发言（工作输出）', devMsgs.length > 0, `共 ${devMsgs.length} 条`)
  const doneMsg = devMsgs.find((m) => /完成|报告|玩法|文件/.test(m.content))
  check('game-dev 完成报告（含文件/玩法说明）', Boolean(doneMsg), doneMsg?.content.slice(0, 200) ?? '（未找到完成报告）')

  // ---------- 4. 工具与异常深度检查（事件日志） ----------
  const events = existsSync(logFile)
    ? readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
    : []
  const calls = events.filter((e) => e.type === 'tool/call' && e.actor === 'game-dev')
  const results = events.filter((e) => e.type === 'tool/result' && e.actor === 'game-dev')
  const errors = events.filter((e) => e.type === 'request/error' && e.actor === 'game-dev')
  const names = new Set(calls.map((c) => c.name))
  const okCount = results.filter((r) => r.ok).length
  const errCount = results.length - okCount
  console.log(`  工具调用: ${[...names].join(', ') || '（无）'}；成功 ${okCount} / 失败 ${errCount}；request/error ${errors.length} 次`)
  check('game-dev 使用编辑器/写文件工具', names.has('str-replace-editor') || names.has('persistent-bash'), `实际: ${[...names].join(',')}`)
  check('工具成功率 ≥ 60%（无大面积失败）', results.length === 0 || okCount / results.length >= 0.6, `成功 ${okCount}/${results.length}`)
  if (errors.length > 0) {
    for (const e of errors.slice(0, 3)) anomaly('request/error 事件', JSON.stringify(e.errors ?? e).slice(0, 300))
  }
  const failSpeaks = (finalProj.publicMessages ?? []).filter((m) => m.content.includes('[工作失败]'))
  check('投影无 [工作失败]', failSpeaks.length === 0, failSpeaks.map((m) => m.content.slice(0, 120)).join(' | '))

  // ---------- 5. 产物真实验证 ----------
  const found = candidates.find((f) => existsSync(join(space, f))) ?? (await listDir(space)).find((f) => f.toLowerCase().endsWith('.html'))
  // 产物复制到固定目录供人工检查（验证后不随临时目录删除）
  if (found) {
    try {
      const { copyFileSync } = await import('node:fs')
      const outDir = join(root, 'releases', 'pvz-e2e-artifact')
      const { mkdirSync } = await import('node:fs')
      mkdirSync(outDir, { recursive: true })
      copyFileSync(join(space, found), join(outDir, found))
      console.log(`  产物已复制：${join(outDir, found)}`)
    } catch {
      // 复制失败不影响断言
    }
  }
  check('HTML 产物落盘于群组空间', Boolean(found), `候选: ${candidates.join(', ')}`)
  let htmlSize = 0
  let htmlContent = ''
  if (found) {
    htmlSize = statSync(join(space, found)).size
    htmlContent = readFileSync(join(space, found), 'utf8')
    console.log(`  产物: ${found}（${(htmlSize / 1024).toFixed(1)}KB）`)
    check('产物体积合理（≥ 4KB，真实游戏骨架）', htmlSize >= 4096, `${htmlSize}B`)
    check('产物含 Canvas 游戏画布', htmlContent.includes('<canvas') || htmlContent.includes('canvas'), '无 canvas')
    check('产物含植物/僵尸核心元素', /(sun|向日葵|pea|shoot|zombie|plant|僵尸|阳光|豌豆)/i.test(htmlContent), '无核心元素')
    check('产物含交互逻辑（事件监听）', /(addEventListener|onclick|onmousedown|requestAnimationFrame|setInterval)/.test(htmlContent), '无交互逻辑')
    // node --check 自检 JS（提取 <script> 内容）
    const scripts = [...htmlContent.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1])
    if (scripts.length > 0) {
      const js = scripts.join('\n')
      const tmpJs = join(dataDir, '_pvz-check.js')
      const { writeFileSync } = await import('node:fs')
      writeFileSync(tmpJs, js, 'utf8')
      const ok = await runNodeCheck(tmpJs)
      check('内嵌 JS 通过 node --check 语法自检', ok, '（提取脚本语法校验）')
    }
  } else {
    const allFiles = await listDir(space)
    console.log(`  群组空间文件: ${allFiles.join(', ')}`)
  }

  // ---------- 6. group/status 工作状态 ----------
  const status = await request('group/status', { group: 'pvz-team' })
  check('group/status：成员结构完整', status?.members?.length === 3, JSON.stringify(status?.members).slice(0, 200))
  check('group/status：任务摘要已记录', Boolean(status?.taskSummary), `任务: ${status?.taskSummary ?? '无'}`)
  check('group/status：最近活动时间戳存在', typeof status?.lastActivity === 'number' && status.lastActivity > 0)

  // ---------- 7. 记忆机制：归档群组 → 成员经验沉淀 ----------
  await request('archiveGroup', { name: 'pvz-team' })
  const expInfo = await request('experience/info', { agent: 'game-dev' }, 60000)
  check('归档后 game-dev 经验档案写入（记忆机制）', expInfo?.count > 0, `count=${expInfo?.count}`)
  const entries = await request('experience/entries', { agent: 'game-dev' })
  check('experience/entries 可读（记忆面板数据）', Array.isArray(entries) && entries.length > 0)
  const searchHit = await request('experience/search', { agent: 'game-dev', keyword: 'node' })
  console.log(`  记忆条目 ${entries?.length ?? 0} 条；关键词 node 命中 ${searchHit?.length ?? 0} 条`)
  const archived = await request('listArchivedGroups')
  check('归档群组入索引（历史保留）', archived.some((g) => g.name === 'pvz-team'))

  // ---------- 8. 主窗口会话（用户与但丁对话 + 新对话归档） ----------
  const butlerSpeak = nextMessage(ws, (p) => p?.type === 'update' && p?.scope === 'butler' && p?.kind === 'speak', 15000)
  await request('mainWindowSpeak', { content: '请简短介绍你自己，最多两句话。' })
  const bs = await butlerSpeak
  check('主窗口发言 → update(butler) speak 广播', bs?.kind === 'speak')
  const butlerReply = nextMessage(ws, (p) => p?.type === 'update' && p?.scope === 'butler' && p?.kind === 'reply', 120000)
  const br = await butlerReply
  check('但丁真实回复 → update(butler) reply 广播', br?.kind === 'reply', '（真实 DeepSeek）')
  const conv = await request('butler/newConversation', {}, 90000)
  check('新对话归档（会话管理）', String(conv?.id ?? '').startsWith('conv-') || conv?.id === 'current')
  const butlerExp = await request('experience/info', { agent: 'butler' })
  check('但丁经验档案（归档自适总结）', (butlerExp?.count ?? 0) > 0, `count=${butlerExp?.count}`)

  // ---------- 9. 重启恢复：归档群组不恢复 + 名录/经验保留 ----------
  console.log('\n--- 重启恢复验证（停内核 → 同数据目录重启）---')
  ws.close()
  child.kill()
  await new Promise((r) => setTimeout(r, 1200))
  const { child: child2, port: port2, token: token2 } = await startKernel(dataDir)
  const ws2 = await connect(`ws://127.0.0.1:${port2}`)
  let seq2 = 0
  const pending2 = new Map()
  ws2.on('message', (data) => {
    let msg
    try {
      msg = JSON.parse(data.toString('utf8'))
    } catch {
      return
    }
    if (msg.id !== undefined && msg.id !== null && pending2.has(msg.id)) {
      const { resolve, reject, timer } = pending2.get(msg.id)
      pending2.delete(msg.id)
      clearTimeout(timer)
      if (msg.error) reject(new Error(`[${msg.error.code}] ${msg.error.message}`))
      else resolve(msg.result)
    }
  })
  const request2 = (method, params = {}, timeoutMs = 60000) =>
    new Promise((resolve, reject) => {
      const id = ++seq2
      const timer = setTimeout(() => {
        if (pending2.has(id)) {
          pending2.delete(id)
          reject(new Error(`timeout: ${method}`))
        }
      }, timeoutMs)
      pending2.set(id, { resolve, reject, timer })
      ws2.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
    })
  const hello2 = nextMessage(ws2, (p) => p?.name !== undefined, 15000)
  await request2('auth', { token: token2 })
  await hello2
  const groups2 = await request2('listGroups')
  check('重启后归档群组不恢复（listGroups 空）', (groups2 ?? []).length === 0, JSON.stringify(groups2).slice(0, 120))
  const agents2 = await request2('listAgents')
  check('重启后名录保留（game-dev）', agents2.some((a) => a.name === 'game-dev'))
  const exp2 = await request2('experience/info', { agent: 'game-dev' })
  check('重启后经验档案保留（记忆持久化）', (exp2?.count ?? 0) > 0, `count=${exp2?.count}`)
  const archived2 = await request2('listArchivedGroups')
  check('重启后归档索引保留（历史可查）', archived2.some((g) => g.name === 'pvz-team'))
  const butlerProj = await request2('butlerProjection')
  check('重启后主窗口投影可读（但丁会话延续）', Array.isArray(butlerProj?.publicMessages))

  ws2.close()
  child2.kill()

  // ---------- 汇总 ----------
  const elapsed = ((Date.now() - started) / 1000).toFixed(1)
  console.log('\n=== 异常汇总 ===')
  if (anomalies.length === 0) console.log('  （无异常记录）')
  else for (const a of anomalies) console.log(`  ⚠ ${a}`)
  console.log(`\n结果：${passed} 通过 / ${failed} 失败（${elapsed}s）`)
  rmSync(dataDir, { recursive: true, force: true })
  process.exit(failed > 0 ? 1 : 0)
}

function runNodeCheck(file) {
  return new Promise((resolve) => {
    const proc = spawn(process.execPath, ['--check', file], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    proc.stdout.on('data', (d) => (out += d))
    proc.stderr.on('data', (d) => (out += d))
    proc.on('exit', (code) => resolve(code === 0))
    proc.on('error', () => resolve(false))
    setTimeout(() => {
      try { proc.kill() } catch {}
      resolve(false)
    }, 10000)
  })
}

function listDir(dir) {
  return new Promise((resolve) => {
    const { readdirSync } = require('node:fs')
    try {
      resolve(readdirSync(dir))
    } catch {
      resolve([])
    }
  })
}

main().catch((e) => {
  console.error('✗ verify failed:', e.message)
  process.exit(1)
})
