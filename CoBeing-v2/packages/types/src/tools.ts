/**
 * 工具契约（调度器 + 原体默认工具共用）
 */

/** 路径守卫接口（最小权限：群组空间内；越权抛错） */
export interface PathGuardLike {
  assert(path: string): string
  /** 写校验（只读模式 / readonly 规则命中时抛错）。可选：仅声明 assert 的简化守卫兼容。 */
  assertWrite?(path: string): string
  inside(path: string): boolean
}

/** 工具执行上下文 */
export interface ToolRunContext {
  /** 发起实例名 */
  agent: string
  /** 所属群组名 */
  group: string
  /** 群组空间（cwd） */
  cwd: string
  /** 路径守卫（默认最小权限：只能访问群组空间） */
  guard: PathGuardLike
  signal: AbortSignal
  /** 向公共上下文发言（可附带 mention 唤醒） */
  speak: (content: string, mention?: string[], task?: string) => Promise<void>
  /** 追加私密内容 */
  writePrivate: (content: string) => Promise<void>
}

/** 工具结果 */
export interface ToolResult {
  ok: boolean
  content: string
  error?: { message: string; code?: string }
  /** 是否结束当前 turn */
  concludesTurn?: boolean
  /** 附加上下文（进入下一步 inbox） */
  additionalContexts?: string[]
}

/** 工具定义（注册皆 effect） */
export interface ToolDef {
  name: string
  description: string
  /** 参数 JSON Schema（仅类型约束，供模型面呈现） */
  schema: Record<string, unknown>
  /** 调度分类：exclusive 排他屏障 / parallel 并行安全 */
  mode: 'exclusive' | 'parallel'
  execute: (args: unknown, ctx: ToolRunContext) => Promise<ToolResult>
}

/** 调度器 prepare 三分类结果 */
export type ToolExecutionPrepared =
  | { kind: 'dispatch'; exec: { tool: ToolDef; args: unknown; ctx: ToolRunContext } }
  | { kind: 'post-result'; result: ToolResult }
  | { kind: 'final-result'; result: ToolResult }

/** 工具注册表接口 */
export interface ToolRegistry {
  register(tool: ToolDef): () => void
  get(name: string): ToolDef | undefined
  list(): ToolDef[]
  /** 计算某调用的执行模式（当前定义 mode；后续可扩展策略） */
  executionMode(name: string): 'exclusive' | 'parallel'
}
