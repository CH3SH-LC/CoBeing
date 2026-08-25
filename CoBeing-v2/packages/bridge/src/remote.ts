/**
 * 远程 WebSocket 服务器（方案 v1：手机端/远程控制面）
 *
 * - 复用 BridgeServer（transport 无关）：每个已鉴权连接 = 一个 BridgeServer + WS transport。
 * - 鉴权：连接后第一帧必须是 `auth {token}`；未鉴权其他方法一律 -32001。
 * - 鉴权成功 → 服务端发 `hello`（method:'hello'）携带服务器信息；此后双向 JSON-RPC。
 * - 服务端 → 客户端主动消息：broadcast() 发 `{jsonrpc:'2.0', method:'notify', params}`（与 stdio 通知同 shape）。
 * - 全双工不阻塞：请求/通知对发，无轮询。
 */

import { WebSocketServer, WebSocket } from 'ws'
import type { Kernel } from '@cobeing/core'
import type { NotifyPayload } from '@cobeing/types'
import { BridgeServer, type BridgeTransport } from './server.js'

const ERR_UNAUTHORIZED = -32001

export interface RemoteServerOptions {
  kernel: Kernel
  port: number
  token: string
  /** 监听地址（默认 127.0.0.1 仅本机/cloudflared；LAN 模式传 0.0.0.0 供手机直连，token 鉴权兜底） */
  host?: string
}

/** 鉴权成功后服务端下发的 hello 载荷 */
export interface RemoteHello {
  name: string
  version: string
  dataRoot: string
  agentCount: number
  protocol: 'cobeing-ws/1'
}

export class RemoteServer {
  private wss: WebSocketServer | undefined
  /** 全部连接（含未鉴权；stop 时全部关闭） */
  private sockets = new Set<WebSocket>()
  private authed = new Set<WebSocket>()
  private bridges = new Map<WebSocket, BridgeServer>()
  private stopped = false

  constructor(private opts: RemoteServerOptions) {}

  /** 监听 host:<port>；返回实际端口（0=随机） */
  start(): Promise<{ port: number }> {
    return new Promise((resolvePromise, reject) => {
      if (this.stopped) {
        reject(new Error('RemoteServer already stopped'))
        return
      }
      const wss = new WebSocketServer({ host: this.opts.host ?? '127.0.0.1', port: this.opts.port })
      this.wss = wss
      wss.on('error', (error) => reject(error))
      wss.on('listening', () => {
        const address = wss.address()
        const port = typeof address === 'object' && address ? address.port : this.opts.port
        resolvePromise({ port })
      })
      wss.on('connection', (ws) => this.handleConnection(ws))
    })
  }

  async stop(): Promise<void> {
    this.stopped = true
    for (const ws of [...this.sockets]) {
      this.disposeConnection(ws)
    }
    this.sockets.clear()
    this.authed.clear()
    const wss = this.wss
    this.wss = undefined
    if (!wss) return
    await new Promise<void>((resolvePromise) => {
      wss.close(() => resolvePromise())
      // 防御：close 等待所有连接关闭；已全部 dispose，正常立即回调
      setTimeout(resolvePromise, 1000).unref?.()
    })
  }

  get clientCount(): number {
    return this.authed.size
  }

  /** 向所有已鉴权连接广播 notify（与 CLI stdout 通知同 shape） */
  broadcast(payload: NotifyPayload): void {
    if (this.authed.size === 0) return
    const line = JSON.stringify({ jsonrpc: '2.0', method: 'notify', params: payload })
    for (const ws of this.authed) {
      if (ws.readyState === WebSocket.OPEN) ws.send(line)
    }
  }

  // ---------- 连接处理 ----------

  private handleConnection(ws: WebSocket): void {
    this.sockets.add(ws)
    let authed = false
    let bridge: BridgeServer | undefined
    ws.on('message', (data) => {
      const line = data.toString('utf8')
      // 首帧（或未鉴权任何帧）：只接受 auth
      if (!authed) {
        const request = tryParse(line)
        if (request && request.method === 'auth') {
          const params = request.params as { token?: unknown } | undefined
          const token = typeof params?.token === 'string' ? params.token : ''
          if (token && token === this.opts.token) {
            authed = true
            this.authed.add(ws)
            // 延迟创建 BridgeServer（鉴权后才进入协议路由）
            bridge = new BridgeServer(this.opts.kernel, {
              send: (l) => {
                if (ws.readyState === WebSocket.OPEN) ws.send(l)
              },
              onLine: (cb) => {
                ws.on('message', (d) => cb(d.toString('utf8')))
                return () => undefined
              },
            } satisfies BridgeTransport)
            bridge.start()
            this.bridges.set(ws, bridge)
            ws.send(JSON.stringify({ jsonrpc: '2.0', id: request.id ?? null, result: null }))
            ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'hello', params: this.helloPayload() }))
            return
          }
          ws.send(JSON.stringify({ jsonrpc: '2.0', id: request.id ?? null, error: { code: ERR_UNAUTHORIZED, message: 'unauthorized' } }))
          return
        }
        // 未鉴权非 auth 帧：拒绝
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: request?.id ?? null, error: { code: ERR_UNAUTHORIZED, message: 'unauthorized' } }))
        return
      }
      // 已鉴权：转发给 BridgeServer（onLine 已绑定消息监听，这里不再处理）
      void bridge
    })
    ws.on('close', () => {
      this.sockets.delete(ws)
      this.authed.delete(ws)
      const b = this.bridges.get(ws)
      if (b) {
        b.stop()
        this.bridges.delete(ws)
      }
    })
    ws.on('error', () => undefined)
  }

  private disposeConnection(ws: WebSocket): void {
    this.authed.delete(ws)
    const b = this.bridges.get(ws)
    if (b) {
      b.stop()
      this.bridges.delete(ws)
    }
    try {
      ws.close()
    } catch {
      // 已关闭
    }
  }

  private helloPayload(): RemoteHello {
    const info = this.opts.kernel.remoteControl.info()
    let agentCount = 0
    try {
      agentCount = this.opts.kernel.registry.listAgents().length
    } catch {
      // 名录未加载：0
    }
    return {
      name: info.name,
      version: info.version,
      dataRoot: info.dataRoot,
      agentCount,
      protocol: 'cobeing-ws/1',
    }
  }
}

function tryParse(line: string): { id?: number | string | null; method?: string; params?: unknown } | undefined {
  try {
    const parsed = JSON.parse(line) as { id?: number | string | null; method?: string; params?: unknown }
    return parsed
  } catch {
    return undefined
  }
}
