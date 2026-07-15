import { create } from "zustand";
import type { LogMessage, ToolEvent } from "@/lib/types";

interface ChatStore {
  // Per-conversation message storage: conversationId → messages
  messageStore: Record<string, LogMessage[]>;
  // Current active conversation (agentId or groupId)
  activeConversation: string | null;
  // Current displayed messages (derived from messageStore[activeConversation])
  messages: LogMessage[];
  streamBuffer: string;
  waitingForResponse: boolean;
  toolEvents: ToolEvent[];
  streamBuffers: Record<string, string>;
  waitingByConversation: Record<string, boolean>;
  toolEventsByConversation: Record<string, ToolEvent[]>;
  // Per-conversation unread counts
  unreadCounts: Record<string, number>;
  // Whether current.md has been loaded
  currentLoaded: boolean;

  setActiveConversation: (id: string | null) => void;
  addMessage: (msg: LogMessage, conversationId?: string) => void;
  addToolEvent: (event: ToolEvent, conversationId?: string) => void;
  appendStreamToken: (token: string, conversationId?: string) => void;
  finalizeStream: (content: string, senderId?: string, senderName?: string, conversationId?: string) => void;
  startWaiting: (conversationId?: string) => void;
  finishWaiting: (conversationId?: string) => void;
  clearMessages: (conversationId?: string) => void;
  getMessages: (conversationId: string) => LogMessage[];
  loadFromCurrent: (data: { conversations: Record<string, LogMessage[]> }, agentsSnapshot?: Array<{ id: string; name: string }>) => void;
  getCurrentSnapshot: () => Record<string, LogMessage[]>;
  clearAllConversations: () => void;
  /** Update last user message's status in the active conversation */
  updateLastInMessage: (convId: string, update: Partial<Pick<LogMessage, 'status' | 'errorMessage'>>) => void;
  prependMessages: (msgs: LogMessage[], conversationId?: string) => void;
  hasMoreMessages: Record<string, boolean>;
  setHasMore: (conversationId: string, hasMore: boolean) => void;
}

