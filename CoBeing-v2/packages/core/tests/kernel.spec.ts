/**
 * Kernel 集成测试：主窗口管家循环 / 群组全流程 / butler 只读 / 同名重建归档隔离 / 归档压缩
 *
 * 全部使用 MockProvider 可编程响应驱动（真实 LLM 环节由网关隔离）。
 */

import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { Kernel } from '../src/kernel.js'
import type { ChatRequest, LLMProvider } from '../src/llm/gateway.js'
import { BUTLER_ARCHIVE_THRESHOLD_TOKENS } from '../src/runtime/butler.js'
import type { NotifyPayload } from '@cobeing/types'

interface TestCtx {
  kernel: Kernel
  dir: string
}

async function setup(responder?: (req: ChatRequest) => string): Promise<TestCtx> {
  const dir = mkdtempSync(join(tmpdir(), 'cb-kernel-'))
  const kernel = new Kernel(dir, {
    mockResponder: responder ?? defaultResponder,
    notifyUser: () => undefined,
  })
  await kernel.start()
  // 统一注册测试成员（规格：群组 label 成员必须在名录；worker/coder 供多数用例复用）
  await kernel.requestCreateAgent({ name: 'worker', role: '工作者', createdAt: Date.now() })
  await kernel.confirmAgent('worker')
  await kernel.requestCreateAgent({ name: 'coder', role: '编程', createdAt: Date.now() })
  await kernel.confirmAgent('coder')
  return { kernel, dir }
}

/** 默认响应：纯文本回复 */
function defaultResponder(_req: ChatRequest): string {
  return '{"reply":"(mock) 已收到"}'
}

/** 按最后 user 消息内容分派的响应器（注意：公共上下文含历史消息，先匹配更具体的唤醒指令） */
function routingResponder(req: ChatRequest): string {
  const last = req.messages[req.messages.length - 1]?.content ?? ''
  if (last.includes('转告用户')) {
    return '{"toolCalls":[{"name":"butler-relay","args":{"content":"任务完成","kind":"report"}}]}'
  }
  if (last.includes('欢迎语')) return '{"reply":"欢迎来到 CoBeing！"}'
  if (last.includes('你好')) return '{"reply":"你好，我是管家但丁"}'
  return '{"reply":"(mock) 已收到"}'
}

async function waitFor(fn: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timeout')
    await new Promise((r) => setTimeout(r, 50))
  }
}

const contexts: TestCtx[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) {
    try {
      await ctx.kernel.stop()
    } catch {
      // 忽略 stop 错误
    }
    rmSync(ctx.dir, { recursive: true, force: true })
  }
})

describe('Kernel 主窗口管家循环', () => {
  test('start 后 mainWindowSpeak → 但丁回复进主窗口投影', async () => {
    const ctx = await setup(routingResponder)
    contexts.push(ctx)
    await ctx.kernel.mainWindowSpeak('你好')
    await waitFor(() => {
      const projection = ctx.kernel.butlerProjection()
      return projection.publicMessages.some((m) => m.actor === 'butler' && m.content.includes('但丁'))
    })
    const projection = ctx.kernel.butlerProjection()
    const actors = projection.publicMessages.map((m) => m.actor)
    expect(actors).toContain('user')
    expect(actors).toContain('butler')
  }, 15_000)

  test('mainWindowSpeak 带 group → 直接转发群组（D11 路由）', async () => {
    const ctx = await setup(routingResponder)
    contexts.push(ctx)
    await ctx.kernel.createGroup('g1', ['user', 'butler', 'worker'])
    await ctx.kernel.mainWindowSpeak('去 g1 干活', { group: 'g1', mention: ['worker'], task: '写欢迎语' })
    await waitFor(() => {
      const group = ctx.kernel.getGroup('g1')
      return group!.projection().publicMessages.some((m) => m.actor === 'worker' && m.content.includes('欢迎'))
    })
    const group = ctx.kernel.getGroup('g1')!
    const messages = group.projection().publicMessages
    expect(messages.some((m) => m.actor === 'user' && m.content.includes('干活'))).toBe(true)
    expect(messages.some((m) => m.actor === 'worker' && m.content.includes('欢迎来到 CoBeing'))).toBe(true)
  }, 15_000)
})

describe('Kernel 群组全流程', () => {
  test('群组创建（label≥3）→ mention 唤醒 → 发言 → 归档 → 索引 + 复用建议', async () => {
    const ctx = await setup(routingResponder)
    contexts.push(ctx)

    const group = await ctx.kernel.createGroup('demo', ['user', 'butler', 'worker'])
    expect(group.meta.status).toBe('working')

    await ctx.kernel.speakToGroup('demo', 'user', '请 worker 写欢迎语', ['worker'], '写欢迎语')
    await waitFor(() => {
      return ctx.kernel.getGroup('demo')!.projection().publicMessages.some((m) => m.actor === 'worker')
    })

    // 群内管家 relay → 主窗口
    await ctx.kernel.speakToGroup('demo', 'user', '请管家转告用户：任务完成', ['butler'])
    await waitFor(() => ctx.kernel.butlerLog.readCached().some((e) => e.type === 'butler/relay'))

    await ctx.kernel.archiveGroup('demo')
    const archived = ctx.kernel.listArchivedGroups()
    expect(archived.some((g) => g.name === 'demo' && g.status === 'archived')).toBe(true)
    const suggestions = ctx.kernel.listReuseSuggestions()
    expect(suggestions.some((s) => s.fromGroup === 'demo')).toBe(true)
    ctx.kernel.dismissReuseSuggestion(suggestions.find((s) => s.fromGroup === 'demo')!.id)
    expect(ctx.kernel.listReuseSuggestions().some((s) => s.fromGroup === 'demo')).toBe(false)
  }, 20_000)

  test('群组默认唤醒（修复 1）：用户发言不带 mention → 默认唤醒全部工作智能体（@all）', async () => {
    const ctx = await setup(routingResponder)
    contexts.push(ctx)
    await ctx.kernel.createGroup('wake-g', ['user', 'butler', 'worker', 'coder'])
    await ctx.kernel.speakToGroup('wake-g', 'user', '请开始写欢迎语', undefined, '写欢迎语')
    // 两个工作智能体都被唤醒并发言（默认 @all；mention 空不再零唤醒）
    await waitFor(() => {
      const p = ctx.kernel.getGroup('wake-g')!.projection()
      return p.publicMessages.some((m) => m.actor === 'worker') && p.publicMessages.some((m) => m.actor === 'coder')
    }, 10_000)
    const messages = ctx.kernel.getGroup('wake-g')!.projection().publicMessages
    expect(messages.some((m) => m.actor === 'worker' && m.content.includes('欢迎'))).toBe(true)
    expect(messages.some((m) => m.actor === 'coder' && m.content.includes('欢迎'))).toBe(true)
  }, 20_000)

  test('同名群重建：旧日志归档隔离（新群上下文干净）', async () => {    const ctx = await setup(routingResponder)
    contexts.push(ctx)
    const first = await ctx.kernel.createGroup('rebuild', ['user', 'butler', 'worker'])
    await ctx.kernel.speakToGroup('rebuild', 'user', '第一代任务')
    await ctx.kernel.archiveGroup('rebuild')

    const second = await ctx.kernel.createGroup('rebuild', ['user', 'butler', 'worker'])
    await ctx.kernel.speakToGroup('rebuild', 'user', '第二代任务')
    const messages = second.projection().publicMessages
    expect(messages.some((m) => m.content.includes('第一代'))).toBe(false)
    expect(messages.some((m) => m.content.includes('第二代'))).toBe(true)
    expect(existsSync(join(first.meta.space, 'log.jsonl'))).toBe(true)
  }, 15_000)
})

