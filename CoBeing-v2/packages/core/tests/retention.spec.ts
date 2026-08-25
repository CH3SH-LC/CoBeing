import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WindowLog } from '../src/event-log/window-log.js'
import { RegistryStore } from '../src/registry/store.js'
import type { GroupMeta } from '@cobeing/types'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cobeing-retention-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

// ---------- WindowLog.cleanup ----------

describe('WindowLog.cleanup', () => {
  it('删除旧事件，保留新事件且 seq/ts 原样', async () => {
    const file = join(dir, 'log.jsonl')
    const oldTs = Date.now() - 40 * 24 * 60 * 60 * 1000 // 40 天前
    const recentTs = Date.now()
    // 手工写入混合新旧事件（旧事件直接手写 JSON 行）
    appendFileSync(file, JSON.stringify({ seq: 1, ts: oldTs, type: 'speak', actor: 'user', content: 'old-a' }) + '\n')
    appendFileSync(file, JSON.stringify({ seq: 2, ts: recentTs, type: 'speak', actor: 'user', content: 'new-b' }) + '\n')
    appendFileSync(file, JSON.stringify({ seq: 3, ts: oldTs, type: 'think', actor: 'a1', content: 'old-c' }) + '\n')

    const log = new WindowLog(file)
    const removed = await log.cleanup(30 * 24 * 60 * 60 * 1000)

    expect(removed).toBe(2)

    // 从文件中读取重写后的内容
    const log2 = new WindowLog(file)
    const events = await log2.load()
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({ seq: 2, ts: recentTs, type: 'speak', actor: 'user', content: 'new-b' })
  })

  it('seq 游标不受影响：lastSeq 保持最大 seq，追加继续递增', async () => {
    const file = join(dir, 'log.jsonl')
    // 先用 append 写入 2 个新事件，再手写 1 个更旧的 seq=1 事件
    const log = new WindowLog(file)
    const e1 = await log.append({ type: 'speak', actor: 'user', content: 'b' })
    const e2 = await log.append({ type: 'speak', actor: 'user', content: 'c' })
    // 手写一个 seq=1 的旧事件插到文件前面
    const lines: string[] = []
    lines.push(JSON.stringify({ seq: 1, ts: Date.now() - 40 * 24 * 60 * 60 * 1000, type: 'speak', actor: 'user', content: 'old' }))
    lines.push(readFileSync(file, 'utf8'))
    rmSync(file, { force: true })
    appendFileSync(file, lines.join('\n') + '\n')

    const removed = await log.cleanup(30 * 24 * 60 * 60 * 1000)
    expect(removed).toBe(1)

    // lastSeq 不受影响：保持在 cleanup 前 append 到的 seq
    expect(log.lastSeq()).toBe(e2.seq)

    // 继续 append seq 是 maxSeq + 1，不复用旧 seq
    const e3 = await log.append({ type: 'speak', actor: 'user', content: 'd' })
    expect(e3.seq).toBe(e2.seq + 1)
  })

  it('文件不存在返回 0 不报错', async () => {
    const log = new WindowLog(join(dir, 'missing.jsonl'))
    await expect(log.cleanup(30 * 24 * 60 * 60 * 1000)).resolves.toBe(0)
  })

  it('无旧事件时不重写文件并返回 0', async () => {
    const file = join(dir, 'log.jsonl')
    appendFileSync(file, JSON.stringify({ seq: 1, ts: Date.now(), type: 'speak', actor: 'user', content: 'fresh' }) + '\n')
    const log = new WindowLog(file)
    const removed = await log.cleanup(30 * 24 * 60 * 60 * 1000)
    expect(removed).toBe(0)
    const events = await new WindowLog(file).load()
    expect(events).toHaveLength(1)
  })
})

// ---------- RegistryStore.listArchivedGroups ----------

