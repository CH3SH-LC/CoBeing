/**
 * 消息类型 — conversation 模块内部使用
 */
import type { Message } from "@cobeing/shared";

export interface ConversationMessage extends Message {
  timestamp: number;
}

/** 创建消息的便捷函数 */
export function userMessage(content: string): Message {
  return { role: "user", content, timestamp: Date.now() } as ConversationMessage;
}

export function assistantMessage(content: string): Message {
  return { role: "assistant", content, timestamp: Date.now() } as ConversationMessage;
}

export function systemMessage(content: string): Message {
  return { role: "system", content };
}

export function toolResultMessage(toolCallId: string, content: string, _isError = false): Message {
  return { role: "tool", content, toolCallId, timestamp: Date.now() } as ConversationMessage;
}
