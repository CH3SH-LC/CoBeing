import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

import { invoke } from '@tauri-apps/api/core'
import { getModelConfig, saveModelConfig } from './settings'

const invokeMock = vi.mocked(invoke)

describe('settings model config', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('getModelConfig 调用 Rust 命令 get_model_config', async () => {
    invokeMock.mockResolvedValue({ api_key: 'sk-abc', base_url: '', model: 'deepseek-chat' })
    const cfg = await getModelConfig()
    expect(invokeMock).toHaveBeenCalledWith('get_model_config')
    expect(cfg.api_key).toBe('sk-abc')
    expect(cfg.model).toBe('deepseek-chat')
  })

  it('saveModelConfig 传 camelCase 参数到 Rust', async () => {
    invokeMock.mockResolvedValue(undefined)
    await saveModelConfig({ apiKey: 'sk-abc', baseUrl: 'https://x.com', model: 'deepseek-chat' })
    expect(invokeMock).toHaveBeenCalledWith('save_model_config', {
      apiKey: 'sk-abc',
      baseUrl: 'https://x.com',
      model: 'deepseek-chat',
    })
  })

  it('保存失败时错误向上抛', async () => {
    invokeMock.mockRejectedValue('写入配置失败: 权限不足')
    await expect(saveModelConfig({ apiKey: 'k', baseUrl: '', model: '' })).rejects.toBe(
      '写入配置失败: 权限不足',
    )
  })
})
