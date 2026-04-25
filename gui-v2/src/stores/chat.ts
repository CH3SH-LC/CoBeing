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
  finalizeStream: (content: string) => void;
  startWaiting: () => void;
  clearMessages: (conversationId?: string) => void;
  getMessages: (conversationId: string) => LogMessage[];
  loadFromCurrent: (data: { conversations: Record<string, LogMessage[]> }) => void;
  getCurrentSnapshot: () => Record<string, LogMessage[]>;
  clearAllConversations: () => void;
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

    const store = get().messageStore;
    const existing = store[targetId] || [];
    const updated = [...existing, msg];

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

  finalizeStream: (content) => {
    const state = get();
    const activeId = state.activeConversation;
    if (!activeId) {
      set({ waitingForResponse: false, streamBuffer: "" });
      return;
    }

    const finalContent = state.streamBuffer || content;
    const newMsg: LogMessage = {
      direction: "out",
      content: finalContent,
      timestamp: Date.now(),
    };

    const store = state.messageStore;
    const existing = store[activeId] || [];
    const updated = [...existing, newMsg];

    set({
      waitingForResponse: false,
      streamBuffer: "",
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

  loadFromCurrent: (data) => {
    if (!data.conversations) return;
    const messageStore = { ...data.conversations };
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
