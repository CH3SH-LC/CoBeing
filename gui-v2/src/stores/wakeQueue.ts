import { create } from "zustand";

export interface WakeQueueEntry {
  targetAgentId: string;
  triggerMsgId: string;
  triggerTag: string;
  triggerContents: string[];
}

export interface GroupWakeQueue {
  groupId: string;
  groupName: string;
  queue: WakeQueueEntry[];
  processing: string | null;
}

export interface ActiveAgent {
  agentId: string;
  agentName: string;
  status: string;
  groupId?: string;
}

interface WakeQueueStore {
  queues: Record<string, GroupWakeQueue>;
  activeAgents: ActiveAgent[];
  setQueues: (queues: Record<string, GroupWakeQueue>) => void;
  setActiveAgents: (agents: ActiveAgent[]) => void;
  updateQueue: (groupId: string, queue: WakeQueueEntry[], processing: string | null, groupName?: string) => void;
  clear: () => void;
}

export const useWakeQueueStore = create<WakeQueueStore>((set) => ({
  queues: {},
  activeAgents: [],

  setQueues: (queues) => set({ queues }),
  setActiveAgents: (activeAgents) => set({ activeAgents }),

  updateQueue: (groupId, queue, processing, groupName) =>
    set((s) => {
      const existing = s.queues[groupId];
      return {
        queues: {
          ...s.queues,
          [groupId]: {
            groupId,
            groupName: groupName || existing?.groupName || groupId,
            queue,
            processing,
          },
        },
      };
    }),

  clear: () => set({ queues: {}, activeAgents: [] }),
}));