describe('Kernel 权限与工具边界', () => {
  test('群内 butler 只读：editor create 在群空间内被拒绝', async () => {
    // 响应器：让 butler 调用 editor create（路径动态指向群空间，验证 readonly 而非路径越权）
    let targetPath = ''
    const responder = (req: ChatRequest): string => {
      const last = req.messages[req.messages.length - 1]?.content ?? ''
      if (last.includes('写文件')) {
        // 路径必须 JSON 转义（Windows 路径含反斜杠，直接插值会破坏 JSON）
        return `{"toolCalls":[{"name":"str-replace-editor","args":{"command":"create","path":${JSON.stringify(targetPath)},"new_string":"x"}}]}`
      }
      return '{"reply":"ok"}'
    }
    const ctx = await setup(responder)
    contexts.push(ctx)
    const group = await ctx.kernel.createGroup('perm', ['user', 'butler', 'worker'])
    targetPath = join(group.meta.space, 'forbidden.txt')
    await ctx.kernel.speakToGroup('perm', 'user', '请 butler 写文件', ['butler'], '写文件')
    // 等待 tool/result 失败事件（readonly 拒绝）
    await waitFor(() => {
      const events = group.projection().events
      return events.some((e) => e.type === 'tool/result' && e.ok === false)
    })
    const denied = group.projection().events.find((e) => e.type === 'tool/result' && e.ok === false) as
      | { content: string }
      | undefined
    expect(denied?.content ?? '').toMatch(/readonly|denied|拒绝/)
    // 文件未创建
    expect(existsSync(targetPath)).toBe(false)
  }, 15_000)
})

