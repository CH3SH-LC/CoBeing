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
  // Per-conversation unread counts
  unreadCounts: Record<string, number>;
  // Whether current.md has been loaded
  currentLoaded: boolean;

  setActiveConversation: (id: string | null) => void;
  addMessage: (msg: LogMessage, conversationId?: string) => void;
  addToolEvent: (event: ToolEvent) => void;
  appendStreamToken: (token: string) => void;
  finalizeStream: (content: string, senderId?: string, senderName?: string) => void;
  startWaiting: () => void;
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
  unreadCounts: {},
  currentLoaded: false,

  setActiveConversation: (id) => {
    const store = get().messageStore;
    const newUnread = { ...get().unreadCounts };
    if (id) delete newUnread[id];
    set({
      activeConversation: id,
      messages: id ? (store[id] || []) : [],
      streamBuffer: "",
      waitingForResponse: false,
      toolEvents: [],
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

  appendStreamToken: (token) =>
    set((s) => ({ streamBuffer: s.streamBuffer + token })),

  finalizeStream: (content, senderId?, senderName?) => {
    const state = get();
    const activeId = state.activeConversation;
    if (!activeId) {
      set({ waitingForResponse: false, streamBuffer: "", toolEvents: [] });
      return;
    }

    // Capture pending tool events before clearing
    const capturedTools = state.toolEvents.length > 0 ? [...state.toolEvents] : undefined;

    const finalContent = state.streamBuffer || content;
    const newMsg: LogMessage = {
      direction: "out",
      content: finalContent,
      timestamp: Date.now(),
      senderId: senderId || activeId,
      senderName: senderName,
      toolCalls: capturedTools,
    };

    const store = state.messageStore;
    const existing = store[activeId] || [];
    const updated = [...existing, newMsg];

    set({
      waitingForResponse: false,
      streamBuffer: "",
      toolEvents: [],
      messageStore: { ...store, [activeId]: updated },
      messages: updated,
    });
  },

  startWaiting: () => set({ waitingForResponse: true, streamBuffer: "" }),

  addToolEvent: (event) => {
    set((s) => {
      const idx = event.toolCallId
        ? s.toolEvents.findIndex((te) => te.toolCallId === event.toolCallId)
        : -1;
      if (idx >= 0) {
        const updated = [...s.toolEvents];
        updated[idx] = event;
        return { toolEvents: updated };
      }
      return { toolEvents: [...s.toolEvents, event] };
    });
  },

  clearMessages: (conversationId) => {
    const targetId = conversationId || get().activeConversation;
    if (!targetId) return;

    const store = get().messageStore;
    const newStore = { ...store };
    delete newStore[targetId];

    set({
      messageStore: newStore,
      messages: targetId === get().activeConversation ? [] : get().messages,
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
    // Merge: preserve in-memory conversations not in the loaded data (avoid race overwrite)
    const existing = get().messageStore;
    const messageStore: Record<string, LogMessage[]> = { ...data.conversations };
    for (const [convId, msgs] of Object.entries(existing)) {
      if (!messageStore[convId]) {
        messageStore[convId] = msgs;
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
      unreadCounts: {},
    });
  },
}));
