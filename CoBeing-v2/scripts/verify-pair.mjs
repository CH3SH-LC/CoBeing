#!/usr/bin/env node
/**
 * 自动配对真实 E2E（方案 v2：局域网发现 → 手机确认 → 密钥交换 → 自动公网隧道）
 *
 * 真实子进程 + 真实网络栈，完全模拟手机端视角：
 *   1. UDP scan 广播（真实 dgram）→ 电脑 DiscoveryService 应答 announce（协议/名称/WS 端口/LAN 地址）
 *   2. WS pair/request（真实 ws 客户端）→ 密钥交换返回 token + 服务器信息
 *   3. auth（token）→ hello → ping（配对后标准连接链路）
 *   4. remote/status（stdio 桥）→ 配对记录可见
 *   5. 持久化：重启内核 → remote/status 配对记录保留
 *   6. 可选 --with-tunnel：--auto-tunnel 配对触发真实 cloudflared → notify 收到公网 URL
 *      → 手机侧同款 wss 客户端直连 trycloudflare 域名（真实外网链路；需网络可达）
 *
 * 用法：node scripts/verify-pair.mjs [--with-tunnel]
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import dgram from 'node:dgram'

const withTunnel = process.argv.includes('--with-tunnel')
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(root, 'packages', 'bridge', 'package.json'))
const WebSocket = require('ws')
const dataDir = mkdtempSync(join(tmpdir(), 'cb-verify-pair-'))

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

function startKernel(extraArgs = []) {
  const child = spawn(
    process.execPath,
    [
      join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
      join(root, 'packages', 'bridge', 'src', 'cli.ts'),
      '--data', dataDir,
      '--remote-port', '0',
      '--remote-host', '0.0.0.0',
      ...extraArgs,
    ],
    { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] },
  )
  let stderr = ''
  child.stderr.on('data', (d) => (stderr += d.toString('utf8')))
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`kernel start timeout. stderr: ${stderr}`)), 20000)
    const poll = () => {
      const d = stderr.match(/\[discovery\] listening udp :(\d+)/)
      if (d) {
        clearTimeout(timer)
        resolve({ child, discoveryPort: Number(d[1]), stderr: () => stderr })
      } else {
        setTimeout(poll, 100)
      }
    }
    child.on('exit', (code) => reject(new Error(`kernel exited early: ${code}. stderr: ${stderr}`)))
    poll()
  })
}

/** UDP scan → 返回 announce（模拟手机端 scanLanDevices） */
function udpScan(port) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4')
    const timer = setTimeout(() => {
      socket.close()
      reject(new Error('UDP scan timeout'))
    }, 5000)
    socket.on('message', (msg) => {
      clearTimeout(timer)
      socket.close()
      resolve(JSON.parse(msg.toString('utf8')))
    })
    const payload = Buffer.from(JSON.stringify({ v: 1, type: 'scan', deviceName: '真机测试手机' }))
    // 广播优先（真实路径），回退单播（本机回环兜底）
    socket.send(payload, 0, payload.length, port, '255.255.255.255', () => {
      socket.send(payload, 0, payload.length, port, '127.0.0.1', () => undefined)
    })
  })
}

/** 本地 LAN WS 连接（无污染问题，直连） */
function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    ws.on('open', () => resolve(ws))
    ws.on('error', reject)
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

/** 连接（隧道域名可能被本地 DNS 污染：直连失败 → DoH 拿 IP + lookup/SNI 直连，同 verify-tunnel.mjs） */
function connectTunnel(url, timeoutMs = 60000) {
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
    ws = new WebSocket(url)
    ws.on('open', onOpen)
    ws.on('error', async (e) => {
      // DNS 污染（ENOTFOUND）或 TLS 直连被劫持（socket disconnected）→ DoH 回退
      try {
        const parsed = new URL(url)
        const ip = await dohResolveA(parsed.hostname)
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
        onError(dohError)
      }
    })
  })
}

/** 发送请求并等待响应（按 id 匹配） */

function send(ws, method, params, id) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMessage)
      reject(new Error(`timeout waiting for ${method}`))
    }, 15000)
    const onMessage = (data) => {
      const msg = JSON.parse(data.toString('utf8'))
      if (msg.id === id) {
        clearTimeout(timer)
        ws.off('message', onMessage)
        resolve(msg)
      }
    }
    ws.on('message', onMessage)
    ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
  })
}

