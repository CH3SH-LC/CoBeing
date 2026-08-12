/**
 * Channel 生命周期辅助模块（从 runtime.ts 提取，行为不变）
 *
 * 职责：配置驱动 + 插件注册两阶段启动所有 Channel、
 * 统一 inbound 消息管线（截断 + 路由 + 群组审核管道）、
 * 静态绑定加载与 stop 清理。
 */
import { getChannel, getAllChannels } from "@cobeing/channels";
import type { ChannelAdapter } from "@cobeing/channels";
import type { LLMProvider } from "@cobeing/providers";
import { DEFAULT_PROVIDER, DEFAULT_JUDGMENT_MODEL, createLogger } from "@cobeing/shared";
import type { AppConfig } from "../config/schema.js";
import type { ChannelBindTo } from "../config/schema.js";
import type { GroupManager } from "../group/manager.js";
import type { ChannelRouter } from "../group/router.js";
import type { AgentRegistry } from "../agent/registry.js";
import type { Agent } from "../agent/agent.js";
import type { CoreWSServer } from "../api/ws-server.js";
import type { PluginRegistry } from "@cobeing/plugin-sdk";

const log = createLogger("runtime");

/** Channel 生命周期域所需依赖（由 CoBeingRuntime 提供） */
export interface ChannelDeps {
  config: AppConfig;
  /** 已解析的插件注册表（可能为 null，插件 channel 的 bindTo 从中读取） */
  pluginRegistry: () => PluginRegistry | null;
  router: ChannelRouter;
  wsServer: CoreWSServer;
  groupManager: GroupManager;
  registry: AgentRegistry;
  /** 启动完成后的管家（startChannels 在 createCoreAgents 之后调用） */
  getButler: () => Agent;
  /** 已启动的 channel 数组（追加用） */
  channels: ChannelAdapter[];
}

/** 为 channel 设置统一的消息处理管线 */
export function setupChannelOnMessage(deps: ChannelDeps, channelId: string): void {
  const { router, wsServer, groupManager } = deps;
  const channel = getChannel(channelId);
  if (!channel) return;

  channel.onMessage(async (msg) => {
    // Basic sanitization: limit content size and sender name length
    const safeContent = msg.content && msg.content.length > 102400
      ? msg.content.slice(0, 102400) + "...[truncated]"
      : msg.content;
    const safeSenderName = (msg.senderName || msg.senderId || "unknown").slice(0, 64);

    const binding = router.getBinding(channelId);
    const targetId = binding?.type === "agent" ? binding.agentId!
      : binding?.type === "group" ? binding.groupId!
      : "butler";

    const now = Date.now();

    wsServer.logMessage("in", `[${channelId}] ${safeSenderName}: ${safeContent}`);
    wsServer.broadcast({
      type: "channel_message",
      payload: {
        agentId: targetId,
        direction: "in",
        content: safeContent,
        senderName: safeSenderName,
        timestamp: now,
      },
    });

    // 群组审核管道
    if (binding?.type === "group" && binding.groupId && groupManager) {
      const group = groupManager.get(binding.groupId);
      const reviewerCfg = group?.config.reviewer ?? { enabled: true, maxRounds: 3 };
      if (reviewerCfg.enabled !== false && reviewerCfg.maxRounds !== 0) {
        const runtime = (globalThis as any).__cobeing?.runtime;
        const provider = runtime?.getProvider(DEFAULT_PROVIDER) as LLMProvider | undefined;
        if (provider) {
          const { runReviewAgent, parseReviewOutput } = await import("../agent/tool-agent/review.js");
          const agentName = safeSenderName;
          const reviewInput: import("@cobeing/shared").ReviewInput = {
            agentJobMd: `# ${agentName}\n外部渠道消息，来自 ${channelId}`,
            agentTrace: { thinking: [], toolCalls: [], finalMessage: safeContent },
            groupRecentMessages: group.getRecentMessages(10).map((m: any) => `[${m.fromAgentId}]: ${m.content}`),
            agentMentions: [],
            groupTaskMd: "",
            groupPlanMd: "",
            groupProgressMd: "",
          };
          try {
            const toolResult = await runReviewAgent(reviewInput, provider, undefined as any, DEFAULT_JUDGMENT_MODEL, ".", agentName);
            const parsed = parseReviewOutput(toolResult.output);
            if (!parsed.pass) {
              log.info("Channel message from %s rejected by group review: %s", agentName, parsed.reason);
              return;
            }
          } catch (err: any) {
            log.warn("Channel message review failed, allowing through: %s", err.message);
          }
        }
      }
    }

    const reply = await router.route(channelId, msg);
    if (reply) {
      wsServer.logMessage("out", reply);
      wsServer.broadcast({
        type: "channel_message",
        payload: {
          agentId: targetId,
          direction: "out",
          content: reply,
          timestamp: Date.now(),
        },
      });
    }
  });
}

