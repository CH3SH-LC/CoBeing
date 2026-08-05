import type { WsMessagePayload, ToolEvent } from "@/lib/types";
import { useAgentsStore } from "@/stores/agents";
import { useGroupsStore } from "@/stores/groups";
import { useChatStore } from "@/stores/chat";
import { useActivityStore } from "@/stores/activity";
import { maybeNotify } from "@/lib/notify";
import { emitActivity, extractMentions, mentionsUser } from "./helpers";
import type { WsHandlerContext, WsMessageHandler } from "./types";

export function buildChatHandlers(ctx: WsHandlerContext): Record<string, WsMessageHandler> {
  const {
    streamStartedRef,
    addMessage,
    addToolEvent,
    appendStreamToken,
    finalizeStream,
    finishWaiting,
    loadFromCurrent,
    updateMsgStatus,
  } = ctx;

  return {
    message: (msg) => {
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
    },

    stream_token: (msg) => {
      const p = msg.payload as { token: string; agentId?: string; groupId?: string };
      const convId = p.groupId || p.agentId || useChatStore.getState().activeConversation || undefined;
      if (!streamStartedRef.current) {
        streamStartedRef.current = true;
        if (convId) updateMsgStatus(convId, "streaming");
      }
      appendStreamToken(p.token, convId);
    },

    agent_response: (msg) => {
      const p = msg.payload as { content: string; groupId?: string; agentId?: string; agentName?: string };
      const convId = p.groupId || p.agentId || useChatStore.getState().activeConversation || undefined;
      // 群组响应：由 group_message 处理消息内容与通知（低打扰——仅 @用户 时通知），这里只清状态
      if (p.groupId) {
        finishWaiting(p.groupId);
      } else {
        if (convId) updateMsgStatus(convId, "done");
        // Guard: if waiting state was already cleared (e.g. startWaiting interrupted
        // an earlier pending stream), don't re-finalize unless there's active waiting.
        // This prevents duplicate messages when agent_response arrives late.
        const chatState = useChatStore.getState();
        const hasActiveWaiting = !!chatState.waitingByConversation[convId ?? ""];
        const hasBufferContent = !!(chatState.streamBuffers[convId ?? ""]);
        if (hasActiveWaiting || hasBufferContent || !chatState.messageStore[convId ?? ""]?.length) {
          finalizeStream(p.content, p.agentId, p.agentName, convId);
        }
        if (convId && p.agentName && p.content.trim()) {
          maybeNotify(convId, `${p.agentName} 回复了你`, p.content.slice(0, 80));
        }
      }
      streamStartedRef.current = false;
    },

    agent_started: (msg) => {
      const as = msg.payload as { agentId: string; agentName: string; groupId?: string; mentions?: Array<{ text: string; channel: string }>; source?: string; timestamp: number };
      // Skip TODOboard-triggered events in chat UI
      if ((as as any).source === "TODOboard") return;
      const asName = as.agentName || as.agentId;
      const asGroup = as.groupId ? (useGroupsStore.getState().groups.find(g => g.id === as.groupId)?.name || as.groupId) : undefined;
      // Update message status: the message has been received by the server
      const activeId = as.groupId || as.agentId || useChatStore.getState().activeConversation;
      if (activeId) updateMsgStatus(activeId, "sent");
      if (as.mentions && as.mentions.length > 0) {
        const mentionTexts = as.mentions.map(m => m.text);
        const mentionNames = mentionTexts.map(t => t.startsWith("@") ? t.slice(1) : t);
        emitActivity("⚡", `${asName} 被触发（${mentionTexts.join(" ")}）${asGroup ? `，群组 ${asGroup}` : ""}`, "info", "system", as.agentId, as.groupId, { agentName: asName, groupName: asGroup, mentionTargets: mentionNames });
      } else {
        emitActivity("⚡", `${asName} 开始处理${asGroup ? `，群组 ${asGroup}` : ""}`, "info", "system", as.agentId, as.groupId, { agentName: asName, groupName: asGroup });
      }
    },

    agent_completed: (msg) => {
      const ac2 = msg.payload as { agentId: string; agentName: string; groupId?: string; timestamp: number };
      const ac2Name = ac2.agentName || ac2.agentId;
      const ac2Group = ac2.groupId ? (useGroupsStore.getState().groups.find(g => g.id === ac2.groupId)?.name || ac2.groupId) : undefined;
      const activeId2 = ac2.groupId || ac2.agentId || useChatStore.getState().activeConversation;
      if (activeId2) {
        updateMsgStatus(activeId2, "done");
        // Safety: if agent_response was lost (e.g. WS reconnect during tool exec),
        // finalize any accumulated stream content as a message instead of discarding it.
        const chatState = useChatStore.getState();
        if (chatState.waitingByConversation[activeId2]) {
          const savedBuffer = chatState.streamBuffers[activeId2] || "";
          if (savedBuffer.trim()) {
            finalizeStream(savedBuffer, activeId2, ac2.agentName, activeId2);
          } else {
            finishWaiting(activeId2);
          }
        }
      }
      streamStartedRef.current = false;
      emitActivity("✅", `${ac2Name} 处理完成${ac2Group ? `，群组 ${ac2Group}` : ""}`, "info", "system", ac2.agentId, ac2.groupId, { agentName: ac2Name, groupName: ac2Group });
    },

    agent_error: (msg) => {
      const ae = msg.payload as { agentId: string; agentName: string; groupId?: string; error?: string; timestamp: number };
      const aeName = ae.agentName || ae.agentId;
      const aeGroup = ae.groupId ? (useGroupsStore.getState().groups.find(g => g.id === ae.groupId)?.name || ae.groupId) : undefined;
      const errorText = ae.error || "未知错误";
      const activeId3 = ae.groupId || ae.agentId || useChatStore.getState().activeConversation;
      if (activeId3) {
        updateMsgStatus(activeId3, "error", errorText);
        // Safety: if agent_response was lost, finalize any accumulated stream content
        const chatState = useChatStore.getState();
        if (chatState.waitingByConversation[activeId3]) {
          const savedBuffer = chatState.streamBuffers[activeId3] || "";
          if (savedBuffer.trim()) {
            finalizeStream(savedBuffer, activeId3, ae.agentName, activeId3);
          } else {
            finishWaiting(activeId3);
          }
        }
      }
      streamStartedRef.current = false;
      emitActivity("❌", `${aeName} 处理失败${aeGroup ? `，群组 ${aeGroup}` : ""}: ${errorText}`, "error", "system", ae.agentId, ae.groupId, { agentName: aeName, groupName: aeGroup });
    },

    tool_event: (msg) => {
      const te = msg.payload as ToolEvent;
      addToolEvent(te, te.groupId || te.agentId);
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
    },

    group_message: (msg) => {
      const gm = msg.payload as { groupId: string; fromAgentId: string; content: string; mentions: string[]; timestamp: number; metadata?: Record<string, unknown> };
      // Mark user message as done when group agent responds
      if (gm.groupId) updateMsgStatus(gm.groupId, "done");
      finishWaiting(gm.groupId);
      // Skip displaying internal messages (user, TODOboard, system) in the chat UI
      if (gm.fromAgentId === "system" || gm.fromAgentId === "user" || gm.fromAgentId === "TODOboard") return;
      const agents = useAgentsStore.getState().agents;
      const groups = useGroupsStore.getState().groups;
      const fromName = agents.find(a => a.id === gm.fromAgentId)?.name || gm.fromAgentId;
      const gName = groups.find(g => g.id === gm.groupId)?.name || gm.groupId;
      const mentions = gm.mentions || extractMentions(gm.content);
      // 用户唤醒（低打扰核心）：agent 平时协作不通知不计数；仅当消息 @了用户时才唤醒
      const isUserMention = mentionsUser(mentions);
      if (isUserMention) {
        maybeNotify(gm.groupId, `${fromName} 在群组 ${gName} 中提到了你`, gm.content.slice(0, 80));
      }
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
        metadata: gm.metadata,
      }, gm.groupId, { countUnread: isUserMention });
    },

    channel_message: (msg) => {
      const cm = msg.payload as { agentId: string; direction: "in" | "out"; content: string; senderName?: string; timestamp: number };
      emitActivity("📨", `渠道消息 ${cm.direction === "in" ? "来自" : "发送给"} ${cm.senderName || cm.agentId}`);
      addMessage({
        direction: cm.direction,
        content: cm.content,
        timestamp: cm.timestamp,
        senderName: cm.direction === "in" ? cm.senderName : undefined,
      }, cm.agentId);
    },

    chat_current: (msg) => {
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
    },

    chat_current_cleared: () => {
      // Handled by UI if needed
    },

    group_history: (msg) => {
      const gh = msg.payload as { groupId: string; messages: any[]; hasMore: boolean };
      if (gh.messages && gh.messages.length > 0) {
        useChatStore.getState().prependMessages(gh.messages, gh.groupId);
      }
      useChatStore.getState().setHasMore(gh.groupId, gh.hasMore);
    },
  };
}
