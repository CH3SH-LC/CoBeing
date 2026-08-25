/**
 * 事件日志：每窗口一条 append-only JSONL 流
 *
 * - seq 单调分配；追加即持久（appendFile 单行写）。
 * - 冷加载：容忍尾部残缺行（崩溃半写），丢弃并续写游标。
 * - 原子性说明：单行 JSON 追加 + 行尾换行；最后事件可能因崩溃丢失，由上层重建语义容忍。
 */

import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { isSessionEvent, type SessionEvent, type SessionEventInput } from '@cobeing/types'

export class WindowLog {
  private seq = 0
  private loaded = false
  /** 内存缓存：append 追加、load/cleanup 同步；投影每次动态重建时读取 */
  private cache: SessionEvent[] = []

  constructor(private file: string) {}

  /** 冷加载：读取全部事件并恢复 seq 游标（幂等，只允许一次） */
  async load(): Promise<SessionEvent[]> {
    if (this.loaded) throw new Error('window log already loaded')
    this.loaded = true
    const events = await this.readEvents()
    this.seq = maxSeqOf(events)
    this.cache = events
    return events
  }

  /**
   * 30 天保留清理：删除 `ts < Date.now() - olderThanMs` 的事件并原子重写文件。
   *
   * - 保留事件的原 seq 与 ts 不变；文件内 seq 空洞无碍（投影按数组处理）。
   * - seq 游标（lastSeq）不受影响：追加继续递增，绝不复用 seq。
   * - 文件不存在时返回 0，不报错。
   */
  async cleanup(olderThanMs: number): Promise<number> {
    const events = await this.readEvents()
    const cutoff = Date.now() - olderThanMs
    const kept = events.filter((e) => e.ts >= cutoff)
    const removed = events.length - kept.length
    if (removed === 0) return 0
    await this.writeAtomic(kept)
    this.cache = kept
    return removed
  }

  /** 读取并解析全部事件（容忍残缺行）；文件不存在返回空数组 */
  private async readEvents(): Promise<SessionEvent[]> {
    let text: string
    try {
      text = await readFile(this.file, 'utf8')
    } catch {
      return []
    }
    const events: SessionEvent[] = []
    const lines = text.split('\n')
    for (const line of lines) {
      if (!line.trim()) continue
      let parsed: unknown
      try {
        parsed = JSON.parse(line)
      } catch {
        continue // 尾部残缺行（崩溃半写）丢弃
      }
      if (!isSessionEvent(parsed)) continue
      events.push(parsed)
    }
    return events
  }

  /** 原子重写文件：tmp + rename */
  private async writeAtomic(events: SessionEvent[]): Promise<void> {
    const body = events.map((e) => JSON.stringify(e)).join('\n') + '\n'
    await mkdir(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    await writeFile(tmp, body, 'utf8')
    await rename(tmp, this.file)
  }

  /** 追加事件：分配 seq 并落盘，返回完整事件 */
  async append(event: SessionEventInput): Promise<SessionEvent> {
    const full = { ...event, seq: ++this.seq, ts: Date.now() } as SessionEvent
    const line = JSON.stringify(full) + '\n'
    mkdirSync(dirname(this.file), { recursive: true })
    await appendFile(this.file, line, 'utf8')
    this.cache.push(full)
    return full
  }

  /** 同步读取内存缓存（投影每次动态重建用） */
  readCached(): SessionEvent[] {
    return this.cache
  }

  lastSeq(): number {
    return this.seq
  }
}

/** 计算事件集合的最大 seq（空集合为 0） */
function maxSeqOf(events: SessionEvent[]): number {
  let max = 0
  for (const e of events) {
    if (e.seq > max) max = e.seq
  }
  return max
}
