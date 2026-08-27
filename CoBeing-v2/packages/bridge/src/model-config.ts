/**
 * 模型配置文件加载（内核启动用）
 *
 * 文件结构（v2）：{ "sources": [{id,name,api_key,base_url,model}], "active_source": "<id>" }
 * 旧格式（v2.0.2 单来源）读取时自动迁移为 sources=[default] + active_source="default"。
 *
 * 优先级：文件 active 来源**优先**；未配置的字段回退环境变量
 * （DEEPSEEK_API_KEY / DEEPSEEK_API_BASE_URL）。
 * 空字符串/缺失 → 不覆盖环境变量；解析失败 → 视为未配置（容错启动）。
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface ModelSourceFile {
  id: string
  name: string
  api_key?: string
  base_url?: string
  model?: string
}

export interface ModelConfigsFile {
  sources: ModelSourceFile[]
  active_source?: string
}

/** 解析 JSON 文本为配置；非法 JSON → 空配置（不抛错）；旧格式自动迁移 */
export function parseModelConfig(raw: string): ModelConfigsFile {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return { sources: [] }
  }
  if (typeof data !== 'object' || data === null) return { sources: [] }
  const obj = data as Record<string, unknown>

  // 旧格式（单来源：{api_key, base_url, model}，无 sources 字段）→ 迁移
  if (!Array.isArray(obj.sources)) {
    // 仅当对象带旧格式键时才迁移（与 Rust 侧语义一致：即使字段为空也迁移）
    const hasLegacyKey = 'api_key' in obj || 'base_url' in obj || 'model' in obj
    if (!hasLegacyKey) return { sources: [] }
    const migrated: ModelSourceFile = { id: 'default', name: 'DeepSeek 官方' }
    const apiKey = str(obj.api_key)
    const baseUrl = str(obj.base_url)
    const model = str(obj.model)
    if (apiKey !== undefined) migrated.api_key = apiKey
    if (baseUrl !== undefined) migrated.base_url = baseUrl
    if (model !== undefined) migrated.model = model
    return { sources: [migrated], active_source: 'default' }
  }

  const sources: ModelSourceFile[] = []
  for (const item of obj.sources) {
    if (typeof item !== 'object' || item === null) continue
    const src = item as Record<string, unknown>
    const id = str(src.id)
    if (id === undefined) continue
    const entry: ModelSourceFile = { id, name: str(src.name) ?? id }
    const apiKey = str(src.api_key)
    const baseUrl = str(src.base_url)
    const model = str(src.model)
    if (apiKey !== undefined) entry.api_key = apiKey
    if (baseUrl !== undefined) entry.base_url = baseUrl
    if (model !== undefined) entry.model = model
    sources.push(entry)
  }
  const active = str(obj.active_source)
  return { sources, active_source: active }
}

function str(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return t.length > 0 ? t : undefined
}

/** 当前应使用的来源：active_source 匹配；无 → undefined（回退环境变量） */
export function pickActiveSource(cfg: ModelConfigsFile): ModelSourceFile | undefined {
  if (!cfg.active_source) return undefined
  return cfg.sources.find((s) => s.id === cfg.active_source)
}

/** 读取 <dataRoot>/model-config.json；文件不存在/读取失败 → 空配置（不抛错） */
export async function loadModelConfig(dataRoot: string): Promise<ModelConfigsFile> {
  try {
    const raw = await readFile(join(dataRoot, 'model-config.json'), 'utf8')
    return parseModelConfig(raw)
  } catch {
    return { sources: [] }
  }
}
