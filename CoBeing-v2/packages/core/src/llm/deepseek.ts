/**
 * DeepSeek 真实 LLM 适配器（架构 §5 模型路由）
 *
 * - 直接使用全局 fetch（Node 24，不需要 node-fetch）。
 * - 重试、超时、限流由 LLMGateway 统一负责，本适配器内部不做重试。
 */

import type { LLMProvider, ChatRequest, ChatResponse } from './gateway.js'

export interface DeepSeekOptions {
  /** API 基础地址，默认 https://api.deepseek.com */
  baseUrl?: string
  /** API Key，默认读 process.env.DEEPSEEK_API_KEY */
  apiKey?: string
  /** 默认模型，默认 deepseek-chat */
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
    if (!key) throw new Error('DeepSeekProvider: DEEPSEEK_API_KEY 未配置')
    this.apiKey = key
    this.model = opts.model ?? 'deepseek-chat'
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const body: Record<string, unknown> = {
      model: req.model ?? this.model,
      messages: req.messages,
    }
    if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: req.signal,
    })

    if (!response.ok) {
      const digest = await this.digestBody(response)
      throw new Error(`DeepSeek API error ${response.status}: ${digest}`)
    }

    const data = (await response.json()) as ChatCompletionResponse
    const content: string = data?.choices?.[0]?.message?.content ?? ''
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
  choices?: { message?: { content?: string } }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}
