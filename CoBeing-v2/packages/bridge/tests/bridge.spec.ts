/**
 * 内核桥 e2e：进程内 JSON-RPC 2.0 over 内存 transport 驱动 BridgeServer + 真实 Kernel
 *
 * - 内存 transport：收集输出行 + 手动分发输入行；不 spawn 子进程。
 * - 全部用 MockProvider 可编程 responder 驱动（真实 LLM 环节由网关隔离；经 Kernel.mockResponder 注入）。
 * - AgentInstance 的 wake 是异步 fire-and-forget，测试用 waitFor 轮询等待。
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { Kernel, type ChatRequest } from '@cobeing/core'
import { BridgeServer, type BridgeTransport } from '../src/server.js'

// ---------- 内存 transport ----------

interface MemoryTransport extends BridgeTransport {
  lines: string[]
  /** 手动分发一行输入给订阅者 */
  dispatch(line: string): void
  /** 等待 id 匹配的响应行（JSON 解析后返回）；超时抛错 */
  nextReply(id: number | string): Promise<Record<string, any>>
}

function createMemoryTransport(): MemoryTransport {
  const lines: string[] = []
  const subs = new Set<(line: string) => void>()
  const pending = new Map<string, Array<(value: Record<string, any>) => void>>()

  const next = (id: number | string, line: string): void => {
    const key = String(id)
    const list = pending.get(key) ?? []
    pending.delete(key)
    list.forEach((resolve) => resolve(JSON.parse(line) as Record<string, any>))
  }

  return {
    lines,
    send(line: string): void {
      lines.push(line)
      // 尝试按响应 id 归还等待者
      try {
        const parsed = JSON.parse(line) as { id?: number | string }
        if (parsed.id !== undefined && parsed.id !== null) next(parsed.id, line)
      } catch {
        // 忽略非法行
      }
    },
    onLine(cb: (line: string) => void): () => void {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    dispatch(line: string): void {
      for (const cb of subs) cb(line)
    },
    nextReply(id: number | string): Promise<Record<string, any>> {
      const key = String(id)
      const list = pending.get(key) ?? []
      const promise = new Promise<Record<string, any>>((resolve, reject) => {
        list.push(resolve)
        setTimeout(() => reject(new Error(`no reply for id ${key}`)), 8000)
      })
      pending.set(key, list)
      return promise
    },
  }
}

interface TestCtx {
  kernel: Kernel
  bridge: BridgeServer
  transport: MemoryTransport
  dir: string
  requestSeq: number
}

const contexts: TestCtx[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) {
    try {
      ctx.bridge.stop()
    } catch {
      // 忽略
    }
    try {
      await ctx.kernel.stop()
    } catch {
      // 忽略
    }
    rmSync(ctx.dir, { recursive: true, force: true })
  }
})

/** 可编程 responder：按最后 user 消息内容分派（先匹配更具体的唤醒指令） */
function routingResponder(req: ChatRequest): string {
  const last = req.messages[req.messages.length - 1]?.content ?? ''
  if (last.includes('转告用户')) {
    return '{"toolCalls":[{"name":"butler-relay","args":{"content":"任务完成","kind":"report"}}]}'
  }
  if (last.includes('欢迎语')) return '{"reply":"欢迎来到 CoBeing！"}'
  if (last.includes('你好')) return '{"reply":"你好，我是管家铃音"}'
  return '{"reply":"(mock) 已收到"}'
}

async function setup(): Promise<TestCtx> {
  const dir = mkdtempSync(join(tmpdir(), 'cb-bridge-'))
  const kernel = new Kernel(dir, {
    mockResponder: routingResponder,
    notifyUser: () => undefined,
  })
  const transport = createMemoryTransport()
  const bridge = new BridgeServer(kernel, transport)
  bridge.start()
  const ctx: TestCtx = { kernel, bridge, transport, dir, requestSeq: 0 }
  contexts.push(ctx)
  // 启动内核（经桥 RPC start）
  await rpc(ctx, 'start')
  // 统一注册测试成员（规格：群组 label 成员必须在名录）
  await rpc(ctx, 'requestCreateAgent', { def: { name: 'writer', role: '写作者', createdAt: Date.now() } })
  await rpc(ctx, 'confirmAgent', { name: 'writer' })
  return ctx
}

