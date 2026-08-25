/**
 * 根因验证实验（H2 修复后）：任务锚点保留——工具执行后下一轮组装仍含 [任务说明]
 *
 * 修复前：第 2 轮 [唤醒内容] 空、[任务说明] 消失 → 模型从高噪声公共上下文里"考古"任务目标
 *   → 多步调用时任务目标弱化（群组偷懒的引擎级原因之一）。
 * 修复后（对齐 dsh 全量历史在场）：run() 保留 anchorTask，每轮组装都带 [任务说明]；
 *   且 renderPublic 在公共上下文渲染 [任务: ...]。
 * 本实验：记录每轮完整 userText，断言第 2 轮仍含 [任务说明]。
 */
import { describe, expect, it, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentInstance, DEFAULT_PROTOCOL_TEXT } from '../src/runtime/agent-loop.js'
import { WindowLog } from '../src/event-log/window-log.js'
import { project } from '../src/event-log/projection.js'
import { LLMGateway, MockProvider, type ChatRequest } from '../src/llm/gateway.js'
import { ToolScheduler } from '../src/scheduler/scheduler.js'
import { DefaultToolRegistry } from '../src/tools/registry.js'
import { ExperienceStore } from '../src/memory/store.js'
import { PathGuard } from '../src/permission/guard.js'

const dirs: string[] = []
function tempDir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(d)
  return d
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('H2 修复后实验：多步调用中任务锚点（唤醒内容/任务说明）', () => {
  it('第 2 轮仍含 [任务说明]：任务锚点跨轮保留（模型每轮都看到任务目标）', async () => {
    const dir = tempDir('cb-h2-')
    const log = new WindowLog(join(dir, 'log.jsonl'))
    const seenUsers: string[] = []
    let round = 0
    const gateway = new LLMGateway()
    gateway.registerProvider(
      new MockProvider((req: ChatRequest) => {
        const user = req.messages[req.messages.length - 1]?.content ?? ''
        seenUsers.push(user)
        round++
        // 第 1 轮：调工具（todo-list）；第 2 轮：完成
        if (round === 1) {
          return '{"toolCalls":[{"name":"todo-list","args":{"command":"add","content":"写代码"}}]}'
        }
        return '{"reply":"完成"}'
      }),
    )
    const registry = new DefaultToolRegistry()
    const agent = new AgentInstance({
      def: { name: 'worker', role: '编程智能体', provider: 'mock', model: 'm', maxTokens: 2048, createdAt: Date.now() },
      group: 'lazy-g',
      cwd: dir,
      log,
      projection: () => project(log.readCached()),
      gateway,
      scheduler: new ToolScheduler(registry, 10),
      registry,
      memory: new ExperienceStore(join(dir, 'memory')),
      guard: new PathGuard(dir, true, 'readwrite'),
      protocolText: DEFAULT_PROTOCOL_TEXT,
      maxToolRounds: 5,
    })
    agent.wake({ content: '帮我写 fibonacci.js 并验证', task: '写 fibonacci.js' })
    await new Promise((r) => setTimeout(r, 600))

    expect(seenUsers.length).toBeGreaterThanOrEqual(2)
    const first = seenUsers[0]!
    const second = seenUsers[1]!
    console.log('\n===== 第 1 轮 userText（关键段）=====')
    console.log(first.split('[公共上下文]')[0]!.slice(-400))
    console.log('\n===== 第 2 轮 userText（关键段）=====')
    console.log(second.split('[公共上下文]')[0]!.slice(-400))

    // 修复后断言：第 1 轮有 [唤醒内容] 与 [任务说明]；第 2 轮 [任务说明] 仍在（锚点保留）
    expect(first).toContain('[唤醒内容] 帮我写 fibonacci.js 并验证')
    expect(first).toContain('[任务说明] 写 fibonacci.js')
    expect(second).toContain('[任务说明] 写 fibonacci.js')
    // 唤醒内容本身照旧清空（公共上下文已带用户消息），但任务目标不丢
    expect(second).toContain('[唤醒内容] ')
  })
})
