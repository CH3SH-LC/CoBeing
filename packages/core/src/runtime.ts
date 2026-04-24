/**
 * CoBeingRuntime — 顶层编排器（v2 + Phase 5 多 Provider/Channel）
 */
import path from "node:path";
import fs from "node:fs";
import type { AppConfig } from "./config/schema.js";
import type { AgentSelfConfig } from "./config/schema.js";
import { AgentRegistry } from "./agent/registry.js";
import { GroupManager } from "./group/manager.js";
import { ButlerAgent } from "./agent/butler.js";
import { CoreWSServer } from "./api/ws-server.js";
import { setAgentRegistry } from "./tools/agent-message.js";
import { LLMGateway } from "./gateway/llm-gateway.js";
import { OpenAICompatProvider, AnthropicProvider, GeminiProvider, PROVIDER_CATALOGS } from "@cobeing/providers";
import type { LLMProvider } from "@cobeing/providers";
import type { ChannelAdapter } from "@cobeing/channels";
import { QQChannel } from "@cobeing/channels";
import { QQBotChannel } from "@cobeing/channels";
import { DiscordChannel } from "@cobeing/channels";
import { WeComChannel } from "@cobeing/channels";
import { FeishuChannel } from "@cobeing/channels";
import { ButlerRegistry } from "./butler/registry.js";
import { Agent } from "./agent/agent.js";
import { AgentPaths } from "./agent/paths.js";
import { AgentEventBus } from "./agent/event-bus.js";
import { ChannelRouter } from "./group/router.js";
import { makeGroupPlanTool, makeGroupInviteTalkTool, makeGroupSummarizeTool, makeGroupAssignTaskTool } from "./group/owner.js";
import { SkillRepository } from "./skills/repository.js";
import type { ChannelBindTo } from "./config/schema.js";
import { createLogger, setGlobalLogLevel } from "@cobeing/shared";
import { decrypt } from "./config/secret-store.js";
import { AgentTodoScanner } from "./todo/scanner.js";

const log = createLogger("runtime");

export class CoBeingRuntime {
  readonly registry: AgentRegistry;
  readonly groupManager: GroupManager;
  readonly wsServer: CoreWSServer;
  readonly eventBus = new AgentEventBus();
  readonly gateway: LLMGateway;
  private butler: ButlerAgent;
  private providers = new Map<string, LLMProvider>();
  private channels: ChannelAdapter[] = [];
  readonly router: ChannelRouter;
  readonly skillRepo: SkillRepository;
  private dataRoot: string;
  private todoScanner: AgentTodoScanner | null = null;

  constructor(private config: AppConfig) {
    this.dataRoot = path.resolve(config.core.dataDir ?? "./data");

    // 全局 Skill 仓库
    const skillsDir = config.core.skillsDir ?? "./skills";
    this.skillRepo = new SkillRepository(path.resolve(skillsDir));

    this.registry = new AgentRegistry();
    this.groupManager = new GroupManager(this.registry, this.dataRoot);
    (globalThis as any).__cobeingGroupManager = this.groupManager;
    this.wsServer = new CoreWSServer(config.gui?.wsPort ?? 18765);

    setAgentRegistry(this.registry);

    // 初始化 ChannelRouter（butler 回调在 start() 中通过 setButlerCallback 连接）
    this.router = new ChannelRouter(this.groupManager);

    // 构建多 Provider
    this.buildProviders(config);

    // 加载 butler 自治配置（从 data/agents/butler/config.json）
    const butlerPaths = AgentPaths.forAgent("butler", this.dataRoot);
    let butlerSelfConfig: Partial<AgentSelfConfig> = {};
    if (fs.existsSync(butlerPaths.configPath)) {
      try {
        butlerSelfConfig = JSON.parse(fs.readFileSync(butlerPaths.configPath, "utf-8"));
      } catch {
        // config.json 损坏
      }
    }
    const butlerProviderId = butlerSelfConfig.provider || "deepseek";
    const butlerModel = butlerSelfConfig.model || "deepseek-v4-flash";
    const butlerProvider = this.providers.get(butlerProviderId);
    if (!butlerProvider) {
      throw new Error(`Provider not found: ${butlerProviderId}. Available: ${[...this.providers.keys()].join(", ")}`);
    }

    // 创建 LLM Gateway
    this.gateway = new LLMGateway(butlerProvider, {
      maxConcurrency: 5,
      rpmLimit: 60,
      timeout: 120000,
      retryAttempts: 3,
    });

    // 创建管家
    this.butler = new ButlerAgent({
      id: "butler",
      name: butlerSelfConfig.name || "管家",
      role: butlerSelfConfig.role || "CoBeing 管家",
      systemPrompt: butlerSelfConfig.systemPrompt || "你是管家，用户的第一联系人。像朋友一样跟用户聊天、帮忙、解决问题。大部分事你自己就能搞定，别动不动就想着创建 Agent 或群组。",
      provider: butlerProviderId,
      model: butlerModel,
      permissions: (butlerSelfConfig.permissions as any) || { mode: "full-access" },
      sandbox: (butlerSelfConfig.sandbox as any) || { enabled: false, filesystem: "isolated", network: true },
      tools: butlerSelfConfig.tools || [
        "bash", "read-file", "write-file", "glob", "grep",
        "butler-create-agent", "butler-destroy-agent",
        "butler-create-group", "butler-destroy-group",
        "butler-list", "butler-run-group", "butler-add-to-group",
        "butler-read-registry", "butler-update-registry", "butler-analyze-task",
        "group-speak", "talk-create", "talk-send", "talk-read",
      ],
    }, butlerProvider, this.registry, this.groupManager, (providerId: string) => this.providers.get(providerId), this.router, config);

    // 注入 SkillRepository 到管家
    this.butler.injectSkillRepository(this.skillRepo);
  }

