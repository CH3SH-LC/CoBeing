import { create } from "zustand";
import type { ButlerTaskSummary } from "@/lib/types";

interface ButlerTasksState {
  tasks: ButlerTaskSummary[];
  loading: boolean;
  summary: {
    running: number;
    waitingUser: number;
    completed: number;
  };

  setTasks: (tasks: ButlerTaskSummary[]) => void;
  setLoading: (loading: boolean) => void;
  updateSummary: () => void;
  getByStatus: (status: ButlerTaskSummary["status"]) => ButlerTaskSummary[];
}

export const useButlerTasksStore = create<ButlerTasksState>((set, get) => ({
  tasks: [],
  loading: false,
  summary: { running: 0, waitingUser: 0, completed: 0 },

  setTasks: (tasks) => {
    set({
      tasks,
      summary: {
        running: tasks.filter((t) => t.status === "running").length,
        waitingUser: tasks.filter((t) => t.status === "waiting_user").length,
        completed: tasks.filter((t) => t.status === "completed").length,
      },
    });
  },

  setLoading: (loading) => set({ loading }),

  updateSummary: () => {
    const { tasks } = get();
    set({
      summary: {
        running: tasks.filter((t) => t.status === "running").length,
        waitingUser: tasks.filter((t) => t.status === "waiting_user").length,
        completed: tasks.filter((t) => t.status === "completed").length,
      },
    });
  },

  getByStatus: (status) => {
    return get().tasks.filter((t) => t.status === status);
  },
}));
