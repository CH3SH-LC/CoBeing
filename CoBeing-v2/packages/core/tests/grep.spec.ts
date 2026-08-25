import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGrepTool } from '../src/tools/grep.js'
import type { PathGuardLike, ToolRunContext } from '@cobeing/types'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cobeing-grep-'))
  mkdirSync(join(dir, 'src'), { recursive: true })
  mkdirSync(join(dir, 'node_modules'), { recursive: true })
  writeFileSync(join(dir, 'src', 'a.ts'), 'const foo = 1\nconst bar = 2\n')
  writeFileSync(join(dir, 'src', 'b.md'), '# Title\nfoo appears here\n')
  writeFileSync(join(dir, 'node_modules', 'lib.ts'), 'foo in node_modules\n')
  writeFileSync(join(dir, 'blob.bin'), '\u0000\u0001foo\u0000') // 二进制含 foo 但应跳过
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function makeCtx(cwd = dir): ToolRunContext {
  const guard: PathGuardLike = {
    assert: (p) => {
      if (!p.startsWith(dir)) throw new Error(`path outside allowed root: ${p}`)
      return p
    },
    inside: () => true,
  }
  return {
    agent: 'a1',
    group: 'g1',
    cwd,
    guard,
    signal: new AbortController().signal,
    speak: async () => {},
    writePrivate: async () => {},
  }
}

describe('grep-files', () => {
  const tool = createGrepTool()

  it('命中返回 path:line:content（相对路径）', async () => {
    const r = await tool.execute({ pattern: 'foo' }, makeCtx())
    expect(r.ok).toBe(true)
    const lines = (r as { content: string }).content.split('\n')
    expect(lines).toContain('src/a.ts:1:const foo = 1')
    expect(lines).toContain('src/b.md:2:foo appears here')
    // 二进制与 node_modules 跳过
    expect(lines.join('\n')).not.toContain('blob.bin')
    expect(lines.join('\n')).not.toContain('node_modules')
  })

  it('include 过滤文件类型', async () => {
    const r = await tool.execute({ pattern: 'foo', include: '*.ts' }, makeCtx())
    expect(r.ok).toBe(true)
    const lines = (r as { content: string }).content.split('\n')
    expect(lines).toContain('src/a.ts:1:const foo = 1')
    expect(lines.join('\n')).not.toContain('b.md')
  })

  it('path 限定子目录', async () => {
    const r = await tool.execute({ pattern: 'foo', path: 'src' }, makeCtx())
    expect(r.ok).toBe(true)
    expect((r as { content: string }).content).not.toContain('node_modules')
  })

  it('无命中返回 no matches', async () => {
    const r = await tool.execute({ pattern: 'zzz' }, makeCtx())
    expect(r.ok).toBe(true)
    expect((r as { content: string }).content).toBe('no matches')
  })

  it('非法正则返回错误', async () => {
    const r = await tool.execute({ pattern: '(' }, makeCtx())
    expect(r.ok).toBe(false)
    expect((r as { content: string }).content).toContain('invalid regex')
  })

  it('越权路径被 guard 拒绝', async () => {
    const r = await tool.execute({ pattern: 'foo', path: join(dir, '..', 'outside') }, makeCtx())
    expect(r.ok).toBe(false)
  })
})
