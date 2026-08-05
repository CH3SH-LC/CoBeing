import { create } from "zustand";
import type { ButlerTaskSummary } from "@/lib/types";

function computeSummary(tasks: ButlerTaskSummary[]) {
  return {
    running: tasks.filter((t) => t.status === "running").length,
    waitingUser: tasks.filter((t) => t.status === "waiting_user").length,
    completed: tasks.filter((t) => t.status === "completed").length,
  };
}

interface ButlerTasksState {
  tasks: ButlerTaskSummary[];
  loading: boolean;
  summary: {
    running: number;
    waitingUser: number;
    completed: number;
  };

  setTasks: (tasks: ButlerTaskSummary[]) => void;
  /** 按 id 合并/追加单条管家任务(由 butler_task_updated 事件驱动) */
  upsertTask: (task: Partial<ButlerTaskSummary> & Pick<ButlerTaskSummary, "id">) => void;
  setLoading: (loading: boolean) => void;
  updateSummary: () => void;
  getByStatus: (status: ButlerTaskSummary["status"]) => ButlerTaskSummary[];
}

export const useButlerTasksStore = create<ButlerTasksState>((set, get) => ({
  tasks: [],
  loading: false,
  summary: { running: 0, waitingUser: 0, completed: 0 },

  setTasks: (tasks) => {
    set({ tasks, summary: computeSummary(tasks) });
  },

  upsertTask: (task) => {
    set((s) => {
      const existing = s.tasks.find((t) => t.id === task.id);
      const tasks = existing
        ? s.tasks.map((t) => (t.id === task.id ? { ...t, ...task } : t))
        : [...s.tasks, task as ButlerTaskSummary];
      return { tasks, summary: computeSummary(tasks) };
    });
  },

  setLoading: (loading) => set({ loading }),

  updateSummary: () => {
    set({ summary: computeSummary(get().tasks) });
  },

  getByStatus: (status) => {
    return get().tasks.filter((t) => t.status === status);
  },
}));
