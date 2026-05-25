/**
 * Tool Agent 类型定义 — 与 Agent 类完全独立
 */
import type { Message } from "@cobeing/shared";

export type ToolAgentType = "review" | "judgment" | "clone" | "memory";

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
}

export interface MemoryToolAgentResult {
  entries: MemoryEntry[];
  interfaceUpdates?: Array<{
    agentId: string;
    section: string;
    entry: string;
  }>;
}
