/**
 * AgentInstance 原体循环单测：轮次完成钩子（onTurnComplete）
 *
 * 直接构造 AgentInstance（mock gateway），验证：
 * - 一轮工作结束后回调恰好一次（busy→idle 之后；dsh 对齐：主窗口管家轮后自动压缩）
 * - 钩子抛错不阻塞主流程（排队唤醒继续处理）
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { AgentDef } from '@cobeing/types'
import { WindowLog } from '../src/event-log/window-log.js'
import { project } from '../src/event-log/projection.js'
import { LLMGateway, MockProvider, type ChatRequest } from '../src/llm/gateway.js'
import { ExperienceStore } from '../src/memory/store.js'
import { PathGuard } from '../src/permission/guard.js'
import { AgentInstance, DEFAULT_PROTOCOL_TEXT, parseModelOutput } from '../src/runtime/agent-loop.js'
import { ToolScheduler } from '../src/scheduler/scheduler.js'
import { DefaultToolRegistry } from '../src/tools/registry.js'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function makeAgent(opts: {
  onTurnComplete?: () => void | Promise<void>
  responder?: (req: ChatRequest) => string
  honesty?: (claim: string, evidence: string) => Promise<{ pass: boolean; reason: string }>
  maxHonestyRetries?: number
  maxToolRounds?: number
}) {
  const dir = mkdtempSync(join(tmpdir(), 'cb-agentloop-'))
  dirs.push(dir)
  const log = new WindowLog(join(dir, 'log.jsonl'))
  const gateway = new LLMGateway()
  gateway.registerProvider(new MockProvider(opts.responder ?? (() => '{"reply":"ok"}')))
  const registry = new DefaultToolRegistry()
  const def: AgentDef = { name: 'tester', role: '测试员', provider: 'mock', model: 'm', maxTokens: 200, createdAt: Date.now() }
  const agent = new AgentInstance({
    def,
    group: 'main',
    cwd: dir,
    log,
    projection: () => project(log.readCached()),
    gateway,
    scheduler: new ToolScheduler(registry, 10),
    registry,
    memory: new ExperienceStore(join(dir, 'memory')),
    guard: new PathGuard(dir, true, 'readwrite'),
    protocolText: DEFAULT_PROTOCOL_TEXT,
    maxToolRounds: opts.maxToolRounds ?? 3,
    onTurnComplete: opts.onTurnComplete,
    honesty: opts.honesty,
    maxHonestyRetries: opts.maxHonestyRetries,
  })
  return { agent, log }
}

async function waitFor(fn: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timeout')
    await new Promise((r) => setTimeout(r, 20))
  }
}

/** 收窄 speak 事件（SessionEvent 联合类型） */
function speakEvents(log: WindowLog, actor: string): Array<{ content: string; actor: string }> {
  return log
    .readCached()
    .filter((e): e is Extract<typeof e, { type: 'speak' }> => e.type === 'speak' && e.actor === actor)
    .map((e) => ({ content: e.content, actor: e.actor }))
}

describe('AgentInstance onTurnComplete 轮次完成钩子', () => {
  test('一轮工作结束后回调恰好一次（busy→idle 之后）', async () => {
    const onTurnComplete = vi.fn()
    const { agent } = makeAgent({ onTurnComplete })
    agent.wake({ content: 'hello' })
    await waitFor(() => onTurnComplete.mock.calls.length === 1)
    expect(agent.status).toBe('idle')
    expect(onTurnComplete).toHaveBeenCalledTimes(1)
  })

  test('钩子抛错不阻塞主流程：排队唤醒继续完成', async () => {
    let calls = 0
    const { agent } = makeAgent({
      onTurnComplete: () => {
        calls++
        if (calls === 1) throw new Error('hook boom')
      },
    })
    agent.wake({ content: 'a' })
    agent.wake({ content: 'b' }) // busy 时排队
    await waitFor(() => calls >= 2)
    expect(agent.status).toBe('idle')
  })
})

