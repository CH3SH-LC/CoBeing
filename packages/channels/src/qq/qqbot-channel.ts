/**
 * QQ Bot 官方 API v2 Channel 适配器
 * 通过 Gateway WebSocket 接收消息，通过 REST API 回复
 */
import type { InboundMessage, OutboundMessage, ChannelCapabilities } from "@cobeing/shared";
import type { ChannelAdapter } from "../base/channel-interface.js";
import { QQBotGatewayClient, type QQBotGatewayConfig, type QQBotMessageEvent } from "./qqbot-gateway-client.js";
import { createLogger } from "@cobeing/shared";

const log = createLogger("channel:qqbot");

const API_BASE = "https://api.sgroup.qq.com";

export interface QQBotChannelConfig extends QQBotGatewayConfig {}

export class QQBotChannel implements ChannelAdapter {
  readonly id = "qqbot";
  readonly name = "QQ Bot (Official API v2)";
  private client: QQBotGatewayClient;
  private msgHandler: ((msg: InboundMessage) => void | Promise<void>) | null = null;

  constructor(config: QQBotChannelConfig) {
    this.client = new QQBotGatewayClient(config);
  }

  async start(): Promise<void> {
    await this.client.connect();

    this.client.onEvent((event, data) => {
      if (
        event === "GROUP_AT_MESSAGE_CREATE" ||
        event === "C2C_MESSAGE_CREATE" ||
        event === "AT_MESSAGE_CREATE" ||
        event === "MESSAGE_CREATE"
      ) {
        const msg = this.convertInbound(event, data as QQBotMessageEvent);
        if (msg && this.msgHandler) {
          this.msgHandler(msg);
        }
      }
    });

    log.info("QQBot channel started");
  }

  async stop(): Promise<void> {
    this.client.disconnect();
    log.info("QQBot channel stopped");
  }

  async send(message: OutboundMessage): Promise<void> {
    const meta = message.metadata?.qqbot as {
      group_openid?: string;
      user_openid?: string;
      channel_id?: string;
      msg_id?: string;
      msg_seq?: number;
    } | undefined;

    if (!meta) {
      log.error("Cannot send: missing QQBot message metadata");
      return;
    }

    const token = await this.client.getAccessToken();
    const headers: Record<string, string> = {
      "Authorization": `QQBot ${token}`,
      "Content-Type": "application/json",
    };

    // 按 QQ 消息长度限制分段
    const chunks = this.splitMessage(message.content, 2000);
    let seq = meta.msg_seq ?? 1;

    for (const chunk of chunks) {
      const body: Record<string, unknown> = {
        content: chunk,
        msg_type: 0, // 文本
        msg_id: meta.msg_id,
        msg_seq: seq++,
      };

      let url: string;
      if (meta.group_openid) {
        // 群聊回复
        url = `${API_BASE}/v2/groups/${meta.group_openid}/messages`;
      } else if (meta.user_openid) {
        // 私聊回复
        url = `${API_BASE}/v2/users/${meta.user_openid}/messages`;
      } else if (meta.channel_id) {
        // 频道回复
        url = `${API_BASE}/channels/${meta.channel_id}/messages`;
      } else {
        log.error("Cannot determine reply target");
        return;
      }

      try {
        const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
        if (!res.ok) {
          log.error("Failed to send message: %d %s", res.status, await res.text());
        }
      } catch (err: any) {
        log.error("Failed to send message: %s", err.message);
      }
    }
  }

  onMessage(handler: (msg: InboundMessage) => void | Promise<void>): void {
    this.msgHandler = handler;
  }

  capabilities(): ChannelCapabilities {
    return {
      markdown: true,
      images: true,
      files: false,
      threading: false,
      reactions: false,
    };
  }

  isConnected(): boolean {
    return this.client.isConnected();
  }

  private convertInbound(eventType: string, data: QQBotMessageEvent): InboundMessage | null {
    const content = data.content?.trim();
    if (!content) return null;

    // 群聊用 member_openid，C2C 用 user_openid，频道用 user_id
    const senderId = data.author?.user_openid || data.author?.member_openid || data.author?.user_id || "";
    const senderName = data.author?.member_openid || data.author?.user_openid || senderId;

    let channelId: string;
    let channelType: string;

    if (eventType === "GROUP_AT_MESSAGE_CREATE" && data.group_openid) {
      channelId = `qqbot:group:${data.group_openid}`;
      channelType = "qqbot";
    } else if (eventType === "C2C_MESSAGE_CREATE") {
      channelId = `qqbot:c2c:${senderId}`;
      channelType = "qqbot";
    } else if (data.channel_id) {
      channelId = `qqbot:channel:${data.channel_id}`;
      channelType = "qqbot";
    } else {
      return null;
    }

    return {
      channelId,
      channelType,
      senderId,
      senderName,
      content,
      metadata: {
        qqbot: {
          group_openid: data.group_openid,
          user_openid: data.author?.user_openid,
          channel_id: data.channel_id,
          msg_id: data.id,
          msg_seq: 1,
        },
      },
    };
  }

  private splitMessage(text: string, maxLen: number): string[] {
    if (text.length <= maxLen) return [text];
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += maxLen) {
      chunks.push(text.slice(i, i + maxLen));
    }
    return chunks;
  }
}
