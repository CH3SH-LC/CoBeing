import { useButlerTasksStore } from "@/stores/butlerTasks";
import { useAgentsStore } from "@/stores/agents";
import { useGroupsStore } from "@/stores/groups";
import { useChatStore } from "@/stores/chat";
import type { ButlerTaskSummary } from "@/lib/types";
import { emitActivity } from "./helpers";
import type { WsHandlerContext, WsMessageHandler } from "./types";

/** butler_task_updated 事件 payload(后端广播契约,与 packages/shared 的 ButlerTaskReceiptPayload 对齐) */
export interface ButlerTaskReceiptPayload {
  butlerTaskId: string;
  globalTodoId?: string;
  title: string;
  targetType: "agent" | "group";
  targetId: string;
  assigneeName: string;
  status: string;
  summary?: string;
  nextAction?: string;
  timestamp: number;
}

/** dispatch_task 的响应 payload(前端合约字段,后端并行实现会追加 targetType/groupId) */
interface DispatchTaskResultPayload {
  ok: boolean;
  agentId?: string;
  groupId?: string;
  targetType?: "agent" | "group";
  globalTodoId?: string;
  butlerTaskId?: string;
  executionRef?: string;
  message?: string;
}

const STATUS_LABELS: Record<string, string> = {
  pending: "待派发",
  running: "运行中",
  waiting_user: "等待你",
  completed: "已完成",
  cancelled: "已取消",
  failed: "失败",
};

/** 插入一条本地系统消息(默认进入当前会话,无活动会话时退回管家会话) */
function pushSystemMessage(content: string) {
  useChatStore.getState().addMessage(
    { direction: "system", content, timestamp: Date.now() },
    useChatStore.getState().activeConversation ?? "butler",
  );
}

/** 从 dispatch_task_result 解析目标显示名(防御后端字段未齐的情况) */
function resolveTargetName(p: DispatchTaskResultPayload): string {
  const isGroup = p.targetType === "group" || (!!p.groupId && !p.agentId);
  if (isGroup) {
    const group = useGroupsStore.getState().groups.find((g) => g.id === p.groupId);
    return group?.name || p.groupId || "群组";
  }
  const agent = useAgentsStore.getState().agents.find((a) => a.id === p.agentId);
  return agent?.name || p.agentId || "Agent";
}

export function buildButlerTaskHandlers(_ctx: WsHandlerContext): Record<string, WsMessageHandler> {
  return {
    /**
     * 管家任务状态更新广播:
     * 1. upsert 到 butlerTasks store(按 butlerTaskId 合并/追加);
     * 2. 记录活动日志;
     * 3. 派发 ws-butler-task-receipt 窗口事件(ChatView 据此点亮任务回执卡片)。
     */
    butler_task_updated: (msg) => {
      const p = msg.payload as ButlerTaskReceiptPayload | undefined;
      if (!p?.butlerTaskId) return;

      useButlerTasksStore.getState().upsertTask({
        id: p.butlerTaskId,
        title: p.title || "未命名任务",
        assigneeType: p.targetType ?? "agent",
        assigneeId: p.targetId ?? "",
        assigneeName: p.assigneeName ?? "",
        status: p.status as ButlerTaskSummary["status"],
        lastEvent: p.summary ?? p.nextAction ?? "状态更新",
        nextAction: p.nextAction,
        updatedAt: p.timestamp ?? Date.now(),
      });

      const label = STATUS_LABELS[p.status] ?? p.status;
      emitActivity("🤖", `管家任务「${p.title}」${label}`, "info", "todo");

      window.dispatchEvent(new CustomEvent<ButlerTaskReceiptPayload>("ws-butler-task-receipt", { detail: p }));
    },

    /** dispatch_task 的结果回执:成功插入「已派发给 X」,失败插入错误消息 */
    dispatch_task_result: (msg) => {
      const p = msg.payload as DispatchTaskResultPayload | undefined;
      if (!p) return;

      if (p.ok) {
        const name = resolveTargetName(p);
        emitActivity("📤", `已派发任务给 ${name}`, "info", "todo");
        pushSystemMessage(`已派发给 ${name}`);
      } else {
        const reason = p.message || "未知原因";
        emitActivity("📤", `派发任务失败：${reason}`, "error", "todo");
        pushSystemMessage(`派发失败：${reason}`);
      }
    },

    /**
     * Group → Butler 结构化事件桥（host-report-event → butler_escalation）:
     * 群组上报 blocked / needs_user_decision / completed / failed 等事件时，
     * 将对应管家任务置为 waiting_user 并更新摘要，提醒用户在管家入口处理。
     */
    butler_escalation: (msg) => {
      const p = msg.payload as ButlerEscalationEventPayload | undefined;
      if (!p?.butlerTaskId) return;

      // 群组需要用户决策/被阻塞 → 管家任务标记为等待用户
      useButlerTasksStore.getState().upsertTask({
        id: p.butlerTaskId,
        title: p.summary?.slice(0, 40) || "群组事件",
        assigneeType: "group",
        assigneeId: p.groupId,
        assigneeName: "群组",
        status: "waiting_user",
        lastEvent: p.summary,
        nextAction: p.suggestedNextStep,
        updatedAt: Date.now(),
      });

      const sevLabel = { info: "提示", warning: "注意", critical: "紧急" }[p.severity] ?? "提示";
      emitActivity("🧩", `[${sevLabel}] 群组需要你处理：${p.summary}`, p.severity === "critical" ? "error" : "warn", "todo", p.fromAgentId, p.groupId);

      // 派发事件给管家视图（GlobalTodoPanel 可据此刷新）
      window.dispatchEvent(new CustomEvent<ButlerEscalationEventPayload>("ws-butler-escalation", { detail: p }));
    },
  };
}

/** butler_escalation 事件 payload(与 packages/shared 的 ButlerEscalationEvent 对齐) */
interface ButlerEscalationEventPayload {
  id: string;
  type: string;
  butlerTaskId: string;
  groupId: string;
  fromAgentId: string;
  severity: "info" | "warning" | "critical";
  summary: string;
  suggestedNextStep?: string;
  createdAt: string;
}
