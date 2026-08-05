import { useEffect } from "react";
import { useChatStore } from "@/stores/chat";
import { useAgentsStore } from "@/stores/agents";
import { useGroupsStore } from "@/stores/groups";
import { useSettingsStore } from "@/stores/settings";
import { WorkbenchLayout } from "@/components/layout/Surface";
import type { ReactNode } from "react";
import type { ButlerTaskReceiptPayload } from "@/hooks/ws-handlers/butler-task-handlers";
import { toTaskReceipt } from "@/lib/taskReceipt";
import { ChatHeader } from "./ChatHeader";
import { MessageList } from "./MessageList";
import { ChatInput } from "./ChatInput";
import { TodoInline } from "./TodoInline";


interface ChatViewProps {
  targetAgentId?: string;
  sideRail?: ReactNode;
}

export function ChatView({ targetAgentId, sideRail }: ChatViewProps) {
  const messages = useChatStore((s) => s.messages);
  const streamBuffer = useChatStore((s) => s.streamBuffer);
  const waiting = useChatStore((s) => s.waitingForResponse);
  const activeConv = useChatStore((s) => s.activeConversation);
  const agents = useAgentsStore((s) => s.agents);
  const groups = useGroupsStore((s) => s.groups);
  const connected = useSettingsStore((s) => s.connected);
  const toggleDetailPanel = useSettingsStore((s) => s.toggleDetailPanel);
  const detailPanelOpen = useSettingsStore((s) => s.detailPanelOpen);
  const activeView = useSettingsStore((s) => s.activeView);

  const convId = targetAgentId || activeConv;
  const agent = agents.find((a) => a.id === convId);
  const group = groups.find((g) => g.id === convId);
  const targetName = agent?.name || group?.name || (targetAgentId === "butler" ? "管家" : undefined);
  const isGroupChat = !!group && !agent;
  const canSend = !!convId;

  // 任务回执点亮:监听 butler_task_updated 事件流,在管家会话(全部回执)或目标会话(自己的回执)追加
  // direction:"out" 消息,metadata.taskReceipt 由 MessageBubble 的 TaskReceiptCard 渲染。
  // 状态流转:同 butlerTaskId 已有回执消息时更新该卡片的 status/summary/nextAction,不重复追加(合约要求)。
  useEffect(() => {
    const handleReceipt = (event: Event) => {
      const payload = (event as CustomEvent<ButlerTaskReceiptPayload>).detail;
      if (!payload?.butlerTaskId) return;
      if (convId !== "butler" && convId !== payload.targetId) return;

      const store = useChatStore.getState();
      const existing = store.getMessages(convId);
      if (existing.some((m) => m.metadata?.taskReceipt?.id === payload.butlerTaskId)) {
        store.updateTaskReceipt(convId, payload.butlerTaskId, toTaskReceipt(payload));
        return;
      }

      store.addMessage(
        {
          direction: "out",
          content: "",
          timestamp: Date.now(),
          senderId: "butler",
          senderName: "管家",
          metadata: { taskReceipt: toTaskReceipt(payload) },
        },
        convId,
      );
    };
    window.addEventListener("ws-butler-task-receipt", handleReceipt);
    return () => window.removeEventListener("ws-butler-task-receipt", handleReceipt);
  }, [convId]);

  return (
    <WorkbenchLayout
      fullBleed
      sideRail={sideRail}
      header={
        <ChatHeader
          name={targetName}
          status={agent?.status}
          model={agent?.model}
          provider={agent?.provider}
          connected={connected}
          isGroup={isGroupChat}
          memberCount={group?.members.length}
          showConfigButton={!!convId}
          configOpen={detailPanelOpen}
          onToggleConfig={toggleDetailPanel}
          activeView={activeView}
          convId={convId}
        />
      }
      body={
        <>
          {!isGroupChat && convId && convId !== "butler" && (
            <TodoInline agentId={convId} />
          )}
          <MessageList messages={messages} streamBuffer={streamBuffer} waiting={waiting} />
        </>
      }
      input={<ChatInput disabled={!canSend} targetConvId={convId} />}
    />
  );
}
