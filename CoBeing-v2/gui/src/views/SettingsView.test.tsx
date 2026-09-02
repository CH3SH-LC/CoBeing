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
  thinking_enabled?: boolean
  reasoning_effort?: string
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

  it('编辑来源显示思考模式与思考强度控件，保存时传递思考字段（2.0.10）', async () => {
    const sources = [{ ...src('a', 'DeepSeek 官方'), thinking_enabled: true, reasoning_effort: 'max' }]
    routeMock({
      get_model_configs: { sources, active_source: 'a' },
      save_model_source: undefined,
    })
    render(<SettingsView />)
    await waitFor(() => {
      expect(screen.getByText('DeepSeek 官方')).toBeInTheDocument()
    })
    // 列表卡片展示思考状态
    expect(screen.getByText(/思考模式：开启（强度 max）/)).toBeInTheDocument()
    // 进入编辑表单：思考开关与强度控件存在且回填
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    await waitFor(() => {
      expect(screen.getByLabelText('思考模式（推理开关）')).toBeInTheDocument()
      expect(screen.getByLabelText('思考强度（思考模式开启时生效）')).toBeInTheDocument()
    })
    expect((screen.getByLabelText('思考模式（推理开关）') as HTMLSelectElement).value).toBe('enabled')
    expect((screen.getByLabelText('思考强度（思考模式开启时生效）') as HTMLSelectElement).value).toBe('max')
    // 关闭思考 → 强度控件禁用
    fireEvent.change(screen.getByLabelText('思考模式（推理开关）'), { target: { value: 'disabled' } })
    expect((screen.getByLabelText('思考强度（思考模式开启时生效）') as HTMLSelectElement).disabled).toBe(true)
    // 重新开启并改强度 → 保存
    fireEvent.change(screen.getByLabelText('思考模式（推理开关）'), { target: { value: 'enabled' } })
    fireEvent.change(screen.getByLabelText('思考强度（思考模式开启时生效）'), { target: { value: 'low' } })
    fireEvent.click(screen.getByRole('button', { name: '保存来源' }))
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('save_model_source', expect.any(Object))
    })
    const saved = invokeMock.mock.calls.find((c) => c[0] === 'save_model_source')?.[1] as { source: Src }
    expect(saved.source.thinking_enabled).toBe(true)
    expect(saved.source.reasoning_effort).toBe('low')
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
        latest_tag: 'v2.0.12',
        published_at: '2026-08-31T00:00:00Z',
        body: '',
        asset_name: 'CoBeing.v2_2.0.12_x64-setup.exe',
        asset_url: 'https://example.com/setup.exe',
        asset_size: 30_000_000,
        has_update: false,
        current_version: '2.0.12',
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

  it('发现新版本 → 下载（带资产大小校验参数）→ 启动安装程序', async () => {
    routeMock({
      get_model_configs: { sources: [], active_source: '' },
      check_update: {
        latest_tag: 'v2.0.12',
        published_at: '2026-09-02T00:00:00Z',
        body: '',
        asset_name: 'CoBeing.v2_2.0.12_x64-setup.exe',
        asset_url: 'https://github.com/CH3SH-LC/CoBeing/releases/download/v2.0.12/CoBeing.v2_2.0.12_x64-setup.exe',
        asset_size: 32_000_000,
        has_update: true,
        current_version: '2.0.5',
      },
      download_installer: 'C:\\updates\\CoBeing.v2_2.0.12_x64-setup.exe',
      launch_installer: undefined,
    })
    render(<SettingsView />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /检查更新/ })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: /检查更新/ }))
    // 有更新 → 出现下载按钮
    const downloadBtn = await screen.findByRole('button', { name: /下载并安装/ })
    expect(screen.getByText(/CoBeing\.v2_2\.0\.12_x64-setup\.exe/)).toBeInTheDocument()
    fireEvent.click(downloadBtn)
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('download_installer', {
        url: 'https://github.com/CH3SH-LC/CoBeing/releases/download/v2.0.12/CoBeing.v2_2.0.12_x64-setup.exe',
        assetName: 'CoBeing.v2_2.0.12_x64-setup.exe',
        expectedSize: 32_000_000,
      })
    })
    // 下载完成 → 启动安装程序
    const installBtn = await screen.findByRole('button', { name: '启动安装程序' })
    fireEvent.click(installBtn)
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('launch_installer', {
        path: 'C:\\updates\\CoBeing.v2_2.0.12_x64-setup.exe',
      })
    })
  })

  it('下载失败 → 就地显示错误并出现重试', async () => {
    routeMock({
      get_model_configs: { sources: [], active_source: '' },
      check_update: {
        latest_tag: 'v2.0.12',
        published_at: '2026-09-02T00:00:00Z',
        body: '',
        asset_name: 'CoBeing.v2_2.0.12_x64-setup.exe',
        asset_url: 'https://example.com/setup.exe',
        asset_size: 32_000_000,
        has_update: true,
        current_version: '2.0.5',
      },
    })
    render(<SettingsView />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /检查更新/ })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: /检查更新/ }))
    const downloadBtn = await screen.findByRole('button', { name: /下载并安装/ })
    invokeMock.mockRejectedValueOnce(new Error('下载失败：GitHub 直连：连接超时'))
    fireEvent.click(downloadBtn)
    await waitFor(() => {
      expect(screen.getByText(/下载失败：GitHub 直连/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument()
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
      expect(screen.getByText(/CoBeing 桌面端 v2\.0\.12/)).toBeInTheDocument()
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
