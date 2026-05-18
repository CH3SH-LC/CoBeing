export interface ReviewerConfig {
  enabled: boolean
  maxRounds: number       // 默认 3，设为 0 等价于关闭
  provider?: string       // 可选，默认跟随群组
  model?: string          // 可选，默认跟随群组
}

export interface AgentTraceToolCall {
  tool: string
  args: Record<string, unknown>
  result: string
}

export interface AgentTrace {
  thinking: string[]
  toolCalls: AgentTraceToolCall[]
  finalMessage: string
}

export interface ReviewInput {
  agentJobMd: string
  agentTrace: AgentTrace
  groupRecentMessages: string[]
  agentMentions: string[]
  groupTaskMd: string
  groupPlanMd: string
  groupProgressMd: string
}

export interface ReviewResult {
  pass: boolean
  reason: string
}

export type ReviewLogEventType = 'review_pending' | 'review_passed' | 'review_failed_override'

export interface ReviewLogEvent {
  type: ReviewLogEventType
  agentId: string
  groupId: string
  rounds?: number
  reason?: string
}
