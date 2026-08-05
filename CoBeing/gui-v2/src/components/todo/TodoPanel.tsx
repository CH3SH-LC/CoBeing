import { useState, useEffect, useCallback, useMemo } from "react";
import { useTodoStore } from "../../stores/todo";
import { TodoList } from "./TodoList";
import { TodoKanban } from "./TodoKanban";
import { TodoForm } from "./TodoForm";
import { getWsClient } from "../../hooks/useWebSocket";
import type { TodoMutationPayload } from "@/lib/types";

type FilterOption = "all" | "pending" | "completed";

const FILTER_LABELS: Record<FilterOption, string> = {
  all: "全部",
  pending: "待完成",
  completed: "已完成",
};

export function TodoPanel({ agentId, groupId }: { agentId?: string; groupId?: string }) {
  const {
    todos, selectedIds, viewMode,
    setScope, setViewMode, toggleSelect, clearSelection, selectAll,
  } = useTodoStore();
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState<FilterOption>("all");
  const [showBatchAssign, setShowBatchAssign] = useState(false);
  const [batchTarget, setBatchTarget] = useState("");

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
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ payload?: TodoMutationPayload }>).detail;
      const payload = detail?.payload;
      if (payload?.scope && payload.scope !== currentScope) return;
      if (payload?.scope === "agent" && payload.agentId && agentId && payload.agentId !== agentId) return;
      if (payload?.scope === "group" && payload.groupId && groupId && payload.groupId !== groupId) return;
      const ws = getWsClient();
      ws?.send({ type: "get_todos", payload: { scope: currentScope, agentId, groupId } });
    };
    window.addEventListener("ws-todo-updated", handler);
    return () => window.removeEventListener("ws-todo-updated", handler);
  }, [currentScope, agentId, groupId]);

  const upcoming = useMemo(() => {
    const store = useTodoStore.getState();
    return store.getUpcoming(30);
  }, [todos]);

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

  const handleStatusCycle = useCallback(
    (todoId: string) => {
      const todo = todos.find((t) => t.id === todoId);
      if (!todo) return;
      const nextMap: Record<string, string> = {
        pending: "in-progress",
        "in-progress": "review",
        review: "completed",
        completed: "pending",
      };
      const nextStatus = nextMap[todo.status] || "pending";
      const ws = getWsClient();
      ws?.send({
        type: "update_todo_status",
        payload: { todoId, status: nextStatus, scope: currentScope, agentId, groupId },
      });
    },
    [currentScope, agentId, groupId, todos],
  );

  // Batch operations
  const selectedArr = useMemo(() => [...selectedIds], [selectedIds]);

  const handleBatchComplete = useCallback(() => {
    if (selectedArr.length === 0) return;
    const ws = getWsClient();
    ws?.send({ type: "batch_complete_todo", payload: { todoIds: selectedArr, scope: currentScope, agentId, groupId } });
    clearSelection();
  }, [selectedArr, currentScope, agentId, groupId, clearSelection]);

  const handleBatchRemove = useCallback(() => {
    if (selectedArr.length === 0) return;
    const ws = getWsClient();
    ws?.send({ type: "batch_remove_todo", payload: { todoIds: selectedArr, scope: currentScope, agentId, groupId } });
    clearSelection();
  }, [selectedArr, currentScope, agentId, groupId, clearSelection]);

  const handleBatchAssign = useCallback(() => {
    if (!batchTarget.trim() || selectedArr.length === 0) return;
    const ws = getWsClient();
    ws?.send({
      type: "batch_update_todo",
      payload: { todoIds: selectedArr, scope: currentScope, agentId, groupId, targetAgentId: batchTarget.trim() },
    });
    clearSelection();
    setShowBatchAssign(false);
    setBatchTarget("");
  }, [selectedArr, currentScope, agentId, groupId, clearSelection, batchTarget]);

  const filteredTodos = filter === "all" ? todos : todos.filter((t) => t.status === filter);

  return (
    <div className="flex flex-col" style={{ gap: 16 }}>
      {/* 到期提醒 */}
      {upcoming.length > 0 && (
        <div
          className="flex items-center rounded-xl text-sm font-medium"
          style={{
            padding: "10px 16px",
            backgroundColor: "color-mix(in srgb, var(--color-warning) 12%, transparent)",
            color: "var(--color-warning-fg)",
            gap: 8,
          }}
        >
          <span>⏰</span>
          <span className="flex-1">
            {upcoming.length} 个 TODO 将在 30 分钟内到期
          </span>
          <span className="text-sm opacity-70">
            {upcoming.map((t) => t.title).join("、")}
          </span>
        </div>
      )}

      {/* 批量操作栏 */}
      {selectedArr.length > 0 && (
        <div
          className="flex items-center rounded-xl bg-accent/8 border border-accent/20"
          style={{ padding: "8px 14px", gap: 10 }}
        >
          <span className="text-sm font-medium text-accent">
            已选 {selectedArr.length} 项
          </span>
          <button
            className="rounded-lg bg-success/15 text-success text-sm font-medium transition-colors hover:bg-success/25"
            style={{ padding: "5px 12px" }}
            onClick={handleBatchComplete}
          >
            完成选中
          </button>
          <button
            className="rounded-lg bg-warning/15 text-warning text-sm font-medium transition-colors hover:bg-warning/25"
            style={{ padding: "5px 12px" }}
            onClick={() => setShowBatchAssign(!showBatchAssign)}
          >
            重新分配...
          </button>
          <button
            className="rounded-lg bg-danger/15 text-danger text-sm font-medium transition-colors hover:bg-danger/25"
            style={{ padding: "5px 12px" }}
            onClick={handleBatchRemove}
          >
            删除选中
          </button>
          <div className="flex-1" />
          <button
            className="text-xs text-txt-muted hover:text-txt transition-colors"
            onClick={clearSelection}
          >
            取消选择
          </button>
        </div>
      )}

      {/* 批量分配输入 */}
      {showBatchAssign && (
        <div
          className="flex items-center rounded-xl bg-surface border border-bdr/40"
          style={{ padding: "10px 14px", gap: 8 }}
        >
          <input
            className="flex-1 bg-transparent text-sm text-txt outline-none"
            placeholder="输入目标 Agent ID..."
            value={batchTarget}
            onChange={(e) => setBatchTarget(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleBatchAssign(); }}
            autoFocus
          />
          <button
            className="rounded-lg bg-accent text-white text-sm font-medium"
            style={{ padding: "5px 14px" }}
            onClick={handleBatchAssign}
          >
            确认
          </button>
          <button
            className="text-xs text-txt-muted hover:text-txt"
            onClick={() => { setShowBatchAssign(false); setBatchTarget(""); }}
          >
            取消
          </button>
        </div>
      )}

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
        {/* 视图切换 */}
        <div className="flex rounded-lg bg-elevated" style={{ padding: 2, gap: 2 }}>
          <button
            className={`rounded-lg text-sm font-medium transition-colors ${
              viewMode === "list" ? "bg-accent text-white" : "text-txt-muted hover:text-txt"
            }`}
            style={{ padding: "5px 10px" }}
            onClick={() => setViewMode("list")}
          >
            列表
          </button>
          <button
            className={`rounded-lg text-sm font-medium transition-colors ${
              viewMode === "kanban" ? "bg-accent text-white" : "text-txt-muted hover:text-txt"
            }`}
            style={{ padding: "5px 10px" }}
            onClick={() => setViewMode("kanban")}
          >
            看板
          </button>
        </div>
        {viewMode === "list" && (
          <button
            className="rounded-lg bg-elevated text-txt-sub text-sm transition-colors hover:text-txt"
            style={{ padding: "6px 12px" }}
            onClick={selectAll}
          >
            {selectedIds.size > 0 ? "全不选" : "全选"}
          </button>
        )}
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

      {/* 内容区 */}
      {viewMode === "kanban" ? (
        <TodoKanban
          todos={filteredTodos}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          onComplete={handleComplete}
          onRemove={handleRemove}
          onStatusCycle={handleStatusCycle}
        />
      ) : (
        <TodoList
          todos={filteredTodos}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          onComplete={handleComplete}
          onRemove={handleRemove}
          onStatusCycle={handleStatusCycle}
          filter={filter}
        />
      )}
    </div>
  );
}
