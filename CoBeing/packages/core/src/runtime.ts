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
import { PluginLoader, HookBus, PromptLayerRegistry, UIExtensionRegistry } from "@cobeing/plugin-sdk";
import type { CoBeingPluginApi } from "@cobeing/plugin-sdk";
import { Agent } from "./agent/agent.js";
import { AgentPaths } from "./agent/paths.js";
import { AgentEventBus } from "./agent/event-bus.js";
import { ChannelRouter } from "./group/router.js";
import { makeGroupPlanTool, makeGroupInviteTalkTool, makeGroupSummarizeTool, makeGroupAssignTaskTool } from "./group/owner.js";
import { SkillRepository } from "./skills/repository.js";
import { VoteStore } from "./vote/store.js";
import type { ChannelBindTo } from "./config/schema.js";
import { createLogger, setGlobalLogLevel, readMasterRegistry, migrateFromFilesystem, cleanupOrphanDirectories, cleanupPendingDeletions, addAgentToRegistry, migratePermissionMode, DEFAULT_PROVIDER, DEFAULT_MODEL, DEFAULT_JUDGMENT_MODEL, DEFAULT_WS_PORT } from "@cobeing/shared";
import { decrypt } from "./config/secret-store.js";
import { AgentTodoScanner } from "./todo/scanner.js";
import { GlobalTodoStore } from "./todo/global-store.js";
import { ButlerTaskStore } from "./butler/butler-task-store.js";
import { GroupButlerBindingStore } from "./butler/butler-binding-store.js";
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
  gateway!: LLMGateway; // created in createButler() after loadAllPlugins
  private butler!: ButlerAgent; // created in start() after loadAllPlugins (needs plugin providers)
  private providers = new Map<string, LLMProvider>();
  private channels: ChannelAdapter[] = [];
  readonly router: ChannelRouter;
  readonly skillRepo: SkillRepository;
  private dataRoot: string;
  /** 项目根目录（用于解析 CWD 相对路径） */
  private rootDir: string;
  private todoScanner: AgentTodoScanner | null = null;
  readonly globalTodoStore: GlobalTodoStore;
  readonly butlerTaskStore: ButlerTaskStore;
  readonly butlerBindingStore: GroupButlerBindingStore;
  readonly voteStore: VoteStore;
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
  /** Docker 可用性（start() 中检查，用于沙箱降级） */
  private dockerAvailable = false;
  /** 全局可观测性数据库 */
  readonly observabilityDB: ObservabilityDB;

  /** All configured providers keyed by provider ID */
  get providersMap(): Map<string, LLMProvider> { return this.providers; }

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
      voteStore: null as any,
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
    };

    // 全局 Skill 仓库
    const skillsDir = config.core.skillsDir ?? "./data/skills";
    this.skillRepo = new SkillRepository(path.resolve(skillsDir));
    (globalThis as any).__cobeing.skillRepo = this.skillRepo;

    this.registry = new AgentRegistry();
    (globalThis as any).__cobeing.agentRegistry = this.registry;
    this.groupManager = new GroupManager(
      this.registry,
      this.dataRoot,
      (providerId?: string) => {
        if (providerId) return this.providers.get(providerId);
        return this.providers.get(DEFAULT_PROVIDER);
      },
    );
    (globalThis as any).__cobeing.groupManager = this.groupManager;
    this.voteStore = new VoteStore(this.dataRoot);
    (globalThis as any).__cobeing.voteStore = this.voteStore;
    this.observabilityDB = new ObservabilityDB(this.dataRoot);
    (globalThis as any).__cobeing.obsDb = this.observabilityDB;
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
        log.info("Plugin registered tool-agent: %s (%s)", agentDef.id, agentDef.name);
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
    let butlerSelfConfig: Partial<AgentSelfConfig> = {};
    if (fs.existsSync(butlerPaths.configPath)) {
      try {
        butlerSelfConfig = JSON.parse(fs.readFileSync(butlerPaths.configPath, "utf-8"));
      } catch {
        // config.json 损坏
      }
    }
    // Store butler config for deferred creation (after loadAllPlugins ensures plugin providers are available)
    (this as any)._butlerSelfConfig = butlerSelfConfig;
    (this as any)._butlerProviderId = butlerSelfConfig.provider || DEFAULT_PROVIDER;
    (this as any)._butlerModel = butlerSelfConfig.model || DEFAULT_MODEL;
  }

  /** 创建管家（在 loadAllPlugins 之后调用，确保插件 providers 可用） */
  private createButler(): void {
    const butlerSelfConfig = (this as any)._butlerSelfConfig as Partial<AgentSelfConfig>;
    const butlerProviderId = (this as any)._butlerProviderId as string;
    const butlerModel = (this as any)._butlerModel as string;
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
    }, butlerProvider, this.registry, this.groupManager, (providerId: string) => this.providers.get(providerId), this.router, this.config);

    // 注入 SkillRepository 到管家
    this.butler.injectSkillRepository(this.skillRepo);
    // 注入群组通信工具（group-send / group-update-progress / group-experience-add / group-experience-summarize）
    this.butler.injectGroupTools((gid) => this.groupManager.get(gid));
    // 设置 Provider 回落列表
    this.butler.setAllProviders(this.providers);
    this.butler.setObservabilityDB(this.observabilityDB);
  }

  /** 按 config 构建原生 Provider（仅 deepseek 默认，其余由插件注册） */
  private buildProviders(config: AppConfig): void {
    // 仅 deepseek 作为原生内置 provider
    const deepseekCfg = config.providers?.deepseek;
    const modelsPath = path.resolve(this.dataRoot, "plugins", "providers", "deepseek", "models.json");
    let deepseekModels: import("@cobeing/shared").ModelInfo[] = [];

    // 从插件目录的 models.json 加载模型列表
    if (fs.existsSync(modelsPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(modelsPath, "utf-8"));
        deepseekModels = (parsed.models || []) as import("@cobeing/shared").ModelInfo[];
      } catch { /* fallback to hardcoded */ }
    }

    if (deepseekModels.length === 0) {
      deepseekModels = PROVIDER_CATALOGS.deepseek || [];
    }

    if (deepseekCfg) {
      const apiKey = (deepseekCfg.apiKey ? decrypt(deepseekCfg.apiKey) : "") ||
        process.env[deepseekCfg.apiKeyEnv ?? ""] || "";

      try {
        const provider = new OpenAICompatProvider({
          id: "deepseek",
          name: "DeepSeek",
          apiKey,
          baseURL: deepseekCfg.baseURL ?? "https://api.deepseek.com",
          models: deepseekModels,
        });
        registerProvider(provider);
        this.providers.set("deepseek", provider);
        log.info("Provider ready: deepseek");
      } catch (err: any) {
        log.warn("Failed to create provider deepseek: %s", err.message);
      }
    }

    // 警告非 deepseek provider（已迁移为插件）
    const nonDeepseekKeys = Object.keys(config.providers).filter(k => k !== "deepseek");
    if (nonDeepseekKeys.length > 0) {
      log.warn(
        "Providers %s are configured but no longer built natively. Install them as plugins from CoBeing-Market.",
        nonDeepseekKeys.join(", "),
      );
    }
  }

  /** 热重载单个 Provider（支持原生 deepseek 及插件注册的 provider） */
  rebuildProvider(providerId: string): void {
    // Read fresh config from disk
    let cfg = this.config.providers?.[providerId];
    try {
      const configPath = path.resolve(this.rootDir, "config/default.json");
      if (fs.existsSync(configPath)) {
        const fresh = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        if (fresh.providers?.[providerId]) {
          cfg = fresh.providers[providerId];
          if (!this.config.providers) this.config.providers = {};
          this.config.providers[providerId] = cfg;
        }
      }
    } catch { /* fallback to in-memory config */ }

    // For providers with config entries (native like deepseek), reconstruct from config
    if (cfg) {
      const apiKey = (cfg.apiKey ? decrypt(cfg.apiKey) : "") || process.env[cfg.apiKeyEnv ?? ""] || "";

      try {
        // Try loading models from plugin directory if it exists
        const pluginModelsPath = path.resolve(this.dataRoot, "plugins", "providers", providerId, "models.json");
        let models: import("@cobeing/shared").ModelInfo[] = [];
        if (fs.existsSync(pluginModelsPath)) {
          const parsed = JSON.parse(fs.readFileSync(pluginModelsPath, "utf-8"));
          if (parsed.models?.length) models = parsed.models;
        }
        // Fallback to known catalogs
        if (models.length === 0) {
          models = (PROVIDER_CATALOGS as any)[providerId] || [];
        }

        const provider = new OpenAICompatProvider({
          id: providerId,
          name: (cfg as any).name || providerId,
          apiKey,
          baseURL: cfg.baseURL ?? "https://api.deepseek.com",
          models,
        });
        registerProvider(provider);
        this.providers.set(providerId, provider);
        log.info("Provider rebuilt: %s", providerId);
        return;
      } catch (err: any) {
        log.error("Failed to rebuild provider %s: %s", providerId, err.message);
        return;
      }
    }

    // For plugin-managed providers without config entries, try refresh via global registry
    const globalProvider = getProvider(providerId);
    if (globalProvider) {
      this.providers.set(providerId, globalProvider);
      log.info("Provider refreshed from global registry: %s", providerId);
    } else {
      log.warn("Cannot rebuild provider '%s': no config entry and not in global registry", providerId);
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

      const providerId = selfConfig.provider || DEFAULT_PROVIDER;
      const model = selfConfig.model || DEFAULT_MODEL;
      const provider = this.providers.get(providerId) ?? this.providers.get(DEFAULT_PROVIDER);

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
    // Process-level error handlers for resilience
    process.on("unhandledRejection", (reason, promise) => {
      log.error("Unhandled promise rejection:", reason);
    });
    process.on("uncaughtException", (error) => {
      log.error("Uncaught exception:", error);
      // Don't crash — log and continue for resilience
    });

    setGlobalLogLevel(this.config.core.logLevel as "debug" | "info" | "warn" | "error");

    // 检查 Docker 可用性（一次性，结果缓存到 this.dockerAvailable）
    const dockerCheck = await DockerSandbox.checkDockerAvailable();
    this.dockerAvailable = dockerCheck.available;
    ContainerPool.setDockerAvailable(this.dockerAvailable);
    if (!this.dockerAvailable) {
      log.warn("Docker not available, all sandboxes disabled: %s", dockerCheck.error);
    }

    // 加载所有启用的插件（从 registry.json）— Provider/Channel/Tool/Extension
    await this.loadAllPlugins();

    // 创建管家（在 loadAllPlugins 之后，确保插件 providers 已加载）
    this.createButler();
    // 如果 Docker 不可用，降级管家沙箱
    if (!this.dockerAvailable && (this.butler as any)._sandbox) {
      await (this.butler as any)._sandbox.destroy();
      (this.butler as any)._sandbox = null;
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

    // Clean registry/directory drift before restore, otherwise stale registry
    // entries can recreate manually deleted agents/groups as ghosts.
    cleanupOrphanDirectories(this.dataRoot);

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

    // 确保 data/ 7 分类目录结构
    this.ensureDataDirs();
    this.ensureHostDir();

    // 初始化本地过滤引擎
    await this.initLocalFilter();

    log.info("Runtime started (dataRoot=%s). Butler: %s, WS: ws://localhost:%d",
      this.dataRoot, this.butler.name, this.config.gui?.wsPort ?? DEFAULT_WS_PORT);
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

    // 4. 关闭所有 Channel 并清理路由绑定
    for (const ch of this.channels) {
      try {
        this.router.unbind(ch.id);
        await ch.stop();
      } catch { /* ignore */ }
    }
    this.channels = [];

    // 5. 关闭所有 Agent（释放 memory.db 等）
    for (const agent of this.registry.list()) {
      await agent.dispose();
    }

    // 6. 释放群组资源（SQLite 等）
    this.groupManager.disposeAll();

    // 7. 关闭 MCP 连接
    await this.mcpManager.close();

    // 8. 清理全局变量
    delete (globalThis as any).__cobeing;

    this.observabilityDB.close();
    log.info("Runtime stopped");
  }

  /** 从 registry.json 加载所有启用的插件（统一入口，替代 loadProviderPlugins） */
  private async loadAllPlugins(): Promise<void> {
    const pluginsRoot = path.resolve(this.dataRoot, "plugins");
    const registryPath = path.join(pluginsRoot, "registry.json");

    if (!fs.existsSync(registryPath)) {
      this.bootstrapRegistry(pluginsRoot, registryPath);
    }

    let registry: import("@cobeing/plugin-sdk").PluginRegistry;
    try {
      registry = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
    } catch {
      log.warn("Failed to parse registry.json — plugins disabled");
      return;
    }

    // Read current CoBeing version for cobeingVersion check
    let currentVersion = "0.0.0";
    try {
      const pkgJsonPath = path.resolve(this.rootDir, "package.json");
      if (fs.existsSync(pkgJsonPath)) {
        const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
        currentVersion = pkgJson.version || "0.0.0";
      }
    } catch { /* keep default */ }
    const [curMajor, curMinor] = currentVersion.split(".").map(Number);

    // cobeingVersion validation: skip plugins whose version requirement is not met
    let skippedVersionCheck = 0;
    for (const [pluginId, entry] of Object.entries(registry.plugins)) {
      if (!entry.enabled) continue;
      const pluginDir = path.join(pluginsRoot, entry.dir || "");
      const manifestPath = path.join(pluginDir, "cobeing.plugin.json");
      if (fs.existsSync(manifestPath)) {
        try {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
          if (manifest.cobeingVersion) {
            const reqStr = String(manifest.cobeingVersion);
            // Simple semver: extract major.minor from requirement string (e.g. ">=1.4.0" → 1.4)
            const verMatch = reqStr.match(/(\d+)\.(\d+)/);
            if (verMatch) {
              const reqMajor = Number(verMatch[1]);
              const reqMinor = Number(verMatch[2]);
              const satisfied = curMajor > reqMajor || (curMajor === reqMajor && curMinor >= reqMinor);
              if (!satisfied) {
                log.warn(
                  "Plugin '%s' requires CoBeing %s but current version is %s — skipping",
                  pluginId, reqStr, currentVersion,
                );
                entry.enabled = false;
                skippedVersionCheck++;
              }
            }
          }
        } catch { /* skip version check on parse error */ }
      }
    }

    this.pluginRegistry = registry;

    const loaded = await this.pluginLoader.loadFromRegistry(registry, pluginsRoot);
    log.info("Plugins loaded: %d (%s)", loaded.length, loaded.join(", ") || "none");

    // Orphan registry entry cleanup: remove entries whose dir doesn't exist on disk
    const orphanIds: string[] = [];
    for (const [pluginId, entry] of Object.entries(registry.plugins)) {
      const pluginDir = path.join(pluginsRoot, entry.dir || "");
      if (entry.dir && !fs.existsSync(pluginDir)) {
        orphanIds.push(pluginId);
        log.warn("Orphan plugin registry entry '%s': dir '%s' not found — removing", pluginId, entry.dir);
      }
    }
    if (orphanIds.length > 0) {
      for (const id of orphanIds) {
        delete registry.plugins[id];
      }
      try {
        fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2), "utf-8");
        log.info("Cleaned %d orphan registry entr%s", orphanIds.length, orphanIds.length === 1 ? "y" : "ies");
      } catch (err: any) {
        log.warn("Failed to save cleaned registry: %s", err.message);
      }
    }

    // 同步插件注册的 providers 到 this.providers
    const { getAllProviders } = await import("@cobeing/providers");
    for (const p of getAllProviders()) {
      if (!this.providers.has(p.id)) {
        this.providers.set(p.id, p);
        log.info("Plugin provider registered: %s", p.id);
      }
    }

    // 注入插件工具到所有 Agent
    const pluginTools: Map<string, import("@cobeing/plugin-sdk").ToolPlugin> =
      (globalThis as any).__cobeing?.pluginTools ?? new Map();
    if (pluginTools.size > 0) {
      const allAgents = [...this.registry.list()];
      const seen = new Set<string>();
      for (const agent of allAgents) {
        if (seen.has(agent.id)) continue;
        seen.add(agent.id);
        for (const [, toolPlugin] of pluginTools) {
          for (const toolDef of toolPlugin.tools) {
            try {
              agent.registerTool({
                name: toolDef.name,
                description: toolDef.description,
                parameters: { type: "object", properties: toolDef.parameters as any, required: [] },
                execute: async (params: Record<string, unknown>, _ctx: any) => {
                  const r = await toolDef.execute(params);
                  return { content: r.content, isError: r.isError ?? false, toolCallId: "" };
                },
              });
            } catch (err: any) {
              log.warn("Failed to register plugin tool %s for %s: %s", toolDef.name, agent.id, err.message);
            }
          }
        }
      }
      log.info("Injected %d plugin tool(s) into %d agent(s)", pluginTools.size, seen.size);
    }
  }

  /** 首次启动时扫描插件目录并生成 registry.json */
  private bootstrapRegistry(pluginsRoot: string, registryPath: string): void {
    const registry: import("@cobeing/plugin-sdk").PluginRegistry = {
      version: 1,
      plugins: {},
    };

    for (const kind of ["providers", "channels", "tools", "extensions"]) {
      const kindDir = path.join(pluginsRoot, kind);
      if (!fs.existsSync(kindDir)) continue;
      for (const entry of fs.readdirSync(kindDir)) {
        const entryPath = path.join(kindDir, entry);
        if (!fs.statSync(entryPath).isDirectory()) continue;
        const manifestPath = path.join(entryPath, "cobeing.plugin.json");
        if (!fs.existsSync(manifestPath)) continue;
        try {
          const m: { id: string; kind: string } = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
          if (registry.plugins[m.id]) {
            log.warn("Duplicate plugin ID '%s' in %s/%s — overwriting previous entry %s",
              m.id, kind, entry, registry.plugins[m.id].dir);
          }
          registry.plugins[m.id] = {
            enabled: false,
            kind: m.kind,
            dir: `${kind}/${entry}`,
            config: {},
          };
        } catch { /* skip corrupt */ }
      }
    }

    fs.mkdirSync(path.dirname(registryPath), { recursive: true });
    fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2), "utf-8");
    log.info("Bootstrapped plugin registry with %d plugin(s)", Object.keys(registry.plugins).length);
  }

  /** 为 channel 设置统一的消息处理管线 */
  private _setupChannelOnMessage(channelId: string): void {
    const channel = getChannel(channelId);
    if (!channel) return;

    channel.onMessage(async (msg) => {
      // Basic sanitization: limit content size and sender name length
      const safeContent = msg.content && msg.content.length > 102400
        ? msg.content.slice(0, 102400) + "...[truncated]"
        : msg.content;
      const safeSenderName = (msg.senderName || msg.senderId || "unknown").slice(0, 64);

      const binding = this.router.getBinding(channelId);
      const targetId = binding?.type === "agent" ? binding.agentId!
        : binding?.type === "group" ? binding.groupId!
        : "butler";

      const now = Date.now();

      this.wsServer.logMessage("in", `[${channelId}] ${safeSenderName}: ${safeContent}`);
      this.wsServer.broadcast({
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
      if (binding?.type === "group" && binding.groupId && this.groupManager) {
        const group = this.groupManager.get(binding.groupId);
        if (group?.config.reviewer?.enabled !== false && group.config.reviewer?.maxRounds !== 0) {
          const runtime = (globalThis as any).__cobeing?.runtime;
          const provider = runtime?.getProvider(DEFAULT_PROVIDER) as import("@cobeing/providers").LLMProvider | undefined;
          if (provider) {
            const { runReviewAgent, parseReviewOutput } = await import("./agent/tool-agent/review.js");
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

      const reply = await this.router.route(channelId, msg);
      if (reply) {
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
  }

  /** 启动所有 Channel（配置驱动 + 插件注册） */
  private async startChannels(): Promise<void> {
    // Resolve bindTo from registry entry config (plugin channels)
    const getPluginBindTo = (channelId: string): ChannelBindTo | undefined => {
      if (!this.pluginRegistry) return undefined;
      for (const [, entry] of Object.entries(this.pluginRegistry.plugins)) {
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
    for (const [id, cfg] of Object.entries(this.config.channels)) {
      if (!cfg || !cfg.enabled) continue;

      try {
        const channel = getChannel(id);
        if (!channel) {
          log.warn("Channel '%s' configured but plugin not loaded", id);
          continue;
        }
        startedIds.add(id);
        this._setupChannelOnMessage(id);
        await channel.start();
        this.channels.push(channel);

        const binding = cfg.bindTo;
        if (binding?.type === "agent") {
          const targetAgent = binding.agentId === "butler"
            ? this.butler
            : this.registry.get(binding.agentId);
          if (targetAgent) {
            targetAgent.addSendChannel(channel);
          }
          // Register binding with router so inbound messages route correctly
          if (binding.agentId) {
            this.router.bind(id, { type: "agent", agentId: binding.agentId });
          }
        } else if (binding?.type === "group" && binding.groupId) {
          this.router.bind(id, { type: "group", groupId: binding.groupId });
        }

        log.info("Channel started: %s (type=%s)", id, cfg.type);
      } catch (err: any) {
        log.error("Failed to start channel %s: %s", id, err.message);
      }
    }

    // Phase 2: 启动插件注册但未在 config 中配置的 channel
    const { getAllChannels } = await import("@cobeing/channels");
    for (const channel of getAllChannels()) {
      if (startedIds.has(channel.id)) continue;

      try {
        this._setupChannelOnMessage(channel.id);
        await channel.start();
        this.channels.push(channel);
        startedIds.add(channel.id);

        // 插件 channel 的 bindTo 从 registry.json config 读取
        const bindTo = getPluginBindTo(channel.id);
        if (bindTo?.type === "agent") {
          const targetAgent = bindTo.agentId === "butler"
            ? this.butler
            : this.registry.get(bindTo.agentId);
          if (targetAgent) {
            targetAgent.addSendChannel(channel);
            // Register binding with router so inbound messages route correctly
            this.router.bind(channel.id, bindTo);
          }
        } else if (bindTo?.type === "group" && bindTo.groupId) {
          this.router.bind(channel.id, bindTo);
        }

        log.info("Plugin channel started: %s", channel.id);
      } catch (err: any) {
        log.error("Failed to start plugin channel %s: %s", channel.id, err.message);
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

  /** 确保 data/ 7 个分类目录结构存在 */
  private ensureDataDirs(): void {
    const dirs = ["agents", "groups", "coreagents", "tools", "toolagents", "skills", "plugins"];
    for (const d of dirs) {
      fs.mkdirSync(path.join(this.dataRoot, d), { recursive: true });
    }
  }

  /** 确保 data/coreagents/host/ 目录结构存在 */
  private ensureHostDir(): void {
    const hostDir = path.join(this.dataRoot, "coreagents", "host");
    fs.mkdirSync(hostDir, { recursive: true });

    const HOST_ALLOWED_TOOLS = [
      "group-plan", "group-invite-talk", "group-summarize", "group-assign-task",
      "host-guide-discussion", "host-decompose-task", "host-summarize-progress",
      "host-record-decision", "host-manage-todo", "host-review-todo",
      "host-invite-member", "host-remove-member", "host-set-screener-prompt", "host-manage-workspace",
      "talk-close",
      "todo-add", "todo-list", "todo-complete", "todo-remove", "todo-review",
      "todo-batch-complete", "todo-batch-remove", "todo-batch-update",
    ];
    const HOST_FORBIDDEN = ["bash", "read-file", "write-file", "edit-file", "glob", "grep", "web-fetch", "agent-message"];

    const hostConfigPath = path.join(hostDir, "config.json");
    let needsRewrite = false;
    if (!fs.existsSync(hostConfigPath)) {
      needsRewrite = true;
    } else {
      // 检查已有 config 是否包含禁止的执行工具，有则修复
      try {
        const existing = JSON.parse(fs.readFileSync(hostConfigPath, "utf-8"));
        if (existing.tools && Array.isArray(existing.tools)) {
          const hasForbidden = existing.tools.some((t: string) => HOST_FORBIDDEN.includes(t));
          if (hasForbidden) {
            log.warn("Host config.json contains forbidden execution tools — will rewrite");
            needsRewrite = true;
          }
        }
      } catch { needsRewrite = true; }
    }
    if (needsRewrite) {
      fs.writeFileSync(hostConfigPath, JSON.stringify({
        name: "群主",
        role: "项目协调者和讨论引导者",
        provider: DEFAULT_PROVIDER,
        model: DEFAULT_MODEL,
        permissions: { mode: "full-access" },
        sandbox: { enabled: true, filesystem: "isolated", network: { enabled: true, mode: "all" } },
        tools: HOST_ALLOWED_TOOLS,
        _note: "群主只能使用协调工具，执行类工具（bash/read-file/write-file 等）已被系统强制禁止",
      }, null, 2) + "\n", "utf-8");
      log.info("Host config.json written with coordination-only tools: %s", hostConfigPath);
    }

    // 从模板写入 HOST_JOB.md（始终同步，确保禁止执行工作的指令最新）
    const hostJobPath = path.join(hostDir, "JOB.md");
    const hostJobTemplate = path.resolve("packages/core/src/templates/host/HOST_JOB.md");
    if (fs.existsSync(hostJobTemplate)) {
      const content = fs.readFileSync(hostJobTemplate, "utf-8");
      fs.writeFileSync(hostJobPath, content, "utf-8");
      log.info("Host JOB.md synced from template: %s", hostJobPath);
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

      // 强制禁止群主使用执行类工具：群主只能协调，不能自己执行工作
      if (agentId === "host" && selfConfig.tools) {
        const HOST_FORBIDDEN_TOOLS = [
          "bash", "read-file", "write-file", "edit-file", "glob", "grep", "web-fetch",
          "agent-message",
        ];
        const originalCount = selfConfig.tools.length;
        selfConfig.tools = selfConfig.tools.filter((t: string) => !HOST_FORBIDDEN_TOOLS.includes(t));
        if (selfConfig.tools.length < originalCount) {
          const removed = originalCount - selfConfig.tools.length;
          log.warn("Host config had %d forbidden execution tools — stripped at runtime", removed);
          // 修复持久化的 config.json，防止下次再包含执行工具
          try {
            const fixed = { ...JSON.parse(fs.readFileSync(agentPaths.configPath, "utf-8")) };
            fixed.tools = fixed.tools.filter((t: string) => !HOST_FORBIDDEN_TOOLS.includes(t));
            fs.writeFileSync(agentPaths.configPath, JSON.stringify(fixed, null, 2) + "\n", "utf-8");
            log.info("Host config.json fixed: removed %d forbidden tools", removed);
          } catch { /* best effort */ }
        }
      }

      const providerId = selfConfig.provider || DEFAULT_PROVIDER;
      const provider = this.providers.get(providerId);
      if (!provider) {
        log.warn("Skipping agent %s: no provider %s", agentId, providerId);
        continue;
      }

      const agent = new Agent({
        id: agentId,
        name: selfConfig.name || agentId,
        role: selfConfig.role || "",
        systemPrompt: agentId === "host"
          ? `你是群主，唯一职责是协调群组成员。你绝对不能亲自执行任何具体工作。

🚫 **绝对禁令（违反将导致群组失败）**：
你没有任何执行类工具（bash、read-file、write-file、edit-file、glob、grep、web-fetch 等），
系统层面已强制移除。即使你以为可以调用，这些工具对你不可用。
- 永远不要试图自己写代码、改文件、读文件、运行命令
- 永远不要尝试使用不存在的执行工具
- 缺少专业 Agent 时，向用户/管家申请创建，禁止自己顶上

✅ **你唯一能做的事**：
- @mention 委派：使用 group-send @memberAgent 将具体工作分配给专业成员
- 任务管理：使用 host-decompose-task / host-manage-todo / host-review-todo 管理 TODO
- 进度追踪：使用 host-summarize-progress / group-update-progress 跟踪进展
- 决策记录：使用 host-record-decision 记录关键决策
- 成员管理：使用 host-invite-member / host-remove-member 调整成员
- 讨论引导：使用 host-guide-discussion 组织讨论
- 工作空间：使用 host-manage-workspace 维护群组文档
- 群组工具：使用 group-plan / group-assign-task / group-invite-talk / group-summarize

⚠️ 每次收到任务时，第一反应必须是"分配给谁做"，而不是"我来做"。`
          : (selfConfig.systemPrompt || `你是${selfConfig.name}，${selfConfig.role}`),
        provider: providerId,
        model: selfConfig.model || DEFAULT_MODEL,
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
      const hostDataDir = path.join(this.dataRoot, "coreagents", "host");

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
        async (todoId, updates) => {
          // 遍历所有群组找到包含该 TODO 的 store
          for (const g of this.groupManager.list()) {
            const store = this.groupManager.getGroupTodoStore(g.id);
            if (store) {
              const item = store.get(todoId);
              if (item) {
                if (updates.status === "completed") return this.groupManager.completeGroupTodo(g.id, todoId);
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
