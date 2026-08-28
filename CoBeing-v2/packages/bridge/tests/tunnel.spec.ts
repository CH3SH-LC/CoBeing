/**
 * cloudflared 隧道管理器（方案 v2）：假 cloudflared 子进程验证 URL 抓取/停止
 *
 * - spawnImpl 注入 = node 跑假脚本：输出 trycloudflare URL 后保持运行
 * - start() → 抓取 URL；幂等（再次 start 返回同一 URL）
 * - stop() → 子进程终止；running 状态翻转
 * - 子进程立即退出 → start() 明确报错
 */

import { spawn } from 'node:child_process'
import { afterEach, describe, expect, test } from 'vitest'
import { TunnelManager } from '../src/tunnel.js'

const tunnels: TunnelManager[] = []

/** 假 cloudflared：node -e 打印 URL 并保持运行 */
function fakeCloudflared(script: string): typeof spawn {
  return ((bin: string, args: string[], opts: object) => {
    void bin
    void args
    return spawn(process.execPath, ['-e', script], opts as never)
  }) as typeof spawn
}

const KEEP_ALIVE = 'console.log("https://fake-abc123.trycloudflare.com"); setInterval(() => {}, 1000)'

function makeTunnel(script: string, opts: { timeoutMs?: number } = {}): TunnelManager {
  const tunnel = new TunnelManager({
    port: 7843,
    timeoutMs: opts.timeoutMs ?? 5000,
    spawnImpl: fakeCloudflared(script),
    onLog: () => undefined,
  })
  tunnels.push(tunnel)
  return tunnel
}

afterEach(async () => {
  for (const tunnel of tunnels.splice(0)) {
    await tunnel.stop().catch(() => undefined)
  }
})

describe('TunnelManager（cloudflared 自动隧道）', () => {
  test('start() 抓取 trycloudflare URL 并保持运行', async () => {
    const tunnel = makeTunnel(KEEP_ALIVE)
    const { url } = await tunnel.start()
    expect(url).toBe('https://fake-abc123.trycloudflare.com')
    expect(tunnel.running).toBe(true)
    expect(tunnel.tunnelUrl).toBe(url)
    // 幂等：再次 start 立即返回同一 URL
    const again = await tunnel.start()
    expect(again.url).toBe(url)
  })

  test('子进程立即退出 → start() 明确报错', async () => {
    const tunnel = makeTunnel('process.exit(1)')
    await expect(tunnel.start()).rejects.toThrow(/cloudflared 进程退出/)
  })

  test('stop() 终止子进程（幂等）', async () => {
    const tunnel = makeTunnel(KEEP_ALIVE)
    await tunnel.start()
    expect(tunnel.running).toBe(true)
    await tunnel.stop()
    expect(tunnel.running).toBe(false)
    await tunnel.stop() // 幂等
  })

  test('cloudflared 不存在且禁止下载 → 明确报错（提示安装位置）', async () => {
    const tunnel = new TunnelManager({
      port: 7843,
      toolsDir: 'Z:\\nonexistent-tools-dir',
      download: false,
    })
    tunnels.push(tunnel)
    await expect(tunnel.start()).rejects.toThrow(/cloudflared 不存在/)
  })
})
