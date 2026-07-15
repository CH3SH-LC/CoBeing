import { useEffect, useRef } from "react";
import { useChatStore } from "@/stores/chat";
import { getWsClient } from "@/hooks/useWebSocket";

/** Auto-save chat history to memory/current.md after changes */
export function useChatPersistence() {
  const messageStore = useChatStore((s) => s.messageStore);
  const streamBuffer = useChatStore((s) => s.streamBuffer);
  const waitingForResponse = useChatStore((s) => s.waitingForResponse);
  const currentLoaded = useChatStore((s) => s.currentLoaded);

  // Debounce saves during active streaming (tokens arrive rapidly)
  // Otherwise save immediately to avoid data loss on close
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!currentLoaded) return;

    // During streaming, debounce to avoid excessive saves
    if (waitingForResponse || streamBuffer.length > 0) {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        flushSave();
      }, 300);
      return () => {
        if (timerRef.current) clearTimeout(timerRef.current);
      };
    }

    // Idle: save immediately when messageStore changes
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      flushSave();
    }, 0);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [messageStore, currentLoaded, waitingForResponse, streamBuffer]);

  // Flush on unmount
  useEffect(() => {
    const handler = () => {
      const ws = getWsClient();
      if (ws?.connected) {
        const snapshot = useChatStore.getState().messageStore;
        ws.send({
          type: "save_chat_current",
          payload: { conversations: snapshot },
        });
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => {
      window.removeEventListener("beforeunload", handler);
      // Flush pending save on unmount
      if (timerRef.current) clearTimeout(timerRef.current);
      const ws = getWsClient();
      if (ws?.connected) {
        const snapshot = useChatStore.getState().messageStore;
        ws.send({
          type: "save_chat_current",
          payload: { conversations: snapshot },
        });
      }
    };
  }, []);
}

function flushSave() {
  const ws = getWsClient();
  if (!ws?.connected) return;
  const snapshot = useChatStore.getState().messageStore;
  if (Object.keys(snapshot).length === 0) return;
  ws.send({
    type: "save_chat_current",
    payload: { conversations: snapshot },
  });
}

/** Clear current conversation and start fresh (per-conversation only) */
export function startNewConversation(conversationId?: string) {
  const store = useChatStore.getState();
  const convId = conversationId || store.activeConversation;
  if (!convId) return;
  store.clearMessages(convId);
  const ws = getWsClient();
  if (ws) {
    ws.send({ type: "clear_chat_current", payload: { conversationId: convId } });
  }
}
