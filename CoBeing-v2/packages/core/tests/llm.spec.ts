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

  it('401 抛错且含状态与 body 摘要', async () => {
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
    await expect(
      provider.chat({ provider: 'deepseek', model: 'deepseek-chat', messages: [] }),
    ).rejects.toThrow('DeepSeek API error 401')
  })

  it('无 apiKey 时抛错并回退读取环境变量', async () => {
    delete process.env.DEEPSEEK_API_KEY
    expect(() => new DeepSeekProvider()).toThrow('DeepSeekProvider: DEEPSEEK_API_KEY 未配置')
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
