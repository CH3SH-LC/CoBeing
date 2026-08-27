/**
 * 模型配置文件加载（内核启动用）
 *
 * 优先级：`<dataRoot>/model-config.json`（GUI 设置界面写入）**优先**，
 * 未配置的字段回退环境变量（DEEPSEEK_API_KEY / DEEPSEEK_API_BASE_URL）。
 *
 * 文件结构：{ "api_key"?, "base_url"?, "model"? }
 * 空字符串/缺失 → 不覆盖环境变量；解析失败 → 视为未配置（容错启动）。
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface FileModelConfig {
  api_key?: string
  base_url?: string
  model?: string
}

/** 解析 JSON 文本为配置；仅保留非空字符串字段；非法 JSON → 空配置（不抛错） */
export function parseModelConfig(raw: string): FileModelConfig {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return {}
  }
  if (typeof data !== 'object' || data === null) return {}
  const out: FileModelConfig = {}
  const obj = data as Record<string, unknown>
  for (const key of ['api_key', 'base_url', 'model'] as const) {
    const v = obj[key]
    if (typeof v === 'string' && v.trim().length > 0) out[key] = v.trim()
  }
  return out
}

/** 读取 <dataRoot>/model-config.json；文件不存在/读取失败 → 空配置（不抛错） */
export async function loadModelConfig(dataRoot: string): Promise<FileModelConfig> {
  try {
    const raw = await readFile(join(dataRoot, 'model-config.json'), 'utf8')
    return parseModelConfig(raw)
  } catch {
    return {}
  }
}
