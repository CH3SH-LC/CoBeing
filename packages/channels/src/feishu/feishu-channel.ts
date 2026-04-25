/**
 * 飞书 Channel 适配器
 * 接收消息通过 HTTP 事件订阅，发送消息通过 API
 */
import http from "node:http";
import type { InboundMessage, OutboundMessage, ChannelCapabilities } from "@cobeing/shared";
import type { ChannelAdapter } from "../base/channel-interface.js";
import { FeishuClient } from "./feishu-client.js";
import { createLogger } from "@cobeing/shared";

const log = createLogger("channel:feishu");

export interface FeishuChannelConfig {
  appId: string;
  appSecret: string;
  verificationToken: string;
  encryptKey?: string;
  port?: number;
}

export class FeishuChannel implements ChannelAdapter {
  readonly id = "feishu";
  readonly name = "Feishu (飞书)";
  private client: FeishuClient;
  private config: FeishuChannelConfig;
  private server: http.Server | null = null;
  private msgHandler: ((msg: InboundMessage) => void | Promise<void>) | null = null;

  constructor(config: FeishuChannelConfig) {
    this.config = config;
    this.client = new FeishuClient({
      appId: config.appId,
      appSecret: config.appSecret,
      encryptKey: config.encryptKey,
    });
  }

  async start(): Promise<void> {
    const port = this.config.port ?? 8081;

    this.server = http.createServer(async (req, res) => {
      try {
        if (req.method !== "POST") {
          res.writeHead(405);
          res.end("method not allowed");
          return;
        }

        const body = await this.readBody(req);
        const data = JSON.parse(body);

        // URL 验证（challenge-response）
        if (data.challenge) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ challenge: data.challenge }));
          return;
        }

        // 事件回调
        const event = data.event;
        if (event && this.msgHandler) {
          const msg = this.convertEvent(event);
          if (msg) this.msgHandler(msg);
        }

        res.writeHead(200);
        res.end("{}");
      } catch (err: any) {
        log.error("Feishu callback error: %s", err.message);
        res.writeHead(500);
        res.end("error");
      }
    });

    await new Promise<void>((resolve) => {
      this.server!.listen(port, () => {
        log.info("Feishu listening on port %d", port);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    log.info("Feishu channel stopped");
  }

  async send(message: OutboundMessage): Promise<void> {
    // channelId 格式: feishu:open_id:{id} 或 feishu:chat_id:{id}
    const parts = message.channelId.split(":");
    const type = parts[1] as "open_id" | "chat_id";
    const id = parts[2];

    await this.client.sendMessage(id, type, message.content);
  }

  onMessage(handler: (msg: InboundMessage) => void | Promise<void>): void {
    this.msgHandler = handler;
  }

  capabilities(): ChannelCapabilities {
    return { markdown: true, images: true, files: true, threading: false, reactions: true };
  }

  isConnected(): boolean {
    return this.server?.listening ?? false;
  }

  private readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => resolve(body));
      req.on("error", reject);
    });
  }

  private convertEvent(event: any): InboundMessage | null {
    // im.message.receive_v1 事件
    if (event.message) {
      const msg = event.message;
      const sender = event.sender;

      let content = msg.content ?? "";
      try {
        const parsed = JSON.parse(content);
        content = parsed.text ?? content;
      } catch { /* use raw content */ }

      return {
        channelId: `feishu:${msg.chat_type === "group" ? "chat_id" : "open_id"}:${msg.chat_id}`,
        channelType: "feishu",
        senderId: sender?.sender_id?.open_id ?? sender?.sender_id?.user_id ?? "unknown",
        senderName: sender?.sender_id?.open_id ?? "unknown",
        content,
        metadata: {
          feishuMessageId: msg.message_id,
          chatType: msg.chat_type,
        },
      };
    }
    return null;
  }
}
