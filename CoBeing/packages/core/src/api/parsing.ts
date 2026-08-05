/**
 * 消息解析工具 — 从 ws-server.ts 提取
 */

/** Extract @mentions from content */
export function extractMentions(content: string): string[] {
  const matches = content.match(/@([\w一-鿿][\w一-鿿-]{2,})/g);
  return matches ? [...new Set(matches.map(m => m.slice(1)))] : [];
}

/** 解析 current.md 内容：支持 JSONL 和 markdown 包裹 JSON 两种格式 */
export function parseCurrentMd(raw: string): unknown[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  /** 将内部消息格式转换为前端 LogMessage 格式 */
  function toFrontendMsg(obj: Record<string, unknown>): Record<string, unknown> {
    const fromAgentId = obj.fromAgentId as string | undefined;
    const direction = obj.direction as string | undefined;
    // Preserve direction/senderId if already in frontend format, otherwise infer
    if (direction) {
      return {
        direction,
        content: obj.content,
        timestamp: obj.timestamp,
        senderId: obj.senderId || obj.senderName || fromAgentId,
      };
    }
    return {
      direction: fromAgentId === "user" ? "in" : "out",
      content: obj.content,
      timestamp: obj.timestamp,
      senderId: fromAgentId,
    };
  }

  // 1. 尝试 markdown 包裹 JSON 格式
  const jsonMatch = trimmed.match(/```json\n([\s\S]*?)\n```/);
  if (jsonMatch) {
    try {
      const data = JSON.parse(jsonMatch[1]);
      if (data.messages && Array.isArray(data.messages)) {
        return data.messages.map((m: Record<string, unknown>) =>
          m.direction ? m : toFrontendMsg(m),
        );
      }
    } catch { /* fall through */ }
  }

  // 2. 尝试 JSONL 格式（每行一个 JSON 对象，来自 CurrentMd.append）
  const lines = trimmed.split("\n").filter(Boolean);
  const messages: unknown[] = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj && typeof obj === "object" && obj.id && obj.content) {
        messages.push(toFrontendMsg(obj));
      }
    } catch { /* skip non-JSON lines (e.g. markdown headers) */ }
  }
  return messages;
}
