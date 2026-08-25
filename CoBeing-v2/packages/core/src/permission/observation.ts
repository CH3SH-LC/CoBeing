/**
 * 文件观测策略（CAS，架构 §8；dsh fs-observation-policy 移植）
 *
 * - observe(path)：read/view 后记录版本 {mtimeMs, size}。
 * - verifyEdit(path, baseVersion)：write/edit 前校验——当前版本必须等于 baseVersion
 *   （不一致 = 文件被他人修改，拒绝并提示重读）。
 * - 版本缺失/未见 → 校验失败（防"读过旧版本覆盖新内容"）。
 * - dispose 清空全部观测（热重载安全）。
 */

import { stat } from 'node:fs/promises'

export interface FileVersion {
  mtimeMs: number
  size: number
}

export class FileObservation {
  private observed = new Map<string, FileVersion>()

  /** 记录观测（read/view 后调用） */
  async observe(path: string): Promise<FileVersion> {
    const version = await getVersion(path)
    this.observed.set(path, version)
    return version
  }

  /** 校验写前版本；不通过抛错 */
  async verifyEdit(path: string, baseVersion?: FileVersion): Promise<void> {
    if (!baseVersion) throw new Error(`write rejected: 缺少 baseVersion（请先 read 获取版本）`)
    const current = await getVersion(path)
    const expected = this.observed.get(path)
    if (!expected) throw new Error(`write rejected: 该文件未被本实例观测过（请先 read）`)
    if (expected.mtimeMs !== baseVersion.mtimeMs || expected.size !== baseVersion.size) {
      throw new Error(`write rejected: baseVersion 与观测版本不一致（请重新 read）`)
    }
    if (current.mtimeMs !== expected.mtimeMs || current.size !== expected.size) {
      throw new Error(`write rejected: 文件已被其他成员修改（${path}），请重新读取`)
    }
  }

  /** 覆盖观测（write 成功后调用） */
  async refresh(path: string): Promise<FileVersion> {
    return this.observe(path)
  }

  clear(): void {
    this.observed.clear()
  }
}

export async function getVersion(path: string): Promise<FileVersion> {
  const s = await stat(path)
  return { mtimeMs: s.mtimeMs, size: s.size }
}