/** stdio 桥请求（模拟 GUI） */
function stdioRequest(child, method, params) {
  return new Promise((resolve, reject) => {
    const line = JSON.stringify({ jsonrpc: '2.0', id: 99, method, params: params ?? {} })
    child.stdin.write(line + '\n')
    const timer = setTimeout(() => {
      child.stdout.off('data', onData)
      reject(new Error(`stdio timeout: ${method}`))
    }, 15000)
    const onData = (d) => {
      const text = d.toString('utf8')
      for (const l of text.split('\n')) {
        if (!l.trim()) continue
        let msg
        try {
          msg = JSON.parse(l)
        } catch {
          continue
        }
        if (msg.id === 99) {
          clearTimeout(timer)
          child.stdout.off('data', onData)
          resolve(msg)
          return
        }
      }
    }
    child.stdout.on('data', onData)
  })
}

async function stopKernel(child) {
  if (child && child.exitCode === null) {
    try {
      child.kill()
    } catch {
      // 已退出
    }
    await new Promise((resolve) => child.once('exit', resolve))
  }
}

/** 检测本机代理 TUN 环境（Clash 类 fake-ip：198.18.x.x 网卡）——cloudflared 隧道数据面可能被劫持 */
function detectFakeIpProxy() {
  const interfaces = require('node:os').networkInterfaces()
  const names = Object.keys(interfaces)
  const hasFakeIp = names.some((name) =>
    interfaces[name]?.some((e) => e.address.startsWith('198.18.') || e.address.startsWith('198.19.')),
  )
  return { detected: hasFakeIp, names }
}

