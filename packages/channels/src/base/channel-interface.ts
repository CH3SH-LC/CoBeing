/**
 * Channel 适配器统一接口
 */
import type { InboundMessage, OutboundMessage, ChannelCapabilities } from "@cobeing/shared";

export interface ChannelAdapter {
  readonly id: string;
  readonly name: string;

  /** 启动 channel（连接、监听等） */
  start(): Promise<void>;

  /** 停止 channel */
  stop(): Promise<void>;

  /** 发送消息到渠道 */
  send(message: OutboundMessage): Promise<void>;

  /** 注册消息处理器 */
  onMessage(handler: (msg: InboundMessage) => void | Promise<void>): void;

  /** 渠道能力 */
  capabilities(): ChannelCapabilities;

  /** 是否已连接 */
  isConnected(): boolean;
}

/** Channel 注册表 */
const channelRegistry = new Map<string, ChannelAdapter>();

export function registerChannel(channel: ChannelAdapter): void {
  channelRegistry.set(channel.id, channel);
}

export function getChannel(id: string): ChannelAdapter | undefined {
  return channelRegistry.get(id);
}

export function getAllChannels(): ChannelAdapter[] {
  return [...channelRegistry.values()];
}
