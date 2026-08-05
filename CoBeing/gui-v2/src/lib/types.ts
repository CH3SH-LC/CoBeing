// ── Shared Types for CoBeing Frontend ──

export type ViewType = "butler" | "agents" | "groups" | "dashboard" | "extensions" | "settings";
export type ExtensionsTab = "skills" | "mcps" | "plugins" | "market";
export type AgentStatus = "idle" | "running" | "error";
export type MessageDirection = "in" | "out" | "system" | "tool";
export type PermissionMode = "read-only" | "workspace-readwrite"
  | "workspace-access" | "basic-access" | "full-access";

// ── Agent ──

export interface AgentInfo {
  id: string;
  name: string;
  role: string;
  status: AgentStatus;
  model: string;
  provider: string;
  bindings?: WorkspaceBinding[];
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

export interface WorkspaceBinding {
  path: string;
  mode: "readonly" | "readwrite";
  label?: string;
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
  /** Additional metadata (task receipt, review status, plugin cards) */
  metadata?: {
    taskReceipt?: TaskReceipt;
    reviewOverridden?: boolean;
    cards?: Array<{ type: string; payload: unknown }>;
  };
}

export interface ToolEvent {
  agentId: string;
  groupId?: string;
  toolName: string;
  toolCallId?: string;
  params?: Record<string, unknown>;
  result?: string;
  status: "start" | "complete" | "error";
}

export type TodoMutationAction =
  | "added"
  | "completed"
  | "removed"
  | "status-updated"
  | "batch-completed"
  | "batch-removed"
  | "batch-updated";

export interface TodoMutationPayload {
  action: TodoMutationAction | "complete" | "remove" | "update";
  scope: "agent" | "group";
  agentId?: string;
  groupId?: string;
  todo?: {
    id: string;
    title: string;
    agentId?: string;
    targetAgentId?: string;
    groupId?: string;
  };
  todoId?: string;
  status?: string;
  targetAgentId?: string;
  result?: unknown;
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
  plugins: Array<{ id: string; kind: string; enabled: boolean }>;
  timestamp: number;
}

export interface PluginModelInfo {
  id: string;
  name: string;
  provider?: string;
  contextWindow?: number;
  maxOutput?: number;
  supportsTools?: boolean;
  supportsVision?: boolean;
  tags?: string[];
}

export interface PluginInfo {
  id: string;
  name: string;
  kind: string;
  version: string;
  enabled: boolean;
  models?: PluginModelInfo[];
  channelType?: string;
  toolDefs?: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }>;
  extensions?: Array<{
    id: string;
    type: string;
    label: string;
    componentPath: string;
    icon?: string;
  }>;
  isCustomInstance?: boolean;
  pluginId?: string;
  instanceId?: string;
  config?: Record<string, unknown>;
  configSchema?: {
    fields?: Array<{ key: string; label: string; type: string; secret?: boolean }>;
    features?: Array<{ key: string; label: string; desc?: string }>;
  };
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

// ========== Butler Task (frontend summary) ==========

export interface ButlerTaskSummary {
  id: string;
  title: string;
  assigneeType: "agent" | "group";
  assigneeId: string;
  assigneeName: string;
  status: "running" | "waiting_user" | "completed" | "cancelled";
  lastEvent: string;
  nextAction?: string;
  updatedAt: number;
}


// ========== Task Receipt (chat card) ==========

export interface TaskReceipt {
  id: string;
  title: string;
  assigneeType: "agent" | "group";
  assigneeName: string;
  status: "running" | "waiting_user" | "completed" | "failed" | "cancelled";
  summary?: string;
  nextAction?: string;
  artifacts?: Array<{ name: string; path?: string }>;
}

export interface GlobalTodoInfo {
  id: string;
  title: string;
  description: string;
  status: "pending" | "running" | "waiting_user" | "completed" | "cancelled";
  assigneeType: "butler" | "agent" | "group";
  assigneeId?: string;
  responsibleAgentId?: string;
  progressSummary: string;
  nextAction: string;
  lastEvent?: { type: string; summary: string; at: string };
  internalBlocker?: { type: string; summary: string; since: string };
  executionRefs: Array<{ scope: "agent" | "group"; id: string; todoIds?: string[] }>;
  createdAt: string;
  updatedAt: string;
}

// ── Agent Enhancement ──

export interface AgentCapabilityCard {
  agentId: string;
  displayName: string;
  role: string;
  domains: string[];
  strengths: string[];
  limitations: string[];
  taskTypes: Array<{
    id: string;
    label: string;
    examples: string[];
    inputRequirements: string[];
    outputFormats: string[];
  }>;
  preferredTools: string[];
  preferredSkills: string[];
  collaboration: {
    canWorkAlone: boolean;
    goodInGroups: boolean;
    needsReviewFor: string[];
    shouldDelegate: string[];
  };
  reliability?: {
    completedTasks: number;
    failedTasks: number;
    lastUpdated: string;
  };
}

export type AgentTaskStatus =
  | "pending" | "running" | "blocked" | "waiting_user"
  | "waiting_dependency" | "completed" | "failed" | "cancelled";

export interface AgentTaskInboxItem {
  id: string;
  globalTodoId?: string;
  agentTodoId?: string;
  sourceType: "user" | "butler" | "group" | "system";
  sourceId: string;
  title: string;
  goal: string;
  acceptance?: string;
  constraints?: string[];
  status: AgentTaskStatus;
  blockerReason?: string;
  dependencyRefs?: Array<{ agentId: string; todoId?: string; reason: string }>;
  failureSummary?: string;
  globalMappingNote?: string;
  artifacts?: Array<{ name: string; path?: string; description?: string }>;
  createdAt: string;
  updatedAt: string;
}

export interface AgentGrowthProposal {
  id: string;
  agentId: string;
  targetFile: "JOB.md" | "CHARACTER.md" | "config.json";
  reason: string;
  proposedPatch: string;
  risk: "low" | "medium" | "high";
  status: "pending" | "approved" | "rejected" | "applied";
  createdAt: string;
  reviewedBy?: "growth-reviewer" | "user" | "butler";
  reviewedAt?: string;
  reviewNote?: string;
}

// ── Market ──

export type MarketResourceType = "agent" | "group" | "skill";
export type MarketTier = "official" | "certified" | "community" | "local";
export type MarketRiskLevel = "low" | "medium" | "high";

export interface MarketDependency {
  type: MarketResourceType;
  id: string;
  version?: string;
}

export interface MarketResourceView {
  id: string;
  type: MarketResourceType;
  name: string;
  description: string;
  version: string;
  tier: MarketTier;
  author: string;
  icon?: string;
  tags: string[];
  riskLevel: MarketRiskLevel;
  permissions: string[];
  dependencies: MarketDependency[];
  installed: boolean;
}

export interface MarketDepNode {
  id: string;
  type: MarketResourceType;
  name: string;
  tier: MarketTier;
  riskLevel: MarketRiskLevel;
  required: boolean;
  children: MarketDepNode[];
}

export interface MarketInstallResult {
  status: "installed" | "approval_required" | "already_installed" | "error";
  id: string;
  type: MarketResourceType;
  name: string;
  message?: string;
  installedIds: string[];
  dependencyTree: MarketDepNode;
  warning?: string;
}

export interface InstalledEntry {
  id: string;
  type: MarketResourceType;
  name: string;
  installedAt: string;
  sourceId: string;
  installedIds: string[];
}
