import { create } from "zustand";
import type { AgentInfo, AgentDetail } from "@/lib/types";

interface AgentsStore {
  agents: AgentInfo[];
  selectedAgent: string | null;
  agentDetail: AgentDetail | null;

  setAgents: (agents: AgentInfo[]) => void;
  selectAgent: (id: string | null) => void;
  setAgentDetail: (detail: AgentDetail | null) => void;
}

export const useAgentsStore = create<AgentsStore>((set) => ({
  agents: [],
  selectedAgent: null,
  agentDetail: null,

  setAgents: (agents) => set({ agents }),
  selectAgent: (id) => set({ selectedAgent: id }),
  setAgentDetail: (detail) => set({ agentDetail: detail }),
}));
