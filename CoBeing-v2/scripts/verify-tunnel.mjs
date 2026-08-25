#!/usr/bin/env node
/**
 * cloudflared 隧道真实 E2E（方案 v1：外网互联 + 双向不阻塞）
 *
 * - 内核子进程（--remote-port 0）+ cloudflared quick tunnel → https://<随机>.trycloudflare.com
 * - 客户端经 WSS 连隧道：鉴权 → hello → ping → remote/info → mainWindowSpeak → 投影 → notify 广播 → 文件
 * - 流量真实路径：本机 → Cloudflare 边缘 → 本机（外网往返，非 loopback 直连）
 *
 * 用法：node scripts/verify-tunnel.mjs
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(root, 'packages', 'bridge', 'package.json'))
const WebSocket = require('ws')
const dataDir = mkdtempSync(join(tmpdir(), 'cb-verify-tunnel-'))

let passed = 0
let failed = 0
function check(name, cond, detail = '') {
  if (cond) {
    passed++
    console.log(`  ✅ ${name}`)
  } else {
    failed++
    console.log(`  ❌ ${name} ${detail}`)
  }
}

function spawnCollect(cmd, args, opts = {}) {
  const child = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] })
  const out = { stdout: '', stderr: '' }
  child.stdout.on('data', (d) => (out.stdout += d.toString('utf8')))
  child.stderr.on('data', (d) => (out.stderr += d.toString('utf8')))
  return { child, out }
}

function waitFor(pattern, out, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${pattern}. stdout: ${out.stdout.slice(-500)} stderr: ${out.stderr.slice(-500)}`)), timeoutMs)
    const poll = () => {
      const m = pattern.exec(out.stdout + out.stderr)
      if (m) {
        clearTimeout(timer)
        resolve(m)
      } else {
        setTimeout(poll, 200)
      }
    }
    poll()
  })
}

/** DoH 解析 A 记录（阿里 223.5.5.5 直连 IP，绕开被污染的本地 DNS；1.1.1.1 兜底）。新建隧道域名传播有几秒延迟 → 重试 */
async function dohResolveA(hostname) {
  const attempts = [
    `https://223.5.5.5/resolve?name=${encodeURIComponent(hostname)}&type=A`,
    `https://1.1.1.1/dns-query?name=${encodeURIComponent(hostname)}&type=A`,
  ]
  for (let round = 0; round < 6; round++) {
    for (const url of attempts) {
      try {
        const res = await fetch(url, { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(10000) })
        if (!res.ok) continue
        const data = await res.json()
        const ips = (data.Answer ?? []).filter((a) => a.type === 1).map((a) => a.data)
        if (ips.length > 0) return ips[0]
      } catch {
        // 尝试下一个
      }
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error(`DoH 解析失败: ${hostname}`)
}

function connect(url, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    let ws
    const timer = setTimeout(() => {
      ws?.terminate()
      reject(new Error(`connect timeout: ${url}`))
    }, timeoutMs)
    const onOpen = () => {
      clearTimeout(timer)
      resolve(ws)
    }
    const onError = (e) => {
      clearTimeout(timer)
      reject(e)
    }
    const tryDirect = () => {
      ws = new WebSocket(url)
      ws.on('open', onOpen)
      ws.on('error', onError)
    }
    // 本地 DNS 可能屏蔽 trycloudflare（国内运营商常见）→ DoH 拿 IP + SNI/Host 直连
    ws = new WebSocket(url)
    ws.on('open', onOpen)
    ws.on('error', async (e) => {
      if (e && e.code === 'ENOTFOUND') {
        try {
          const parsed = new URL(url)
          const ip = await dohResolveA(parsed.hostname)
          // 保留 wss://域名 原 URL（TLS SNI/证书用域名），lookup 直连 IP（Node all:true 需返回数组）
          ws = new WebSocket(url, {
            lookup: (_hostname, options, callback) => {
              if (options && options.all) callback(null, [{ address: ip, family: 4 }])
              else callback(null, ip, 4)
            },
            headers: { Host: parsed.hostname },
            // 校验脚本：跳过主机名比对（证书链仍验证）；真实 App 走正常 DNS 无此问题
            checkServerIdentity: () => undefined,
          })
          ws.on('open', onOpen)
          ws.on('error', onError)
        } catch (dohError) {
          reject(dohError)
        }
      } else {
        onError(e)
      }
    })
  })
}

