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
import { getProvider, registerProvider } from "@cobeing/providers";
import type { LLMProvider } from "@cobeing/providers";
import type { ChannelAdapter } from "@cobeing/channels";
import { registerChannel, getChannel } from "@cobeing/channels";
import { PluginLoader, HookBus, PromptLayerRegistry, UIExtensionRegistry } from "@cobeing/plugin-sdk";
import type { CoBeingPluginApi } from "@cobeing/plugin-sdk";
import { Agent } from "./agent/agent.js";
import { AgentPaths } from "./agent/paths.js";
import { AgentEventBus } from "./agent/event-bus.js";
import { ChannelRouter } from "./group/router.js";
import { MarketCatalog } from "./market/catalog.js";
import { MarketInstaller } from "./market/installer.js";
import { SkillRepository } from "./skills/repository.js";
import { createLogger, setGlobalLogLevel, cleanupPendingDeletions, migratePermissionMode, DEFAULT_PROVIDER, DEFAULT_MODEL, DEFAULT_WS_PORT } from "@cobeing/shared";

import { AgentTodoScanner } from "./todo/scanner.js";
import { GlobalTodoStore } from "./todo/global-store.js";
import { ButlerTaskStore } from "./butler/butler-task-store.js";
import { GroupButlerBindingStore } from "./butler/butler-binding-store.js";
import { DockerSandbox } from "./tools/sandbox/docker-sandbox.js";
import { ContainerPool } from "./tools/sandbox/container-pool.js";
import { MCPManager } from "./mcp/manager.js";
import { makeMCPDiscoverTool, makeMCPRegisterTool } from "./tools/mcp-tools.js";
import { ObservabilityDB } from "./observability/observability-db.js";
import { buildProviders as buildNativeProviders, rebuildProvider as rebuildNativeProvider } from "./runtime/providers.js";
import {
  ensureMarketDirs as ensureMarketDirsHelper,
  syncBundledMarketResources as syncBundledMarketResourcesHelper,
  initMarketServices as initMarketServicesHelper,
  registerMarketAgent as registerMarketAgentHelper,
  createMarketGroup as createMarketGroupHelper,
  destroyMarketGroup as destroyMarketGroupHelper,
} from "./runtime/market.js";
import {
  setupChannelOnMessage as setupChannelOnMessageHelper,
  startChannels as startChannelsHelper,
  loadStaticBindings as loadStaticBindingsHelper,
  stopChannels as stopChannelsHelper,
} from "./runtime/channels.js";
import {
  CoreAgentsLifecycle,
  restoreAgents as restoreAgentsHelper,
  restoreRegistryState as restoreRegistryStateHelper,
  registerPrebuiltAgents as registerPrebuiltAgentsHelper,
} from "./runtime/core-agents.js";
import { ToolAgentRegistry } from "./agent/tool-agent/registry.js";

const log = createLogger("runtime");

export class CoBeingRuntime {
  readonly registry: AgentRegistry;
  readonly groupManager: GroupManager;
  readonly wsServer: CoreWSServer;
  readonly eventBus = new AgentEventBus();
  gateway!: LLMGateway; // created in createButler() after loadAllPlugins
  private butler!: ButlerAgent; // created in start() after loadAllPlugins (needs plugin providers)
  private providers = new Map<string, LLMProvider>();
  private channels: ChannelAdapter[] = [];
  readonly router: ChannelRouter;
  readonly skillRepo: SkillRepository;
  /** Market 分级服务（catalog 扫描 data/market + installer 安装/卸载，Butler 与 WS 共用） */
  readonly marketCatalog: MarketCatalog;
  readonly marketInstaller: MarketInstaller;
  private dataRoot: string;
  /** 项目根目录（用于解析 CWD 相对路径） */
  private rootDir: string;
  private todoScanner: AgentTodoScanner | null = null;
  readonly globalTodoStore: GlobalTodoStore;
  readonly butlerTaskStore: ButlerTaskStore;
  readonly butlerBindingStore: GroupButlerBindingStore;
  private pluginLoader: PluginLoader;
  /** 已解析的插件注册表（loadAllPlugins 填充，startChannels 读取） */
  private pluginRegistry: import("@cobeing/plugin-sdk").PluginRegistry | null = null;
  /** 插件钩子总线 */
  readonly hookBus = new HookBus();
  /** 插件 Prompt 层注册表 */
  readonly promptLayerRegistry = new PromptLayerRegistry();
  /** 插件 UI 扩展注册表 */
  readonly uiExtensions = new UIExtensionRegistry();
  /** 全局 MCP 管理器（按需注册，非自动推给所有 Agent） */
  readonly mcpManager = new MCPManager();
  /** 轻量 ToolAgent 注册表（决策 #8 / spec #4：统一注册/发现入口） */
  readonly toolAgentRegistry = new ToolAgentRegistry();
  /** Docker 可用性（start() 中检查，用于沙箱降级） */
  private dockerAvailable = false;
  /** 全局可观测性数据库 */
  readonly observabilityDB: ObservabilityDB;