describe('AgentInstance 发言真实性审查（【诚实】接线）', () => {
  test('审查通过 → 发言正常发布', async () => {
    const honesty = vi.fn<(claim: string, evidence: string) => Promise<{ pass: boolean; reason: string }>>(async () => ({ pass: true, reason: '有工具证据' }))
    const { agent, log } = makeAgent({
      responder: () => '{"reply":"任务完成，文件已生成"}',
      honesty,
    })
    agent.wake({ content: 'hello' })
    await waitFor(() => log.readCached().some((e) => e.type === 'speak' && e.actor === 'tester'))
    expect(honesty).toHaveBeenCalledTimes(1)
    // 证据含工具记录（空档案时为（无））
    expect(String(honesty.mock.calls[0]![0])).toContain('任务完成')
    const speaks = speakEvents(log, 'tester')
    expect(speaks.some((s) => s.content.includes('文件已生成'))).toBe(true)
  })

  test('审查拒绝 → 发言不发布，反馈下一轮后模型重新发言（再次通过则发布）', async () => {
    let calls = 0
    const honesty = vi.fn(async () => {
      calls++
      // 第一次拒绝（声称完成但无工具证据），第二轮放行
      return calls === 1 ? { pass: false, reason: '声称完成但无工具调用记录' } : { pass: true, reason: '现在有工具证据了' }
    })
    const { agent, log } = makeAgent({
      responder: (req) => {
        const last = req.messages[req.messages.length - 1]?.content ?? ''
        // 第一轮：声称完成；第二轮（收到诚实反馈后）：重新声称完成
        return last.includes('诚实审查') ? '{"reply":"已完成，文件已写入"}' : '{"reply":"任务完成，文件已生成"}'
      },
      honesty,
    })
    agent.wake({ content: 'hello' })
    await waitFor(() => honesty.mock.calls.length >= 2)
    const speaks = speakEvents(log, 'tester')
    expect(speaks.length).toBe(1) // 只有第二轮通过后的发言
    expect(speaks[0]!.content).toContain('文件已写入')
    // 被拒发言未发布
    expect(speaks[0]!.content).not.toContain('文件已生成')
  })

  test('连续被拒达上限 → 放弃发言（幻觉不发布，防刷屏）', async () => {
    const honesty = vi.fn(async () => ({ pass: false, reason: '声称完成但无工具证据' }))
    const { agent, log } = makeAgent({
      responder: () => '{"reply":"任务完成"}',
      honesty,
      maxHonestyRetries: 2,
    })
    agent.wake({ content: 'hello' })
    // 等待回合收敛（honesty 调用 ≥ 2 次即达上限）
    await waitFor(() => honesty.mock.calls.length >= 2)
    await new Promise((r) => setTimeout(r, 100))
    const speaks = speakEvents(log, 'tester')
    expect(speaks.length).toBe(0) // 无任何发言发布
  })

  test('审查抛错 → 放行（不阻塞正常交流）', async () => {
    const honesty = vi.fn(async () => {
      throw new Error('llm down')
    })
    const { agent, log } = makeAgent({ responder: () => '{"reply":"正常汇报"}', honesty })
    agent.wake({ content: 'hello' })
    await waitFor(() => log.readCached().some((e) => e.type === 'speak' && e.actor === 'tester'))
    const speaks = speakEvents(log, 'tester')
    expect(speaks.some((s) => s.content.includes('正常汇报'))).toBe(true)
  })

  test('截断的工具调用 JSON：不发布发言，反馈模型分块写入后继续', async () => {
    const { agent, log } = makeAgent({
      responder: (req) => {
        const last = req.messages[req.messages.length - 1]?.content ?? ''
        // 第一轮：截断的 toolCalls（未闭合 JSON，模拟 maxTokens 截断）
        if (!last.includes('输出截断')) {
          return '{"toolCalls":[{"name":"str-replace-editor","args":{"command":"write","path":"index.html","content":"<!DOCTYPE html>\\n<canvas id=g></canvas>\\n<script>\\nconst ctx = document.getElementById(g).getContext(2d);\\nctx.fillRect(0,0,10,10)'
        }
        // 第二轮：收到截断反馈后正常完成
        return '{"reply":"已分块完成 index.html"}'
      },
    })
    agent.wake({ content: 'hello' })
    await waitFor(() => {
      const speaks = speakEvents(log, 'tester')
      return speaks.some((s) => s.content.includes('分块完成'))
    })
    const speaks = speakEvents(log, 'tester')
    // 截断的 JSON 不得作为发言发布
    expect(speaks.some((s) => s.content.includes('toolCalls'))).toBe(false)
    expect(speaks.some((s) => s.content.includes('分块完成'))).toBe(true)
  })

  test('parseModelOutput 截断检测：未闭合 toolCalls JSON → truncated=true', () => {
    const truncated = '{"toolCalls":[{"name":"str-replace-editor","args":{"command":"write","path":"index.html","content":"<html>\\n<script>\\nconst a=1;\\n"}}'
    expect(parseModelOutput(truncated).truncated).toBe(true)
    expect(parseModelOutput(truncated).reply).toBeUndefined()
    // 完整 JSON 不受影响
    const ok = parseModelOutput('{"toolCalls":[{"name":"todo-list","args":{"command":"add","content":"x"}}]}')
    expect(ok.truncated).toBeUndefined()
    expect(ok.toolCalls).toHaveLength(1)
    // 纯文本发言不受影响
    expect(parseModelOutput('你好').reply).toBe('你好')
  })
})
