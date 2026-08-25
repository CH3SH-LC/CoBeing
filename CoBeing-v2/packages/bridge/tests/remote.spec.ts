/**
 * 远程 WS 服务器（方案 v1）：真实 ws 客户端连接真实 Kernel
 *
 * - 鉴权：错 token → -32001；未鉴权请求 → -32001；正确 auth → hello + 全协议可用
 * - 全双工：广播 notify 到达所有已鉴权连接；stop 后连接关闭
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import WebSocket from 'ws'
import { Kernel } from '@cobeing/core'
import { RemoteServer } from '../src/remote.js'

interface Ctx {
  kernel: Kernel
  remote: RemoteServer
  url: string
  dir: string
}

const contexts: Ctx[] = []

async function makeCtx(): Promise<Ctx> {
  const dir = mkdtempSync(join(tmpdir(), 'cb-remote-bridge-'))
  const kernel = new Kernel(dir, { mockResponder: () => 'mock reply' })
  await kernel.start()
  const remote = new RemoteServer({ kernel, port: 0, token: 'secret-token' })
  const { port } = await remote.start()
  contexts.push({ kernel, remote, url: `ws://127.0.0.1:${port}`, dir })
  return contexts[contexts.length - 1]
}

afterEach(async () => {
  for (const ctx of contexts.splice(0)) {
    await ctx.remote.stop().catch(() => undefined)
    await ctx.kernel.stop().catch(() => undefined)
    rmSync(ctx.dir, { recursive: true, force: true })
  }
})

/** 等待下一条满足 predicate 的消息（JSON 解析后） */
function nextMessage(
  ws: WebSocket,
  predicate: (m: Record<string, any>) => boolean,
  timeoutMs = 8000,
): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMessage)
      reject(new Error('timeout waiting for message'))
    }, timeoutMs)
    const onMessage = (data: Buffer) => {
      const msg = JSON.parse(data.toString('utf8')) as Record<string, any>
      if (predicate(msg)) {
        clearTimeout(timer)
        ws.off('message', onMessage)
        resolve(msg)
      }
    }
    ws.on('message', onMessage)
  })
}

function send(ws: WebSocket, method: string, params: unknown, id: number): void {
  ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
}

describe('RemoteServer 鉴权', () => {
  test('错误 token → auth 响应 -32001；未鉴权 ping → -32001', async () => {
    const ctx = await makeCtx()
    const ws = new WebSocket(ctx.url)
    await new Promise((resolve, reject) => {
      ws.on('open', resolve)
      ws.on('error', reject)
    })
    const authReply = nextMessage(ws, (m) => m.id === 1)
    send(ws, 'auth', { token: 'wrong' }, 1)
    const auth = await authReply
    expect(auth.error?.code).toBe(-32001)

    const pingReply = nextMessage(ws, (m) => m.id === 2)
    send(ws, 'ping', {}, 2)
    const ping = await pingReply
    expect(ping.error?.code).toBe(-32001)

    ws.close()
  })

  test('正确 auth → hello（cobeing-ws/1）+ ping 全协议可用', async () => {
    const ctx = await makeCtx()
    const ws = new WebSocket(ctx.url)
    await new Promise((resolve, reject) => {
      ws.on('open', resolve)
      ws.on('error', reject)
    })
    const hello = nextMessage(ws, (m) => m.method === 'hello')
    const authReply = nextMessage(ws, (m) => m.id === 1)
    send(ws, 'auth', { token: 'secret-token' }, 1)
    const auth = await authReply
    expect(auth.result).toBeNull()
    const helloMsg = await hello
    expect(helloMsg.params?.protocol).toBe('cobeing-ws/1')
    expect(helloMsg.params?.name).toBe('CoBeing Kernel')

    const pingReply = nextMessage(ws, (m) => m.id === 2)
    send(ws, 'ping', {}, 2)
    const ping = await pingReply
    expect(ping.result?.pong).toBe(true)

    const infoReply = nextMessage(ws, (m) => m.id === 3)
    send(ws, 'remote/info', {}, 3)
    const info = await infoReply
    expect(info.result?.name).toBe('CoBeing Kernel')
    expect(info.result?.dataRoot).toBe(ctx.dir)

    ws.close()
  })
})

describe('RemoteServer 广播（双向不阻塞）', () => {
  test('notify 广播到达所有已鉴权连接；clientCount 正确', async () => {
    const ctx = await makeCtx()
    const wsA = new WebSocket(ctx.url)
    const wsB = new WebSocket(ctx.url)
    await Promise.all([
      new Promise((resolve, reject) => {
        wsA.on('open', resolve)
        wsA.on('error', reject)
      }),
      new Promise((resolve, reject) => {
        wsB.on('open', resolve)
        wsB.on('error', reject)
      }),
    ])
    const authA = nextMessage(wsA, (m) => m.id === 1)
    const authB = nextMessage(wsB, (m) => m.id === 1)
    send(wsA, 'auth', { token: 'secret-token' }, 1)
    send(wsB, 'auth', { token: 'secret-token' }, 1)
    await Promise.all([authA, authB])
    expect(ctx.remote.clientCount).toBe(2)

    const notifyA = nextMessage(wsA, (m) => m.method === 'notify')
    const notifyB = nextMessage(wsB, (m) => m.method === 'notify')
    ctx.remote.broadcast({ type: 'text', content: 'hello from server' })
    const [na, nb] = await Promise.all([notifyA, notifyB])
    expect(na.params?.content).toBe('hello from server')
    expect(nb.params?.content).toBe('hello from server')

    // 关闭一个连接后 clientCount 下降
    wsB.close()
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(ctx.remote.clientCount).toBe(1)
    wsA.close()
  })

  test('remote/panels 经 WS 可用（quick 面板）', async () => {
    const ctx = await makeCtx()
    const ws = new WebSocket(ctx.url)
    await new Promise((resolve, reject) => {
      ws.on('open', resolve)
      ws.on('error', reject)
    })
    const authReply = nextMessage(ws, (m) => m.id === 1)
    send(ws, 'auth', { token: 'secret-token' }, 1)
    await authReply
    const panelsReply = nextMessage(ws, (m) => m.id === 2)
    send(ws, 'remote/panels', {}, 2)
    const panels = await panelsReply
    expect(Array.isArray(panels.result)).toBe(true)
    expect(panels.result[0].id).toBe('quick')
    ws.close()
  })
})

describe('RemoteServer 生命周期', () => {
  test('stop() 关闭服务器并断开已连接客户端', async () => {
    const ctx = await makeCtx()
    const ws = new WebSocket(ctx.url)
    await new Promise((resolve, reject) => {
      ws.on('open', resolve)
      ws.on('error', reject)
    })
    const closed = new Promise<void>((resolve) => ws.on('close', () => resolve()))
    await ctx.remote.stop()
    await closed
  })

  test('host 0.0.0.0：手机直连路径（127.0.0.1 客户端可连入）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cb-remote-host-'))
    const kernel = new Kernel(dir, { mockResponder: () => 'x' })
    await kernel.start()
    const remote = new RemoteServer({ kernel, port: 0, token: 't', host: '0.0.0.0' })
    const { port } = await remote.start()
    contexts.push({ kernel, remote, url: `ws://127.0.0.1:${port}`, dir })
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    await new Promise((resolve, reject) => {
      ws.on('open', resolve)
      ws.on('error', reject)
    })
    const authReply = nextMessage(ws, (m) => m.id === 1)
    send(ws, 'auth', { token: 't' }, 1)
    const auth = await authReply
    expect(auth.result).toBeNull()
    ws.close()
  })
})
