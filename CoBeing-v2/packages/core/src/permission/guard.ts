/**
 * 权限：路径守卫（最小权限默认——只能访问所属群组空间）
 *
 * - normalizeWithin：规范化 + 前缀检查，防 ../ 逃逸。
 * - 全量访问（spaceMode 'unrestricted'）为受限特例：守卫放行。
 * - 两级文件权限：默认全群可写；`mode: 'readonly'` 时读可写禁（管家 butler 只读）。
 * - 细粒度规则（占位接口）：`AccessRule[]` 命中路径按规则模式判定，未命中按全局 mode。
 * - 符号链接解析占位（TODO：实现 realpath 校验，防链接逃逸）。
 */

import { resolve, sep } from 'node:path'

export type PathAccessMode = 'readwrite' | 'readonly'

/** 细粒度访问规则：命中路径按规则模式判定，未命中按全局 mode（最长前缀命中优先，等长靠后覆盖） */
export interface AccessRule {
  path: string
  mode: 'readwrite' | 'readonly'
}

export class PathGuard {
  constructor(
    private allowedRoot: string,
    private unrestricted = false,
    private mode: PathAccessMode = 'readwrite',
    private rules: AccessRule[] = [],
  ) {}

  setUnrestricted(value: boolean): void {
    this.unrestricted = value
  }

  /** 校验并返回规范化路径；越权抛错（读操作可用） */
  assert(target: string): string {
    if (this.unrestricted) return resolve(target)
    const root = resolve(this.allowedRoot)
    const norm = resolve(target)
    if (norm === root) return norm
    if (!norm.startsWith(root + sep)) {
      throw new Error(`path outside allowed root: ${target}（群组空间=${root}）`)
    }
    return norm
  }

  /** 校验并返回规范化路径；写不可用时抛错（先过 assert 路径合法性/越权检查） */
  assertWrite(target: string): string {
    const norm = this.assert(target)
    const rule = this.matchRule(norm)
    const effectiveMode = rule ? rule.mode : this.mode
    if (effectiveMode === 'readonly') {
      throw new Error(`path write denied (readonly mode): ${target}`)
    }
    return norm
  }

  /** 只读探测 */
  inside(target: string): boolean {
    try {
      this.assert(target)
      return true
    } catch {
      return false
    }
  }

  /** 命中规则：与目标同根路径下、最具体的规则生效；等长时靠后声明覆盖前者 */
  protected matchRule(norm: string): AccessRule | undefined {
    let matched: AccessRule | undefined
    let matchedLen = -1
    for (const rule of this.rules) {
      const ruleNorm = resolve(this.allowedRoot, rule.path)
      const inside = norm === ruleNorm || norm.startsWith(ruleNorm + sep)
      if (inside && ruleNorm.length >= matchedLen) {
        matched = rule
        matchedLen = ruleNorm.length
      }
    }
    return matched
  }
}