async function main() {
  console.log(`CoBeing 自动配对真实 E2E（方案 v2${withTunnel ? ' · 含真实 cloudflared 隧道' : ''}）`)
  console.log('='.repeat(60))

  let kernel = null
  try {
    // ---------- 阶段 1：内核启动（远程 + 发现） ----------
    console.log('\n[1] 内核启动（--remote-port 0 --remote-host 0.0.0.0）')
    kernel = await startKernel(withTunnel ? ['--auto-tunnel'] : [])
    check('内核启动 + 发现服务监听', kernel.discoveryPort > 0, `port=${kernel.discoveryPort}`)

    // ---------- 阶段 2：UDP 发现（模拟手机扫描） ----------
    console.log('\n[2] 局域网发现（真实 UDP scan → announce）')
    const announce = await udpScan(kernel.discoveryPort)
    check('announce 应答：协议', announce?.protocol === 'cobeing-discover/1', JSON.stringify(announce))
    check('announce 应答：服务器名/版本', typeof announce?.name === 'string' && announce?.name.length > 0, announce?.name)
    check('announce 应答：WS 端口 + LAN 地址', announce?.wsPort > 0 && typeof announce?.lanUrl === 'string' && announce.lanUrl.startsWith('ws://'), announce?.lanUrl)
    const wsUrl = announce.lanUrl
    const deviceId = `verify-device-${Date.now().toString(36)}`

    // ---------- 阶段 3：密钥交换（手机确认后 pair/request） ----------
    console.log('\n[3] 密钥交换（WS pair/request）')
    const pairWs = await connect(wsUrl)
    const pairResp = await send(pairWs, 'pair/request', { deviceId, deviceName: '真机测试手机' }, 1)
    check('pair/request 成功（无 error）', pairResp.error === undefined, JSON.stringify(pairResp.error))
    const pairResult = pairResp.result
    check('返回 token（密钥）', typeof pairResult?.token === 'string' && pairResult.token.length >= 16, pairResult?.token?.slice(0, 8))
    check('返回服务器信息（名称/版本/协议）', pairResult?.server?.protocol === 'cobeing-ws/1' && typeof pairResult?.server?.name === 'string', JSON.stringify(pairResult?.server))
    pairWs.close()

    // ---------- 阶段 4：token 走标准连接（auth → hello → ping） ----------
    console.log('\n[4] 配对后标准连接（auth → hello → ping）')
    const authWs = await connect(wsUrl)
    // hello 在 auth 成功后立即下发：先挂监听（不 await）再发 auth（避免错过）
    const helloPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('hello timeout')), 8000)
      const onMessage = (data) => {
        const msg = JSON.parse(data.toString('utf8'))
        if (msg.method === 'hello') {
          clearTimeout(timer)
          authWs.off('message', onMessage)
          resolve(msg.params)
        }
      }
      authWs.on('message', onMessage)
    })
    const authResp = await send(authWs, 'auth', { token: pairResult.token }, 2)
    check('auth 通过', authResp.error === undefined, JSON.stringify(authResp.error))
    const ping = await send(authWs, 'ping', {}, 3)
    check('ping 可达（全协议可用）', ping.result?.pong === true)
    const hello = await helloPromise
    check('hello 携带服务器信息', hello?.protocol === 'cobeing-ws/1', JSON.stringify(hello))

    // ---------- 阶段 5：remote/status 配对记录（GUI 视角） ----------
    console.log('\n[5] remote/status（GUI「手机连接」视角）')
    const status = await stdioRequest(kernel.child, 'remote/status')
    check('remote/status 启用 + LAN 地址', status.result?.enabled === true && typeof status.result?.lanUrl === 'string', JSON.stringify(status.result?.lanUrl))
    check('配对记录包含新设备', Array.isArray(status.result?.pairs) && status.result.pairs.some((p) => p.deviceId === deviceId), JSON.stringify(status.result?.pairs))
    check('token 与配对返回一致', status.result?.token === pairResult.token)
    authWs.close()

    // ---------- 阶段 6：可选——真实 cloudflared 公网隧道 ----------
    if (withTunnel) {
      console.log('\n[6] 自动公网隧道（真实 cloudflared，首次需下载约 50MB）')
      const proxy = detectFakeIpProxy()
      if (proxy.detected) {
        console.log('  ⚠ 检测到代理 TUN 环境（fake-ip 网卡）：', proxy.names.join(', '))
        console.log('    cloudflared 隧道/域名流量可能被代理劫持（隧道注册成功但边缘回连失败：502/530，或 TLS 直连断开）。')
        console.log('    处置：代理软件规则中放行 cloudflared.exe 与 *.trycloudflare.com / *.argotunnel.com 直连，或临时关闭 TUN 模式后重试。')
      }
      const tunnelNotif = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('tunnel notify timeout（cloudflared 下载/注册缓慢？）')), 180000)
        // stdio notify 流监听
        const onData = (d) => {
          const text = d.toString('utf8')
          for (const l of text.split('\n')) {
            if (!l.trim()) continue
            let msg
            try {
              msg = JSON.parse(l)
            } catch {
              continue
            }
            if (msg.method === 'notify' && msg.params?.type === 'tunnel' && msg.params?.action === 'update' && msg.params?.url) {
              clearTimeout(timer)
              kernel.child.stdout.off('data', onData)
              resolve(msg.params.url)
            }
          }
        }
        kernel.child.stdout.on('data', onData)
      })
      check('隧道 notify 收到公网 URL', typeof tunnelNotif === 'string' && tunnelNotif.includes('trycloudflare.com'), tunnelNotif)
      // 手机侧同款 wss 直连隧道（真实外网链路）
      const wssUrl = tunnelNotif.replace(/^https/i, 'wss')
      const tunnelWs = await connect(wssUrl)
      const tunnelAuth = await send(tunnelWs, 'auth', { token: pairResult.token }, 4)
      check('wss 经 Cloudflare 边缘 auth 通过', tunnelAuth.error === undefined, JSON.stringify(tunnelAuth.error))
      const tunnelPing = await send(tunnelWs, 'ping', {}, 5)
      check('wss ping 可达（全双工）', tunnelPing.result?.pong === true)
      tunnelWs.close()
    }

    // ---------- 阶段 7：持久化（重启内核 → 配对记录保留） ----------
    console.log('\n[7] 配对持久化（重启内核）')
    await stopKernel(kernel.child)
    kernel = await startKernel()
    const status2 = await stdioRequest(kernel.child, 'remote/status')
    check('重启后配对记录保留', Array.isArray(status2.result?.pairs) && status2.result.pairs.some((p) => p.deviceId === deviceId), JSON.stringify(status2.result?.pairs))

    // ---------- 阶段 8：错误面（重启后重新发现，端口已变） ----------
    console.log('\n[8] 错误面')
    const announce2 = await udpScan(kernel.discoveryPort)
    const wsUrl2 = announce2.lanUrl
    const badWs = await connect(wsUrl2)
    const bad = await send(badWs, 'pair/request', { deviceName: 'x' }, 6)
    check('pair/request 参数非法 → -32602', bad.error?.code === -32602, JSON.stringify(bad.error))
    const biz = await send(badWs, 'ping', {}, 7)
    check('未鉴权业务请求 → -32001', biz.error?.code === -32001)
    badWs.close()
  } catch (e) {
    failed++
    console.log(`  ❌ 流程中断：${e instanceof Error ? e.message : String(e)}`)
  } finally {
    if (kernel) await stopKernel(kernel.child)
    rmSync(dataDir, { recursive: true, force: true })
  }

  console.log('='.repeat(60))
  console.log(`结果：${passed} 通过 / ${failed} 失败`)
  process.exit(failed > 0 ? 1 : 0)
}

await main()
