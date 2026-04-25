/**
 * Discord Gateway + REST 客户端
 * 使用原生 WebSocket 和 fetch
 */
import WebSocket from "ws";
import { createLogger } from "@cobeing/shared";

const log = createLogger("discord-client");

export interface DiscordConfig {
  botToken: string;
}

interface DiscordMessage {
  id: string;
  channel_id: string;
  author: { id: string; username: string; bot?: boolean };
  content: string;
  guild_id?: string;
  member?: { nick?: string };
}

export class DiscordClient {
  private ws: WebSocket | null = null;
  private config: DiscordConfig;
  private heartbeatInterval = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private seq: number | null = null;
  private sessionId: string | null = null;
  private resumeUrl: string | null = null;
  private messageHandler: ((msg: DiscordMessage) => void) | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: DiscordConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    // 获取 Gateway URL
    const res = await fetch("https://discord.com/api/v10/gateway/bot", {
      headers: { Authorization: `Bot ${this.config.botToken}` },
    });
    if (!res.ok) throw new Error(`Discord gateway fetch failed: ${res.status}`);
    const { url } = await res.json() as { url: string };

    const wsUrl = this.resumeUrl ?? `${url}?v=10&encoding=json`;
    this.connectWS(wsUrl);
  }

  private connectWS(url: string): void {
    this.ws = new WebSocket(url);

    this.ws.on("message", (raw) => {
      try {
        const data = JSON.parse(raw.toString());
        this.handleEvent(data);
      } catch (err) {
        log.error("Failed to parse Discord event: %s", err);
      }
    });

    this.ws.on("close", (code) => {
      log.warn("Discord WS closed: code=%d", code);
      this.stopHeartbeat();
      this.scheduleReconnect();
    });

    this.ws.on("error", (err) => {
      log.error("Discord WS error: %s", err.message);
    });
  }

  private handleEvent(data: { op: number; t?: string; d?: any; s?: number }): void {
    if (data.s) this.seq = data.s;

    switch (data.op) {
      case 10: // Hello
        this.heartbeatInterval = data.d.heartbeat_interval;
        this.startHeartbeat();
        if (this.sessionId) {
          this.resume();
        } else {
          this.identify();
        }
        break;

      case 11: // Heartbeat ACK
        break;

      case 0: // Dispatch
        if (data.t === "READY") {
          this.sessionId = data.d.session_id;
          this.resumeUrl = data.d.resume_gateway_url;
          log.info("Discord connected as %s", data.d.user?.username);
        }
        if (data.t === "MESSAGE_CREATE" && this.messageHandler) {
          this.messageHandler(data.d as DiscordMessage);
        }
        break;

      case 7: // Reconnect
        this.stopHeartbeat();
        this.scheduleReconnect();
        break;

      case 9: // Invalid Session
        this.sessionId = null;
        this.stopHeartbeat();
        this.scheduleReconnect();
        break;
    }
  }

  private identify(): void {
    this.send({
      op: 2,
      d: {
        token: this.config.botToken,
        intents: (1 << 9) | (1 << 15), // GUILD_MESSAGES + MESSAGE_CONTENT
        properties: { os: "linux", browser: "cobeing", device: "cobeing" },
      },
    });
  }

  private resume(): void {
    this.send({
      op: 6,
      d: {
        token: this.config.botToken,
        session_id: this.sessionId,
        seq: this.seq,
      },
    });
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.send({ op: 1, d: this.seq });
    }, this.heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private send(data: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  disconnect(): void {
    this.stopHeartbeat();
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

  onMessage(handler: (msg: DiscordMessage) => void): void {
    this.messageHandler = handler;
  }

  /** REST API: 发送消息 */
  async sendMessage(channelId: string, content: string): Promise<void> {
    const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${this.config.botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content }),
    });

    if (!res.ok) {
      const text = await res.text();
      log.error("Discord send failed: %d %s", res.status, text.slice(0, 200));
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      log.info("Reconnecting to Discord...");
      this.connect().catch(err => log.error("Discord reconnect failed: %s", err.message));
    }, 5000);
  }
}
