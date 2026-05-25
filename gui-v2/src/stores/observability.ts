import { create } from "zustand";
import type { DashboardData } from "@/lib/types";

interface ObservabilityStore {
  dashboard: DashboardData | null;
  groupFilter: string | undefined;
  loading: boolean;
  setDashboard: (data: DashboardData) => void;
  setGroupFilter: (groupId: string | undefined) => void;
  setLoading: (v: boolean) => void;
}

export const useObservabilityStore = create<ObservabilityStore>((set) => ({
  dashboard: null,
  groupFilter: undefined,
  loading: false,
  setDashboard: (data) => set({ dashboard: data, loading: false }),
  setGroupFilter: (groupId) => set({ groupFilter: groupId }),
  setLoading: (v) => set({ loading: v }),
}));
