/**
 * 经验档案存储（定稿：条目式纯文档 md，不用数据库）
 *
 * - 每智能体一份：<data>/memory/<agentName>.md，按名字全局共享（人格记忆共享）。
 * - 条目结构：
 *   ## <ISO 时间>
 *   - 来源：<source>
 *   - 内容：<content 以 > 引用块保留多行>
 *   - 标签：a, b
 * - 写入方：【记忆】工具智能体（半硬编码流程，信息提取统一入口）；读取方：recall。
 */

import { mkdir, readFile, appendFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ExperienceEntry } from '@cobeing/types'

export class ExperienceStore {
  constructor(private memoryDir: string) {}

  private fileOf(name: string): string {
    return join(this.memoryDir, `${sanitize(name)}.md`)
  }

  /** 追加一条经验（条目式） */
  async append(agentName: string, entry: Omit<ExperienceEntry, 'id' | 'ts'>): Promise<ExperienceEntry> {
    const full: ExperienceEntry = { ...entry, id: randomUUID(), ts: Date.now() }
    const file = this.fileOf(agentName)
    await mkdir(dirname(file), { recursive: true })
    await appendFile(file, renderEntry(full), 'utf8')
    return full
  }

  /** 全量读取（按时间升序） */
  async loadAll(agentName: string): Promise<ExperienceEntry[]> {
    const file = this.fileOf(agentName)
    let text: string
    try {
      text = await readFile(file, 'utf8')
    } catch {
      return []
    }
    return parseEntries(text)
  }

  /** 全量重写（画像合并用；替换整个档案内容） */
  async rewrite(agentName: string, entries: ExperienceEntry[]): Promise<void> {
    const file = this.fileOf(agentName)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, entries.map(renderEntry).join(''), 'utf8')
  }

  /** 条目数 */
  async count(agentName: string): Promise<number> {
    return (await this.loadAll(agentName)).length
  }

  /** 调取经验（最新在前，limit 条） */
  async recall(agentName: string, limit = 20): Promise<ExperienceEntry[]> {
    return (await this.loadAll(agentName)).slice(-limit).reverse()
  }

  /**
   * 关键词检索（内容/来源/标签不区分大小写子串匹配；最新在前，limit 条）。
   * 空关键词返回最新条目（等价 recall）。
   */
  async search(agentName: string, keyword: string, limit = 20): Promise<ExperienceEntry[]> {
    const kw = keyword.trim().toLowerCase()
    const all = await this.loadAll(agentName)
    if (!kw) return all.slice(-limit).reverse()
    const matched = all.filter(
      (e) =>
        e.content.toLowerCase().includes(kw) ||
        e.source.toLowerCase().includes(kw) ||
        (e.tags ?? []).some((t) => t.toLowerCase().includes(kw)),
    )
    return matched.slice(-limit).reverse()
  }

  /** 条目文本渲染（供桥协议/GUI 展示） */
  static render(entry: ExperienceEntry): string {
    const date = new Date(entry.ts).toISOString().slice(0, 19).replace('T', ' ')
    return `[${date} ${entry.source}] ${entry.content}`
  }

  /** 清空档案（销毁语义：清空人格经验） */
  async clear(agentName: string): Promise<void> {
    await writeFile(this.fileOf(agentName), '', 'utf8')
  }
}

/** 渲染单条经验为档案文本（append/rewrite 共用） */
function renderEntry(entry: ExperienceEntry): string {
  const iso = new Date(entry.ts).toISOString()
  const contentBlock = entry.content
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')
  const tags = entry.tags?.length ? `- 标签：${entry.tags.join(', ')}\n` : ''
  return `\n## ${iso}\n- 来源：${entry.source}\n- 内容：\n${contentBlock}\n${tags}`
}

function sanitize(name: string): string {
  return name.replace(/[^\w\u4e00-\u9fff-]/g, '_')
}

/** 解析条目式 md 档案 */
export function parseEntries(text: string): ExperienceEntry[] {
  const entries: ExperienceEntry[] = []
  const blocks = text.split(/\n## /)
  for (const block of blocks) {
    if (!block.trim()) continue
    const lines = block.split('\n')
    const tsIso = lines[0]!.trim()
    let source = ''
    let tags: string[] | undefined
    const contentLines: string[] = []
    for (const line of lines.slice(1)) {
      if (line.startsWith('- 来源：')) source = line.slice('- 来源：'.length).trim()
      else if (line.startsWith('- 标签：')) tags = line.slice('- 标签：'.length).split(',').map((s) => s.trim()).filter(Boolean)
      else if (line.startsWith('> ')) contentLines.push(line.slice(2))
      else if (line === '>') contentLines.push('')
    }
    const ts = Date.parse(tsIso)
    if (Number.isNaN(ts)) continue
    entries.push({
      id: `${ts}-${entries.length}`,
      ts,
      source,
      content: contentLines.join('\n'),
      tags,
    })
  }
  return entries
}