  /** All configured providers keyed by provider ID */
  get providersMap(): Map<string, LLMProvider> { return this.providers; }

  /** 核心 Agent 创建域（懒加载；依赖字段在构造体中逐步就绪，首个调用发生在构造体尾部 reloadButlerSelfConfig） */
  private _coreAgents?: CoreAgentsLifecycle;
  private get coreAgents(): CoreAgentsLifecycle {
    if (!this._coreAgents) {
      this._coreAgents = new CoreAgentsLifecycle(this.coreAgentsDeps());
    }
    return this._coreAgents;
  }

  /** 核心 Agent 创建域依赖（统一组装，供 core-agents helper 使用；dockerAvailable 动态读取避免构造期快照） */
  private coreAgentsDeps() {
    const rt = this;
    return {
      config: this.config,
      dataRoot: this.dataRoot,
      registry: this.registry,
      groupManager: this.groupManager,
      eventBus: this.eventBus,
      router: this.router,
      skillRepo: this.skillRepo,
      providers: this.providers,
      observabilityDB: this.observabilityDB,
      get dockerAvailable(): boolean { return rt.dockerAvailable; },
    };
  }

  constructor(private config: AppConfig) {
    this.rootDir = path.resolve(".");
    this.dataRoot = path.resolve(config.core.dataDir ?? "./data");

    // 在任何 SQLite 连接之前，清理上次残留的标记删除目录
    cleanupPendingDeletions(this.dataRoot);

    // Consolidated global namespace (replaces 14+ individual __cobeing* globals)
    (globalThis as any).__cobeing = {
      runtime: this,
      agentRegistry: null as any,
      groupManager: null as any,
      dataRoot: this.dataRoot,
      config: config,
      getProvider: (id: string) => this.providers.get(id),
      obsDb: null as any,
      hookBus: this.hookBus,
      promptLayers: this.promptLayerRegistry,
      uiExtensions: this.uiExtensions,
      skillRepo: null as any,
      pluginTools: new Map(),
      pluginMemoryBackends: new Map(),
      toolAgents: new Map(),
      toolAgentRegistry: this.toolAgentRegistry,
    };

    // B3 僵尸修复：为旧式独立全局变量补齐兼容别名。
    // 此前仅有 __cobeing 命名空间，旧式 __cobeingHookBus/__cobeingPromptLayers 等
    // 从未被写入，导致插件 hook 事件、PromptLayer 静默失效。
    (globalThis as any).__cobeingHookBus = this.hookBus;
    (globalThis as any).__cobeingPromptLayers = this.promptLayerRegistry;
    (globalThis as any).__cobeingConfig = config;
    (globalThis as any).__cobeingDataRoot = this.dataRoot;
    (globalThis as any).__cobeingGetProvider = (id: string) => this.providers.get(id);

    // 全局 Skill 仓库
    const skillsDir = config.core.skillsDir ?? "./data/skills";
    this.skillRepo = new SkillRepository(path.resolve(skillsDir));
    (globalThis as any).__cobeing.skillRepo = this.skillRepo;

    this.registry = new AgentRegistry();
    (globalThis as any).__cobeing.agentRegistry = this.registry;
    (globalThis as any).__cobeingAgentRegistry = this.registry;
    this.groupManager = new GroupManager(
      this.registry,
      this.dataRoot,
      (providerId?: string) => {
        if (providerId) return this.providers.get(providerId);
        return this.providers.get(DEFAULT_PROVIDER);
      },
    );
    (globalThis as any).__cobeing.groupManager = this.groupManager;
    this.observabilityDB = new ObservabilityDB(this.dataRoot);
    (globalThis as any).__cobeing.obsDb = this.observabilityDB;
    (globalThis as any).__cobeingObsDb = this.observabilityDB;
    // Market 分级服务：catalog 扫描 data/market，installer 负责依赖解析/分级安装/卸载。
    // hooks 由 runtime 提供真实接线（Agent 注册 / 群组创建 / 技能重载）。
    this.marketCatalog = new MarketCatalog(this.dataRoot);
    this.marketInstaller = new MarketInstaller(this.marketCatalog, {
      dataRoot: this.dataRoot,
      hooks: {
        registerAgent: (id, dir) => this.registerMarketAgent(id, dir),
        createGroup: (id, name, memberIds, topic) => this.createMarketGroup(id, name, memberIds, topic),
        destroyGroup: (id) => this.destroyMarketGroup(id),
        reloadSkills: () => this.skillRepo.reload(),
      },
    });
    // 初始化 Global TODO Store（Butler 编排层）
    const butlerDataDir = path.join(this.dataRoot, "coreagents", "butler");
    this.globalTodoStore = new GlobalTodoStore(butlerDataDir);
    this.butlerTaskStore = new ButlerTaskStore(butlerDataDir);
    this.butlerBindingStore = new GroupButlerBindingStore(butlerDataDir);
    this.wsServer = new CoreWSServer(config.gui?.wsPort ?? DEFAULT_WS_PORT);

    // 初始化 ChannelRouter（butler 回调在 start() 中通过 setButlerCallback 连接）
    this.router = new ChannelRouter(this.groupManager);

    // 构建插件宿主 API — 桥接到现有全局注册表
    const rootDir = this.rootDir;
    const hookBus = this.hookBus;
    const promptLayers = this.promptLayerRegistry;
    const uiExts = this.uiExtensions;

    const pluginApi: CoBeingPluginApi = {
      registerModelProvider(p) {
        if (getProvider(p.id)) {
          throw new Error(`Provider id already registered: ${p.id}`);
        }
        registerProvider(p as unknown as LLMProvider);
      },
      registerChannel(c) {
        if (getChannel(c.id)) {
          throw new Error(`Channel id already registered: ${c.id}`);
        }
        registerChannel(c as any);
      },
      registerTool(toolPlugin) {
        const registry: Map<string, import("@cobeing/plugin-sdk").ToolPlugin> =
          (globalThis as any).__cobeing.pluginTools;
        registry.set(toolPlugin.id, toolPlugin);
        log.info("Plugin registered tools: %s (%d tools)", toolPlugin.id, toolPlugin.tools.length);
      },
      registerMemoryBackend(backend) {
        const registry: Map<string, import("@cobeing/plugin-sdk").MemoryBackendPlugin> =
          (globalThis as any).__cobeing.pluginMemoryBackends;
        registry.set(backend.id, backend);
        log.info("Plugin registered memory backend: %s", backend.id);
      },
      onHook(event: any, handler: any) {
        hookBus.on(event, "(plugin)", handler);
      },
      registerPromptLayer(layer: any) { promptLayers.register(layer); },
      registerSkill(skill: any) {
        const repo = (globalThis as any).__cobeing.skillRepo;
        if (repo && typeof repo.create === "function") {
          repo.create(skill.id, skill.name, skill.description, skill.template, skill.tools ?? []);
          log.info("Plugin registered skill: %s", skill.id);
        }
      },
      registerToolAgent(agentDef: any) {
        const registry: Map<string, any> = (globalThis as any).__cobeing.toolAgents;
        registry.set(agentDef.id, agentDef);
        this.toolAgentRegistry.registerPluginAgent(agentDef);
      },
      registerUIExtension(ext: any) {
        // Basic validation
        if (!ext.id || !ext.label || !ext.componentPath) {
          log.warn("Plugin registered UI extension with missing required fields — skipped");
          return;
        }
        const allowed = ["settings-panel", "dashboard-card", "chat-action"];
        if (!allowed.includes(ext.type)) {
          log.warn("Plugin UI extension '%s' has unknown type '%s' — skipped", ext.id, ext.type);
          return;
        }
        if (ext.componentPath.includes("..") || ext.componentPath.includes("\\")) {
          log.warn("Plugin UI extension '%s' has suspicious componentPath — skipped", ext.id);
          return;
        }
        uiExts.register(ext);
        log.info("Plugin registered UI extension: %s (%s)", ext.id, ext.type);
      },
      getConfig() {
        // Return sanitized config (deep clone + strip secrets)
        const safe = structuredClone(config) as Record<string, any>;
        // Redact provider apiKeys
        if (safe.providers) {
          for (const key of Object.keys(safe.providers)) {
            if (safe.providers[key].apiKey) safe.providers[key].apiKey = "***";
          }
        }
        // Redact channel secrets
        if (safe.channels) {
          for (const key of Object.keys(safe.channels)) {
            const ch = safe.channels[key];
            if (ch.qqbotAppSecret) ch.qqbotAppSecret = "***";
          }
        }
        // Redact MCP server env/headers
        if (safe.mcpServers) {
          for (const key of Object.keys(safe.mcpServers)) {
            const srv = safe.mcpServers[key];
            if (srv.env) srv.env = "***";
            if (srv.headers) srv.headers = "***";
          }
        }
        // Include plugin registry configs so plugins can access their own settings
        if ((globalThis as any).__cobeing?.runtime?.pluginRegistry) {
          const runtime = (globalThis as any).__cobeing.runtime;
          safe.pluginConfigs = {};
          for (const [pluginId, entry] of Object.entries(runtime.pluginRegistry.plugins as Record<string, any>)) {
            safe.pluginConfigs[pluginId] = entry.config ?? {};
          }
        }
        // Read version from root package.json
        let version = "0.0.0";
        try {
          const pkgPath = path.resolve(rootDir, "package.json");
          version = JSON.parse(fs.readFileSync(pkgPath, "utf-8")).version ?? "0.0.0";
        } catch { /* keep default */ }
        safe.version = version;
        return safe as Record<string, unknown>;
      },
      _hookBus: hookBus,
    };
    this.pluginLoader = new PluginLoader(pluginApi);

    // 构建多 Provider
    this.buildProviders(config);

    // 加载 butler 自治配置（从 data/coreagents/butler/config.json）— deferred creation to start()
    const butlerPaths = AgentPaths.forAgent("butler", this.dataRoot);
    migratePermissionMode(path.dirname(butlerPaths.configPath));
    this.reloadButlerSelfConfig();
  }

