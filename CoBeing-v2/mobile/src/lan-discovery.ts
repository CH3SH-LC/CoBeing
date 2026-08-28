/**
 * 局域网发现（方案 v2）：原生 UDP 扫描封装
 *
 * - 真机：Capacitor 原生插件 LanDiscovery（Android DatagramSocket + MulticastLock），
 *   广播 scan 到 255.255.255.255:7844 → 电脑应答 announce → 返回可配对设备列表。
 * - 浏览器/测试：注入 fake 实现（setLanScanImplForTest）。
 */

import { registerPlugin } from '@capacitor/core'
import { getDeviceName } from './pairing'

export interface LanDevice {
  id: string
  name: string
  version: string
  host: string
  wsPort: number
  lanUrl: string
}

export interface LanDiscoveryNative {
  scan(options: { scanPort?: number; timeoutMs?: number; deviceName?: string }): Promise<{ devices: LanDevice[] }>
}

/** Capacitor 原生插件句柄（浏览器环境返回不可用 proxy，调用时 catch） */
const LanDiscovery = registerPlugin<LanDiscoveryNative>('LanDiscovery')

export type LanScanFn = (opts: { scanPort?: number; timeoutMs?: number }) => Promise<LanDevice[]>

let scanImpl: LanScanFn | undefined

/** 测试注入假扫描实现 */
export function setLanScanImplForTest(fn: LanScanFn | undefined): void {
  scanImpl = fn
}

/** 扫描局域网电脑（发现后返回可配对设备列表） */
export async function scanLanDevices(opts: { scanPort?: number; timeoutMs?: number } = {}): Promise<LanDevice[]> {
  if (scanImpl) return scanImpl(opts)
  try {
    const result = await LanDiscovery.scan({
      scanPort: opts.scanPort ?? 7844,
      timeoutMs: opts.timeoutMs ?? 4000,
      deviceName: getDeviceName(),
    })
    return Array.isArray(result?.devices) ? result.devices : []
  } catch (error) {
    // 原生插件不可用（浏览器预览/测试环境）→ 静默返回空列表
    console.warn('[lan-discovery] 插件不可用：', error)
    return []
  }
}
