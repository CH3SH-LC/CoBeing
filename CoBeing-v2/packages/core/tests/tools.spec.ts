import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createEditorTool } from '../src/tools/editor.js'
import { createGroupSpeakTool } from '../src/tools/group-speak.js'
import { createButlerRelayTool } from '../src/tools/butler-relay.js'
import { WindowLog } from '../src/event-log/window-log.js'
import type { ToolRunContext } from '@cobeing/types'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cobeing-tools-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function makeCtx(agent: string, group = 'g1'): ToolRunContext {
  return {
    agent,
    group,
    cwd: dir,
    guard: { assert: (p) => p, inside: () => true },
    signal: new AbortController().signal,
    speak: async () => {},
    writePrivate: async () => {},
  }
}

describe('str-replace-editor', () => {
  const tool = createEditorTool()
  const file = () => join(dir, 'a.txt')

  it('create + view 往返', async () => {
    await tool.execute({ command: 'create', path: file(), new_string: 'line1\nline2' }, makeCtx('a1'))
    const view = await tool.execute({ command: 'view', path: file() }, makeCtx('a1'))
    expect(view.ok).toBe(true)
    expect((view as { content: string }).content).toContain('1:line1')
    expect((view as { content: string }).content).toContain('2:line2')
  })

  it('create 拒绝已存在文件', async () => {
    await tool.execute({ command: 'create', path: file(), new_string: 'x' }, makeCtx('a1'))
    const again = await tool.execute({ command: 'create', path: file(), new_string: 'y' }, makeCtx('a1'))
    expect(again.ok).toBe(false)
    expect((again as { content: string }).content).toContain('already exists')
  })

  it('str_replace 唯一匹配成功，多匹配/零匹配拒绝', async () => {
    await tool.execute({ command: 'create', path: file(), new_string: 'abc abc' }, makeCtx('a1'))
    // 多匹配拒绝
    const multi = await tool.execute({ command: 'str_replace', path: file(), old_string: 'abc', new_string: 'X' }, makeCtx('a1'))
    expect(multi.ok).toBe(false)
    expect((multi as { content: string }).content).toContain('multiple matches')
    // 零匹配拒绝
    const zero = await tool.execute({ command: 'str_replace', path: file(), old_string: 'zzz', new_string: 'X' }, makeCtx('a1'))
    expect(zero.ok).toBe(false)
    // 唯一匹配成功（扩大上下文）
    const ok = await tool.execute({ command: 'str_replace', path: file(), old_string: 'abc abc', new_string: 'abc X' }, makeCtx('a1'))
    expect(ok.ok).toBe(true)
  })

  it('insert 按行插入', async () => {
    await tool.execute({ command: 'create', path: file(), new_string: 'a\nc' }, makeCtx('a1'))
    const r = await tool.execute({ command: 'insert', path: file(), insert_line: 1, new_string: 'b' }, makeCtx('a1'))
    expect(r.ok).toBe(true)
    const view = await tool.execute({ command: 'view', path: file() }, makeCtx('a1'))
    expect((view as { content: string }).content).toContain('2:b')
  })

  it('write 全量覆盖（已存在文件）', async () => {
    await tool.execute({ command: 'create', path: file(), new_string: 'old content' }, makeCtx('a1'))
    const r = await tool.execute({ command: 'write', path: file(), new_string: 'brand new' }, makeCtx('a1'))
    expect(r.ok).toBe(true)
    const view = await tool.execute({ command: 'view', path: file() }, makeCtx('a1'))
    const content = (view as { content: string }).content
    expect(content).toContain('1:brand new')
    expect(content).not.toContain('old content')
  })

  it('write/create 兼容 content 键名（模型自然语义）', async () => {
    const r1 = await tool.execute({ command: 'write', path: file(), content: 'via content key' }, makeCtx('a1'))
    expect(r1.ok).toBe(true)
    const view = await tool.execute({ command: 'view', path: file() }, makeCtx('a1'))
    expect((view as { content: string }).content).toContain('via content key')
    // create 也兼容 content
    const r2 = await tool.execute({ command: 'create', path: join(dir, 'b.txt'), content: 'created via content' }, makeCtx('a1'))
    expect(r2.ok).toBe(true)
  })

  it('view 支持 offset/limit 分页', async () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line${i + 1}`).join('\n')
    await tool.execute({ command: 'create', path: file(), new_string: lines }, makeCtx('a1'))
    const r = await tool.execute({ command: 'view', path: file(), offset: 3, limit: 3 }, makeCtx('a1'))
    const content = (r as { content: string }).content
    expect(content).toContain('4:line4')
    expect(content).toContain('6:line6')
    expect(content).not.toContain('line7')
  })

  it('view footer：显示范围 + 续读指引（offset=end）+ 精确 totalLines（dsh read 契约）', async () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line${i + 1}`).join('\n')
    await tool.execute({ command: 'create', path: file(), new_string: lines }, makeCtx('a1'))
    // 分页未到底 → 续读指引
    const page = await tool.execute({ command: 'view', path: file(), offset: 3, limit: 3 }, makeCtx('a1'))
    expect((page as { content: string }).content).toContain('(Showing lines 4-6 of 10. Use offset=6 to continue.)')
    // 读到末尾 → 完整范围标注
    const full = await tool.execute({ command: 'view', path: file(), offset: 0, limit: 10 }, makeCtx('a1'))
    expect((full as { content: string }).content).toContain('(Showing lines 1-10 of 10.)')
    // 默认 limit 未到底 → 续读指引（2000 行上限场景：10 行全显示则无指引）
    const small = await tool.execute({ command: 'view', path: file() }, makeCtx('a1'))
    expect((small as { content: string }).content).toContain('(Showing lines 1-10 of 10.)')
  })

  it('相对路径相对 cwd 解析', async () => {
    const r = await tool.execute({ command: 'create', path: 'rel.txt', new_string: 'x' }, makeCtx('a1'))
    expect(r.ok).toBe(true)
    const view = await tool.execute({ command: 'view', path: 'rel.txt' }, makeCtx('a1'))
    expect((view as { content: string }).content).toContain('1:x')
  })

  it('write 在只读守卫下被拒绝', async () => {
    const ctx = makeCtx('a1')
    ctx.guard = {
      assert: (p: string) => p,
      assertWrite: (p: string) => {
        throw new Error(`path write denied (readonly mode): ${p}`)
      },
      inside: () => true,
    }
    const r = await tool.execute({ command: 'write', path: file(), new_string: 'x' }, ctx)
    expect(r.ok).toBe(false)
    expect((r as { content: string }).content).toContain('denied')
  })

  it('越权路径被 guard 拒绝', async () => {
    const denied: string[] = []
    const ctx = makeCtx('a1')
    ctx.guard = {
      assert: (p: string) => {
        if (!p.startsWith(dir)) throw new Error(`path outside allowed root: ${p}`)
        return p
      },
      inside: () => true,
    }
    const r = await tool.execute({ command: 'view', path: join(dir, '..', 'secret.txt') }, ctx)
    expect(r.ok).toBe(false)
    expect(denied).toEqual([])
  })
})

