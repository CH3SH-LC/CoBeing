import { useChatStore } from "@/stores/chat";
import { useGroupsStore } from "@/stores/groups";
import { useAgentsStore } from "@/stores/agents";
import { useSettingsStore } from "@/stores/settings";
import { getWsClient } from "@/hooks/useWebSocket";
import { startNewConversation } from "@/hooks/useChatPersistence";
import { GroupMessageBubble } from "./GroupMessageBubble";
import { useState, useRef, useEffect } from "react";

export function GroupChatView() {
  const messages = useChatStore((s) => s.messages);
  const streamBuffer = useChatStore((s) => s.streamBuffer);
  const waiting = useChatStore((s) => s.waitingForResponse);
  const activeConv = useChatStore((s) => s.activeConversation);
  const agents = useAgentsStore((s) => s.agents);
  const groups = useGroupsStore((s) => s.groups);
  const connected = useSettingsStore((s) => s.connected);
  const toggleDetailPanel = useSettingsStore((s) => s.toggleDetailPanel);
  const detailPanelOpen = useSettingsStore((s) => s.detailPanelOpen);

  const group = groups.find((g) => g.id === activeConv);
  const canSend = connected && !!activeConv;

  const getSenderName = (senderId: string): string => {
    const agent = agents.find((a) => a.id === senderId);
    return agent?.name ?? senderId;
  };

  return (
    <div className="flex-1 flex flex-col h-full min-h-0" style={{ padding: 20, gap: 20 }}>
      {/* Header */}
      <div className="flex items-center rounded-xl bg-surface shrink-0 border border-bdr/40"
           style={{ boxShadow: "var(--shadow-surface)", padding: "16px 24px" }}>
        <div className="w-10 h-10 rounded-lg bg-purple/10 flex items-center justify-center text-sm">👥</div>
        <div style={{ marginLeft: 16 }}>
          <p className="text-sm font-medium text-purple">{group?.name ?? "群组"}</p>
          <p className="text-xs text-txt-muted" style={{ marginTop: 4 }}>{group?.members.length ?? 0} 成员</p>
        </div>
        <div className="ml-auto flex items-center" style={{ gap: 12 }}>
          {activeConv && (
            <button onClick={() => { startNewConversation(); }}
              className="rounded-lg flex items-center justify-center text-xs transition-colors text-txt-sub hover:bg-hover hover:text-txt"
              style={{ padding: "8px 14px" }}
            >
              + 新对话
            </button>
          )}
          {activeConv && (
            <button onClick={toggleDetailPanel}
              className={`rounded-lg flex items-center justify-center text-sm transition-colors ${detailPanelOpen ? "bg-purple/15 text-purple" : "text-txt-muted hover:bg-hover hover:text-txt"}`}
              style={{ width: 36, height: 36 }}
            >
              ⚙
            </button>
          )}
          <div className={`w-2.5 h-2.5 rounded-full ${connected ? "bg-success" : "bg-danger"}`} />
          <span className="text-xs text-txt-muted">{connected ? "已连接" : "离线"}</span>
        </div>
      </div>

      {/* Messages */}
      <GroupMessageList messages={messages} streamBuffer={streamBuffer} waiting={waiting} getSenderName={getSenderName} />

      {/* Input */}
      <GroupChatInput disabled={!canSend} />
    </div>
  );
}

function GroupMessageList({ messages, streamBuffer, waiting, getSenderName }: {
  messages: ReturnType<typeof useChatStore.getState>["messages"];
  streamBuffer: string; waiting: boolean; getSenderName: (id: string) => string;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, streamBuffer]);

  if (messages.length === 0 && !waiting) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-purple text-2xl font-bold font-display">👥</p>
          <p className="text-txt-muted text-sm" style={{ marginTop: 20 }}>群组协作视图</p>
          <p className="text-txt-muted text-sm" style={{ marginTop: 8 }}>发送消息开始协作</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto" style={{ padding: "24px 20px" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {messages.map((msg, i) => (
          <GroupMessageBubble key={i} msg={msg} senderName={msg.senderId ? getSenderName(msg.senderId) : undefined} />
        ))}
        {waiting && !streamBuffer && (
          <div className="flex justify-start">
            <div className="max-w-[72%] rounded-2xl bg-msg-assistant" style={{ padding: "16px 24px" }}>
              <div className="flex items-center gap-2">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-success" />
                </span>
                <span className="text-xs text-success font-medium">思考中...</span>
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

function GroupChatInput({ disabled }: { disabled: boolean }) {
  const [text, setText] = useState("");
  const activeConv = useChatStore((s) => s.activeConversation);
  const startWaiting = useChatStore((s) => s.startWaiting);
  const addMessage = useChatStore((s) => s.addMessage);

  const handleSend = () => {
    const content = text.trim();
    if (!content || !activeConv || disabled) return;
    addMessage({ direction: "in", content, timestamp: Date.now() });
    startWaiting();
    setText("");
    getWsClient()?.send({ type: "send_message", payload: { agentId: "host", content: `[群组 ${activeConv}] ${content}` } });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  return (
    <div className="rounded-xl bg-surface border border-bdr/40"
         style={{ boxShadow: "var(--shadow-surface)", padding: 20 }}>
      <div className="flex items-end" style={{ gap: 12 }}>
        <textarea
          value={text} onChange={(e) => setText(e.target.value)} onKeyDown={handleKeyDown}
          placeholder="输入消息... (@mention 唤起成员)" disabled={disabled} rows={1}
          className="flex-1 resize-none rounded-lg bg-input border border-bdr text-sm text-txt placeholder:text-txt-muted focus:outline-none focus:border-accent/50 transition-colors disabled:opacity-50"
          style={{ padding: "12px 16px", maxHeight: 120 }}
        />
        <button onClick={handleSend} disabled={disabled || !text.trim()}
          className="rounded-lg text-sm font-medium transition-colors shrink-0 disabled:opacity-30 disabled:cursor-not-allowed bg-purple text-white hover:bg-purple/90"
          style={{ padding: "12px 24px" }}
        >
          发送
        </button>
      </div>
      <div className="flex items-center" style={{ marginTop: 12, paddingLeft: 4 }}>
        <span className="text-xs text-txt-muted">Enter 发送 · Shift+Enter 换行</span>
      </div>
    </div>
  );
}
