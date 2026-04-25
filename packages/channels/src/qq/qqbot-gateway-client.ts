/**
 * QQ Bot 官方 API v2 Gateway 客户端
 * 基于 OpCode 协议的 WebSocket 连接，支持心跳、鉴权、Resume、access_token 自动刷新
 */
import WebSocket from "ws";
import { createLogger } from "@cobeing/shared";

const log = createLogger("qqbot-gateway");

// QQ Bot API v2 OpCode 定义
const OpCode = {
  DISPATCH: 0,       // 服务端推送事件
  HEARTBEAT: 1,      // 客户端发送心跳
  IDENTIFY: 2,       // 客户端发送鉴权
  RESUME: 6,         // 客户端恢复连接
  RECONNECT: 7,      // 服务端通知重连
  INVALID_SESSION: 9, // 鉴权失败/会话无效
  HELLO: 10,         // 服务端发送 Hello
  HEARTBEAT_ACK: 11, // 服务端心跳确认
} as const;

export interface QQBotGatewayConfig {
  appId: string;
  appSecret: string;
  /** 事件订阅 intents，默认 1 << 30 (PUBLIC_GUILD_MESSAGES) */
  intents?: number;
}

interface GatewayPayload {
  id?: string;     // event_id
  op: number;
  d: unknown;
  s?: number;      // 序列号，客户端需记录最新 s 用于心跳和 resume
  t?: string;      // 事件类型，仅在 op=0 时有效
}

interface ReadyData {
  session_id: string;
  user: { id: string; username: string; bot: boolean };
  shard: [number, number];
}

export interface QQBotMessageEvent {
  id: string;
  /** 群聊时为 group_openid，私聊时为空 */
  group_openid?: string;
  /** 频道消息时为 channel_id */
  channel_id?: string;
  /** 频道消息时为 guild_id */
  guild_id?: string;
  content: string;
  author: {
    user_openid?: string;
    member_openid?: string;
    user_id?: string;
  };
  timestamp: string;
  event_type?: string;
}

export class QQBotGatewayClient {
  private config: QQBotGatewayConfig;
  private ws: WebSocket | null = null;
  private accessToken = "";
  private tokenExpiresAt = 0;
  private sessionId: string | null = null;
  private lastSeq: number | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimings = { lastAck: true, intervalMs: 45000 };
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private eventHandler: ((event: string, data: unknown) => void) | null = null;