describe('group-speak', () => {
  it('合法 mention 写入 speak 事件；未知成员拒绝', async () => {
    const log = new WindowLog(join(dir, 'log.jsonl'))
    const tool = createGroupSpeakTool((group) => ({
      members: () => (group === 'g1' ? ['user', 'butler', 'a1', 'a2'] : []),
      log,
    }))
    const ok = await tool.execute({ content: '请 a2 帮忙', mention: ['a2'], task: '做 X' }, makeCtx('a1'))
    expect(ok.ok).toBe(true)
    const fail = await tool.execute({ content: '唤醒不存在的人', mention: ['ghost'] }, makeCtx('a1'))
    expect(fail.ok).toBe(false)
    expect((fail as { content: string }).content).toContain('MENTION_FAILED')
    // 事件落盘
    const events = await log.load()
    expect(events.some((e) => e.type === 'speak' && e.actor === 'a1' && (e as { mention?: string[] }).mention?.includes('a2'))).toBe(true)
  })

  it('@all / user / butler 恒合法', async () => {
    const log = new WindowLog(join(dir, 'log.jsonl'))
    const tool = createGroupSpeakTool(() => ({ members: () => ['user', 'butler', 'a1'], log }))
    const r1 = await tool.execute({ content: 'x', mention: ['@all'], task: 't' }, makeCtx('a1'))
    const r2 = await tool.execute({ content: 'x', mention: ['user'] }, makeCtx('a1'))
    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(true)
  })
})

