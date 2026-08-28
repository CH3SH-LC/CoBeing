/**
 * 局域网发现服务（方案 v2）：真实 UDP 扫描 → 应答链路
 *
 * - 客户端单播 scan（127.0.0.1，不依赖广播可达性）→ 服务端应答 announce
 * - announce 载荷：协议/服务器名/版本/WS 端口/LAN 地址
 * - 非本协议帧（乱码/其他 JSON）不响应
 */

import { afterEach, describe, expect, test } from 'vitest'
import dgram from 'node:dgram'
import { DiscoveryService, getLanIp } from '../src/discovery.js'

const services: DiscoveryService[] = []

async function makeService(opts: {
  port?: number
  id?: string
  name?: string
  version?: string
  wsPort?: number
  host?: string
} = {}): Promise<{ service: DiscoveryService; port: number }> {
  // 固定测试端口（announce 广播目标 = 服务端口；随机端口 0 会让 announce 发到非法端口）
  const service = new DiscoveryService({
    port: opts.port ?? 17844,
    id: opts.id ?? 'test-server',
    name: opts.name ?? '测试电脑',
    version: opts.version ?? '2.0.4',
    wsPort: opts.wsPort ?? 7843,
    host: opts.host ?? '127.0.0.1',
  })
  services.push(service)
  const { port } = await service.start()
  return { service, port }
}

/** 发送 scan 并等待 announce 应答 */
function scanFor(port: number, frame: unknown): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4')
    const timer = setTimeout(() => {
      socket.close()
      reject(new Error('timeout waiting for announce'))
    }, 3000)
    socket.on('message', (msg) => {
      clearTimeout(timer)
      socket.close()
      resolve(JSON.parse(msg.toString('utf8')) as Record<string, unknown>)
    })
    const payload = Buffer.from(JSON.stringify(frame))
    socket.send(payload, 0, payload.length, port, '127.0.0.1', () => undefined)
  })
}

afterEach(async () => {
  for (const service of services.splice(0)) {
    await service.stop().catch(() => undefined)
  }
})

describe('DiscoveryService（cobeing-discover/1）', () => {
  test('scan → announce 应答（协议/名称/版本/WS 端口/LAN 地址完整）', async () => {
    const { service, port } = await makeService({ wsPort: 7999, host: '192.168.1.9' })
    expect(service).toBeInstanceOf(DiscoveryService)

    const announce = await scanFor(port, { v: 1, type: 'scan' })
    expect(announce).toMatchObject({
      v: 1,
      type: 'announce',
      protocol: 'cobeing-discover/1',
      id: 'test-server',
      name: '测试电脑',
      version: '2.0.4',
      wsPort: 7999,
      host: '192.168.1.9',
      lanUrl: 'ws://192.168.1.9:7999',
    })
  })

  test('乱码/非 scan 帧不响应（无应答 → 超时）', async () => {
    const { port } = await makeService()
    const noise = Buffer.from('not-json-at-all')
    await expect(
      new Promise((resolve, reject) => {
        const socket = dgram.createSocket('udp4')
        const timer = setTimeout(() => {
          socket.close()
          resolve('no-answer')
        }, 800)
        socket.on('message', () => {
          clearTimeout(timer)
          socket.close()
          reject(new Error('unexpected answer'))
        })
        socket.send(noise, 0, noise.length, port, '127.0.0.1', () => undefined)
      }),
    ).resolves.toBe('no-answer')
  })

  test('主动 announce() 不抛错（广播发送）', async () => {
    const { service } = await makeService()
    expect(() => service.announce()).not.toThrow()
  })

  test('getLanIp 返回非回环 IPv4（本机有网卡时）', () => {
    const ip = getLanIp()
    expect(ip.length).toBeGreaterThan(0)
    expect(ip).not.toBe('127.0.0.1')
  })
})