// 构造 GroupMeta 的便捷函数
function makeGroup(
  name: string,
  status: GroupMeta['status'],
  opts: { createdAt?: number; archivedAt?: number; taskSummary?: string } = {},
): GroupMeta {
  return {
    name,
    label: ['user', 'butler', 'worker'],
    space: join(dir, 'group', name),
    spaceMode: 'default',
    status,
    createdAt: opts.createdAt ?? 1000,
    ...(opts.archivedAt !== undefined ? { archivedAt: opts.archivedAt } : {}),
    ...(opts.taskSummary !== undefined ? { taskSummary: opts.taskSummary } : {}),
  }
}

async function newRegistry(): Promise<RegistryStore> {
  const store = new RegistryStore(join(dir, `registry-${Math.random().toString(36).slice(2)}.json`))
  await store.load()
  return store
}

describe('RegistryStore.listArchivedGroups', () => {
  it('只返回 archived，按归档时间降序', async () => {
    const store = await newRegistry()
    // 归档时间：a 最新，b 次新，c 最旧；d 是 working 不应返回
    await store.upsertGroup(makeGroup('a', 'archived', { createdAt: 1000, archivedAt: 300 }))
    await store.upsertGroup(makeGroup('b', 'archived', { createdAt: 1000, archivedAt: 200 }))
    await store.upsertGroup(makeGroup('c', 'archived', { createdAt: 1000, archivedAt: 100 }))
    await store.upsertGroup(makeGroup('d', 'working', { createdAt: 1000 }))

    const list = store.listArchivedGroups()
    expect(list.map((g) => g.name)).toEqual(['a', 'b', 'c'])

    // 缺 archivedAt 时退回 createdAt
    await store.upsertGroup(makeGroup('e', 'archived', { createdAt: 50 }))
    const list2 = store.listArchivedGroups()
    expect(list2.map((g) => g.name)).toEqual(['a', 'b', 'c', 'e'])
  })

  it('since/until 按 archivedAt 过滤（缺失退回 createdAt）', async () => {
    const store = await newRegistry()
    // 用 createdAt 作为引用时间（无 archivedAt）
    await store.upsertGroup(makeGroup('old', 'archived', { createdAt: 100 }))
    await store.upsertGroup(makeGroup('mid', 'archived', { createdAt: 200 }))
    await store.upsertGroup(makeGroup('new', 'archived', { createdAt: 300 }))

    expect(store.listArchivedGroups({ since: 200 }).map((g) => g.name)).toEqual(['new', 'mid'])
    expect(store.listArchivedGroups({ until: 200 }).map((g) => g.name)).toEqual(['mid', 'old'])
    expect(store.listArchivedGroups({ since: 150, until: 250 }).map((g) => g.name)).toEqual(['mid'])
  })

  it('keyword 匹配 taskSummary 或 name，不区分大小写', async () => {
    const store = await newRegistry()
    await store.upsertGroup(makeGroup('alpha', 'archived', { archivedAt: 1, taskSummary: '处理 12 月账单' }))
    await store.upsertGroup(makeGroup('beta', 'archived', { archivedAt: 2, taskSummary: '无关内容' }))
    await store.upsertGroup(makeGroup('GammaGroup', 'archived', { archivedAt: 3 }))

    // name 子串（不区分大小写）
    expect(store.listArchivedGroups({ keyword: 'gAMMA' }).map((g) => g.name)).toEqual(['GammaGroup'])
    // taskSummary 子串
    expect(store.listArchivedGroups({ keyword: '账单' }).map((g) => g.name)).toEqual(['alpha'])
    // working 群组不因 keyword 命中而返回
    await store.upsertGroup(makeGroup('zeta', 'working', { taskSummary: '账单处理中' }))
    expect(store.listArchivedGroups({ keyword: '账单' }).map((g) => g.name)).toEqual(['alpha'])
  })

  it('filter 为空时返回全部 archived', async () => {
    const store = await newRegistry()
    await store.upsertGroup(makeGroup('x', 'archived', { archivedAt: 1 }))
    await store.upsertGroup(makeGroup('y', 'archived', { archivedAt: 2 }))
    await store.upsertGroup(makeGroup('z', 'destroyed', { archivedAt: 3 }))
    const list = store.listArchivedGroups()
    expect(list.map((g) => g.name)).toEqual(['y', 'x'])
  })
})