  /** 读取管家自治配置（ensureButlerDir 首次启动可能刚写入 config.json，start 前需重读，实现见 runtime/core-agents.ts） */
  private reloadButlerSelfConfig(): void {
    const butlerSelfConfig = this.coreAgents.reloadButlerSelfConfig();
    // Store butler config for deferred creation (after loadAllPlugins ensures plugin providers are available)
    (this as any)._butlerSelfConfig = butlerSelfConfig;
    (this as any)._butlerProviderId = butlerSelfConfig.provider || DEFAULT_PROVIDER;
    (this as any)._butlerModel = butlerSelfConfig.model || DEFAULT_MODEL;
  }

  /** 创建管家（在 loadAllPlugins 之后调用，确保插件 providers 可用，实现见 runtime/core-agents.ts） */
  private createButler(): void {
    const butlerSelfConfig = (this as any)._butlerSelfConfig as Partial<AgentSelfConfig>;
    const { butler, gateway } = this.coreAgents.createButler(butlerSelfConfig);
    this.gateway = gateway;
    this.butler = butler;
  }

  /** 按 config 构建原生 Provider（仅 deepseek 默认，其余由插件注册，实现见 runtime/providers.ts） */
  private buildProviders(config: AppConfig): void {
    buildNativeProviders({ dataRoot: this.dataRoot, rootDir: this.rootDir, config, providers: this.providers });
  }

