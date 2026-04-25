import { useChatStore } from "@/stores/chat";
import { useAgentsStore } from "@/stores/agents";
import { useGroupsStore } from "@/stores/groups";
import { useSkillsStore } from "@/stores/skills";
import { useSettingsStore } from "@/stores/settings";
import { getWsClient } from "@/hooks/useWebSocket";
import { startNewConversation } from "@/hooks/useChatPersistence";
import { MarkdownContent } from "@/components/shared/MarkdownContent";
import { ToolCallMessage } from "@/components/chat/ToolCallMessage";
import { useState, useRef, useEffect } from "react";
import type { LogMessage } from "@/lib/types";


interface ChatViewProps {
  targetAgentId?: string;
}

export function ChatView({ targetAgentId }: ChatViewProps) {
  const messages = useChatStore((s) => s.messages);
  const streamBuffer = useChatStore((s) => s.streamBuffer);
  const waiting = useChatStore((s) => s.waitingForResponse);
  const activeConv = useChatStore((s) => s.activeConversation);
  const toolEvents = useChatStore((s) => s.toolEvents);
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
  const canSend = connected && !!convId;

  return (
    <div className="flex-1 flex flex-col h-full min-h-0" style={{ padding: 20, gap: 20 }}>
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
      />
      <MessageList messages={messages} toolEvents={toolEvents} streamBuffer={streamBuffer} waiting={waiting} />
      <ChatInput disabled={!canSend} targetConvId={convId} />
    </div>
  );
}

function ChatHeader({ name, status, model, provider, connected, isGroup, memberCount, showConfigButton, configOpen, onToggleConfig, activeView }: {
  name?: string; status?: string; model?: string; provider?: string;
  connected: boolean; isGroup: boolean; memberCount?: number;
  showConfigButton: boolean; configOpen: boolean; onToggleConfig: () => void; activeView: string;
}) {
  const statusColors: Record<string, string> = {
    idle: "bg-success", running: "bg-warning animate-pulse", error: "bg-danger",
  };

  return (
    <div className="flex items-center rounded-xl bg-surface shrink-0 border border-bdr/40"
         style={{ boxShadow: "var(--shadow-surface)", padding: "16px 24px" }}>
      {name ? (
        <>
          <div className="relative">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-sm font-medium ${isGroup ? "bg-purple/10 text-purple" : "bg-accent/10 text-accent"}`}>
              {isGroup ? "👥" : (name[0])}
            </div>
            {!isGroup && status && (
              <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-surface-solid ${statusColors[status] ?? "bg-txt-muted"}`} />
            )}
          </div>
          <div style={{ marginLeft: 16 }}>
            <p className={`text-sm font-medium ${isGroup ? "text-purple" : "text-txt"}`}>{name}</p>
            <p className="text-xs text-txt-muted" style={{ marginTop: 4 }}>
              {isGroup ? `${memberCount} 成员` : `${provider} / ${model} · ${status}`}
            </p>
          </div>
        </>
      ) : (
        <div className="flex-1 text-center" style={{ padding: "8px 0" }}>
          <p className="text-sm text-txt-muted">
            {activeView === "butler" ? "管家已就绪" : "选择一个 Agent 或群组开始对话"}
          </p>
        </div>
      )}
      <div className="ml-auto flex items-center" style={{ gap: 12 }}>
        {showConfigButton && (
          <button
            onClick={() => { startNewConversation(); }}
            className="rounded-lg flex items-center justify-center text-xs transition-colors text-txt-sub hover:bg-hover hover:text-txt"
            style={{ padding: "8px 14px" }}
          >
            + 新对话
          </button>
        )}
        {showConfigButton && (
          <button
            onClick={onToggleConfig}
            className={`rounded-lg flex items-center justify-center text-sm transition-colors ${
              configOpen ? "bg-accent/15 text-accent" : "text-txt-muted hover:bg-hover hover:text-txt"
            }`}
            style={{ width: 36, height: 36 }}
          >
            ⚙
          </button>
        )}
        <div className={`w-2.5 h-2.5 rounded-full ${connected ? "bg-success" : "bg-danger"}`} />
        <span className="text-xs text-txt-muted">{connected ? "已连接" : "离线"}</span>
      </div>
    </div>
  );
}

function MessageList({ messages, toolEvents, streamBuffer, waiting }: {
  messages: LogMessage[]; toolEvents: import("@/lib/types").ToolEvent[];
  streamBuffer: string; waiting: boolean;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamBuffer, toolEvents]);

  if (messages.length === 0 && !waiting && toolEvents.length === 0) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center">
        <p className="text-txt-muted text-sm">开始新的对话</p>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto" style={{ padding: "24px 20px" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {messages.map((msg, i) => (
          <MessageBubble key={i} msg={msg} />
        ))}
        {toolEvents.map((te, i) => (
          <ToolCallMessage key={`tool-${i}`} toolName={te.toolName} params={te.params as Record<string, unknown>} result={te.result} status={te.status} />
        ))}
        {waiting && <ThinkingBubble buffer={streamBuffer} />}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

