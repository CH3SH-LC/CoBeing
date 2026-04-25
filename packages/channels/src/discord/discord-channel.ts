/**
 * Discord Channel 适配器
 */
import type { InboundMessage, OutboundMessage, ChannelCapabilities } from "@cobeing/shared";
import type { ChannelAdapter } from "../base/channel-interface.js";
import { DiscordClient } from "./discord-client.js";
import { createLogger } from "@cobeing/shared";

const log = createLogger("channel:discord");

export interface DiscordChannelConfig {
  botToken: string;
  guildId?: string;
  allowedChannels?: string[];
}

export class DiscordChannel implements ChannelAdapter {
  readonly id = "discord";
  readonly name = "Discord";
  private client: DiscordClient;
  private config: DiscordChannelConfig;
  private msgHandler: ((msg: InboundMessage) => void | Promise<void>) | null = null;

  constructor(config: DiscordChannelConfig) {
    this.config = config;
    this.client = new DiscordClient({ botToken: config.botToken });
  }

  async start(): Promise<void> {
    await this.client.connect();

    this.client.onMessage((msg) => {
      // 忽略 bot 自己的消息
      if (msg.author.bot) return;

      // 过滤频道
      if (this.config.allowedChannels?.length) {
        if (!this.config.allowedChannels.includes(msg.channel_id)) return;
      }

      const inbound = this.convertInbound(msg);
      if (inbound && this.msgHandler) {
        this.msgHandler(inbound);
      }
    });

    log.info("Discord channel started");
  }

  async stop(): Promise<void> {
    this.client.disconnect();
    log.info("Discord channel stopped");
  }

  async send(message: OutboundMessage): Promise<void> {
    // channelId 存储在 message.channelId 中，格式: discord:channel:{channelId}
    const channelId = message.channelId.replace("discord:channel:", "");
    const chunks = this.splitMessage(message.content, 2000);

    for (const chunk of chunks) {
      await this.client.sendMessage(channelId, chunk);
    }
  }

  onMessage(handler: (msg: InboundMessage) => void | Promise<void>): void {
    this.msgHandler = handler;
  }

  capabilities(): ChannelCapabilities {
    return { markdown: true, images: true, files: true, threading: true, reactions: true };
  }

  isConnected(): boolean {
    return this.client.isConnected();
  }

  private convertInbound(msg: { id: string; channel_id: string; author: { id: string; username: string }; content: string; guild_id?: string; member?: { nick?: string } }): InboundMessage {
    return {
      channelId: `discord:channel:${msg.channel_id}`,
      channelType: "discord",
      senderId: msg.author.id,
      senderName: msg.member?.nick || msg.author.username,
      content: msg.content,
      metadata: {
        discordMessageId: msg.id,
        guildId: msg.guild_id,
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
