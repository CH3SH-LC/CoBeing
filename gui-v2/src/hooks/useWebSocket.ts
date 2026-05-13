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
import { useUsageStore } from "@/stores/usage";
import { useActivityStore } from "@/stores/activity";
import { useWakeQueueStore } from "@/stores/wakeQueue";
import { useObservabilityStore } from "@/stores/observability";
import type { DashboardData } from "@/lib/types";

let wsClient: WsClient | null = null;

/** 记录活动日志 */
function emitActivity(
  icon: string,
  text: string,
  level: "info" | "warn" | "error" = "info",
  category: "message" | "tool" | "file" | "todo" | "system" = "system",
  agentId?: string,
  groupId?: string,
  extra?: { agentName?: string; groupName?: string; fileName?: string; mentionTargets?: string[] },
) {
  useActivityStore.getState().addEntry({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: Date.now(),
    icon,
    text,
    level,
    category,
    agentId,
    groupId,
    agentName: extra?.agentName,
    groupName: extra?.groupName,
    fileName: extra?.fileName,
    mentionTargets: extra?.mentionTargets,
  });
}

/** 从内容中提取 @mentions（最少 3 字符，避免误匹配中文短词） */
function extractMentions(content: string): string[] {
  const matches = content.match(/@([\w一-鿿][\w一-鿿-]{2,})/g);
  return matches ? [...new Set(matches.map(m => m.slice(1)))] : [];
}