  /** 热重载单个 Provider（支持原生 deepseek 及插件注册的 provider，实现见 runtime/providers.ts） */
  rebuildProvider(providerId: string): void {
    rebuildNativeProvider({ dataRoot: this.dataRoot, rootDir: this.rootDir, config: this.config, providers: this.providers }, providerId);
  }

  /** 从 Master Registry 恢复已持久化的 Agent（实现见 runtime/core-agents.ts） */
  private restoreAgents(): void {
    restoreAgentsHelper(this.coreAgentsDeps());
  }

  async start(): Promise<void> {
    // 基础设施：进程级错误处理 + 全局日志级别
    this.setupGlobalErrorHandlers();

    // Docker 可用性检查（一次性，结果缓存到 this.dockerAvailable）
    await this.checkDockerAvailability();

    // 加载所有启用的插件（从 registry.json）— Provider/Channel/Tool/Extension
    await this.loadAllPluginsStep();

    // 创建管家（在 loadAllPlugins 之后，确保插件 providers 已加载）
    await this.createCoreAgents();

    // 注册表恢复：确保 master registry 存在（首次启动从文件系统迁移）+ 恢复持久化 Agent + 注册预置 Agent
    this.restoreRegistryState();

    // 连接 MCP 服务器到全局管理器（不自动推给 Agent）+ 注册 MCP 工具
    await this.setupMCP();

    // Restore persisted groups from data/groups/ (now reads from master registry)
    this.restoreGroups();

    // 初始化 Market 分级服务（同步内置官方资源 + 扫描 catalog + 确保目录）
    this.initMarketServices();

    // 配置 WS Server（收敛 8 个 setter 的 WS 接线）
    this.configureWSServer();

    // 连接 router → butler / agent
    this.setupRouterCallbacks();

    // 加载静态绑定
    this.loadStaticBindings();

    // 启动服务（WS start + WakeSystem resume + 广播最终状态 + 启动 Channels）
    await this.startServices();

    // 启动 TODO 扫描器
    this.startTodoScanner();

    // 确保 data/ 7 分类目录结构 + 初始化本地过滤引擎
    await this.ensureRuntimeDirs();

    // 轻量 ToolAgent 注册表：从 data/toolagents/ 全量加载配置卡 spec（决策 #8）
    this.toolAgentRegistry.loadAll(this.dataRoot);

    log.info("Runtime started (dataRoot=%s). Butler: %s, WS: ws://localhost:%d",
      this.dataRoot, this.butler.name, this.config.gui?.wsPort ?? DEFAULT_WS_PORT);
    log.info("Providers: %s", [...this.providers.keys()].join(", "));
    log.info("Channels: %d configured", Object.values(this.config.channels).filter(c => c.enabled).length);
  }

