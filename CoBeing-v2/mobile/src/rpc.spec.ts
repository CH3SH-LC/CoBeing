/**
 * WS rpc 客户端测试（注入假 WebSocket；协议：auth → hello → 请求/通知对发）
 */

import { describe, expect, test, vi, beforeEach } from 'vitest'
import { WsRpcClient, setWsImplForTest, type WebSocketLike, type WsConstructor } from './rpc'
import {
  deleteProfile,
  getActiveProfile,
  newProfileId,
  normalizeUrl,
  saveProfile,
  setActiveProfileId,
  updateActiveTunnelUrl,
} from './store'
import type { RemoteHello } from './types'

interface FakeSocket extends WebSocketLike {
  sent: string[]
  serverSend(line: unknown): void
  serverClose(): void
  readyState: number
}

class FakeWebSocket implements FakeSocket {
  static instances: FakeWebSocket[] = []
  sent: string[] = []
  readyState = 1
  onopen: (() => void) | null = null
  onclose: ((e: { code?: number; reason?: string }) => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((e: { data: unknown }) => void) | null = null

  constructor(public url: string) {
    FakeWebSocket.instances.push(this)
  }

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {
    this.readyState = 3
  }

  serverOpen(): void {
    this.onopen?.()
  }

  serverSend(line: unknown): void {
    this.onmessage?.({ data: JSON.stringify(line) })
  }

  serverClose(): void {
    this.readyState = 3
    this.onclose?.({ code: 1006 })
  }
}

function installFake(): void {
  FakeWebSocket.instances = []
  setWsImplForTest(FakeWebSocket as unknown as WsConstructor)
}

function lastSent(socket: FakeSocket): Record<string, unknown> {
  return JSON.parse(socket.sent[socket.sent.length - 1]) as Record<string, unknown>
}

function wait(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

beforeEach(() => {
  installFake()
  vi.useRealTimers()
})

describe('WsRpcClient 连接与鉴权', () => {
  test('connect → 首帧 auth → 服务端 hello → status connected', async () => {
    const client = new WsRpcClient()
    const statuses: string[] = []
    client.onStatus((s) => statuses.push(s))
    client.connect('ws://host:7843', 'tok-1')
    const socket = FakeWebSocket.instances[0]
    expect(socket).toBeTruthy()
    socket.serverOpen()
    expect(lastSent(socket)).toMatchObject({ method: 'auth', params: { token: 'tok-1' } })
    socket.serverSend({ jsonrpc: '2.0', id: 0, result: null })
    const hello: RemoteHello = { name: 'CoBeing Kernel', version: '1', dataRoot: 'D:/data', agentCount: 2, protocol: 'cobeing-ws/1' }
    socket.serverSend({ jsonrpc: '2.0', method: 'hello', params: hello })
    await wait()
    expect(client.status).toBe('connected')
    expect(client.hello?.name).toBe('CoBeing Kernel')
  })

  test('request：ping 响应按 id 路由；error 映射为 Error', async () => {
    const client = new WsRpcClient()
    client.connect('ws://h', 't')
    const socket = FakeWebSocket.instances[0]
    socket.serverOpen()
    socket.serverSend({ jsonrpc: '2.0', id: 0, result: null })
    await wait()

    const ping = client.request('ping')
    await wait()
    const req = lastSent(socket)
    expect(req.method).toBe('ping')
    socket.serverSend({ jsonrpc: '2.0', id: req.id, result: { pong: true } })
    await expect(ping).resolves.toEqual({ pong: true })

    const bad = client.request('remote/invoke', {})
    await wait()
    const req2 = lastSent(socket)
    socket.serverSend({ jsonrpc: '2.0', id: req2.id, error: { code: -32001, message: 'unauthorized' } })
    await expect(bad).rejects.toThrow('[-32001] unauthorized')
  })

  test('未连接时 request 拒绝', async () => {
    const client = new WsRpcClient()
    await expect(client.request('ping')).rejects.toThrow('未连接')
  })

  test('notify 到达订阅者；confirm 类型透传', async () => {
    const client = new WsRpcClient()
    const received: unknown[] = []
    client.onNotify((n) => received.push(n))
    client.connect('ws://h', 't')
    const socket = FakeWebSocket.instances[0]
    socket.serverOpen()
    socket.serverSend({ jsonrpc: '2.0', id: 0, result: null })
    await wait()
    socket.serverSend({ jsonrpc: '2.0', method: 'notify', params: { type: 'text', content: 'hi' } })
    socket.serverSend({ jsonrpc: '2.0', method: 'notify', params: { type: 'confirm', id: 'a1', question: '继续?', options: [{ id: 'y', label: '是' }] } })
    await wait()
    expect(received).toHaveLength(2)
    expect((received[1] as { type: string }).type).toBe('confirm')
  })

  test('断线自动重连（指数退避首档 1s）；close 后不再重连', async () => {
    vi.useFakeTimers()
    const client = new WsRpcClient()
    client.connect('ws://h', 't')
    const first = FakeWebSocket.instances[0]
    first.serverOpen()
    first.serverSend({ jsonrpc: '2.0', id: 0, result: null })
    first.serverClose()
    expect(client.status).toBe('reconnecting')
    await vi.advanceTimersByTimeAsync(1100)
    expect(FakeWebSocket.instances.length).toBe(2)
    client.close()
    await vi.advanceTimersByTimeAsync(3000)
    expect(FakeWebSocket.instances.length).toBe(2)
    vi.useRealTimers()
  })

  test('候补地址（方案 v2）：断线重连轮转尝试公网隧道地址', async () => {
    vi.useFakeTimers()
    const client = new WsRpcClient()
    client.connect('ws://lan:7843', 'tok-1', ['wss://tunnel.example.com'])
    const first = FakeWebSocket.instances[0]
    expect(first.url).toBe('ws://lan:7843')
    first.serverOpen()
    first.serverSend({ jsonrpc: '2.0', id: 0, result: null })
    first.serverClose()
    expect(client.status).toBe('reconnecting')
    await vi.advanceTimersByTimeAsync(1100)
    // 第二次连接应尝试候补（公网隧道）
    expect(FakeWebSocket.instances.length).toBe(2)
    expect(FakeWebSocket.instances[1].url).toBe('wss://tunnel.example.com')
    client.close()
    vi.useRealTimers()
  })

  test('候补地址去重：与主地址相同不重复加入', async () => {
    vi.useFakeTimers()
    const client = new WsRpcClient()
    client.connect('ws://lan:7843', 'tok-1', ['ws://lan:7843', 'wss://tunnel.example.com'])
    const first = FakeWebSocket.instances[0]
    first.serverOpen()
    first.serverSend({ jsonrpc: '2.0', id: 0, result: null })
    first.serverClose()
    await vi.advanceTimersByTimeAsync(1100)
    // 只有两个唯一地址：主地址 → 隧道
    expect(FakeWebSocket.instances[1].url).toBe('wss://tunnel.example.com')
    client.close()
    vi.useRealTimers()
  })
})

describe('store 配置持久化', () => {
  test('save/delete/active 往返', () => {
    localStorage.clear()
    const p = { id: newProfileId(), name: '家', url: 'ws://1.2.3.4:7843', token: 'abc' }
    saveProfile(p)
    setActiveProfileId(p.id)
    expect(getActiveProfile()?.name).toBe('家')
    deleteProfile(p.id)
    expect(getActiveProfile()).toBeNull()
    expect(normalizeUrl('192.168.1.5:7843')).toBe('ws://192.168.1.5:7843')
    expect(normalizeUrl('https://x.trycloudflare.com')).toBe('wss://x.trycloudflare.com')
  })

  test('tunnelUrl 持久化往返 + updateActiveTunnelUrl（方案 v2）', () => {
    localStorage.clear()
    const p = { id: newProfileId(), name: '家', url: 'ws://192.168.1.5:7843', token: 'abc' }
    saveProfile(p)
    setActiveProfileId(p.id)
    // 电脑推送隧道地址 → 更新并持久化
    const updated = updateActiveTunnelUrl('https://new-xyz.trycloudflare.com')
    expect(updated?.tunnelUrl).toBe('https://new-xyz.trycloudflare.com')
    expect(getActiveProfile()?.tunnelUrl).toBe('https://new-xyz.trycloudflare.com')
    // 旧配置无 tunnelUrl → undefined 兼容
    deleteProfile(p.id)
    const old = { id: newProfileId(), name: '旧', url: 'ws://x:1', token: 't' }
    saveProfile(old)
    setActiveProfileId(old.id)
    expect(getActiveProfile()?.tunnelUrl).toBeUndefined()
    expect(updateActiveTunnelUrl('https://a.trycloudflare.com')?.tunnelUrl).toBe('https://a.trycloudflare.com')
  })
})
