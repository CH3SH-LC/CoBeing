/**
 * Claude Code MCP — 共享类型
 *
 * 定义 TaskManager 与 SDK Runner 之间的契约：
 * - ClaudeCodeRunner 抽象了真实 Claude Code 的执行（query()）与测试 fake
 * - TaskRecord 是任务状态机对外暴露的记录
 */

/** 任务状态机 */
export type TaskState = "running" | "completed" | "failed" | "cancelled";

/** 权限模式（对齐 SDK PermissionMode） */
export type PermissionMode = "default" | "acceptEdits" | "bypassPermissions" | "plan" | "dontAsk";

/** 一次 Claude Code 执行的选项（与 @anthropic-ai/claude-agent-sdk 的 Options 对齐） */
export interface ClaudeCodeRunOptions {
  /** Claude Code 工作目录（必填，锚定其可访问范围） */
  cwd: string;
  /** 任务提示词（必填） */
  prompt: string;
  /** 系统提示词覆盖（可选，默认用 Claude Code 内置编码 agent 行为） */
  systemPrompt?: string;
  /** 权限模式 */
  permissionMode?: PermissionMode;
  /** 自动放行工具列表 */
  allowedTools?: string[];
  /** 最大对话轮数 */
  maxTurns?: number;
  /** 最大预算 USD */
  maxBudgetUsd?: number;
  /** 模型名，如 claude-sonnet-5 */
  model?: string;
  /** 续会话：复用此前任务的 session_id */
  sessionId?: string;
  /** 取消信号（由 TaskManager 创建，cancel 时触发） */
  signal?: AbortSignal;
  /** 流式输出回调（SDK 的 partial assistant 文本增量） */
  onOutput?: (text: string) => void;
}

/** Claude Code 一次执行的最终结果 */
export type ClaudeCodeRunResult =
  | { state: "completed"; result: string; sessionId?: string; totalCostUsd?: number }
  | { state: "failed"; error: string; sessionId?: string }
  | { state: "cancelled"; sessionId?: string };

/** Runner 抽象：真实实现包 query()，测试用 fake */
export interface ClaudeCodeRunner {
  run(options: ClaudeCodeRunOptions): Promise<ClaudeCodeRunResult>;
}

/** start 工具入参 */
export interface StartParams {
  workingDir?: string;
  prompt?: string;
  systemPrompt?: string;
  /** 原始字符串，由 TaskManager 校验后收窄为 PermissionMode */
  permissionMode?: string;
  allowedTools?: string[];
  maxTurns?: number;
  maxBudgetUsd?: number;
  model?: string;
  sessionId?: string;
}

export type StartResult = { ok: true; taskId: string } | { ok: false; error: string };

export type CancelResult = { ok: true } | { ok: false; error: string };

/** 任务记录（对外状态） */
export interface TaskRecord {
  id: string;
  state: TaskState;
  cwd: string;
  prompt: string;
  createdAt: number;
  updatedAt: number;
  /** 流式输出增量块（读取时 join） */
  output: string[];
  result?: string;
  error?: string;
  sessionId?: string;
  totalCostUsd?: number;
  maxTurns?: number;
  maxBudgetUsd?: number;
  model?: string;
  permissionMode?: PermissionMode;
}

/** TaskManager 选项 */
export interface TaskManagerOptions {
  defaultMaxBudgetUsd?: number;
  defaultMaxTurns?: number;
  defaultPermissionMode?: PermissionMode;
  /** result 工具内部轮询间隔 ms（默认 500，测试可注入） */
  pollIntervalMs?: number;
  /** 输出累积上限字符数（默认 20000，防内存膨胀） */
  maxOutputChars?: number;
}