/** 启动所有 Channel（配置驱动 + 插件注册） */
export async function startChannels(deps: ChannelDeps): Promise<void> {
  const { config, router, registry, wsServer, groupManager, channels } = deps;

  // Resolve bindTo from registry entry config (plugin channels)
  const getPluginBindTo = (channelId: string): ChannelBindTo | undefined => {
    const pluginRegistry = deps.pluginRegistry();
    if (!pluginRegistry) return undefined;
    for (const [, entry] of Object.entries(pluginRegistry.plugins)) {
      if (entry.kind === "channel" && entry.config?.bindTo) {
        // Match by plugin ID pattern: cobeing-plugin-<channelId>
        const pluginChannelId = entry.dir?.split("/")?.pop();
        if (pluginChannelId === channelId) {
          return entry.config.bindTo as ChannelBindTo;
        }
      }
    }
    return undefined;
  };

  const startedIds = new Set<string>();

  // Phase 1: 启动 config.channels 中配置的 channel
  for (const [id, cfg] of Object.entries(config.channels)) {
    if (!cfg || !cfg.enabled) continue;

    try {
      const channel = getChannel(id);
      if (!channel) {
        log.warn("Channel '%s' configured but plugin not loaded", id);
        continue;
      }
      startedIds.add(id);
      setupChannelOnMessage(deps, id);
      await channel.start();
      channels.push(channel);

      const binding = cfg.bindTo;
      if (binding?.type === "agent") {
        const targetAgent = binding.agentId === "butler"
          ? deps.getButler()
          : registry.get(binding.agentId);
        if (targetAgent) {
          targetAgent.addSendChannel(channel);
        }
        // Register binding with router so inbound messages route correctly
        if (binding.agentId) {
          router.bind(id, { type: "agent", agentId: binding.agentId });
        }
      } else if (binding?.type === "group" && binding.groupId) {
        router.bind(id, { type: "group", groupId: binding.groupId });
      }

      log.info("Channel started: %s (type=%s)", id, cfg.type);
    } catch (err: any) {
      log.error("Failed to start channel %s: %s", id, err.message);
    }
  }

  // Phase 2: 启动插件注册但未在 config 中配置的 channel
  for (const channel of getAllChannels()) {
    if (startedIds.has(channel.id)) continue;

    try {
      setupChannelOnMessage(deps, channel.id);
      await channel.start();
      channels.push(channel);
      startedIds.add(channel.id);

      // 插件 channel 的 bindTo 从 registry.json config 读取
      const bindTo = getPluginBindTo(channel.id);
      if (bindTo?.type === "agent") {
        const targetAgent = bindTo.agentId === "butler"
          ? deps.getButler()
          : registry.get(bindTo.agentId);
        if (targetAgent) {
          targetAgent.addSendChannel(channel);
          // Register binding with router so inbound messages route correctly
          router.bind(channel.id, bindTo);
        }
      } else if (bindTo?.type === "group" && bindTo.groupId) {
        router.bind(channel.id, bindTo);
      }

      log.info("Plugin channel started: %s", channel.id);
    } catch (err: any) {
      log.error("Failed to start plugin channel %s: %s", channel.id, err.message);
    }
  }
}

/** 从配置加载静态 Channel 绑定 */
export function loadStaticBindings(config: AppConfig, router: ChannelRouter): void {
  const bindings: Record<string, ChannelBindTo> = {};
  for (const [id, cfg] of Object.entries(config.channels)) {
    if (cfg && cfg.bindTo) {
      bindings[id] = cfg.bindTo;
    }
  }
  if (Object.keys(bindings).length > 0) {
    router.loadBindings(bindings);
  }
}

/** 关闭所有 Channel 并清理路由绑定 */
export async function stopChannels(channels: ChannelAdapter[], router: ChannelRouter): Promise<void> {
  for (const ch of channels) {
    try {
      router.unbind(ch.id);
      await ch.stop();
    } catch { /* ignore */ }
  }
  channels.length = 0;
}