describe('Kernel 管家群组感知与确认交互（纯HI：管家分析转发/主动决定复用新建）', () => {
  test('mainWindowSpeak 组装注入 [系统状态] 群组摘要（不进公共日志）', async () => {
    const requests: ChatRequest[] = []
    const ctx = await setup((req) => {
      requests.push(req)
      return '{"reply":"(mock) 已收到"}'
    })
    contexts.push(ctx)
    await ctx.kernel.createGroup('trip', ['user', 'butler', 'worker'])
    await ctx.kernel.mainWindowSpeak('帮我调研江苏旅游')
    await waitFor(() => requests.length > 0)
    const userText = requests[0]!.messages[requests[0]!.messages.length - 1]!.content
    expect(userText).toContain('[系统状态]')
    expect(userText).toContain('trip')
    // 系统状态不落公共日志（user speak 事件只有原文）
    const projection = ctx.kernel.butlerProjection()
    const userMsg = projection.publicMessages.find((m) => m.actor === 'user')
    expect(userMsg?.content).toBe('帮我调研江苏旅游')
    expect(userMsg?.content).not.toContain('[系统状态]')
  }, 15_000)

  test('ask-user 工具：notifyUser 收到 confirm payload', async () => {
    const notifies: unknown[] = []
    const dir = mkdtempSync(join(tmpdir(), 'cb-kernel-'))
    const kernel = new Kernel(dir, {
      mockResponder: (req) => {
        const last = req.messages[req.messages.length - 1]?.content ?? ''
        if (last.includes('发起确认')) {
          return '{"toolCalls":[{"name":"ask-user","args":{"question":"用哪个群组？","options":[{"id":"reuse","label":"复用旅行调研群"},{"id":"create","label":"新建群组"}]}}]}'
        }
        return '{"reply":"ok"}'
      },
      notifyUser: (payload) => notifies.push(payload),
    })
    await kernel.start()
    contexts.push({ kernel, dir })
    await kernel.mainWindowSpeak('请发起确认')
    await waitFor(() => notifies.some((n) => (n as { type?: string }).type === 'confirm'))
    const confirm = notifies.find((n) => (n as { type?: string }).type === 'confirm') as
      | { question: string; options: Array<{ id: string; label: string }> }
      | undefined
    expect(confirm).toBeDefined()
    expect(confirm!.question).toBe('用哪个群组？')
    expect(confirm!.options).toHaveLength(2)
    expect(confirm!.options[0]).toEqual({ id: 'reuse', label: '复用旅行调研群' })
  }, 15_000)

  test('create-group 工具：主窗口但丁可创建群组（创造无需批准）', async () => {
    const ctx = await setup((req) => {
      const last = req.messages[req.messages.length - 1]?.content ?? ''
      if (last.includes('新建群组')) {
        return '{"toolCalls":[{"name":"create-group","args":{"name":"trip2","label":["user","butler","worker"]}}]}'
      }
      return '{"reply":"ok"}'
    })
    contexts.push(ctx)
    await ctx.kernel.mainWindowSpeak('请新建群组')
    await waitFor(() => ctx.kernel.listGroups().some((g) => g.name === 'trip2'))
    const group = ctx.kernel.listGroups().find((g) => g.name === 'trip2')!
    expect(group.status).toBe('working')
    expect(group.label).toContain('worker')
  }, 15_000)

  test('管家协调工具（list-groups 等）：群组工作智能体工具面已收敛（调用被 denyTools 拒绝）', async () => {
    const ctx = await setup((req) => {
      const last = req.messages[req.messages.length - 1]?.content ?? ''
      if (last.includes('查群组')) {
        return '{"toolCalls":[{"name":"list-groups","args":{}}]}'
      }
      return '{"reply":"ok"}'
    })
    contexts.push(ctx)
    const group = await ctx.kernel.createGroup('perm2', ['user', 'butler', 'worker'])
    await ctx.kernel.speakToGroup('perm2', 'user', '请 worker 查群组', ['worker'], '查群组')
    await waitFor(() => {
      return group.projection().events.some((e) => e.type === 'tool/result' && e.ok === false)
    })
    const result = group.projection().events.find((e) => e.type === 'tool/result' && e.ok === false) as
      | { content: string }
      | undefined
    // 修复 4：worker 工具面收敛——list-groups 等协调工具不在白名单，调用被拒（TOOL_DENIED）
    expect(result?.content ?? '').toContain('TOOL_DENIED')
    expect(result?.content ?? '').toContain('list-groups')
  }, 15_000)

  test('组装前缀稳定：工具清单+输出协议在 system 冻结段，跨请求字节相同（KV 缓存前提）', async () => {
    const systems: string[] = []
    let seen = ''
    const ctx = await setup((req) => {
      const system = req.messages[0]?.content ?? ''
      systems.push(system)
      const last = req.messages[req.messages.length - 1]?.content ?? ''
      seen = last
      return '{"reply":"ok"}'
    })
    contexts.push(ctx)
    await ctx.kernel.mainWindowSpeak('你好')
    await ctx.kernel.mainWindowSpeak('再次对话')
    await waitFor(() => systems.length >= 2)
    // system 跨请求字节级稳定（KV 缓存前缀命中的地基）
    expect(systems[0]).toBe(systems[1])
    // 工具清单在 system 内（非 user 文本），附带参数 schema 摘要
    expect(systems[0]).toMatch(/\[可用工具\]/)
    expect(systems[0]).toMatch(/todo-list.*command（必填）:enum\[add\|update\|complete\|list\]/s)
    expect(systems[0]).toMatch(/create-group.*name（必填）:string，label（必填）:array<string>/s)
    expect(systems[0]).toMatch(/str-replace-editor.*command（必填）:enum\[view\|create\|write\|str_replace\|insert\]/s)
    // 输出协议在 system 内
    expect(systems[0]).toContain('[输出协议]')
    // user 文本不再包含工具清单（动态侧只留内容）
    expect(seen).not.toContain('[可用工具]')
  }, 15_000)

  test('parseModelOutput 兼容嵌套 pendingMessage 输出', async () => {
    let toolRan = false
    const ctx = await setup((req) => {
      const last = req.messages[req.messages.length - 1]?.content ?? ''
      // 第一轮：嵌套 pendingMessage 输出；工具结果进下一轮组装后回复完成
      if (!last.includes('added #1')) {
        return '{"todoList":[],"pendingMessage":"{\\"toolCalls\\":[{\\"name\\":\\"todo-list\\",\\"args\\":{\\"action\\":\\"add\\",\\"content\\":\\"写代码\\"}}]}"}'
      }
      return '{"reply":"完成"}'
    })
    contexts.push(ctx)
    const group = await ctx.kernel.createGroup('nested1', ['user', 'butler', 'worker'])
    await ctx.kernel.speakToGroup('nested1', 'user', '请 worker 开始工作', ['worker'], '开始工作')
    await waitFor(() => {
      const events = group.projection().events
      toolRan = events.some((e) => e.type === 'tool/result' && (e as { content: string }).content.includes('added #1'))
      return toolRan
    }, 10_000)
    expect(toolRan).toBe(true)
  }, 20_000)

  test('parseModelOutput 空对象回退纯文本（杜绝静默结束——模型 todoList 包裹失误）', async () => {
    let spoke = false
    const ctx = await setup((req) => {
      const last = req.messages[req.messages.length - 1]?.content ?? ''
      if (last.includes('第一次')) {
        return '{"todoList":{"command":"add","content":"创建文件"}}'
      }
      return '{"reply":"完成"}'
    })
    contexts.push(ctx)
    const group = await ctx.kernel.createGroup('emptyobj1', ['user', 'butler', 'worker'])
    await ctx.kernel.speakToGroup('emptyobj1', 'user', '请 worker 开始第一次工作', ['worker'], '第一次')
    // 空对象不再静默：作为纯文本发言进公共上下文
    await waitFor(() => {
      const events = group.projection().events
      spoke = events.some((e) => e.type === 'speak' && e.actor === 'worker')
      return spoke
    }, 10_000)
    expect(spoke).toBe(true)
  }, 20_000)

  test('parseModelOutput 截断的 toolCalls JSON：不发布发言（防脏数据），反馈后继续工作', async () => {
    const ctx = await setup((req) => {
      const last = req.messages[req.messages.length - 1]?.content ?? ''
      // 第一轮：截断的 toolCalls（未闭合 JSON，模拟 maxTokens 截断）
      if (!last.includes('输出截断')) {
        return '{"toolCalls":[{"name":"str-replace-editor","args":{"command":"write","path":"index.html","content":"<!DOCTYPE html>\\n<canvas id=g></canvas>\\n<script>\\nconst c=1;\\n"}}'
      }
      // 第二轮（收到截断反馈后）：正常完成
      return '{"reply":"已完成，index.html 分块写入"}'
    })
    contexts.push(ctx)
    const group = await ctx.kernel.createGroup('trunc1', ['user', 'butler', 'worker'])
    await ctx.kernel.speakToGroup('trunc1', 'user', '请 worker 开始工作', ['worker'], '开始')
    // 反馈后模型完成发言（证明截断路径给了反馈并继续）
    await waitFor(() => {
      const events = group.projection().events
      return events.some((e) => e.type === 'speak' && e.actor === 'worker' && String((e as { content: string }).content).includes('分块写入'))
    }, 15_000)
    // 截断的 toolCalls JSON 从未作为发言发布（防脏数据进公共上下文）
    const speaks = group.projection().publicMessages.filter((m) => m.actor === 'worker')
    expect(speaks.every((m) => !m.content.includes('toolCalls'))).toBe(true)
    expect(speaks.some((m) => m.content.includes('分块写入'))).toBe(true)
  }, 25_000)

  test('parseModelOutput 容忍 JSON 前后/夹杂文本与多段 JSON（取第一个完整对象）', async () => {
    // 场景：模型输出 = 解释文本 + JSON + 工具结果文本 + 第二个 JSON（真实 DeepSeek 行为）
    let toolRan = false
    let editorRan = false
    let phase = 0
    const ctx = await setup((req) => {
      const last = req.messages[req.messages.length - 1]?.content ?? ''
      if (phase === 0) {
        // 第一轮：todo-list add
        phase = 1
        return '{"toolCalls":[{"name":"todo-list","args":{"command":"add","content":"第一步"}}]}'
      }
      if (phase === 1) {
        // 第二轮（工具结果已在组装中）：混杂文本 + 多段 JSON——必须仍解析出 editor 调用
        phase = 2
        return '让我开始写代码。\n{"toolCalls":[{"name":"str-replace-editor","args":{"command":"create","path":"a.js","new_string":"console.log(1)"}}]}\n\ntool:todo-list [ok] added #1\n\n{"toolCalls":[{"name":"todo-list","args":{"command":"complete","id":1}}]}'
      }
      // 第三轮：收尾完成
      return '{"toolCalls":[{"name":"todo-list","args":{"command":"complete","id":1}}]}'
    })
    contexts.push(ctx)
    const group = await ctx.kernel.createGroup('mixed1', ['user', 'butler', 'worker'])
    await ctx.kernel.speakToGroup('mixed1', 'user', '请 worker 开始', ['worker'], '开始')
    await waitFor(() => {
      const events = group.projection().events
      editorRan = events.some((e) => e.type === 'tool/result' && (e as { content: string }).content.includes('a.js'))
      return editorRan
    }, 10_000)
    expect(editorRan).toBe(true)
    // 第三轮 complete 也执行（工具循环未中断）
    await waitFor(() => {
      const events = group.projection().events
      toolRan = events.some((e) => e.type === 'tool/result' && (e as { content: string }).content.includes('completed #1'))
      return toolRan
    }, 10_000)
    expect(toolRan).toBe(true)
  }, 25_000)
})
describe('ButlerRuntime 归档流程', () => {
  test('超过阈值触发真实归档：总结→记忆档案→compaction 遮蔽', async () => {
    // 用可配置小阈值（D7：阈值可配置）快速触发
    const dir = mkdtempSync(join(tmpdir(), 'cb-kernel-'))
    const kernel = new Kernel(dir, {
      mockResponder: defaultResponder,
      butlerArchiveThresholdTokens: 100,
      notifyUser: () => undefined,
    })
    await kernel.start()
    contexts.push({ kernel, dir })
    // 直接操作主窗口日志：塞入少量事件即超过 100 token 阈值
    for (let i = 0; i < 30; i++) {
      await kernel.butlerLog.append({ type: 'speak', actor: 'user', content: `消息 ${i} 一些内容` })
    }
    // 触发检查
    await kernel.butler.maybeArchive()
    const events = kernel.butlerLog.readCached()
    const compaction = events.filter((e) => e.type === 'compaction')
    expect(compaction.length).toBeGreaterThan(0)
    const lastCompaction = compaction[compaction.length - 1]!
    expect(lastCompaction.type).toBe('compaction')
    if (lastCompaction.type === 'compaction') {
      expect(lastCompaction.shadowStart).toBe(1)
      expect(lastCompaction.shadowEnd).toBeGreaterThan(0)
      expect(lastCompaction.summary.length).toBeGreaterThan(0)
    }
    // 经验档案写入
    const entries = await kernel.memory.recall('butler', 5)
    expect(entries.length).toBeGreaterThan(0)
    expect(entries.some((e) => e.source === 'main-window-archive')).toBe(true)
    // 投影：旧消息被遮蔽，压缩摘要可见
    const projection = kernel.butlerProjection()
    expect(projection.publicMessages.length).toBe(0)
    expect(projection.compactions.length).toBeGreaterThan(0)
  }, 20_000)

  test('阈值常量默认 100k', () => {
    expect(BUTLER_ARCHIVE_THRESHOLD_TOKENS).toBe(100_000)
  })
})

