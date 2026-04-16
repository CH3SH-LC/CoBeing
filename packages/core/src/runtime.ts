/**
 * MyAgentsRuntime — 顶层编排器（v2 + Phase 5 多 Provider/Channel）
 */
import path from "node:path";
import type { AppConfig } from "./config/schema.js";
import { AgentRegistry } from "./agent/registry.js";
import { GroupManager } from "./group/manager.js";
import { ButlerAgent } from "./agent/butler.js";
import { CoreWSServer } from "./api/ws-server.js";
import { setAgentRegistry } from "./tools/agent-message.js";
import { LLMGateway } from "./gateway/llm-gateway.js";
import { OpenAICompatProvider, AnthropicProvider, GeminiProvider, PROVIDER_CATALOGS } from "@myagents/providers";
import type { LLMProvider } from "@myagents/providers";
import type { ChannelAdapter } from "@myagents/channels";
import { QQChannel } from "@myagents/channels";
import { DiscordChannel } from "@myagents/channels";
import { WeComChannel } from "@myagents/channels";
import { FeishuChannel } from "@myagents/channels";
import { ButlerRegistry } from "./butler/registry.js";
import { Agent } from "./agent/agent.js";
import { ChannelRouter } from "./group/router.js";
import type { ChannelBindTo } from "./config/schema.js";
import { createLogger, setGlobalLogLevel } from "@myagents/shared";

const log = createLogger("runtime");

export class MyAgentsRuntime {
  readonly registry: AgentRegistry;
  readonly groupManager: GroupManager;
  readonly wsServer: CoreWSServer;
  readonly gateway: LLMGateway;
  private butler: ButlerAgent;
  private providers = new Map<string, LLMProvider>();
  private channels: ChannelAdapter[] = [];
  readonly router: ChannelRouter;
  private dataRoot: string;

  constructor(private config: AppConfig) {
    this.dataRoot = path.resolve(config.core.dataDir ?? "./data");
    this.registry = new AgentRegistry();
    this.groupManager = new GroupManager(this.registry, this.dataRoot);
    this.wsServer = new CoreWSServer(config.gui?.wsPort ?? 18765);

    setAgentRegistry(this.registry);

    // 初始化 ChannelRouter（butler 回调在 start() 中通过 setButlerCallback 连接）
    this.router = new ChannelRouter(this.groupManager, {
      onButlerMessage: async () => {},
    });

    // 构建多 Provider
    this.buildProviders(config);

    // 创建 LLM Gateway（用 butler 的 provider 作为默认）
    const defaultProvider = this.providers.get(config.agent.provider);
    if (!defaultProvider) {
      throw new Error(`Provider not found: ${config.agent.provider}. Available: ${[...this.providers.keys()].join(", ")}`);
    }
    this.gateway = new LLMGateway(defaultProvider, {
      maxConcurrency: 5,
      rpmLimit: 60,
      timeout: 120000,
      retryAttempts: 3,
    });

    // 创建管家
    this.butler = new ButlerAgent({
      id: "butler",
      name: config.agent.name || "管家",
      role: config.agent.role || "MyAgents 管家",
      systemPrompt: config.agent.systemPrompt || "你是 MyAgents 管家。你可以创建 Agent、创建群组、启动讨论。\n\n工作流程：\n1. 收到任务后先调用 butler-read-registry 了解已有 Agent\n2. 调用 butler-analyze-task 分析需要什么 Agent\n3. 根据分析结果创建 Agent 或复用已有 Agent\n4. 创建群组并启动讨论",
      provider: config.agent.provider,
      model: config.agent.model,
      permissions: { mode: "full-access" },
      sandbox: { enabled: false, filesystem: "workspace-only", network: true },
      tools: [
        "bash", "read-file", "write-file", "glob", "grep",
        "butler-create-agent", "butler-destroy-agent",
        "butler-create-group", "butler-destroy-group",
        "butler-list", "butler-run-group", "butler-add-to-group",
        "butler-read-registry", "butler-update-registry", "butler-analyze-task",
        "group-speak", "talk-create", "talk-send", "talk-read",
      ],
    }, defaultProvider, this.registry, this.groupManager, (providerId: string) => this.providers.get(providerId), this.router);
  }

  /** 按 config 构建所有 Provider 实例 */
  private buildProviders(config: AppConfig): void {
    for (const [id, cfg] of Object.entries(config.providers)) {
      const apiKey = cfg.apiKey ?? process.env[cfg.apiKeyEnv ?? ""] ?? "";
      const providerType = cfg.type ?? "openai-compat";

      try {
        let provider: LLMProvider;

        if (providerType === "anthropic") {
          provider = new AnthropicProvider(apiKey);
        } else if (providerType === "gemini") {
          provider = new GeminiProvider({ id, name: "Google Gemini", apiKey });
        } else {
          // OpenAI-compatible — 绝大多数国产厂商走这条路
          provider = new OpenAICompatProvider({
            id,
            name: id,
            apiKey,
            baseURL: cfg.baseURL ?? "https://api.openai.com/v1",
            models: PROVIDER_CATALOGS[id],
          });
        }

        this.providers.set(id, provider);
        log.info("Provider registered: %s (type=%s)", id, providerType);
      } catch (err: any) {
        log.warn("Failed to create provider %s: %s", id, err.message);
      }
    }
  }

