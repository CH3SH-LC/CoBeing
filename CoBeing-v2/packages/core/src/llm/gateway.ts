/**
 * LLM 网关（架构 §5 模型路由）
 *
 * - Provider 注册（注册皆 effect）；每 provider 一个串行队列（并发 1）。
 * - 限流（RPM）、超时、重试（指数退避）——参数可配置。
 * - DeepSeek 真实适配器见 ./deepseek.ts（gateway.ts 内不再保留占位，避免重复导出）。
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
}

export interface ChatRequest {
  provider: string
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
    const provider = this.providers.get(request.provider)
    if (!provider) throw new Error(`NO_ADAPTER: ${request.provider}`)
    const prev = this.queues.get(request.provider) ?? Promise.resolve()
    const run = prev.then(() => this.dispatchWithRetry(provider, request))
    // 队列失败不影响后续（catch 吞掉，让下一次从 prev 链继续）
    this.queues.set(request.provider, run.catch(() => undefined))
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
    throw lastError
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`llm timeout after ${timeoutMs}ms`)), timeoutMs)
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