describe('request/header 与 request/error（dsh 对齐）', () => {
  test('header 变化才追加：多轮请求头相同只记录一次（initial），system/tools 完整', async () => {
    const ctx = await setup(() => '{"reply":"ok"}')
    contexts.push(ctx)
    await ctx.kernel.mainWindowSpeak('第一轮')
    await waitFor(() => ctx.kernel.butlerLog.readCached().some((e) => e.type === 'assistant/complete'))
    await ctx.kernel.mainWindowSpeak('第二轮')
    await waitFor(() => {
      const completes = ctx.kernel.butlerLog.readCached().filter((e) => e.type === 'assistant/complete')
      return completes.length >= 2
    })
    const events = ctx.kernel.butlerLog.readCached()
    const headers = events.filter((e) => e.type === 'request/header') as Array<{ reason?: string; system?: string; tools?: string[] }>
    // 两轮请求 system/tools 未变 → 只追加一次
    expect(headers.length).toBe(1)
    expect(headers[0]?.reason).toBe('initial')
    expect(headers[0]?.system).toContain('[可用工具]')
    expect((headers[0]?.tools ?? []).length).toBeGreaterThan(0)
    // 工具名列表与 system 中一致（重建依据）：system 行格式 `- name：desc`，提取 name
    const systemTools = (headers[0]?.system ?? '').match(/^- (\S+?)：/gm)?.map((s) => s.slice(2, -1)) ?? []
    expect(headers[0]?.tools).toEqual(systemTools)
  }, 25_000)

  test('request/error 落盘：网关重试耗尽后写结构化错误链', async () => {
    const ctx = await setup(() => {
      throw new Error('network down')
    })
    contexts.push(ctx)
    await ctx.kernel.mainWindowSpeak('触发失败')
    await waitFor(() => ctx.kernel.butlerLog.readCached().some((e) => e.type === 'request/error'), 10_000)
    const err = ctx.kernel.butlerLog.readCached().find((e) => e.type === 'request/error') as
      | { errors?: Array<{ message: string }> }
      | undefined
    expect(err?.errors?.some((e) => e.message.includes('network down'))).toBe(true)
  }, 30_000)
})

