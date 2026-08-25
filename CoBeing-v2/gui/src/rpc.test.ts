import { describe, expect, it, vi, beforeEach } from 'vitest'
import { RpcClient, onKernelNotify, isTauriRuntime } from './rpc'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(),
}))

import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

const invokeMock = vi.mocked(invoke)
const listenMock = vi.mocked(listen)

describe('RpcClient', () => {
  let client: RpcClient

  beforeEach(() => {
    vi.clearAllMocks()
    client = new RpcClient()
  })

  it('request 透传 method 与 params 到 rpc_call', async () => {
    invokeMock.mockResolvedValue({ pong: true })
    const res = await client.request('ping')
    expect(res).toEqual({ pong: true })
    expect(invokeMock).toHaveBeenCalledWith('rpc_call', { method: 'ping', params: {} })
  })

  it('空 params 传空对象', async () => {
    invokeMock.mockResolvedValue(undefined)
    await client.mainWindowSpeak('你好')
    expect(invokeMock).toHaveBeenCalledWith('rpc_call', {
      method: 'mainWindowSpeak',
      params: { content: '你好' },
    })
  })

  it('业务错误（Rust 侧 Err 字符串）抛出 Error', async () => {
    invokeMock.mockRejectedValue('[-32000] group not found: nope')
    await expect(client.speakToGroup('nope', 'user', 'x')).rejects.toThrow('[-32000] group not found: nope')
  })

  it('群组发言携带 mention 与 task', async () => {
    invokeMock.mockResolvedValue(undefined)
    await client.speakToGroup('g', 'user', '干活', { mention: ['writer'], task: '写文档' })
    expect(invokeMock).toHaveBeenCalledWith('rpc_call', {
      method: 'speakToGroup',
      params: { group: 'g', actor: 'user', content: '干活', mention: ['writer'], task: '写文档' },
    })
  })

  it('onKernelNotify 订阅 jsonrpc-notify 并解包 payload', async () => {
    const unlisten = vi.fn()
    const impl = async (_event: string, handler: (e: { payload: unknown }) => void) => {
      handler({ payload: { type: 'text', content: '通知内容' } })
      return unlisten
    }
    listenMock.mockImplementation(impl as unknown as typeof listen)
    const spy = vi.fn()
    const off = await onKernelNotify(spy)
    expect(spy).toHaveBeenCalledWith({ type: 'text', content: '通知内容' })
    expect(listenMock).toHaveBeenCalledWith('jsonrpc-notify', expect.any(Function))
    off()
    expect(unlisten).toHaveBeenCalled()
  })

  it('experienceInfo 携带 agent 参数', async () => {
    invokeMock.mockResolvedValue({ agent: 'butler', count: 3, lastUpdated: 123 })
    const res = await client.experienceInfo('butler')
    expect(res.count).toBe(3)
    expect(invokeMock).toHaveBeenCalledWith('rpc_call', {
      method: 'experience/info',
      params: { agent: 'butler' },
    })
  })

  it('isTauriRuntime 在无 Tauri 全局时为 false', () => {
    expect(isTauriRuntime()).toBe(false)
  })
})
