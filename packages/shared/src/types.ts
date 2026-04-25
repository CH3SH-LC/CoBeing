/**
 * CoBeing 全局类型定义
 */

// ============================================================
// LLM 相关类型
// ============================================================

export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
  /** DeepSeek 思考模式的 reasoning_content */
  reasoningContent?: string;
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

export type ModelTag = "coding" | "reasoning" | "fast" | "vision" | "flagship" | "long-context";

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
  /** 启用思考模式（DeepSeek V4 等支持） */
  thinkingEnabled?: boolean;
  /** 思考强度："high" 或 "max" */
  reasoningEffort?: "high" | "max";
}

export interface ChatChunk {
  type: "content" | "tool_call" | "reasoning" | "done";
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
  maxToolRounds?: number;    // 单次对话最大工具调用轮数
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
// 网络白名单相关类型
// ============================================================

export interface NetworkConfig {
  enabled: boolean;                    // 总开关
  mode: "all" | "whitelist" | "none"; // 全开/白名单/全关
  allowDomains?: string[];            // 允许的域名列表
  domainGroups?: DomainGroup[];       // 域名包
}

export interface DomainGroup {
  id: string;
  name: string;        // 如 "开发工具", "包管理器"
  domains: string[];
}

// ============================================================
// 安全加固相关类型
// ============================================================

export interface SecurityConfig {
  enabled: boolean;           // 总开关
  noNewPrivileges: boolean;   // 禁止提升权限
  readOnlyRootfs: boolean;    // 只读根文件系统
  dropAllCapabilities: boolean; // 丢弃所有 capabilities
}

// ============================================================
// Sandbox 相关类型
// ============================================================

export interface SandboxConfig {
  enabled: boolean;
  filesystem: "isolated" | "host";
  network: NetworkConfig;
  bindings?: string[];  // extra mounts "hostPath:containerPath[:ro]"
  resources?: {
    memory?: string;    // 如 "512m", "1g"，默认 "512m"
    cpus?: number;      // 如 1, 2，默认 1
    timeout?: number;   // 单次命令超时秒数，默认 30
    disk?: string;      // 磁盘限制
  };
  image?: string;       // 自定义镜像，默认 "cobeing-sandbox:latest"
  security?: SecurityConfig;  // 安全加固配置
}

// ============================================================
// SandboxRunner 接口 — 沙箱执行器抽象（定义在 shared 包避免循环依赖）
// ============================================================

export interface SandboxRunOptions {
  timeout?: number;
  cwd?: string;
  env?: Record<string, string>;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

export interface SandboxRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface SandboxRunner {
  run(command: string, opts?: SandboxRunOptions): Promise<SandboxRunResult>;
  runFile(filePath: string, opts?: SandboxRunOptions): Promise<SandboxRunResult>;
  addMount(hostPath: string, containerPath: string): Promise<void>;
  removeMount(containerPath: string): Promise<void>;
  destroy(): Promise<void>;
  getStatus(): { containerId: string | null; running: boolean };
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
  sandboxRunner?: SandboxRunner;
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

export interface GroupConfig {
  id: string;
  name: string;
  members: string[];
  owner?: string;          // 群主 Agent ID（可选，未指定时由 Butler 充当）
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
  messageCount: number;
}

// ============================================================
// 本地过滤层类型
// ============================================================

export interface FilterResult {
  shouldWake: boolean;
  reason: string;
  summary?: string;
  priority: "high" | "normal" | "low";
}

export interface LocalModelConfig {
  enabled: boolean;
  path: string;
  contextSize?: number;
  filterDebounceMs?: number;
}
