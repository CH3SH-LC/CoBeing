import { create } from "zustand";
import type { AgentInfo, AgentDetail, WorkspaceBinding } from "@/lib/types";

interface AgentsStore {
  agents: AgentInfo[];
  selectedAgent: string | null;
  agentDetail: AgentDetail | null;

  setAgents: (agents: AgentInfo[]) => void;
  selectAgent: (id: string | null) => void;
  setAgentDetail: (detail: AgentDetail | null) => void;
  updateAgentBindings: (agentId: string, bindings: WorkspaceBinding[]) => void;
}

export const useAgentsStore = create<AgentsStore>((set) => ({
  agents: [],
  selectedAgent: null,
  agentDetail: null,

  setAgents: (agents) => set({ agents }),
  selectAgent: (id) => set({ selectedAgent: id }),
  setAgentDetail: (detail) => set({ agentDetail: detail }),
  updateAgentBindings: (agentId, bindings) => set((s) => ({
    agents: s.agents.map(a => a.id === agentId ? { ...a, bindings } : a),
  })),
}));
