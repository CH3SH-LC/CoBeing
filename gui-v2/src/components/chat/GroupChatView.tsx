import { useChatStore } from "@/stores/chat";
import { useGroupsStore } from "@/stores/groups";
import { useAgentsStore } from "@/stores/agents";
import { useSettingsStore } from "@/stores/settings";
import { getWsClient } from "@/hooks/useWebSocket";
import { startNewConversation } from "@/hooks/useChatPersistence";
import { MarkdownContent } from "@/components/shared/MarkdownContent";
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
  const activeConv = useChatStore((s) => s.activeConversation);
  const hasMore = useChatStore((s) => s.hasMoreMessages[activeConv ?? ""] ?? true);
  const [loadingMore, setLoadingMore] = useState(false);
  const prevLenRef = useRef(messages.length);
  const isFirstRender = useRef(true);

  useEffect(() => {
    const prevLen = prevLenRef.current;
    prevLenRef.current = messages.length;
    const instant = isFirstRender.current || prevLen === 0;
    isFirstRender.current = false;
    bottomRef.current?.scrollIntoView({ behavior: instant ? "instant" as ScrollBehavior : "smooth" });
  }, [messages, streamBuffer]);

  const handleLoadMore = () => {
    if (!activeConv || loadingMore) return;
    setLoadingMore(true);
    const oldestMsg = messages.length > 0 ? messages[0] : null;
    getWsClient()?.send({
      type: "get_group_history",
      payload: { groupId: activeConv, before: oldestMsg?.timestamp, limit: 50 },
    });
    // Reset loading after a short delay (response handled by useWebSocket group_history handler)
    setTimeout(() => setLoadingMore(false), 3000);
  };

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
        {hasMore && messages.length > 0 && (
          <div className="flex justify-center">
            <button
              onClick={handleLoadMore}
              disabled={loadingMore}
              className="text-xs text-txt-muted hover:text-txt transition-colors rounded-lg hover:bg-hover disabled:opacity-50"
              style={{ padding: "6px 16px" }}
            >
              {loadingMore ? "加载中..." : "加载更早的消息"}
            </button>
          </div>
        )}
        {messages.map((msg, i) => (
          <GroupMessageBubble key={i} msg={msg} senderName={msg.senderId ? getSenderName(msg.senderId) : undefined} />
        ))}
        {waiting && !streamBuffer && (
          <GroupThinkingBubble getSenderName={getSenderName} />
        )}
        {waiting && streamBuffer && (
          <GroupThinkingBubble getSenderName={getSenderName} buffer={streamBuffer} />
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

function GroupThinkingBubble({ buffer, getSenderName }: {
  buffer?: string; getSenderName: (id: string) => string;
}) {
  const activeConv = useChatStore((s) => s.activeConversation);
  const senderName = activeConv ? getSenderName(activeConv) : "Assistant";

  return (
    <div className="flex justify-start">
      <div className="max-w-[70%] rounded-2xl rounded-bl-sm bg-msg-assistant" style={{ padding: "16px 24px" }}>
        <div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-success" />
          </span>
          <span className="text-sm font-bold text-success">
            {buffer ? `${senderName} (回复中)` : "思考中..."}
          </span>
        </div>
        <div className="text-sm text-txt leading-relaxed">
          {buffer ? <MarkdownContent content={buffer} /> : "思考中..."}
        </div>
      </div>
    </div>
  );
}

function GroupChatInput({ disabled }: { disabled: boolean }) {
  const [text, setText] = useState("");
  const [showMention, setShowMention] = useState(false);
  const [mentionIdx, setMentionIdx] = useState(0);
  const activeConv = useChatStore((s) => s.activeConversation);
  const startWaiting = useChatStore((s) => s.startWaiting);
  const addMessage = useChatStore((s) => s.addMessage);
  const agents = useAgentsStore((s) => s.agents);
  const groups = useGroupsStore((s) => s.groups);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 当前群组的成员列表
  const currentGroup = groups.find((g) => g.id === activeConv);
  const memberAgents = agents.filter((a) =>
    a.id !== "butler" &&
    (!currentGroup || currentGroup.members.includes(a.id))
  );

  // @mention 选项：@all + @群主 + 成员
  const mentionOptions = (() => {
    const opts: Array<{ id: string; label: string; sub: string }> = [];
    // @all
    if (currentGroup) {
      opts.push({ id: "__all__", label: "@全体成员", sub: `群组 ${currentGroup.name} 的所有成员` });
    }
    // @host（群主）
    const hostAgent = agents.find((a) => a.id === "host");
    if (hostAgent && currentGroup) {
      opts.push({ id: "host", label: `@${hostAgent.name}`, sub: "群主 — 协调者" });
    }
    // 其他成员
    for (const a of memberAgents) {
      opts.push({ id: a.id, label: `@${a.name}`, sub: a.id });
    }
    return opts;
  })();

  const handleSend = () => {
    const content = text.trim();
    if (!content || !activeConv || disabled) return;
    addMessage({ direction: "in", content, timestamp: Date.now(), status: "sending" });
    startWaiting();
    setText("");
    getWsClient()?.send({ type: "send_message", payload: { agentId: "host", content: `[群组 ${activeConv}] ${content}` } });
  };

  const insertMention = (agentId: string) => {
    const label = agentId === "__all__" ? "@all" : `@${agentId}`;
    setText((t) => t.replace(/@$/, "") + `${label} `);
    setShowMention(false);
    setMentionIdx(0);
    // 恢复输入框焦点
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    setText(v);
    if (v === "@" || v.endsWith("\n@") || v.endsWith(" @")) {
      setShowMention(true);
      setMentionIdx(0);
    }
  };

  const handleDblClick = (agentId: string) => {
    insertMention(agentId);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showMention) {
      const maxIdx = mentionOptions.length - 1;
      if (e.key === "ArrowDown") { e.preventDefault(); setMentionIdx((i) => Math.min(i + 1, maxIdx)); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setMentionIdx((i) => Math.max(i - 1, 0)); return; }
      if (e.key === "Tab") {
        e.preventDefault();
        if (mentionOptions[mentionIdx]) insertMention(mentionOptions[mentionIdx].id);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        // Enter 在 mention 弹窗打开时：选择当前高亮项
        if (mentionOptions[mentionIdx]) {
          e.preventDefault();
          insertMention(mentionOptions[mentionIdx].id);
          return;
        }
      }
      if (e.key === "Escape") { setShowMention(false); return; }
    }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  return (
    <div className="flex justify-center">
      <div className="rounded-xl bg-surface flex flex-col border border-bdr/40 relative"
           style={{ boxShadow: "var(--shadow-surface)", padding: 20, width: "60%", minHeight: 140 }}>
        {/* @mention 弹窗 */}
        {showMention && mentionOptions.length > 0 && (
          <div className="absolute rounded-lg bg-elevated border border-bdr shadow-lg z-10 overflow-y-auto"
               style={{ bottom: "100%", left: 20, marginBottom: 4, width: 240, maxHeight: 260 }}>
            {mentionOptions.map((opt, i) => (
              <button key={opt.id}
                onClick={() => insertMention(opt.id)}
                onDoubleClick={() => handleDblClick(opt.id)}
                onMouseEnter={() => setMentionIdx(i)}
                className={`w-full text-left text-sm transition-colors ${i === mentionIdx ? "bg-accent/10 text-accent" : "text-txt hover:bg-hover"}`}
                style={{ padding: "10px 14px" }}
              >
                <div className="flex items-center gap-2">
                  <span className={`font-medium truncate ${opt.id === "__all__" ? "text-warning" : opt.id === "host" ? "text-purple" : ""}`}>
                    {opt.label}
                  </span>
                </div>
                <div className="text-xs text-txt-muted mt-0.5">{opt.sub}</div>
              </button>
            ))}
          </div>
        )}
        <textarea
          ref={inputRef}
          value={text} onChange={handleChange} onKeyDown={handleKeyDown}
          placeholder="输入 @ 唤起成员选择...（Enter 发送 · Shift+Enter 换行）" disabled={disabled}
          className="flex-1 resize-none rounded-lg bg-input border-none text-sm text-txt placeholder:text-txt-muted focus:outline-none transition-colors disabled:opacity-50"
          style={{ padding: "12px 16px" }}
        />
        <div className="flex items-center justify-between" style={{ marginTop: 12 }}>
          <div className="flex items-center" style={{ gap: 12 }}>
            <div className="relative">
              <button
                onClick={() => setShowMention(!showMention)}
                disabled={disabled}
                className="text-xs text-txt-sub hover:text-purple transition-colors disabled:opacity-30 rounded-md hover:bg-hover"
                style={{ padding: "6px 10px" }}
              >
                @ 提及
              </button>
            </div>
            <span className="text-xs text-txt-muted">Enter 发送 · Shift+Enter 换行</span>
          </div>
          <button onClick={handleSend} disabled={disabled || !text.trim()}
            className="rounded-lg text-sm font-medium transition-colors shrink-0 disabled:opacity-30 disabled:cursor-not-allowed bg-purple text-white hover:bg-purple/90"
            style={{ padding: "10px 24px" }}
          >
            发送
          </button>
        </div>
      </div>
    </div>
  );
}
