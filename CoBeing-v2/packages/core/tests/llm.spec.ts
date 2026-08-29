import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { DeepSeekProvider } from '../src/llm/deepseek.js'

describe('DeepSeekProvider', () => {
  const realKey = process.env.DEEPSEEK_API_KEY

  afterEach(() => {
    vi.unstubAllGlobals()
    if (realKey === undefined) delete process.env.DEEPSEEK_API_KEY
    else process.env.DEEPSEEK_API_KEY = realKey
  })

  it('正常 200 响应解析 content 与 usage', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '你好' } }],
          usage: { prompt_tokens: 12, completion_tokens: 3 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const provider = new DeepSeekProvider({ apiKey: 'test-key', baseUrl: 'https://api.example.com' })
    const res = await provider.chat({
      provider: 'deepseek',
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: 'hi' }],
    })

    expect(res.content).toBe('你好')
    expect(res.usage).toEqual({ inputTokens: 12, outputTokens: 3 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.example.com/chat/completions')
    expect(init?.method).toBe('POST')
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer test-key' })
  })

  it('401 抛 LLMError 且含中文引导与状态', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: 'Invalid API key' } }), {
          status: 401,
          statusText: 'Unauthorized',
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )

    const provider = new DeepSeekProvider({ apiKey: 'bad-key' })
    const error = await provider
      .chat({ provider: 'deepseek', model: 'deepseek-chat', messages: [] })
      .then(() => null, (e) => e)
    expect(error).toBeInstanceOf(Error)
    expect(error?.message).toContain('API Key 无效或已过期')
    expect(error?.message).toContain('401')
    expect(error?.code).toBe('LLM_API_401')
  })

  it('402/429/5xx 分类为对应 LLMError', async () => {
    const cases: Array<{ status: number; code: string }> = [
      { status: 402, code: 'LLM_API_402' },
      { status: 429, code: 'LLM_API_429' },
      { status: 500, code: 'LLM_API_5XX' },
    ]
    for (const c of cases) {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'x' } }), { status: c.status })),
      )
      const provider = new DeepSeekProvider({ apiKey: 'k' })
      const error = await provider.chat({ provider: 'deepseek', model: 'm', messages: [] }).then(() => null, (e) => e)
      expect(error?.code).toBe(c.code)
    }
  })

  it('网络错误（fetch reject）分类为 LLM_NETWORK', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const provider = new DeepSeekProvider({ apiKey: 'k' })
    const error = await provider.chat({ provider: 'deepseek', model: 'm', messages: [] }).then(() => null, (e) => e)
    expect(error?.code).toBe('LLM_NETWORK')
    expect(error?.message).toContain('无法连接模型服务')
  })

  it('空 content（推理模型 reasoning_content）→ LLM_EMPTY_RESPONSE 且提示换模型', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ choices: [{ message: { content: '', reasoning_content: 'thinking...' }, finish_reason: 'length' }] }),
          { status: 200 },
        ),
      ),
    )
    const provider = new DeepSeekProvider({ apiKey: 'k' })
    const error = (await provider
      .chat({ provider: 'deepseek', model: 'deepseek-v4-flash', messages: [] })
      .then(() => null, (e) => e)) as { code?: string; message?: string } | null
    expect(error?.code).toBe('LLM_EMPTY_RESPONSE')
    expect(error?.message).toContain('推理模型')
  })

  it('无 apiKey 时抛 LLM_CONFIG_MISSING 中文引导', async () => {
    delete process.env.DEEPSEEK_API_KEY
    const error = (() => {
      try {
        new DeepSeekProvider()
        return null
      } catch (e) {
        return e as { code?: string; message?: string }
      }
    })()
    expect(error?.code).toBe('LLM_CONFIG_MISSING')
    expect(error?.message).toContain('未配置 API Key')
  })

  it('signal 透传至 fetch 的 options.signal', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const controller = new AbortController()
    const provider = new DeepSeekProvider({ apiKey: 'test-key' })
    await provider.chat({
      provider: 'deepseek',
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: 'hi' }],
      signal: controller.signal,
    })

    const [, init] = fetchMock.mock.calls[0]
    expect(init?.signal).toBe(controller.signal)
  })

  it('无 maxTokens 时不传 max_tokens，有则传入', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({ choices: [{ message: { content: 'x' } }] }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        ),
      )
    vi.stubGlobal('fetch', fetchMock)

    const provider = new DeepSeekProvider({ apiKey: 'test-key' })
    await provider.chat({ provider: 'deepseek', model: 'm', messages: [] })
    const [, initNoMax] = fetchMock.mock.calls[0]
    const bodyNoMax = JSON.parse(initNoMax?.body as string)
    expect(bodyNoMax.max_tokens).toBeUndefined()

    await provider.chat({ provider: 'deepseek', model: 'm', messages: [], maxTokens: 128 })
    const [, initMax] = fetchMock.mock.calls[1]
    const bodyMax = JSON.parse(initMax?.body as string)
    expect(bodyMax.max_tokens).toBe(128)
  })
})
