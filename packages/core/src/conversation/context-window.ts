/**
 * 上下文窗口管理 — 裁剪过长的对话历史
 */
import type { Message } from "@myagents/shared";
import { createLogger } from "@myagents/shared";

const log = createLogger("context");

export class ContextWindow {
  private maxMessages: number;

  constructor(maxMessages = 100) {
    this.maxMessages = maxMessages;
  }

  /** 裁剪消息列表，保留 system 消息和最近的消息 */
  trim(messages: Message[]): Message[] {
    if (messages.length <= this.maxMessages) return messages;

    const systemMsgs = messages.filter(m => m.role === "system");
    const nonSystemMsgs = messages.filter(m => m.role !== "system");
    const trimmed = nonSystemMsgs.slice(-(this.maxMessages - systemMsgs.length));

    log.debug("Trimmed context: %d → %d messages", messages.length, systemMsgs.length + trimmed.length);

    return [...systemMsgs, ...trimmed];
  }
}
