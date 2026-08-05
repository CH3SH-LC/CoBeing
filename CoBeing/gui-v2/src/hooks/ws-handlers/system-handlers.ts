import { useChatStore } from "@/stores/chat";
import { emitActivity } from "./helpers";
import type { WsHandlerContext, WsMessageHandler } from "./types";

export function buildSystemHandlers(ctx: WsHandlerContext): Record<string, WsMessageHandler> {
  const {
    stateRetryCount,
    setConnected,
    addMessage,
    send,
  } = ctx;

  return {
    _connected: () => {
      setConnected(true);
      stateRetryCount.current = 0;
      send({ type: "get_state" });
      send({ type: "get_config" });
      send({ type: "list_plugins" });
      send({ type: "get_chat_current" });
      // Fallback: if chat_current never arrives, force currentLoaded after 8s
      // so saves can still proceed (avoid permanent save blockage)
      setTimeout(() => {
        const s = useChatStore.getState();
        if (!s.currentLoaded) {
          useChatStore.setState({ currentLoaded: true });
        }
      }, 8000);
    },

    _disconnected: () => {
      setConnected(false);
    },

    log: (msg) => {
      window.dispatchEvent(new CustomEvent("ws-log", { detail: msg }));
    },

    log_entry: (msg) => {
      window.dispatchEvent(new CustomEvent("ws-log", { detail: msg }));
    },

    server_shutting_down: () => {
      // Backend is about to stop — flush save immediately before WS closes
      const snapshot = useChatStore.getState().messageStore;
      if (Object.keys(snapshot).length > 0) {
        send({
          type: "save_chat_current",
          payload: { conversations: snapshot },
        });
      }
    },

    error: (msg) => {
      const p = msg.payload as { message: string };
      emitActivity("❌", `错误: ${p.message}`, "error");
      addMessage({
        direction: "system",
        content: `Error: ${p.message}`,
        timestamp: Date.now(),
      });
      // 广播给关注错误的具体组件（如技能执行面板）捕获展示
      window.dispatchEvent(new CustomEvent("ws-error", { detail: msg }));
    },
  };
}
