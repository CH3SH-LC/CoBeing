/**
 * MyAgents 全局类型定义
 */

// ============================================================
// LLM 相关类型
// ============================================================

export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolResult {
  toolCallId: string;
  content: string;
  isError?: boolean;
}

export type ModelTag = "coding" | "reasoning" | "fast" | "vision" | "flagship";

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  contextWindow: number;
  maxOutput: number;
  supportsTools: boolean;
  supportsVision: boolean;
  tags?: ModelTag[];
}

export interface ModelCapabilities {
  tools: boolean;
  vision: boolean;
  streaming: boolean;
  maxTokens: number;
  contextWindow: number;
}

export interface ChatParams {
  model: string;
  messages: Message[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
}

export interface ChatChunk {
  type: "content" | "tool_call" | "done";
  content?: string;
  toolCall?: ToolCall;
}

// ============================================================
// Channel 相关类型
// ============================================================

export interface InboundMessage {
  channelId: string;
  channelType: string;
  senderId: string;
  senderName: string;
  content: string;
  metadata?: Record<string, unknown>;
  replyTo?: string;
}

export interface OutboundMessage {
  channelId: string;
  content: string;
  replyTo?: string;
  metadata?: Record<string, unknown>;
}

export interface ChannelCapabilities {
  markdown: boolean;
  images: boolean;
  files: boolean;
  threading: boolean;
  reactions: boolean;
}

// ============================================================
// Agent 相关类型
// ============================================================

export type AgentStatus = "idle" | "running" | "error" | "stopped";

export interface AgentConfig {
  id: string;
  name: string;
  role: string;
  systemPrompt: string;
  provider: string;
  model: string;
  tools?: string[];
  toolsConfig?: ToolsConfig;
  permissions?: PermissionPolicy;
  sandbox?: SandboxConfig;
  skillsDir?: string;
  skills?: string[];         // 要装载的技能名称列表（按名称匹配 skills/ 目录下的技能）
}

export interface AgentResponse {
  content: string;
  toolCalls?: ToolCall[];
  usage?: TokenUsage;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

// ============================================================
// Permission 相关类型
// ============================================================

export type PermissionMode = "full-access" | "workspace-write" | "read-only" | "ask";

export interface PermissionPolicy {
  mode: PermissionMode;
  allow?: string[];
  deny?: string[];
}

// ============================================================
// Sandbox 相关类型
// ============================================================

export interface SandboxConfig {
  enabled: boolean;
  filesystem: "off" | "workspace-only" | "allowlist";
  network: boolean;
  allowPaths?: string[];
  blockPaths?: string[];
  bindings?: string[];  // extra mounts "hostPath:containerPath[:ro]"
}

// ============================================================
// Tool 相关类型
// ============================================================

export interface Tool {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
  execute(params: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;
}

export interface ToolContext {
  agentId: string;
  sessionId: string;
  workingDir: string;
  sandbox: SandboxConfig;
  permissions: PermissionPolicy;
  callDepth?: number;
}

export interface ToolsConfig {
  defaultPermission: string;
  enabled: string[];
  permissions: Record<string, Record<string, string | number>>;
}

// ============================================================
// MCP 相关类型
// ============================================================

export interface MCPServerConfig {
  transport: "stdio" | "http";
  command?: string;       // stdio: 启动命令
  args?: string[];        // stdio: 命令参数
  env?: Record<string, string>; // 环境变量
  url?: string;           // http: 服务端 URL
  headers?: Record<string, string>; // http: 自定义头
}

export interface MCPToolInfo {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

// ============================================================
// Group 相关类型
// ============================================================

/** @deprecated Phase 8.3 移除固定协议，保留类型用于向后兼容 */
export type GroupProtocol = "round-robin" | "free-form" | "moderated" | "voting";

export interface GroupConfig {
  id: string;
  name: string;
  members: string[];
  owner?: string;          // 群主 Agent ID（可选，未指定时由 Butler 充当）
  /** @deprecated Phase 8.3: 讨论不再由固定协议控制，保留字段用于兼容 */
  protocol?: string;
  moderator?: string;
  maxRounds?: number;
  topic?: string;
}

export interface GroupMessage {
  groupId: string;
  fromAgentId: string;
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface AgentStatusInfo {
  id: string;
  name: string;
  status: string;
  model: string;
  provider: string;
}

export interface GroupStatusInfo {
  id: string;
  name: string;
  members: string[];
  protocol: string;
  messageCount: number;
}
