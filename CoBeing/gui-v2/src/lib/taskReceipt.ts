import type { TaskReceipt } from "@/lib/types";
import type { ButlerTaskReceiptPayload } from "@/hooks/ws-handlers/butler-task-handlers";

/** TaskReceiptCard 支持的 status 集合(未知状态归一到 running,避免 statusConfig 查找崩溃) */
export const RECEIPT_STATUSES: readonly TaskReceipt["status"][] = [
  "running",
  "waiting_user",
  "completed",
  "failed",
  "cancelled",
];

/** 事件 payload → TaskReceipt 结构化回执 */
export function toTaskReceipt(p: ButlerTaskReceiptPayload): TaskReceipt {
  return {
    id: p.butlerTaskId,
    title: p.title || "未命名任务",
    assigneeType: p.targetType,
    assigneeName: p.assigneeName || p.targetId,
    status: (RECEIPT_STATUSES as readonly string[]).includes(p.status)
      ? (p.status as TaskReceipt["status"])
      : "running",
    summary: p.summary,
    nextAction: p.nextAction,
  };
}
