import type { TodoItemData } from "../../stores/todo";
import { TodoStatusBadge } from "./TodoStatusBadge";

interface TodoItemProps {
  todo: TodoItemData;
  onComplete: (id: string) => void;
  onRemove: (id: string) => void;
}

export function TodoItemCard({ todo, onComplete, onRemove }: TodoItemProps) {
  const triggerTime = new Date(todo.triggerAt);
  const isOverdue = triggerTime.getTime() < Date.now() && todo.status === "pending";
  const isPending = todo.status === "pending";

  return (
    <div
      className="bg-elevated rounded-xl transition-all duration-150"
      style={{ padding: "16px 20px" }}
    >
      {/* 标题行 */}
      <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
        <h4 className="text-sm font-semibold text-txt" style={{ lineHeight: 1.4 }}>
          {todo.title}
        </h4>
        <TodoStatusBadge status={todo.status} />
      </div>

      {/* 描述 */}
      {todo.description && (
        <p className="text-sm text-txt-sub" style={{ marginBottom: 12, lineHeight: 1.6 }}>
          {todo.description}
        </p>
      )}

      {/* 时间信息 */}
      <div
        className="flex items-center text-xs text-txt-muted"
        style={{ gap: 12, marginBottom: isPending ? 14 : 0 }}
      >
        <span className={isOverdue ? "text-danger font-medium" : ""}>
          {isOverdue ? "逾期 · " : ""}
          {triggerTime.toLocaleString("zh-CN")}
        </span>
        {todo.recurrenceHint !== "不重复" && (
          <>
            <span style={{ color: "var(--color-divider)" }}>·</span>
            <span>{todo.recurrenceHint}</span>
          </>
        )}
      </div>

      {/* 操作按钮 */}
      {isPending && (
        <div className="flex" style={{ gap: 8, marginTop: 2 }}>
          <button
            className="rounded-lg bg-success/15 text-success text-sm transition-colors hover:bg-success/25"
            style={{ padding: "7px 16px" }}
            onClick={() => onComplete(todo.id)}
          >
            完成
          </button>
          <button
            className="rounded-lg bg-danger/15 text-danger text-sm transition-colors hover:bg-danger/25"
            style={{ padding: "7px 16px" }}
            onClick={() => onRemove(todo.id)}
          >
            删除
          </button>
        </div>
      )}
    </div>
  );
}