describe('todo 持久化（dsh todo/write logged state 对齐）', () => {
  test('群组 todo 变更落盘到窗口日志（todo/write 事件，整表替换）', async () => {
    const ctx = await setup()
    contexts.push(ctx)
    const group = await ctx.kernel.createGroup('todos1', ['user', 'butler', 'coder'])
    // 直接经内核 todos 模拟工具变更（工具经调度器路径同此）
    await ctx.kernel.todos.add('todos1', 'coder', '任务甲')
    await ctx.kernel.todos.add('todos1', 'coder', '任务乙')
    const events = group.log.readCached().filter((e) => e.type === 'todo/write')
    expect(events.length).toBe(2)
    const last = events[1] as { todos?: Array<{ id: number; content: string; status: string }> }
    expect(last.todos).toHaveLength(2)
    expect(last.todos?.[1]).toMatchObject({ content: '任务乙', status: 'pending' })
  }, 15_000)

  test('重启重建：新 Kernel 从主窗口日志恢复 todo（last-write-wins）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cb-kernel-'))
    const kernel = new Kernel(dir, { mockResponder: defaultResponder, notifyUser: () => undefined })
    await kernel.start()
    await kernel.todos.add('main', 'butler', '重启前任务')
    await kernel.todos.update('main', 'butler', 1, { status: 'in_progress' })
    await kernel.stop()

    // 模拟重启：同一数据目录新建 Kernel——start() 从主窗口日志 replay todo
    const kernel2 = new Kernel(dir, { mockResponder: defaultResponder, notifyUser: () => undefined })
    await kernel2.start()
    const recovered = kernel2.todos.list('main', 'butler')
    expect(recovered).toHaveLength(1)
    expect(recovered[0]).toMatchObject({ content: '重启前任务', status: 'in_progress' })
    await kernel2.stop()
    rmSync(dir, { recursive: true, force: true })
  }, 20_000)
})

describe('主窗口会话（新对话窗口：当前日志归档 + 空会话重建）', () => {
  test('newConversation：归档完整保留 → 新会话干净可工作 → 历史只读回看 → 列表正确', async () => {
    const ctx = await setup(routingResponder)
    contexts.push(ctx)
    // 第一会话：两轮对话（等两轮都收敛：两次用户发言 + 两次但丁回复 + 但丁空闲）
    await ctx.kernel.mainWindowSpeak('你好')
    await waitFor(() => ctx.kernel.butlerProjection().publicMessages.some((m) => m.actor === 'butler'))
    await ctx.kernel.mainWindowSpeak('你好')
    await waitFor(() => {
      const events = ctx.kernel.butlerLog.readCached()
      const butlers = events.filter((e) => e.type === 'speak' && e.actor === 'butler')
      const users = events.filter((e) => e.type === 'speak' && e.actor === 'user')
      return butlers.length >= 2 && users.length >= 2 && !ctx.kernel.isButlerBusy()
    })
    const firstCount = ctx.kernel.butlerLog.readCached().length

    // 开启新对话
    const { id, archived } = await ctx.kernel.newButlerConversation()
    expect(id).toMatch(/^conv-/)
    expect(archived?.messageCount).toBe(firstCount)

    // 归档文件存在（完整事件保留，非压缩遮蔽）
    const archivedFile = join(ctx.dir, 'butler', 'conversations', `${id}.jsonl`)
    expect(existsSync(archivedFile)).toBe(true)

    // 新会话：日志清空（无 speak），但丁可继续工作
    const freshEvents = ctx.kernel.butlerLog.readCached()
    expect(freshEvents.filter((e) => e.type === 'speak').length).toBe(0)
    await ctx.kernel.mainWindowSpeak('新会话你好')
    await waitFor(() => {
      const p = ctx.kernel.butlerProjection()
      return p.publicMessages.some((m) => m.actor === 'butler')
    })

    // 历史投影只读回看：含第一会话两条用户消息，不含新会话内容
    const hist = await ctx.kernel.butlerConversationProjection(id)
    const histUserMsgs = hist.publicMessages.filter((m) => m.actor === 'user')
    expect(histUserMsgs).toHaveLength(2)
    expect(histUserMsgs[0]!.content).toBe('你好')
    expect(hist.publicMessages.some((m) => m.content.includes('新会话'))).toBe(false)
    // 当前投影不含旧会话消息（精确匹配：新会话消息 '新会话你好' 含子串 '你好'）
    const cur = ctx.kernel.butlerProjection()
    expect(cur.publicMessages.some((m) => m.content === '你好')).toBe(false)
    expect(cur.publicMessages.some((m) => m.content.includes('新会话'))).toBe(true)

    // 会话列表：当前（最新）+ 历史（最新在前）
    const list = ctx.kernel.listButlerConversations()
    expect(list[0]!.current).toBe(true)
    expect(list[0]!.messageCount).toBeLessThan(firstCount)
    expect(list[1]!.id).toBe(id)
    expect(list[1]!.archivedAt).toBeDefined()
  }, 25_000)

  test('新对话清空主窗口 todo（落空表）；重启后恢复为空', async () => {
    const ctx = await setup()
    contexts.push(ctx)
    await ctx.kernel.todos.add('main', 'butler', '旧任务')
    expect(ctx.kernel.todos.list('main', 'butler')).toHaveLength(1)

    await ctx.kernel.newButlerConversation()
    expect(ctx.kernel.todos.list('main', 'butler')).toHaveLength(0)
    // 新会话日志落空表（last-write-wins 真相源）
    const writes = ctx.kernel.butlerLog.readCached().filter((e) => e.type === 'todo/write')
    expect(writes.length).toBe(1)
    expect((writes[0] as { todos: unknown[] }).todos).toEqual([])

    // 重启：新 Kernel 从当前会话日志 replay → 空清单
    const dir = ctx.dir
    await ctx.kernel.stop()
    rmSync(dir, { recursive: true, force: true })
    contexts.pop()
    const kernel2 = new Kernel(dir, { mockResponder: defaultResponder, notifyUser: () => undefined })
    await kernel2.start()
    contexts.push({ kernel: kernel2, dir })
    expect(kernel2.todos.list('main', 'butler')).toHaveLength(0)
  }, 20_000)

  test('空会话 newConversation 幂等返回 current（无归档）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cb-kernel-'))
    const kernel = new Kernel(dir, { mockResponder: defaultResponder, notifyUser: () => undefined })
    // 不 start（日志为空）
    const r = await kernel.newButlerConversation()
    expect(r.id).toBe('current')
    const list = kernel.listButlerConversations()
    expect(list).toHaveLength(1)
    expect(list[0]!.current).toBe(true)
    await kernel.stop()
    rmSync(dir, { recursive: true, force: true })
  }, 15_000)

  test('但丁工作中 newConversation 拒绝；收敛后可开启', async () => {
    // 阻塞 provider：控制但丁一轮的持续时间（busy 窗口可观测）
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    const blocking: LLMProvider = {
      name: 'block',
      chat: async () => {
        await gate
        return { content: '{"reply":"done"}', usage: { inputTokens: 1, outputTokens: 1 } }
      },
    }
    const dir = mkdtempSync(join(tmpdir(), 'cb-kernel-'))
    const kernel = new Kernel(dir, {
      providers: [blocking],
      butlerProvider: 'block',
      butlerModel: 'm',
      notifyUser: () => undefined,
    })
    await kernel.start()
    contexts.push({ kernel, dir })

    kernel.mainWindowSpeak('开始长工作')
    await waitFor(() => kernel.isButlerBusy())
    await expect(kernel.newButlerConversation()).rejects.toThrow(/工作中/)

    release!()
    await waitFor(() => !kernel.isButlerBusy())
    const r = await kernel.newButlerConversation()
    expect(r.id).toMatch(/^conv-/)
  }, 20_000)

  test('butlerContextInfo 返回估算 token 与阈值（GUI 进度面）', async () => {
    const ctx = await setup()
    contexts.push(ctx)
    const info = ctx.kernel.butlerContextInfo()
    expect(info.thresholdTokens).toBe(BUTLER_ARCHIVE_THRESHOLD_TOKENS)
    expect(info.estimatedTokens).toBeGreaterThan(0)
  }, 15_000)
})

