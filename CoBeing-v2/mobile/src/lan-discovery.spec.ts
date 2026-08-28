/**
 * 局域网发现（方案 v2）：扫描实现注入 + 插件不可用兜底
 */

import { beforeEach, describe, expect, test } from 'vitest'
import { scanLanDevices, setLanScanImplForTest } from './lan-discovery'

beforeEach(() => {
  setLanScanImplForTest(undefined)
})

describe('scanLanDevices', () => {
  test('注入实现：返回发现的电脑列表', async () => {
    setLanScanImplForTest(async () => [
      { id: 'server-1', name: '测试电脑', version: '2.0.4', host: '192.168.1.5', wsPort: 7843, lanUrl: 'ws://192.168.1.5:7843' },
    ])
    const devices = await scanLanDevices()
    expect(devices).toHaveLength(1)
    expect(devices[0]).toMatchObject({ name: '测试电脑', wsPort: 7843 })
  })

  test('注入实现：扫描参数透传（端口/超时）', async () => {
    let received: Record<string, unknown> | null = null
    setLanScanImplForTest(async (opts) => {
      received = opts
      return []
    })
    await scanLanDevices({ scanPort: 9000, timeoutMs: 2000 })
    expect(received).toMatchObject({ scanPort: 9000, timeoutMs: 2000 })
  })

  test('插件不可用（浏览器环境）→ 返回空列表不抛错', async () => {
    const devices = await scanLanDevices()
    expect(devices).toEqual([])
  })
})
