import { useEffect, useRef } from "react";
import { WsClient } from "@/lib/ws-client";
import type { WsMessage, WsStatePayload, WsMessagePayload } from "@/lib/types";
import { useSettingsStore } from "@/stores/settings";
import { useAgentsStore } from "@/stores/agents";
import { useGroupsStore } from "@/stores/groups";
import { useChatStore } from "@/stores/chat";
import { useTrayStore } from "@/stores/tray";
import { useConfigStore } from "@/stores/config";
import { sendNotification } from "@/hooks/useTray";

let wsClient: WsClient | null = null;

export function useWebSocket(url = "ws://localhost:18765") {
  const initialized = useRef(false);

  const setConnected = useSettingsStore((s) => s.setConnected);
  const setAgents = useAgentsStore((s) => s.setAgents);
  const setGroups = useGroupsStore((s) => s.setGroups);
  const addMessage = useChatStore((s) => s.addMessage);
  const appendStreamToken = useChatStore((s) => s.appendStreamToken);
  const finalizeStream = useChatStore((s) => s.finalizeStream);
  const startWaiting = useChatStore((s) => s.startWaiting);
  const incrementUnread = useTrayStore((s) => s.incrementUnread);
  const setConfig = useConfigStore((s) => s.setConfig);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    wsClient = new WsClient(url, (msg: WsMessage) => {
      switch (msg.type) {
        case "_connected":
          setConnected(true);
          wsClient?.send({ type: "get_state" });
          wsClient?.send({ type: "get_config" });
          break;

        case "_disconnected":
          setConnected(false);
          break;

        case "state": {
          const p = msg.payload as WsStatePayload;
          setAgents(p.agents);
          setGroups(p.groups);
          break;
        }

        case "config": {
          const p = msg.payload as {
            providers?: Record<string, unknown>;
            channels?: Record<string, unknown>;
            mcpServers?: Record<string, unknown>;
          };
          setConfig({
            providers: (p.providers || {}) as any,
            channels: (p.channels || {}) as any,
            mcpServers: (p.mcpServers || {}) as any,
          });
          break;
        }

        case "config_updated": {
          wsClient?.send({ type: "get_config" });
          break;
        }

        case "log": {
          window.dispatchEvent(new CustomEvent("ws-log", { detail: msg }));
          break;
        }

        case "log_entry": {
          window.dispatchEvent(new CustomEvent("ws-log", { detail: msg }));
          break;
        }

        case "message": {
          const p = msg.payload as WsMessagePayload;
          if (p.direction === "in") {
            addMessage({
              direction: "in",
              content: p.content,
              timestamp: p.timestamp,
            });
            startWaiting();
            incrementUnread();
            sendNotification("新消息", p.content.slice(0, 100));
          } else if (p.direction === "out") {
            finalizeStream(p.content);
          } else {
            addMessage({
              direction: "system",
              content: p.content,
              timestamp: p.timestamp,
            });
          }
          break;
        }

        case "stream_token": {
          const p = msg.payload as { token: string };
          appendStreamToken(p.token);
          break;
        }

        case "agent_response": {
          const p = msg.payload as { content: string };
          finalizeStream(p.content);
          break;
        }

        case "error": {
          const p = msg.payload as { message: string };
          addMessage({
            direction: "system",
            content: `Error: ${p.message}`,
            timestamp: Date.now(),
          });
          break;
        }
      }
    });

    wsClient.connect();

    return () => {
      wsClient?.disconnect();
      wsClient = null;
      initialized.current = false;
    };
  }, [url, setConnected, setAgents, setGroups, addMessage, appendStreamToken, finalizeStream, startWaiting, incrementUnread, setConfig]);
}

export function getWsClient(): WsClient | null {
  return wsClient;
}