describe('群组重启恢复 + 名录校验 + update 实时广播（实时同步协议）', () => {
  test('重启后 working 群组恢复：listGroups 可见 + 投影保留历史 + 可继续发言', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cb-kernel-'))
    const kernel = new Kernel(dir, { mockResponder: defaultResponder, notifyUser: () => undefined })
    await kernel.start()
    await kernel.requestCreateAgent({ name: 'writer', role: '写作者', createdAt: Date.now() })
    await kernel.confirmAgent('writer')
    const group = await kernel.createGroup('restore-g', ['user', 'butler', 'writer'])
    await kernel.speakToGroup('restore-g', 'user', '第一轮任务')
    await kernel.speakToGroup('restore-g', 'user', '第二轮任务')
    expect(kernel.listGroups().some((g) => g.name === 'restore-g')).toBe(true)
    await kernel.stop()

    // 模拟重启：同一数据目录新内核——start() 应从名录恢复 working 群组
    const kernel2 = new Kernel(dir, { mockResponder: defaultResponder, notifyUser: () => undefined })
    await kernel2.start()
    const groups = kernel2.listGroups()
    expect(groups.some((g) => g.name === 'restore-g' && g.status === 'working')).toBe(true)
    const restored = kernel2.getGroup('restore-g')!
    const messages = restored.projection().publicMessages
    expect(messages.some((m) => m.content.includes('第一轮任务'))).toBe(true)
    expect(messages.some((m) => m.content.includes('第二轮任务'))).toBe(true)
    // 恢复后可继续工作（mention 唤醒 writer 正常发言）
    await kernel2.speakToGroup('restore-g', 'user', '恢复后任务', ['writer'], '恢复后任务')
    await waitFor(() => kernel2.getGroup('restore-g')!.projection().publicMessages.some((m) => m.actor === 'writer'))
    await kernel2.stop()
    rmSync(dir, { recursive: true, force: true })
  }, 25_000)

  test('重启后归档群组不恢复（仅 working）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cb-kernel-'))
    const kernel = new Kernel(dir, { mockResponder: defaultResponder, notifyUser: () => undefined })
    await kernel.start()
    await kernel.requestCreateAgent({ name: 'writer', role: '写作者', createdAt: Date.now() })
    await kernel.confirmAgent('writer')
    await kernel.createGroup('arch-g', ['user', 'butler', 'writer'])
    await kernel.archiveGroup('arch-g')
    await kernel.stop()

    const kernel2 = new Kernel(dir, { mockResponder: defaultResponder, notifyUser: () => undefined })
    await kernel2.start()
    expect(kernel2.listGroups().some((g) => g.name === 'arch-g')).toBe(false)
    expect(kernel2.listArchivedGroups().some((g) => g.name === 'arch-g')).toBe(true)
    await kernel2.stop()
    rmSync(dir, { recursive: true, force: true })
  }, 20_000)

  test('createGroup 名录校验：label 含未注册成员 → 明确报错（防 mock 空转群组）', async () => {
    const ctx = await setup()
    contexts.push(ctx)
    await expect(ctx.kernel.createGroup('bad-g', ['user', 'butler', 'ghost-agent'])).rejects.toThrow(/not in registry/)
    // 群组未创建（listGroups 不含）
    expect(ctx.kernel.listGroups().some((g) => g.name === 'bad-g')).toBe(false)
  }, 15_000)

  test('恢复时成员已销毁 → 实例跳过（不崩溃；mention 反馈失败）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cb-kernel-'))
    const kernel = new Kernel(dir, { mockResponder: defaultResponder, notifyUser: () => undefined })
    await kernel.start()
    await kernel.requestCreateAgent({ name: 'writer', role: '写作者', createdAt: Date.now() })
    await kernel.confirmAgent('writer')
    await kernel.createGroup('drop-g', ['user', 'butler', 'writer'])
    await kernel.stop()
    // 销毁成员（模拟名录变动）后重启
    const kernel2 = new Kernel(dir, { mockResponder: defaultResponder, notifyUser: () => undefined })
    await kernel2.start()
    await kernel2.destroyAgent('writer')
    await kernel2.stop()
    const kernel3 = new Kernel(dir, { mockResponder: defaultResponder, notifyUser: () => undefined })
    await kernel3.start()
    const restored = kernel3.getGroup('drop-g')
    expect(restored).toBeDefined() // 群组本身恢复
    expect(restored!.instance('writer')).toBeUndefined() // 已销毁成员无实例
    // mention 已销毁成员 → 失败反馈进投影（不崩溃）
    await kernel3.speakToGroup('drop-g', 'user', '找 writer', ['writer'], '找 writer')
    await waitFor(() => {
      const proj = kernel3.getGroup('drop-g')!.projection()
      return proj.publicMessages.some((m) => m.content.includes('mention 失败'))
    })
    await kernel3.stop()
    rmSync(dir, { recursive: true, force: true })
  }, 20_000)

  test('update 实时广播：mainWindowSpeak → butler；speakToGroup → group；建群 → groups；批准 → agents', async () => {
    const notifies: NotifyPayload[] = []
    const dir = mkdtempSync(join(tmpdir(), 'cb-kernel-'))
    const kernel = new Kernel(dir, {
      mockResponder: defaultResponder,
      notifyUser: (payload) => notifies.push(payload),
    })
    await kernel.start()
    contexts.push({ kernel, dir })
    await kernel.requestCreateAgent({ name: 'writer', role: '写作者', createdAt: Date.now() })
    await kernel.confirmAgent('writer')

    notifies.length = 0
    await kernel.mainWindowSpeak('你好')
    expect(notifies.some((n) => n.type === 'update' && n.scope === 'butler' && n.kind === 'speak')).toBe(true)

    notifies.length = 0
    await kernel.createGroup('sync-g', ['user', 'butler', 'writer'])
    expect(notifies.some((n) => n.type === 'update' && n.scope === 'groups' && n.kind === 'create')).toBe(true)

    notifies.length = 0
    await kernel.speakToGroup('sync-g', 'user', '群内发言')
    expect(notifies.some((n) => n.type === 'update' && n.scope === 'group' && n.group === 'sync-g')).toBe(true)

    notifies.length = 0
    await kernel.requestCreateAgent({ name: 'designer', role: '设计', createdAt: Date.now() })
    expect(notifies.some((n) => n.type === 'update' && n.scope === 'agents' && n.kind === 'pending')).toBe(true)
    await kernel.confirmAgent('designer')
    expect(notifies.some((n) => n.type === 'update' && n.scope === 'agents' && n.kind === 'confirm')).toBe(true)

    notifies.length = 0
    await kernel.archiveGroup('sync-g')
    expect(notifies.some((n) => n.type === 'update' && n.scope === 'groups' && n.kind === 'archive')).toBe(true)
  }, 20_000)

  test('update 实时广播：但丁回复完成 → butler reply（onTurnComplete 钩子）', async () => {
    const notifies: NotifyPayload[] = []
    const dir = mkdtempSync(join(tmpdir(), 'cb-kernel-'))
    const kernel = new Kernel(dir, {
      mockResponder: defaultResponder,
      notifyUser: (payload) => notifies.push(payload),
    })
    await kernel.start()
    contexts.push({ kernel, dir })
    notifies.length = 0
    await kernel.mainWindowSpeak('回复我')
    await waitFor(() => notifies.some((n) => n.type === 'update' && n.scope === 'butler' && n.kind === 'reply'))
  }, 15_000)
})

