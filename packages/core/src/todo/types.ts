// packages/core/src/todo/types.ts

export interface TodoItem {
  id: string;                    // uuid
  title: string;                 // 简短标题
  description: string;           // 触发时告诉 agent 要做什么
  status: "pending" | "in-progress" | "review" | "completed";
  triggerAt: string;             // ISO 8601 触发时间
  /** 触发后 LLM 据此决定是否续期及下次触发时间 */
  recurrenceHint: string;        // "每天9:00" / "每周一10:00" / "不重复"
  createdBy: string;             // "user" | agentId | "TODOboard"
  createdAt: string;             // ISO 8601
  triggeredAt?: string;          // 实际触发时间
  completedAt?: string;

  // Agent 级专用
  agentId?: string;              // Agent 级 TODO 归属

  // 群组级专用
  targetAgentId?: string;        // 群组级 TODO 触发目标 agent

  // 任务分解（#15）
  parentId?: string;             // 父任务 ID（子任务追踪用）
  dependsOn?: string[];          // 依赖的上游任务 ID 列表
  deliverable?: string;          // 交付物描述（验收时用）

  /** 完成后的动作链 */
  onComplete?: {
    mentionAgentId?: string;     // 完成后 @mention 这个 agent
    message?: string;            // @mention 时附带的消息
    createTodo?: Omit<TodoItem, "id" | "createdAt" | "status">;
  };
}

export type TodoScope = "agent" | "group";

export const TODO_STATUS_VALUES = ["pending", "in-progress", "review", "completed"] as const;

/** 扫描间隔（毫秒） */
export const SCAN_INTERVAL_MS = 60_000;

/** 逾期阈值（毫秒）— 超过此值标注逾期 */
export const OVERDUE_THRESHOLD_MS = 3_600_000; // 1 小时
