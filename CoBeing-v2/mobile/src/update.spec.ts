/**
 * mobile 更新模块测试：版本比较 / release 挑选 / 更新检查 / APK 下载
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  isNewerVersion,
  pickMobileRelease,
  checkMobileUpdate,
  downloadApk,
  setDownloadImplForTest,
  APP_VERSION,
  GITHUB_RELEASES_API,
  type GithubRelease,
} from './update'

function rel(tag: string, prerelease: boolean, assets: Array<{ name: string; size?: number }>): GithubRelease {
  return {
    tag_name: tag,
    prerelease,
    published_at: '2026-01-01T00:00:00Z',
    body: 'notes',
    assets: assets.map((a) => ({ name: a.name, browser_download_url: `https://example.com/${a.name}`, size: a.size ?? 100 })),
  }
}

describe('isNewerVersion', () => {
  it('比较主次补丁版本', () => {
    expect(isNewerVersion('v2.1.0', '2.0.0')).toBe(true)
    expect(isNewerVersion('v2.0.1', '2.0.0')).toBe(true)
    expect(isNewerVersion('v10.0.0', 'v9.9.9')).toBe(true)
    expect(isNewerVersion('v2.0.0', '2.0.0')).toBe(false)
    expect(isNewerVersion('v1.9.0', '2.0.0')).toBe(false)
    expect(isNewerVersion('v2.0.0-alpha.0', '2.0.0')).toBe(false)
    expect(isNewerVersion('v2.0.1', '2.0.0-alpha.1')).toBe(true)
  })
})

describe('pickMobileRelease', () => {
  it('跳过 prerelease 并匹配手机端 APK', () => {
    const releases = [
      rel('v2.0.0-alpha.0', true, [{ name: 'CoBeing-mobile-v2.0.0-alpha-debug.apk' }]),
      rel('v2.0.0', false, [
        { name: 'CoBeing.v2_2.0.0_x64-setup.exe' },
        { name: 'CoBeing-mobile-v2.0.0-debug.apk' },
      ]),
    ]
    const picked = pickMobileRelease(releases)
    expect(picked).not.toBeNull()
    expect(picked!.release.tag_name).toBe('v2.0.0')
    expect(picked!.asset.name).toBe('CoBeing-mobile-v2.0.0-debug.apk')
  })

  it('无正式版 APK 时返回 null', () => {
    expect(pickMobileRelease([rel('v2.0.0-alpha.0', true, [{ name: 'x.apk' }])])).toBeNull()
    expect(pickMobileRelease([rel('v2.0.0', false, [{ name: 'setup.exe' }])])).toBeNull()
    expect(pickMobileRelease([])).toBeNull()
  })
})

describe('checkMobileUpdate', () => {
  const origFetch = globalThis.fetch

  beforeEach(() => {
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    globalThis.fetch = origFetch
  })

  it('发现新版本时返回 has_update=true 与资产信息', async () => {
    const releases = [rel('v9.9.9', false, [{ name: 'CoBeing-mobile-v9.9.9-debug.apk', size: 12345 }])]
    ;(globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => releases,
    })
    const info = await checkMobileUpdate()
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${GITHUB_RELEASES_API}?per_page=10`,
      expect.objectContaining({ headers: expect.anything() }),
    )
    expect(info.has_update).toBe(true)
    expect(info.latest_tag).toBe('v9.9.9')
    expect(info.asset_name).toBe('CoBeing-mobile-v9.9.9-debug.apk')
    expect(info.current_version).toBe(APP_VERSION)
  })

  it('当前已是最新时 has_update=false', async () => {
    const releases = [rel(`v${APP_VERSION}`, false, [{ name: 'CoBeing-mobile-debug.apk' }])]
    ;(globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => releases,
    })
    const info = await checkMobileUpdate()
    expect(info.has_update).toBe(false)
  })

  it('GitHub API 失败时抛出错误', async () => {
    ;(globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 403,
    })
    await expect(checkMobileUpdate()).rejects.toThrow(/403/)
  })

  it('无可用正式版时抛出错误', async () => {
    ;(globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => [rel('v2.0.0-alpha.0', true, [{ name: 'x.apk' }])],
    })
    await expect(checkMobileUpdate()).rejects.toThrow(/未找到/)
  })
})

describe('downloadApk（原生下载 + 镜像 fallback，修复 Failed to fetch）', () => {
  afterEach(() => {
    setDownloadImplForTest(undefined)
  })

  it('直连成功：原生下载返回 cache 相对路径', async () => {
    const calls: string[] = []
    setDownloadImplForTest({
      async download(url: string): Promise<void> {
        calls.push(url)
      },
    })
    const path = await downloadApk('https://github.com/CH3SH-LC/CoBeing/releases/download/v2.0.4/x.apk', 'x.apk')
    expect(path).toBe('updates/x.apk')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toBe('https://github.com/CH3SH-LC/CoBeing/releases/download/v2.0.4/x.apk')
  })

  it('直连失败 → 自动尝试国内加速镜像源', async () => {
    const calls: string[] = []
    let failCount = 1
    setDownloadImplForTest({
      async download(url: string): Promise<void> {
        calls.push(url)
        if (failCount > 0) {
          failCount--
          throw new Error('network unreachable')
        }
      },
    })
    const path = await downloadApk('https://github.com/CH3SH-LC/CoBeing/releases/download/v2.0.4/x.apk', 'x.apk')
    expect(path).toBe('updates/x.apk')
    expect(calls).toHaveLength(2)
    expect(calls[1]).toContain('ghfast.top')
    expect(calls[1]).toContain('github.com/CH3SH-LC/CoBeing')
  })

  it('全部源失败 → 明确错误（含各源原因）', async () => {
    setDownloadImplForTest({
      async download(): Promise<void> {
        throw new Error('timeout')
      },
    })
    await expect(downloadApk('https://github.com/x/y.apk', 'y.apk')).rejects.toThrow(/APK 下载失败.*镜像源均不可达/)
    await expect(downloadApk('https://github.com/x/y.apk', 'y.apk')).rejects.toThrow(/timeout/)
  })
})
