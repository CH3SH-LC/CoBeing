/**
 * 模型调用错误体系（2.0.7：取消 mock 静默回退 → 全链路可诊断报错）
 *
 * - 所有模型调用失败统一抛 LLMError（code + 中文 message），GUI/群组/手机端经
 *   [工作失败] 发言与 notify 可见；日志 request/error 落盘同一 code。
 * - 错误码清单（docs/v2-模型错误码清单.md 同步维护）：
 *   LLM_CONFIG_MISSING    未配置模型服务（无 API Key / 智能体无 provider）
 *   LLM_NO_ADAPTER        provider 未注册（如名录 deepseek 但内核无 key）
 *   LLM_NETWORK           网络不可达（DNS/连接/TLS/代理）
 *   LLM_TIMEOUT           请求超时
 *   LLM_API_401           API Key 无效/过期
 *   LLM_API_402           余额不足
 *   LLM_API_404           地址或模型不存在
 *   LLM_API_429           触发限流
 *   LLM_API_5XX           模型服务端错误
 *   LLM_MODEL_NOT_FOUND   模型名不存在
 *   LLM_CONTEXT_OVERFLOW  上下文超过模型限制
 *   LLM_EMPTY_RESPONSE    模型返回空内容（推理模型 content 空 / 截断）
 *   LLM_RETRIES_EXHAUSTED 网关重试后仍失败（保留原始错误为 detail）
 */

export const LLM_ERROR_CODES = {
  LLM_CONFIG_MISSING: 'LLM_CONFIG_MISSING',
  LLM_NO_ADAPTER: 'LLM_NO_ADAPTER',
  LLM_NETWORK: 'LLM_NETWORK',
  LLM_TIMEOUT: 'LLM_TIMEOUT',
  LLM_API_401: 'LLM_API_401',
  LLM_API_402: 'LLM_API_402',
  LLM_API_404: 'LLM_API_404',
  LLM_API_429: 'LLM_API_429',
  LLM_API_5XX: 'LLM_API_5XX',
  LLM_MODEL_NOT_FOUND: 'LLM_MODEL_NOT_FOUND',
  LLM_CONTEXT_OVERFLOW: 'LLM_CONTEXT_OVERFLOW',
  LLM_EMPTY_RESPONSE: 'LLM_EMPTY_RESPONSE',
  LLM_RETRIES_EXHAUSTED: 'LLM_RETRIES_EXHAUSTED',
} as const

export type LLMErrorCode = (typeof LLM_ERROR_CODES)[keyof typeof LLM_ERROR_CODES]

/** 模型调用错误（统一抛出；message 为用户可读中文） */
export class LLMError extends Error {
  readonly code: LLMErrorCode
  /** 原始错误/HTTP 详情（诊断用；可空） */
  readonly detail?: string
  readonly status?: number

  constructor(code: LLMErrorCode, message: string, opts: { detail?: string; status?: number } = {}) {
    super(message)
    this.name = 'LLMError'
    this.code = code
    this.detail = opts.detail
    this.status = opts.status
  }

  /** 人类可读一行（发言/日志展示） */
  toDisplay(): string {
    return `${this.code}：${this.message}${this.detail ? `（${this.detail}）` : ''}`
  }
}

/** 是否是 LLMError（或含 LLM_ 前缀的错误消息） */
export function isLLMError(error: unknown): error is LLMError {
  return error instanceof LLMError
}

/**
 * 分类 fetch 网络错误（TypeError: Failed to fetch / ENOTFOUND / ECONNREFUSED / ETIMEDOUT / TLS）。
 * 非网络错误原样返回。
 */
