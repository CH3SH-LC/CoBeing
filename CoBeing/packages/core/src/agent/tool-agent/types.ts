/**
 * Tool Agent 类型定义 — 与 Agent 类完全独立
 */
import type { Message } from "@cobeing/shared";

export type ToolAgentType = "review" | "judgment" | "clone" | "memory" | "creator"
  | "growth-reviewer" | "task-archive" | "capability-updater";

export type ToolAgentVisibility = "hidden" | "system_log" | "user_summary";
export type ToolAgentWritePolicy = "return_only" | "caller_applies" | "safe_auto_apply";
export type ToolAgentFailurePolicy = "ignore" | "fallback_allow" | "fallback_block" | "escalate";

export interface ToolAgentSpec {
  type: ToolAgentType;
  name: string;
  purpose: string;
  trigger: string;
  model?: string;
  maxIterations: number;
  timeoutMs?: number;
  tools: string[];
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  visibility: ToolAgentVisibility;
  writePolicy: ToolAgentWritePolicy;
  failurePolicy: ToolAgentFailurePolicy;
  systemPrompt?: string;
}

export interface ToolAgentConfig {
  id: string;
  type: ToolAgentType;
  parentAgentId: string;
  groupId?: string;
  model: string;
  maxIterations: number;
  tools: string[];
  systemPrompt: string;
  userPrompt: string;
  workingDir: string;
  abortSignal?: AbortSignal;
}

export interface ToolAgentResult {
  success: boolean;
  output: string;
  metadata?: Record<string, unknown>;
}

// --- Review ---

export interface ReviewInput {
  agentJobMd: string;
  agentTrace: import("@cobeing/shared").AgentTrace;
  groupRecentMessages: string[];
  agentMentions: string[];
  groupTaskMd: string;
  groupPlanMd: string;
  groupProgressMd: string;
}

export interface ReviewResult {
  pass: boolean;
  reason: string;
}

// --- Judgment ---

export interface JudgmentInput {
  targetMessage: string;
  fromAgentId: string;
  fromAgentName: string;
  recentMessages: string[];
  hostName: string;
  groupName: string;
}

export interface JudgmentResult {
  wake_host: boolean;
  reason: string;
  urgency: "high" | "medium" | "low";
}

// --- Clone ---

export interface CloneTask {
  description: string;
  contextFiles?: string[];
}

export interface CloneInput {
  task: CloneTask;
  parentName: string;
  parentId: string;
  groupName?: string;
  effectiveWorkspace: string;
}

// --- Memory ---

export type MemoryMode = "personal" | "group";

export interface PersonalMemoryInput {
  agentName: string;
  agentId: string;
  trace: import("@cobeing/shared").AgentTrace;
  taskContext: string;
}

export interface GroupMemoryInput {
  groupName: string;
  groupId: string;
  phasePlan: string;
  progressMd: string;
  interfaceMd: string;
  memberContributions: string[];
}

export interface MemoryEntry {
  category: string;
  summary: string;
  detail?: string;
  /** 记忆分级（决策 #6 / spec #3）：P0 永不过期（Q1 不看会犯错）/ P1 ~90 天 TTL / P2 只留日志 */
  ttl?: "P0" | "P1" | "P2";
  /** 来源 agent id（多 Agent 写同一记忆文件需 provenance） */
  provenance?: string;
}

export interface MemoryFileUpdate {
  target: "MEMORY.md";
  operation: "append" | "replace" | "remove";
  reason: string;
  content: string;
  sensitivity?: "low" | "medium" | "high";
}

export interface MemoryToolAgentResult {
  entries: MemoryEntry[];
  memoryUpdates?: MemoryFileUpdate[];
  warnings?: string[];
  interfaceUpdates?: Array<{
    agentId: string;
    section: string;
    entry: string;
  }>;
}
