import { create } from "zustand";

export interface TodoItemData {
  id: string;
  title: string;
  description: string;
  status: "pending" | "completed";
  triggerAt: string;
  recurrenceHint: string;
  createdBy: string;
  createdAt: string;
  triggeredAt?: string;
  completedAt?: string;
  agentId?: string;
  targetAgentId?: string;
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

  setScope: (scope: "agent" | "group", id: string) => void;
  setTodos: (todos: TodoItemData[]) => void;
  addTodo: (todo: TodoItemData) => void;
  updateTodo: (id: string, updates: Partial<TodoItemData>) => void;
  removeTodo: (id: string) => void;
  setLoading: (loading: boolean) => void;
}

export const useTodoStore = create<TodoStore>((set) => ({
  todos: [],
  loading: false,
  scope: "agent",
  scopeId: null,

  setScope: (scope, id) => set({ scope, scopeId: id, todos: [] }),
  setTodos: (todos) => set({ todos }),
  addTodo: (todo) => set((s) => ({ todos: [...s.todos, todo] })),
  updateTodo: (id, updates) =>
    set((s) => ({
      todos: s.todos.map((t) => (t.id === id ? { ...t, ...updates } : t)),
    })),
  removeTodo: (id) =>
    set((s) => ({ todos: s.todos.filter((t) => t.id !== id) })),
  setLoading: (loading) => set({ loading }),
}));
