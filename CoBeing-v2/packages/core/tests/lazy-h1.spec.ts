/**
 * 根因验证实验（H1 修复后）：诚实审查规则 2 修正——"只说不做"的过程性发言不再放行
 *
 * 修复前：规则 2 对"过程性汇报"直接 pass → 模型被唤醒后输出纯 reply（"好的我开始了"）
 *   → 审查放行 → 发言发布 → 回合结束 → 任务未做但"看起来正常完成"（偷懒通道）。
 * 修复后：规则 2 语义修正——过程性发言须有 ≥1 条成功工具调用（[ok]）才 pass；
 *   0 成功工具调用 → fail + 引导反馈（继续真实工作），回合继续，模型调用工具后才可结束。
 * 本实验验证：① 审查工具层面对"0 工具过程性发言"判 fail、对"有成功工具记录的过程性发言"判 pass；
 *   ② 端到端：0 工具 reply → 拒绝不发布 → 继续循环 → 模型转真实工具调用 → 完成汇报发布。
 */
import { describe, expect, it, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ToolAgentRegistry, createCallToolAgentTool } from '../src/tools/call-tool-agent.js'
import { registerBuiltinToolAgents, HONESTY_INSTRUCTION } from '../src/tools/builtin-tool-agents.js'
import { ExperienceStore } from '../src/memory/store.js'
import { PathGuard } from '../src/permission/guard.js'
import type { ToolRunContext } from '@cobeing/types'
import { AgentInstance, DEFAULT_PROTOCOL_TEXT } from '../src/runtime/agent-loop.js'
import { WindowLog } from '../src/event-log/window-log.js'
import { project } from '../src/event-log/projection.js'
import { LLMGateway, MockProvider } from '../src/llm/gateway.js'
import { ToolScheduler } from '../src/scheduler/scheduler.js'
import { DefaultToolRegistry } from '../src/tools/registry.js'
import { createTodoTool, TodoStore } from '../src/tools/todo.js'

const dirs: string[] = []
function tempDir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(d)
  return d
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function fakeCtx(): ToolRunContext {
  return {
    agent: 'worker',
    group: 'lazy-g',
    cwd: tempDir('cb-h1-'),
    guard: new PathGuard(tempDir('cb-h1-'), true, 'readwrite'),
    signal: new AbortController().signal,
    speak: async () => {},
    writePrivate: async () => {},
  }
}

async function waitFor(fn: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timeout')
    await new Promise((r) => setTimeout(r, 20))
  }
}

