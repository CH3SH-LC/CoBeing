#!/usr/bin/env node
/**
 * 内核桥 CLI（bin: cobeing-kernel）
 *
 * - JSON-RPC 2.0 over stdio：stdin 逐行请求，stdout 逐行响应 + 用户通知通知。
 * - 远程 WS（方案 v1）：--remote-port <n> 启动 WebSocket 远程服务器（默认 127.0.0.1；--remote-host 0.0.0.0 供局域网手机直连），
 *   token 默认读/建 <dataRoot>/remote.token（--remote-token 可显式指定）；
 *   --remote-root <dir> 追加远程文件根（可重复）。通知同时广播给已鉴权 WS 连接。
 * - 自动配对（方案 v2）：--remote-port 存在时自动开启局域网发现（--discovery-port <n>，默认 7844；0=关闭），
 *   手机 UDP 扫描发现电脑 → WS pair/request 密钥交换 → 配对记录 <dataRoot>/remote.pairs.json；
 *   --auto-tunnel 配对成功后自动启动 cloudflared 隧道并把公网地址广播给已连接设备。
 * - 用法：tsx packages/bridge/src/cli.ts [--data <dir>] [--remote-port <n>] [--remote-host <ip>] [--remote-token <t>] [--remote-root <dir>] [--discovery-port <n>] [--auto-tunnel] [--server-name <s>]
 * - 顶层 await（ESM）。停止：stop 方法 → kernel.stop + 进程自然退出；stdin EOF → 优雅退出（远程模式下不自杀）。
 */

import { createInterface } from 'node:readline'
import process from 'node:process'
import os from 'node:os'
import { randomBytes } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { NotifyPayload } from '@cobeing/types'
import { Kernel, DeepSeekProvider } from '@cobeing/core'
import { BridgeServer, type BridgeTransport } from './server.js'
import { RemoteServer } from './remote.js'
import { PairingService } from './pairing.js'
import { DiscoveryService, getLanIp } from './discovery.js'
import { TunnelManager } from './tunnel.js'
import { loadModelConfig, pickActiveSource } from './model-config.js'

export interface CliOptions {
  dataRoot: string
  remotePort?: number
  remoteToken?: string
  remoteRoots: string[]
  remoteHost?: string
  /** 局域网发现 UDP 端口（默认 7844；0 = 关闭发现服务） */
  discoveryPort?: number
  /** 配对成功后自动启动 cloudflared 隧道（方案 v2） */
  autoTunnel?: boolean
  /** 广播/配对展示的服务器名（默认本机名） */
  serverName?: string
}

function parseArgs(argv: string[]): CliOptions {
  let dataRoot = process.env.COBEING_DATA_ROOT ?? './data'
  let remotePort: number | undefined
  let remoteToken: string | undefined
  let remoteHost: string | undefined
  let discoveryPort: number | undefined
  let autoTunnel: boolean | undefined
  let serverName: string | undefined
  const remoteRoots: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--data') {
      dataRoot = argv[++i] || dataRoot
    } else if (arg?.startsWith('--data=')) {
      const value = arg.slice('--data='.length)
      if (value) dataRoot = value
    } else if (arg === '--remote-port') {
      const value = Number(argv[++i])
      // 0 = 随机端口（测试用）；有效范围 0-65535
      if (Number.isInteger(value) && value >= 0 && value < 65536) remotePort = value
    } else if (arg?.startsWith('--remote-port=')) {
      const value = Number(arg.slice('--remote-port='.length))
      if (Number.isInteger(value) && value >= 0 && value < 65536) remotePort = value
    } else if (arg === '--remote-host') {
      remoteHost = argv[++i]
    } else if (arg?.startsWith('--remote-host=')) {
      remoteHost = arg.slice('--remote-host='.length)
    } else if (arg === '--remote-token') {
      remoteToken = argv[++i]
    } else if (arg?.startsWith('--remote-token=')) {
      remoteToken = arg.slice('--remote-token='.length)
    } else if (arg === '--remote-root') {
      const value = argv[++i]
      if (value) remoteRoots.push(value)
    } else if (arg?.startsWith('--remote-root=')) {
      const value = arg.slice('--remote-root='.length)
      if (value) remoteRoots.push(value)
    } else if (arg === '--discovery-port') {
      const value = Number(argv[++i])
      if (Number.isInteger(value) && value >= 0 && value < 65536) discoveryPort = value
    } else if (arg?.startsWith('--discovery-port=')) {
      const value = Number(arg.slice('--discovery-port='.length))
      if (Number.isInteger(value) && value >= 0 && value < 65536) discoveryPort = value
    } else if (arg === '--auto-tunnel') {
      autoTunnel = true
    } else if (arg === '--server-name') {
      serverName = argv[++i]
    } else if (arg?.startsWith('--server-name=')) {
      serverName = arg.slice('--server-name='.length)
    }
  }
  return { dataRoot, remotePort, remoteToken, remoteRoots, remoteHost, discoveryPort, autoTunnel, serverName }
}

