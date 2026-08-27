// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { SettingsView } from './SettingsView'

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

describe('SettingsView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listenMock.mockResolvedValue(vi.fn())
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('渲染模型配置卡片并回填当前配置', async () => {
    invokeMock.mockResolvedValue({ api_key: 'sk-abc', base_url: 'https://api.deepseek.com', model: 'deepseek-chat' })
    render(<SettingsView />)
    await waitFor(() => {
      expect(screen.getByLabelText('API Key')).toBeInTheDocument()
    })
    const key = screen.getByLabelText('API Key') as HTMLInputElement
    expect(key.value).toBe('sk-abc')
    const model = screen.getByLabelText('模型名') as HTMLInputElement
    expect(model.value).toBe('deepseek-chat')
    const base = screen.getByLabelText('Base URL') as HTMLInputElement
    expect(base.value).toBe('https://api.deepseek.com')
  })

  it('未配置时渲染空表单与未配置状态', async () => {
    invokeMock.mockResolvedValue({ api_key: '', base_url: '', model: '' })
    render(<SettingsView />)
    await waitFor(() => {
      expect(screen.getByText(/未配置/)).toBeInTheDocument()
    })
    const key = screen.getByLabelText('API Key') as HTMLInputElement
    expect(key.value).toBe('')
  })

  it('保存按钮调用 save_model_config 并显示成功提示', async () => {
    invokeMock.mockResolvedValue({ api_key: '', base_url: '', model: '' })
    render(<SettingsView />)
    await waitFor(() => {
      expect(screen.getByLabelText('API Key')).toBeInTheDocument()
    })
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'sk-new' } })
    fireEvent.change(screen.getByLabelText('模型名'), { target: { value: 'deepseek-chat' } })
    invokeMock.mockResolvedValue(undefined) // save
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }))
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('save_model_config', {
        apiKey: 'sk-new',
        baseUrl: '',
        model: 'deepseek-chat',
      })
    })
    expect(screen.getByText(/已保存/)).toBeInTheDocument()
  })

  it('保存失败显示错误', async () => {
    invokeMock.mockResolvedValue({ api_key: '', base_url: '', model: '' })
    render(<SettingsView />)
    await waitFor(() => {
      expect(screen.getByLabelText('API Key')).toBeInTheDocument()
    })
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'sk-x' } })
    invokeMock.mockRejectedValueOnce('写入失败')
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }))
    await waitFor(() => {
      expect(screen.getByText(/写入失败/)).toBeInTheDocument()
    })
  })

  it('渲染检查更新卡片（含按钮）', async () => {
    invokeMock.mockResolvedValue({ api_key: '', base_url: '', model: '' })
    render(<SettingsView />)
    expect(screen.getAllByText('检查更新').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByRole('button', { name: '检查更新' })).toBeInTheDocument()
  })

  it('点击检查更新调用 check_update 并显示最新状态', async () => {
    invokeMock
      .mockResolvedValueOnce({ api_key: '', base_url: '', model: '' })
      .mockResolvedValueOnce({
        latest_tag: 'v2.0.2',
        published_at: '2026-08-26T00:00:00Z',
        body: '',
        asset_name: 'CoBeing.v2_2.0.2_x64-setup.exe',
        asset_url: 'https://example.com/setup.exe',
        asset_size: 30_000_000,
        has_update: false,
        current_version: '2.0.2',
      })
    render(<SettingsView />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '检查更新' })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: '检查更新' }))
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('check_update')
      expect(screen.getByText(/已是最新版本/)).toBeInTheDocument()
    })
  })

  it('发现新版本时显示下载按钮', async () => {
    invokeMock
      .mockResolvedValueOnce({ api_key: '', base_url: '', model: '' })
      .mockResolvedValueOnce({
        latest_tag: 'v2.1.0',
        published_at: '2026-08-26T00:00:00Z',
        body: '新版本',
        asset_name: 'CoBeing.v2_2.1.0_x64-setup.exe',
        asset_url: 'https://example.com/setup.exe',
        asset_size: 30_000_000,
        has_update: true,
        current_version: '2.0.2',
      })
    render(<SettingsView />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '检查更新' })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: '检查更新' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /下载并安装 v2.1.0/ })).toBeInTheDocument()
    })
  })

  it('渲染关于区块', async () => {
    invokeMock.mockResolvedValue({ api_key: '', base_url: '', model: '' })
    render(<SettingsView />)
    expect(screen.getByText('关于')).toBeInTheDocument()
    expect(screen.getByText(/CoBeing 桌面端 v2\.0\.2/)).toBeInTheDocument()
  })
})
