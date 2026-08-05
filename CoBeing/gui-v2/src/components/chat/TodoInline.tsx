import { useMemo, useEffect } from "react";
import { useTodoStore } from "@/stores/todo";
import { getWsClient } from "@/hooks/useWebSocket";

/**
 * 紧凑版 Agent TODO 预览 — 独立 Agent 对话区上方显示
 * 群组中不显示，管家中由 GlobalTodoPanel 接手
 */
export function TodoInline({ agentId }: { agentId: string }) {
  const { todos } = useTodoStore();
  const pending = useMemo(() => todos.filter(t => t.status === "pending").slice(0, 3), [todos]);

  useEffect(() => {
    const ws = getWsClient();
    ws?.send({ type: "get_todos", payload: { scope: "agent", agentId } });
  }, [agentId]);

  if (pending.length === 0) return null;

  return (
    <div
      className="mx-6 mt-5 flex items-center overflow-hidden rounded-xl border border-bdr/30 bg-elevated text-sm"
      style={{
        padding: "10px 14px",
        gap: 10,
      }}
    >
      <span className="shrink-0 font-medium text-txt-sub">📌</span>
      {pending.map(t => (
        <span key={t.id} className="min-w-0 flex-1 truncate text-txt-muted">{t.title}</span>
      ))}
      <span className="ml-auto shrink-0 text-xs text-txt-muted">
        {pending.length} 项待完成
      </span>
    </div>
  );
}
