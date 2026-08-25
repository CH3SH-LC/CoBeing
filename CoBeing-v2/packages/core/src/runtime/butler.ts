/**
 * 管家运行时（规格 §3 + 管家.md 双实例模型）
 *
 * - 主窗口管家：独立日志（data/butler/log.jsonl）+ 人格/经验（data/memory/butler.md）；
 *   每 100k token 归档记忆 + 压缩（阈值可配置；真实流程 = 总结→分段压缩→compaction 事件遮蔽）。
 * - 群组内管家：由 GroupRuntime 以 AgentInstance 形式创建（组装同工作智能体），
 *   经 butler-relay 工具消息回主窗口；主窗口收到 relay 后被唤醒回复用户。
 * - 主窗口对话循环本身由内核创建但丁 AgentInstance 承担（见 kernel.ts / butler-persona.ts）。
 */

import type { NotifyPayload, SessionEvent } from '@cobeing/types'
import type { WindowLog } from '../event-log/window-log.js'
import { project, renderPublic } from '../event-log/projection.js'

/** 主窗口上下文归档阈值（规格：每 100k token 归档一次记忆 + 压缩） */
export const BUTLER_ARCHIVE_THRESHOLD_TOKENS = 100_000
/** 压缩分段粒度（D7 定案：每 20k tokens 一段 ≈ 80k 字符，字符/token 按 4:1 估算） */
export const COMPRESS_SEGMENT_CHARS = 80_000
/** 归档总结环节送入 LLM 的文本上限（避免单次请求过大） */
export const ARCHIVE_SUMMARIZE_MAX_CHARS = 100_000

export interface ButlerRuntimeOptions {
  log: WindowLog
  /** 估算当前主窗口上下文 token 数（字符数/4 估算，真实计数待 provider usage 接线） */
  estimateTokens: () => number
  /** 归档阈值 token 数（默认 100_000；0 或负值禁用自动归档） */
  thresholdTokens?: number
  /** LLM 摘要环节（半硬编码中唯一 LLM 步骤；由内核注入，可 mock） */
  summarize?: (text: string, instruction: string) => Promise<string>
  /**
   * 归档记忆总结（方案 v0.1.1）：经工具智能体【记忆】执行——总结并写经验档案一体。
   * 提供时优先于 summarize + archiveMemory 组合；缺省回退两者。
   */
  summarizeArchive?: (text: string) => Promise<void>
  /** 归档总结 → 写管家经验档案（条目式 md；仅无 summarizeArchive 时使用） */
  archiveMemory?: (summary: string) => Promise<void>
  /** 归档完成通知（GUI 占位：任务栏闪烁 + 一声滴；text 类型 payload） */
  notifyUser?: (payload: NotifyPayload) => void
}

export class ButlerRuntime {
  private readonly thresholdTokens: number

  constructor(private opts: ButlerRuntimeOptions) {
    this.thresholdTokens = opts.thresholdTokens ?? BUTLER_ARCHIVE_THRESHOLD_TOKENS
  }

  /** 主窗口收到群组内管家中转消息（butler/relay 事件） */
  async handleRelay(relay: { fromGroup: string; content: string; kind: 'question' | 'report' | 'escalation' }): Promise<void> {
    await this.opts.log.append({ type: 'butler/relay', fromGroup: relay.fromGroup, content: relay.content, kind: relay.kind })
    // 通知用户（GUI 接线后：任务栏闪烁 + 滴声）；真实回复经主窗口循环
    this.opts.notifyUser?.({ type: 'text', content: `[${relay.fromGroup} → 管家] ${relay.kind}: ${relay.content}` })
    await this.maybeArchive()
  }

  /** 主窗口每次模型调用后检查阈值（内核在但丁循环每轮后调用） */
  async maybeArchive(): Promise<void> {
    if (this.thresholdTokens <= 0) return
    if (this.opts.estimateTokens() < this.thresholdTokens) return
    await this.archiveAndCompact('主窗口上下文达阈值，自动归档')
  }

  /** 用户手动清空（清空之前先总结归档 + 压缩遮蔽） */
  async clearContext(): Promise<void> {
    await this.archiveAndCompact('用户手动清空上下文，先总结归档')
  }

  /**
   * 真实归档流程（规格：公共超长走全量压缩流程——总结→压缩→管家重启工作）：
   * 1. 总结公共上下文 → 写管家经验档案（archiveMemory）
   * 2. 分段压缩（COMPRESS_SEGMENT_CHARS 每段）→ 组装压缩摘要
   * 3. 写 compaction 事件遮蔽全部旧 seq（投影重建后旧事件不再可见）
   */
  private async archiveAndCompact(reason: string): Promise<void> {
    const events = this.opts.log.readCached()
    if (events.length === 0) return
    const summarize = this.opts.summarize
    if (!this.opts.summarizeArchive && !summarize) {
      this.opts.notifyUser?.({ type: 'text', content: `[管家归档] ${reason}，但 LLM 摘要未接线，跳过真实压缩（占位）` })
      return
    }
    const projection = project(events)
    const publicText = renderPublic(projection.publicMessages, Number.MAX_SAFE_INTEGER).join('\n')
    const usable = publicText.trim()
    if (!usable) return

    // 1) 总结 → 经验档案（经【记忆】工具智能体：总结并写档案一体；缺省回退 summarize + archiveMemory）
    if (this.opts.summarizeArchive) {
      await this.opts.summarizeArchive(usable.slice(0, ARCHIVE_SUMMARIZE_MAX_CHARS))
    } else if (this.opts.archiveMemory && summarize) {
      const summary = await summarize(
        usable.slice(0, ARCHIVE_SUMMARIZE_MAX_CHARS),
        '主窗口对话归档总结：提炼关键结论、决策、用户偏好与未完成事项，输出简洁条目化内容。',
      )
      await this.opts.archiveMemory(summary)
    }

    // 2) 分段压缩（无 summarize 时跳过压缩遮蔽，但归档记忆总结已写入）
    let compressed = ''
    if (summarize) {
      const segments = chunkText(usable, COMPRESS_SEGMENT_CHARS)
      const parts: string[] = []
      for (const [index, segment] of segments.entries()) {
        const part = await summarize(segment, `（第 ${index + 1}/${segments.length} 段）压缩为简洁摘要，保留关键信息、决策与数据。`)
        parts.push(part)
      }
      compressed = parts.join('\n---\n')

      // 3) compaction 事件遮蔽全部旧公共 seq
      const lastSeq = this.opts.log.lastSeq()
      await this.opts.log.append({
        type: 'compaction',
        actor: 'butler',
        scope: 'public',
        summary: compressed,
        shadowStart: 1,
        shadowEnd: lastSeq,
      })
      this.opts.notifyUser?.({ type: 'text', content: `[管家归档] ${reason}：已总结写入经验档案并压缩 ${segments.length} 段（遮蔽 seq 1..${lastSeq}）` })
    }
  }
}

/** 按字符数分段（保留完整段落边界不做特殊处理，简单截断即可） */
export function chunkText(text: string, chunkChars: number): string[] {
  if (text.length <= chunkChars) return [text]
  const chunks: string[] = []
  for (let i = 0; i < text.length; i += chunkChars) {
    chunks.push(text.slice(i, i + chunkChars))
  }
  return chunks
}

/** 从事件流估算 token（字符数/4；供内核注入 estimateTokens） */
export function estimateTokensFromEvents(events: SessionEvent[]): number {
  let chars = 0
  for (const event of events) {
    chars += JSON.stringify(event).length
  }
  return Math.ceil(chars / 4)
}
