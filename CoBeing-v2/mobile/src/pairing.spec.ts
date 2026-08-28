/**
 * 自动配对客户端（方案 v2）：pair/request 成功/失败/超时 + 设备身份持久化
 */

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { getDeviceId, getDeviceName, pairRequest, setPairWsImplForTest, type WebSocketLike, type WsConstructor } from './pairing'

interface FakeSocket extends WebSocketLike {
  sent: string[]
  serverSend(line: unknown): void
  serverError(): void
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

  serverError(): void {
    this.onerror?.()
  }
}

function installFake(): void {
  FakeWebSocket.instances = []
  setPairWsImplForTest(FakeWebSocket as unknown as WsConstructor)
}

beforeEach(() => {
  installFake()
  localStorage.clear()
  vi.useRealTimers()
})

describe('pairRequest（密钥交换）', () => {
  test('成功：首帧 pair/request → 响应 token 与服务器信息 → 连接关闭', async () => {
    const promise = pairRequest('ws://192.168.1.5:7843', { deviceId: 'dev-abc123', deviceName: '小米手机' })
    const socket = FakeWebSocket.instances[0]
    expect(socket.url).toBe('ws://192.168.1.5:7843')
    socket.serverOpen()
    const req = JSON.parse(socket.sent[0]) as Record<string, unknown>
    expect(req).toMatchObject({ method: 'pair/request', params: { deviceId: 'dev-abc123', deviceName: '小米手机' } })
    socket.serverSend({
      jsonrpc: '2.0',
      id: req.id,
      result: { token: 'server-token', server: { name: '测试电脑', version: '2.0.4', lanUrl: 'ws://192.168.1.5:7843', protocol: 'cobeing-ws/1' } },
    })
    const result = await promise
    expect(result.token).toBe('server-token')
    expect(result.server.lanUrl).toBe('ws://192.168.1.5:7843')
  })

  test('错误响应 → reject（错误码消息）', async () => {
    const promise = pairRequest('ws://192.168.1.5:7843', { deviceId: 'dev-abc123', deviceName: '手机' })
    const socket = FakeWebSocket.instances[0]
    socket.serverOpen()
    const req = JSON.parse(socket.sent[0]) as { id: number }
    socket.serverSend({ jsonrpc: '2.0', id: req.id, error: { code: -32602, message: 'invalid params' } })
    await expect(promise).rejects.toThrow('[-32602] invalid params')
  })

  test('连接错误 → reject', async () => {
    const promise = pairRequest('ws://192.168.1.5:7843', { deviceId: 'dev-abc123', deviceName: '手机' })
    FakeWebSocket.instances[0].serverError()
    await expect(promise).rejects.toThrow(/同一 WiFi/)
  })

  test('无响应 → 30s 超时', async () => {
    vi.useFakeTimers()
    const promise = pairRequest('ws://192.168.1.5:7843', { deviceId: 'dev-abc123', deviceName: '手机' })
    FakeWebSocket.instances[0].serverOpen()
    // 先挂断言再推进时间（避免 unhandled rejection）
    const assertion = expect(promise).rejects.toThrow(/超时/)
    await vi.advanceTimersByTimeAsync(31_000)
    await assertion
    vi.useRealTimers()
  })
})

describe('设备身份', () => {
  test('getDeviceId 生成并持久化（同一设备稳定）', () => {
    const a = getDeviceId()
    const b = getDeviceId()
    expect(a).toBe(b)
    expect(a).toMatch(/^dev-/)
    expect(a.length).toBeGreaterThan(8)
  })

  test('getDeviceName 返回非空名称', () => {
    const name = getDeviceName()
    expect(name.length).toBeGreaterThan(0)
    expect(name.length).toBeLessThanOrEqual(64)
  })
})