/** 发起一条 RPC 请求并等待响应行；返回 { reply, id } */
async function rpc(ctx: TestCtx, method: string, params?: unknown): Promise<{ reply: Record<string, any>; id: number }> {
  const id = ++ctx.requestSeq
  const request = { jsonrpc: '2.0', id, method }
  if (params !== undefined) (request as Record<string, unknown>).params = params
  const replyPromise = ctx.transport.nextReply(id)
  ctx.transport.dispatch(JSON.stringify(request))
  return { reply: await replyPromise, id }
}

/** 轮询等待 truthy；超时抛错 */
async function waitFor(fn: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timeout')
    await new Promise((r) => setTimeout(r, 50))
  }
}

// ---------- 用例 ----------

describe('bridge e2e', () => {
  test('ping → result.pong true', async () => {
    const ctx = await setup()
    const { reply } = await rpc(ctx, 'ping')
    expect(reply.jsonrpc).toBe('2.0')
    expect(typeof reply.id).toBe('number')
    expect(reply.result.pong).toBe(true)
    expect(typeof reply.result.ts).toBe('number')
  })

  test('智能体全流程：requestCreateAgent → 待批准 → confirm → listAgents', async () => {
    const ctx = await setup()
    await rpc(ctx, 'requestCreateAgent', {
      def: { name: 'researcher', role: '调研员', createdAt: Date.now() },
    })
    const { reply: pending } = await rpc(ctx, 'listPendingApprovals')
    expect(pending.result.some((a: any) => a.name === 'researcher')).toBe(true)
    await rpc(ctx, 'confirmAgent', { name: 'researcher' })
    const { reply: agents } = await rpc(ctx, 'listAgents')
    expect(agents.result.some((a: any) => a.name === 'researcher')).toBe(true)
  })

  test('群组全流程：createGroup → speakToGroup → writer 发言进投影', async () => {
    const ctx = await setup()
    const { reply: created } = await rpc(ctx, 'createGroup', {
      name: 'demo',
      label: ['user', 'butler', 'writer'],
    })
    expect(created.result.name).toBe('demo')
    expect(created.result.status).toBe('working')

    await rpc(ctx, 'speakToGroup', {
      group: 'demo',
      actor: 'user',
      content: '请 writer 写一段话',
      mention: ['writer'],
      task: '写一段欢迎语',
    })

    // 轮询：writer 发言
    await waitFor(() => {
      const proj = ctx.kernel.getGroup('demo')!.projection()
      return proj.publicMessages.some((m) => m.actor === 'writer')
    })
    const { reply: projection } = await rpc(ctx, 'groupProjection', { group: 'demo' })
    const writerMsg = projection.result.publicMessages.find((m: any) => m.actor === 'writer')
    expect(writerMsg).toBeTruthy()
    expect(writerMsg.content).toContain('欢迎来到 CoBeing！')
    // 序列化只含纯数据字段
    expect(projection.result.publicMessages[0]).not.toHaveProperty('methods')
    expect(projection.result.compactions).toEqual([])
  })

  test('群内管家 relay：butler-relay 工具回主窗口', async () => {
    const ctx = await setup()
    await rpc(ctx, 'createGroup', { name: 'relay-g', label: ['user', 'butler', 'writer'] })
    await rpc(ctx, 'speakToGroup', {
      group: 'relay-g',
      actor: 'user',
      content: '@butler 请转告用户：任务完成',
      mention: ['butler'],
    })
    // 轮询主窗口日志出现 butler/relay 事件
    await waitFor(() => ctx.kernel.butlerLog.readCached().some((e) => e.type === 'butler/relay'))
    const relay = ctx.kernel.butlerLog.readCached().find((e) => e.type === 'butler/relay')
    expect(relay!.type).toBe('butler/relay')
    expect(relay!.content).toBe('任务完成')
  })

  test('归档：archiveGroup → listArchivedGroups → 复用建议 → dismiss 清空', async () => {
    const ctx = await setup()
    await rpc(ctx, 'createGroup', { name: 'arch1', label: ['user', 'butler', 'writer'] })
    await rpc(ctx, 'archiveGroup', { name: 'arch1' })
    const { reply: archived } = await rpc(ctx, 'listArchivedGroups')
    expect(archived.result.some((g: any) => g.name === 'arch1' && g.status === 'archived')).toBe(true)

    let { reply: suggestions } = await rpc(ctx, 'listReuseSuggestions')
    expect(suggestions.result.length).toBeGreaterThan(0)
    const target = suggestions.result.find((s: any) => s.fromGroup === 'arch1')
    expect(target).toBeTruthy()
    await rpc(ctx, 'dismissReuseSuggestion', { id: target.id })
    ;({ reply: suggestions } = await rpc(ctx, 'listReuseSuggestions'))
    expect(suggestions.result.some((s: any) => s.id === target.id)).toBe(false)
  })

  test('主窗口：mainWindowSpeak → 管家铃音回复进 butlerProjection', async () => {
    const ctx = await setup()
    await rpc(ctx, 'mainWindowSpeak', { content: '你好' })
    await waitFor(() => {
      const proj = ctx.kernel.butlerProjection()
      return proj.publicMessages.some((m) => m.actor === 'butler' && m.content.includes('铃音'))
    })
    const { reply: projection } = await rpc(ctx, 'butlerProjection')
    const actors = projection.result.publicMessages.map((m: any) => m.actor)
    expect(actors).toContain('user')
    expect(actors).toContain('butler')
  })

  test('主窗口会话：newConversation 归档 → listConversations → 历史只读投影', async () => {
    const ctx = await setup()
    await rpc(ctx, 'mainWindowSpeak', { content: '你好' })
    await waitFor(() => {
      const proj = ctx.kernel.butlerProjection()
      return proj.publicMessages.some((m) => m.actor === 'butler')
    })

    // 开新对话（归档时经自适总结写管家经验档案）
    const { reply: created } = await rpc(ctx, 'butler/newConversation')
    expect(created.result.id).toMatch(/^conv-/)

    // 经验档案信息：但丁归档后有条目
    const { reply: expInfo } = await rpc(ctx, 'experience/info', { agent: 'butler' })
    expect(expInfo.result.agent).toBe('butler')
    expect(expInfo.result.count).toBeGreaterThan(0)
    expect(expInfo.result.lastUpdated).toBeGreaterThan(0)
    // 无档案智能体 → count 0
    const { reply: expEmpty } = await rpc(ctx, 'experience/info', { agent: 'ghost' })
    expect(expEmpty.result.count).toBe(0)
    // 参数错误 → -32602
    const { reply: badExp } = await rpc(ctx, 'experience/info', {})
    expect(badExp.error.code).toBe(-32602)

    // 列表：当前 + 历史
    const { reply: list } = await rpc(ctx, 'butler/listConversations')
    expect(list.result[0].current).toBe(true)
    const hist = list.result.find((c: any) => !c.current)
    expect(hist).toBeTruthy()
    expect(hist.archivedAt).toBeGreaterThan(0)

    // 历史会话只读投影：保留第一会话消息
    const { reply: histProj } = await rpc(ctx, 'butler/conversationProjection', { id: hist.id })
    expect(histProj.result.publicMessages.some((m: any) => m.actor === 'user')).toBe(true)

    // 当前投影带 context（自动压缩可见性：估算 token / 阈值）
    const { reply: curProj } = await rpc(ctx, 'butlerProjection')
    expect(curProj.result.context).toBeDefined()
    expect(curProj.result.context.thresholdTokens).toBeGreaterThan(0)

    // 参数错误 → -32602
    const { reply: bad } = await rpc(ctx, 'butler/conversationProjection', {})
    expect(bad.error.code).toBe(-32602)
    // 不存在 id → -32000
    const { reply: missing } = await rpc(ctx, 'butler/conversationProjection', { id: 'conv-nope' })
    expect(missing.error.code).toBe(-32000)
  })

  test('错误面：未知方法 → -32601；speakToGroup 不存在群 → -32000', async () => {
    const ctx = await setup()
    const { reply: unknown } = await rpc(ctx, 'noSuchMethod')
    expect(unknown.error.code).toBe(-32601)

    const { reply: missing } = await rpc(ctx, 'speakToGroup', {
      group: 'nonexistent',
      actor: 'user',
      content: 'hi',
    })
    expect(missing.error.code).toBe(-32000)
    expect(missing.error.message).toContain('group not found')
  })

  test('speakAs 别名：模拟群内智能体发言进投影', async () => {
    const ctx = await setup()
    await rpc(ctx, 'createGroup', { name: 'alias-g', label: ['user', 'butler', 'writer'] })
    await rpc(ctx, 'speakAs', {
      group: 'alias-g',
      actor: 'writer',
      content: '我是 writer（e2e 模拟）',
    })
    const { reply: projection } = await rpc(ctx, 'groupProjection', { group: 'alias-g' })
    expect(projection.result.publicMessages.some((m: any) => m.actor === 'writer')).toBe(true)
  })

  test('group/status：成员忙碌标记 + 任务摘要 + 最近活动', async () => {
    const ctx = await setup()
    await rpc(ctx, 'createGroup', { name: 'st-g', label: ['user', 'butler', 'writer'] })
    await rpc(ctx, 'speakToGroup', {
      group: 'st-g',
      actor: 'user',
      content: '请 writer 干活',
      mention: ['writer'],
      task: '写欢迎语',
    })
    const { reply: status } = await rpc(ctx, 'group/status', { group: 'st-g' })
    expect(status.result.name).toBe('st-g')
    expect(status.result.members.map((m: any) => m.name)).toEqual(['user', 'butler', 'writer'])
    expect(status.result.taskSummary).toBe('写欢迎语')
    expect(typeof status.result.lastActivity).toBe('number')
    // 参数错误 → -32602；未知群组 → -32000
    const { reply: bad } = await rpc(ctx, 'group/status', {})
    expect(bad.error.code).toBe(-32602)
    const { reply: missing } = await rpc(ctx, 'group/status', { group: 'nope' })
    expect(missing.error.code).toBe(-32000)
  })

  test('experience/entries + experience/search：条目浏览与关键词检索', async () => {
    const ctx = await setup()
    await ctx.kernel.memory.append('writer', { source: 'group:g1', content: '路径记录 a.txt', tags: ['file'] })
    await ctx.kernel.memory.append('writer', { source: 'turn:g1', content: 'node 等待 3 秒', tags: ['bash'] })

    const { reply: entries } = await rpc(ctx, 'experience/entries', { agent: 'writer' })
    expect(entries.result.length).toBe(2)
    expect(entries.result[0].content).toContain('node 等待')
    expect(entries.result[0].ts).toBeGreaterThan(0)
    expect(entries.result[0].tags).toEqual(['bash'])

    const { reply: hit } = await rpc(ctx, 'experience/search', { agent: 'writer', keyword: 'a.txt' })
    expect(hit.result.length).toBe(1)
    expect(hit.result[0].source).toBe('group:g1')

    const { reply: none } = await rpc(ctx, 'experience/search', { agent: 'writer', keyword: '不存在' })
    expect(none.result.length).toBe(0)

    // 参数错误 → -32602
    const { reply: bad } = await rpc(ctx, 'experience/entries', {})
    expect(bad.error.code).toBe(-32602)
  })

  test('投影消息带时间戳 ts（时间分隔/时间显示用）', async () => {
    const ctx = await setup()
    await rpc(ctx, 'createGroup', { name: 'ts-g', label: ['user', 'butler', 'writer'] })
    await rpc(ctx, 'speakToGroup', { group: 'ts-g', actor: 'user', content: '带时间戳消息' })
    const { reply: projection } = await rpc(ctx, 'groupProjection', { group: 'ts-g' })
    expect(typeof projection.result.publicMessages[0].ts).toBe('number')
  })

  test('参数错误 → -32602', async () => {
    const ctx = await setup()
    const { reply: bad } = await rpc(ctx, 'mainWindowSpeak', { content: 123 })
    expect(bad.error.code).toBe(-32602)
  })
})
