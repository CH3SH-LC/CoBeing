import { useEffect, useRef } from "react";
import { WsClient } from "@/lib/ws-client";
import type { WsMessage, WsStatePayload, WsMessagePayload, ToolEvent } from "@/lib/types";
import { useSettingsStore } from "@/stores/settings";
import { useAgentsStore } from "@/stores/agents";
import { useGroupsStore } from "@/stores/groups";
import { useChatStore } from "@/stores/chat";
import { useTrayStore } from "@/stores/tray";
import { useConfigStore } from "@/stores/config";
import { useTodoStore } from "@/stores/todo";

let wsClient: WsClient | null = null;

export function useWebSocket(url = "ws://localhost:18765") {
  const initialized = useRef(false);

  const setConnected = useSettingsStore((s) => s.setConnected);
  const setAgents = useAgentsStore((s) => s.setAgents);
  const setGroups = useGroupsStore((s) => s.setGroups);
  const addMessage = useChatStore((s) => s.addMessage);
  const addToolEvent = useChatStore((s) => s.addToolEvent);
  const appendStreamToken = useChatStore((s) => s.appendStreamToken);
  const finalizeStream = useChatStore((s) => s.finalizeStream);
  const startWaiting = useChatStore((s) => s.startWaiting);
  const loadFromCurrent = useChatStore((s) => s.loadFromCurrent);
  const clearMessages = useChatStore((s) => s.clearMessages);
  const incrementUnread = useTrayStore((s) => s.incrementUnread);
  const setConfig = useConfigStore((s) => s.setConfig);
  const setTodos = useTodoStore((s) => s.setTodos);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    wsClient = new WsClient(url, (msg: WsMessage) => {
      switch (msg.type) {
        case "_connected":
          setConnected(true);
          wsClient?.send({ type: "get_state" });
          wsClient?.send({ type: "get_config" });
          wsClient?.send({ type: "get_chat_current" });
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
          // update_config 已经广播了完整的 config，不需要再请求
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
          if (p.direction === "system") {
            addMessage({
              direction: "system",
              content: p.content,
              timestamp: p.timestamp,
            });
          }
          // "out" direction handled by agent_response to avoid duplication.
          // "in" direction (user messages) are added locally in ChatInput.
          break;
        }

        case "stream_token": {
          const p = msg.payload as { token: string };
          appendStreamToken(p.token);
          break;
        }

        case "agent_response": {
          const p = msg.payload as { content: string };
          // 群组消息由 group_message 处理，这里只清状态不加消息
          const activeId = useChatStore.getState().activeConversation;
          const isGroup = useGroupsStore.getState().groups.some(g => g.id === activeId);
          if (isGroup) {
            // 只清等待状态，不添加消息（避免 "assistant" 标签 + 重复）
            useChatStore.setState({ waitingForResponse: false, streamBuffer: "" });
          } else {
            finalizeStream(p.content);
          }
          break;
        }

        case "agent_updated": {
          wsClient?.send({ type: "get_state" });
          break;
        }

        case "agent_files": {
          window.dispatchEvent(new CustomEvent("ws-agent-files", { detail: msg }));
          break;
        }

        case "agent_file_content": {
          window.dispatchEvent(new CustomEvent("ws-agent-file-content", { detail: msg }));
          break;
        }

        case "file_saved": {
          window.dispatchEvent(new CustomEvent("ws-file-saved", { detail: msg }));
          break;
        }

        case "member_added":
        case "member_removed": {
          wsClient?.send({ type: "get_state" });
          break;
        }

        case "group_message": {
          const gm = msg.payload as { groupId: string; fromAgentId: string; content: string; mentions: string[]; timestamp: number };
          addMessage({
            direction: "out",
            content: gm.content,
            timestamp: gm.timestamp,
            senderId: gm.fromAgentId,
          }, gm.groupId);
          break;
        }

        case "channel_message": {
          const cm = msg.payload as { agentId: string; direction: "in" | "out"; content: string; senderName?: string; timestamp: number };
          addMessage({
            direction: cm.direction,
            content: cm.content,
            timestamp: cm.timestamp,
            senderName: cm.direction === "in" ? cm.senderName : undefined,
          }, cm.agentId);
          break;
        }

        case "agent_destroyed": {
          const d = msg.payload as { agentId: string };
          clearMessages(d.agentId);
          // 清除选中状态，关闭详情面板
          useAgentsStore.getState().selectAgent(null);
          useSettingsStore.getState().setDetailPanelOpen(false);
          break;
        }

        case "group_destroyed": {
          const d = msg.payload as { groupId: string };
          clearMessages(d.groupId);
          // 清除选中状态，关闭详情面板
          useGroupsStore.getState().selectGroup(null);
          useSettingsStore.getState().setDetailPanelOpen(false);
          break;
        }

        case "skill_list": {
          window.dispatchEvent(new CustomEvent("ws-skill-list", { detail: msg }));
          break;
        }

        case "skill_result": {
          window.dispatchEvent(new CustomEvent("ws-skill-result", { detail: msg }));
          break;
        }

        case "skill_doc": {
          window.dispatchEvent(new CustomEvent("ws-skill-doc", { detail: msg }));
          break;
        }

        case "tool_event": {
          const te = msg.payload as ToolEvent;
          addToolEvent(te);
          break;
        }

        case "chat_current": {
          const cp = msg.payload as { conversations: Record<string, any[]> };
          if (cp.conversations) {
            // Parse timestamp fields back to numbers
            const parsed: Record<string, any[]> = {};
            for (const [convId, msgs] of Object.entries(cp.conversations)) {
              parsed[convId] = (msgs as any[]).map((m: any) => ({
                ...m,
                timestamp: typeof m.timestamp === "number" ? m.timestamp : Date.now(),
              }));
            }
            loadFromCurrent({ conversations: parsed });
          }
          break;
        }

        case "chat_current_cleared": {
          // Handled by UI if needed
          break;
        }

        case "group_workspace":
        case "group_workspace_file":
        case "group_workspace_file_saved": {
          window.dispatchEvent(new CustomEvent(`ws-${msg.type}`, { detail: msg }));
          break;
        }

        case "todos": {
          const tp = msg.payload as { todos: any[] };
          setTodos(tp.todos);
          break;
        }

        case "todo_added":
        case "todo_completed":
        case "todo_removed":
        case "todo_updated": {
          window.dispatchEvent(new CustomEvent("ws-todo-updated", { detail: msg }));
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

        case "sandbox_status": {
          window.dispatchEvent(new CustomEvent("ws-sandbox-status", { detail: msg }));
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
  }, [url, setConnected, setAgents, setGroups, addMessage, appendStreamToken, finalizeStream, startWaiting, loadFromCurrent, clearMessages, incrementUnread, setConfig]);
}

export function getWsClient(): WsClient | null {
  return wsClient;
}
