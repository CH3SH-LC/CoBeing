/**
 * 经验总结服务（方案 v0.1.1：docs/v2-经验总结方案-v0.1.md）
 *
 * - 自适性（核心）：总结范围 = 智能体自身定义（名字/角色/工具/基座/人格）+ 既有画像
 *   ——思考2.0 #24 落地：前端智能体总结前端偏好，不需要"用户爱吃甜食"。
 * - 执行收敛（v0.1.1）：总结动作统一由工具智能体【记忆】执行（信息提取入口唯一）；
 *   本服务只提供【记忆】的"上下文"（memoryAgentInstruction：方法论 + 自适 scope）、
 *   素材组装（memberMaterial）、档案管理（注入块/画像合并/信息）。
 * - 触发：管家归档 / 群组归档成员总结 / 长活群组轮次节流总结 / 自驱动 save
 *   （call-tool-agent）——全部经 kernel.runMemoryAgent → 【记忆】invoke。
 * - 有界：普通条目超阈值 → 画像合并（旧条目 + 旧画像 → 新画像，全量重写）。
 * - 容错：LLM 失败由调用方兜底（本模块只保证不吞错；kernel 侧 catch）。
 */

import type { ExperienceEntry } from '@cobeing/types'
import type { WindowProjection } from '../event-log/projection.js'
import type { ExperienceStore } from '../memory/store.js'

/** 普通条目数超过该阈值触发画像合并 */
export const EXPERIENCE_MAX_ENTRIES = 50
/** 组装注入的最近普通条目数 */
export const EXPERIENCE_CONTEXT_ENTRIES = 6
/** 画像条目注入字符上限 */
export const EXPERIENCE_CONTEXT_PROFILE_CHARS = 800
/** 单条普通条目注入字符上限 */
export const EXPERIENCE_CONTEXT_ENTRY_CHARS = 300
/** 单次总结素材字符上限 */
export const EXPERIENCE_MATERIAL_CHARS = 40_000
/** 画像条目 source 标记（合并后全局唯一） */
export const EXPERIENCE_PROFILE_SOURCE = 'profile'

export interface ExperienceDeps {
  memory: ExperienceStore
  /** 通用 LLM 摘要（网关；mock/真实由调用方注入） */
  llm: (text: string, instruction: string) => Promise<string>
  /** 智能体定义查询（名录；未登记返回 undefined） */
  defOf: (name: string) => { role?: string; tools?: string[]; basePrompt?: string } | undefined
  /** 但丁人格文本（管家专属 scope；未提供则退化） */
  butlerPersona?: string
}

export class ExperienceService {
  constructor(private deps: ExperienceDeps) {}

  /** 自适范围文本：自身定义（名字/角色/工具/基座/人格）+ 既有画像 */
  async scopeFor(name: string): Promise<string> {
    const def = this.deps.defOf(name)
    const parts: string[] = []
    if (name === 'butler' && this.deps.butlerPersona) {
      parts.push(`你是管家但丁（主窗口管家）。`)
      parts.push(this.deps.butlerPersona.split('\n').slice(0, 4).join('\n'))
    } else if (def) {
      parts.push(`你是 ${name}（${def.role ?? '工作智能体'}）。`)
      if (def.tools?.length) parts.push(`可用能力：${def.tools.join(', ')}`)
      if (def.basePrompt) parts.push(`定义：${def.basePrompt}`)
    } else {
      parts.push(`你是 ${name}（工作智能体）。`)
    }
    const profile = await this.profileOf(name)
    if (profile) {
      parts.push(`你目前已知的长期经验：\n${truncate(profile.content, EXPERIENCE_CONTEXT_PROFILE_CHARS)}`)
    }
    return parts.join('\n')
  }

  /**
   * 【记忆】工具智能体的完整方法论指令（注入该工具智能体的上下文）：
   * 总结要点 + 条目格式 + 自省要求 + 自适 scope（自身定义 + 既有画像）。
   * 只总结适合自己的经验（思考2.0 #24）；工作智能体本身不注入此内容。
   */
  async memoryAgentInstruction(name: string): Promise<string> {
    const scope = await this.scopeFor(name)
    return [
      '你是记忆工具智能体【记忆】：审查素材，为下面的智能体提取值得记住的经验，写入其条目式经验档案。',
      '提炼要点：学到了什么关于任务/工具/环境的知识；犯了什么错误、如何修复；哪些策略有效；收到什么用户偏好或反馈；发现了什么新的工作模式或最佳实践。',
      '输出格式：条目化，每条一行、以"- "开头、每条不超过 120 字；无值得保存的经验时输出空。',
      '只总结与该智能体自身职责、能力、用户偏好直接相关的内容（无关知识不总结）。',
      '',
      scope,
    ].join('\n')
  }

