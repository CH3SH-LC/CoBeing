/**
 * WS 自动配对通道（方案 v2）：真实 WS 客户端完整配对链路
 *
 * - 未鉴权阶段 pair/request（有效）→ 返回 token + 服务器信息
 * - 拿到 token 后 auth → hello → 协议可用（密钥交换闭环）
 * - 未鉴权阶段直接调业务方法 → -32001（配对不改鉴权底线）
 * - pair/request 参数非法 → -32602
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import WebSocket from 'ws'
import { Kernel } from '@cobeing/core'
import { RemoteServer } from '../src/remote.js'
import { PairingService } from '../src/pairing.js'

interface Ctx {
  kernel: Kernel
  remote: RemoteServer
  url: string
  dir: string
}

const contexts: Ctx[] = []

async function makeCtx(): Promise<Ctx> {
  const dir = mkdtempSync(join(tmpdir(), 'cb-remote-pair-'))
  const kernel = new Kernel(dir, { mockResponder: () => 'mock reply' })
  await kernel.start()
  const pairing = new PairingService({
    dataRoot: dir,
    token: 'secret-token',
    name: '测试电脑',
    version: '2.0.4',
    lanUrl: 'ws://127.0.0.1:0',
  })
  const remote = new RemoteServer({ kernel, port: 0, token: 'secret-token', pairing })
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

/** 发送请求并等待响应（按 id 匹配） */
function send(ws: WebSocket, method: string, params: unknown, id: number): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMessage)
      reject(new Error(`timeout waiting for ${method}`))
    }, 8000)
    const onMessage = (data: Buffer): void => {
      const msg = JSON.parse(data.toString('utf8')) as Record<string, unknown>
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

function waitOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.on('open', () => resolve())
    ws.on('error', (e) => reject(e))
  })
}

describe('WS 自动配对（pair/request → auth 闭环）', () => {
  test('pair/request 成功 → token 与服务器信息；auth 后 hello 全协议可用', async () => {
    const { url } = await makeCtx()
    const ws = new WebSocket(url)
    await waitOpen(ws)

    const pairResp = await send(ws, 'pair/request', { deviceId: 'phone-device-001', deviceName: '小米手机' }, 1)
    expect(pairResp.error).toBeUndefined()
    const result = pairResp.result as { token: string; server: Record<string, unknown> }
    expect(result.token).toBe('secret-token')
    expect(result.server).toMatchObject({
      name: '测试电脑',
      version: '2.0.4',
      protocol: 'cobeing-ws/1',
    })

    // 拿到密钥后走标准 auth（同连接第二帧；模拟手机重连更真实的场景在这里同连验证）
    const authResp = await send(ws, 'auth', { token: result.token }, 2)
    expect(authResp.error).toBeUndefined()
    const ping = await send(ws, 'ping', {}, 3)
    expect((ping.result as { pong: boolean }).pong).toBe(true)
    ws.close()
  })

  test('pair/request 参数非法 → -32602；业务方法未鉴权仍被拒', async () => {
    const { url } = await makeCtx()
    const ws = new WebSocket(url)
    await waitOpen(ws)

    const bad = await send(ws, 'pair/request', { deviceName: 'x' }, 1)
    expect(bad.error).toMatchObject({ code: -32602 })

    const biz = await send(ws, 'remote/info', {}, 2)
    expect(biz.error).toMatchObject({ code: -32001 })
    ws.close()
  })
})
