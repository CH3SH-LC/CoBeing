import { useState, useEffect, useCallback } from "react";
import { useTodoStore } from "../../stores/todo";
import { TodoList } from "./TodoList";
import { TodoForm } from "./TodoForm";
import { getWsClient } from "../../hooks/useWebSocket";

type FilterOption = "all" | "pending" | "completed";

const FILTER_LABELS: Record<FilterOption, string> = {
  all: "全部",
  pending: "待完成",
  completed: "已完成",
};

export function TodoPanel({ agentId, groupId }: { agentId?: string; groupId?: string }) {
  const { todos, setScope } = useTodoStore();
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState<FilterOption>("all");

  const currentScope = groupId ? "group" : "agent";
  const currentId = groupId || agentId || "";

  useEffect(() => {
    setScope(currentScope, currentId);
    const ws = getWsClient();
    ws?.send({
      type: "get_todos",
      payload: { scope: currentScope, agentId, groupId },
    });
  }, [agentId, groupId, currentScope, currentId, setScope]);

  useEffect(() => {
    const handler = () => {
      const ws = getWsClient();
      ws?.send({ type: "get_todos", payload: { scope: currentScope, agentId, groupId } });
    };
    window.addEventListener("ws-todo-updated", handler);
    return () => window.removeEventListener("ws-todo-updated", handler);
  }, [currentScope, agentId, groupId]);

  const handleCreate = useCallback(
    (data: { title: string; description: string; triggerAt: string; recurrenceHint: string }) => {
      const ws = getWsClient();
      ws?.send({
        type: "add_todo",
        payload: {
          ...data,
          scope: currentScope,
          agentId,
          groupId,
          targetAgentId: groupId ? agentId : undefined,
        },
      });
      setShowForm(false);
    },
    [currentScope, agentId, groupId],
  );

  const handleComplete = useCallback(
    (todoId: string) => {
      const ws = getWsClient();
      ws?.send({ type: "complete_todo", payload: { todoId, scope: currentScope, agentId, groupId } });
    },
    [currentScope, agentId, groupId],
  );

  const handleRemove = useCallback(
    (todoId: string) => {
      const ws = getWsClient();
      ws?.send({ type: "remove_todo", payload: { todoId, scope: currentScope, agentId, groupId } });
    },
    [currentScope, agentId, groupId],
  );

  return (
    <div className="flex flex-col" style={{ gap: 16 }}>
      {/* 操作栏 */}
      <div className="flex items-center" style={{ gap: 10 }}>
        <div className="flex flex-1" style={{ gap: 6 }}>
          {(Object.keys(FILTER_LABELS) as FilterOption[]).map((f) => (
            <button
              key={f}
              className={`flex-1 rounded-lg text-sm transition-colors ${
                filter === f
                  ? "bg-accent text-white"
                  : "bg-elevated text-txt-sub hover:text-txt"
              }`}
              style={{ padding: "6px 0" }}
              onClick={() => setFilter(f)}
            >
              {FILTER_LABELS[f]}
            </button>
          ))}
        </div>
        <button
          className="rounded-lg bg-accent/15 text-accent text-sm font-medium transition-colors hover:bg-accent/25"
          style={{ padding: "6px 14px" }}
          onClick={() => setShowForm(!showForm)}
        >
          {showForm ? "收起" : "+ 新建"}
        </button>
      </div>

      {/* 新建表单 */}
      {showForm && (
        <div className="bg-surface rounded-xl border border-bdr/40" style={{ padding: 20 }}>
          <TodoForm onSubmit={handleCreate} onCancel={() => setShowForm(false)} />
        </div>
      )}

      {/* 列表 */}
      <TodoList todos={todos} onComplete={handleComplete} onRemove={handleRemove} filter={filter} />
    </div>
  );
}
