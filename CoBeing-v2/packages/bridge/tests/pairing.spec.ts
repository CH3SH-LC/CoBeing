/**
 * 配对服务（方案 v2）：pair/request 密钥交换 + 持久化 + 撤销
 *
 * - 有效请求 → 返回 token + 服务器信息；记录持久化 remote.pairs.json
 * - 参数非法 → 明确报错；同 deviceId 重配 → 刷新记录
 * - revoke → 记录删除 + 回调
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { PairingService } from '../src/pairing.js'

const dirs: string[] = []

function makePairing(overrides: { onPaired?: () => void; onRevoked?: () => void } = {}): { pairing: PairingService; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'cb-pair-'))
  dirs.push(dir)
  const pairing = new PairingService({
    dataRoot: dir,
    token: 'server-token-abc',
    name: '测试电脑',
    version: '2.0.4',
    lanUrl: 'ws://192.168.1.5:7843',
    onPaired: overrides.onPaired,
    onRevoked: overrides.onRevoked,
  })
  return { pairing, dir }
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('PairingService（pair/request 密钥交换）', () => {
  test('有效请求 → 返回 token + 服务器信息，记录持久化', () => {
    const { pairing, dir } = makePairing()
    const result = pairing.handlePairRequest({ deviceId: 'device-12345678', deviceName: '小米手机' })
    expect(result.token).toBe('server-token-abc')
    expect(result.server).toMatchObject({
      name: '测试电脑',
      version: '2.0.4',
      lanUrl: 'ws://192.168.1.5:7843',
      protocol: 'cobeing-ws/1',
    })
    expect(pairing.list()).toHaveLength(1)
    expect(pairing.list()[0]).toMatchObject({ deviceId: 'device-12345678', deviceName: '小米手机' })
    // 持久化文件存在且内容一致
    const file = join(dir, 'remote.pairs.json')
    expect(existsSync(file)).toBe(true)
    const saved = JSON.parse(readFileSync(file, 'utf8')) as Array<Record<string, unknown>>
    expect(saved[0].deviceId).toBe('device-12345678')
  })

  test('参数缺失/deviceId 过短/名称为空 → 明确报错且不记录', () => {
    const { pairing } = makePairing()
    expect(() => pairing.handlePairRequest(undefined)).toThrow(/deviceId and deviceName/)
    expect(() => pairing.handlePairRequest({ deviceName: '手机' })).toThrow(/deviceId and deviceName/)
    expect(() => pairing.handlePairRequest({ deviceId: 'short', deviceName: '手机' })).toThrow(/8-128/)
    expect(() => pairing.handlePairRequest({ deviceId: 'device-12345678', deviceName: '  ' })).toThrow(/deviceName/)
    expect(pairing.list()).toHaveLength(0)
  })

  test('同 deviceId 重新配对 → 刷新名称与时间，不产生重复记录', () => {
    const { pairing } = makePairing()
    pairing.handlePairRequest({ deviceId: 'device-12345678', deviceName: '旧手机' })
    const result = pairing.handlePairRequest({ deviceId: 'device-12345678', deviceName: '新手机' })
    expect(result.token).toBe('server-token-abc')
    expect(pairing.list()).toHaveLength(1)
    expect(pairing.list()[0].deviceName).toBe('新手机')
  })

  test('配对回调触发；revoke 删除记录并回调', () => {
    let paired = 0
    let revoked = 0
    const { pairing } = makePairing({ onPaired: () => paired++, onRevoked: () => revoked++ })
    pairing.handlePairRequest({ deviceId: 'device-12345678', deviceName: '小米手机' })
    expect(paired).toBe(1)
    expect(pairing.revoke('device-12345678')).toBe(true)
    expect(revoked).toBe(1)
    expect(pairing.list()).toHaveLength(0)
    expect(pairing.revoke('device-12345678')).toBe(false)
  })

  test('重启后从 remote.pairs.json 恢复记录（配对持久化）', () => {
    const { pairing, dir } = makePairing()
    pairing.handlePairRequest({ deviceId: 'device-12345678', deviceName: '小米手机' })
    // 模拟重启：新实例读同一目录
    const revived = new PairingService({
      dataRoot: dir,
      token: 'server-token-abc',
      name: '测试电脑',
      version: '2.0.4',
      lanUrl: 'ws://192.168.1.5:7843',
    })
    expect(revived.list()).toHaveLength(1)
    expect(revived.list()[0].deviceName).toBe('小米手机')
  })

  test('损坏的 pairs 文件 → 空列表不崩溃', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cb-pair-corrupt-'))
    dirs.push(dir)
    writeFileSync(join(dir, 'remote.pairs.json'), '{{{not json', 'utf8')
    const pairing = new PairingService({
      dataRoot: dir,
      token: 't',
      name: 'n',
      version: '1',
      lanUrl: 'ws://127.0.0.1:1',
    })
    expect(pairing.list()).toHaveLength(0)
  })
})
