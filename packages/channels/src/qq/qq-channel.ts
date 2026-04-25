/**
 * QQ Channel 适配器 — 基于 OneBot v11
 */
import type { InboundMessage, OutboundMessage, ChannelCapabilities } from "@cobeing/shared";
import type { ChannelAdapter } from "../base/channel-interface.js";
import { OneBotClient } from "./onebot-client.js";
import { createLogger } from "@cobeing/shared";

const log = createLogger("channel:qq");

export interface QQChannelConfig {
  wsUrl: string;
  botQQ: string;
  accessToken?: string;
  /** 只响应这些群/私聊，为空则全部响应 */
  allowedGroups?: number[];
  allowedUsers?: number[];
}

export class QQChannel implements ChannelAdapter {
  readonly id = "qq";
  readonly name = "QQ (OneBot v11)";
  private client: OneBotClient;
  private config: QQChannelConfig;
  private msgHandler: ((msg: InboundMessage) => void | Promise<void>) | null = null;

  constructor(config: QQChannelConfig) {
    this.config = config;
    this.client = new OneBotClient({
      wsUrl: config.wsUrl,
      accessToken: config.accessToken,
    });
  }

  async start(): Promise<void> {
    await this.client.connect();

    this.client.onEvent((event) => {
      // 只处理消息事件
      if (event.post_type !== "message") return;

      // 过滤
      if (event.message_type === "group" && this.config.allowedGroups?.length) {
        if (!this.config.allowedGroups.includes(event.group_id!)) return;
      }
      if (this.config.allowedUsers?.length) {
        if (!this.config.allowedUsers.includes(event.user_id!)) return;
      }

      const msg = this.convertInbound(event);
      if (msg && this.msgHandler) {
        this.msgHandler(msg);
      }
    });

    log.info("QQ channel started");
  }

  async stop(): Promise<void> {
    this.client.disconnect();
    log.info("QQ channel stopped");
  }

  async send(message: OutboundMessage): Promise<void> {
    const eventMeta = message.metadata?.onebotEvent as {
      user_id?: number;
      group_id?: number;
      message_type?: string;
    } | undefined;

    if (!eventMeta) {
      log.error("Cannot send: missing OneBot event metadata");
      return;
    }

    // QQ 消息长度限制：分段发送
    const content = message.content;
    const chunks = this.splitMessage(content, 3000);

    for (const chunk of chunks) {
      if (eventMeta.message_type === "group" && eventMeta.group_id) {
        await this.client.sendGroupMessage(eventMeta.group_id, chunk);
      } else if (eventMeta.user_id) {
        await this.client.sendPrivateMessage(eventMeta.user_id, chunk);
      }
    }
  }

  onMessage(handler: (msg: InboundMessage) => void | Promise<void>): void {
    this.msgHandler = handler;
  }

  capabilities(): ChannelCapabilities {
    return {
      markdown: false,
      images: true,
      files: false,
      threading: false,
      reactions: true,
    };
  }

  isConnected(): boolean {
    return this.client.isConnected();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private convertInbound(event: any): InboundMessage | null {
    const userId = event.user_id as number | undefined;
    const groupId = event.group_id as number | undefined;
    const rawMessage = event.raw_message as string | undefined;
    const sender = event.sender as { nickname: string; card?: string } | undefined;

    if (!userId || !rawMessage) return null;

    return {
      channelId: groupId ? `qq:group:${groupId}` : `qq:private:${userId}`,
      channelType: "qq",
      senderId: String(userId),
      senderName: sender?.card || sender?.nickname || String(userId),
      content: rawMessage,
      metadata: {
        onebotEvent: {
          user_id: userId,
          group_id: groupId,
          message_type: event.message_type,
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