  /** 配置进程级错误处理（resilience：未处理拒绝/异常仅记录，不崩溃） */
  private setupGlobalErrorHandlers(): void {
    // Process-level error handlers for resilience
    process.on("unhandledRejection", (reason, promise) => {
      log.error("Unhandled promise rejection:", reason);
    });
    process.on("uncaughtException", (error) => {
      log.error("Uncaught exception:", error);
      // Don't crash — log and continue for resilience
    });

    setGlobalLogLevel(this.config.core.logLevel as "debug" | "info" | "warn" | "error");
  }

  /** 检查 Docker 可用性（一次性，结果缓存到 this.dockerAvailable） */
  private async checkDockerAvailability(): Promise<void> {
    // 检查 Docker 可用性（一次性，结果缓存到 this.dockerAvailable）
    const dockerCheck = await DockerSandbox.checkDockerAvailable();
    this.dockerAvailable = dockerCheck.available;
    ContainerPool.setDockerAvailable(this.dockerAvailable);
    if (!this.dockerAvailable) {
      log.warn("Docker not available, all sandboxes disabled: %s", dockerCheck.error);
    }
  }

  /** 加载所有启用的插件（从 registry.json）— Provider/Channel/Tool/Extension */
  private async loadAllPluginsStep(): Promise<void> {
    // 加载所有启用的插件（从 registry.json）— Provider/Channel/Tool/Extension
    await this.loadAllPlugins();
  }
  /** 创建管家（在 loadAllPlugins 之后，确保插件 providers 已加载，实现见 runtime/core-agents.ts） */
  private async createCoreAgents(): Promise<void> {
    // 确保管家文件体系（AGENTS/CHARACTER/JOB/MEMORY/EXPERIENCE + config.json）
    // 必须先于 createButler — 管家 prompt 走文件（templates/butler → data/coreagents/butler/）
    this.coreAgents.ensureButlerDir();
    // ensureButlerDir 首次启动可能刚写入 config.json — 重读管家自治配置
    this.reloadButlerSelfConfig();
    // 创建管家（在 loadAllPlugins 之后，确保插件 providers 已加载）
    this.createButler();
    // 如果 Docker 不可用，降级管家沙箱
    if (!this.dockerAvailable && (this.butler as any)._sandbox) {
      await (this.butler as any)._sandbox.destroy();
      (this.butler as any)._sandbox = null;
    }
  }