export function classifyNetworkError(error: unknown): LLMError | null {
  if (!(error instanceof Error)) return null
  const msg = error.message ?? ''
  if (/fetch failed|failed to fetch|enotfound|eai_again|getaddrinfo/i.test(msg)) {
    return new LLMError(LLM_ERROR_CODES.LLM_NETWORK, '无法连接模型服务（域名解析失败）', { detail: msg.slice(0, 200) })
  }
  if (/econnrefused|connection refused/i.test(msg)) {
    return new LLMError(LLM_ERROR_CODES.LLM_NETWORK, '无法连接模型服务（连接被拒绝，检查 Base URL）', { detail: msg.slice(0, 200) })
  }
  if (/etimedout|timeout|timed out/i.test(msg)) {
    return new LLMError(LLM_ERROR_CODES.LLM_TIMEOUT, '连接模型服务超时', { detail: msg.slice(0, 200) })
  }
  if (/certificate|tls|ssl|socket hang up|econnreset|network/i.test(msg)) {
    return new LLMError(LLM_ERROR_CODES.LLM_NETWORK, '模型服务网络异常（TLS/连接被重置）', { detail: msg.slice(0, 200) })
  }
  return null
}

/** 按 HTTP 状态 + 响应体分类 API 错误 */
export function classifyHttpError(status: number, body: string, url: string): LLMError {
  const detail = body.slice(0, 300) || `HTTP ${status}`
  switch (status) {
    case 401:
      return new LLMError(LLM_ERROR_CODES.LLM_API_401, 'API Key 无效或已过期（HTTP 401），请检查模型来源的 API Key', { status, detail })
    case 402:
      return new LLMError(LLM_ERROR_CODES.LLM_API_402, 'API 余额不足（HTTP 402），请前往模型服务商充值', { status, detail })
    case 404:
      return new LLMError(LLM_ERROR_CODES.LLM_API_404, '模型服务地址不存在（HTTP 404），请检查 Base URL', { status, detail })
    case 429:
      return new LLMError(LLM_ERROR_CODES.LLM_API_429, '请求过于频繁（HTTP 429 限流），请稍后重试', { status, detail })
    default:
      break
  }
  if (status >= 500) {
    return new LLMError(LLM_ERROR_CODES.LLM_API_5XX, `模型服务端错误（HTTP ${status}），请稍后重试`, { status, detail })
  }
  if (status === 400) {
    // 400 细分：模型不存在 / 上下文超长 / 其他
    if (/model.*(not found|does not exist)|invalid.*model/i.test(body)) {
      return new LLMError(LLM_ERROR_CODES.LLM_MODEL_NOT_FOUND, '模型不存在，请检查模型名称（设置 → 模型）', { status, detail })
    }
    if (/context|token|length|too (long|large)/i.test(body)) {
      return new LLMError(LLM_ERROR_CODES.LLM_CONTEXT_OVERFLOW, '上下文超过模型限制，请开启新对话或压缩', { status, detail })
    }
    return new LLMError(LLM_ERROR_CODES.LLM_MODEL_NOT_FOUND, `模型请求被拒绝（HTTP 400）：${detail}`, { status, detail })
  }
  return new LLMError(LLM_ERROR_CODES.LLM_RETRIES_EXHAUSTED, `模型调用失败（HTTP ${status}）`, { status, detail })
}

/** 空内容（choices 缺失 / content 为空）分类：区分推理模型（reasoning_content 有值） */
export function classifyEmptyResponse(body: unknown): LLMError {
  const data = body as {
    choices?: Array<{ message?: { content?: string; reasoning_content?: string }; finish_reason?: string }>
  } | null
  const choice = data?.choices?.[0]
  const reasoning = choice?.message?.reasoning_content
  if (reasoning) {
    return new LLMError(
      LLM_ERROR_CODES.LLM_EMPTY_RESPONSE,
      '模型返回空回复（推理模型思考后未输出正式内容；工具调用场景建议使用非推理模型 deepseek-chat，或增大 maxTokens）',
      { detail: `finish_reason=${choice?.finish_reason ?? '?'}` },
    )
  }
  return new LLMError(
    LLM_ERROR_CODES.LLM_EMPTY_RESPONSE,
    '模型返回空回复（响应无内容），请重试或更换模型',
    { detail: choice ? `finish_reason=${choice?.finish_reason ?? '?'}` : 'choices 为空' },
  )
}