describe('butler-relay', () => {
  it('仅管家可调用；写入主窗口日志 relay 事件', async () => {
    const mainLog = new WindowLog(join(dir, 'main.jsonl'))
    const tool = createButlerRelayTool(mainLog)
    const forbidden = await tool.execute({ content: 'x' }, makeCtx('a1'))
    expect(forbidden.ok).toBe(false)
    const ok = await tool.execute({ content: '需要用户确认', kind: 'question' }, makeCtx('butler', 'g1'))
    expect(ok.ok).toBe(true)
    const events = await mainLog.load()
    expect(events.some((e) => e.type === 'butler/relay' && e.fromGroup === 'g1' && e.kind === 'question')).toBe(true)
  })
})

describe('str-replace-editor fs 观察策略（dsh freshness 移植）', () => {
  const tool = createEditorTool()
  const file = () => join(dir, 'obs.txt')

  it('未 view 直接 write → FS_NOT_OBSERVED（提示先 view）', async () => {
    writeFileSync(file(), 'seed')
    const r = await tool.execute({ command: 'write', path: file(), content: 'x' }, makeCtx('a1'))
    expect(r.ok).toBe(false)
    expect((r as { content: string }).content).toContain('FS_NOT_OBSERVED')
    // 文件未被覆盖
    expect(require('node:fs').readFileSync(file(), 'utf8')).toBe('seed')
  })

  it('view 后外部修改 → 写被 FS_STALE_VERSION 拒绝（re-read 提示）', async () => {
    writeFileSync(file(), 'v1')
    await tool.execute({ command: 'view', path: file() }, makeCtx('a1'))
    // 外部/他智能体修改（stat 版本变化：mtimeMs+size）
    writeFileSync(file(), 'v1-changed-by-other')
    const r = await tool.execute({ command: 'write', path: file(), content: 'mine' }, makeCtx('a1'))
    expect(r.ok).toBe(false)
    expect((r as { content: string }).content).toContain('FS_STALE_VERSION')
    expect((r as { content: string }).content).toContain('re-view')
  })

  it('view 后版本未变 → 写成功；str_replace 同样守卫', async () => {
    writeFileSync(file(), 'alpha beta')
    await tool.execute({ command: 'view', path: file() }, makeCtx('a1'))
    const w = await tool.execute({ command: 'write', path: file(), content: 'gamma' }, makeCtx('a1'))
    expect(w.ok).toBe(true)
    // 写成功后观察版本已刷新 → 再写仍可
    const w2 = await tool.execute({ command: 'write', path: file(), content: 'delta' }, makeCtx('a1'))
    expect(w2.ok).toBe(true)
  })

  it('view 缺失 → 记录 absent；create 可恢复；未确认缺失的已存在文件 create 拒绝', async () => {
    const r1 = await tool.execute({ command: 'view', path: file() }, makeCtx('a1'))
    expect(r1.ok).toBe(false)
    // 确认缺失后可 create
    const c = await tool.execute({ command: 'create', path: file(), content: 'reborn' }, makeCtx('a1'))
    expect(c.ok).toBe(true)
    // 已存在且未确认缺失 → 拒绝（新观察键）
    const again = await tool.execute({ command: 'create', path: file(), content: 'x' }, makeCtx('b1'))
    expect(again.ok).toBe(false)
    expect((again as { content: string }).content).toContain('already exists')
  })

  it('per group/agent 观察隔离', async () => {
    writeFileSync(file(), 'seed')
    await tool.execute({ command: 'view', path: file() }, makeCtx('a1', 'g1'))
    // 另一 agent 未观察 → FS_NOT_OBSERVED
    const r = await tool.execute({ command: 'write', path: file(), content: 'x' }, makeCtx('a2', 'g1'))
    expect(r.ok).toBe(false)
    expect((r as { content: string }).content).toContain('FS_NOT_OBSERVED')
  })
})
