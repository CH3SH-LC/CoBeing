/**
 * 模型配置（前端设置界面）：多来源管理（Rust 命令代理）
 *
 * - 来源：id/name/apiKey/baseUrl/model，可创建多个、全部保存
 * - 当前使用：activeSourceId（切换后重启内核生效）
 * - 模型预设：DeepSeek v4 系列（deepseek-v4-flash 默认）
 */

import { invoke } from '@tauri-apps/api/core'

export interface ModelSource {
  id: string
  name: string
  api_key: string
  base_url: string
  model: string
}

export interface ModelConfigs {
  sources: ModelSource[]
  active_source: string
}

/** DeepSeek 可选模型（v4 系列；第一个为默认） */
export const DEEPSEEK_MODELS = [
  { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash（默认）' },
  { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
  { id: 'deepseek-v4-flash-vision-exp', label: 'DeepSeek V4 Flash Vision（实验）' },
] as const

/** 生成来源 id（前端本地生成；Rust 仅校验非空） */
export function newSourceId(): string {
  return `src-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** 读取全部模型来源与当前使用来源（未配置时 sources 为空） */
export function getModelConfigs(): Promise<ModelConfigs> {
  return invoke('get_model_configs')
}

/** 保存（新增或更新）一个来源；第一个来源自动设为当前使用 */
export function saveModelSource(source: ModelSource): Promise<void> {
  return invoke('save_model_source', { source })
}

/** 设置当前使用的来源（须已存在） */
export function setActiveModelSource(id: string): Promise<void> {
  return invoke('set_active_model_source', { id })
}

/** 删除来源；若删除的是当前使用来源，则当前使用置空（内核回退环境变量） */
export function deleteModelSource(id: string): Promise<void> {
  return invoke('delete_model_source', { id })
}
