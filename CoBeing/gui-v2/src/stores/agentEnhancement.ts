import { create } from "zustand";
import type { AgentCapabilityCard, AgentTaskInboxItem, AgentGrowthProposal } from "@/lib/types";
import { getWsClient } from "@/hooks/useWebSocket";

interface AgentEnhancementState {
  capabilities: Record<string, AgentCapabilityCard | null>;
  inboxes: Record<string, { active: AgentTaskInboxItem[]; archived: AgentTaskInboxItem[] }>;
  proposals: Record<string, AgentGrowthProposal[]>;
  loading: Record<string, boolean>;

  fetchCapability: (agentId: string) => void;
  fetchInbox: (agentId: string) => void;
  fetchProposals: (agentId: string) => void;
  setCapability: (agentId: string, capability: AgentCapabilityCard | null) => void;
  setInbox: (agentId: string, active: AgentTaskInboxItem[], archived: AgentTaskInboxItem[]) => void;
  setProposals: (agentId: string, proposals: AgentGrowthProposal[]) => void;
  approveProposal: (agentId: string, proposalId: string) => void;
  rejectProposal: (agentId: string, proposalId: string) => void;
}

export const useAgentEnhancementStore = create<AgentEnhancementState>((set) => ({
  capabilities: {},
  inboxes: {},
  proposals: {},
  loading: {},

  fetchCapability: (agentId) => {
    set((s) => ({ loading: { ...s.loading, [`cap_${agentId}`]: true } }));
    getWsClient()?.send({ type: "get_agent_capability", payload: { agentId } });
  },

  fetchInbox: (agentId) => {
    set((s) => ({ loading: { ...s.loading, [`inbox_${agentId}`]: true } }));
    getWsClient()?.send({ type: "get_agent_inbox", payload: { agentId } });
  },

  fetchProposals: (agentId) => {
    set((s) => ({ loading: { ...s.loading, [`prop_${agentId}`]: true } }));
    getWsClient()?.send({ type: "get_agent_proposals", payload: { agentId } });
  },

  setCapability: (agentId, capability) => {
    set((s) => ({
      capabilities: { ...s.capabilities, [agentId]: capability },
      loading: { ...s.loading, [`cap_${agentId}`]: false },
    }));
  },

  setInbox: (agentId, active, archived) => {
    set((s) => ({
      inboxes: { ...s.inboxes, [agentId]: { active, archived } },
      loading: { ...s.loading, [`inbox_${agentId}`]: false },
    }));
  },

  setProposals: (agentId, proposals) => {
    set((s) => ({
      proposals: { ...s.proposals, [agentId]: proposals },
      loading: { ...s.loading, [`prop_${agentId}`]: false },
    }));
  },

  approveProposal: (agentId, proposalId) => {
    getWsClient()?.send({ type: "approve_proposal", payload: { agentId, proposalId } });
  },

  rejectProposal: (agentId, proposalId) => {
    getWsClient()?.send({ type: "reject_proposal", payload: { agentId, proposalId } });
  },
}));
