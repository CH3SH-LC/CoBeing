import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGlobTool, globToRegExp } from '../src/tools/glob.js'
import type { PathGuardLike, ToolRunContext } from '@cobeing/types'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cobeing-glob-'))
  mkdirSync(join(dir, 'sub', 'deep'), { recursive: true })
  mkdirSync(join(dir, 'node_modules'), { recursive: true })
  mkdirSync(join(dir, '.git'), { recursive: true })
  writeFileSync(join(dir, 'a.ts'), '')
  writeFileSync(join(dir, 'a.txt'), '')
  writeFileSync(join(dir, 'sub', 'b.ts'), '')
  writeFileSync(join(dir, 'sub', 'c.md'), '')
  writeFileSync(join(dir, 'sub', 'deep', 'd.ts'), '')
  writeFileSync(join(dir, 'node_modules', 'skip.ts'), '')
  writeFileSync(join(dir, '.git', 'config'), '')
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

describe('glob-files', () => {
  const tool = createGlobTool()

  it('无斜杠模式匹配任意深度 basename', async () => {
    const r = await tool.execute({ pattern: '*.ts' }, makeCtx())
    expect(r.ok).toBe(true)
    const lines = (r as { content: string }).content.split('\n').sort()
    expect(lines).toEqual(['a.ts', 'sub/b.ts', 'sub/deep/d.ts'].sort())
  })

  it('** 递归匹配', async () => {
    const r = await tool.execute({ pattern: '**/*.ts' }, makeCtx())
    expect(r.ok).toBe(true)
    const lines = (r as { content: string }).content.split('\n').sort()
    expect(lines).toEqual(['a.ts', 'sub/b.ts', 'sub/deep/d.ts'].sort())
  })

  it('带斜杠模式按相对路径锚定', async () => {
    const r = await tool.execute({ pattern: 'sub/*.ts' }, makeCtx())
    expect(r.ok).toBe(true)
    expect((r as { content: string }).content.split('\n')).toEqual(['sub/b.ts'])
  })

  it('跳过 node_modules / .git', async () => {
    const r = await tool.execute({ pattern: '*.ts' }, makeCtx())
    expect((r as { content: string }).content).not.toContain('skip.ts')
    const any = await tool.execute({ pattern: '*' }, makeCtx())
    expect((any as { content: string }).content).not.toContain('node_modules/')
    expect((any as { content: string }).content).not.toContain('.git/')
  })

  it('无匹配返回提示', async () => {
    const r = await tool.execute({ pattern: '*.rs' }, makeCtx())
    expect(r.ok).toBe(true)
    expect((r as { content: string }).content).toBe('no files matched')
  })

  it('越权路径被 guard 拒绝', async () => {
    const r = await tool.execute({ pattern: '*.ts' }, makeCtx(join(dir, '..', 'outside')))
    expect(r.ok).toBe(false)
  })
})

describe('globToRegExp', () => {
  it('无斜杠模式 = 任意深度 basename', () => {
    expect(globToRegExp('*.ts').test('a.ts')).toBe(true)
    expect(globToRegExp('*.ts').test('sub/deep/a.ts')).toBe(true)
    expect(globToRegExp('*.ts').test('sub/a.txt')).toBe(false)
  })
  it('** 通配任意深度', () => {
    expect(globToRegExp('src/**/*.ts').test('src/a.ts')).toBe(true)
    expect(globToRegExp('src/**/*.ts').test('src/x/y/a.ts')).toBe(true)
    expect(globToRegExp('src/**/*.ts').test('other/a.ts')).toBe(false)
  })
  it('? 单字符', () => {
    expect(globToRegExp('a?.ts').test('a1.ts')).toBe(true)
    expect(globToRegExp('a?.ts').test('a12.ts')).toBe(false)
  })
})
