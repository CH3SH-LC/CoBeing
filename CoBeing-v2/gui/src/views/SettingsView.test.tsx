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

interface Src {
  id: string
  name: string
  api_key: string
  base_url: string
  model: string
}

/**
 * 按命令名路由的 mock：每个测试用 runWith 描述命令 → 响应，避免 mockResolvedValueOnce
 * 跨方法名按调用顺序错配（get_model_configs 与 save_model_source 等共用队列）。
 */
function routeMock(routes: Record<string, unknown>) {
  invokeMock.mockImplementation(async (cmd: string) => {
    if (cmd in routes) return routes[cmd]
    throw new Error(`unexpected command: ${cmd}`)
  })
}

function src(id: string, name: string, model = 'deepseek-v4-flash', key = `sk-${id}`): Src {
  return { id, name, api_key: key, base_url: '', model }
}

describe('SettingsView（分栏设置界面）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    invokeMock.mockReset()
    listenMock.mockReset()
    listenMock.mockResolvedValue(vi.fn())
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('渲染左侧条目导航（模型/检查更新/关于）', async () => {
    routeMock({ get_model_configs: { sources: [src('a', 'DeepSeek 官方')], active_source: 'a' } })
    render(<SettingsView />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '模型' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /检查更新/ })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '关于' })).toBeInTheDocument()
    })
  })

  it('默认选中「模型」条目并渲染来源列表', async () => {
    routeMock({ get_model_configs: { sources: [src('a', 'DeepSeek 官方')], active_source: 'a' } })
    render(<SettingsView />)
    await waitFor(() => {
      expect(screen.getByText('DeepSeek 官方')).toBeInTheDocument()
    })
    expect(screen.getByText(/deepseek-v4-flash/)).toBeInTheDocument()
    expect(screen.getAllByText('当前使用').length).toBeGreaterThanOrEqual(1)
  })

  it('添加来源：保存后出现在列表，且保留原来源', async () => {
    const sources = [src('a', 'DeepSeek 官方')]
    routeMock({
      get_model_configs: { sources, active_source: 'a' },
      save_model_source: undefined,
    })
    render(<SettingsView />)
    await waitFor(() => {
      expect(screen.getByText('DeepSeek 官方')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: /添加来源/ }))
    fireEvent.change(screen.getByLabelText('来源名称'), { target: { value: '备选模型' } })
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'sk-b' } })
    // 保存后 get_model_configs 返回含新来源的列表
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_model_configs') {
        return { sources: [...sources, src('b', '备选模型')], active_source: 'a' }
      }
      if (cmd === 'save_model_source') return undefined
      throw new Error(`unexpected: ${cmd}`)
    })
    fireEvent.click(screen.getByRole('button', { name: '保存来源' }))
    await waitFor(() => {
      expect(screen.getByText('备选模型')).toBeInTheDocument()
    })
    expect(invokeMock).toHaveBeenCalledWith('save_model_source', expect.any(Object))
    expect(screen.getByText('DeepSeek 官方')).toBeInTheDocument()
  })

  it('切换当前使用来源：点击「设为当前」调用 set_active_model_source', async () => {
    routeMock({
      get_model_configs: {
        sources: [src('a', 'DeepSeek 官方'), src('b', '备选模型', 'deepseek-v4-pro')],
        active_source: 'a',
      },
      set_active_model_source: undefined,
    })
    render(<SettingsView />)
    await waitFor(() => {
      expect(screen.getByText('备选模型')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: '设为当前' }))
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('set_active_model_source', { id: 'b' })
    })
    expect(screen.getByText(/重启应用后生效/)).toBeInTheDocument()
  })

  it('删除来源：调用 delete_model_source', async () => {
    routeMock({
      get_model_configs: {
        sources: [src('a', 'DeepSeek 官方'), src('b', '备选模型')],
        active_source: 'a',
      },
      delete_model_source: undefined,
    })
    render(<SettingsView />)
    await waitFor(() => {
      expect(screen.getByText('备选模型')).toBeInTheDocument()
    })
    const delButtons = screen.getAllByRole('button', { name: '删除' })
    fireEvent.click(delButtons[1]) // 删除第二个来源 b
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('delete_model_source', { id: 'b' })
    })
  })

  it('「检查更新」条目：点击即触发 check_update（无右侧内容）', async () => {
    routeMock({
      get_model_configs: { sources: [], active_source: '' },
      check_update: {
        latest_tag: 'v2.0.5',
        published_at: '2026-08-27T00:00:00Z',
        body: '',
        asset_name: 'CoBeing.v2_2.0.5_x64-setup.exe',
        asset_url: 'https://example.com/setup.exe',
        asset_size: 30_000_000,
        has_update: false,
        current_version: '2.0.5',
      },
    })
    render(<SettingsView />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /检查更新/ })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: /检查更新/ }))
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('check_update')
      expect(screen.getByText(/已是最新版本/)).toBeInTheDocument()
    })
  })

  it('「关于」条目：点击显示版本信息', async () => {
    routeMock({ get_model_configs: { sources: [src('a', 'DeepSeek 官方')], active_source: 'a' } })
    render(<SettingsView />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '关于' })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: '关于' }))
    await waitFor(() => {
      expect(screen.getByText(/CoBeing 桌面端 v2\.0\.5/)).toBeInTheDocument()
    })
  })

  it('未配置任何来源时显示空态与添加入口', async () => {
    routeMock({ get_model_configs: { sources: [], active_source: '' } })
    render(<SettingsView />)
    await waitFor(() => {
      expect(screen.getByText(/尚未配置任何模型来源/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /添加来源/ })).toBeInTheDocument()
    })
  })
})