/** 读取或创建远程 token（<dataRoot>/remote.token）；创建时打印到 stderr（stdout 是协议通道，不能污染） */
async function loadOrCreateToken(dataRoot: string, explicit?: string): Promise<string> {
  if (explicit) return explicit
  const file = join(dataRoot, 'remote.token')
  try {
    const existing = (await readFile(file, 'utf8')).trim()
    if (existing) return existing
  } catch {
    // 不存在 → 创建
  }
  const token = randomBytes(24).toString('base64url')
  await mkdir(dataRoot, { recursive: true })
  await writeFile(file, token, { mode: 0o600 })
  process.stderr.write(`[remote] token file created: ${file}\n`)
  return token
}

/** 读取或创建服务器实例 id（<dataRoot>/server.id；发现广播/去重用） */
async function loadOrCreateServerId(dataRoot: string): Promise<string> {
  const file = join(dataRoot, 'server.id')
  try {
    const existing = (await readFile(file, 'utf8')).trim()
    if (existing) return existing
  } catch {
    // 不存在 → 创建
  }
  const id = randomBytes(8).toString('hex')
  await mkdir(dataRoot, { recursive: true })
  await writeFile(file, id)
  return id
}

export async function main(options: CliOptions = parseArgs(process.argv.slice(2))): Promise<void> {
  const { dataRoot } = options
  // 模型配置：GUI 设置界面写入的 model-config.json（多来源，取 active）优先；缺省字段回退环境变量
  const fileCfg = await loadModelConfig(dataRoot)
  const active = pickActiveSource(fileCfg)
  const apiKey = active?.api_key ?? process.env.DEEPSEEK_API_KEY
  const hasKey = Boolean(apiKey)

  // 远程服务器（kernel 构造后、start 前创建；通知广播闭包引用）
  let remote: RemoteServer | undefined
  let pairing: PairingService | undefined
  let discovery: DiscoveryService | undefined
  let tunnel: TunnelManager | undefined
  let remotePort = 0
  let lanUrl = ''

  // 通知出口：stdout 行协议 + 已鉴权 WS 广播（同一通知双发，双向不阻塞）
  const notifyUser = (payload: NotifyPayload): void => {
    writeLine(JSON.stringify({ jsonrpc: '2.0', method: 'notify', params: payload }))
    remote?.broadcast(payload)
  }

  const kernel = new Kernel(dataRoot, {
    providers: hasKey
      ? [new DeepSeekProvider({ apiKey, baseUrl: active?.base_url, model: active?.model })]
      : [],
    // 但丁默认 provider/model：真实 key 存在用 deepseek，否则 mock
    butlerProvider: hasKey ? 'deepseek' : 'mock',
    butlerModel: hasKey ? (active?.model ?? 'deepseek-v4-flash') : 'mock-model',
    remoteRoots: options.remoteRoots,
    notifyUser,
  })

  const stdioTransport: BridgeTransport = {
    send(line: string): void {
      writeLine(line)
    },
    onLine(cb: (line: string) => void): () => void {
      const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
      rl.on('line', cb)
      rl.on('close', () => {
        // stdin EOF（Ctrl-D / 管道关闭）→ 优雅停止。
        // 远程 WS 模式（--remote-port）下进程是网络服务器：stdin 可能天然关闭
        // （如 stdio 'ignore' 启动/后台运行），此时不自动停止，避免启动即自杀。
        if (options.remotePort === undefined) {
          void kernel.stop()
        }
      })
      return () => rl.close()
    },
  }

  const server = new BridgeServer(kernel, stdioTransport)
  // stop 方法已在内核侧执行 kernel.stop()；关闭远程服务器后自然退出
  server.setOnStop(() => {
    void remote?.stop()
    void discovery?.stop()
    void tunnel?.stop()
  })

  // 先启动内核（含 working 群组恢复），再开放远程 WS 服务——
  // 否则客户端在恢复完成前查询 listGroups 会看到空列表（启动竞态，verify-sync 并行负载下复现）
  await kernel.start()
  server.noteKernelStarted()

  // 远程 WS 服务器（可选）
  if (options.remotePort !== undefined) {
    const token = await loadOrCreateToken(dataRoot, options.remoteToken)
    const host = options.remoteHost ?? '127.0.0.1'
    // 局域网地址：绑定 0.0.0.0 时用实际网卡 IP（手机直连用）
    const lanIp = host === '0.0.0.0' ? getLanIp() : host
    const serverId = await loadOrCreateServerId(dataRoot)
    const serverName = options.serverName ?? os.hostname() ?? 'CoBeing 电脑'

    const pairingService = new PairingService({
      dataRoot,
      token,
      name: serverName,
      version: '2.0.4',
      lanUrl,
      onPaired: (record) => {
        notifyUser({ type: 'pair', action: 'paired', deviceName: record.deviceName })
        process.stderr.write(`[pair] paired: ${record.deviceName} (${record.deviceId})\n`)
        // 配对成功 → 自动构建公网隧道（方案 v2 核心：手机确认后自动 cloudflared）
        if (options.autoTunnel && tunnel && !tunnel.running) {
          void tunnel
            .start()
            .then(({ url }) => {
              notifyUser({ type: 'tunnel', action: 'update', url })
              process.stderr.write(`[tunnel] ready: ${url}\n`)
            })
            .catch((error) => {
              notifyUser({ type: 'tunnel', action: 'error', message: String(error instanceof Error ? error.message : error) })
              process.stderr.write(`[tunnel] error: ${String(error)}\n`)
            })
        }
      },
      onRevoked: (deviceId, deviceName) => {
        notifyUser({ type: 'pair', action: 'revoked', deviceName })
        process.stderr.write(`[pair] revoked: ${deviceName} (${deviceId})\n`)
      },
    })
    pairing = pairingService

    remote = new RemoteServer({ kernel, port: options.remotePort, token, host, pairing: pairingService })
    const started = await remote.start()
    remotePort = started.port
    lanUrl = `ws://${lanIp}:${remotePort}`
    // 配对应答里的 LAN 地址（remote 启动后才确定实际端口）
    pairingService.setLanUrl(lanUrl)
    process.stderr.write(
      `[remote] listening on ws://${host}:${remotePort} (LAN: ws://<电脑IP>:${remotePort}; 外网: cloudflared 隧道 + wss)\n`,
    )
    process.stderr.write(`[remote] token=${token}\n`)
    if (options.remoteRoots.length > 0) {
      process.stderr.write(`[remote] extra roots: ${options.remoteRoots.join(', ')}\n`)
    }

    // 局域网发现服务（方案 v2）：手机 UDP 扫描 → 应答；默认 7844
    const discoveryPort = options.discoveryPort ?? 7844
    if (discoveryPort > 0 && host !== '127.0.0.1') {
      try {
        const discoveryService = new DiscoveryService({
          port: discoveryPort,
          id: serverId,
          name: serverName,
          version: '2.0.4',
          wsPort: remotePort,
          host: lanIp,
        })
        await discoveryService.start()
        discoveryService.startBroadcastLoop()
        discovery = discoveryService
        process.stderr.write(`[discovery] listening udp :${discoveryPort} (cobeing-discover/1)\n`)
      } catch (error) {
        // 发现端口被占用 → 降级为仅 WS（不阻断远程互联；GUI 设置页可见提示）
        process.stderr.write(`[discovery] failed to bind udp :${discoveryPort}（${String(error)}）；跳过局域网发现\n`)
      }
    }

    // 隧道管理器（配对成功时按需启动；GUI 传 --auto-tunnel 启用）
    tunnel = new TunnelManager({
      port: remotePort,
      toolsDir: join(process.cwd(), 'tools'),
      onLog: (line) => process.stderr.write(`[cloudflared] ${line}\n`),
    })

    // 桥方法 remote/status：GUI「手机连接」设置条目读取发现/配对/隧道状态
    server.registerExtra('remote/status', () => ({
      enabled: true,
      port: remotePort,
      host,
      lanUrl,
      discoveryPort: discoveryPort > 0 && host !== '127.0.0.1' ? discoveryPort : null,
      tunnelUrl: tunnel?.tunnelUrl ?? null,
      tunnelRunning: tunnel?.running ?? false,
      pairs: pairingService.list(),
      token,
    }))
    // 撤销配对（GUI「手机连接」条目操作）
    server.registerExtra('pair/revoke', (params) => {
      const deviceId = isObject(params) && typeof params.deviceId === 'string' ? params.deviceId : ''
      if (!deviceId) throw new Error('invalid params: deviceId is required')
      return pairingService.revoke(deviceId)
    })
  } else {
    // 未开远程：remote/status 返回禁用态（GUI 兼容）
    server.registerExtra('remote/status', () => ({
      enabled: false,
      port: null,
      host: null,
      lanUrl: null,
      discoveryPort: null,
      tunnelUrl: null,
      tunnelRunning: false,
      pairs: [],
      token: null,
    }))
  }

  // 开始逐行处理（CLI 侧直启，故标记 started 防 start RPC 重复启动）
  server.start()
}

function writeLine(line: string): void {
  // 保证单行输出（防御：内容中裸换行替换为空格，避免破坏行协议）
  process.stdout.write(line.replace(/\r?\n/g, ' ') + '\n')
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export { writeLine }

// bin 直接运行：顶层 await 装配并启动（ESM）
await main()