  /** 确保 master registry 存在（首次启动从文件系统迁移）+ 恢复持久化 Agent + 注册预置 Agent（实现见 runtime/core-agents.ts） */
  private restoreRegistryState(): void {
    restoreRegistryStateHelper(this.coreAgentsDeps(), this.coreAgents);
  }

  /** 连接 MCP 服务器到全局管理器（不自动推给 Agent）+ 注册 MCP 工具 */
  private async setupMCP(): Promise<void> {
    // 连接 MCP 服务器到全局管理器（不自动推给 Agent）
    await this.connectAllMCPServers();

    // 注册 mcp-discover / mcp-register 工具到所有 Agent（按需发现和注册）
    this.registerMCPTools();
  }

  /** 恢复持久化的群组（现在从 master registry 读取） */
  private restoreGroups(): void {
    // Restore persisted groups from data/groups/ (now reads from master registry)
    this.groupManager.restoreGroups();
  }

  /** 配置 WS Server — 收敛 8 个 setter（按原顺序注入所有依赖） */
  private configureWSServer(): void {
    this.wsServer.setAgentRegistry(this.registry);
    this.wsServer.setGroupManager(this.groupManager);
    this.wsServer.setChannelRouter(this.router);
    this.wsServer.registerAgent(this.butler);

    // Inject provider resolver + data root to WS server for direct creation
    this.wsServer.setProviderResolver((id) => this.providers.get(id));
    this.wsServer.setOnProviderChange((providerId) => this.rebuildProvider(providerId));
    this.wsServer.setDataRoot(this.dataRoot);
    this.wsServer.setSkillRepository(this.skillRepo);
    this.wsServer.setMarketServices(this.marketCatalog, this.marketInstaller);

    // MCP 配置热重载
    this.wsServer.setOnMcpConfigChange(async (serverId, config) => {
      const agents = this.registry.list();
      if (config === null) {
        await this.mcpManager.disconnect(serverId);
        for (const agent of agents) {
          try {
            await agent.disconnectMCPServer(serverId);
          } catch (err: any) {
            log.warn("MCP server '%s' hot-disconnect failed for '%s': %s", serverId, agent.id, err.message);
          }
        }
        log.info("MCP server '%s' removed", serverId);
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
  }

  /** 连接 router → butler / agent */
  private setupRouterCallbacks(): void {
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
  }

  /** 启动服务（WS start + WakeSystem resume + 广播最终状态 + 启动 Channels） */
  private async startServices(): Promise<void> {
    await this.wsServer.start();

    // WS server 已启动，恢复所有群组的 WakeSystem（处理 restoreGroups 期间积压的唤醒队列）
    this.groupManager.resumeAllWakeSystems();

    // 广播最终状态到所有已连接的 GUI 客户端（确保启动后 Agent/群组列表可见）
    this.wsServer.broadcastState();

    // 启动 Channels
    await this.startChannels();
  }

  /** 启动 TODO 扫描器 */
  private startTodoScanner(): void {
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
    // 注入到 wsServer：Agent 完成发言后检查 Agent 级 condition TODO
    this.wsServer.setAgentTodoScanner(this.todoScanner);
  }

  /** 确保 data/ 7 分类目录结构 + 初始化本地过滤引擎 */
  private async ensureRuntimeDirs(): Promise<void> {
    // 确保 data/ 7 分类目录结构
    this.ensureDataDirs();
    this.ensureHostDir();

    // 初始化本地过滤引擎
    await this.initLocalFilter();
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
    await this.stopWSServer();

    // 2. 停止后台扫描器
    this.stopTodoScanner();

    // 3. 释放本地过滤引擎
    this.disposeLocalFilter();

    // 4. 关闭所有 Channel 并清理路由绑定
    await this.stopChannels();

    // 5. 关闭所有 Agent（释放 memory.db 等）
    await this.disposeAgents();

    // 6. 释放群组资源（SQLite 等）
    this.disposeGroups();

    // 7. 关闭 MCP 连接
    await this.closeMCPConnections();

    // 8. 清理全局变量
    delete (globalThis as any).__cobeing;

    this.observabilityDB.close();
    log.info("Runtime stopped");
  }

  /** 停止 WS Server（先通知前端保存数据，发送 shutdown 信号 + 等待 flush） */
  private async stopWSServer(): Promise<void> {
    await this.wsServer.stop();
  }

  /** 停止后台扫描器 */
  private stopTodoScanner(): void {
    this.todoScanner?.stop();
  }

  /** 释放本地过滤引擎 */
  private disposeLocalFilter(): void {
    if ((this as any)._localFilter) {
      (this as any)._localFilter.dispose();
    }
  }

  /** 关闭所有 Channel 并清理路由绑定（实现见 runtime/channels.ts） */
  private async stopChannels(): Promise<void> {
    await stopChannelsHelper(this.channels, this.router);
  }

  /** 关闭所有 Agent（释放 memory.db 等） */
  private async disposeAgents(): Promise<void> {
    for (const agent of this.registry.list()) {
      await agent.dispose();
    }
  }

  /** 释放群组资源（SQLite 等） */
  private disposeGroups(): void {
    this.groupManager.disposeAll();
  }

  /** 关闭 MCP 连接 */
  private async closeMCPConnections(): Promise<void> {
    await this.mcpManager.close();
  }

  /** 从 registry.json 加载所有启用的插件（统一入口，实现见 runtime/plugin-loader.ts） */
  private async loadAllPlugins(): Promise<void> {
    const { loadAllPlugins: loadPlugins } = await import("./runtime/plugin-loader.js");
    this.pluginRegistry = await loadPlugins({
      dataRoot: this.dataRoot,
      rootDir: this.rootDir,
      pluginLoader: this.pluginLoader,
      registry: this.registry,
      providers: this.providers,
    });
  }

  /** 为 channel 设置统一的消息处理管线（实现见 runtime/channels.ts） */
  private _setupChannelOnMessage(channelId: string): void {
    setupChannelOnMessageHelper(this.channelDeps(), channelId);
  }

  /** 启动所有 Channel（配置驱动 + 插件注册，实现见 runtime/channels.ts） */
  private async startChannels(): Promise<void> {
    await startChannelsHelper(this.channelDeps());
  }

  /** Channel 生命周期域依赖（统一组装，供各 Channel helper 使用） */
  private channelDeps() {
    return {
      config: this.config,
      pluginRegistry: () => this.pluginRegistry,
      router: this.router,
      wsServer: this.wsServer,
      groupManager: this.groupManager,
      registry: this.registry,
      getButler: () => this.butler,
      channels: this.channels,
    };
  }

  /** 从配置加载静态 Channel 绑定（实现见 runtime/channels.ts） */
  private loadStaticBindings(): void {
    loadStaticBindingsHelper(this.config, this.router);
  }

  /** 处理用户输入（交互式） */
  async handleUserInput(input: string): Promise<string> {
    const response = await this.butler.run(input);
    return response.content;
  }

  /** 确保 data/ 7 个分类目录结构存在 */
  private ensureDataDirs(): void {
    const dirs = ["agents", "groups", "coreagents", "tools", "toolagents", "skills", "plugins", "market"];
    for (const d of dirs) {
      fs.mkdirSync(path.join(this.dataRoot, d), { recursive: true });
    }
  }

  /** 确保 data/market/<tier>/ 目录结构（official/certified/community，实现见 runtime/market.ts） */
  private ensureMarketDirs(): void {
    ensureMarketDirsHelper(this.dataRoot);
  }

  /** 首次启动时把 packages/core/src/market/bundled/ 内置资源同步到 data/market/（已存在不覆盖） */
  private syncBundledMarketResources(): void {
    syncBundledMarketResourcesHelper(this.dataRoot);
  }

  /** 初始化 Market 分级服务：确保目录 + 同步内置资源 + 重扫 catalog */
  private initMarketServices(): void {
    initMarketServicesHelper(this.marketDeps());
  }

  /** Market 安装 Agent 后的注册钩子：读取 config.json 并注册 Agent 实例 */
  private registerMarketAgent(id: string, dir: string): void {
    registerMarketAgentHelper(this.marketDeps(), id, dir);
  }

  /** Market 安装群组后的钩子：创建群组并写入 ButlerRegistry */
  private createMarketGroup(id: string, name: string, memberIds: string[], topic?: string): void {
    createMarketGroupHelper(this.marketDeps(), id, name, memberIds, topic);
  }

  /** Market 卸载群组后的钩子 */
  private destroyMarketGroup(id: string): void {
    destroyMarketGroupHelper(this.marketDeps(), id);
  }

  /** Market 服务域依赖（统一组装，供各 Market helper 使用） */
  private marketDeps() {
    return {
      dataRoot: this.dataRoot,
      registry: this.registry,
      groupManager: this.groupManager,
      skillRepo: this.skillRepo,
      providers: this.providers,
      marketCatalog: this.marketCatalog,
      marketInstaller: this.marketInstaller,
    };
  }

  /** 确保 data/coreagents/host/ 目录结构存在（实现见 runtime/core-agents.ts） */
  private ensureHostDir(): void {
    this.coreAgents.ensureHostDir();
  }

  /**
   * 确保 data/coreagents/butler/ 文件体系存在（实现见 runtime/core-agents.ts）。
   * 首次启动创建 {config.json, AGENTS.md, CHARACTER.md, JOB.md, MEMORY.md, EXPERIENCE.md}；
   * 已存在文件一律不覆盖（用户修改过的人格/记忆/经验保留）。
   */
  private ensureButlerDir(): void {
    this.coreAgents.ensureButlerDir();
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

  /** Register pre-built agents from config.agents ID list (e.g., host, 实现见 runtime/core-agents.ts) */
  private registerPrebuiltAgents(): void {
    registerPrebuiltAgentsHelper(this.coreAgentsDeps(), this.coreAgents);
  }

  /** 注册群主增强工具（实现见 runtime/core-agents.ts） */
  private registerHostTools(agent: Agent): void {
    this.coreAgents.registerHostTools(agent);
  }

  /** 获取 Gateway 状态 */
  getGatewayStatus(): { activeCount: number; queueLength: number; currentRpm: number } {
    return this.gateway.getStatus();
  }
}
