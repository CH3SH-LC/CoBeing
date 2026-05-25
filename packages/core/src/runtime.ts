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
import { LLMGateway } from "./gateway/llm-gateway.js";
import { OpenAICompatProvider, PROVIDER_CATALOGS, registerProvider, getProvider } from "@cobeing/providers";
import type { LLMProvider } from "@cobeing/providers";
import type { ChannelAdapter } from "@cobeing/channels";
import { registerChannel, getChannel } from "@cobeing/channels";
import { PluginLoader } from "@cobeing/plugin-sdk";
import type { CoBeingPluginApi } from "@cobeing/plugin-sdk";
import { ButlerRegistry } from "./agent/butler-registry.js";
import { Agent } from "./agent/agent.js";
import { AgentPaths } from "./agent/paths.js";
import { AgentEventBus } from "./agent/event-bus.js";
import { ChannelRouter } from "./group/router.js";
import { makeGroupPlanTool, makeGroupInviteTalkTool, makeGroupSummarizeTool, makeGroupAssignTaskTool } from "./group/owner.js";
import { SkillRepository } from "./skills/repository.js";
import { VoteStore } from "./vote/store.js";
import type { ChannelBindTo } from "./config/schema.js";
import { createLogger, setGlobalLogLevel, readMasterRegistry, migrateFromFilesystem, cleanupOrphanDirectories, addAgentToRegistry, migratePermissionMode } from "@cobeing/shared";
import { decrypt } from "./config/secret-store.js";
import { AgentTodoScanner } from "./todo/scanner.js";
import { DockerSandbox } from "./tools/sandbox/docker-sandbox.js";
import { ContainerPool } from "./tools/sandbox/container-pool.js";
import { MCPManager } from "./mcp/manager.js";
import { makeMCPDiscoverTool, makeMCPRegisterTool } from "./tools/mcp-tools.js";
import { ObservabilityDB } from "./observability/observability-db.js";

const log = createLogger("runtime");

