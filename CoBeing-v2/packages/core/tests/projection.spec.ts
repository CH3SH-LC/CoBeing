import { describe, expect, it } from 'vitest'
import { project, renderPublic, renderPrivate, renderToolResults, type ToolRecord } from '../src/event-log/projection.js'
import type { SessionEvent } from '@cobeing/types'

function ev(seq: number, type: SessionEvent['type'], fields: Record<string, unknown>): SessionEvent {
  return { seq, ts: seq, type, ...fields } as SessionEvent
}

describe('projection', () => {
  it('重建公共消息（按 seq 顺序）与私密消息（最新在前）', () => {
    const events = [
      ev(1, 'speak', { actor: 'user', content: '任务开始' }),
      ev(2, 'think', { actor: 'a1', content: '想法1' }),
      ev(3, 'speak', { actor: 'a1', content: '我先看看' }),
      ev(4, 'think', { actor: 'a1', content: '想法2' }),
      ev(5, 'speak', { actor: 'a1', content: '完成' }),
    ]
    const p = project(events)
    expect(p.publicMessages.map((m) => m.actor)).toEqual(['user', 'a1', 'a1'])
    expect(p.publicMessages[2]!.content).toBe('完成')
    // 私密最新在前
    expect(p.privateOf('a1').map((m) => m.content)).toEqual(['想法2', '想法1'])
    expect(p.privateOf('user')).toEqual([])
  })

  it('compaction 遮蔽区间内事件（重建不包含）', () => {
    const events = [
      ev(1, 'speak', { actor: 'user', content: '旧' }),
      ev(2, 'speak', { actor: 'a1', content: '旧2' }),
      ev(3, 'compaction', { actor: 'group', scope: 'public', summary: '压缩摘要', shadowStart: 1, shadowEnd: 2 }),
      ev(4, 'speak', { actor: 'a1', content: '新' }),
    ]
    const p = project(events)
    expect(p.publicMessages.map((m) => m.content)).toEqual(['新'])
    expect(p.compactions).toHaveLength(1)
    expect(p.compactions[0]!.summary).toBe('压缩摘要')
  })

  it('工具调用与结果配对', () => {
    const events = [
      ev(1, 'tool/call', { actor: 'a1', callId: 'c1', name: 'group-speak', arguments: { content: 'x' } }),
      ev(2, 'tool/result', { actor: 'a1', callId: 'c1', ok: true, content: '已发言' }),
    ]
    const p = project(events)
    const tools = p.toolsOf('a1')
    expect(tools).toHaveLength(1)
    expect(tools[0]!.result?.ok).toBe(true)
  })

  it('renderPublic/renderPrivate 组装文本', () => {
    const p = project([
      ev(1, 'speak', { actor: 'user', content: 'hi' }),
      ev(2, 'think', { actor: 'a1', content: 'secret' }),
    ])
    expect(renderPublic(p.publicMessages)).toEqual(['user: hi'])
    expect(renderPrivate(p.privateOf('a1'))).toEqual(['secret'])
  })

  it('renderToolResults 分级裁剪：最近 5 条全量、更早截断（dsh pruner 同思路）', () => {
    const records: ToolRecord[] = []
    for (let i = 1; i <= 8; i++) {
      records.push({
        seq: i,
        actor: 'a1',
        callId: `c${i}`,
        name: 'persistent-bash',
        args: {},
        result: { ok: true, content: `result-${i}-${'x'.repeat(500)}` },
      })
    }
    const out = renderToolResults(records, 20, 5, 400, 60)
    expect(out).toHaveLength(8)
    // 最近 5 条（index 3-7）全量（>400 截断到 400）
    expect(out[7]).toContain('result-8-')
    expect(out[7]).toContain('…[truncated]')
    expect(out[3]).toContain('…[truncated]')
    // 更早 3 条（index 0-2）被 pruner 截断到 60 字符
    expect(out[0]).toContain('…[truncated by pruner]')
    expect(out[2]).toContain('…[truncated by pruner]')
    // 未超限的不截断
    const short: ToolRecord[] = [{
      seq: 1,
      actor: 'a1',
      callId: 'c1',
      name: 'todo-list',
      args: {},
      result: { ok: true, content: 'added #1' },
    }]
    expect(renderToolResults(short)[0]).toBe('tool:todo-list [ok] added #1')
  })
})
