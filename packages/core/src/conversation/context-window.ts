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

  /** 裁剪消息列表，保留 system 消息和最近的消息，保证 tool_calls 序列完整 */
  trim(messages: Message[]): Message[] {
    if (messages.length <= this.maxMessages) return messages;

    const systemMsgs = messages.filter(m => m.role === "system");
    const nonSystemMsgs = messages.filter(m => m.role !== "system");
    const keepCount = this.maxMessages - systemMsgs.length;

    if (keepCount <= 0) return systemMsgs;

    // 1. 向前扩展起点，避免切断 tool_calls 序列尾部
    let startIdx = nonSystemMsgs.length - keepCount;

    // 如果起点是 tool 消息，说明切断了某个 tool_calls 序列，继续向前包含
    while (startIdx > 0 && nonSystemMsgs[startIdx].role === "tool") {
      startIdx--;
    }

    // 2. 从起点开始，移除开头的孤立 tool 消息（其 assistant 不在范围内）
    let trimmed = nonSystemMsgs.slice(startIdx);
    while (trimmed.length > 0 && trimmed[0].role === "tool") {
      trimmed = trimmed.slice(1);
    }

    // 3. 正向扫描，保证 tool_calls 序列完整且有序
    //    assistant+tool_calls 必须有对应的后续 tool 消息，否则跳过该 assistant
    const result: Message[] = [];
    const seenToolCallIds = new Set<string>(); // 已遇到的 tool 响应 ID

    for (let i = 0; i < trimmed.length; i++) {
      const msg = trimmed[i];

      if (msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0) {
        // 收集此 assistant 之后的所有 tool 响应 ID
        const requiredIds = new Set(msg.toolCalls.map(tc => tc.id));
        const foundIds = new Set<string>();

        // 向后扫描 tool 消息
        for (let j = i + 1; j < trimmed.length; j++) {
          const later = trimmed[j];
          if (later.role === "tool" && later.toolCallId && requiredIds.has(later.toolCallId)) {
            foundIds.add(later.toolCallId);
          }
          // 遇到非 tool 消息且还没找全，说明中间插入了其他消息，停止
          if (later.role !== "tool" && foundIds.size < requiredIds.size) break;
        }

        // 检查是否所有 tool_calls 都有对应的后续 tool 响应
        const allPresent = msg.toolCalls.every(tc => foundIds.has(tc.id));
        if (!allPresent) {
          // tool_calls 不完整，跳过这个 assistant
          continue;
        }

        // 标记这些 toolCallId 为已处理
        for (const tc of msg.toolCalls) {
          seenToolCallIds.add(tc.id);
        }
      }

      if (msg.role === "tool" && msg.toolCallId && !seenToolCallIds.has(msg.toolCallId)) {
        // 孤立的 tool 消息（对应的 assistant 被跳过了），跳过
        continue;
      }

      result.push(msg);
    }

    log.debug("Trimmed context: %d → %d messages", messages.length, systemMsgs.length + result.length);

    return [...systemMsgs, ...result];
  }
}
