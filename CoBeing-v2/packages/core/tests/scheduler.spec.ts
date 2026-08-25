import { describe, expect, it } from 'vitest'
import { ToolScheduler } from '../src/scheduler/scheduler.js'
import { DefaultToolRegistry } from '../src/tools/registry.js'
import type { ToolResult, ToolRunContext } from '@cobeing/types'

function makeCtx(): ToolRunContext {
  return {
    agent: 'a1',
    group: 'g1',
    cwd: '/tmp',
    guard: { assert: (p) => p, inside: () => true },
    signal: new AbortController().signal,
    speak: async () => {},
    writePrivate: async () => {},
  }
}

function makeRegistry(): DefaultToolRegistry {
  const registry = new DefaultToolRegistry()
  registry.register({
    name: 'fast',
    description: 'fast parallel tool',
    schema: {},
    mode: 'parallel',
    execute: async () => ({ ok: true, content: 'fast-done' }),
  })
  registry.register({
    name: 'slow',
    description: 'slow exclusive tool',
    schema: {},
    mode: 'exclusive',
    execute: async () => {
      await new Promise((r) => setTimeout(r, 30))
      return { ok: true, content: 'slow-done' }
    },
  })
  registry.register({
    name: 'fails',
    description: 'failing tool',
    schema: {},
    mode: 'parallel',
    execute: async () => ({ ok: false, content: 'boom', error: { message: 'boom' } }),
  })
  return registry
}

describe('ToolScheduler', () => {
  it('排他工具形成屏障：串行执行', async () => {
    const registry = makeRegistry()
    const scheduler = new ToolScheduler(registry, 10)
    const order: string[] = []
    const hooks = {
      onCall: async (call: { name: string }) => { order.push(`call:${call.name}`) },
      onResult: async (call: { name: string }) => { order.push(`result:${call.name}`) },
      onSynthetic: async () => { order.push('synthetic') },
    }
    await scheduler.execute(
      [{ callId: '1', name: 'slow', args: {} }, { callId: '2', name: 'fast', args: {} }],
      makeCtx(),
      hooks,
      new AbortController().signal,
    )
    expect(order).toEqual(['call:slow', 'result:slow', 'call:fast', 'result:fast'])
  })

  it('并行池有界并发且结果保持模型序', async () => {
    const registry = makeRegistry()
    const scheduler = new ToolScheduler(registry, 2)
    const completed: string[] = []
    const hooks = {
      onCall: async (call: { callId: string }) => { /* noop */ },
      onResult: async (call: { callId: string }, result: ToolResult) => {
        completed.push(`${call.callId}:${result.content}`)
      },
      onSynthetic: async () => {},
    }
    await scheduler.execute(
      [{ callId: '1', name: 'fast', args: {} }, { callId: '2', name: 'fast', args: {} }],
      makeCtx(),
      hooks,
      new AbortController().signal,
    )
    // 模型序提交：1 先于 2，即使并行完成
    expect(completed).toEqual(['1:fast-done', '2:fast-done'])
  })

  it('工具失败只落槽位，不终止批内后续', async () => {
    const registry = makeRegistry()
    const scheduler = new ToolScheduler(registry, 10)
    const results: Array<{ callId: string; ok: boolean }> = []
    const hooks = {
      onCall: async () => {},
      onResult: async (call: { callId: string }, result: ToolResult) => {
        results.push({ callId: call.callId, ok: result.ok })
      },
      onSynthetic: async () => {},
    }
    await scheduler.execute(
      [{ callId: '1', name: 'fails', args: {} }, { callId: '2', name: 'fast', args: {} }],
      makeCtx(),
      hooks,
      new AbortController().signal,
    )
    expect(results).toEqual([{ callId: '1', ok: false }, { callId: '2', ok: true }])
  })

  it('未知工具返回 TOOL_NOT_FOUND', async () => {
    const registry = makeRegistry()
    const scheduler = new ToolScheduler(registry, 10)
    let content = ''
    const hooks = {
      onCall: async () => {},
      onResult: async (_call: { callId: string }, result: ToolResult) => { content = result.content },
      onSynthetic: async () => {},
    }
    await scheduler.execute(
      [{ callId: '1', name: 'nope', args: {} }],
      makeCtx(),
      hooks,
      new AbortController().signal,
    )
    expect(content).toContain('TOOL_NOT_FOUND')
  })

  it('abort：已启动排干、未派发写合成结果', async () => {
    const registry = makeRegistry()
    const scheduler = new ToolScheduler(registry, 1)
    const controller = new AbortController()
    const synthetic: string[] = []
    const hooks = {
      onCall: async () => {},
      onResult: async () => {},
      onSynthetic: async (call: { callId: string }) => { synthetic.push(call.callId) },
    }
    // slow 独占（30ms）；第二个调用在 abort 时未派发 → 合成
    const promise = scheduler.execute(
      [{ callId: '1', name: 'slow', args: {} }, { callId: '2', name: 'fast', args: {} }],
      makeCtx(),
      hooks,
      controller.signal,
    )
    setTimeout(() => controller.abort(), 5)
    const outcome = await promise
    expect(outcome.aborted).toBe(true)
    expect(synthetic).toEqual(['2'])
  })
})
