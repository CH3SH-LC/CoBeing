import type { LogMessage } from "./types";

export const statusLabel: Record<string, string> = {
  sending: "发送中...", sent: "已发送", streaming: "回复中...", error: "发送失败",
};
export const statusStyle = (s: string): string => {
  switch (s) {
    case "sending": return "text-txt-muted animate-pulse";
    case "sent": return "text-txt-muted";
    case "streaming": return "text-success animate-pulse";
    case "error": return "text-danger";
    default: return "";
  }
};

export function getSenderDisplay(
  msg: LogMessage,
  fallbackConvId: string | null,
  agents: Array<{ id: string; name: string }>,
  userName: string,
): string {
  if (msg.direction === "in") return msg.senderName || userName;
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

export function formatTime(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}
