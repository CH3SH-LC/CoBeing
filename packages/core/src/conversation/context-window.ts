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

    // 3. 从后往前扫描，移除 tool_calls 不完整的 assistant 消息
    //    如果 assistant 有 tool_calls，检查后续 tool 消息是否齐全
    const result: Message[] = [];
    const pendingToolCallIds = new Set<string>();

    // 先收集所有 tool 消息的 toolCallId
    for (const msg of trimmed) {
      if (msg.role === "tool" && msg.toolCallId) {
        pendingToolCallIds.add(msg.toolCallId);
      }
    }

    // 正向处理：assistant+tool_calls 如果对应的 tool 消息不全，跳过该 assistant
    const processedToolCallIds = new Set<string>();
    for (let i = 0; i < trimmed.length; i++) {
      const msg = trimmed[i];

      if (msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0) {
        // 检查每个 toolCall 是否都有对应的 tool 消息
        const allPresent = msg.toolCalls.every(tc => pendingToolCallIds.has(tc.id));
        if (!allPresent) {
          // tool_calls 不完整，跳过这个 assistant 消息
          // 同时跳过后续紧跟着的 tool 消息
          continue;
        }
        // 标记这些 toolCallId 已被处理
        for (const tc of msg.toolCalls) {
          processedToolCallIds.add(tc.id);
        }
      }

      if (msg.role === "tool" && msg.toolCallId && !processedToolCallIds.has(msg.toolCallId)) {
        // 孤立的 tool 消息（对应的 assistant 被跳过了），跳过
        continue;
      }

      result.push(msg);
    }

    log.debug("Trimmed context: %d → %d messages", messages.length, systemMsgs.length + result.length);

    return [...systemMsgs, ...result];
  }
}