describe('群组工作状态 + 任务摘要自动更新（群组工作方式完善）', () => {
  test('groupStatus：成员忙碌标记 + 任务摘要 + 最近活动', async () => {
    const ctx = await setup(routingResponder)
    contexts.push(ctx)
    await ctx.kernel.createGroup('status-g', ['user', 'butler', 'worker'])
    await ctx.kernel.speakToGroup('status-g', 'user', '请 worker 干活', ['worker'], '写欢迎语')
    const status = ctx.kernel.groupStatus('status-g')
    expect(status.name).toBe('status-g')
    expect(status.members.map((m) => m.name)).toEqual(['user', 'butler', 'worker'])
    expect(status.taskSummary).toBe('写欢迎语')
    expect(status.lastActivity).toBeGreaterThan(0)
    // 等待 worker 收敛后 busy=false
    await waitFor(() => {
      const s = ctx.kernel.groupStatus('status-g')
      return s.members.every((m) => !m.busy)
    })
  }, 15_000)

  test('speakToGroup 带 task → 任务摘要自动更新 + groups update 广播（kind=task）', async () => {
    const notifies: NotifyPayload[] = []
    const dir = mkdtempSync(join(tmpdir(), 'cb-kernel-'))
    const kernel = new Kernel(dir, {
      mockResponder: defaultResponder,
      notifyUser: (payload) => notifies.push(payload),
    })
    await kernel.start()
    contexts.push({ kernel, dir })
    await kernel.requestCreateAgent({ name: 'writer', role: '写作者', createdAt: Date.now() })
    await kernel.confirmAgent('writer')
    await kernel.createGroup('task-g', ['user', 'butler', 'writer'])

    notifies.length = 0
    await kernel.speakToGroup('task-g', 'user', '任务一')
    expect(kernel.listGroups().find((g) => g.name === 'task-g')?.taskSummary).toBeUndefined()
    await kernel.speakToGroup('task-g', 'user', '任务二', undefined, '写文档')
    expect(kernel.listGroups().find((g) => g.name === 'task-g')?.taskSummary).toBe('写文档')
    expect(notifies.some((n) => n.type === 'update' && n.scope === 'groups' && n.kind === 'task')).toBe(true)
    // 持久化：重启后 taskSummary 保留
    await kernel.stop()
    const kernel2 = new Kernel(dir, { mockResponder: defaultResponder, notifyUser: () => undefined })
    await kernel2.start()
    expect(kernel2.listGroups().find((g) => g.name === 'task-g')?.taskSummary).toBe('写文档')
    await kernel2.stop()
    rmSync(dir, { recursive: true, force: true })
  }, 20_000)

  test('groupStatus 未知群组 → 报错', async () => {
    const ctx = await setup()
    contexts.push(ctx)
    expect(() => ctx.kernel.groupStatus('no-such')).toThrow(/not found/)
  }, 15_000)
})

describe('经验条目浏览与检索（记忆机制完善）', () => {
  test('experienceEntries：最新在前 + experienceSearch 关键词匹配', async () => {
    const ctx = await setup()
    contexts.push(ctx)
    // 直接写档案（绕过 LLM 环节，测存储/查询面）
    await ctx.kernel.memory.append('worker', { source: 'group:g1', content: '文件路径 D:\\x\\a.txt 与字符数记录', tags: ['file'] })
    await ctx.kernel.memory.append('worker', { source: 'turn:g1', content: 'node 脚本运行需要等待 3 秒', tags: ['bash'] })
    await ctx.kernel.memory.append('worker', { source: 'group:g2', content: '设计文档放 docs 目录', tags: ['doc'] })

    const entries = await ctx.kernel.experienceEntries('worker')
    expect(entries.length).toBe(3)
    expect(entries[0]!.content).toContain('设计文档') // 最新在前
    const hit = await ctx.kernel.experienceSearch('worker', 'node')
    expect(hit.length).toBe(1)
    expect(hit[0]!.content).toContain('node 脚本')
    const tagHit = await ctx.kernel.experienceSearch('worker', 'doc')
    expect(tagHit.length).toBe(1)
    expect(tagHit[0]!.content).toContain('设计文档')
    const none = await ctx.kernel.experienceSearch('worker', '不存在的词xyz')
    expect(none.length).toBe(0)
  }, 15_000)

  test('experienceEntries 空档案 → 空数组', async () => {
    const ctx = await setup()
    contexts.push(ctx)
    expect(await ctx.kernel.experienceEntries('worker')).toEqual([])
  }, 15_000)
})

