import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PathGuard } from '../src/permission/guard.js'
import type { AccessRule } from '../src/permission/guard.js'
import { createEditorTool } from '../src/tools/editor.js'
import type { PathGuardLike, ToolRunContext } from '@cobeing/types'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cobeing-perm-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('PathGuard.assert / inside', () => {
  it('assert 校验并规范化目录内路径', () => {
    const guard = new PathGuard(root)
    const target = join(root, 'sub', 'a.txt')
    expect(guard.assert(target)).toBe(target)
  })

  it('assert 越权抛错（现有行为回归）', () => {
    const guard = new PathGuard(root)
    expect(() => guard.assert(join(root, '..', 'secret.txt'))).toThrow(/path outside allowed root/)
    expect(() => guard.assert(tmpdir())).toThrow(/path outside allowed root/)
  })

  it('inside 只读探测不抛错', () => {
    const guard = new PathGuard(root)
    expect(guard.inside(join(root, 'a.txt'))).toBe(true)
    expect(guard.inside(join(root, '..', 'x'))).toBe(false)
  })

  it('unrestricted 放行任意路径', () => {
    const guard = new PathGuard(root, true)
    // 需用 resolve 规范化比较
    expect(guard.assert(join(tmpdir(), 'any'))).toBe(join(tmpdir(), 'any'))
  })
})

describe('PathGuard.assertWrite（两级权限）', () => {
  it('readwrite 模式（默认）assertWrite 正常', () => {
    const guard = new PathGuard(root, false, 'readwrite')
    const target = join(root, 'b.txt')
    expect(guard.assertWrite(target)).toBe(target)
  })

  it('readonly 模式：assertWrite 抛错、assert 正常（可读）', () => {
    const guard = new PathGuard(root, false, 'readonly')
    const target = join(root, 'b.txt')
    expect(() => guard.assertWrite(target)).toThrow(/path write denied \(readonly mode\)/)
    // 读操作不受只读影响
    expect(guard.assert(target)).toBe(target)
    expect(guard.inside(target)).toBe(true)
  })

  it('assertWrite 先过路径合法性（越权优先抛错）', () => {
    const guard = new PathGuard(root, false, 'readwrite')
    expect(() => guard.assertWrite(join(root, '..', 'x.txt'))).toThrow(/path outside allowed root/)
  })
})

describe('PathGuard 细粒度规则（AccessRule）', () => {
  it('全局 readonly + 子目录 readwrite 规则 → 仅该子目录可写，其余拒绝', () => {
    const sub = join(root, 'sandbox')
    const rules: AccessRule[] = [{ path: 'sandbox', mode: 'readwrite' }]
    const guard = new PathGuard(root, false, 'readonly', rules)
    // 命中规则（含规则根自身）→ 可写
    expect(guard.assertWrite(join(sub, 'x.txt'))).toBe(join(sub, 'x.txt'))
    expect(guard.assertWrite(sub)).toBe(sub)
    // 未命中规则 → 全局 readonly 拒绝
    expect(() => guard.assertWrite(join(root, 'y.txt'))).toThrow(/path write denied/)
  })

  it('全局 readwrite + 规则某子目录 readonly → 仅该子目录拒绝，其余可写（反向）', () => {
    const secret = join(root, 'secret')
    const rules: AccessRule[] = [{ path: 'secret', mode: 'readonly' }]
    const guard = new PathGuard(root, false, 'readwrite', rules)
    // 命中 readonly 规则 → 拒绝
    expect(() => guard.assertWrite(join(secret, 'a.txt'))).toThrow(/path write denied/)
    // 未命中 → 全局 readwrite → 可写
    expect(guard.assertWrite(join(root, 'ok.txt'))).toBe(join(root, 'ok.txt'))
  })

  it('等长规则靠后声明覆盖（覆盖全局）', () => {
    const rules: AccessRule[] = [
      { path: 'onlyread', mode: 'readonly' },
      { path: 'onlyread', mode: 'readwrite' },
    ]
    const guard = new PathGuard(root, false, 'readonly', rules)
    expect(guard.assertWrite(join(root, 'onlyread', 'x'))).toBe(join(root, 'onlyread', 'x'))
  })
})

describe('str-replace-editor 写权限集成', () => {
  const tool = createEditorTool()
  const file = () => join(root, 'a.txt')

  function makeCtx(guard: PathGuardLike): ToolRunContext {
    return {
      agent: 'a1',
      group: 'g1',
      cwd: root,
      guard,
      signal: new AbortController().signal,
      speak: async () => {},
      writePrivate: async () => {},
    }
  }

  it('readonly guard 下 create 返回 ok:false 且 content 含拒绝信息', async () => {
    const guard = new PathGuard(root, false, 'readonly')
    const r = await tool.execute({ command: 'create', path: file(), new_string: 'x' }, makeCtx(guard))
    expect(r.ok).toBe(false)
    expect((r as { content: string }).content).toContain('path write denied')
  })

  it('readonly guard 下 str_replace/insert 同样拒绝', async () => {
    const guard = new PathGuard(root, false, 'readonly')
    const r1 = await tool.execute({ command: 'str_replace', path: file(), old_string: 'a', new_string: 'b' }, makeCtx(guard))
    expect(r1.ok).toBe(false)
    expect((r1 as { content: string }).content).toContain('path write denied')
    const r2 = await tool.execute({ command: 'insert', path: file(), insert_line: 1, new_string: 'b' }, makeCtx(guard))
    expect(r2.ok).toBe(false)
  })

  it('readonly guard 下 view 仍可读', async () => {
    const { writeFileSync } = await import('node:fs')
    writeFileSync(file(), 'line1')
    const guard = new PathGuard(root, false, 'readonly')
    const v = await tool.execute({ command: 'view', path: file() }, makeCtx(guard))
    expect(v.ok).toBe(true)
    expect((v as { content: string }).content).toContain('1:line1')
  })

  it('readwrite guard 下 create 正常', async () => {
    const guard = new PathGuard(root, false, 'readwrite')
    const r = await tool.execute({ command: 'create', path: file(), new_string: 'x' }, makeCtx(guard))
    expect(r.ok).toBe(true)
  })

  it('rules 规则经 editor 生效：readonly 全局 + 子目录 readwrite → 子目录 create 可写', async () => {
    const sub = join(root, 'sandbox')
    const guard = new PathGuard(root, false, 'readonly', [{ path: 'sandbox', mode: 'readwrite' }])
    const ok = await tool.execute({ command: 'create', path: join(sub, 'x.txt'), new_string: 'x' }, makeCtx(guard))
    expect(ok.ok).toBe(true)
    const denied = await tool.execute({ command: 'create', path: join(root, 'y.txt'), new_string: 'x' }, makeCtx(guard))
    expect(denied.ok).toBe(false)
    expect((denied as { content: string }).content).toContain('path write denied')
  })
})
