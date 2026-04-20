import { useChatStore } from "@/stores/chat";
import { useAgentsStore } from "@/stores/agents";
import { useSettingsStore } from "@/stores/settings";
import { getWsClient } from "@/hooks/useWebSocket";
import { MarkdownContent } from "@/components/shared/MarkdownContent";
import { useState, useRef, useEffect } from "react";
import type { LogMessage } from "@/lib/types";

export function ChatView() {
  const messages = useChatStore((s) => s.messages);
  const streamBuffer = useChatStore((s) => s.streamBuffer);
  const waiting = useChatStore((s) => s.waitingForResponse);
  const agents = useAgentsStore((s) => s.agents);
  const selectedAgent = useAgentsStore((s) => s.selectedAgent);
  const connected = useSettingsStore((s) => s.connected);

  const agent = agents.find((a) => a.id === selectedAgent);

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Header */}
      <ChatHeader agent={agent} connected={connected} />

      {/* Messages */}
      <MessageList messages={messages} streamBuffer={streamBuffer} waiting={waiting} />

      {/* Input */}
      <ChatInput disabled={!connected || !selectedAgent} />
    </div>
  );
}

function ChatHeader({ agent, connected }: { agent: { id: string; name: string; status: string; model: string; provider: string } | undefined; connected: boolean }) {
  if (!agent) {
    return (
      <div className="h-14 flex items-center justify-center border-b border-bdr bg-bg-surface">
        <div className="text-center">
          <p className="text-lg text-accent font-bold font-display">MyAgents</p>
          <p className="text-xs text-txt-muted">选择一个 Agent 开始对话</p>
        </div>
      </div>
    );
  }

  const statusColors: Record<string, string> = {
    idle: "bg-success",
    running: "bg-warning animate-pulse",
    error: "bg-danger",
  };

  return (
    <div className="h-14 flex items-center px-4 gap-3 border-b border-bdr bg-bg-surface shrink-0">
      <div className="relative">
        <div className="w-9 h-9 rounded-lg bg-accent/10 flex items-center justify-center text-accent text-sm font-medium">
          {agent.name[0]}
        </div>
        <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-bg-surface ${statusColors[agent.status] ?? "bg-txt-muted"}`} />
      </div>
      <div>
        <p className="text-sm text-txt font-medium">{agent.name}</p>
        <p className="text-[11px] text-txt-muted">
          {agent.provider} / {agent.model} · {agent.status}
        </p>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${connected ? "bg-success" : "bg-danger"}`} />
        <span className="text-[11px] text-txt-muted">{connected ? "已连接" : "离线"}</span>
      </div>
    </div>
  );
}

function MessageList({ messages, streamBuffer, waiting }: {
  messages: LogMessage[];
  streamBuffer: string;
  waiting: boolean;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamBuffer]);

  if (messages.length === 0 && !waiting) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-txt-muted text-sm">开始新的对话</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
      {messages.map((msg, i) => (
        <MessageBubble key={i} msg={msg} />
      ))}
      {waiting && (
        <ThinkingBubble buffer={streamBuffer} />
      )}
      <div ref={bottomRef} />
    </div>
  );
}

function MessageBubble({ msg }: { msg: LogMessage }) {
  if (msg.direction === "system") {
    return (
      <div className="flex justify-center">
        <div className="px-3 py-1.5 rounded-full bg-msg-system/60 text-[11px] text-accent-warm">
          {msg.content}
        </div>
      </div>
    );
  }

  const isUser = msg.direction === "in";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[72%] rounded-xl px-4 py-3 ${
          isUser
            ? "bg-msg-user rounded-br-sm"
            : "bg-msg-assistant rounded-bl-sm"
        }`}
      >
        <div className="flex items-center gap-2 mb-1">
          <span className={`text-[11px] font-medium ${isUser ? "text-accent" : "text-success"}`}>
            {isUser ? "你" : "Assistant"}
          </span>
          <span className="text-[10px] text-txt-muted">{formatTime(msg.timestamp)}</span>
        </div>
        <div className="text-sm text-txt leading-relaxed">
          {isUser ? (
            <div className="whitespace-pre-wrap">{msg.content}</div>
          ) : (
            <MarkdownContent content={msg.content} />
          )}
        </div>
      </div>
    </div>
  );
}

function ThinkingBubble({ buffer }: { buffer: string }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[72%] rounded-xl rounded-bl-sm bg-msg-assistant px-4 py-3">
        <div className="flex items-center gap-2 mb-1">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-success" />
          </span>
          <span className="text-[11px] font-medium text-success">
            {buffer ? "Assistant (streaming)" : "Thinking..."}
          </span>
        </div>
        <div className="text-sm text-txt leading-relaxed">
          {buffer ? (
            <MarkdownContent content={buffer} />
          ) : (
            "思考中..."
          )}
        </div>
      </div>
    </div>
  );
}

function ChatInput({ disabled }: { disabled: boolean }) {
  const [text, setText] = useState("");
  const selectedAgent = useAgentsStore((s) => s.selectedAgent);
  const startWaiting = useChatStore((s) => s.startWaiting);
  const addMessage = useChatStore((s) => s.addMessage);

  const handleSend = () => {
    const content = text.trim();
    if (!content || !selectedAgent || disabled) return;

    // Add user message to local state
    addMessage({ direction: "in", content, timestamp: Date.now() });
    startWaiting();
    setText("");

    // Send via WebSocket
    getWsClient()?.send({
      type: "send_message",
      payload: { agentId: selectedAgent, content },
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="shrink-0 border-t border-bdr bg-bg-surface p-3">
      <div className="flex gap-2 items-end">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入消息..."
          disabled={disabled}
          rows={1}
          className="flex-1 resize-none rounded-lg bg-bg-input border border-bdr px-3 py-2 text-sm text-txt placeholder:text-txt-muted focus:outline-none focus:border-accent/50 transition-colors disabled:opacity-50"
          style={{ maxHeight: 120 }}
        />
        <button
          onClick={handleSend}
          disabled={disabled || !text.trim()}
          className="h-9 px-4 rounded-lg text-xs font-medium transition-colors shrink-0 disabled:opacity-30 disabled:cursor-not-allowed bg-accent text-white hover:bg-accent/90"
        >
          发送
        </button>
      </div>
      <div className="flex items-center gap-3 mt-1.5 px-1">
        <span className="text-[10px] text-txt-muted">Enter 发送 · Shift+Enter 换行</span>
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