  /** 从 ButlerRegistry 恢复已持久化的 Agent */
  private restoreAgents(): void {
    const butlerReg = new ButlerRegistry(this.dataRoot);
    const entries = butlerReg.parseAgentsRegistry();

    for (const entry of entries) {
      // 跳过已注册的（如 butler 本身）
      if (this.registry.get(entry.id)) continue;

      const providerId = entry.provider || this.config.agent.provider;
      const model = entry.model || this.config.agent.model;
      const provider = this.providers.get(providerId) ?? this.providers.get(this.config.agent.provider);

      if (!provider) {
        log.warn("Skipping agent %s: no provider %s", entry.id, providerId);
        continue;
      }

      const config: import("@myagents/shared").AgentConfig = {
        id: entry.id,
        name: entry.name || entry.id,
        role: entry.role,
        systemPrompt: entry.systemPrompt || `你是${entry.name}，${entry.role}`,
        provider: providerId,
        model,
        permissions: { mode: "workspace-write" },
        sandbox: { enabled: false, filesystem: "workspace-only", network: true },
        tools: ["bash", "read-file", "write-file", "glob", "grep", "web-fetch"],
      };

      try {
        const agent = new Agent(config, provider, this.dataRoot);
        this.registry.register(agent);
        log.info("Restored agent: %s (%s)", entry.name, entry.id);
      } catch (err: any) {
        log.warn("Failed to restore agent %s: %s", entry.id, err.message);
      }
    }
  }

  async start(): Promise<void> {
    setGlobalLogLevel(this.config.core.logLevel as "debug" | "info" | "warn" | "error");
    this.wsServer.setAgentRegistry(this.registry);
    this.wsServer.setGroupManager(this.groupManager);
    this.wsServer.registerAgent(this.butler);

    // 从 ButlerRegistry 恢复已持久化的 Agent
    this.restoreAgents();

    // 连接 router → butler
    this.router.setButlerCallback(async (msg) => {
      await this.butler.handleIncomingMessage(msg);
    });

    // 加载静态绑定
    this.loadStaticBindings();

    await this.wsServer.start();

    // 启动 Channels
    await this.startChannels();

    log.info("Runtime started (dataRoot=%s). Butler: %s, WS: ws://localhost:%d",
      this.dataRoot, this.butler.name, this.config.gui?.wsPort ?? 18765);
    log.info("Providers: %s", [...this.providers.keys()].join(", "));
    log.info("Channels: %d configured", Object.values(this.config.channels).filter(c => c.enabled).length);
  }

  async stop(): Promise<void> {
    // 关闭所有 Channel
    for (const ch of this.channels) {
      try { await ch.stop(); } catch { /* ignore */ }
    }
    // 关闭所有 Agent
    for (const agent of this.registry.list()) {
      await agent.dispose();
    }
    this.wsServer.stop();
    log.info("Runtime stopped");
  }

  /** 启动配置中启用的 Channel */
  private async startChannels(): Promise<void> {
    for (const [id, cfg] of Object.entries(this.config.channels)) {
      if (!cfg.enabled) continue;

      try {
        const channel = this.createChannel(id, cfg);
        channel.onMessage(async (msg) => {
          // 通过 router 路由，不再直接给 butler
          const response = await this.router.route(id, msg);
          if (response) {
            await channel.send({ channelId: msg.channelId, content: response });
          }
        });
        await channel.start();
        this.channels.push(channel);
        log.info("Channel started: %s (type=%s)", id, cfg.type);
      } catch (err: any) {
        log.error("Failed to start channel %s: %s", id, err.message);
      }
    }
  }

  /** 从配置加载静态 Channel 绑定 */
  private loadStaticBindings(): void {
    const bindings: Record<string, ChannelBindTo> = {};
    for (const [id, cfg] of Object.entries(this.config.channels)) {
      if (cfg.bindTo) {
        bindings[id] = cfg.bindTo;
      }
    }
    if (Object.keys(bindings).length > 0) {
      this.router.loadBindings(bindings);
    }
  }

  private createChannel(_id: string, cfg: AppConfig["channels"][string]): ChannelAdapter {
    switch (cfg.type) {
      case "onebot":
        return new QQChannel({
          wsUrl: cfg.wsUrl!,
          botQQ: cfg.botQQ!,
          accessToken: cfg.accessToken,
          allowedGroups: cfg.allowedGroups,
          allowedUsers: cfg.allowedUsers,
        });
      case "discord":
        return new DiscordChannel({
          botToken: cfg.discordBotToken!,
          guildId: cfg.discordGuildId,
          allowedChannels: cfg.discordAllowedChannels,
        });
      case "wecom":
        return new WeComChannel({
          corpId: cfg.wecomCorpId!,
          agentId: cfg.wecomAgentId!,
          secret: cfg.wecomSecret!,
          token: cfg.wecomToken!,
          encodingAesKey: cfg.wecomEncodingAesKey,
          port: cfg.wecomPort,
        });
      case "feishu":
        return new FeishuChannel({
          appId: cfg.feishuAppId!,
          appSecret: cfg.feishuAppSecret!,
          verificationToken: cfg.feishuVerificationToken!,
          encryptKey: cfg.feishuEncryptKey,
          port: cfg.feishuPort,
        });
      default:
        throw new Error(`Unknown channel type: ${cfg.type}`);
    }
  }

  /** 处理用户输入（交互式） */
  async handleUserInput(input: string): Promise<string> {
    const response = await this.butler.run(input);
    return response.content;
  }

  /** 获取 Provider */
  getProvider(providerId: string): LLMProvider | undefined {
    return this.providers.get(providerId);
  }

  /** 获取 Gateway 状态 */
  getGatewayStatus(): { activeCount: number; queueLength: number; currentRpm: number } {
    return this.gateway.getStatus();
  }
}