export function useWebSocket(url = "ws://localhost:18765") {
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
  const loadFromCurrent = useChatStore((s) => s.loadFromCurrent);
  const clearMessages = useChatStore((s) => s.clearMessages);
  const incrementUnread = useTrayStore((s) => s.incrementUnread);
  const setConfig = useConfigStore((s) => s.setConfig);
  const setTodos = useTodoStore((s) => s.setTodos);
  const addUsageRecord = useUsageStore((s) => s.addRecord);

  const updateMsgStatus = (convId: string, status: "sent" | "streaming" | "done" | "error", errorMessage?: string) => {
    useChatStore.getState().updateLastInMessage(convId, { status, errorMessage });
  };

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    wsClient = new WsClient(url, (msg: WsMessage) => {
      switch (msg.type) {
        case "_connected":
          setConnected(true);
          stateRetryCount.current = 0;
          wsClient?.send({ type: "get_state" });
          wsClient?.send({ type: "get_config" });
          wsClient?.send({ type: "get_chat_current" });
          // Fallback: if chat_current never arrives, force currentLoaded after 8s
          // so saves can still proceed (avoid permanent save blockage)
          setTimeout(() => {
            const s = useChatStore.getState();
            if (!s.currentLoaded) {
              useChatStore.setState({ currentLoaded: true });
            }
          }, 8000);
          break;

        case "_disconnected":
          setConnected(false);
          break;

        case "state": {
          const p = msg.payload as WsStatePayload;
          setAgents(p.agents);
          setGroups(p.groups);
          // 后端可能还在初始化，空状态时自动重试（最多 5 次，间隔 2 秒）
          if (p.agents.length === 0 && p.groups.length === 0 && stateRetryCount.current < 5) {
            stateRetryCount.current++;
            if (stateRetryTimer.current) clearTimeout(stateRetryTimer.current);
            stateRetryTimer.current = setTimeout(() => {
              wsClient?.send({ type: "get_state" });
            }, 2000);
          }
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
            emitActivity("🔔", p.content, "info", "system");
          }
          // "out" direction handled by agent_response to avoid duplication.
          // "in" direction (user messages) are added locally in ChatInput.
          break;
        }

        case "stream_token": {
          const p = msg.payload as { token: string };
          if (!streamStartedRef.current) {
            streamStartedRef.current = true;
            const activeId = useChatStore.getState().activeConversation;
            if (activeId) updateMsgStatus(activeId, "streaming");
          }
          appendStreamToken(p.token);
          break;
        }

        case "agent_response": {
          const p = msg.payload as { content: string; groupId?: string; agentId?: string; agentName?: string };
          // 群组响应：由 group_message 处理消息内容，这里只清状态
          if (p.groupId) {
            useChatStore.setState({ waitingForResponse: false, streamBuffer: "" });
          } else {
            const activeId = useChatStore.getState().activeConversation;
            if (activeId) updateMsgStatus(activeId, "done");
            finalizeStream(p.content, p.agentId, p.agentName);
          }
          streamStartedRef.current = false;
          break;
        }

        case "agent_started": {
          const as = msg.payload as { agentId: string; agentName: string; groupId?: string; mentions?: Array<{ text: string; channel: string }>; timestamp: number };
          const asName = as.agentName || as.agentId;
          const asGroup = as.groupId ? (useGroupsStore.getState().groups.find(g => g.id === as.groupId)?.name || as.groupId) : undefined;
          // Update message status: the message has been received by the server
          const activeId = useChatStore.getState().activeConversation;
          if (activeId) updateMsgStatus(activeId, "sent");
          if (as.mentions && as.mentions.length > 0) {
            const mentionTexts = as.mentions.map(m => m.text);
            const mentionNames = mentionTexts.map(t => t.startsWith("@") ? t.slice(1) : t);
            emitActivity("⚡", `${asName} 被触发（${mentionTexts.join(" ")}）${asGroup ? `，群组 ${asGroup}` : ""}`, "info", "system", as.agentId, as.groupId, { agentName: asName, groupName: asGroup, mentionTargets: mentionNames });
          } else {
            emitActivity("⚡", `${asName} 开始处理${asGroup ? `，群组 ${asGroup}` : ""}`, "info", "system", as.agentId, as.groupId, { agentName: asName, groupName: asGroup });
          }
          break;
        }

        case "agent_completed": {
          const ac2 = msg.payload as { agentId: string; agentName: string; groupId?: string; timestamp: number };
          const ac2Name = ac2.agentName || ac2.agentId;
          const ac2Group = ac2.groupId ? (useGroupsStore.getState().groups.find(g => g.id === ac2.groupId)?.name || ac2.groupId) : undefined;
          const activeId2 = useChatStore.getState().activeConversation;
          if (activeId2) updateMsgStatus(activeId2, "done");
          emitActivity("✅", `${ac2Name} 处理完成${ac2Group ? `，群组 ${ac2Group}` : ""}`, "info", "system", ac2.agentId, ac2.groupId, { agentName: ac2Name, groupName: ac2Group });
          break;
        }

        case "agent_error": {
          const ae = msg.payload as { agentId: string; agentName: string; groupId?: string; error?: string; timestamp: number };
          const aeName = ae.agentName || ae.agentId;
          const aeGroup = ae.groupId ? (useGroupsStore.getState().groups.find(g => g.id === ae.groupId)?.name || ae.groupId) : undefined;
          const errorText = ae.error || "未知错误";
          const activeId3 = useChatStore.getState().activeConversation;
          if (activeId3) updateMsgStatus(activeId3, "error", errorText);
          emitActivity("❌", `${aeName} 处理失败${aeGroup ? `，群组 ${aeGroup}` : ""}: ${errorText}`, "error", "system", ae.agentId, ae.groupId, { agentName: aeName, groupName: aeGroup });
          break;
        }

        case "wake_queue_update": {
          const wq = msg.payload as { groupId?: string; queue?: any[]; processing?: string | null; queues?: Record<string, { groupId: string; groupName: string; queue: any[]; processing: string | null }>; activeAgents?: Array<{ agentId: string; agentName: string; status: string }>; timestamp: number };
          if (wq.queues) {
            useWakeQueueStore.getState().setQueues(wq.queues as any);
          } else if (wq.groupId) {
            useWakeQueueStore.getState().updateQueue(wq.groupId, wq.queue || [], wq.processing ?? null);
          }
          if (wq.activeAgents) {
            useWakeQueueStore.getState().setActiveAgents(wq.activeAgents);
          }
          break;
        }

        case "dashboard": {
          const p = msg.payload as DashboardData & { error?: string };
          if (p && !p.error) useObservabilityStore.getState().setDashboard(p);
          break;
        }

        case "agent_updated": {
          wsClient?.send({ type: "get_state" });
          break;
        }

        case "agent_created": {
          const ac = msg.payload as { id: string; name: string };
          emitActivity("📦", `Agent ${ac.name} 已创建`, "info", "system", ac.id, undefined, { agentName: ac.name });
          wsClient?.send({ type: "get_state" });
          break;
        }

        case "group_created": {
          const gc = msg.payload as { id: string; name: string };
          emitActivity("👥", `群组 ${gc.name} 已创建`, "info", "system", undefined, gc.id, { groupName: gc.name });
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
          const fs = msg.payload as { agentId: string; filename: string };
          useActivityStore.getState().addFileChange({
            agentId: fs.agentId,
            action: "modified",
            filename: fs.filename,
          });
          window.dispatchEvent(new CustomEvent("ws-file-saved", { detail: msg }));
          break;
        }

        case "member_added": {
          const ma = msg.payload as { groupId: string; agentId: string };
          const maAgentName = useAgentsStore.getState().agents.find(a => a.id === ma.agentId)?.name || ma.agentId;
          const maGroupName = useGroupsStore.getState().groups.find(g => g.id === ma.groupId)?.name || ma.groupId;
          emitActivity("➕", `${maAgentName} 加入了群组 ${maGroupName}`, "info", "system", ma.agentId, ma.groupId, { agentName: maAgentName, groupName: maGroupName });
          wsClient?.send({ type: "get_state" });
          break;
        }

        case "member_removed": {
          const mr = msg.payload as { groupId: string; agentId: string };
          const mrAgentName = useAgentsStore.getState().agents.find(a => a.id === mr.agentId)?.name || mr.agentId;
          const mrGroupName = useGroupsStore.getState().groups.find(g => g.id === mr.groupId)?.name || mr.groupId;
          emitActivity("➖", `${mrAgentName} 离开了群组 ${mrGroupName}`, "info", "system", mr.agentId, mr.groupId, { agentName: mrAgentName, groupName: mrGroupName });
          wsClient?.send({ type: "get_state" });
          break;
        }

        case "group_message": {
          const gm = msg.payload as { groupId: string; fromAgentId: string; content: string; mentions: string[]; timestamp: number };
          // Mark user message as done when group agent responds
          if (gm.groupId) updateMsgStatus(gm.groupId, "done");
          const agents = useAgentsStore.getState().agents;
          const groups = useGroupsStore.getState().groups;
          const fromName = agents.find(a => a.id === gm.fromAgentId)?.name || gm.fromAgentId;
          const gName = groups.find(g => g.id === gm.groupId)?.name || gm.groupId;
          const mentions = gm.mentions || extractMentions(gm.content);
          if (mentions.length > 0) {
            const mentionNames = mentions.map(m => agents.find(a => a.id === m)?.name || m);
            emitActivity("📣", `${fromName} 在群组 ${gName} 中 @${mentionNames.join(" @")}`, "info", "message", gm.fromAgentId, gm.groupId, { agentName: fromName, groupName: gName, mentionTargets: mentionNames });
          }
          emitActivity("💬", `${fromName} 在群组 ${gName} 中发言`, "info", "message", gm.fromAgentId, gm.groupId, { agentName: fromName, groupName: gName });
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
          emitActivity("📨", `渠道消息 ${cm.direction === "in" ? "来自" : "发送给"} ${cm.senderName || cm.agentId}`);
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
          const destroyedName = useAgentsStore.getState().agents.find(a => a.id === d.agentId)?.name || d.agentId;
          emitActivity("🗑️", `Agent ${destroyedName} 已删除`, "info", "system", d.agentId, undefined, { agentName: destroyedName });
          clearMessages(d.agentId);
          useAgentsStore.getState().selectAgent(null);
          useSettingsStore.getState().setDetailPanelOpen(false);
          wsClient?.send({ type: "get_state" });
          break;
        }

        case "group_destroyed": {
          const d = msg.payload as { groupId: string };
          const destroyedGroupName = useGroupsStore.getState().groups.find(g => g.id === d.groupId)?.name || d.groupId;
          emitActivity("👥", `群组 ${destroyedGroupName} 已解散`, "info", "system", undefined, d.groupId, { groupName: destroyedGroupName });
          clearMessages(d.groupId);
          useGroupsStore.getState().selectGroup(null);
          useSettingsStore.getState().setDetailPanelOpen(false);
          wsClient?.send({ type: "get_state" });
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
          // 记录到工具调用组
          useActivityStore.getState().addToolCall(
            {
              id: te.toolCallId || `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              toolName: te.toolName,
              params: te.params,
              result: te.result,
              status: te.status === "error" ? "complete" : te.status,
              timestamp: Date.now(),
            },
            te.agentId || "unknown",
          );
          break;
        }

        case "usage_stats": {
          const us = msg.payload as {
            agentId: string;
            inputTokens: number;
            outputTokens: number;
            cacheHitTokens: number;
            cacheMissTokens: number;
            timestamp: number;
          };
          addUsageRecord(us);
          break;
        }

        case "chat_current": {
          const cp = msg.payload as { conversations: Record<string, any[]> };
          // Parse timestamp fields back to numbers
          const parsed: Record<string, any[]> = {};
          if (cp.conversations) {
            for (const [convId, msgs] of Object.entries(cp.conversations)) {
              parsed[convId] = (msgs as any[]).map((m: any) => ({
                ...m,
                timestamp: typeof m.timestamp === "number" ? m.timestamp : Date.now(),
              }));
            }
          }
          // Pass current agents so backward compat fixup can resolve senderName
          const agentsSnapshot = useAgentsStore.getState().agents.map(a => ({ id: a.id, name: a.name }));
          loadFromCurrent({ conversations: parsed }, agentsSnapshot);
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

        case "todo_added": {
          const ta = msg.payload as { todo: { id: string; title: string; agentId?: string; targetAgentId?: string } };
          useActivityStore.getState().addTodoChange({
            action: "added",
            title: ta.todo.title,
            scope: ta.todo.agentId ? "agent" : "group",
            agentId: ta.todo.agentId || ta.todo.targetAgentId,
          });
          window.dispatchEvent(new CustomEvent("ws-todo-updated", { detail: msg }));
          break;
        }

        case "todo_completed": {
          const tc = msg.payload as { todo: { id: string; title: string; agentId?: string; targetAgentId?: string } };
          useActivityStore.getState().addTodoChange({
            action: "completed",
            title: tc.todo.title,
            scope: tc.todo.agentId ? "agent" : "group",
            agentId: tc.todo.agentId || tc.todo.targetAgentId,
          });
          window.dispatchEvent(new CustomEvent("ws-todo-updated", { detail: msg }));
          break;
        }

        case "todo_removed": {
          const tr = msg.payload as { todoId: string; scope?: string; agentId?: string; groupId?: string };
          useActivityStore.getState().addTodoChange({
            action: "removed",
            title: tr.todoId,
            scope: (tr.scope as "agent" | "group") || "agent",
            agentId: tr.agentId,
            groupId: tr.groupId,
          });
          window.dispatchEvent(new CustomEvent("ws-todo-updated", { detail: msg }));
          break;
        }

        case "todo_updated": {
          window.dispatchEvent(new CustomEvent("ws-todo-updated", { detail: msg }));
          break;
        }

        case "todo_batch_result": {
          window.dispatchEvent(new CustomEvent("ws-todo-updated", { detail: msg }));
          break;
        }

        case "group_health": {
          window.dispatchEvent(new CustomEvent("ws-group-health", { detail: msg }));
          break;
        }

        case "screener_stats": {
          window.dispatchEvent(new CustomEvent("ws-screener-stats", { detail: msg }));
          break;
        }

        case "agent_timeline": {
          window.dispatchEvent(new CustomEvent("ws-agent-timeline", { detail: msg }));
          break;
        }

        case "agent_stopped": {
          window.dispatchEvent(new CustomEvent("ws-agent-stopped", { detail: msg }));
          break;
        }

        case "search_results": {
          window.dispatchEvent(new CustomEvent("ws-search-results", { detail: msg }));
          break;
        }

        case "export_result": {
          const er = msg.payload as { exportType: string; data: string; fileCount: number };
          const blob = new Blob([er.data], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `cobeing-${er.exportType}-${new Date().toISOString().split("T")[0]}.json`;
          a.click();
          URL.revokeObjectURL(url);
          break;
        }

        case "server_shutting_down": {
          // Backend is about to stop — flush save immediately before WS closes
          const snapshot = useChatStore.getState().messageStore;
          if (Object.keys(snapshot).length > 0) {
            wsClient?.send({
              type: "save_chat_current",
              payload: { conversations: snapshot },
            });
          }
          break;
        }

        case "error": {
          const p = msg.payload as { message: string };
          emitActivity("❌", `错误: ${p.message}`, "error");
          addMessage({
            direction: "system",
            content: `Error: ${p.message}`,
            timestamp: Date.now(),
          });
          break;
        }

        case "group_history": {
          const gh = msg.payload as { groupId: string; messages: any[]; hasMore: boolean };
          if (gh.messages && gh.messages.length > 0) {
            useChatStore.getState().prependMessages(gh.messages, gh.groupId);
          }
          useChatStore.getState().setHasMore(gh.groupId, gh.hasMore);
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
      if (stateRetryTimer.current) clearTimeout(stateRetryTimer.current);
      wsClient?.disconnect();
      wsClient = null;
      initialized.current = false;
    };
  }, [url, setConnected, setAgents, setGroups, addMessage, appendStreamToken, finalizeStream, startWaiting, loadFromCurrent, clearMessages, incrementUnread, setConfig, addUsageRecord]);
}

export function getWsClient(): WsClient | null {
  return wsClient;
}
