import { useEffect } from "react";
import { useTodoStore } from "@/stores/todo";
import { getWsClient } from "@/hooks/useWebSocket";
import type { GlobalTodoInfo } from "@/lib/types";
import { SurfaceCard } from "@/components/layout/Surface";

const STATUS_STYLE: Record<string, { label: string; colorVar: string }> = {
  pending: { label: "\u5f85\u6d3e\u53d1", colorVar: "var(--color-txt-muted)" },
  running: { label: "\u6267\u884c\u4e2d", colorVar: "var(--color-accent)" },
  waiting_user: { label: "\u7b49\u5f85\u7528\u6237", colorVar: "var(--color-warning-fg)" },
  completed: { label: "\u5df2\u5b8c\u6210", colorVar: "var(--color-success)" },
  cancelled: { label: "\u5df2\u53d6\u6d88", colorVar: "var(--color-txt-muted)" },
};

const PANEL_COPY = {
  title: "\u5168\u5c40\u4efb\u52a1",
  subtitle: "\u7ba1\u5bb6\u6b63\u5728\u8ddf\u8fdb\u7684\u4efb\u52a1",
  empty: "\u6682\u65e0\u4efb\u52a1",
  waitingYou: "\u7b49\u5f85\u4f60",
};

function assigneeLabel(todo: GlobalTodoInfo) {
  const prefix = todo.assigneeType === "group"
    ? "\u7fa4\u7ec4"
    : todo.assigneeType === "agent"
      ? "Agent"
      : "\u7ba1\u5bb6";
  if (!todo.assigneeId) return prefix;
  return `${prefix} ${todo.assigneeId}`;
}

function executionRefLabel(ref: GlobalTodoInfo["executionRefs"][number]) {
  const scope = ref.scope === "group" ? "\u7fa4\u7ec4" : "Agent";
  const childCount = ref.todoIds?.length ?? 0;
  return childCount > 0
    ? `${scope} ${ref.id} \u00b7 ${childCount} \u4e2a\u5b50\u4efb\u52a1`
    : `${scope} ${ref.id}`;
}

export function getGlobalTodoDisplayLines(todo: GlobalTodoInfo): { body: string[]; meta: string[] } {
  // Compact display: only show progress + next action as a single line
  const summaryParts = [todo.progressSummary, todo.nextAction].filter(Boolean);
  const body = summaryParts.length > 0
    ? [summaryParts.join(" \u00b7 ")]
    : [];

  const meta = [
    `\u6307\u6d3e\uff1a${assigneeLabel(todo)}`,
  ].filter(Boolean);

  return { body, meta };
}

export function buildGlobalTodoPanelModel(todos: GlobalTodoInfo[]) {
  return {
    counts: {
      pending: todos.filter((t) => t.status === "pending").length,
      running: todos.filter((t) => t.status === "running").length,
      waitingUser: todos.filter((t) => t.status === "waiting_user").length,
      completed: todos.filter((t) => t.status === "completed").length,
      cancelled: todos.filter((t) => t.status === "cancelled").length,
    },
    activeTodos: todos.filter((t) => t.status === "pending" || t.status === "running" || t.status === "waiting_user"),
    completedTodos: todos.filter((t) => t.status === "completed"),
    cancelledTodos: todos.filter((t) => t.status === "cancelled"),
  };
}

function TodoItemRow({ todo }: { todo: GlobalTodoInfo }) {
  const style = STATUS_STYLE[todo.status] || STATUS_STYLE.pending;

  return (
    <div
      className="rounded-xl cursor-pointer transition-colors border border-bdr/20"
      style={{
        padding: "12px 16px",
        borderLeft: `4px solid ${style.colorVar}`,
        backgroundColor: `color-mix(in srgb, ${style.colorVar} 10%, var(--color-elevated))`,
      }}
    >
      <div className="text-sm font-medium text-txt leading-snug">{todo.title}</div>
      <div className="flex items-center flex-wrap" style={{ gap: 8, marginTop: 8 }}>
        <span className="text-xs font-medium" style={{ color: style.colorVar }}>
          {style.label}
        </span>
        <span className="text-xs text-txt-muted">
          指派：{assigneeLabel(todo)}
        </span>
      </div>
    </div>
  );
}

