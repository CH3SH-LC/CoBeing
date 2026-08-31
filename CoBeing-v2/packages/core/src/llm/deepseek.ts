/**
 * DeepSeek 真实 LLM 适配器（架构 §5 模型路由）
 *
 * - 直接使用全局 fetch（Node 24，不需要 node-fetch）。
 * - 重试、超时、限流由 LLMGateway 统一负责，本适配器内部不做重试。
 * - 错误分类（2.0.7）：网络/鉴权/余额/地址/限流/服务端/空内容 → LLMError 统一中文消息。
 */

import type { LLMProvider, ChatRequest, ChatResponse } from './gateway.js'
import { LLMError, LLM_ERROR_CODES, classifyHttpError, classifyNetworkError, classifyEmptyResponse } from './errors.js'

export interface DeepSeekOptions {
  /** API 基础地址，默认 https://api.deepseek.com */
  baseUrl?: string
  /** API Key，默认读 process.env.DEEPSEEK_API_KEY */
  apiKey?: string
  /** 默认模型，默认 deepseek-v4-flash */
  model?: string
}

export class DeepSeekProvider implements LLMProvider {
  name = 'deepseek'
  private readonly baseUrl: string
  private readonly apiKey: string
  private readonly model: string

  constructor(opts: DeepSeekOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? process.env.DEEPSEEK_API_BASE_URL ?? 'https://api.deepseek.com').replace(/\/$/, '')
    const key = opts.apiKey ?? process.env.DEEPSEEK_API_KEY
    if (!key) {
      throw new LLMError(LLM_ERROR_CODES.LLM_CONFIG_MISSING, '未配置 API Key：请在「设置 → 模型」添加模型来源，或设置 DEEPSEEK_API_KEY 环境变量')
    }
    this.apiKey = key
    this.model = opts.model ?? 'deepseek-chat'
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const body: Record<string, unknown> = {
      model: req.model ?? this.model,
      messages: req.messages,
    }
    if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens

    let response: Response
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: req.signal,
      })
    } catch (error) {
      // fetch 网络层失败：分类为网络/超时（含本地代理/防火墙场景）
      const classified = classifyNetworkError(error)
      if (classified) throw classified
      throw new LLMError(LLM_ERROR_CODES.LLM_NETWORK, '模型服务网络异常', {
        detail: error instanceof Error ? error.message.slice(0, 200) : String(error),
      })
    }

    if (!response.ok) {
      const bodyText = await this.digestBody(response)
      throw classifyHttpError(response.status, bodyText, `${this.baseUrl}/chat/completions`)
    }

    const data = (await response.json()) as ChatCompletionResponse
    const content: string = data?.choices?.[0]?.message?.content ?? ''
    // 2.0.7：空内容不再静默通过——推理模型（content 空、reasoning_content 有值）与截断场景明确报错
    if (!content) {
      throw classifyEmptyResponse(data as unknown)
    }
    const usage =
      data?.usage !== undefined && data?.usage !== null
        ? {
            inputTokens: data.usage.prompt_tokens ?? 0,
            outputTokens: data.usage.completion_tokens ?? 0,
          }
        : undefined
    return { content, usage }
  }

  private async digestBody(response: Response): Promise<string> {
    try {
      const text = await response.text()
      const trimmed = text.slice(0, 300)
      return trimmed || response.statusText || 'no body'
    } catch {
      return response.statusText || `HTTP ${response.status}`
    }
  }
}

/** DeepSeek /chat/completions 最小响应结构（仅取任务所需字段） */
interface ChatCompletionResponse {
  choices?: { message?: { content?: string; reasoning_content?: string }; finish_reason?: string }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}
