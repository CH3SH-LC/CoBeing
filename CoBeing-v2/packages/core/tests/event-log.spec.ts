import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WindowLog } from '../src/event-log/window-log.js'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cobeing-log-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('WindowLog', () => {
  it('追加事件分配递增 seq 并落盘', async () => {
    const log = new WindowLog(join(dir, 'log.jsonl'))
    const e1 = await log.append({ type: 'speak', actor: 'user', content: 'hello' })
    const e2 = await log.append({ type: 'think', actor: 'a1', content: 'thinking' })
    expect(e1.seq).toBe(1)
    expect(e2.seq).toBe(2)
    expect(e1.type).toBe('speak')
  })

  it('冷加载恢复事件与 seq 游标', async () => {
    const log = new WindowLog(join(dir, 'log.jsonl'))
    await log.append({ type: 'speak', actor: 'user', content: 'a' })
    await log.append({ type: 'speak', actor: 'a1', content: 'b' })

    const log2 = new WindowLog(join(dir, 'log.jsonl'))
    const events = await log2.load()
    expect(events).toHaveLength(2)
    expect(events[0]!.seq).toBe(1)
    expect(events[1]!.seq).toBe(2)
    // 续写游标
    const e3 = await log2.append({ type: 'speak', actor: 'a1', content: 'c' })
    expect(e3.seq).toBe(3)
  })

  it('容忍尾部残缺行（崩溃半写）并丢弃', async () => {
    const { appendFileSync } = await import('node:fs')
    const file = join(dir, 'log.jsonl')
    appendFileSync(file, '{"seq":1,"ts":1,"type":"speak","actor":"user","content":"ok"}\n{"seq":2,"ts":1,"type":"s')
    const log = new WindowLog(file)
    const events = await log.load()
    expect(events).toHaveLength(1)
    expect(events[0]!.seq).toBe(1)
    // 游标不因残缺行错乱
    const e2 = await log.append({ type: 'speak', actor: 'a1', content: 'x' })
    expect(e2.seq).toBe(2)
  })

  it('空文件加载为空', async () => {
    const log = new WindowLog(join(dir, 'missing.jsonl'))
    const events = await log.load()
    expect(events).toEqual([])
  })

  it('重复 load 抛错（只允许一次）', async () => {
    const log = new WindowLog(join(dir, 'log.jsonl'))
    await log.load()
    await expect(log.load()).rejects.toThrow('already loaded')
  })
})
