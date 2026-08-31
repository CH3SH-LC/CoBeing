import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

import { invoke } from '@tauri-apps/api/core'
import {
  getModelConfigs,
  saveModelSource,
  setActiveModelSource,
  deleteModelSource,
  newSourceId,
  DEEPSEEK_MODELS,
} from './settings'

const invokeMock = vi.mocked(invoke)

describe('settings model configs (多来源)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('getModelConfigs 调用 Rust 命令 get_model_configs', async () => {
    invokeMock.mockResolvedValue({
      sources: [{ id: 'a', name: '官方', api_key: 'sk-1', base_url: '', model: 'deepseek-v4-flash' }],
      active_source: 'a',
    })
    const cfg = await getModelConfigs()
    expect(invokeMock).toHaveBeenCalledWith('get_model_configs')
    expect(cfg.sources).toHaveLength(1)
    expect(cfg.active_source).toBe('a')
  })

  it('saveModelSource 传 source 对象到 Rust', async () => {
    invokeMock.mockResolvedValue(undefined)
    const src = { id: 'a', name: '官方', api_key: 'sk-1', base_url: '', model: 'deepseek-v4-flash' }
    await saveModelSource(src)
    expect(invokeMock).toHaveBeenCalledWith('save_model_source', { source: src })
  })

  it('setActiveModelSource 传 id', async () => {
    invokeMock.mockResolvedValue(undefined)
    await setActiveModelSource('b')
    expect(invokeMock).toHaveBeenCalledWith('set_active_model_source', { id: 'b' })
  })

  it('deleteModelSource 传 id', async () => {
    invokeMock.mockResolvedValue(undefined)
    await deleteModelSource('a')
    expect(invokeMock).toHaveBeenCalledWith('delete_model_source', { id: 'a' })
  })

  it('newSourceId 生成唯一 id', () => {
    expect(newSourceId()).not.toBe(newSourceId())
    expect(newSourceId()).toMatch(/^src-/)
  })

  it('DEEPSEEK_MODELS：V4 系列（v4-flash 默认；无 chat/reasoner——思考由开关控制）', () => {
    expect(DEEPSEEK_MODELS.map((m) => m.id)).toEqual([
      'deepseek-v4-flash',
      'deepseek-v4-pro',
      'deepseek-v4-flash-vision-exp',
    ])
  })

  it('操作失败时错误向上抛', async () => {
    invokeMock.mockRejectedValue('来源不存在: zzz')
    await expect(setActiveModelSource('zzz')).rejects.toBe('来源不存在: zzz')
  })
})