describe('H1 修复后实验：诚实审查对"过程性 reply"的判定', () => {
  it('【诚实】审查工具：过程性发言 + 0 成功工具记录 → fail（规则 2 修正：只说不做拦截）', async () => {
    const store = new ExperienceStore(join(tempDir('cb-h1-'), 'memory'))
    let seenInstruction = ''
    const registry = new ToolAgentRegistry()
    registerBuiltinToolAgents(registry, {
      memory: store,
      llmSummarize: async (_text, instruction) => {
        seenInstruction = instruction
        return '{"pass":false,"reason":"0 次成功工具调用，只说不做"}'
      },
    })
    const spec = registry.get('诚实')!
    const result = await spec.invoke(
      { target: 'worker', claim: '好的，我开始了，正在处理。', evidence: '（无）' },
      fakeCtx(),
    )
    expect(result.content).toContain('pass=false')
    expect(seenInstruction).toContain('过程性汇报')
    expect(seenInstruction).toContain('只说不做')
    expect(seenInstruction).not.toContain('直接 pass')
  })

  it('【诚实】审查工具：过程性发言 + ≥1 条成功工具记录 → pass（真实工作在推进）', async () => {
    const store = new ExperienceStore(join(tempDir('cb-h1-'), 'memory'))
    const registry = new ToolAgentRegistry()
    registerBuiltinToolAgents(registry, {
      memory: store,
      llmSummarize: async () => '{"pass":true,"reason":"已有成功工具调用，真实工作在推进"}',
    })
    const spec = registry.get('诚实')!
    const result = await spec.invoke(
      { target: 'worker', claim: '正在继续写文件。', evidence: 'tool:str-replace-editor [ok] write a.txt' },
      fakeCtx(),
    )
    expect(result.content).toContain('pass=true')
  })

  it('【诚实】审查工具：声称完成但无证据 → fail（规则 1，这没问题）', async () => {
    const store = new ExperienceStore(join(tempDir('cb-h1-'), 'memory'))
    const registry = new ToolAgentRegistry()
    registerBuiltinToolAgents(registry, {
      memory: store,
      llmSummarize: async () => '{"pass":false,"reason":"声称完成但无工具记录"}',
    })
    const spec = registry.get('诚实')!
    const result = await spec.invoke({ target: 'worker', claim: '全部完成了！', evidence: '（无）' }, fakeCtx())
    expect(result.content).toContain('pass=false')
  })

  it('端到端：0 工具过程性 reply → 拒绝续轮 → 真实工具 → 进展发布+继续 → 完成汇报结束', async () => {
    const dir = tempDir('cb-h1-')
    const log = new WindowLog(join(dir, 'log.jsonl'))
    const gateway = new LLMGateway()
    // 模型行为链：
    //   r1 无反馈 → "好的我开始了"（0 工具）→ 诚实拒（只说不做）→ 续轮
    //   r2 诚实反馈 → 真实工具调用（todo-list add）→ 执行
    //   r3 工具结果 → 进展汇报（有工具证据）→ 诚实 pass(kind=process) → 进展发布 + 续轮
    //   r4 继续工作反馈 → 完成汇报 → 诚实 pass(kind=completion) → 发布 + 回合结束
    gateway.registerProvider(
      new MockProvider((req) => {
        const last = req.messages[req.messages.length - 1]?.content ?? ''
        if (last.includes('诚实审查')) {
          return '{"toolCalls":[{"name":"todo-list","args":{"command":"add","content":"写代码"}}]}'
        }
        if (last.includes('继续工作')) {
          return '{"reply":"完成了，fibonacci.js 已写好并验证通过"}'
        }
        if (last.includes('added')) {
          return '{"reply":"进展：todo 已建，开始写文件"}'
        }
        return '{"reply":"好的，我开始了，正在处理。"}'
      }),
    )
    const registry = new DefaultToolRegistry()
    // 注册 todo-list（模型第 2 轮真实调用的工具）
    const todoStore = new TodoStore(async (group, agent, todos) => {
      await log.append({ type: 'todo/write', actor: agent, todos })
    })
    registry.register(createTodoTool(todoStore))
    // 注册【诚实】审查（真实接线：llmSummarize 模拟修正后规则 2 + kind 分类——
    // 无 [ok] 证据 fail；有证据且过程性 → pass+process；有证据且完成声称 → pass+completion）
    const store = new ExperienceStore(join(dir, 'memory'))
    const toolAgents = new ToolAgentRegistry()
    registerBuiltinToolAgents(toolAgents, {
      memory: store,
      llmSummarize: async (text, _instruction) => {
        if (!/\[ok\]/.test(text)) {
          return '{"pass":false,"reason":"0 次成功工具调用，请先真实调用工具完成工作"}'
        }
        return text.includes('进展')
          ? '{"pass":true,"kind":"process","reason":"进展已发布，继续工作"}'
          : '{"pass":true,"kind":"completion","reason":"已有成功工具调用"}'
      },
    })
    const agent = new AgentInstance({
      def: { name: 'worker', role: '编程智能体', provider: 'mock', model: 'm', maxTokens: 2048, createdAt: Date.now() },
      group: 'lazy-g',
      cwd: dir,
      log,
      projection: () => project(log.readCached()),
      gateway,
      scheduler: new ToolScheduler(registry, 10),
      registry,
      memory: store,
      guard: new PathGuard(dir, true, 'readwrite'),
      protocolText: DEFAULT_PROTOCOL_TEXT,
      maxToolRounds: 6,
      honesty: async (claim, evidence) => {
        const spec = toolAgents.get('诚实')!
        const r = await spec.invoke({ target: 'worker', claim, evidence }, fakeCtx())
        const m = r.content.match(/pass=(true|false) kind=(\w+)/)
        return { pass: m?.[1] === 'true', kind: (m?.[2] as 'completion' | 'process' | 'other') ?? 'other', reason: r.content }
      },
    })
    agent.wake({ content: '写一个 fibonacci.js 并验证', task: '写 fibonacci.js' })
    // 等待回合收敛：出现最终完成汇报
    await waitFor(() => {
      const speaks = log.readCached().filter((e) => e.type === 'speak' && e.actor === 'worker')
      return speaks.some((s) => (s as { content: string }).content.includes('完成了'))
    })
    const events = log.readCached()
    const speaks = events.filter((e) => e.type === 'speak' && e.actor === 'worker') as Array<{ content: string }>
    const calls = events.filter((e) => e.type === 'tool/call' && e.actor === 'worker')
    console.log('  实验结果：发言', speaks.length, '条；工具调用', calls.length, '次')
    // 修复后关键断言：模型最终真实调用了工具（0 工具偷懒通道被堵）
    expect(calls.length).toBeGreaterThanOrEqual(1)
    // "好的我开始了"未发布（只说不做被拦截）
    expect(speaks.some((s) => s.content.includes('开始了'))).toBe(false)
    // 进展汇报已发布（有工具证据 → 放行），且回合继续（不是结束出口）
    expect(speaks.some((s) => s.content.includes('进展'))).toBe(true)
    // 最终完成汇报发布，回合收敛
    expect(speaks.some((s) => s.content.includes('完成了'))).toBe(true)
    expect(agent.status).toBe('idle')
  })
})