function MessageBubble({ msg }: { msg: LogMessage }) {
  if (msg.direction === "system") {
    return (
      <div className="flex justify-center" style={{ padding: "8px 0" }}>
        <div className="rounded-full bg-msg-system/60 text-xs text-accent-warm" style={{ padding: "8px 20px" }}>
          {msg.content}
        </div>
      </div>
    );
  }

  const isUser = msg.direction === "in";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`} style={isUser ? { paddingRight: 40 } : { paddingLeft: 40 }}>
      <div className={`max-w-[70%] rounded-2xl ${isUser ? "bg-msg-user rounded-br-sm" : "bg-msg-assistant rounded-bl-sm"}`}
           style={{ padding: "16px 24px" }}>
        <div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
          <span className={`text-xs font-medium ${isUser ? "text-accent" : "text-success"}`}>
            {isUser ? "你" : "Assistant"}
          </span>
          <span className="text-xs text-txt-muted">{formatTime(msg.timestamp)}</span>
        </div>
        <div className="text-sm text-txt leading-relaxed">
          {isUser ? <div className="whitespace-pre-wrap">{msg.content}</div> : <MarkdownContent content={msg.content} />}
        </div>
      </div>
    </div>
  );
}

function ThinkingBubble({ buffer }: { buffer: string }) {
  return (
    <div className="flex justify-start" style={{ paddingLeft: 40 }}>
      <div className="max-w-[70%] rounded-2xl rounded-bl-sm bg-msg-assistant" style={{ padding: "16px 24px" }}>
        <div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-success" />
          </span>
          <span className="text-xs font-medium text-success">
            {buffer ? "Assistant (streaming)" : "Thinking..."}
          </span>
        </div>
        <div className="text-sm text-txt leading-relaxed">
          {buffer ? <MarkdownContent content={buffer} /> : "思考中..."}
        </div>
      </div>
    </div>
  );
}

function ChatInput({ disabled, targetConvId }: { disabled: boolean; targetConvId?: string | null }) {
  const [text, setText] = useState("");
  const [showSkillMenu, setShowSkillMenu] = useState(false);
  const [showMentionMenu, setShowMentionMenu] = useState(false);
  const activeConv = useChatStore((s) => s.activeConversation);
  const startWaiting = useChatStore((s) => s.startWaiting);
  const addMessage = useChatStore((s) => s.addMessage);
  const agents = useAgentsStore((s) => s.agents);
  const groups = useGroupsStore((s) => s.groups);
  const skills = useSkillsStore((s) => s.skills);
  const convId = targetConvId || activeConv;
  const isGroupChat = !!groups.find((g) => g.id === convId);

  const handleSend = () => {
    const content = text.trim();
    if (!content || !convId || disabled) return;
    addMessage({ direction: "in", content, timestamp: Date.now() });
    startWaiting();
    setText("");
    getWsClient()?.send({ type: "send_message", payload: { agentId: convId, content } });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
    if (e.key === "Escape") { setShowSkillMenu(false); setShowMentionMenu(false); }
  };

  const insertSkill = (skillName: string) => { setText((t) => t + `{{skill:${skillName}}} `); setShowSkillMenu(false); };
  const insertMention = (agentId: string) => { setText((t) => t + `@${agentId} `); setShowMentionMenu(false); };

  return (
    <div className="flex justify-center">
      <div className="rounded-xl bg-surface flex flex-col border border-bdr/40"
           style={{ boxShadow: "var(--shadow-surface)", padding: 20, width: "60%", minHeight: 140 }}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入消息..."
          disabled={disabled}
          className="flex-1 resize-none rounded-lg bg-input border-none text-sm text-txt placeholder:text-txt-muted focus:outline-none transition-colors disabled:opacity-50"
          style={{ padding: "12px 16px" }}
        />
        <div className="flex items-center justify-between" style={{ marginTop: 12 }}>
          <div className="flex items-center" style={{ gap: 12 }}>
            <div className="relative">
              <button
                onClick={() => { setShowSkillMenu(!showSkillMenu); setShowMentionMenu(false); }}
                disabled={disabled || skills.length === 0}
                className="text-xs text-txt-sub hover:text-accent transition-colors disabled:opacity-30 rounded-md hover:bg-hover"
                style={{ padding: "6px 10px" }}
              >
                {"\u26A1"} 技能
              </button>
              {showSkillMenu && skills.length > 0 && (
                <div className="absolute bottom-full left-0 rounded-lg bg-elevated border border-bdr shadow-lg z-10 overflow-y-auto"
                     style={{ marginBottom: 8, width: 200, maxHeight: 160 }}>
                  {skills.map((s) => (
                    <button key={s.name} onClick={() => insertSkill(s.name)}
                      className="w-full text-left text-xs text-txt hover:bg-hover transition-colors truncate"
                      style={{ padding: "10px 14px" }}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {isGroupChat && (
              <div className="relative">
                <button
                  onClick={() => { setShowMentionMenu(!showMentionMenu); setShowSkillMenu(false); }}
                  disabled={disabled}
                  className="text-xs text-txt-sub hover:text-purple transition-colors disabled:opacity-30 rounded-md hover:bg-hover"
                  style={{ padding: "6px 10px" }}
                >
                  @ 提及
                </button>
                {showMentionMenu && (
                  <div className="absolute bottom-full left-0 rounded-lg bg-elevated border border-bdr shadow-lg z-10 overflow-y-auto"
                       style={{ marginBottom: 8, width: 200, maxHeight: 160 }}>
                    {agents.filter((a) => a.id !== "butler").map((a) => (
                      <button key={a.id} onClick={() => insertMention(a.id)}
                        className="w-full text-left text-xs text-txt hover:bg-hover transition-colors truncate"
                        style={{ padding: "10px 14px" }}
                      >
                        {a.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <span className="text-xs text-txt-muted">Enter 发送 · Shift+Enter 换行</span>
          </div>
          <button
            onClick={handleSend}
            disabled={disabled || !text.trim()}
            className="rounded-lg text-sm font-medium transition-colors shrink-0 disabled:opacity-30 disabled:cursor-not-allowed bg-accent text-white hover:bg-accent/90"
            style={{ padding: "10px 24px" }}
          >
            发送
          </button>
        </div>
      </div>
    </div>
  );
}

function formatTime(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}
