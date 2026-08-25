/**
 * 群组运行时（规格 §2 群组模型 + 架构 §7.1）
 *
 * - 生命周期：创建 → 工作（mention 驱动）→ 复用 → 归档死亡
 * - 上下文：公共（speak 事件）/ 私密（think 事件）经投影重建
 * - mention 分发：user → 通知回调（GUI 占位）；butler → 群组内管家实例；agent → 实例 wake（忙碌排队）
 * - 完成判定链：工作完成 → 管家回报 → 用户验收 → 用户告知成功 → archive()
 */

import type { GroupMeta, MentionTarget } from '@cobeing/types'
import type { WindowLog } from '../event-log/window-log.js'
import { project, type WindowProjection } from '../event-log/projection.js'
import { AgentInstance, type AgentInstanceOptions } from './agent-loop.js'

export interface GroupRuntimeDeps {
  meta: GroupMeta
  log: WindowLog
  makeAgent: (def: { name: string; role: string; basePrompt?: string }) => AgentInstance | null
  /** mention user 时的通知回调（GUI 任务栏闪烁+滴声占位） */
  notifyUser?: (group: string, content: string, task?: string) => void
}

export class GroupRuntime {
  private instances = new Map<string, AgentInstance>()
  private archived = false

  constructor(private deps: GroupRuntimeDeps) {}

  get meta(): GroupMeta {
    return this.deps.meta
  }

  get log(): WindowLog {
    return this.deps.log
  }

  /** 启动：加载日志、按 label 创建工作智能体实例（user/butler 特殊处理） */
  async start(): Promise<void> {
    await this.log.load()
    for (const member of this.deps.meta.label) {
      if (member === 'user' || member === 'butler') continue
      const instance = this.deps.makeAgent({ name: member, role: member, basePrompt: undefined })
      if (instance) this.instances.set(member, instance)
    }
    // butler 实例（群组内管家：组装同工作智能体 + relay 由内核接线）
    const butler = this.deps.makeAgent({ name: 'butler', role: 'butler', basePrompt: undefined })
    if (butler) this.instances.set('butler', butler)
    await this.deps.log.append({ type: 'group/lifecycle', phase: 'created', detail: `label=${this.deps.meta.label.join(',')}` })
  }

  /** 当前投影（每次动态重建——组装时读取最新事件，架构 §2.2 只从投影派生） */
  projection(): WindowProjection {
    return project(this.deps.log.readCached())
  }

  /** 公共发言入口（用户/内核调用）：写 speak 事件 + 分发 mention。
   *  修复 1（群组默认唤醒）：mention 为空 → 默认唤醒全部工作智能体（等同 @all）——
   *  用户群内发言不指名道姓时也必须有人响应；对齐主窗口 mainWindowSpeak 无条件唤醒但丁。
   *  （工作智能体经 group-speak 工具的发言不经过本入口，不会造成汇报级联唤醒。） */
  async speak(actor: string, content: string, mention?: string[], task?: string): Promise<void> {
    if (this.archived) throw new Error(`group archived: ${this.deps.meta.name}`)
    await this.deps.log.append({ type: 'speak', actor, content, mention, task })
    const targets = mention && mention.length > 0 ? mention : ['@all']
    for (const target of targets) {
      this.dispatchMention(target, { content, task })
    }
  }

  private dispatchMention(target: MentionTarget, message: { content: string; task?: string }): void {
    if (target === '@all') {
      for (const instance of this.instances.values()) {
        if (instance.name !== 'butler') instance.wake(message)
      }
      return
    }
    if (target === 'user') {
      this.deps.notifyUser?.(this.deps.meta.name, message.content, message.task)
      return
    }
    const instance = this.instances.get(target)
    if (instance) {
      instance.wake(message)
    } else {
      // 目标不存在：错误反馈（由调用方捕获——此处通过日志记录）
      void this.deps.log.append({
        type: 'speak',
        actor: 'system',
        content: `[mention 失败] ${target} 不在本群组（${this.deps.meta.name}）`,
      })
    }
  }

  /** 群组复用（连续任务）：重置任务摘要并广播 */
  async reuse(taskSummary: string): Promise<void> {
    if (this.archived) throw new Error(`group archived: ${this.deps.meta.name}`)
    this.deps.meta.taskSummary = taskSummary
    await this.deps.log.append({ type: 'group/lifecycle', phase: 'reused', detail: taskSummary })
  }

  /** 归档死亡：事件落盘完成即冻结（后续 speak 拒绝） */
  async archive(): Promise<void> {
    if (this.archived) return
    this.archived = true
    await this.deps.log.append({ type: 'group/lifecycle', phase: 'archived' })
    for (const instance of this.instances.values()) instance.dispose()
    this.instances.clear()
  }

  /** 拉取某实例（内核调试/桥接用） */
  instance(name: string): AgentInstance | undefined {
    return this.instances.get(name)
  }
}
