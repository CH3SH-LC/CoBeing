/**
 * 上下文窗口管理 — 裁剪过长的对话历史
 *
 * 裁剪时保证 tool_calls 序列完整性：
 * 如果保留了带 tool_calls 的 assistant 消息，必须保留其后所有对应的 tool 消息。
 */
import type { Message } from "@cobeing/shared";
import { createLogger } from "@cobeing/shared";

const log = createLogger("context");

export class ContextWindow {
  private maxMessages: number;

  constructor(maxMessages = 100) {
    this.maxMessages = maxMessages;
  }

  /** 裁剪消息列表，保留 system 消息、最早消息（前缀稳定区）和最近消息，保证 tool_calls 序列完整 */
  trim(messages: Message[]): Message[] {
    if (messages.length <= this.maxMessages) return messages;

    const systemMsgs = messages.filter(m => m.role === "system");
    const nonSystemMsgs = messages.filter(m => m.role !== "system");
    const keepCount = this.maxMessages - systemMsgs.length;

    if (keepCount <= 0) return systemMsgs;

    // 缓存优化策略：保留前 1/3（前缀稳定区）+ 后 2/3（最近对话）
    const prefixKeep = Math.min(Math.floor(keepCount / 3), nonSystemMsgs.length);
    const suffixKeep = Math.min(keepCount - prefixKeep, nonSystemMsgs.length - prefixKeep);

    const prefix = nonSystemMsgs.slice(0, prefixKeep);
    const suffix = nonSystemMsgs.slice(-suffixKeep);

    // 合并去重（prefix 和 suffix 可能重叠）
    const merged = suffixKeep >= nonSystemMsgs.length - prefixKeep
      ? nonSystemMsgs  // 无重叠，取全部
      : [...prefix, ...suffix];

    // 正向扫描，保证 tool_calls 序列完整且有序
    const result: Message[] = [];
    const seenToolCallIds = new Set<string>();

    for (let i = 0; i < merged.length; i++) {
      const msg = merged[i];

      if (msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0) {
        const requiredIds = new Set(msg.toolCalls.map(tc => tc.id));
        const foundIds = new Set<string>();

        for (let j = i + 1; j < merged.length; j++) {
          const later = merged[j];
          if (later.role === "tool" && later.toolCallId && requiredIds.has(later.toolCallId)) {
            foundIds.add(later.toolCallId);
          }
          if (later.role !== "tool" && foundIds.size < requiredIds.size) break;
        }

        const allPresent = msg.toolCalls.every(tc => foundIds.has(tc.id));
        if (!allPresent) continue;

        for (const tc of msg.toolCalls) {
          seenToolCallIds.add(tc.id);
        }
      }

      if (msg.role === "tool" && msg.toolCallId && !seenToolCallIds.has(msg.toolCallId)) {
        continue;
      }

      result.push(msg);
    }

    log.debug("Trimmed context: %d → %d messages (prefix: %d, suffix: %d)",
      messages.length, systemMsgs.length + result.length, prefixKeep, suffixKeep);

    return [...systemMsgs, ...result];
  }
}
