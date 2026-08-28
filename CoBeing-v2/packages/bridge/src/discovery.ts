/**
 * 局域网发现服务（方案 v2：自动配对 · cobeing-discover/1）
 *
 * - 手机 app 广播 `scan` 帧到 255.255.255.255:<port> → 本服务收到后单播应答 `announce`
 *   （携带服务器名/版本/WS 端口/LAN 地址），手机据此展示可配对设备，无需手动输入 IP。
 * - 本服务另以固定间隔主动广播 `announce`（供手机被动监听展示；间隔 0 = 关闭主动广播）。
 * - 纯 UDP 单帧 JSON（无连接、无状态），端口默认 7844。
 */

import dgram, { type Socket } from 'node:dgram'
import os from 'node:os'

export const DISCOVERY_PORT = 7844
export const DISCOVERY_PROTOCOL = 'cobeing-discover/1'

/** 广播地址（IPv4 受限广播；部分路由器隔离 AP 时可能不可达，手机侧以扫描为主） */
export const BROADCAST_ADDR = '255.255.255.255'

export interface DiscoveryAnnounce {
  v: 1
  type: 'announce'
  protocol: typeof DISCOVERY_PROTOCOL
  /** 服务器实例 id（配对持久化/去重用） */
  id: string
  /** 服务器显示名（电脑名） */
  name: string
  version: string
  /** 远程 WS 端口（内核 --remote-port 实际端口） */
  wsPort: number
  /** 局域网 IP（手机直连用） */
  host: string
  /** 完整局域网 WS 地址（手机配对后直连） */
  lanUrl: string
}

interface ScanFrame {
  v: number
  type: 'scan'
}

export interface DiscoveryServiceOptions {
  port?: number
  /** 主动广播间隔 ms；0 = 不主动广播（仅应答扫描） */
  broadcastIntervalMs?: number
  id: string
  name: string
  version: string
  wsPort: number
  host: string
  /** 收到 scan 请求时回调（日志/统计用） */
  onScan?: (rinfo: { address: string; port: number }) => void
}

export class DiscoveryService {
  private socket: Socket | undefined
  private stopped = false
  private timer: ReturnType<typeof setInterval> | undefined
  private readonly port: number

  constructor(private opts: DiscoveryServiceOptions) {
    this.port = opts.port ?? DISCOVERY_PORT
  }

  start(): Promise<{ port: number }> {
    return new Promise((resolve, reject) => {
      if (this.stopped) {
        reject(new Error('DiscoveryService already stopped'))
        return
      }
      const socket = dgram.createSocket('udp4')
      this.socket = socket
      socket.on('error', (error) => reject(error))
      socket.on('listening', () => {
        const address = socket.address()
        resolve({ port: address.port })
      })
      socket.on('message', (msg, rinfo) => this.handleMessage(msg, rinfo))
      socket.bind(this.port)
    })
  }

  /** 发送 announce 帧（主动广播用独立临时 socket，避免收到自己的广播） */
  announce(): void {
    const frame = this.buildAnnounce()
    const payload = Buffer.from(JSON.stringify(frame))
    const sender = dgram.createSocket('udp4')
    // setBroadcast 需在绑定后调用（未绑定即调用在 Windows 上抛 EBADF）
    sender.on('listening', () => {
      try {
        sender.setBroadcast(true)
      } catch {
        // 广播不可用（无网络）→ 放弃主动广播
      }
      sender.send(payload, 0, payload.length, this.port, BROADCAST_ADDR, () => {
        try {
          sender.close()
        } catch {
          // 已关闭
        }
      })
    })
    sender.on('error', () => {
      try {
        sender.close()
      } catch {
        // 已关闭
      }
    })
    sender.bind(0)
  }

  /** 启动周期主动广播（stop 时自动清理） */
  startBroadcastLoop(): void {
    if (this.opts.broadcastIntervalMs === 0 || this.timer) return
    const interval = this.opts.broadcastIntervalMs ?? 30_000
    this.timer = setInterval(() => {
      if (!this.stopped) this.announce()
    }, interval)
    this.timer.unref?.()
  }

  async stop(): Promise<void> {
    this.stopped = true
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = undefined
    }
    const socket = this.socket
    this.socket = undefined
    if (!socket) return
    await new Promise<void>((resolvePromise) => {
      try {
        socket.close(() => resolvePromise())
      } catch {
        resolvePromise()
      }
    })
  }

  // ---------- 内部 ----------

  private buildAnnounce(): DiscoveryAnnounce {
    return {
      v: 1,
      type: 'announce',
      protocol: DISCOVERY_PROTOCOL,
      id: this.opts.id,
      name: this.opts.name,
      version: this.opts.version,
      wsPort: this.opts.wsPort,
      host: this.opts.host,
      lanUrl: `ws://${this.opts.host}:${this.opts.wsPort}`,
    }
  }

  private handleMessage(msg: Buffer, rinfo: dgram.RemoteInfo): void {
    let frame: ScanFrame
    try {
      frame = JSON.parse(msg.toString('utf8')) as ScanFrame
    } catch {
      return // 非本协议帧，忽略
    }
    if (frame?.v !== 1 || frame?.type !== 'scan') return
    this.opts.onScan?.({ address: rinfo.address, port: rinfo.port })
    // 单播应答到扫描者（源地址:源端口）——不依赖对方监听固定端口
    const payload = Buffer.from(JSON.stringify(this.buildAnnounce()))
    this.socket?.send(payload, 0, payload.length, rinfo.port, rinfo.address, () => undefined)
  }
}

/** 枚举本机 LAN IPv4（优先物理网卡；跳过虚拟/回环/APIPA/fake-ip） */
export function getLanIp(): string {
  const interfaces = os.networkInterfaces()
  const candidates: string[] = []
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4' || entry.internal) continue
      const ip = entry.address
      if (ip.startsWith('169.254.') || ip.startsWith('198.18.') || ip.startsWith('127.')) continue
      candidates.push(ip)
    }
  }
  if (candidates.length === 0) return '127.0.0.1'
  // 优先真实网卡（非 Virtual/TAP/TUN/WireGuard/Wintun）——与 remote.ps1 策略一致
  const real = candidates.find((ip) => !/virtual|tap|tun|wireguard|wintun/i.test(findAdapterName(ip)))
  return real ?? candidates[0]
}

function findAdapterName(ip: string): string {
  const interfaces = os.networkInterfaces()
  for (const [name, entries] of Object.entries(interfaces)) {
    if (entries?.some((e) => e.address === ip)) return name
  }
  return ''
}
