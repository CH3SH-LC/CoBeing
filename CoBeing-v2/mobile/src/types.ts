/**
 * RPC DTO 类型（与内核桥协议/桌面 GUI types 对齐；手机端独立维护）
 */

export interface PublicMessage {
  seq: number
  actor: string
  content: string
  mention?: string[]
  task?: string
  /** 事件时间戳（时间分隔/时间显示用） */
  ts: number
}

export interface ProjectionDto {
  publicMessages: PublicMessage[]
  compactions: { start: number; end: number; summary: string; scope: 'public' | 'private' }[]
  context?: { estimatedTokens: number; thresholdTokens: number }
}

export interface AgentDef {
  name: string
  role: string
  provider?: string
  model?: string
  maxTokens?: number
  createdAt?: number
}

export interface GroupMeta {
  name: string
  label: string[]
  space: string
  status: string
  taskSummary?: string
}

/** 群组工作状态（成员忙碌标记 + 任务摘要 + 最近活动；GUI/手机端展示用） */
export interface GroupStatus {
  name: string
  label: string[]
  status: string
  taskSummary?: string
  members: Array<{ name: string; busy: boolean }>
  lastActivity?: number
}

/** 经验条目 DTO（桥协议 experience/entries + experience/search） */
export interface ExperienceEntryDto {
  ts: number
  source: string
  content: string
  tags?: string[]
}

export interface ConversationInfo {
  id: string
  createdAt: number
  archivedAt?: number
  messageCount: number
  firstUserMessage?: string
  current?: boolean
}

export type UpdateScope = 'butler' | 'group' | 'groups' | 'agents'

export type NotifyPayload =
  | { type: 'text'; content: string }
  | { type: 'confirm'; id: string; question: string; options: { id: string; label: string }[] }
  | { type: 'update'; scope: UpdateScope; group?: string; kind?: string }
  | { type: 'pair'; action: 'paired' | 'revoked'; deviceName: string }
  | { type: 'tunnel'; action: 'update' | 'started' | 'stopped' | 'error'; url?: string; message?: string }

/** 远程服务器 hello（cobeing-ws/1） */
export interface RemoteHello {
  name: string
  version: string
  dataRoot: string
  agentCount: number
  protocol: 'cobeing-ws/1'
}

/** 控制面板 manifest（插件扩展面：app 泛化渲染） */
export interface PanelControl {
  type: 'button' | 'toggle' | 'input' | 'display'
  id: string
  label: string
  icon?: string
  confirm?: string
  value?: boolean | string
  placeholder?: string
}

export interface PanelSection {
  title: string
  controls: PanelControl[]
}

export interface PanelManifest {
  id: string
  name: string
  icon?: string
  sections: PanelSection[]
}

export interface FileEntry {
  name: string
  isDir: boolean
  size: number
  mtime: number
}

export interface ListFilesResult {
  root: string
  path: string
  entries: FileEntry[]
}

export interface DownloadResult {
  name: string
  size: number
  mime: string
  base64: string
}

export interface RemoteInfo {
  name: string
  version: string
  dataRoot: string
  roots: string[]
  platform: string
}

export interface ScreenshotResult {
  mime: string
  base64: string
}
