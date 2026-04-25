/**
 * 企业微信 Channel 适配器
 * 接收消息通过 HTTP 回调，发送消息通过 API
 */
import http from "node:http";
import type { InboundMessage, OutboundMessage, ChannelCapabilities } from "@cobeing/shared";
import type { ChannelAdapter } from "../base/channel-interface.js";
import { WeComClient } from "./wecom-client.js";
import { createLogger } from "@cobeing/shared";

const log = createLogger("channel:wecom");

export interface WeComChannelConfig {
  corpId: string;
  agentId: string;
  secret: string;
  token: string;
  encodingAesKey?: string;
  port?: number;
}

export class WeComChannel implements ChannelAdapter {
  readonly id = "wecom";
  readonly name = "WeCom (企业微信)";
  private client: WeComClient;
  private config: WeComChannelConfig;
  private server: http.Server | null = null;
  private msgHandler: ((msg: InboundMessage) => void | Promise<void>) | null = null;

  constructor(config: WeComChannelConfig) {
    this.config = config;
    this.client = new WeComClient({
      corpId: config.corpId,
      agentId: config.agentId,
      secret: config.secret,
    });
  }

  async start(): Promise<void> {
    const port = this.config.port ?? 8080;

    this.server = http.createServer(async (req, res) => {
      try {
        if (req.method === "GET") {
          // URL 验证
          const url = new URL(req.url ?? "/", `http://localhost:${port}`);
          const echostr = url.searchParams.get("echostr");
          res.writeHead(200);
          res.end(echostr ?? "");
          return;
        }

        if (req.method === "POST") {
          const body = await this.readBody(req);
          const msg = this.parseCallback(body);
          if (msg && this.msgHandler) {
            this.msgHandler(msg);
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ errcode: 0, errmsg: "ok" }));
        }
      } catch (err: any) {
        log.error("WeCom callback error: %s", err.message);
        res.writeHead(500);
        res.end("error");
      }
    });

    await new Promise<void>((resolve) => {
      this.server!.listen(port, () => {
        log.info("WeCom listening on port %d", port);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    log.info("WeCom channel stopped");
  }

  async send(message: OutboundMessage): Promise<void> {
    // channelId 格式: wecom:user:{userId} 或 wecom:party:{partyId}
    const parts = message.channelId.split(":");
    const type = parts[1]; // user / party
    const id = parts[2];

    await this.client.sendText(id, message.content, type === "party");
  }

  onMessage(handler: (msg: InboundMessage) => void | Promise<void>): void {
    this.msgHandler = handler;
  }

  capabilities(): ChannelCapabilities {
    return { markdown: true, images: false, files: false, threading: false, reactions: false };
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

  private parseCallback(body: string): InboundMessage | null {
    try {
      const data = JSON.parse(body);
      if (data.XmlMsg) {
        // XML 格式 — 简化处理
        const contentMatch = data.XmlMsg.match(/<Content><!\[CDATA\[(.*?)\]\]><\/Content>/);
        const fromMatch = data.XmlMsg.match(/<FromUserName><!\[CDATA\[(.*?)\]\]><\/FromUserName>/);
        if (contentMatch && fromMatch) {
          return {
            channelId: `wecom:user:${fromMatch[1]}`,
            channelType: "wecom",
            senderId: fromMatch[1],
            senderName: fromMatch[1],
            content: contentMatch[1],
          };
        }
      }

      // JSON 格式
      if (data.Content) {
        return {
          channelId: `wecom:user:${data.FromUserName ?? "unknown"}`,
          channelType: "wecom",
          senderId: data.FromUserName ?? "unknown",
          senderName: data.FromUserName ?? "unknown",
          content: data.Content,
        };
      }
    } catch {
      // ignore parse errors
    }
    return null;
  }
}
