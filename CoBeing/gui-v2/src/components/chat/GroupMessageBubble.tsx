import { useState } from "react";
import { MarkdownContent } from "@/components/shared/MarkdownContent";
import type { LogMessage, TaskReceipt } from "@/lib/types";
import { useUserProfileStore } from "@/stores/userProfile";
import { firstDisplayChar } from "@/lib/userProfile";
import { ChatMessageFrame } from "./ChatMessageFrame";
import { TaskReceiptCard } from "./TaskReceiptCard";
import { ToolCallsGroup } from "./ToolCallsGroup";

const TRUNCATE_LEN = 400;

function MessageContent({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);
  if (content.length <= TRUNCATE_LEN) {
    return <MarkdownContent content={content} />;
  }
  return (
    <div>
      {expanded
        ? <MarkdownContent content={content} />
        : <MarkdownContent content={content.slice(0, TRUNCATE_LEN) + "..."} />
      }
      <button
        className="text-xs text-accent hover:underline mt-1"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? "收起" : `展开全部 (${Math.ceil(content.length / 1000)}k 字符)`}
      </button>
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

// Agent identity colors — deterministic by agentId hash
function agentColor(agentId: string): string {
  let hash = 0;
  for (let i = 0; i < agentId.length; i++) {
    hash = ((hash << 5) - hash + agentId.charCodeAt(i)) | 0;
  }
  return `var(--agent-${Math.abs(hash) % 10})`;
}

function highlightMentions(content: string): React.ReactNode[] {
  const parts = content.split(/(@[\w-]+)/g);
  return parts.map((part, i) => {
    if (part.startsWith("@") && part.length > 1) {
      return (
        <span
          key={i}
          className="px-1.5 py-0.5 rounded bg-accent/15 text-accent text-xs font-medium"
        >
          {part}
        </span>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

interface GroupMessageBubbleProps {
  msg: LogMessage;
  senderName?: string;
}

function tryParseTalkSummary(content: string) {
  try {
    const parsed = JSON.parse(content);
    if (parsed?.type === "talk_summary") return parsed;
  } catch {}
  return null;
}

export function GroupMessageBubble({ msg, senderName }: GroupMessageBubbleProps) {
  const userProfile = useUserProfileStore((s) => s.profile);
  const talkSummary = tryParseTalkSummary(msg.content);

  if (talkSummary) {
    return (
      <div className="flex justify-center" style={{ padding: "8px 0" }}>
        <div className="rounded-xl border border-purple/30 bg-purple/5" style={{ padding: "16px 24px", maxWidth: "75%" }}>
          <div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
            <span className="text-xs">💬</span>
            <span className="text-xs font-semibold text-purple">讨论总结</span>
            <span className="text-xs text-txt-muted">· {talkSummary.topic}</span>
          </div>
          <p className="text-sm text-txt leading-relaxed">{talkSummary.conclusion}</p>
          <div className="flex items-center gap-3" style={{ marginTop: 8 }}>
            <span className="text-xs text-txt-muted">
              {talkSummary.participants?.length ?? 0} 人参与 · {talkSummary.messageCount ?? 0} 条消息
            </span>
            <span className="text-xs text-txt-muted">
              {talkSummary.closedAt ? new Date(talkSummary.closedAt).toLocaleString("zh-CN") : ""}
            </span>
          </div>
        </div>
      </div>
    );
  }

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
  const senderId = msg.senderId ?? "unknown";
  const color = isUser ? "var(--color-success)" : agentColor(senderId);

  if (isUser) {
    return (
      <ChatMessageFrame
        side="right"
        senderName={msg.senderName || userProfile.nickname}
        timestamp={formatTime(msg.timestamp)}
        avatar={userProfile.avatar}
        avatarTone="user"
        bubbleTone="user"
        status={
          <>
            {msg.metadata?.reviewOverridden === true && (
              <span className="text-warning text-xs font-medium" title="审核未通过，已强制发布">⚠</span>
            )}
            {msg.status && msg.status !== "done" && (
              <span className={`text-xs ${statusStyle(msg.status)}`}>
                {statusLabel[msg.status]}
              </span>
            )}
            {msg.status === "error" && msg.errorMessage && (
              <span className="text-xs text-danger" title={msg.errorMessage}>
                ({msg.errorMessage.slice(0, 30)})
              </span>
            )}
          </>
        }
      >
          <div className="text-sm text-txt leading-relaxed whitespace-pre-wrap">
            <MessageContent content={msg.content} />
          </div>
      </ChatMessageFrame>
    );
  }

  // Agent message in group — with identity color bar
  return (
    <ChatMessageFrame
      side="left"
      senderName={senderName ?? senderId}
      timestamp={formatTime(msg.timestamp)}
      avatar={{ type: "initial", value: firstDisplayChar(senderName ?? senderId) }}
      avatarTone="group"
      bubbleTone="assistant"
      status={
        msg.metadata?.reviewOverridden === true ? (
          <span className="text-warning text-xs font-medium" title="审核未通过，已强制发布">⚠</span>
        ) : null
      }
    >
      <div className="flex gap-3">
        <div
          className="w-1 rounded-full shrink-0 self-stretch"
          style={{ backgroundColor: color }}
        />
        <div className="flex-1 min-w-0">
          {msg.toolCalls && msg.toolCalls.length > 0 && (
            <ToolCallsGroup toolCalls={msg.toolCalls} />
          )}
          {msg.metadata?.taskReceipt && (
            <TaskReceiptCard receipt={msg.metadata.taskReceipt as TaskReceipt} />
          )}
          {msg.content && (
            <div className="text-sm text-txt leading-relaxed">
              <MessageContent content={msg.content} />
            </div>
          )}
        </div>
      </div>
    </ChatMessageFrame>
  );
}

export { agentColor, highlightMentions };

function formatTime(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}
