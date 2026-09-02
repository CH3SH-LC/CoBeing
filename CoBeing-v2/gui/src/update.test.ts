import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(),
}))

import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { checkUpdate, downloadInstaller, launchInstaller, onDownloadProgress, formatBytes } from './update'

const invokeMock = vi.mocked(invoke)
const listenMock = vi.mocked(listen)

describe('desktop update module', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('checkUpdate 调用 Rust 命令 check_update', async () => {
    invokeMock.mockResolvedValue({
      latest_tag: 'v2.1.0',
      published_at: '2026-08-26T00:00:00Z',
      body: '新版本',
      asset_name: 'CoBeing.v2_2.1.0_x64-setup.exe',
      asset_url: 'https://example.com/setup.exe',
      asset_size: 31_000_000,
      has_update: true,
      current_version: '2.0.0',
    })
    const res = await checkUpdate()
    expect(invokeMock).toHaveBeenCalledWith('check_update')
    expect(res.has_update).toBe(true)
    expect(res.latest_tag).toBe('v2.1.0')
  })

  it('downloadInstaller 传 url/giteeUrl/assetName/expectedSize 到 Rust', async () => {
    invokeMock.mockResolvedValue('C:\\data\\updates\\setup.exe')
    const path = await downloadInstaller(
      'https://example.com/setup.exe',
      'https://gitee.com/CH3SH-LC/CoBeing/raw/dist/v2.1.0/setup.exe',
      'setup.exe',
      31_000_000,
    )
    expect(invokeMock).toHaveBeenCalledWith('download_installer', {
      url: 'https://example.com/setup.exe',
      giteeUrl: 'https://gitee.com/CH3SH-LC/CoBeing/raw/dist/v2.1.0/setup.exe',
      assetName: 'setup.exe',
      expectedSize: 31_000_000,
    })
    expect(path).toBe('C:\\data\\updates\\setup.exe')
  })

  it('launchInstaller 传 path 到 Rust', async () => {
    invokeMock.mockResolvedValue(undefined)
    await launchInstaller('C:\\setup.exe')
    expect(invokeMock).toHaveBeenCalledWith('launch_installer', { path: 'C:\\setup.exe' })
  })

  it('onDownloadProgress 订阅 update-progress 事件', async () => {
    const unlisten = vi.fn()
    listenMock.mockImplementation(async () => unlisten)
    const cb = vi.fn()
    const fn = await onDownloadProgress(cb)
    expect(listenMock).toHaveBeenCalledWith('update-progress', expect.any(Function))
    fn()
    expect(unlisten).toHaveBeenCalled()
  })

  it('formatBytes 人性化显示', () => {
    expect(formatBytes(undefined)).toBe('—')
    expect(formatBytes(512)).toBe('1 KB')
    expect(formatBytes(1024)).toBe('1 KB')
    expect(formatBytes(3_145_728)).toBe('3.0 MB')
    expect(formatBytes(31_355_421)).toBe('29.9 MB')
  })
})