/** 如果 Docker 不可用，降级沙箱配置 */
function ensureSandboxConfig(sandbox: any, dockerAvailable: boolean): any {
  if (!sandbox?.enabled) return sandbox;
  if (!dockerAvailable) return { ...sandbox, enabled: false };
  return sandbox;
}

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
  readonly voteStore: VoteStore;
  private pluginLoader: PluginLoader;
  /** 全局 MCP 管理器（按需注册，非自动推给所有 Agent） */
  readonly mcpManager = new MCPManager();
  /** Docker 可用性（start() 中检查，用于沙箱降级） */
  private dockerAvailable = false;
  /** 全局可观测性数据库 */
  readonly observabilityDB: ObservabilityDB;

  /** All configured providers keyed by provider ID */
  get providersMap(): Map<string, LLMProvider> { return this.providers; }

  constructor(private config: AppConfig) {
    this.dataRoot = path.resolve(config.core.dataDir ?? "./data");
    (globalThis as any).__cobeingRuntime = this;

    // 全局 Skill 仓库
    const skillsDir = config.core.skillsDir ?? "./skills";
    this.skillRepo = new SkillRepository(path.resolve(skillsDir));

    this.registry = new AgentRegistry();
    (globalThis as any).__cobeingAgentRegistry = this.registry;
    this.groupManager = new GroupManager(
      this.registry,
      this.dataRoot,
      (providerId?: string) => {
        if (providerId) return this.providers.get(providerId);
        return this.providers.get("deepseek");
      },
    );
    (globalThis as any).__cobeingGroupManager = this.groupManager;
    this.voteStore = new VoteStore(this.dataRoot);
    (globalThis as any).__cobeingVoteStore = this.voteStore;
    (globalThis as any).__cobeingDataRoot = this.dataRoot;
    (globalThis as any).__cobeingConfig = config;
    this.observabilityDB = new ObservabilityDB(this.dataRoot);
    (globalThis as any).__cobeingObsDb = this.observabilityDB;
    this.wsServer = new CoreWSServer(config.gui?.wsPort ?? 18765);

    // 初始化 ChannelRouter（butler 回调在 start() 中通过 setButlerCallback 连接）
    this.router = new ChannelRouter(this.groupManager);

    // 构建插件宿主 API — 桥接到现有全局注册表
    const pluginApi: CoBeingPluginApi = {
      registerModelProvider(p) { registerProvider(p as unknown as LLMProvider); },
      registerChannel(c) { registerChannel(c as any); },
      registerTool() {},
      registerMemoryBackend() {},
    };
    this.pluginLoader = new PluginLoader(pluginApi);

    // 构建多 Provider
    this.buildProviders(config);

    // 加载 butler 自治配置（从 data/agents/butler/config.json）
    const butlerPaths = AgentPaths.forAgent("butler", this.dataRoot);
    migratePermissionMode(path.dirname(butlerPaths.configPath));
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
      systemPrompt: butlerSelfConfig.systemPrompt || "你是管家，用户的第一联系人。像朋友一样跟用户聊天、帮忙、解决问题。\n\n创建群组时的规则：\n1. 先用 butler-list 查看已有的 Agent\n2. 如果已有 Agent 能胜任，直接用 butler-add-to-group 加入群组，不要重复创建\n3. 只有确实没有合适 Agent 时才用 butler-create-agent 创建新的\n4. Agent 按技能领域命名（如\"前端工程师\"），不按项目命名（如\"挂机游戏前端工程师\"）\n5. 同一个 Agent 可以同时属于多个群组\n\n## 多步推理能力\n当用户提出复杂任务（组建团队、项目开发等）时，你必须自主完成多步推理，在一次回复中连续调用多个工具直到任务完成。不要只返回分析文本然后等用户指示——直接调用工具执行。\n\n标准流程：\n1. butler-list → 了解已有 Agent 和群组\n2. 判断是否需要新建 Agent（复用优先）\n3. 如需新建 → butler-create-agent\n4. butler-create-group → 组建群组\n5. butler-run-group → 启动协作\n\n## 主动建议\n完成复杂任务后，在回复末尾评估是否需要向用户建议补充角色。如果群组缺少关键角色（如只有前端没有后端），自然地说\"我注意到当前团队还缺XX角色，需要我创建一个吗？\"",
      provider: butlerProviderId,
      model: butlerModel,
      permissions: (butlerSelfConfig.permissions as any) || { mode: "full-access" },
      sandbox: (butlerSelfConfig.sandbox as any) || { enabled: true, filesystem: "isolated", network: { enabled: true, mode: "all" } },
      tools: butlerSelfConfig.tools || [
        "bash", "read-file", "write-file", "glob", "grep",
        "butler-create-agent", "butler-destroy-agent",
        "butler-create-group", "butler-destroy-group",
        "butler-list", "butler-run-group", "butler-add-to-group",
        "butler-read-registry", "butler-update-registry", "butler-check-group", "butler-modify-agent",
        "butler-bind-workspace",
        "group-members", "talk-create", "talk-send", "talk-read", "talk-close",
        "group-send", "group-update-progress",
        "group-experience-add", "group-experience-summarize",
      ],
    }, butlerProvider, this.registry, this.groupManager, (providerId: string) => this.providers.get(providerId), this.router, config);

    // 注入 SkillRepository 到管家
    this.butler.injectSkillRepository(this.skillRepo);
    // 注入群组通信工具（group-send / group-update-progress / group-experience-add / group-experience-summarize）
    this.butler.injectGroupTools((gid) => this.groupManager.get(gid));
    // 设置 Provider 回落列表
    this.butler.setAllProviders(this.providers);
    this.butler.setObservabilityDB(this.observabilityDB);
  }

  /** 按 config 构建所有 Provider 实例（插件架构 — 同步部分供构造函数调用） */
  private buildProviders(config: AppConfig): void {
    const builtinsDir = path.resolve("plugins/providers");

    // 建立目录名 → manifest ID 映射
    if (fs.existsSync(builtinsDir)) {
      const dirToManifest = new Map<string, string>();
      for (const entry of fs.readdirSync(builtinsDir)) {
        const mp = path.join(builtinsDir, entry, "cobeing.plugin.json");
        if (!fs.existsSync(mp)) continue;
        try {
          const m: { id: string } = JSON.parse(fs.readFileSync(mp, "utf-8"));
          dirToManifest.set(entry, m.id);
        } catch { /* 跳过损坏的清单 */ }
      }

      // 1. 发现尚未在 config 中的插件目录
      const configuredProviderIds = Object.keys(config.providers);
      const discovered = [...dirToManifest.keys()].filter(dir => !configuredProviderIds.includes(dir));

      // 2. 自动注册新发现的插件到 config
      if (discovered.length > 0) {
        for (const dir of discovered) {
          (config.providers as any)[dir] = { type: "openai-compat" as const };
        }
        log.info("Auto-registered %d new provider plugin(s): %s", discovered.length, discovered.join(", "));
      }
    }

    // 3. 为所有已配置的 provider 创建实例并注册到全局注册表
    for (const [id, cfg] of Object.entries(config.providers)) {
      const apiKey = (cfg.apiKey ? decrypt(cfg.apiKey) : "") || process.env[cfg.apiKeyEnv ?? ""] || "";
      try {
        const provider = new OpenAICompatProvider({
          id,
          name: id,
          apiKey,
          baseURL: cfg.baseURL ?? getProviderBaseURL(id),
          models: PROVIDER_CATALOGS[id] || [],
        });
        registerProvider(provider);
        this.providers.set(id, provider);
        log.info("Provider ready: %s", id);
      } catch (err: any) {
        log.warn("Failed to create provider %s: %s", id, err.message);
      }
    }
  }

  /** 热重载单个 Provider（配置变更后调用，从文件重新读取配置） */
  rebuildProvider(providerId: string): void {
    // 从文件重新读取，确保拿到最新的 apiKey（前端保存后触发）
    let cfg = this.config.providers[providerId];
    try {
      const configPath = path.resolve("config/default.json");
      if (fs.existsSync(configPath)) {
        const fresh = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        if (fresh.providers?.[providerId]) {
          cfg = fresh.providers[providerId];
          // 同步更新内存中的 config
          this.config.providers[providerId] = cfg;
        }
      }
    } catch { /* fallback to in-memory config */ }
    if (!cfg) {
      log.warn("Cannot rebuild provider %s: not in config", providerId);
      return;
    }
    const apiKey = (cfg.apiKey ? decrypt(cfg.apiKey) : "") || process.env[cfg.apiKeyEnv ?? ""] || "";
    const providerType = cfg.type ?? "openai-compat";

    try {
      const provider = new OpenAICompatProvider({
        id: providerId,
        name: providerId,
        apiKey,
        baseURL: cfg.baseURL ?? "https://api.deepseek.com",
        models: PROVIDER_CATALOGS[providerId],
      });
      this.providers.set(providerId, provider);
      log.info("Provider rebuilt: %s", providerId);
    } catch (err: any) {
      log.error("Failed to rebuild provider %s: %s", providerId, err.message);
    }
  }

  /** 从 Master Registry 恢复已持久化的 Agent（优先从 config.json 读取自治配置） */
  private restoreAgents(): void {
    const registry = readMasterRegistry(this.dataRoot);
    const agentEntries = Object.values(registry.agents);

    for (const entry of agentEntries) {
      // 跳过已注册的（如 butler 本身）
      if (this.registry.get(entry.id)) continue;
      // 跳过 inactive 的 Agent
      if (entry.status === "inactive") continue;

      // 尝试从 agent 目录读取自治配置
      const paths = AgentPaths.forAgent(entry.id, this.dataRoot);
      migratePermissionMode(path.dirname(paths.configPath));
      let selfConfig: Record<string, any> = {};
      if (fs.existsSync(paths.configPath)) {
        try {
          const raw = fs.readFileSync(paths.configPath, "utf-8");
          selfConfig = JSON.parse(raw);
        } catch {
          // config.json 损坏
        }
      }

      const providerId = selfConfig.provider || "deepseek";
      const model = selfConfig.model || "deepseek-v4-flash";
      const provider = this.providers.get(providerId) ?? this.providers.get("deepseek");

      if (!provider) {
        log.warn("Skipping agent %s: no provider %s", entry.id, providerId);
        continue;
      }

      const config: import("@cobeing/shared").AgentConfig = {
        id: entry.id,
        name: selfConfig.name || entry.name || entry.id,
        role: selfConfig.role || entry.role,
        systemPrompt: selfConfig.systemPrompt || `你是${entry.name}，${entry.role}`,
        provider: providerId,
        model,
        permissions: (selfConfig.permissions as any) || { mode: "workspace-readwrite" },
        sandbox: ensureSandboxConfig(
          (selfConfig.sandbox as any) || { enabled: true, filesystem: "isolated", network: { enabled: true, mode: "all" } },
          this.dockerAvailable,
        ),
        tools: selfConfig.tools || ["bash", "read-file", "write-file", "edit-file", "glob", "grep", "web-fetch", "agent-message"],
        skills: selfConfig.skills,
        maxToolRounds: this.config.core.maxToolRounds,
      };

      try {
        const agent = new Agent(config, provider, this.dataRoot);
        agent.subscribeToBus(this.eventBus);
        agent.injectSkillRepository(this.skillRepo);
        agent.injectGroupTools((gid) => this.groupManager.get(gid));
        agent.injectAgentMessageTool(this.registry);
        agent.setAllProviders(this.providers);
        agent.setObservabilityDB(this.observabilityDB);
        this.registry.register(agent);
        log.info("Restored agent: %s (%s) [from master registry]", config.name, entry.id);
      } catch (err: any) {
        log.warn("Failed to restore agent %s: %s", entry.id, err.message);
      }
    }
  }

  async start(): Promise<void> {
    setGlobalLogLevel(this.config.core.logLevel as "debug" | "info" | "warn" | "error");

    // 检查 Docker 可用性（一次性，结果缓存到 this.dockerAvailable）
    const dockerCheck = await DockerSandbox.checkDockerAvailable();
    this.dockerAvailable = dockerCheck.available;
    ContainerPool.setDockerAvailable(this.dockerAvailable);
    if (!this.dockerAvailable) {
      log.warn("Docker not available, all sandboxes disabled: %s", dockerCheck.error);
      // 管家已在构造函数中创建，需要降级其沙箱
      if ((this.butler as any)._sandbox) {
        await (this.butler as any)._sandbox.destroy();
        (this.butler as any)._sandbox = null;
      }
    }

    this.wsServer.setAgentRegistry(this.registry);
    this.wsServer.setGroupManager(this.groupManager);
    this.wsServer.setChannelRouter(this.router);
    this.wsServer.registerAgent(this.butler);

    // 确保 master registry 存在（首次启动从文件系统迁移）
    const rp = path.join(this.dataRoot, "registry.json");
    if (!fs.existsSync(rp)) {
      log.info("No registry.json found — migrating from filesystem");
      migrateFromFilesystem(this.dataRoot);
    }

    // 从 Master Registry 恢复已持久化的 Agent
    this.restoreAgents();

    // Register pre-built agents (e.g., HostAgent)
    this.registerPrebuiltAgents();

    // 连接 MCP 服务器到全局管理器（不自动推给 Agent）
    await this.connectAllMCPServers();

    // 注册 mcp-discover / mcp-register 工具到所有 Agent（按需发现和注册）
    this.registerMCPTools();

    // Restore persisted groups from data/groups/ (now reads from master registry)
    this.groupManager.restoreGroups();

    // 清理文件系统中不在 registry 里的孤儿目录（幽灵清理）
    cleanupOrphanDirectories(this.dataRoot);

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

    // MCP 配置热重载
    this.wsServer.setOnMcpConfigChange(async (serverId, config) => {
      const agents = this.registry.list();
      if (config === null) {
        log.info("MCP server '%s' removed (restart to apply)", serverId);
      } else {
        for (const agent of agents) {
          try {
            await agent.connectMCPServer(serverId, config as any);
            log.info("MCP server '%s' hot-connected to agent '%s'", serverId, agent.id);
          } catch (err: any) {
            log.warn("MCP server '%s' hot-connect failed for '%s': %s", serverId, agent.id, err.message);
          }
        }
      }
    });

    await this.wsServer.start();

    // WS server 已启动，恢复所有群组的 WakeSystem（处理 restoreGroups 期间积压的唤醒队列）
    this.groupManager.resumeAllWakeSystems();

    // 广播最终状态到所有已连接的 GUI 客户端（确保启动后 Agent/群组列表可见）
    this.wsServer.broadcastState();

    // 启动 Channels
    await this.startChannels();

    // 启动 TODO 扫描器
    this.todoScanner = new AgentTodoScanner(this.dataRoot, this.registry, {
      onTrigger: async (agentId, _todo, message) => {
        const agent = this.registry.get(agentId);
        if (agent) {
          log.info("[TODOboard] Triggering agent %s", agentId);
          this.wsServer.broadcast({
            type: "agent_started",
            payload: { agentId, agentName: agent.name, source: "TODOboard" },
          });
          try {
            const response = await agent.run(message, {
              onToolCall: (tc) => {
                this.wsServer.broadcast({
                  type: "tool_event",
                  payload: { agentId, toolName: tc.function.name, params: (() => { try { return JSON.parse(tc.function.arguments); } catch { return {}; } })(), status: "start", source: "TODOboard" },
                });
              },
              onToolResult: (_tcId, result) => {
                this.wsServer.broadcast({
                  type: "tool_event",
                  payload: { agentId, result: typeof result === "string" ? result.slice(0, 2000) : String(result), status: "complete", source: "TODOboard" },
                });
              },
              onUsage: (usage) => {
                this.wsServer.broadcast({ type: "usage_stats", payload: { agentId, ...usage, source: "TODOboard" } });
              },
            });
            this.wsServer.broadcast({
              type: "agent_completed",
              payload: { agentId, agentName: agent.name, source: "TODOboard", content: response.content },
            });
            this.wsServer.logMessage("system", `[TODOboard] ${agent.name} 完成 TODO: ${_todo.title}`);
          } catch (err: any) {
            log.error("[TODOboard] Failed to trigger %s: %s", agentId, err.message);
            this.wsServer.broadcast({
              type: "agent_error",
              payload: { agentId, agentName: agent.name, source: "TODOboard", error: `AI 服务异常: ${err.message.slice(0, 200)}` },
            });
          }
        }
      },
    });
    this.todoScanner.start();

    // 确保 data/host/ 目录结构
    this.ensureHostDir();

    // 初始化本地过滤引擎
    await this.initLocalFilter();

    log.info("Runtime started (dataRoot=%s). Butler: %s, WS: ws://localhost:%d",
      this.dataRoot, this.butler.name, this.config.gui?.wsPort ?? 18765);
    log.info("Providers: %s", [...this.providers.keys()].join(", "));
    log.info("Channels: %d configured", Object.values(this.config.channels).filter(c => c.enabled).length);
  }

  /** 连接配置中的所有 MCP 服务器到全局 MCPManager（不自动注册到 Agent） */
  private async connectAllMCPServers(): Promise<void> {
    const mcpServers = this.config.mcpServers;
    if (!mcpServers || Object.keys(mcpServers).length === 0) return;

    log.info("Connecting %d MCP server(s)", Object.keys(mcpServers).length);

    for (const [serverId, serverConfig] of Object.entries(mcpServers)) {
      try {
        await this.mcpManager.connect(serverId, serverConfig);
        log.info("MCP server '%s' connected (%d tools)", serverId, this.mcpManager.getServerTools(serverId).length);
      } catch (err: any) {
        log.warn("MCP server '%s' failed: %s", serverId, err.message);
      }
    }
  }

  /** 向所有 Agent 注册 mcp-discover / mcp-register 工具（按需发现和注册 MCP） */
  private registerMCPTools(): void {
    const agents = this.registry.list();
    const discoverTool = makeMCPDiscoverTool(this.mcpManager);
    const registerTool = makeMCPRegisterTool(this.mcpManager);
    for (const agent of agents) {
      agent.registerTool(discoverTool);
      agent.registerTool(registerTool);
      agent.rebuildLoop();
    }
    log.info("MCP discover/register tools registered to %d agent(s)", agents.length);
  }

  async stop(): Promise<void> {
    log.info("Runtime stopping — notifying clients to flush data...");
    // 1. 先通知前端保存数据（发送 shutdown 信号 + 等待 flush）
    await this.wsServer.stop();

    // 2. 停止后台扫描器
    this.todoScanner?.stop();

    // 3. 释放本地过滤引擎
    if ((this as any)._localFilter) {
      (this as any)._localFilter.dispose();
    }

    // 4. 关闭所有 Channel
    for (const ch of this.channels) {
      try { await ch.stop(); } catch { /* ignore */ }
    }

    // 5. 关闭所有 Agent（释放 memory.db 等）
    for (const agent of this.registry.list()) {
      await agent.dispose();
    }

    // 6. 释放群组资源（SQLite 等）
    this.groupManager.disposeAll();

    // 7. 关闭 MCP 连接
    await this.mcpManager.close();

    // 8. 清理全局变量
    delete (globalThis as any).__cobeingAgentRegistry;
    delete (globalThis as any).__cobeingGroupManager;
    delete (globalThis as any).__cobeingVoteStore;
    delete (globalThis as any).__cobeingDataRoot;
    delete (globalThis as any).__cobeingConfig;
    delete (globalThis as any).__cobeingRuntime;
    delete (globalThis as any).__cobeingWSServer;
    delete (globalThis as any).__cobeingObsDb;

    this.observabilityDB.close();
    log.info("Runtime stopped");
  }

  /** 启动配置中启用的 Channel */
  private async startChannels(): Promise<void> {
    // 扫描 channel 插件目录
    const channelsDir = path.resolve("plugins/channels");
    const configuredChannelIds = Object.keys(this.config.channels).filter(k => this.config.channels[k]?.enabled);
    const discovered = this.pluginLoader.discoverSync(channelsDir, configuredChannelIds);

    if (discovered.length > 0) {
      for (const id of discovered) {
        if (!this.config.channels[id]) {
          (this.config.channels as any)[id] = { enabled: true, type: "qqbot" as const };
        }
      }
      log.info("Auto-registered %d new channel plugin(s): %s", discovered.length, discovered.join(", "));
    }

    // 加载所有启用的 channel 插件
    const allChannelIds = Object.keys(this.config.channels).filter(k => this.config.channels[k]?.enabled);
    await this.pluginLoader.loadAll(allChannelIds, channelsDir);

    for (const [id, cfg] of Object.entries(this.config.channels)) {
      if (!cfg || !cfg.enabled) continue;

      try {
        const channel = getChannel(id);
        if (!channel) {
          log.warn("Channel '%s' configured but plugin not loaded", id);
          continue;
        }
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

  /** 处理用户输入（交互式） */
  async handleUserInput(input: string): Promise<string> {
    const response = await this.butler.run(input);
    return response.content;
  }

  /** 确保 data/host/ 目录结构存在 */
  private ensureHostDir(): void {
    const hostDir = path.join(this.dataRoot, "host");
    fs.mkdirSync(hostDir, { recursive: true });

    const hostConfigPath = path.join(hostDir, "config.json");
    if (!fs.existsSync(hostConfigPath)) {
      fs.writeFileSync(hostConfigPath, JSON.stringify({
        name: "群主",
        role: "项目协调者和讨论引导者",
        provider: "deepseek",
        model: "deepseek-v4-flash",
        permissions: { mode: "full-access" },
        sandbox: { enabled: true, filesystem: "isolated", network: { enabled: true, mode: "all" } },
        tools: [
          "bash", "read-file", "write-file", "edit-file", "glob", "grep", "web-fetch", "agent-message",
          "group-plan", "group-invite-talk", "group-summarize", "group-assign-task",
          "host-guide-discussion", "host-decompose-task", "host-summarize-progress",
          "host-record-decision", "host-manage-todo", "host-review-todo",
          "host-invite-member", "host-remove-member", "host-set-screener-prompt", "host-manage-workspace",
          "talk-close",
          "todo-add", "todo-list", "todo-complete", "todo-remove", "todo-review",
          "todo-batch-complete", "todo-batch-remove", "todo-batch-update",
        ],
      }, null, 2) + "\n", "utf-8");
      log.info("Created default host config: %s", hostConfigPath);
    }

    for (const file of ["DECISIONS.md", "GROUPS_REGISTRY.md"]) {
      const filePath = path.join(hostDir, file);
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, `# ${file.replace(".md", "")}\n`, "utf-8");
      }
    }
  }

  /** 初始化本地过滤引擎 */
  private async initLocalFilter(): Promise<void> {
    const lmConfig = this.config.core.localModel;
    if (!lmConfig?.enabled) return;

    const modelPath = path.resolve(lmConfig.path);
    if (!fs.existsSync(modelPath)) {
      log.warn("Local filter model not found at %s, skipping (will use fallback)", modelPath);
      return;
    }

    try {
      const { LocalFilterEngine } = await import("./group/local-filter.js");
      const filter = new LocalFilterEngine();
      await filter.init(modelPath, lmConfig.contextSize);
      if (filter.isEnabled()) {
        (this as any)._localFilter = filter;
        // 注入到所有群组
        for (const group of this.groupManager.list()) {
          group.setLocalFilter(filter);
        }
        log.info("Local filter engine enabled: %s", modelPath);
      }
    } catch (err: any) {
      log.warn("Local filter init failed (will use fallback): %s", err.message);
    }
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
      migratePermissionMode(path.dirname(agentPaths.configPath));
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
        permissions: (selfConfig.permissions as any) || { mode: "workspace-readwrite" },
        sandbox: ensureSandboxConfig(
          (selfConfig.sandbox as any) || { enabled: true, filesystem: "isolated", network: { enabled: true, mode: "all" } },
          this.dockerAvailable,
        ),
        tools: selfConfig.tools,
        maxToolRounds: this.config.core.maxToolRounds,
      }, provider, this.dataRoot);

      agent.subscribeToBus(this.eventBus);
      agent.injectSkillRepository(this.skillRepo);
      // 注入群组通信工具（所有 Agent 都需要）
      agent.injectGroupTools((gid) => this.groupManager.get(gid));
      agent.injectAgentMessageTool(this.registry);
      agent.setAllProviders(this.providers);
      agent.setObservabilityDB(this.observabilityDB);

      // 注册群主专属工具（owner tools）
      if (selfConfig.tools?.some((t: string) => ["group-plan", "group-invite-talk", "group-summarize", "group-assign-task"].includes(t))) {
        const groupGetter = (gid: string) => this.groupManager.get(gid);
        agent.registerTool(makeGroupPlanTool(groupGetter));
        agent.registerTool(makeGroupInviteTalkTool(groupGetter));
        agent.registerTool(makeGroupSummarizeTool(groupGetter));
        agent.registerTool(makeGroupAssignTaskTool(groupGetter));
      }

      // 注册 host-* 增强工具（群主专用）
      if (agentId === "host") {
        this.registerHostTools(agent);
      }

      this.registry.register(agent);
      // 确保 agent 在 master registry 中
      if (!readMasterRegistry(this.dataRoot).agents[agentId]) {
        addAgentToRegistry(this.dataRoot, {
          id: agentId,
          name: selfConfig.name || agentId,
          role: selfConfig.role || "",
          status: "active",
          createdAt: new Date().toISOString(),
        });
      }
      log.info("Pre-built agent registered: %s (%s)", selfConfig.name || agentId, agentId);
    }
  }

  /** 注册群主增强工具 */
  private registerHostTools(agent: Agent): void {
    import("./group/host-tools.js").then(({
      makeHostGuideDiscussionTool,
      makeHostDecomposeTaskTool,
      makeHostSummarizeProgressTool,
      makeHostRecordDecisionTool,
      makeHostManageTodoTool,
      makeHostReviewTodoTool,
      makeHostInviteMemberTool,
      makeHostRemoveMemberTool,
      makeHostSetScreenerPromptTool,
      makeHostManageWorkspaceTool,
    }) => {
      const groupGetter = (gid: string) => this.groupManager.get(gid);
      const hostDataDir = path.join(this.dataRoot, "host");

      agent.registerTool(makeHostGuideDiscussionTool(groupGetter));
      agent.registerTool(makeHostDecomposeTaskTool(groupGetter, (input: any) => {
        const store = this.groupManager.getGroupTodoStore(input.groupId);
        if (store) return store.add(input);
        return { id: "no-store", ...input };
      }, (todoId, depIds) => {
        // 从上下文获取 groupTodoStore 并设置依赖
        for (const g of this.groupManager.list()) {
          const store = this.groupManager.getGroupTodoStore(g.id);
          if (store && store.get(todoId)) {
            store.setDependsOn(todoId, depIds);
            return;
          }
        }
      }));
      agent.registerTool(makeHostSummarizeProgressTool(groupGetter));
      agent.registerTool(makeHostRecordDecisionTool(groupGetter, (gid, decision, reason) => {
        const decPath = path.join(hostDataDir, "DECISIONS.md");
        const entry = `\n## ${new Date().toISOString()}\n**群组**: ${gid}\n**决策**: ${decision}\n**理由**: ${reason}\n`;
        fs.appendFileSync(decPath, entry, "utf-8");
      }));
      agent.registerTool(makeHostManageTodoTool(
        (gid, status) => this.groupManager.getGroupTodoStore(gid)?.list(status as any) ?? [],
        (todoId, updates) => {
          // 遍历所有群组找到包含该 TODO 的 store
          for (const g of this.groupManager.list()) {
            const store = this.groupManager.getGroupTodoStore(g.id);
            if (store) {
              const item = store.get(todoId);
              if (item) {
                // TodoStore 没有通用 update 方法，用 complete 代替
                if (updates.status === "completed") return store.complete(todoId);
                return item;
              }
            }
          }
          return undefined;
        },
        (todoId) => {
          for (const g of this.groupManager.list()) {
            const store = this.groupManager.getGroupTodoStore(g.id);
            if (store && store.remove(todoId)) return true;
          }
          return false;
        },
      ));
      agent.registerTool(makeHostReviewTodoTool(
        (gid) => this.groupManager.getGroupTodoStore(gid)?.getDueTodos() ?? [],
      ));
      agent.registerTool(makeHostInviteMemberTool(groupGetter));
      agent.registerTool(makeHostRemoveMemberTool(groupGetter));
      agent.registerTool(makeHostSetScreenerPromptTool(groupGetter));
      agent.registerTool(makeHostManageWorkspaceTool(groupGetter));

      log.info("Host-enhanced tools registered for agent: %s", agent.id);
    }).catch(err => {
      log.warn("Failed to register host tools: %s", err.message);
    });
  }

  /** 获取 Gateway 状态 */
  getGatewayStatus(): { activeCount: number; queueLength: number; currentRpm: number } {
    return this.gateway.getStatus();
  }
}

/** 获取 provider 的默认 baseURL */
function getProviderBaseURL(id: string): string {
  const defaults: Record<string, string> = {
    deepseek: "https://api.deepseek.com",
    zhipu: "https://open.bigmodel.cn/api/paas/v4",
    qwen: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    minimax: "https://api.minimaxi.com/v1",
    volcengine: "https://ark.cn-beijing.volces.com/api/v3",
    moonshot: "https://api.moonshot.cn/v1",
    mimo: "https://api.xiaomimimo.com/v1",
  };
  return defaults[id] || "https://api.deepseek.com";
}
