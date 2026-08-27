/**
 * 模型配置（前端设置界面）：读写 model-config.json（Rust 命令代理）
 *
 * 语义：apiKey 空 = 未配置（内核回退环境变量）；baseUrl 空 = 默认 DeepSeek；
 * model 空 = 默认 deepseek-chat。保存后需重启内核/应用生效。
 */

import { invoke } from '@tauri-apps/api/core'

export interface ModelConfig {
  api_key: string
  base_url: string
  model: string
}

/** 读取当前模型配置（未配置时各字段为空字符串） */
export function getModelConfig(): Promise<ModelConfig> {
  return invoke('get_model_config')
}

/** 保存模型配置；返回 Promise，失败时抛出错误消息 */
export function saveModelConfig(cfg: {
  apiKey: string
  baseUrl: string
  model: string
}): Promise<void> {
  return invoke('save_model_config', {
    apiKey: cfg.apiKey,
    baseUrl: cfg.baseUrl,
    model: cfg.model,
  })
}
