import { useEffect, useRef } from "react";
import { useChatStore } from "@/stores/chat";
import { getWsClient } from "@/hooks/useWebSocket";

/** Auto-save chat history to memory/current.md after changes */
export function useChatPersistence() {
  const messageStore = useChatStore((s) => s.messageStore);
  const currentLoaded = useChatStore((s) => s.currentLoaded);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Don't save until initial load is complete
    if (!currentLoaded) return;

    // Debounce: save 500ms after last change
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const ws = getWsClient();
      if (ws) {
        ws.send({
          type: "save_chat_current",
          payload: { conversations: messageStore },
        });
      }
    }, 500);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [messageStore, currentLoaded]);
}

/** Clear current chat and start fresh */
export function startNewConversation() {
  const store = useChatStore.getState();
  store.clearAllConversations();
  const ws = getWsClient();
  if (ws) {
    ws.send({ type: "clear_chat_current" });
  }
}