  constructor(config: QQBotGatewayConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    // 1. 获取 access_token
    await this.refreshAccessToken();

    // 2. 获取 gateway URL
    const gatewayUrl = await this.getGatewayUrl();

    // 3. 建立 WebSocket 连接
    return new Promise((resolve, reject) => {
      log.info("Connecting to gateway: %s", gatewayUrl);
      this.ws = new WebSocket(gatewayUrl);

      this.ws.on("open", () => {
        log.info("WebSocket connected, waiting for Hello...");
      });

      this.ws.on("message", (raw) => {
        try {
          const payload: GatewayPayload = JSON.parse(raw.toString());
          this.handlePayload(payload, resolve, reject);
        } catch (err) {
          log.error("Failed to parse gateway message: %s", err);
        }
      });

      this.ws.on("close", (code, reason) => {
        log.warn("Gateway disconnected: code=%d reason=%s", code, reason);
        this.stopHeartbeat();
        this.scheduleReconnect();
      });

      this.ws.on("error", (err) => {
        log.error("Gateway WS error: %s", err.message);
        reject(err);
      });
    });
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  onEvent(handler: (event: string, data: unknown) => void): void {
    this.eventHandler = handler;
  }

  /** 获取当前有效的 access_token（自动刷新） */
  async getAccessToken(): Promise<string> {
    if (Date.now() >= this.tokenExpiresAt) {
      await this.refreshAccessToken();
    }
    return this.accessToken;
  }

  // ─── 内部方法 ───────────────────────────────────────────

  private async refreshAccessToken(): Promise<void> {
    const res = await fetch("https://bots.qq.com/app/getAppAccessToken", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        appId: this.config.appId,
        clientSecret: this.config.appSecret,
      }),
    });

    if (!res.ok) {
      throw new Error(`Failed to get access token: ${res.status} ${await res.text()}`);
    }

    const data = (await res.json()) as { access_token: string; expires_in: number };
    this.accessToken = data.access_token;
    // 提前 60 秒刷新
    this.tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
    log.info("Access token refreshed, expires in %ds", data.expires_in);
  }

  private async getGatewayUrl(): Promise<string> {
    try {
      const res = await fetch("https://api.sgroup.qq.com/gateway/bot", {
        headers: { Authorization: `QQBot ${this.accessToken}` },
      });
      if (res.ok) {
        const data = (await res.json()) as { url: string };
        return data.url;
      }
    } catch {
      // fallback to default
    }
    return "wss://api.sgroup.qq.com/websocket/";
  }

  private handlePayload(
    payload: GatewayPayload,
    connectResolve: (value: void) => void,
    _connectReject: (err: Error) => void,
  ): void {
    switch (payload.op) {
      case OpCode.HELLO: {
        const helloData = payload.d as { heartbeat_interval: number };
        this.heartbeatTimings.intervalMs = helloData.heartbeat_interval;
        log.info("Hello received, heartbeat_interval=%dms", helloData.heartbeat_interval);

        // 如果有 session_id，尝试 Resume；否则 Identify
        if (this.sessionId && this.lastSeq !== null) {
          this.sendResume();
        } else {
          this.sendIdentify();
        }
        break;
      }

      case OpCode.DISPATCH: {
        if (payload.s != null) {
          this.lastSeq = payload.s;
        }

        if (payload.t === "READY") {
          const ready = payload.d as ReadyData;
          this.sessionId = ready.session_id;
          log.info("Ready: session_id=%s, bot=%s", ready.session_id, ready.user.username);
          this.startHeartbeat();
          connectResolve();
        } else if (payload.t === "RESUMED") {
          log.info("Session resumed");
          this.startHeartbeat();
          connectResolve();
        } else if (payload.t) {
          // 分发事件
          this.eventHandler?.(payload.t, payload.d);
        }
        break;
      }

      case OpCode.HEARTBEAT_ACK: {
        this.heartbeatTimings.lastAck = true;
        break;
      }

      case OpCode.RECONNECT: {
        log.info("Server requested reconnect");
        this.stopHeartbeat();
        this.ws?.close();
        // close handler will trigger reconnect
        break;
      }

      case OpCode.INVALID_SESSION: {
        log.warn("Invalid session (OpCode 9), clearing session and reconnecting");
        this.sessionId = null;
        this.lastSeq = null;
        this.stopHeartbeat();
        this.ws?.close();
        // close handler will trigger reconnect, next time will Identify instead of Resume
        break;
      }

      default:
        log.debug("Unknown OpCode %d", payload.op);
    }
  }

  private sendIdentify(): void {
    // 默认订阅 PUBLIC_GUILD_MESSAGES (1<<30) | GROUP_AND_C2C_EVENT (1<<25)
    const intents = this.config.intents ?? ((1 << 30) | (1 << 25));
    const token = `QQBot ${this.accessToken}`;
    this.send({
      op: OpCode.IDENTIFY,
      d: {
        token,
        intents,
        shard: [0, 1],
      },
    });
    log.info("Identify sent (intents=%d)", intents);
  }

  private sendResume(): void {
    const token = `QQBot ${this.accessToken}`;
    this.send({
      op: OpCode.RESUME,
      d: {
        token,
        session_id: this.sessionId,
        seq: this.lastSeq,
      },
    });
    log.info("Resume sent (session_id=%s, seq=%d)", this.sessionId, this.lastSeq);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimings.lastAck = true;
    this.heartbeatInterval = setInterval(() => {
      if (!this.heartbeatTimings.lastAck) {
        log.warn("Heartbeat ACK missed, reconnecting...");
        this.stopHeartbeat();
        this.ws?.close();
        return;
      }
      this.heartbeatTimings.lastAck = false;
      this.send({ op: OpCode.HEARTBEAT, d: this.lastSeq });
    }, this.heartbeatTimings.intervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private send(data: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      log.info("Reconnecting to gateway...");
      this.connect().catch((err) => {
        log.error("Reconnect failed: %s", err.message);
      });
    }, 5000);
  }
}
