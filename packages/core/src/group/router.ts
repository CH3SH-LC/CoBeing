/**
 * ChannelRouter — 根据 Channel 绑定配置分发消息到 Group 或 Butler
 */
import type { InboundMessage } from "@myagents/shared";
import type { GroupManager } from "./manager.js";
import type { ChannelBindTo } from "../config/schema.js";
import { createLogger } from "@myagents/shared";

const log = createLogger("channel-router");

export interface BindingEntry extends ChannelBindTo {}

export interface RouterCallbacks {
  onButlerMessage: (msg: InboundMessage) => Promise<void>;
}

export class ChannelRouter {
  private bindings = new Map<string, BindingEntry>();
  private ownerTalks = new Map<string, string>(); // channelId → talkId

  constructor(
    private groupManager: GroupManager,
    private callbacks: RouterCallbacks,
  ) {}

  /** 路由 Channel 消息 */
  async route(channelId: string, msg: InboundMessage): Promise<string> {
    const binding = this.bindings.get(channelId);

    if (!binding || binding.type === "agent") {
      // 无绑定或 agent 绑定 → 走 Butler
      await this.callbacks.onButlerMessage(msg);
      return "";
    }

    // Group 绑定
    const ctx = this.groupManager.getContext(binding.groupId!);
    if (!ctx) {
      log.warn("Group %s not found for channel %s, falling back to butler", binding.groupId, channelId);
      await this.callbacks.onButlerMessage(msg);
      return "";
    }

    const role = binding.role ?? "user";

    if (role === "user") {
      // User 模式：消息直接注入 main 频道
      ctx.speakToMain("user", msg.content);
      ctx.saveMain();

      // 返回最近 main 频道历史给 Channel
      const recent = ctx.getMainHistory().slice(-20);
      return recent.map(m => `[${m.fromAgentId}]: ${m.content}`).join("\n");
    }

    // Owner 模式：注入持久 Talk
    let talkId = this.ownerTalks.get(channelId);
    let talk = talkId ? ctx.getTalk(talkId) : undefined;

    if (!talk) {
      talk = ctx.createTalk(["user", binding.groupId! + ":owner"], `talk:channel:${channelId}`);
      talkId = talk.id;
      this.ownerTalks.set(channelId, talkId);
      log.info("Created owner talk %s for channel %s", talkId, channelId);
    }

    talk.speak("user", msg.content);
    ctx.saveTalk(talkId);

    // 返回 Talk 历史作为响应
    const history = talk.getHistory();
    return history.map(m => `[${m.fromAgentId}]: ${m.content}`).join("\n");
  }

  /** 动态绑定 Channel 到 Group */
  bind(channelId: string, groupId: string, role: "user" | "owner"): void {
    this.bindings.set(channelId, { type: "group", groupId, role });
    log.info("Channel %s bound to group %s as %s", channelId, groupId, role);
  }

  /** 解除绑定 */
  unbind(channelId: string): void {
    this.bindings.delete(channelId);
    // 清理 owner Talk 引用（Talk 数据保留在 GroupContext 中）
    this.ownerTalks.delete(channelId);
    log.info("Channel %s unbound", channelId);
  }

  /** 从静态配置加载绑定 */
  loadBindings(bindings: Record<string, BindingEntry>): void {
    for (const [channelId, entry] of Object.entries(bindings)) {
      this.bindings.set(channelId, entry);
      log.info("Loaded static binding: %s → %s (%s)", channelId, entry.groupId ?? entry.agentId, entry.role ?? "default");
    }
  }

  /** 获取当前绑定信息 */
  getBinding(channelId: string): BindingEntry | undefined {
    return this.bindings.get(channelId);
  }

  /** 设置 butler 回调（用于 Runtime start() 阶段延迟绑定） */
  setButlerCallback(cb: (msg: InboundMessage) => Promise<void>): void {
    this.callbacks.onButlerMessage = cb;
  }
}
