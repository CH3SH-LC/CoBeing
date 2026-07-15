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
  processingAgents?: string[];
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
  updateQueue: (groupId: string, queue: WakeQueueEntry[], processing: string | null, groupName?: string, processingAgents?: string[]) => void;
  clear: () => void;
}

export const useWakeQueueStore = create<WakeQueueStore>((set) => ({
  queues: {},
  activeAgents: [],

  setQueues: (queues) => set({ queues }),
  setActiveAgents: (activeAgents) => set({ activeAgents }),

  updateQueue: (groupId, queue, processing, groupName, processingAgents) =>
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
            processingAgents: processingAgents ?? existing?.processingAgents,
          },
        },
      };
    }),

  clear: () => set({ queues: {}, activeAgents: [] }),
}));
