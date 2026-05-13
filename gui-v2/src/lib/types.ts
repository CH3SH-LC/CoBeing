// ── Shared Types for CoBeing Frontend ──

export type ViewType = "butler" | "agents" | "groups" | "skills" | "settings" | "dashboard";
export type AgentStatus = "idle" | "running" | "error";
export type MessageDirection = "in" | "out" | "system" | "tool";
export type PermissionMode = "full-access" | "workspace-write" | "read-only" | "ask";

// ── Agent ──

export interface AgentInfo {
  id: string;
  name: string;
  role: string;
  status: AgentStatus;
  model: string;
  provider: string;
}

export interface AgentConfig {
  name: string;
  role: string;
  provider: string;
  model: string;
  permissions: { mode: PermissionMode; allow?: string[]; deny?: string[] };
  sandbox: { enabled: boolean; filesystem: string; network: boolean };
  tools?: string[];
  skills?: string[];
  systemPrompt?: string;
}

export interface AgentDetail {
  id: string;
  name: string;
  role: string;
  status: AgentStatus;
  config: AgentConfig;
  files: AgentFileInfo[];
}

export interface AgentFileInfo {
  name: string;
  size: number;
  modified: string;
}

// ── Group ──

export interface GroupInfo {
  id: string;
  name: string;
  members: string[];
  topic?: string;
  status?: 'active' | 'completed' | 'archived';
}

export interface GroupDetail {
  id: string;
  name: string;
  members: GroupMember[];
  topic?: string;
  workspace: Record<string, string>;
  talks: TalkInfo[];
}

export interface GroupMember {
  agentId: string;
  name: string;
  role: "host" | "member";
}

export interface TalkInfo {
  id: string;
  members: string[];
  topic: string;
  messageCount: number;
}

// ── Skill ──

export interface SkillInfo {
  name: string;
  description: string;
  tools: string[];
}

export interface SkillDetail extends SkillInfo {
  prompt: string;
  createdAt?: string;
}

// ── Messages ──

export interface LogMessage {
  direction: MessageDirection;
  content: string;
  timestamp: number;
  senderId?: string;
  senderName?: string;
  /** Per-message send status for user (in) messages */
  status?: 'sending' | 'sent' | 'streaming' | 'done' | 'error';
  errorMessage?: string;
  /** Tool calls that happened during this response (attached at finalizeStream) */
  toolCalls?: ToolEvent[];
}

export interface ToolEvent {
  agentId: string;
  toolName: string;
  toolCallId?: string;
  params?: Record<string, unknown>;
  result?: string;
  status: "start" | "complete" | "error";
}

export interface GroupMessage {
  groupId: string;
  fromAgentId: string;
  content: string;
  mentions: string[];
  timestamp: number;
}

// ── Config ──

export interface AppConfig {
  core: { logLevel: string; dataDir: string; skillsDir?: string; promptsDir?: string };
  agent: AgentConfig;
  providers: Record<string, ProviderConfig>;
  channels: Record<string, ChannelConfig>;
  gui: { enabled: boolean; wsPort: number };
  mcpServers?: Record<string, McpServerConfig>;
  groups?: GroupInfo[];
}

export interface ProviderConfig {
  apiKeyEnv: string;
  type?: string;
  baseURL?: string;
}

export interface ChannelConfig {
  type: string;
  enabled: boolean;
  [key: string]: unknown;
}

export interface McpServerConfig {
  transport: "stdio" | "http";
  command?: string;
  url?: string;
  args?: string[];
}

// ── WS Protocol ──

export interface WsMessage {
  type: string;
  payload?: unknown;
}

export interface WsStatePayload {
  agents: AgentInfo[];
  groups: GroupInfo[];
  channels: string[];
  timestamp: number;
}

export interface WsMessagePayload {
  direction: string;
  content: string;
  timestamp: number;
}

// ── Usage Stats ──

export interface UsageStats {
  agentId: string;
  inputTokens: number;
  outputTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  timestamp: number;
}

export interface DashboardData {
  tokens: { today: number; total: number; daily: { date: string; input: number; output: number }[] };
  latency: { p50: number; p95: number; hourly: { hour: string; avg: number }[] };
  tools: { name: string; count: number; errorRate: number }[];
  errors: { llmErrorRate: number; llmErrors: number; llmTotal: number;
            toolErrorRate: number; toolErrors: number; toolTotal: number; fallbackCount: number };
  agents: { agentId: string; agentName: string; callCount: number; totalTokens: number }[];
}