describe('发言真实性审查【诚实】（kernel 接线）', () => {
  test('群组工作智能体 reply 发言经【诚实】：不通过 → 发言不发布 + 反馈下一轮', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cb-kernel-'))
    const kernel = new Kernel(dir, {
      mockResponder: (req) => {
        const last = req.messages[req.messages.length - 1]?.content ?? ''
        return last.includes('诚实审查') ? '{"reply":"已重新完成，文件已生成"}' : '{"reply":"任务完成，文件已生成"}'
      },
      notifyUser: () => undefined,
    })
    await kernel.start()
    contexts.push({ kernel, dir })
    await kernel.requestCreateAgent({ name: 'worker', role: '工作者', createdAt: Date.now() })
    await kernel.confirmAgent('worker')
    await kernel.createGroup('hon-g', ['user', 'butler', 'worker'])
    // 覆写【诚实】审查：第一次拒绝，第二次放行
    const honestySpec = kernel.toolAgents.get('诚实')!
    let calls = 0
    const orig = honestySpec.invoke
    honestySpec.invoke = async (input, ctx) => {
      calls++
      const result = await orig(input, ctx)
      // 返回结构化 pass=false 供 runHonestyAgent 解析
      return calls === 1
        ? { ok: true, content: '[诚实审查] pass=false：声称完成但无工具记录' }
        : { ok: true, content: '[诚实审查] pass=true：已有工具调用证据' }
    }
    await kernel.speakToGroup('hon-g', 'user', '请 worker 完成任务', ['worker'], '完成任务')
    // 等待两轮审查完成（第一轮拒绝 → 反馈 → 第二轮通过 → 发言发布）
    await waitFor(() => calls >= 2, 10_000)
    const projection = kernel.getGroup('hon-g')!.projection()
    const workerSpeaks = projection.publicMessages.filter((m) => m.actor === 'worker')
    // 只有第二轮（通过后）的发言发布，且内容为"已重新完成"
    expect(workerSpeaks.length).toBe(1)
    expect(workerSpeaks[0]!.content).toContain('已重新完成')
  }, 20_000)

  test('连续不通过达上限 → 幻觉发言不发布（群组无该智能体发言）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cb-kernel-'))
    const kernel = new Kernel(dir, {
      mockResponder: () => '{"reply":"全部搞定了"}',
      notifyUser: () => undefined,
    })
    await kernel.start()
    contexts.push({ kernel, dir })
    await kernel.requestCreateAgent({ name: 'worker', role: '工作者', createdAt: Date.now() })
    await kernel.confirmAgent('worker')
    await kernel.createGroup('hon-g2', ['user', 'butler', 'worker'])
    const honestySpec = kernel.toolAgents.get('诚实')!
    const orig = honestySpec.invoke
    honestySpec.invoke = async (input, ctx) => {
      await orig(input, ctx)
      return { ok: true, content: '[诚实审查] pass=false：声称完成但无工具记录' }
    }
    await kernel.speakToGroup('hon-g2', 'user', '请 worker 完成任务', ['worker'], '完成任务')
    // 等一轮收敛（worker 回合结束，agent/status idle）
    await waitFor(() => {
      const p = kernel.getGroup('hon-g2')!.projection()
      return p.events.some((e) => e.type === 'agent/status' && e.agent === 'worker' && e.status === 'idle')
    }, 15_000)
    const projection = kernel.getGroup('hon-g2')!.projection()
    const workerSpeaks = projection.publicMessages.filter((m) => m.actor === 'worker')
    expect(workerSpeaks.length).toBe(0) // 幻觉发言全部拦截
  }, 20_000)

  test('group-speak 工具发言经【诚实】：不通过 → 工具返回 HONESTY_REJECTED 错误', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cb-kernel-'))
    const kernel = new Kernel(dir, {
      mockResponder: (req) => {
        const last = req.messages[req.messages.length - 1]?.content ?? ''
        if (last.includes('第一轮')) {
          return '{"toolCalls":[{"name":"group-speak","args":{"content":"全部完成！"}}]}'
        }
        return '{"reply":"ok"}'
      },
      notifyUser: () => undefined,
    })
    await kernel.start()
    contexts.push({ kernel, dir })
    await kernel.requestCreateAgent({ name: 'worker', role: '工作者', createdAt: Date.now() })
    await kernel.confirmAgent('worker')
    await kernel.createGroup('hon-g3', ['user', 'butler', 'worker'])
    const honestySpec = kernel.toolAgents.get('诚实')!
    const orig = honestySpec.invoke
    honestySpec.invoke = async (input, ctx) => {
      await orig(input, ctx)
      return { ok: true, content: '[诚实审查] pass=false：无工具记录' }
    }
    await kernel.speakToGroup('hon-g3', 'user', '第一轮', ['worker'], '干活')
    // 等待 group-speak 被拒（tool/result 含 HONESTY_REJECTED）
    await waitFor(() => {
      const p = kernel.getGroup('hon-g3')!.projection()
      return p.events.some((e) => e.type === 'tool/result' && e.actor === 'worker' && !e.ok && String(e.content).includes('HONESTY_REJECTED'))
    }, 15_000)
    // 被拒发言未进入公共投影
    const projection = kernel.getGroup('hon-g3')!.projection()
    expect(projection.publicMessages.some((m) => m.content.includes('全部完成'))).toBe(false)
  }, 20_000)

  test('但丁（主窗口/群组内管家）发言不审查（不做具体工作）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cb-kernel-'))
    let honestyCalls = 0
    const kernel = new Kernel(dir, {
      mockResponder: () => '{"reply":"你好，我是管家但丁"}',
      notifyUser: () => undefined,
    })
    await kernel.start()
    contexts.push({ kernel, dir })
    const honestySpec = kernel.toolAgents.get('诚实')!
    const orig = honestySpec.invoke
    honestySpec.invoke = async (input, ctx) => {
      honestyCalls++
      return await orig(input, ctx)
    }
    await kernel.mainWindowSpeak('你好')
    await waitFor(() => kernel.butlerProjection().publicMessages.some((m) => m.actor === 'butler'))
    // 主窗口但丁回复正常发布且未触发【诚实】
    expect(honestyCalls).toBe(0)
    expect(kernel.butlerProjection().publicMessages.some((m) => m.actor === 'butler' && m.content.includes('但丁'))).toBe(true)
  }, 15_000)
})
