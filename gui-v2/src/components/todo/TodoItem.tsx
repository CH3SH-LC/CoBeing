import type { TodoItemData } from "../../stores/todo";
import { TodoStatusBadge } from "./TodoStatusBadge";

interface TodoItemProps {
  todo: TodoItemData;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  onComplete: (id: string) => void;
  onRemove: (id: string) => void;
  onStatusCycle?: (id: string) => void;
  compact?: boolean;
}

const NEXT_STATUS: Record<string, string> = {
  pending: "in-progress",
  "in-progress": "review",
  review: "completed",
  completed: "pending",
};

export function TodoItemCard({
  todo, selected, onToggleSelect, onComplete, onRemove, onStatusCycle, compact,
}: TodoItemProps) {
  const triggerTime = new Date(todo.triggerAt);
  const isOverdue = triggerTime.getTime() < Date.now() && todo.status !== "completed";
  const isDone = todo.status === "completed";

  return (
    <div
      className={`bg-elevated rounded-xl transition-all duration-150 relative ${
        selected ? "bg-accent/8 border-l-[3px] border-l-accent" : isOverdue ? "border-l-[3px] border-l-danger" : ""
      }`}
      style={{ padding: compact ? "12px 14px" : "16px 20px" }}
    >
      {/* 选择框 */}
      <div
        className="absolute cursor-pointer"
        style={{ top: compact ? 12 : 16, left: compact ? 10 : 14 }}
        onClick={(e) => { e.stopPropagation(); onToggleSelect(todo.id); }}
      >
        <div
          className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
            selected ? "bg-accent border-accent" : "border-bdr hover:border-accent/50"
          }`}
        >
          {selected && <span className="text-white text-xs leading-none">✓</span>}
        </div>
      </div>

      <div style={{ marginLeft: 28 }}>
        {/* 标题行 */}
        <div className="flex items-center justify-between" style={{ marginBottom: compact ? 6 : 10 }}>
          <h4
            className={`text-sm font-semibold ${isDone ? "text-txt-muted line-through" : "text-txt"}`}
            style={{ lineHeight: 1.4 }}
          >
            {todo.title}
          </h4>
          {!compact && <TodoStatusBadge status={todo.status} />}
        </div>

        {/* 描述 */}
        {!compact && todo.description && (
          <p className="text-sm text-txt-sub" style={{ marginBottom: 12, lineHeight: 1.6 }}>
            {todo.description}
          </p>
        )}

        {/* 时间信息 */}
        <div
          className="flex items-center text-xs text-txt-muted"
          style={{ gap: 12, marginBottom: isDone ? 0 : compact ? 0 : 14 }}
        >
          <span className={isOverdue ? "text-danger font-medium" : ""}>
            {isOverdue ? "逾期 · " : ""}
            {triggerTime.toLocaleString("zh-CN")}
          </span>
          {!compact && todo.recurrenceHint !== "不重复" && (
            <>
              <span style={{ color: "var(--color-divider)" }}>·</span>
              <span>{todo.recurrenceHint}</span>
            </>
          )}
          {todo.targetAgentId && (
            <>
              <span style={{ color: "var(--color-divider)" }}>·</span>
              <span>{todo.targetAgentId}</span>
            </>
          )}
        </div>

        {/* 操作按钮 */}
        {!isDone && !compact && (
          <div className="flex" style={{ gap: 8, marginTop: 2 }}>
            <button
              className="rounded-lg bg-success/15 text-success text-sm transition-colors hover:bg-success/25"
              style={{ padding: "7px 16px" }}
              onClick={() => onComplete(todo.id)}
            >
              完成
            </button>
            {onStatusCycle && (
              <button
                className="rounded-lg bg-warning/15 text-warning text-sm transition-colors hover:bg-warning/25"
                style={{ padding: "7px 16px" }}
                onClick={() => onStatusCycle(todo.id)}
              >
                → {STATUS_LABELS_MAP[NEXT_STATUS[todo.status]] || "下一状态"}
              </button>
            )}
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
    </div>
  );
}

const STATUS_LABELS_MAP: Record<string, string> = {
  pending: "进行中",
  "in-progress": "审核",
  review: "完成",
  completed: "待处理",
};