  /** 按 config 构建所有 Provider 实例 */
  private buildProviders(config: AppConfig): void {
    for (const [id, cfg] of Object.entries(config.providers)) {
      const apiKey = (cfg.apiKey ? decrypt(cfg.apiKey) : "") || process.env[cfg.apiKeyEnv ?? ""] || "";
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

  /** 热重载单个 Provider（配置变更后调用） */
  rebuildProvider(providerId: string): void {
    const cfg = this.config.providers[providerId];
    if (!cfg) {
      log.warn("Cannot rebuild provider %s: not in config", providerId);
      return;
    }
    const apiKey = (cfg.apiKey ? decrypt(cfg.apiKey) : "") || process.env[cfg.apiKeyEnv ?? ""] || "";
    const providerType = cfg.type ?? "openai-compat";

    try {
      let provider: LLMProvider;
      if (providerType === "anthropic") {
        provider = new AnthropicProvider(apiKey);
      } else if (providerType === "gemini") {
        provider = new GeminiProvider({ id: providerId, name: "Google Gemini", apiKey });
      } else {
        provider = new OpenAICompatProvider({
          id: providerId,
          name: providerId,
          apiKey,
          baseURL: cfg.baseURL ?? "https://api.openai.com/v1",
          models: PROVIDER_CATALOGS[providerId],
        });
      }
      this.providers.set(providerId, provider);
      log.info("Provider rebuilt: %s (type=%s)", providerId, providerType);
    } catch (err: any) {
      log.error("Failed to rebuild provider %s: %s", providerId, err.message);
    }
  }

  /** 从 ButlerRegistry 恢复已持久化的 Agent（优先从 config.json 读取自治配置） */
  private restoreAgents(): void {
    const butlerReg = new ButlerRegistry(this.dataRoot);
    const entries = butlerReg.parseAgentsRegistry();

    for (const entry of entries) {
      // 跳过已注册的（如 butler 本身）
      if (this.registry.get(entry.id)) continue;

      // 尝试从 agent 目录读取自治配置
      const paths = AgentPaths.forAgent(entry.id, this.dataRoot);
      let selfConfig: Partial<AgentSelfConfig> = {};
      if (fs.existsSync(paths.configPath)) {
        try {
          const raw = fs.readFileSync(paths.configPath, "utf-8");
          selfConfig = JSON.parse(raw);
        } catch {
          // config.json 损坏，回退到注册表数据
        }
      }

      const providerId = selfConfig.provider || entry.provider || "deepseek";
      const model = selfConfig.model || entry.model || "deepseek-v4-flash";
      const provider = this.providers.get(providerId) ?? this.providers.get("deepseek");

      if (!provider) {
        log.warn("Skipping agent %s: no provider %s", entry.id, providerId);
        continue;
      }

      const config: import("@cobeing/shared").AgentConfig = {
        id: entry.id,
        name: selfConfig.name || entry.name || entry.id,
        role: selfConfig.role || entry.role,
        systemPrompt: selfConfig.systemPrompt || entry.systemPrompt || `你是${entry.name}，${entry.role}`,
        provider: providerId,
        model,
        permissions: (selfConfig.permissions as any) || { mode: "workspace-write" },
        sandbox: (selfConfig.sandbox as any) || { enabled: false, filesystem: "isolated", network: true },
        tools: selfConfig.tools || ["bash", "read-file", "write-file", "glob", "grep", "web-fetch"],
        skills: selfConfig.skills,
        maxToolRounds: this.config.core.maxToolRounds,
      };

      try {
        const agent = new Agent(config, provider, this.dataRoot);
        agent.subscribeToBus(this.eventBus);
        agent.injectSkillRepository(this.skillRepo);
        this.registry.register(agent);
        log.info("Restored agent: %s (%s) [from %s]",
          config.name, entry.id,
          Object.keys(selfConfig).length > 0 ? "config.json" : "registry");
      } catch (err: any) {
        log.warn("Failed to restore agent %s: %s", entry.id, err.message);
      }
    }
  }

  async start(): Promise<void> {
    setGlobalLogLevel(this.config.core.logLevel as "debug" | "info" | "warn" | "error");
    this.wsServer.setAgentRegistry(this.registry);
    this.wsServer.setGroupManager(this.groupManager);
    this.wsServer.setChannelRouter(this.router);
    this.wsServer.registerAgent(this.butler);

    // 从 ButlerRegistry 恢复已持久化的 Agent
    this.restoreAgents();

    // Register pre-built agents (e.g., HostAgent)
    this.registerPrebuiltAgents();

    // Restore persisted groups from data/groups/
    this.groupManager.restoreGroups();

    // Inject provider resolver + data root to WS server for direct creation
    this.wsServer.setProviderResolver((id) => this.providers.get(id));
    this.wsServer.setOnProviderChange((providerId) => this.rebuildProvider(providerId));
    this.wsServer.setDataRoot(this.dataRoot);
    this.wsServer.setSkillRepository(this.skillRepo);

    // 连接 router → butler / agent
    this.router.setButlerCallback(async (msg) => {
      return await this.butler.handleIncomingMessage(msg);
    });
    this.router.setAgentCallback(async (agentId, msg) => {
      const agent = this.registry.get(agentId);
      if (agent) {
        return await agent.handleIncomingMessage(msg);
      } else {
        log.warn("Agent %s not found for channel routing, falling back to butler", agentId);
        return await this.butler.handleIncomingMessage(msg);
      }
    });

    // 加载静态绑定
    this.loadStaticBindings();

    await this.wsServer.start();

    // 启动 Channels
    await this.startChannels();

    // 启动 TODO 扫描器
    this.todoScanner = new AgentTodoScanner(this.dataRoot, this.registry, {
      onTrigger: async (agentId, _todo, message) => {
        const agent = this.registry.get(agentId);
        if (agent) {
          log.info("[TODOboard] Triggering agent %s", agentId);
          try {
            await agent.run(message);
          } catch (err: any) {
            log.error("[TODOboard] Failed to trigger %s: %s", agentId, err.message);
          }
        }
      },
    });
    this.todoScanner.start();

    log.info("Runtime started (dataRoot=%s). Butler: %s, WS: ws://localhost:%d",
      this.dataRoot, this.butler.name, this.config.gui?.wsPort ?? 18765);
    log.info("Providers: %s", [...this.providers.keys()].join(", "));
    log.info("Channels: %d configured", Object.values(this.config.channels).filter(c => c.enabled).length);
  }

  async stop(): Promise<void> {
    this.todoScanner?.stop();
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
      if (!cfg || !cfg.enabled) continue;

      try {
        const channel = this.createChannel(id, cfg);
        channel.onMessage(async (msg) => {
          // 确定目标 agentId（用于 GUI 消息归位）
          const binding = this.router.getBinding(id);
          const targetId = binding?.type === "agent" ? binding.agentId!
            : binding?.type === "group" ? binding.groupId!
            : "butler";

          const now = Date.now();

          // 广播收到的消息到 GUI（日志 + 聊天视图）
          this.wsServer.logMessage("in", `[${id}] ${msg.senderName || msg.senderId}: ${msg.content}`);
          this.wsServer.broadcast({
            type: "channel_message",
            payload: {
              agentId: targetId,
              direction: "in",
              content: msg.content,
              senderName: msg.senderName || msg.senderId,
              timestamp: now,
            },
          });

          // 通过 router 路由
          const reply = await this.router.route(id, msg);
          if (reply) {
            // 广播回复到 GUI（日志 + 聊天视图）
            this.wsServer.logMessage("out", reply);
            this.wsServer.broadcast({
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

        await channel.start();
        this.channels.push(channel);

        // 将 channel 注册到目标 agent 的发送列表，使 agent 能通过它回复
        const binding = cfg.bindTo;
        if (binding?.type === "agent") {
          const targetAgent = binding.agentId === "butler"
            ? this.butler
            : this.registry.get(binding.agentId);
          if (targetAgent) {
            targetAgent.addSendChannel(channel);
          }
        }

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
      if (cfg && cfg.bindTo) {
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
      case "qqbot":
        return new QQBotChannel({
          appId: cfg.qqbotAppId!,
          appSecret: cfg.qqbotAppSecret!,
          intents: cfg.qqbotIntents,
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

  /** Register pre-built agents from config.agents ID list (e.g., host) */
  private registerPrebuiltAgents(): void {
    const agentIds = this.config.agents || [];

    for (const agentId of agentIds) {
      if (this.registry.get(agentId)) continue;
      if (agentId === "butler") continue; // butler handled separately

      // Load self-config from data/agents/{id}/config.json
      const agentPaths = AgentPaths.forAgent(agentId, this.dataRoot);
      if (!fs.existsSync(agentPaths.configPath)) {
        log.warn("Skipping agent %s: no config.json at %s", agentId, agentPaths.configPath);
        continue;
      }

      let selfConfig: Partial<AgentSelfConfig> = {};
      try {
        selfConfig = JSON.parse(fs.readFileSync(agentPaths.configPath, "utf-8"));
      } catch (err: any) {
        log.warn("Skipping agent %s: invalid config.json: %s", agentId, err.message);
        continue;
      }

      const providerId = selfConfig.provider || "deepseek";
      const provider = this.providers.get(providerId);
      if (!provider) {
        log.warn("Skipping agent %s: no provider %s", agentId, providerId);
        continue;
      }

      const agent = new Agent({
        id: agentId,
        name: selfConfig.name || agentId,
        role: selfConfig.role || "",
        systemPrompt: selfConfig.systemPrompt || `你是${selfConfig.name}，${selfConfig.role}`,
        provider: providerId,
        model: selfConfig.model || "deepseek-v4-flash",
        permissions: (selfConfig.permissions as any) || { mode: "workspace-write" },
        sandbox: (selfConfig.sandbox as any) || { enabled: false, filesystem: "isolated", network: true },
        tools: selfConfig.tools,
        maxToolRounds: this.config.core.maxToolRounds,
      }, provider, this.dataRoot);

      agent.subscribeToBus(this.eventBus);
      agent.injectSkillRepository(this.skillRepo);

      // 注册群主专属工具（owner tools）
      if (selfConfig.tools?.some((t: string) => ["group-plan", "group-invite-talk", "group-summarize", "group-assign-task"].includes(t))) {
        const groupGetter = (gid: string) => this.groupManager.get(gid);
        agent.registerTool(makeGroupPlanTool(groupGetter));
        agent.registerTool(makeGroupInviteTalkTool(groupGetter));
        agent.registerTool(makeGroupSummarizeTool(groupGetter));
        agent.registerTool(makeGroupAssignTaskTool(groupGetter));
      }

      this.registry.register(agent);
      log.info("Pre-built agent registered: %s (%s)", selfConfig.name || agentId, agentId);
    }
  }

  /** 获取 Gateway 状态 */
  getGatewayStatus(): { activeCount: number; queueLength: number; currentRpm: number } {
    return this.gateway.getStatus();
  }
}
