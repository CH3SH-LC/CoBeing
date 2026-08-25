/**
 * 投影：从事件流重建窗口视图（公共上下文 / 私密上下文 / 工具结果）
 *
 * - 组装管线只从投影派生，不另存"当前上下文"真相源（架构 §2.2）。
 * - compaction 事件遮蔽 [shadowStart, shadowEnd] 区间内的事件（重建时跳过）。
 */

import type { SessionEvent, SpeakEvent } from '@cobeing/types'

export interface PublicMessage {
  seq: number
  actor: string
  content: string
  mention?: string[]
  task?: string
  /** 事件时间戳（客户端时间分隔/时间显示用） */
  ts: number
}

export interface PrivateMessage {
  seq: number
  actor: string
  content: string
}

export interface ToolRecord {
  seq: number
  actor: string
  callId: string
  name: string
  args: unknown
  result?: { ok: boolean; content: string; error?: { message: string; code?: string } }
}

export interface WindowProjection {
  events: SessionEvent[]
  /** 公共消息（按逻辑顺序 = seq 顺序） */
  publicMessages: PublicMessage[]
  /** 某 actor 的私密消息（最新在前） */
  privateOf(actor: string): PrivateMessage[]
  /** 某 actor 的工具记录（按 seq 顺序） */
  toolsOf(actor: string): ToolRecord[]
  /** 最近 N 条 speak（供组装） */
  recentSpeaks(limit: number): PublicMessage[]
  /** 压缩遮蔽摘要 */
  compactions: { start: number; end: number; summary: string; scope: 'public' | 'private' }[]
}

/** 计算被压缩遮蔽的 seq 集合 */
function buildShadowed(events: SessionEvent[]): Set<number> {
  const shadowed = new Set<number>()
  for (const event of events) {
    if (event.type !== 'compaction') continue
    for (let seq = event.shadowStart; seq <= event.shadowEnd; seq++) shadowed.add(seq)
  }
  return shadowed
}

export function project(events: SessionEvent[]): WindowProjection {
  const shadowed = buildShadowed(events)
  const visible = events.filter((e) => !shadowed.has(e.seq))

  const publicMessages: PublicMessage[] = []
  const privates = new Map<string, PrivateMessage[]>()
  const tools = new Map<string, ToolRecord[]>()
  const compactions: WindowProjection['compactions'] = []

  for (const event of visible) {
    switch (event.type) {
      case 'speak': {
        const msg: PublicMessage = {
          seq: event.seq,
          actor: event.actor,
          content: event.content,
          mention: event.mention,
          task: event.task,
          ts: event.ts,
        }
        publicMessages.push(msg)
        break
      }
      case 'think': {
        const list = privates.get(event.actor) ?? []
        list.push({ seq: event.seq, actor: event.actor, content: event.content })
        privates.set(event.actor, list)
        break
      }
      case 'tool/call': {
        const list = tools.get(event.actor) ?? []
        list.push({
          seq: event.seq,
          actor: event.actor,
          callId: event.callId,
          name: event.name,
          args: event.arguments,
        })
        tools.set(event.actor, list)
        break
      }
      case 'tool/result': {
        const list = tools.get(event.actor) ?? []
        const record = list.find((t) => t.callId === event.callId)
        if (record) {
          record.result = {
            ok: event.ok,
            content: event.content,
            error: event.error,
          }
        }
        break
      }
      case 'compaction':
        compactions.push({
          start: event.shadowStart,
          end: event.shadowEnd,
          summary: event.summary,
          scope: event.scope,
        })
        break
      default:
        break
    }
  }

  return {
    events: visible,
    publicMessages,
    privateOf(actor: string): PrivateMessage[] {
      return (privates.get(actor) ?? []).slice().reverse() // 最新在前
    },
    toolsOf(actor: string): ToolRecord[] {
      return tools.get(actor) ?? []
    },
    recentSpeaks(limit: number): PublicMessage[] {
      return publicMessages.slice(-limit)
    },
    compactions,
  }
}

/** 组装公共上下文文本（供模型面）：actor: content 行，按序；带任务说明的消息附 [任务: ...]（修复 2：任务锚点在公共上下文同样可见） */
export function renderPublic(messages: PublicMessage[], limit = 200): string[] {
  return messages.slice(-limit).map((m) => `${m.actor}: ${m.content}${m.task ? ` [任务: ${m.task}]` : ''}`)
}

/** 组装私密上下文文本：最新在前（组装公式：追加于自己发言之前） */
export function renderPrivate(messages: PrivateMessage[], limit = 100): string[] {
  return messages.slice(0, limit).map((m) => m.content)
}

/**
 * 渲染工具结果文本（供模型面）：分级裁剪（dsh tool-result-pruner 同思路）
 * - 最近 keepFull 条：全量（单条上限 fullChars，默认 8000）
 * - 更早结果：截断至 staleChars（默认 1024）+ 显式裁剪说明
 * - limit 控制总条数（默认 20）
 */
export function renderToolResults(records: ToolRecord[], limit = 20, keepFull = 5, fullChars = 8000, staleChars = 1024): string[] {
  const out: string[] = []
  const recent = records.slice(-limit)
  const staleCount = Math.max(0, recent.length - keepFull)
  for (let i = 0; i < recent.length; i++) {
    const record = recent[i]!
    const result = record.result
    const body = result
      ? `${result.ok ? '[ok]' : `[error${result.error?.code ? `:${result.error.code}` : ''}]`} ${result.content}`
      : '[pending]'
    const isStale = i < staleCount
    const cap = isStale ? staleChars : fullChars
    let text = `tool:${record.name} ${body}`
    if (text.length > cap) {
      text = text.slice(0, cap) + `…[truncated${isStale ? ' by pruner' : ''}]`
    }
    out.push(text)
  }
  return out
}