export const useChatStore = create<ChatStore>((set, get) => ({
  messageStore: {},
  activeConversation: null,
  messages: [],
  streamBuffer: "",
  waitingForResponse: false,
  toolEvents: [],
  streamBuffers: {},
  waitingByConversation: {},
  toolEventsByConversation: {},
  unreadCounts: {},
  currentLoaded: false,

  setActiveConversation: (id) => {
    const store = get().messageStore;
    const newUnread = { ...get().unreadCounts };
    if (id) delete newUnread[id];
    set({
      activeConversation: id,
      messages: id ? (store[id] || []) : [],
      streamBuffer: id ? (get().streamBuffers[id] || "") : "",
      waitingForResponse: id ? !!get().waitingByConversation[id] : false,
      toolEvents: id ? (get().toolEventsByConversation[id] || []) : [],
      unreadCounts: newUnread,
    });
  },

    addMessage: (msg, conversationId) => {
    const targetId = conversationId || get().activeConversation;
    if (!targetId) return;

    // Auto-set senderId: user messages get "user" (unless senderName is preset, e.g. channel msgs)
    // Outbound messages use the conversation id as fallback
    if (!msg.senderId) {
      msg.senderId = (msg.direction === "in" && !msg.senderName) ? "user" : targetId;
    }

    const MAX_KEEP = 500;
    const store = get().messageStore;
    const existing = store[targetId] || [];

    // Dedup: skip exact duplicates (same direction+senderId+content+timestamp) — rare genuine dupes from double broadcast
    const isDuplicate = existing.length > 0 && msg.content && existing.some(m =>
      m.direction === msg.direction &&
      m.content === msg.content &&
      m.senderId === msg.senderId &&
      m.timestamp === msg.timestamp
    );
    if (isDuplicate) return;

    const updated = existing.length >= MAX_KEEP
      ? [...existing.slice(-MAX_KEEP + 1), msg]
      : [...existing, msg];

    const isActive = targetId === get().activeConversation;
    const shouldCount = !isActive && (msg.direction === "out" || msg.direction === "system");
    const unreadCounts = { ...get().unreadCounts };

    set({
      messageStore: { ...store, [targetId]: updated },
      messages: isActive ? updated : get().messages,
      unreadCounts: shouldCount
        ? { ...unreadCounts, [targetId]: (unreadCounts[targetId] || 0) + 1 }
        : unreadCounts,
    });
  },

  appendStreamToken: (token, conversationId) =>
    set((s) => {
      const targetId = conversationId || s.activeConversation;
      if (!targetId) return {};
      const streamBuffers = { ...s.streamBuffers, [targetId]: (s.streamBuffers[targetId] || "") + token };
      return {
        streamBuffers,
        streamBuffer: targetId === s.activeConversation ? streamBuffers[targetId] : s.streamBuffer,
      };
    }),

  finalizeStream: (content, senderId?, senderName?, conversationId?) => {
    const state = get();
    const targetId = conversationId || state.activeConversation;
    if (!targetId) {
      set({ waitingForResponse: false, streamBuffer: "", toolEvents: [] });
      return;
    }

    // Capture pending tool events before clearing
    const targetTools = state.toolEventsByConversation[targetId] || [];
    const capturedTools = targetTools.length > 0 ? [...targetTools] : undefined;

    // Use stream buffer first (has ALL rounds' text); agent_response content as fallback
    const streamContent = state.streamBuffers[targetId] || "";
    // When stream buffer is empty but waiting state was already cleared (e.g. startWaiting
    // interrupted an earlier request), the content from agent_response may be a duplicate.
    // If there's active waiting state, the stream buffer is authoritative; otherwise prefer
    // agent_response content but guard against duplicates.
    const hasActiveWaiting = !!state.waitingByConversation[targetId];
    const finalContent = hasActiveWaiting
      ? (streamContent || content)
      : content;  // No active waiting → use agent_response content directly
    // Guard: skip empty messages
    if (!finalContent && (!capturedTools || capturedTools.length === 0)) return;
    // Guard: skip if this would create a duplicate of the last saved message
    const store = state.messageStore;
    const existing = store[targetId] || [];
    if (existing.length > 0) {
      const last = existing[existing.length - 1];
      if (last.direction === "out" && last.content === finalContent) return;
    }
    const newMsg: LogMessage = {
      direction: "out",
      content: finalContent,
      timestamp: Date.now(),
      senderId: senderId || targetId,
      senderName: senderName || senderId || targetId,
      toolCalls: capturedTools && capturedTools.length > 0 ? capturedTools : undefined,
    };

    const updated = [...existing, newMsg];
    const streamBuffers = { ...state.streamBuffers };
    const waitingByConversation = { ...state.waitingByConversation };
    const toolEventsByConversation = { ...state.toolEventsByConversation };
    delete streamBuffers[targetId];
    delete waitingByConversation[targetId];
    delete toolEventsByConversation[targetId];
    const isActive = targetId === state.activeConversation;

    // Check if any other conversation is still waiting (for correct waitingForResponse)
    const otherWaiting = Object.keys(waitingByConversation).length > 0;

    set({
      waitingByConversation,
      streamBuffers,
      toolEventsByConversation,
      waitingForResponse: isActive ? otherWaiting : state.waitingForResponse,
      streamBuffer: isActive ? (streamBuffers[state.activeConversation ?? ""] ?? "") : state.streamBuffer,
      toolEvents: isActive ? (toolEventsByConversation[state.activeConversation ?? ""] ?? []) : state.toolEvents,
      messageStore: { ...store, [targetId]: updated },
      messages: isActive ? updated : state.messages,
    });
  },

  startWaiting: (conversationId) => {
    const state = get();
    const targetId = conversationId || state.activeConversation;
    if (!targetId) return;
    // If there's pending unfinalized stream content from a previous response,
    // finalize it as a partial message before starting fresh.
    // This preserves pre-tool-call text even if agent_response never arrives.
    if (state.streamBuffers[targetId] && state.waitingByConversation[targetId]) {
      const savedBuffer = state.streamBuffers[targetId];
      const savedTools = state.toolEventsByConversation[targetId] || [];
      if (savedBuffer.trim() || savedTools.length > 0) {
        get().finalizeStream(savedBuffer, targetId, undefined, targetId);
      } else {
        get().finishWaiting(targetId);
      }
    }
    set((s) => ({
      waitingByConversation: { ...s.waitingByConversation, [targetId]: true },
      streamBuffers: { ...s.streamBuffers, [targetId]: "" },
      waitingForResponse: targetId === s.activeConversation ? true : s.waitingForResponse,
      streamBuffer: targetId === s.activeConversation ? "" : s.streamBuffer,
    }));
    // Safety timeout: auto-clear waiting state after 1 minute if no response arrives.
    // Reduced from 5min — loadFromCurrent also auto-clears on reconnect, so this is a last resort.
    setTimeout(() => {
      const cur = get();
      if (cur.waitingByConversation[targetId]) {
        get().finishWaiting(targetId);
      }
    }, 60_000);
  },

  finishWaiting: (conversationId) => set((s) => {
    const targetId = conversationId || s.activeConversation;
    if (!targetId) return {};
    const waitingByConversation = { ...s.waitingByConversation };
    const streamBuffers = { ...s.streamBuffers };
    delete waitingByConversation[targetId];
    delete streamBuffers[targetId];
    return {
      waitingByConversation,
      streamBuffers,
      waitingForResponse: targetId === s.activeConversation ? false : s.waitingForResponse,
      streamBuffer: targetId === s.activeConversation ? "" : s.streamBuffer,
    };
  }),

  addToolEvent: (event, conversationId) => {
    set((s) => {
      const targetId = conversationId || s.activeConversation;
      if (!targetId) return {};
      const current = s.toolEventsByConversation[targetId] || [];
      // Dedup: prefer toolCallId match, fall back to toolName match for start events
      let idx = -1;
      if (event.toolCallId) {
        idx = current.findIndex((te) => te.toolCallId === event.toolCallId);
      }
      // For "start" events without toolCallId, find by toolName + status "start"
      if (idx < 0 && event.status === "start" && !event.toolCallId) {
        idx = current.findIndex((te) => te.toolName === event.toolName && te.status === "start");
      }
      let updated: ToolEvent[];
      if (idx >= 0) {
        updated = [...current];
        updated[idx] = { ...updated[idx], ...event, toolCallId: event.toolCallId || updated[idx].toolCallId };
      } else {
        updated = [...current, event];
      }
      return {
        toolEventsByConversation: { ...s.toolEventsByConversation, [targetId]: updated },
        toolEvents: targetId === s.activeConversation ? updated : s.toolEvents,
      };
    });
  },

  clearMessages: (conversationId) => {
    const targetId = conversationId || get().activeConversation;
    if (!targetId) return;

    const store = get().messageStore;
    const newStore = { ...store };
    const streamBuffers = { ...get().streamBuffers };
    const waitingByConversation = { ...get().waitingByConversation };
    const toolEventsByConversation = { ...get().toolEventsByConversation };
    delete newStore[targetId];
    delete streamBuffers[targetId];
    delete waitingByConversation[targetId];
    delete toolEventsByConversation[targetId];

    set({
      messageStore: newStore,
      streamBuffers,
      waitingByConversation,
      toolEventsByConversation,
      messages: targetId === get().activeConversation ? [] : get().messages,
      streamBuffer: targetId === get().activeConversation ? "" : get().streamBuffer,
      waitingForResponse: targetId === get().activeConversation ? false : get().waitingForResponse,
      toolEvents: targetId === get().activeConversation ? [] : get().toolEvents,
    });
  },

  getMessages: (conversationId) => {
    return get().messageStore[conversationId] || [];
  },

  loadFromCurrent: (data, agentsSnapshot) => {
    // Always mark as loaded (even if empty) so saves can proceed
    if (!data.conversations) {
      set({ currentLoaded: true });
      return;
    }
    // Merge: preserve in-memory conversations not in the loaded data (avoid race overwrite).
    // Also preserve in-memory when waitingByConversation is set — the agent is mid-execution
    // and persisted data may be stale (missing the just-finalized message from agent_completed).
    const existing = get().messageStore;
    const waiting = get().waitingByConversation;
    const messageStore: Record<string, LogMessage[]> = { ...data.conversations };
    for (const [convId, msgs] of Object.entries(existing)) {
      if (!messageStore[convId]) {
        // Entire conversation missing in persisted data — use in-memory
        messageStore[convId] = msgs;
      } else if (waiting[convId]) {
        // Agent is mid-execution; persisted data may be stale.
        // Prefer in-memory which may have been updated by agent_completed handler.
        messageStore[convId] = msgs;
      }
    }

    // Auto-clear waiting state for conversations whose last message is an outbound
    // response in persisted data (agent already completed, but agent_completed broadcast
    // was missed due to reconnect timing).
    const clearedWaiting = { ...waiting };
    for (const [convId, msgs] of Object.entries(messageStore)) {
      if (clearedWaiting[convId] && msgs.length > 0) {
        const lastMsg = msgs[msgs.length - 1];
        if (lastMsg.direction === "out") {
          delete clearedWaiting[convId];
        }
      }
    }

    // Backward compat: fixup messages missing senderId/senderName (saved before fix)
    for (const [convId, msgs] of Object.entries(messageStore)) {
      messageStore[convId] = msgs.map((m: LogMessage) => {
        // Already fully annotated
        if (m.senderName) return m;
        // Set missing senderId
        if (!m.senderId) {
          m.senderId = m.direction === "in" ? "user" : convId;
        }
        // Resolve senderName for outbound agent messages from known agents
        if (m.direction === "out" && m.senderId !== "user" && agentsSnapshot) {
          const agent = agentsSnapshot.find((a) => a.id === m.senderId);
          if (agent?.name) {
            return { ...m, senderName: agent.name };
          }
        }
        return m;
      });
    }
    const activeConv = get().activeConversation;
    set({
      messageStore,
      waitingByConversation: clearedWaiting,
      waitingForResponse: activeConv ? !!clearedWaiting[activeConv] : false,
      messages: activeConv ? (messageStore[activeConv] || []) : [],
      currentLoaded: true,
    });
  },

  getCurrentSnapshot: () => {
    return { ...get().messageStore };
  },

  hasMoreMessages: {},

  updateLastInMessage: (convId, update) => {
    const store = get().messageStore;
    const msgs = store[convId];
    if (!msgs || msgs.length === 0) return;
    // Find last user message that's still pending
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].direction === "in" && (!msgs[i].status || msgs[i].status === "sending" || msgs[i].status === "sent" || msgs[i].status === "streaming")) {
        const updated = [...msgs];
        updated[i] = { ...updated[i], ...update };
        const newStore = { ...store, [convId]: updated };
        set({
          messageStore: newStore,
          messages: convId === get().activeConversation ? updated : get().messages,
        });
        return;
      }
    }
  },

  prependMessages: (msgs, conversationId) => {
    const targetId = conversationId || get().activeConversation;
    if (!targetId || msgs.length === 0) return;
    const store = get().messageStore;
    const existing = store[targetId] || [];
    // Deduplicate by timestamp+content prefix
    const existingKeys = new Set(existing.map(m => `${m.timestamp}-${m.content.slice(0, 50)}`));
    const newMsgs = msgs.filter(m => !existingKeys.has(`${m.timestamp}-${m.content.slice(0, 50)}`));
    if (newMsgs.length === 0) return;
    const updated = [...newMsgs, ...existing];
    const isActive = targetId === get().activeConversation;
    set({
      messageStore: { ...store, [targetId]: updated },
      messages: isActive ? updated : get().messages,
    });
  },

  setHasMore: (conversationId, hasMore) => {
    set({ hasMoreMessages: { ...get().hasMoreMessages, [conversationId]: hasMore } });
  },

  clearAllConversations: () => {
    set({
      messageStore: {},
      messages: [],
      streamBuffer: "",
      waitingForResponse: false,
      toolEvents: [],
      streamBuffers: {},
      waitingByConversation: {},
      toolEventsByConversation: {},
      unreadCounts: {},
    });
  },
}));
