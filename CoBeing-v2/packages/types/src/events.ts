/**
 * 事件日志模型（v2 可重建日志核心）
 *
 * 硬性约定：模型可见 ⟺ 已记录——任何进入模型请求的输入必须能从事件日志重建。
 * 每个窗口（主对话窗口、每个群组）一条 append-only 事件流，seq 单调递增。
 */

/** 事件基类 */
export interface BaseEvent {
  seq: number
  ts: number
  type: string
}

/** 公共上下文发言（含 mention 唤醒） */
export interface SpeakEvent extends BaseEvent {
  type: 'speak'
  /** 发言者：user / butler / <工作智能体名> */
  actor: string
  content: string
  /** 唤醒对象数组（可多人 / '@all'）；唤醒时须附 task 说明 */
  mention?: string[]
  /** 唤醒附带的任务说明（mention 非空时建议必填，防重复劳动） */
  task?: string
}

/** 私密内容追加（思考、write 过程等；不进入公共视图） */
export interface ThinkEvent extends BaseEvent {
  type: 'think'
  actor: string
  content: string
}

/** 工具调用记录 */
export interface ToolCallEvent extends BaseEvent {
  type: 'tool/call'
  actor: string
  callId: string
  name: string
  arguments: unknown
}

/** 工具结果记录 */
export interface ToolResultEvent extends BaseEvent {
  type: 'tool/result'
  actor: string
  callId: string
  ok: boolean
  content: string
  error?: { message: string; code?: string }
  /** 是否为合成结果（如 abort 前未派发） */
  synthetic?: boolean
}

/** 一次模型调用成功完成的锚点 */
export interface AssistantCompleteEvent extends BaseEvent {
  type: 'assistant/complete'
  actor: string
  content: string
  usage?: { inputTokens: number; outputTokens: number }
}

/** 群组生命周期事件 */
export interface GroupLifecycleEvent extends BaseEvent {
  type: 'group/lifecycle'
  phase: 'created' | 'reused' | 'archived' | 'destroyed'
  detail?: string
}

/** 实例状态事件（忙碌 flag 队列依据） */
export interface AgentStatusEvent extends BaseEvent {
  type: 'agent/status'
  agent: string
  status: 'idle' | 'busy'
}

/** 群组内管家 → 主窗口管家的中转消息 */
export interface ButlerRelayEvent extends BaseEvent {
  type: 'butler/relay'
  fromGroup: string
  content: string
  kind: 'question' | 'report' | 'escalation'
}

/** 请求头：每次模型请求的有效配置（重建/审计依据；变化才追加——dsh request/header 对齐） */
export interface RequestHeaderEvent extends BaseEvent {
  type: 'request/header'
  actor: string
  provider: string
  model: string
  maxTokens?: number
  /** 组装后的 system 全文（模型面完整头——"模型看到了什么"可精确重建） */
  system?: string
  /** 可用工具名列表（按字典序；重建工具面快照） */
  tools?: string[]
  /** 追加原因：initial 首请求 / change 头变化 / resume 恢复 */
  reason?: 'initial' | 'change' | 'resume'
}

/** 模型调用失败记录（网关重试耗尽后落盘；结构化错误链） */
export interface RequestErrorEvent extends BaseEvent {
  type: 'request/error'
  actor: string
  provider: string
  model: string
  /** 已尝试次数（含首次） */
  attempt: number
  /** 结构化错误链（最内层 → 外层） */
  errors: Array<{ message: string; code?: string }>
}

/** 任务清单快照（dsh todo/write 对齐）：整表替换，last-write-wins 投影，可重建） */
export interface TodoWriteEvent extends BaseEvent {
  type: 'todo/write'
  /** 智能体名 */
  actor: string
  /** 完整清单（整表替换语义；空数组 = 清空） */
  todos: Array<{ id: number; content: string; status: 'pending' | 'in_progress' | 'completed' }>
}

/** 压缩替换事件：压缩后遮蔽旧 seq 区间（可重建依赖此事件） */
export interface CompactionEvent extends BaseEvent {
  type: 'compaction'
  /** 'group' 公共压缩 / <agentName> 私密压缩 */
  actor: string
  scope: 'public' | 'private'
  summary: string
  /** 被遮蔽的 seq 区间（含端点） */
  shadowStart: number
  shadowEnd: number
}

/** 会话事件联合 */
export type SessionEvent =
  | SpeakEvent
  | ThinkEvent
  | ToolCallEvent
  | ToolResultEvent
  | AssistantCompleteEvent
  | GroupLifecycleEvent
  | AgentStatusEvent
  | ButlerRelayEvent
  | RequestHeaderEvent
  | RequestErrorEvent
  | TodoWriteEvent
  | CompactionEvent

/**
 * 事件输入（append 参数）：按判别联合逐个 Omit（不可对联合整体 Omit——
 * keyof 取交集会毁掉各分支字段）。
 */
export type SessionEventInput =
  | Omit<SpeakEvent, 'seq' | 'ts'>
  | Omit<ThinkEvent, 'seq' | 'ts'>
  | Omit<ToolCallEvent, 'seq' | 'ts'>
  | Omit<ToolResultEvent, 'seq' | 'ts'>
  | Omit<AssistantCompleteEvent, 'seq' | 'ts'>
  | Omit<GroupLifecycleEvent, 'seq' | 'ts'>
  | Omit<AgentStatusEvent, 'seq' | 'ts'>
  | Omit<ButlerRelayEvent, 'seq' | 'ts'>
  | Omit<RequestHeaderEvent, 'seq' | 'ts'>
  | Omit<RequestErrorEvent, 'seq' | 'ts'>
  | Omit<TodoWriteEvent, 'seq' | 'ts'>
  | Omit<CompactionEvent, 'seq' | 'ts'>

export const EVENT_TYPES = [
  'speak',
  'think',
  'tool/call',
  'tool/result',
  'assistant/complete',
  'group/lifecycle',
  'agent/status',
  'butler/relay',
  'request/header',
  'request/error',
  'todo/write',
  'compaction',
] as const

export function isSessionEvent(value: unknown): value is SessionEvent {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v.seq === 'number' && typeof v.ts === 'number'
    && typeof v.type === 'string'
    && (EVENT_TYPES as readonly string[]).includes(v.type)
}

/** 按类型构造事件（seq 由日志分配） */
export function makeEvent<T extends SessionEvent>(
  type: T['type'],
  fields: Omit<T, 'seq' | 'ts' | 'type'>,
  seq: number,
  ts = Date.now(),
): T {
  return { seq, ts, type, ...fields } as T
}
