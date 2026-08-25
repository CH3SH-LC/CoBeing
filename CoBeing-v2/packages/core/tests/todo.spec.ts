import { describe, expect, it } from 'vitest'
import { createTodoTool, TodoStore, type TodoWriteEntry } from '../src/tools/todo.js'
import type { ToolRunContext } from '@cobeing/types'

function makeCtx(group: string, agent: string): ToolRunContext {
  return {
    agent,
    group,
    cwd: process.cwd(),
    guard: { assert: (p) => p, inside: () => true },
    signal: new AbortController().signal,
    speak: async () => {},
    writePrivate: async () => {},
  }
}

/** 记录持久化调用的内存通道 */
function makePersistence() {
  const writes: Array<{ group: string; agent: string; todos: TodoWriteEntry[] }> = []
  const persist = async (group: string, agent: string, todos: TodoWriteEntry[]) => {
    writes.push({ group, agent, todos: todos.map((t) => ({ ...t })) })
  }
  return { writes, persist }
}

describe('todo-list', () => {
  const { writes, persist } = makePersistence()
  const store = new TodoStore(persist)
  const tool = createTodoTool(store)
  const ctx = makeCtx('g1', 'coder')
  const ctx2 = makeCtx('g1', 'writer')

  it('add 追加并返回清单；变更落盘完整清单（整表替换）', async () => {
    const r = await tool.execute({ command: 'add', content: '任务一' }, ctx)
    expect(r.ok).toBe(true)
    expect((r as { content: string }).content).toContain('#1 任务一')
    expect((r as { content: string }).content).toContain('[pending]')
    // 持久化：完整清单（含 id/content/status）
    expect(writes.length).toBe(1)
    expect(writes[0]).toMatchObject({ group: 'g1', agent: 'coder' })
    expect(writes[0]!.todos).toEqual([{ id: 1, content: '任务一', status: 'pending' }])
  })

  it('add 防重复：相同未完成内容不重复添加（防模型空转刷屏）', async () => {
    const { persist: persist2 } = makePersistence()
    const store2 = new TodoStore(persist2)
    const tool2 = createTodoTool(store2)
    const ctxDup = makeCtx('g-dup', 'coder')
    await tool2.execute({ command: 'add', content: '写代码' }, ctxDup)
    const dup = await tool2.execute({ command: 'add', content: '写代码' }, ctxDup)
    expect(dup.ok).toBe(true)
    expect((dup as { content: string }).content).toContain('已存在相同任务')
    expect((dup as { content: string }).content).not.toContain('added #')
    // 清单只有一条
    const list = await tool2.execute({ command: 'list' }, ctxDup)
    expect((list as { content: string }).content).toContain('#1 写代码')
    expect((list as { content: string }).content).not.toContain('#2')
    // 完成后可再次添加相同内容（新任务）
    await tool2.execute({ command: 'complete', id: 1 }, ctxDup)
    const again = await tool2.execute({ command: 'add', content: '写代码' }, ctxDup)
    expect((again as { content: string }).content).toContain('#2 写代码')
  })

  it('update 修改状态/内容', async () => {
    const r = await tool.execute({ command: 'update', id: 1, status: 'in_progress' }, ctx)
    expect(r.ok).toBe(true)
    expect((r as { content: string }).content).toContain('[in_progress]')
    const r2 = await tool.execute({ command: 'update', id: 1, content: '任务一（改）' }, ctx)
    expect((r2 as { content: string }).content).toContain('任务一（改）')
  })

  it('complete 完成', async () => {
    const r = await tool.execute({ command: 'complete', id: 1 }, ctx)
    expect(r.ok).toBe(true)
    expect((r as { content: string }).content).toContain('[completed]')
  })

  it('list 返回全部', async () => {
    await tool.execute({ command: 'add', content: '任务二' }, ctx)
    const r = await tool.execute({ command: 'list' }, ctx)
    expect((r as { content: string }).content).toContain('#1')
    expect((r as { content: string }).content).toContain('#2 任务二')
  })

  it('per agent 隔离', async () => {
    const r = await tool.execute({ command: 'list' }, ctx2)
    expect(r.ok).toBe(true)
    expect((r as { content: string }).content).toBe('（空清单）')
  })

  it('错误面：无 id / 未知命令 / 不存在条目', async () => {
    expect((await tool.execute({ command: 'update' }, ctx)).ok).toBe(false)
    expect((await tool.execute({ command: 'complete', id: 999 }, ctx)).ok).toBe(false)
    expect((await tool.execute({ command: 'nope' }, ctx)).ok).toBe(false)
    expect((await tool.execute({ command: 'add' }, ctx)).ok).toBe(false)
  })
})

describe('TodoStore 日志重建（dsh todo/write last-write-wins）', () => {
  it('replay 从窗口事件恢复完整清单（最后一个事件胜出）', async () => {
    const { persist } = makePersistence()
    const store = new TodoStore(persist)
    // 模拟窗口日志中的 todo/write 事件序列
    store.replay('g1', [
      { type: 'speak', actor: 'coder' },
      { type: 'todo/write', actor: 'coder', todos: [{ id: 1, content: '旧任务', status: 'pending' }] },
      { type: 'todo/write', actor: 'coder', todos: [{ id: 1, content: '旧任务', status: 'completed' }, { id: 2, content: '新任务', status: 'pending' }] },
      { type: 'todo/write', actor: 'writer', todos: [{ id: 1, content: '作家任务', status: 'pending' }] },
    ])
    const coder = store.list('g1', 'coder')
    expect(coder).toHaveLength(2)
    expect(coder[0]).toMatchObject({ id: 1, status: 'completed' })
    expect(coder[1]).toMatchObject({ id: 2, content: '新任务' })
    // per agent 独立恢复
    expect(store.list('g1', 'writer')).toHaveLength(1)
    // 其他群组不受影响
    expect(store.list('g2', 'coder')).toHaveLength(0)
  })

  it('重建后工具继续基于恢复状态工作', async () => {
    const { writes, persist } = makePersistence()
    const store = new TodoStore(persist)
    store.replay('g1', [
      { type: 'todo/write', actor: 'coder', todos: [{ id: 1, content: '已有任务', status: 'in_progress' }] },
    ])
    const tool = createTodoTool(store)
    const ctx = makeCtx('g1', 'coder')
    const r = await tool.execute({ command: 'complete', id: 1 }, ctx)
    expect(r.ok).toBe(true)
    expect((r as { content: string }).content).toContain('[completed]')
    // 变更又落盘
    expect(writes[writes.length - 1]!.todos[0]).toMatchObject({ id: 1, status: 'completed' })
  })
})
