import { create } from "zustand";
import type { GlobalTodoInfo } from "@/lib/types";

export type TodoStatus = "pending" | "in-progress" | "review" | "completed";

export interface TodoItemData {
  id: string;
  title: string;
  description: string;
  status: TodoStatus;
  triggerAt: string;
  recurrenceHint: string;
  createdBy: string;
  createdAt: string;
  triggeredAt?: string;
  completedAt?: string;
  repeat?: {
    type: "daily" | "weekly" | "interval";
    timeOfDay?: string;
    weekday?: number;
    intervalHours?: number;
    until?: string;
  };
  nextTriggerAt?: string;
  overduePolicy?: { action: "re-wake" | "escalate-to-host"; cooldownMinutes?: number; maxRetries?: number };
  reTriggerCount?: number;
  agentId?: string;
  targetAgentId?: string;
  parentId?: string;
  dependsOn?: string[];
  onComplete?: {
    mentionAgentId?: string;
    message?: string;
  };
}

interface TodoStore {
  todos: TodoItemData[];
  loading: boolean;
  scope: "agent" | "group";
  scopeId: string | null;
  selectedIds: Set<string>;
  viewMode: "list" | "kanban";
  globalTodos: GlobalTodoInfo[];

  setScope: (scope: "agent" | "group", id: string) => void;
  setTodos: (todos: TodoItemData[]) => void;
  addTodo: (todo: TodoItemData) => void;
  updateTodo: (id: string, updates: Partial<TodoItemData>) => void;
  removeTodo: (id: string) => void;
  setLoading: (loading: boolean) => void;
  setViewMode: (mode: "list" | "kanban") => void;
  setGlobalTodos: (todos: GlobalTodoInfo[]) => void;
  toggleSelect: (id: string) => void;
  selectAll: () => void;
  clearSelection: () => void;
  getUpcoming: (withinMinutes?: number) => TodoItemData[];
}

export const useTodoStore = create<TodoStore>((set, get) => ({
  todos: [],
  loading: false,
  scope: "agent",
  scopeId: null,
  selectedIds: new Set(),
  viewMode: "list",
  globalTodos: [],

  setGlobalTodos: (todos) => set({ globalTodos: todos }),

  setScope: (scope, id) => set({ scope, scopeId: id, todos: [], selectedIds: new Set() }),
  setTodos: (todos) => set({ todos }),
  addTodo: (todo) => set((s) => ({ todos: [...s.todos, todo] })),
  updateTodo: (id, updates) =>
    set((s) => ({
      todos: s.todos.map((t) => (t.id === id ? { ...t, ...updates } : t)),
    })),
  removeTodo: (id) =>
    set((s) => ({ todos: s.todos.filter((t) => t.id !== id) })),
  setLoading: (loading) => set({ loading }),
  setViewMode: (viewMode) => set({ viewMode }),

  toggleSelect: (id) =>
    set((s) => {
      const next = new Set(s.selectedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { selectedIds: next };
    }),

  selectAll: () =>
    set((s) => {
      const ids = s.todos.map((t) => t.id);
      // toggle: if already all selected, deselect all
      if (ids.length > 0 && ids.every((id) => s.selectedIds.has(id))) {
        return { selectedIds: new Set() };
      }
      return { selectedIds: new Set(ids) };
    }),

  clearSelection: () => set({ selectedIds: new Set() }),

  getUpcoming: (withinMinutes = 30) => {
    const now = Date.now();
    const threshold = now + withinMinutes * 60 * 1000;
    return get().todos.filter((t) => {
      if (t.status === "completed") return false;
      const triggerTime = new Date(t.triggerAt).getTime();
      return triggerTime > now && triggerTime <= threshold;
    });
  },
}));