function nextMessage(ws, predicate, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMessage)
      reject(new Error('timeout waiting for message'))
    }, timeoutMs)
    const onMessage = (data) => {
      const msg = JSON.parse(data.toString('utf8'))
      if (predicate(msg)) {
        clearTimeout(timer)
        ws.off('message', onMessage)
        resolve(msg)
      }
    }
    ws.on('message', onMessage)
  })
}

let seq = 0
function request(ws, method, params = {}) {
  const id = ++seq
  const reply = nextMessage(ws, (m) => m.id === id)
  ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
  return reply
}

async function main() {
  console.log('=== CoBeing cloudflared 隧道真实 E2E（外网 WSS 全链路） ===')

  // 1. 启动内核（随机端口）
  const kernel = spawnCollect(
    process.execPath,
    [join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'), join(root, 'packages', 'bridge', 'src', 'cli.ts'), '--data', dataDir, '--remote-port', '0'],
    { cwd: root },
  )
  const portMatch = await waitFor(/listening on ws:\/\/127\.0\.0\.1:(\d+)/, kernel.out, 30000)
  const tokenMatch = await waitFor(/token=([^\s]+)/, kernel.out, 5000)
  const port = Number(portMatch[1])
  const token = tokenMatch[1]
  console.log(`内核就绪 ws://127.0.0.1:${port}`)

  // 2. 启动 cloudflared quick tunnel
  const cfExe = join(root, 'tools', 'cloudflared.exe')
  const tunnel = spawnCollect(cfExe, ['tunnel', '--url', `http://127.0.0.1:${port}`, '--no-autoupdate', '--logfile', join(dataDir, 'cf.log')], { cwd: root })
  const urlMatch = await waitFor(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/, tunnel.out, 90000)
  const tunnelUrl = urlMatch[0]
  console.log(`隧道就绪：${tunnelUrl}`)

  try {
    // 3. WSS 连接（经 Cloudflare 边缘）
    const ws = await connect(tunnelUrl)
    console.log('WSS 连接建立（本机 → Cloudflare → 本机）')

    // 4. 鉴权 + hello
    const hello = nextMessage(ws, (m) => m.method === 'hello')
    const bad = await request(ws, 'auth', { token: 'wrong' })
    check('错误 token 被拒（-32001）', bad.error?.code === -32001, JSON.stringify(bad))
    const good = await request(ws, 'auth', { token })
    check('正确 token 鉴权通过', good.result === null)
    const helloMsg = await hello
    check('hello 经隧道到达（协议 cobeing-ws/1）', helloMsg.params?.protocol === 'cobeing-ws/1' && helloMsg.params?.name === 'CoBeing Kernel', JSON.stringify(helloMsg.params))

    // 5. 请求面
    const ping = await request(ws, 'ping')
    check('ping → pong（外网往返）', ping.result?.pong === true, JSON.stringify(ping.result))
    const info = await request(ws, 'remote/info')
    check('remote/info → dataRoot', info.result?.dataRoot === dataDir)
    const panels = await request(ws, 'remote/panels')
    check('remote/panels → quick 面板', Array.isArray(panels.result) && panels.result[0]?.id === 'quick')

    // 6. 主对话发言 + 投影（mock 但丁）
    await request(ws, 'mainWindowSpeak', { content: '隧道测试：汇报状态' })
    await new Promise((r) => setTimeout(r, 2500))
    const proj = await request(ws, 'butlerProjection')
    const hasReply = (proj.result?.publicMessages ?? []).some((m) => m.actor === 'butler')
    check('但丁回复经隧道可见（mock 驱动）', hasReply, JSON.stringify(proj.result?.publicMessages.slice(-1)))

    // 7. notify 广播（双向不阻塞的接收面：服务器主动推送经隧道到达）
    const notify = nextMessage(ws, (m) => m.method === 'notify' && m.params?.type === 'text')
    await request(ws, 'butler/newConversation')
    const notifyMsg = await notify
    check('服务器 notify 经隧道主动推送（双向不阻塞）', typeof notifyMsg.params?.content === 'string', JSON.stringify(notifyMsg.params))

    // 8. 文件浏览经隧道
    const files = await request(ws, 'remote/listFiles', { root: dataDir, path: '' })
    check('remote/listFiles 经隧道可用', Array.isArray(files.result?.entries))

    ws.close()
  } catch (error) {
    failed++
    console.log(`  ❌ 异常：${error.message}`)
  } finally {
    tunnel.child.kill()
    kernel.child.kill()
    await new Promise((r) => setTimeout(r, 800))
    try {
      rmSync(dataDir, { recursive: true, force: true })
    } catch {
      // 忽略
    }
  }

  console.log(`\n结果：${passed} 通过 / ${failed} 失败`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
