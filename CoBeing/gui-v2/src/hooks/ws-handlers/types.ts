import type { AgentInfo, GroupInfo, LogMessage, ToolEvent, WsMessage } from "@/lib/types";
import type { TodoItemData } from "@/stores/todo";
import type { ProviderEntry, ChannelEntry, McpEntry } from "@/stores/config";

/**
 * WS 消息处理器。
 *
 * 接收完整 `WsMessage`（而非仅 payload），因为部分 handler 需要把原始 msg
 * 整体广播到 `window.dispatchEvent(new CustomEvent("ws-...", { detail: msg }))`。
 */
export type WsMessageHandler = (msg: WsMessage) => void;

/** updateMsgStatus 的 status 取值 */
export type MessageStatus = "sent" | "streaming" | "done" | "error";

/**
 * 共享上下文：useWebSocket useEffect 闭包中被各 handler 使用的 ref 与 store 引用。
 */
export interface WsHandlerContext {
  // ── refs ──
  streamStartedRef: { current: boolean };
  stateRetryCount: { current: number };
  stateRetryTimer: { current: ReturnType<typeof setTimeout> | null };

  // ── store actions（来自 useWebSocket 的 selector） ──
  setConnected: (connected: boolean) => void;
  setAgents: (agents: AgentInfo[]) => void;
  setGroups: (groups: GroupInfo[]) => void;
  addMessage: (msg: LogMessage, conversationId?: string, opts?: { countUnread?: boolean }) => void;
  addToolEvent: (event: ToolEvent, conversationId?: string) => void;
  appendStreamToken: (token: string, conversationId?: string) => void;
  finalizeStream: (content: string, senderId?: string, senderName?: string, conversationId?: string) => void;
  startWaiting: (conversationId?: string) => void;
  finishWaiting: (conversationId?: string) => void;
  loadFromCurrent: (data: { conversations: Record<string, LogMessage[]> }, agentsSnapshot?: Array<{ id: string; name: string }>) => void;
  clearMessages: (conversationId?: string) => void;
  setTodos: (todos: TodoItemData[]) => void;
  setConfig: (config: {
    providers?: Record<string, ProviderEntry>;
    channels?: Record<string, ChannelEntry>;
    mcpServers?: Record<string, McpEntry>;
  }) => void;
  updateMsgStatus: (convId: string, status: MessageStatus, errorMessage?: string) => void;

  // ── 发送 WS 消息（封装模块级 wsClient，未连接时静默丢弃） ──
  send: (msg: { type: string; payload?: unknown }) => void;
}
