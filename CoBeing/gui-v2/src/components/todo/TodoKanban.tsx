import type { TodoItemData, TodoStatus } from "../../stores/todo";
import { TodoItemCard } from "./TodoItem";

const COLUMNS: { status: TodoStatus; label: string; dotColor: string }[] = [
  { status: "pending", label: "待处理", dotColor: "var(--color-accent)" },
  { status: "in-progress", label: "进行中", dotColor: "var(--color-warning)" },
  { status: "review", label: "审核中", dotColor: "var(--color-purple)" },
  { status: "completed", label: "已完成", dotColor: "var(--color-success)" },
];

interface TodoKanbanProps {
  todos: TodoItemData[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onComplete: (id: string) => void;
  onRemove: (id: string) => void;
  onStatusCycle: (id: string) => void;
}

export function TodoKanban({
  todos, selectedIds, onToggleSelect, onComplete, onRemove, onStatusCycle,
}: TodoKanbanProps) {
  const grouped = COLUMNS.map((col) => ({
    ...col,
    items: todos.filter((t) => t.status === col.status),
  }));

  const hasAny = grouped.some((g) => g.items.length > 0);

  if (!hasAny) {
    return (
      <div className="flex items-center justify-center" style={{ padding: "48px 0" }}>
        <p className="text-sm text-txt-muted">暂无 TODO</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-4" style={{ gap: 16 }}>
      {grouped.map((col) => (
        <div key={col.status} className="flex flex-col rounded-xl bg-surface/60" style={{ padding: 14, gap: 8 }}>
          {/* 列头 */}
          <div className="flex items-center justify-between" style={{ padding: "4px 6px" }}>
            <div className="flex items-center" style={{ gap: 6 }}>
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: col.dotColor }} />
              <span className="text-sm font-semibold text-txt-sub">
                {col.label}
              </span>
            </div>
            <span className="text-xs text-txt-muted tabular-nums">{col.items.length}</span>
          </div>

          {/* 卡片 */}
          {col.items.length === 0 ? (
            <div
              className="flex-1 flex items-center justify-center rounded-lg border border-dashed border-bdr/30"
              style={{ minHeight: 80 }}
            >
              <span className="text-xs text-txt-muted">空</span>
            </div>
          ) : (
            col.items.map((todo) => (
              <TodoItemCard
                key={todo.id}
                todo={todo}
                selected={selectedIds.has(todo.id)}
                onToggleSelect={onToggleSelect}
                onComplete={onComplete}
                onRemove={onRemove}
                onStatusCycle={onStatusCycle}
                compact
              />
            ))
          )}
        </div>
      ))}
    </div>
  );
}
