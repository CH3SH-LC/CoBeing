/**
 * 名录存储：智能体名录 / 群组名录（架构 §6）
 *
 * - 实现：JSON 文件原子写（tmp + rename）。SQLite 适配占位（见 TODO）。
 * - 保留名：'user' / 'butler' 不可作为智能体名。
 * - 销毁语义（规格 §3）：清空人格经验 + 注销名录条目 + 不再可调用；历史记录不清除。
 */

import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { AgentDef, GroupMeta } from '@cobeing/types'

export const RESERVED_NAMES = ['user', 'butler']

export interface RegistryData {
  agents: Record<string, AgentDef>
  groups: Record<string, GroupMeta>
}

/** 归档群组索引查询过滤条件 */
export interface ArchivedGroupFilter {
  /** 只返回引用时间 >= since 的群组（archivedAt ?? createdAt） */
  since?: number
  /** 只返回引用时间 <= until 的群组（archivedAt ?? createdAt） */
  until?: number
  /** 子串匹配 taskSummary 或 name（不区分大小写） */
  keyword?: string
}

export class RegistryStore {
  private data: RegistryData = { agents: {}, groups: {} }
  private loaded = false

  constructor(private file: string) {}

  async load(): Promise<void> {
    if (this.loaded) throw new Error('registry already loaded')
    this.loaded = true
    try {
      const text = await readFile(this.file, 'utf8')
      const parsed = JSON.parse(text) as Partial<RegistryData>
      this.data = {
        agents: parsed.agents ?? {},
        groups: parsed.groups ?? {},
      }
    } catch {
      this.data = { agents: {}, groups: {} }
    }
  }

  private async persist(): Promise<void> {
    const file = this.file
    await mkdir(dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    await writeFile(tmp, JSON.stringify(this.data, null, 2), 'utf8')
    await rename(tmp, file)
  }

  // ---------- 智能体名录 ----------

  listAgents(): AgentDef[] {
    return Object.values(this.data.agents)
  }

  getAgent(name: string): AgentDef | undefined {
    return this.data.agents[name]
  }

  /** 创建：名字唯一 + 非保留名 */
  async createAgent(def: AgentDef): Promise<void> {
    if (RESERVED_NAMES.includes(def.name)) {
      throw new Error(`reserved agent name: ${def.name}`)
    }
    if (this.data.agents[def.name]) {
      throw new Error(`agent already exists: ${def.name}`)
    }
    this.data.agents[def.name] = def
    await this.persist()
  }

  /** 销毁：注销名录条目（历史记录保留） */
  async destroyAgent(name: string): Promise<void> {
    if (!this.data.agents[name]) throw new Error(`agent not found: ${name}`)
    delete this.data.agents[name]
    await this.persist()
  }

  // ---------- 群组名录 ----------

  listGroups(): GroupMeta[] {
    return Object.values(this.data.groups)
  }

  getGroup(name: string): GroupMeta | undefined {
    return this.data.groups[name]
  }

  async upsertGroup(meta: GroupMeta): Promise<void> {
    this.data.groups[meta.name] = meta
    await this.persist()
  }

  async removeGroup(name: string): Promise<void> {
    delete this.data.groups[name]
    await this.persist()
  }

  /** 归档群组索引查询：只返回 status === 'archived'，按归档时间降序（最新在前） */
  listArchivedGroups(filter?: ArchivedGroupFilter): GroupMeta[] {
    const since = filter?.since
    const until = filter?.until
    const keyword = filter?.keyword?.trim().toLowerCase()
    const groups = Object.values(this.data.groups).filter((g) => {
      if (g.status !== 'archived') return false
      const ref = g.archivedAt ?? g.createdAt
      if (since !== undefined && ref < since) return false
      if (until !== undefined && ref > until) return false
      if (keyword) {
        const inSummary = (g.taskSummary ?? '').toLowerCase().includes(keyword)
        const inName = g.name.toLowerCase().includes(keyword)
        if (!inSummary && !inName) return false
      }
      return true
    })
    return groups.sort((a, b) => {
      const ref = (g: GroupMeta) => g.archivedAt ?? g.createdAt
      return ref(b) - ref(a)
    })
  }

  /** 群组目录（注册位置约定：<data>/group/<name>/） */
  static groupSpaceOf(dataRoot: string, name: string): string {
    return join(dataRoot, 'group', sanitize(name))
  }
}

function sanitize(name: string): string {
  return name.replace(/[^\w\u4e00-\u9fff-]/g, '_')
}
