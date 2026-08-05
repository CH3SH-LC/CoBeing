import { useEffect, useRef } from "react";
import { WsClient } from "@/lib/ws-client";
import type { WsMessage } from "@/lib/types";
import { useSettingsStore } from "@/stores/settings";
import { useAgentsStore } from "@/stores/agents";
import { useGroupsStore } from "@/stores/groups";
import { useChatStore } from "@/stores/chat";
import { useTrayStore } from "@/stores/tray";
import { useConfigStore } from "@/stores/config";
import { useTodoStore } from "@/stores/todo";
import { buildChatHandlers } from "./ws-handlers/chat-handlers";
import { buildRegistryHandlers } from "./ws-handlers/registry-handlers";
import { buildExtensionHandlers } from "./ws-handlers/extension-handlers";
import { buildTodoHandlers } from "./ws-handlers/todo-handlers";
import { buildSystemHandlers } from "./ws-handlers/system-handlers";
import { buildObservabilityHandlers } from "./ws-handlers/observability-handlers";
import { buildMarketHandlers } from "./ws-handlers/market-handlers";
import { buildButlerTaskHandlers } from "./ws-handlers/butler-task-handlers";
import { buildOnboardingHandlers } from "./ws-handlers/onboarding-handlers";
import type { WsHandlerContext, WsMessageHandler } from "./ws-handlers/types";

let wsClient: WsClient | null = null;

function buildWsUrl(): string {
  const token = (window as any).__COBEING_WS_TOKEN__ || "";
  const base = "ws://127.0.0.1:18765";
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
}

export function useWebSocket(url = buildWsUrl()) {
  const initialized = useRef(false);
  const stateRetryCount = useRef(0);
  const stateRetryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamStartedRef = useRef(false);

  const setConnected = useSettingsStore((s) => s.setConnected);
  const setAgents = useAgentsStore((s) => s.setAgents);
  const setGroups = useGroupsStore((s) => s.setGroups);
  const addMessage = useChatStore((s) => s.addMessage);
  const addToolEvent = useChatStore((s) => s.addToolEvent);
  const appendStreamToken = useChatStore((s) => s.appendStreamToken);
  const finalizeStream = useChatStore((s) => s.finalizeStream);
  const startWaiting = useChatStore((s) => s.startWaiting);
  const finishWaiting = useChatStore((s) => s.finishWaiting);
  const loadFromCurrent = useChatStore((s) => s.loadFromCurrent);
  const clearMessages = useChatStore((s) => s.clearMessages);
  const incrementUnread = useTrayStore((s) => s.incrementUnread);
  const setConfig = useConfigStore((s) => s.setConfig);
  const setTodos = useTodoStore((s) => s.setTodos);

  const updateMsgStatus = (convId: string, status: "sent" | "streaming" | "done" | "error", errorMessage?: string) => {
    useChatStore.getState().updateLastInMessage(convId, { status, errorMessage });
  };

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const ctx: WsHandlerContext = {
      streamStartedRef,
      stateRetryCount,
      stateRetryTimer,
      setConnected,
      setAgents,
      setGroups,
      addMessage,
      addToolEvent,
      appendStreamToken,
      finalizeStream,
      startWaiting,
      finishWaiting,
      loadFromCurrent,
      clearMessages,
      setTodos,
      setConfig,
      updateMsgStatus,
      send: (msg) => wsClient?.send(msg),
    };

    const handlers: Record<string, WsMessageHandler> = {
      ...buildChatHandlers(ctx),
      ...buildRegistryHandlers(ctx),
      ...buildExtensionHandlers(ctx),
      ...buildTodoHandlers(ctx),
      ...buildSystemHandlers(ctx),
      ...buildObservabilityHandlers(ctx),
      ...buildMarketHandlers(ctx),
      ...buildButlerTaskHandlers(ctx),
      ...buildOnboardingHandlers(ctx),
    };

    wsClient = new WsClient(url, (msg: WsMessage) => {
      const handler = handlers[msg.type];
      if (handler) handler(msg);
    });

    wsClient.connect();

    return () => {
      if (stateRetryTimer.current) clearTimeout(stateRetryTimer.current);
      wsClient?.disconnect();
      wsClient = null;
      initialized.current = false;
    };
  }, [url, setConnected, setAgents, setGroups, addMessage, appendStreamToken, finalizeStream, startWaiting, finishWaiting, loadFromCurrent, clearMessages, incrementUnread, setConfig]);
}

export function getWsClient(): WsClient | null {
  return wsClient;
}
