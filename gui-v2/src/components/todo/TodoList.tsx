import type { TodoItemData } from "../../stores/todo";
import { TodoItemCard } from "./TodoItem";

interface TodoListProps {
  todos: TodoItemData[];
  onComplete: (id: string) => void;
  onRemove: (id: string) => void;
  filter?: "pending" | "completed" | "all";
}

export function TodoList({ todos, onComplete, onRemove, filter = "all" }: TodoListProps) {
  const filtered = filter === "all" ? todos : todos.filter((t) => t.status === filter);

  const sorted = [...filtered].sort((a, b) => {
    const aTime = new Date(a.triggerAt).getTime();
    const bTime = new Date(b.triggerAt).getTime();
    return aTime - bTime;
  });

  if (sorted.length === 0) {
    return (
      <div className="flex items-center justify-center" style={{ padding: "48px 0" }}>
        <p className="text-sm text-txt-muted">暂无 TODO</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col" style={{ gap: 10 }}>
      {sorted.map((todo) => (
        <TodoItemCard
          key={todo.id}
          todo={todo}
          onComplete={onComplete}
          onRemove={onRemove}
        />
      ))}
    </div>
  );
}
