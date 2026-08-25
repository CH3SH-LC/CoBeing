/**
 * 桥协议前端类型（与 packages/types + projection.ts 对齐；GUI 只读呈现，不持有真相源）
 */

/** 公共消息（按逻辑顺序 = seq 顺序） */
export interface PublicMessage {
  seq: number
  actor: string
  content: string
  mention?: string[]
  task?: string
  /** 事件时间戳（时间分隔/时间显示用） */
  ts: number
}

/** 压缩遮蔽摘要 */
export interface CompactionInfo {
  start: number
  end: number
  summary: string
  scope: 'public' | 'private'
}

/** butlerProjection / groupProjection 的 JSON 形态（函数成员不跨 RPC） */
export interface ProjectionDto {
  events: unknown[]
  publicMessages: PublicMessage[]
  compactions: CompactionInfo[]
  /** 主窗口上下文占用（自动压缩可见性；thresholdTokens=0 表示禁用） */
  context?: { estimatedTokens: number; thresholdTokens: number }
}

/** 主窗口会话摘要（新对话窗口；id='current' 为当前会话） */
export interface ConversationInfo {
  id: string
  createdAt: number
  archivedAt?: number
  messageCount: number
  firstUserMessage?: string
  current?: boolean
}

/** 群组工作状态（成员忙碌标记 + 任务摘要 + 最近活动；group/status） */
export interface GroupStatus {
  name: string
  label: string[]
  status: string
  taskSummary?: string
  members: Array<{ name: string; busy: boolean }>
  lastActivity?: number
}

/** 经验条目 DTO（experience/entries + experience/search） */
export interface ExperienceEntryDto {
  ts: number
  source: string
  content: string
  tags?: string[]
}

/** 群组元数据 */
export interface GroupMeta {
  name: string
  label: string[]
  space: string
  spaceMode: 'default' | 'custom' | 'unrestricted'
  status: 'working' | 'archived' | 'destroyed'
  createdAt: number
  archivedAt?: number
  taskSummary?: string
}

/** 智能体定义 */
export interface AgentDef {
  name: string
  role: string
  basePrompt?: string
  tools?: string[]
  provider?: string
  model?: string
  maxTokens?: number
  createdAt: number
}

/** 内核 notify 通知（jsonrpc-notify 事件）——与 packages/types NotifyPayload 对齐 */
export interface ConfirmOption {
  id: string
  label: string
}

export type UpdateScope = 'butler' | 'group' | 'groups' | 'agents'

export type NotifyPayload =
  | { type: 'text'; content: string }
  | { type: 'confirm'; id: string; question: string; options: ConfirmOption[] }
  | { type: 'update'; scope: UpdateScope; group?: string; kind?: string }

/** 内核退出事件（kernel-exited） */
export interface KernelExited {
  code: number | null
}