  /** 组装注入块：画像（≤800 字符）+ 最近 N 条（每条 ≤300 字符）；空档案返回 '' */
  async contextBlock(name: string): Promise<string> {
    const entries = await this.deps.memory.loadAll(name)
    if (entries.length === 0) return ''
    const profile = entries.filter((e) => e.source === EXPERIENCE_PROFILE_SOURCE)
    const normal = entries.filter((e) => e.source !== EXPERIENCE_PROFILE_SOURCE)
    const lines: string[] = []
    for (const p of profile.slice(-1)) {
      lines.push(`- [长期] ${truncate(p.content, EXPERIENCE_CONTEXT_PROFILE_CHARS)}`)
    }
    for (const e of normal.slice(-EXPERIENCE_CONTEXT_ENTRIES)) {
      const date = new Date(e.ts).toISOString().slice(0, 10)
      lines.push(`- [${date} ${e.source}] ${truncate(e.content, EXPERIENCE_CONTEXT_ENTRY_CHARS)}`)
    }
    return lines.join('\n')
  }

  /** 档案信息（桥协议查询面） */
  async info(name: string): Promise<{ count: number; lastUpdated?: number }> {
    const entries = await this.deps.memory.loadAll(name)
    const last = entries.at(-1)
    return { count: entries.length, lastUpdated: last?.ts }
  }

  /** 画像合并：普通条目超阈值 → 旧一半 + 旧画像 → 新画像，重写为 新画像 + 最新一半 */
  async consolidate(name: string): Promise<void> {
    const all = await this.deps.memory.loadAll(name)
    const profile = all.filter((e) => e.source === EXPERIENCE_PROFILE_SOURCE)
    const normal = all.filter((e) => e.source !== EXPERIENCE_PROFILE_SOURCE)
    if (normal.length <= EXPERIENCE_MAX_ENTRIES) return
    const keepCount = Math.floor(normal.length / 2)
    const keep = normal.slice(-keepCount)
    const old = normal.slice(0, normal.length - keepCount)
    const scope = await this.scopeFor(name)
    const material = [
      ...profile.map((p) => `[既有长期经验]\n${p.content}`),
      ...old.map((e) => `[${new Date(e.ts).toISOString()} ${e.source}]\n${e.content}`),
    ].join('\n\n')
    const merged = (
      await this.deps.llm(material.slice(0, EXPERIENCE_MATERIAL_CHARS), [
        '将以下经验条目合并、去重、消除矛盾，整合为一份精简的长期经验画像：只保留最重要、最稳定、仍有效的内容。',
        '输出条目化内容：每条一行、以"- "开头、每条不超过 120 字。',
        '',
        scope,
      ].join('\n'))
    ).trim()
    if (!merged || merged === '（无总结内容）') return
    const newProfile: ExperienceEntry = {
      id: `profile-${Date.now()}`,
      ts: Date.now(),
      source: EXPERIENCE_PROFILE_SOURCE,
      content: merged,
      tags: ['profile'],
    }
    await this.deps.memory.rewrite(name, [newProfile, ...keep])
  }

  /** 追加后合并检查（普通条目数超阈值即合并） */
  async maybeConsolidate(name: string): Promise<void> {
    const entries = await this.deps.memory.loadAll(name)
    const normal = entries.filter((e) => e.source !== EXPERIENCE_PROFILE_SOURCE)
    if (normal.length > EXPERIENCE_MAX_ENTRIES) {
      await this.consolidate(name)
    }
  }

  private async profileOf(name: string): Promise<ExperienceEntry | undefined> {
    const entries = await this.deps.memory.loadAll(name)
    return entries.filter((e) => e.source === EXPERIENCE_PROFILE_SOURCE).at(-1)
  }
}

/** 从投影收集某成员的自经验素材（sinceSeq 之后的事件；无活动返回 ''）。供 kernel 组装后交【记忆】工具智能体总结 */
export function memberMaterial(member: string, projection: WindowProjection, sinceSeq: number): string {
  const speaks = projection.publicMessages.filter((m) => m.actor === member && m.seq > sinceSeq).slice(-30)
  const thinks = projection.privateOf(member).filter((t) => t.seq > sinceSeq).slice(0, 30)
  const tools = projection.toolsOf(member).filter((t) => t.seq > sinceSeq).slice(-20)
  if (speaks.length === 0 && thinks.length === 0 && tools.length === 0) return ''
  const parts: string[] = []
  if (speaks.length) {
    parts.push('[我的公开发言]\n' + speaks.map((m) => m.content).join('\n'))
  }
  if (thinks.length) {
    parts.push('[我的思考过程]\n' + thinks.map((t) => t.content).join('\n'))
  }
  if (tools.length) {
    parts.push(
      '[我的工具记录]\n' +
        tools
          .map((t) => {
            const r = t.result
              ? `${t.result.ok ? '[ok]' : `[error:${t.result.error?.code ?? '?'}]`} ${t.result.content}`
              : '[pending]'
            return `tool:${t.name} ${r}`
          })
          .join('\n'),
    )
  }
  return parts.join('\n\n')
}

function truncate(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : text.slice(0, maxChars) + '…[截断]'
}
