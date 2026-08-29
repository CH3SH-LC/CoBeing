/**
 * LLM 网关（架构 §5 模型路由）
 *
 * - Provider 注册（注册皆 effect）；每 provider 一个串行队列（并发 1）。
 * - 限流（RPM）、超时、重试（指数退避）——参数可配置。
 * - DeepSeek 真实适配器见 ./deepseek.ts（gateway.ts 内不再保留占位，避免重复导出）。
 */

import { LLMError, LLM_ERROR_CODES } from './errors.js'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
}

export interface ChatRequest {
  /** 模型 provider 名；缺省/空 → 未配置错误（LLM_NO_ADAPTER） */
  provider?: string
  model: string
  messages: ChatMessage[]
  maxTokens?: number
  signal?: AbortSignal
}

export interface ChatResponse {
  content: string
  usage?: { inputTokens: number; outputTokens: number }
}

export interface LLMProvider {
  name: string
  chat(req: ChatRequest): Promise<ChatResponse>
}

export interface GatewayOptions {
  rpm?: number
  timeoutMs?: number
  maxRetries?: number
}

export class LLMGateway {
  private providers = new Map<string, LLMProvider>()
  private queues = new Map<string, Promise<unknown>>()

  constructor(private opts: GatewayOptions = {}) {}

  registerProvider(provider: LLMProvider): () => void {
    if (this.providers.has(provider.name)) throw new Error(`provider already registered: ${provider.name}`)
    this.providers.set(provider.name, provider)
    return () => {
      if (this.providers.get(provider.name) === provider) this.providers.delete(provider.name)
    }
  }

  getProvider(name: string): LLMProvider | undefined {
    return this.providers.get(name)
  }

  /** 经队列 + 限流 + 超时 + 重试的调用 */
  async chat(request: ChatRequest): Promise<ChatResponse> {
    const provider = this.providers.get(request.provider ?? '')
    if (!provider) {
      // 2.0.7：provider 缺失不再静默（原来请求直接 NO_ADAPTER 原始错误）——明确中文引导
      throw new LLMError(
        LLM_ERROR_CODES.LLM_NO_ADAPTER,
        request.provider
          ? `模型服务不可用（provider "${request.provider}" 未注册：内核未加载对应模型配置，请重启应用）`
          : '未配置模型服务：请在「设置 → 模型」添加模型来源（API Key），或设置 DEEPSEEK_API_KEY 环境变量',
        { detail: request.provider ? `NO_ADAPTER: ${request.provider}` : 'NO_ADAPTER: (none)' },
      )
    }
    const prev = this.queues.get(request.provider ?? '') ?? Promise.resolve()
    const run = prev.then(() => this.dispatchWithRetry(provider, request))
    // 队列失败不影响后续（catch 吞掉，让下一次从 prev 链继续）
    this.queues.set(request.provider ?? '', run.catch(() => undefined))
    return run
  }

  private async dispatchWithRetry(provider: LLMProvider, request: ChatRequest): Promise<ChatResponse> {
    const { rpm = 60, timeoutMs = 120_000, maxRetries = 2 } = this.opts
    const intervalMs = Math.ceil(60_000 / rpm)
    let lastError: unknown
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = intervalMs * 2 ** (attempt - 1)
        await sleep(delay)
      }
      try {
        return await withTimeout(provider.chat(request), timeoutMs, request.signal)
      } catch (error) {
        lastError = error
        if (request.signal?.aborted) throw error
      }
    }
    // 2.0.7：重试耗尽——LLMError 原样抛（保留分类）；其他错误包装为 LLM_RETRIES_EXHAUSTED
    if (lastError instanceof LLMError) throw lastError
    throw new LLMError(LLM_ERROR_CODES.LLM_RETRIES_EXHAUSTED, '模型调用重试后仍失败', {
      detail: lastError instanceof Error ? lastError.message.slice(0, 300) : String(lastError),
    })
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new LLMError(LLM_ERROR_CODES.LLM_TIMEOUT, `模型响应超时（${Math.round(timeoutMs / 1000)}s）`))
    }, timeoutMs)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new Error('aborted'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Mock provider（开发/测试用）：按模型名返回固定内容；支持可编程响应 */
export class MockProvider implements LLMProvider {
  name = 'mock'
  constructor(private responder: (req: ChatRequest) => string = () => '{"reply":"(mock) 收到"}\n') {}

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const content = this.responder(req)
    return { content, usage: { inputTokens: estimateTokens(req.messages), outputTokens: estimateTokens([{ role: 'assistant', content }]) } }
  }
}

export function estimateTokens(messages: ChatMessage[]): number {
  let chars = 0
  for (const m of messages) chars += m.content.length
  return Math.ceil(chars / 4)
}
