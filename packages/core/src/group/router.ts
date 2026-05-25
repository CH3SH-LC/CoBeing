/**
 * ChannelRouter — 根据 Channel 绑定配置分发消息到 Agent 或 Group
 * 每个 Channel 最多绑定一个会话（Agent 主会话或 Group main 频道）
 */
import type { InboundMessage } from "@cobeing/shared";
import type { GroupManager } from "./manager.js";
import type { ChannelBindTo } from "../config/schema.js";
import { createLogger } from "@cobeing/shared";

const log = createLogger("channel-router");

export interface BindingEntry extends ChannelBindTo {}

export interface RouterCallbacks {
  onButlerMessage: (msg: InboundMessage) => Promise<string>;
  onAgentMessage: (agentId: string, msg: InboundMessage) => Promise<string>;
}

export class ChannelRouter {
  private bindings = new Map<string, BindingEntry>();

  constructor(
    private groupManager: GroupManager,
    private callbacks: RouterCallbacks = {
      onButlerMessage: async () => "",
      onAgentMessage: async () => "",
    },
  ) {}

  /** 路由 Channel 消息 */
  async route(channelId: string, msg: InboundMessage): Promise<string> {
    const binding = this.bindings.get(channelId);

    if (!binding) {
      // 未绑定 → 转给管家
      return await this.callbacks.onButlerMessage(msg) || "";
    }

    if (binding.type === "agent") {
      // Agent 绑定 → 直接转发给 Agent
      return await this.callbacks.onAgentMessage(binding.agentId!, msg) || "";
    }

    // Group 绑定 → 消息注入 main 频道
    const group = this.groupManager.get(binding.groupId!);
    if (!group) {
      log.warn("Group %s not found for channel %s, falling back to butler", binding.groupId, channelId);
      await this.callbacks.onButlerMessage(msg);
      return "";
    }

    group.postMessage("user", msg.content);

    // 返回最近 main 频道历史给 Channel
    const msgs = group.ctxV2.getMessages().filter(m => m.tag === "main").slice(-20);
    return msgs.map(m => `[${m.fromAgentId}]: ${m.content}`).join("\n");
  }

  /** 绑定 Channel 到 Agent 或 Group */
  bind(channelId: string, entry: BindingEntry): void {
    this.bindings.set(channelId, entry);
    log.info("Channel %s bound to %s %s", channelId, entry.type, entry.agentId ?? entry.groupId);
  }

  /** 解除绑定 */
  unbind(channelId: string): void {
    this.bindings.delete(channelId);
    log.info("Channel %s unbound", channelId);
  }

  /** 从静态配置加载绑定 */
  loadBindings(bindings: Record<string, BindingEntry>): void {
    for (const [channelId, entry] of Object.entries(bindings)) {
      this.bindings.set(channelId, entry);
      log.info("Loaded static binding: %s → %s %s", channelId, entry.type, entry.agentId ?? entry.groupId);
    }
  }

  getBinding(channelId: string): BindingEntry | undefined {
    return this.bindings.get(channelId);
  }

  setButlerCallback(cb: (msg: InboundMessage) => Promise<string>): void {
    this.callbacks.onButlerMessage = cb;
  }

  setAgentCallback(cb: (agentId: string, msg: InboundMessage) => Promise<string>): void {
    this.callbacks.onAgentMessage = cb;
  }
}
