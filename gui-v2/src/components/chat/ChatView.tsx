import { useChatStore } from "@/stores/chat";
import { useAgentsStore } from "@/stores/agents";
import { useGroupsStore } from "@/stores/groups";
import { useSkillsStore } from "@/stores/skills";
import { useSettingsStore } from "@/stores/settings";
import { getWsClient } from "@/hooks/useWebSocket";
import { startNewConversation } from "@/hooks/useChatPersistence";
import { MarkdownContent } from "@/components/shared/MarkdownContent";
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
      <MessageList messages={messages} streamBuffer={streamBuffer} waiting={waiting} />
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

function MessageList({ messages, streamBuffer, waiting }: {
  messages: LogMessage[]; streamBuffer: string; waiting: boolean;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevLenRef = useRef(messages.length);
  const isFirstRender = useRef(true);

  useEffect(() => {
    const prevLen = prevLenRef.current;
    prevLenRef.current = messages.length;
    const instant = isFirstRender.current || prevLen === 0;
    isFirstRender.current = false;
    bottomRef.current?.scrollIntoView({ behavior: instant ? "instant" as ScrollBehavior : "smooth" });
  }, [messages, streamBuffer]);

  if (messages.length === 0 && !waiting) {
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
        {waiting && <ThinkingBubble buffer={streamBuffer} />}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

const statusLabel: Record<string, string> = {
  sending: "发送中...", sent: "已发送", streaming: "回复中...", error: "发送失败",
};
const statusStyle = (s: string): string => {
  switch (s) {
    case "sending": return "text-txt-muted animate-pulse";
    case "sent": return "text-txt-muted";
    case "streaming": return "text-success animate-pulse";
    case "error": return "text-danger";
    default: return "";
  }
};

function getSenderDisplay(msg: LogMessage, fallbackConvId: string | null, agents: Array<{ id: string; name: string }>): string {
  if (msg.direction === "in") return msg.senderName || "你";
  // For outbound: prefer persisted senderName, then senderId lookup in agent store, then convId, then fallback
  if (msg.senderName) return msg.senderName;
  const lookupId = msg.senderId || fallbackConvId;
  if (lookupId) {
    const agent = agents.find((a) => a.id === lookupId);
    if (agent?.name) return agent.name;
    return lookupId;
  }
  return "Assistant";
}

function MessageBubble({ msg }: { msg: LogMessage }) {
  const activeConv = useChatStore((s) => s.activeConversation);
  const agents = useAgentsStore((s) => s.agents);
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
  const senderName = getSenderDisplay(msg, activeConv, agents);

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`} style={isUser ? { paddingRight: 40 } : { paddingLeft: 40 }}>
      <div className={`max-w-[70%] rounded-2xl ${isUser ? "bg-msg-user rounded-br-sm" : "bg-msg-assistant rounded-bl-sm"}`}
           style={{ padding: "16px 24px" }}>
        <div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
          <span className={`text-sm font-bold ${isUser ? "text-accent" : "text-success"}`}>
            {senderName}
          </span>
          <span className="text-xs text-txt-muted">{formatTime(msg.timestamp)}</span>
          {isUser && msg.status && msg.status !== "done" && (
            <span className={`text-xs ${statusStyle(msg.status)}`}>
              {statusLabel[msg.status]}
            </span>
          )}
          {isUser && msg.status === "error" && msg.errorMessage && (
            <span className="text-xs text-danger" title={msg.errorMessage}>
              ({msg.errorMessage.slice(0, 30)})
            </span>
          )}
        </div>
        {!isUser && msg.toolCalls && msg.toolCalls.length > 0 && (
          <ToolCallsGroup toolCalls={msg.toolCalls} />
        )}
        <div className="text-sm text-txt leading-relaxed">
          {isUser ? <div className="whitespace-pre-wrap">{msg.content}</div> : <MarkdownContent content={msg.content} />}
        </div>
      </div>
    </div>
  );
}

function ToolCallsGroup({ toolCalls }: { toolCalls: import("@/lib/types").ToolEvent[] }) {
  const [expanded, setExpanded] = useState(false);
  const [expandedTool, setExpandedTool] = useState<number | null>(null);

  const completed = toolCalls.filter(t => t.status !== "start").length;
  const running = toolCalls.filter(t => t.status === "start").length;

  return (
    <div className="rounded-xl bg-msg-tool mb-4" style={{ padding: "10px 14px" }}>
      <div
        className="flex items-center gap-2 cursor-pointer select-none"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="text-sm">{running > 0 ? "🔄" : "✅"}</span>
        <span className="text-xs font-medium text-success">
          {completed}/{toolCalls.length} 次工具调用
        </span>
        {running > 0 && (
          <span className="text-xs text-txt-muted">({running} 执行中)</span>
        )}
        <span className="text-xs text-txt-muted ml-auto">
          {expanded ? "收起 ▲" : "展开 ▼"}
        </span>
      </div>
      {expanded && (
        <div className="mt-3 pt-3 border-t border-bdr" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {toolCalls.map((tc, i) => {
            const icon = tc.status === "start" ? "🔄" : tc.status === "error" ? "❌" : "✅";
            const isToolExpanded = expandedTool === i;
            return (
              <div key={i} className="text-xs">
                <div
                  className="flex items-center gap-2 cursor-pointer font-mono text-success"
                  onClick={() => setExpandedTool(isToolExpanded ? null : i)}
                >
                  <span>{icon}</span>
                  <span className="font-medium">{tc.toolName}</span>
                  <span className="text-txt-muted">
                    {tc.status === "start" ? "执行中..." : tc.status === "error" ? "失败" : "完成"}
                  </span>
                </div>
                {isToolExpanded && (
                  <div className="mt-2 ml-6 p-3 rounded-lg bg-hover font-mono text-txt-sub">
                    {tc.params && Object.keys(tc.params).length > 0 && (
                      <div className="mb-2">
                        <div className="text-txt-muted mb-1">参数:</div>
                        <pre className="whitespace-pre-wrap break-all">{JSON.stringify(tc.params, null, 2)}</pre>
                      </div>
                    )}
                    {tc.result && (
                      <div>
                        <div className="text-txt-muted mb-1">结果:</div>
                        <pre className="whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
                          {tc.result.length > 300 ? tc.result.slice(0, 300) + "\n..." : tc.result}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ThinkingBubble({ buffer }: { buffer: string }) {
  const activeConv = useChatStore((s) => s.activeConversation);
  const agents = useAgentsStore((s) => s.agents);
  const senderName = getSenderDisplay({ direction: "out" } as LogMessage, activeConv, agents);

  return (
    <div className="flex justify-start" style={{ paddingLeft: 40 }}>
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

const SLASH_COMMANDS = [
  { cmd: "/new", label: "新建对话", desc: "开始一个新的对话会话" },
  { cmd: "/clear", label: "清空上下文", desc: "清除当前对话的上下文记忆" },
  { cmd: "/bind", label: "绑定工作目录", desc: "绑定当前 Agent 到外部项目文件夹" },
  { cmd: "/unbind", label: "解绑工作目录", desc: "恢复默认工作区" },
  { cmd: "/skills", label: "查看技能列表", desc: "列出当前可用的技能" },
] as const;

function ChatInput({ disabled, targetConvId }: { disabled: boolean; targetConvId?: string | null }) {
  const [text, setText] = useState("");
  const [showSkillMenu, setShowSkillMenu] = useState(false);
  const [showMentionMenu, setShowMentionMenu] = useState(false);
  const [slashIdx, setSlashIdx] = useState(-1);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
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
    addMessage({ direction: "in", content, timestamp: Date.now(), status: "sending" });
    startWaiting();
    setText("");
    getWsClient()?.send({ type: "send_message", payload: { agentId: convId, content } });
  };

  const handleSlashSelect = (cmd: string) => {
    setText(cmd + " ");
    setShowSlashMenu(false);
    setSlashIdx(-1);
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    setText(v);
    // 检测斜杠命令：第一个字符为 /
    if (v.length === 1 && v[0] === "/") {
      setShowSlashMenu(true);
      setSlashIdx(0);
    } else if (!v.startsWith("/")) {
      setShowSlashMenu(false);
      setSlashIdx(-1);
    } else if (v.startsWith("/")) {
      // 保持菜单开启，匹配过滤
      setShowSlashMenu(true);
    }
  };

  const filteredCmds = SLASH_COMMANDS.filter((c) =>
    text.startsWith("/") ? c.cmd.startsWith(text.split(" ")[0]) : true
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showSlashMenu) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSlashIdx((i) => Math.min(i + 1, filteredCmds.length - 1)); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setSlashIdx((i) => Math.max(i - 1, 0)); return; }
      if (e.key === "Tab" || e.key === "Enter") {
        e.preventDefault();
        if (filteredCmds[slashIdx]) handleSlashSelect(filteredCmds[slashIdx].cmd);
        return;
      }
      if (e.key === "Escape") { setShowSlashMenu(false); setSlashIdx(-1); return; }
    }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
    if (e.key === "Escape") { setShowSkillMenu(false); setShowMentionMenu(false); setShowSlashMenu(false); }
  };

  const insertSkill = (skillName: string) => { setText((t) => t + `{{skill:${skillName}}} `); setShowSkillMenu(false); };
  const insertMention = (agentId: string) => { setText((t) => t.replace(/@$/, "") + `@${agentId} `); setShowMentionMenu(false); };

  return (
    <div className="flex justify-center">
      <div className="rounded-xl bg-surface flex flex-col border border-bdr/40 relative"
           style={{ boxShadow: "var(--shadow-surface)", padding: 20, width: "60%", minHeight: 140 }}>
        {/* 斜杠命令菜单 */}
        {showSlashMenu && !isGroupChat && filteredCmds.length > 0 && (
          <div className="absolute rounded-lg bg-elevated border border-bdr shadow-lg z-10 overflow-hidden"
               style={{ bottom: "100%", left: 20, marginBottom: 4, width: 260 }}>
            {filteredCmds.map((c, i) => (
              <button key={c.cmd}
                onClick={() => handleSlashSelect(c.cmd)}
                onMouseEnter={() => setSlashIdx(i)}
                className={`w-full text-left transition-colors ${i === slashIdx ? "bg-accent/10" : "hover:bg-hover"}`}
                style={{ padding: "10px 14px" }}
              >
                <div className="text-sm font-medium text-txt">{c.cmd}</div>
                <div className="text-xs text-txt-muted mt-0.5">{c.desc}</div>
              </button>
            ))}
          </div>
        )}
        <textarea
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="输入消息...（输入 / 打开命令菜单）"
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
