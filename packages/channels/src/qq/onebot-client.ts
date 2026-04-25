/**
 * OneBot v11 协议客户端 — 通过 WebSocket 连接 NapCat/Lagrange
 */
import WebSocket from "ws";
import { createLogger } from "@cobeing/shared";

const log = createLogger("onebot");

export interface OneBotConfig {
  wsUrl: string;
  accessToken?: string;
}

interface OneBotEvent {
  time: number;
  self_id: number;
  post_type: string;
  message_type?: string;
  sub_type?: string;
  message_id?: number;
  user_id?: number;
  group_id?: number;
  message?: OneBotMessageSegment[];
  raw_message?: string;
  sender?: {
    user_id: number;
    nickname: string;
    card?: string;
  };
}

interface OneBotMessageSegment {
  type: string;
  data: Record<string, string>;
}

// OneBotActionResponse 用于 API 响应（暂未直接引用）

export class OneBotClient {
  private ws: WebSocket | null = null;
  private config: OneBotConfig;
  private messageHandler: ((event: OneBotEvent) => void) | null = null;
  private echoCallbacks = new Map<string, { resolve: (data: unknown) => void; reject: (err: Error) => void }>();
  private echoCounter = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: OneBotConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = {};
      if (this.config.accessToken) {
        headers["Authorization"] = `Bearer ${this.config.accessToken}`;
      }

      this.ws = new WebSocket(this.config.wsUrl, { headers });

      this.ws.on("open", () => {
        log.info("Connected to OneBot: %s", this.config.wsUrl);
        resolve();
      });

      this.ws.on("message", (raw) => {
        try {
          const data = JSON.parse(raw.toString());

          // 响应回调
          if (data.echo) {
            const cb = this.echoCallbacks.get(data.echo);
            if (cb) {
              this.echoCallbacks.delete(data.echo);
              if (data.retcode === 0) cb.resolve(data.data);
              else cb.reject(new Error(`OneBot action failed: ${data.status}`));
            }
            return;
          }

          // 事件分发
          if (data.post_type && this.messageHandler) {
            this.messageHandler(data as OneBotEvent);
          }
        } catch (err) {
          log.error("Failed to parse OneBot message: %s", err);
        }
      });

      this.ws.on("close", (code, reason) => {
        log.warn("OneBot disconnected: code=%d reason=%s", code, reason);
        this.scheduleReconnect();
      });

      this.ws.on("error", (err) => {
        log.error("OneBot WS error: %s", err.message);
        reject(err);
      });
    });
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  onEvent(handler: (event: OneBotEvent) => void): void {
    this.messageHandler = handler;
  }

  /** 发送私聊消息 */
  async sendPrivateMessage(userId: number, message: string): Promise<unknown> {
    return this.callAction("send_private_msg", {
      user_id: userId,
      message: [{ type: "text", data: { text: message } }],
    });
  }

  /** 发送群消息 */
  async sendGroupMessage(groupId: number, message: string): Promise<unknown> {
    return this.callAction("send_group_msg", {
      group_id: groupId,
      message: [{ type: "text", data: { text: message } }],
    });
  }

  /** 回复消息（私聊或群聊） */
  async reply(event: OneBotEvent, message: string): Promise<unknown> {
    if (event.message_type === "group" && event.group_id) {
      return this.sendGroupMessage(event.group_id, message);
    }
    if (event.user_id) {
      return this.sendPrivateMessage(event.user_id, message);
    }
    throw new Error("Cannot determine reply target");
  }

  /** 调用 OneBot Action */
  private callAction(action: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error("OneBot not connected"));
        return;
      }

      const echo = `echo_${++this.echoCounter}`;
      const timeout = setTimeout(() => {
        this.echoCallbacks.delete(echo);
        reject(new Error(`OneBot action timeout: ${action}`));
      }, 30000);

      this.echoCallbacks.set(echo, {
        resolve: (data) => { clearTimeout(timeout); resolve(data); },
        reject: (err) => { clearTimeout(timeout); reject(err); },
      });

      this.ws.send(JSON.stringify({ action, params, echo }));
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      log.info("Reconnecting to OneBot...");
      this.connect().catch(err => {
        log.error("Reconnect failed: %s", err.message);
      });
    }, 5000);
  }
}
