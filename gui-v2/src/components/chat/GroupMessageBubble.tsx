import { MarkdownContent } from "@/components/shared/MarkdownContent";
import type { LogMessage } from "@/lib/types";

// Agent identity colors — deterministic by agentId hash
const AGENT_COLORS = [
  "#6EE7B7", "#F0A080", "#C4B5FD", "#67E8F9", "#FCA5A5",
  "#FDE68A", "#A5B4FC", "#86EFAC", "#FDA4AF", "#D8B4FE",
];

function agentColor(agentId: string): string {
  let hash = 0;
  for (let i = 0; i < agentId.length; i++) {
    hash = ((hash << 5) - hash + agentId.charCodeAt(i)) | 0;
  }
  return AGENT_COLORS[Math.abs(hash) % AGENT_COLORS.length];
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

export function GroupMessageBubble({ msg, senderName }: GroupMessageBubbleProps) {
  if (msg.direction === "system") {
    return (
      <div className="flex justify-center py-2">
        <div className="px-4 py-2 rounded-full bg-msg-system/60 text-xs text-accent-warm">
          {msg.content}
        </div>
      </div>
    );
  }

  const isUser = msg.direction === "in";
  const senderId = msg.senderId ?? "assistant";
  const color = isUser ? "#6EE7B7" : agentColor(senderId);

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[72%] rounded-xl rounded-br-sm bg-msg-user px-5 py-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-medium text-accent">你</span>
            <span className="text-xs text-txt-muted">{formatTime(msg.timestamp)}</span>
          </div>
          <div className="text-sm text-txt leading-relaxed whitespace-pre-wrap">
            {msg.content}
          </div>
        </div>
      </div>
    );
  }

  // Agent message in group — with identity color bar
  return (
    <div className="flex justify-start">
      <div className="max-w-[72%] flex gap-3">
        {/* Left identity bar */}
        <div
          className="w-1 rounded-full shrink-0 self-stretch"
          style={{ backgroundColor: color }}
        />
        <div className="rounded-xl rounded-bl-sm bg-msg-assistant px-5 py-4 flex-1">
          <div className="flex items-center gap-2 mb-2">
            <span
              className="text-xs font-medium"
              style={{ color }}
            >
              {senderName ?? senderId}
            </span>
            <span className="text-xs text-txt-muted">{formatTime(msg.timestamp)}</span>
          </div>
          <div className="text-sm text-txt leading-relaxed">
            <MarkdownContent content={msg.content} />
          </div>
        </div>
      </div>
    </div>
  );
}

export { agentColor, highlightMentions };

function formatTime(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}