export function GlobalTodoPanel() {
  const { globalTodos, setGlobalTodos } = useTodoStore();

  useEffect(() => {
    const ws = getWsClient();
    ws?.send({ type: "get_global_todos", payload: {} });

    const handleData = (event: Event) => {
      const detail = (event as CustomEvent<{ payload: { todos: GlobalTodoInfo[] } }>).detail;
      if (detail?.payload?.todos) {
        setGlobalTodos(detail.payload.todos);
      }
    };

    const handleUpdate = () => {
      getWsClient()?.send({ type: "get_global_todos", payload: {} });
    };

    window.addEventListener("ws-global-todos", handleData);
    window.addEventListener("ws-global-todo-updated", handleUpdate);
    return () => {
      window.removeEventListener("ws-global-todos", handleData);
      window.removeEventListener("ws-global-todo-updated", handleUpdate);
    };
  }, [setGlobalTodos]);

  const { counts, activeTodos, completedTodos, cancelledTodos } = buildGlobalTodoPanelModel(globalTodos);

  return (
    <aside className="h-full min-h-0">
      <SurfaceCard className="flex h-full min-h-0 flex-col overflow-hidden" padding={20}>
        <div className="shrink-0">
          <div className="text-base font-semibold text-txt">{PANEL_COPY.title}</div>
          <div className="text-sm text-txt-muted" style={{ marginTop: 6 }}>
            {PANEL_COPY.subtitle}
          </div>
        </div>

        <div className="flex flex-wrap shrink-0" style={{ gap: 8, marginTop: 16 }}>
          {counts.pending > 0 && (
            <span
              className="rounded-lg text-xs font-medium"
              style={{ padding: "5px 9px", color: "var(--color-txt-muted)", backgroundColor: "color-mix(in srgb, var(--color-txt-muted) 12%, transparent)" }}
            >
              {counts.pending} {STATUS_STYLE.pending.label}
            </span>
          )}
          {counts.running > 0 && (
            <span
              className="rounded-lg text-xs font-medium"
              style={{ padding: "5px 9px", color: "var(--color-accent)", backgroundColor: "color-mix(in srgb, var(--color-accent) 15%, transparent)" }}
            >
              {counts.running} {STATUS_STYLE.running.label}
            </span>
          )}
          {counts.waitingUser > 0 && (
            <span
              className="rounded-lg text-xs font-medium"
              style={{ padding: "5px 9px", color: "var(--color-warning-fg)", backgroundColor: "color-mix(in srgb, var(--color-warning) 15%, transparent)" }}
            >
              {counts.waitingUser} {PANEL_COPY.waitingYou}
            </span>
          )}
          {counts.completed > 0 && (
            <span
              className="rounded-lg text-xs font-medium"
              style={{ padding: "5px 9px", color: "var(--color-success)", backgroundColor: "color-mix(in srgb, var(--color-success) 15%, transparent)" }}
            >
              {counts.completed} {STATUS_STYLE.completed.label}
            </span>
          )}
          {counts.cancelled > 0 && (
            <span
              className="rounded-lg text-xs font-medium"
              style={{ padding: "5px 9px", color: "var(--color-txt-muted)", backgroundColor: "color-mix(in srgb, var(--color-txt-muted) 12%, transparent)" }}
            >
              {counts.cancelled} {STATUS_STYLE.cancelled.label}
            </span>
          )}
        </div>

        {globalTodos.length === 0 ? (
          <div className="text-sm text-txt-muted text-center" style={{ padding: "40px 0" }}>
            {PANEL_COPY.empty}
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto" style={{ marginTop: 18 }}>
            <div className="flex flex-col" style={{ gap: 10 }}>
              {activeTodos.map((todo) => (
                <TodoItemRow key={todo.id} todo={todo} />
              ))}
              {completedTodos.length > 0 && (
                <>
                  <div className="text-xs text-txt-muted font-medium" style={{ marginTop: 6 }}>
                    {STATUS_STYLE.completed.label} ({counts.completed})
                  </div>
                  {completedTodos.slice(0, 5).map((todo) => (
                    <TodoItemRow key={todo.id} todo={todo} />
                  ))}
                </>
              )}
              {cancelledTodos.length > 0 && (
                <>
                  <div className="text-xs text-txt-muted font-medium" style={{ marginTop: 6 }}>
                    {STATUS_STYLE.cancelled.label} ({counts.cancelled})
                  </div>
                  {cancelledTodos.slice(0, 5).map((todo) => (
                    <TodoItemRow key={todo.id} todo={todo} />
                  ))}
                </>
              )}
            </div>
          </div>
        )}
      </SurfaceCard>
    </aside>
  );
}
