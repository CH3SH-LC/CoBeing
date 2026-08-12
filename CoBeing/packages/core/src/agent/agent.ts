/**
 * Agent 核心 — 单个 Agent 的完整定义和运行时
 */
import path from "node:path";
import fs from "node:fs";
import type { AgentConfig, AgentResponse, AgentStatus, ReviewInput, ReviewResult, WorkspaceBinding } from "@cobeing/shared";
import type { LLMProvider } from "@cobeing/providers";
import type { ChannelAdapter } from "@cobeing/channels";
import { chatCompleteWithGateway } from "../gateway/llm-gateway.js";
import { ConversationLoop, type ConversationLoopEvents } from "../conversation/conversation-loop.js";
import { ToolRegistry } from "../tools/registry.js";
import { ToolExecutor } from "../tools/executor.js";
import { PermissionEnforcer } from "../tools/permission.js";
import { bashTool } from "../tools/bash.js";
import { readFileTool } from "../tools/read-file.js";
import { writeFileTool } from "../tools/write-file.js";
import { editFileTool } from "../tools/edit-file.js";
import { globTool } from "../tools/glob.js";
import { grepTool } from "../tools/grep.js";
import { webFetchTool } from "../tools/web-fetch.js";
import { MCPManager } from "../mcp/manager.js";
import type { SkillRepository } from "../skills/repository.js";
import { makeAgentMessageTool } from "../tools/agent-message.js";
import type { AgentRegistry } from "./registry.js";
import { makeSkillExecuteTool, makeSkillListTool, makeSkillCreateTool } from "../tools/skill-tools.js";
import { AgentPaths, AgentFiles } from "./paths.js";
import { DockerSandbox } from "../tools/sandbox/docker-sandbox.js";
import { MemoryWriter } from "../memory/writer.js";
import { MemoryReader } from "../memory/reader.js";
import { MemoryStore } from "../memory/memory-store.js";
import { AgentEventBus } from "./event-bus.js";
import { registerAgentTools } from "./agent-tools.js";
import { buildCacheablePrompt, GROUP_MECHANICS_NOTICE } from "../conversation/prompt-builder.js";
import type { ObservabilityDB } from "../observability/observability-db.js";
import { WakeSession } from "./wake-session.js";
import { makeGroupMembersTool, makeTalkCreateTool, makeTalkSendTool, makeTalkReadTool, makeTalkCloseTool, makeGroupSendTool, makeGroupUpdateProgressTool, makeGroupExperienceAddTool, makeGroupExperienceSummarizeTool } from "../tools/group-tools.js";
import { runMemoryAgent } from "./tool-agent/memory.js";
import { buildReviewPrompt, parseReviewResult } from "./review-prompt.js";
import { createLogger } from "@cobeing/shared";

/** run() 的选项 — 支持群组隔离 */
export interface RunOptions {
  /** 群组 ID — 存在时创建隔离的 ConversationLoop */
  groupId?: string;
  /** 群组协作上下文 — 直接传入，不使用 Agent 的 _groupContext 字段 */
  groupContext?: string;
  /** GUIDE.md 群组规则内容 — 注入到群组 promptBuilder 的 volatile 层 */
  guideContent?: string;
  /** 覆盖工作目录（群组上下文时传入 group.effectiveWorkspace） */
  workingDir?: string;
  /** 事件回调 */
  events?: ConversationLoopEvents;
}

/** 所有内置工具映射 */
const BUILTIN_TOOLS: Record<string, import("@cobeing/shared").Tool> = {
  "bash": bashTool,
  "read-file": readFileTool,
  "write-file": writeFileTool,
  "edit-file": editFileTool,
  "glob": globTool,
  "grep": grepTool,
  "web-fetch": webFetchTool,
};

export class Agent {
  readonly id: string;
  readonly name: string;
  readonly config: AgentConfig;

  private provider: LLMProvider;
  private channels: ChannelAdapter[] = [];
  protected conversationLoop: ConversationLoop;
  protected toolRegistry: ToolRegistry;
  protected _pendingToolNames: string[] = [];
  protected _toolExecutor: ToolExecutor;
  private mcpManager: MCPManager;
  private _allProviders: Map<string, LLMProvider> = new Map();
  private observabilityDB?: ObservabilityDB;

  /** 注册额外工具（供子类或 runtime 扩展） */
  registerTool(tool: import("@cobeing/shared").Tool): void {
    this.toolRegistry.register(tool);
  }
  private _sandbox: DockerSandbox | null = null;
  /** 活跃会话集合 — 每个 session 最多同时运行一个 run()（"main" 或 "group:<id>"） */
  private _activeSessions = new Set<string>();
  /** 标记最后一次执行是否以异常结束（用于 getStatus() 返回 "error"） */
  private _errorFlag = false;
  /** 标记 stop() 已触发，防止 run() finally 重复 emit agent:sleep */
  private _stopping = false;
  private _disposed = false;
  private _groupContext?: string;
  private logger: ReturnType<typeof createLogger>;

  /** 用户添加的外部工作区绑定 */
  private _bindings: WorkspaceBinding[] = [];
  /** 按 session 隔离的取消控制器（支持并发的多 session abort） */
  private _abortControllers = new Map<string, AbortController>();

  /** 群组 loop 的 workingDir（由 createGroupLoop 设置） */
  private _groupLoopWorkingDir?: string;

  /** 唤醒周期轨迹记录器（群组审核用） */
  wakeSession?: WakeSession;
  private wakeSessions = new Map<string, WakeSession>();

  /** 冻结的共享前缀 — 所有 Agent 完全相同，确保跨 Agent 缓存命中 */
  private _sharedPrefix: string = "";
  /** 冻结的 Agent 特有前缀 — Agent 生命周期内只构建一次，确保跨请求前缀一致 */
  private _agentPrefix: string = "";

  /** 设置群组协作上下文（WakeSystem 唤醒前调用） */
  setGroupContext(ctx: string): void {
    this._groupContext = ctx;
  }

  /** 清理群组协作上下文（Agent 回复后调用） */
  clearGroupContext(): void {
    this._groupContext = undefined;
  }

  /** 获取当前群组协作上下文 */
  get groupContext(): string | undefined {
    return this._groupContext;
  }

  /** 有效工作目录：始终返回原始 workspace */
  get effectiveWorkspace(): string {
    return this.paths.workspaceDir;
  }

  /** 用户添加的绑定列表 */
  get bindings(): WorkspaceBinding[] {
    return this._bindings;
  }

  /** 添加绑定（去重：同路径覆盖） */
  addBinding(binding: WorkspaceBinding): void {
    this._bindings = this._bindings.filter(b => b.path !== binding.path);
    this._bindings.push(binding);
    this.persistBindings();
    this.rebuildExecutor();
    this.logger.info("Added binding: %s (%s)", binding.path, binding.mode);
  }

  /** 移除绑定 */
  removeBinding(workspacePath: string): void {
    this._bindings = this._bindings.filter(b => b.path !== workspacePath);
    this.persistBindings();
    this.rebuildExecutor();
    this.logger.info("Removed binding: %s", workspacePath);
  }

  /** 清空所有绑定 */
  clearBindings(): void {
    this._bindings = [];
    this.persistBindings();
    this.rebuildExecutor();
    this.logger.info("Cleared all bindings");
  }

  /** 持久化 bindings 到 config.json */
  private persistBindings(): void {
    try {
      const config = JSON.parse(fs.readFileSync(this.paths.configPath, "utf-8"));
      config.bindings = this._bindings;
      fs.writeFileSync(this.paths.configPath, JSON.stringify(config, null, 2), "utf-8");
    } catch {
      this.logger.warn("Failed to persist bindings");
    }
  }

  /** 从 config.json 恢复绑定 */
  loadBindings(): void {
    try {
      const raw = fs.readFileSync(this.paths.configPath, "utf-8");
      const config = JSON.parse(raw);
      if (Array.isArray(config.bindings)) {
        this._bindings = config.bindings;
        this.logger.info("Loaded %d bindings from config", this._bindings.length);
      }
    } catch {
      // config.json may not exist yet (new agent)
    }
  }

  /** 重建 ToolExecutor 和 ConversationLoop（workspace 变更时） */
  private rebuildExecutor(): void {
    const permission = new PermissionEnforcer(
      this.config.permissions ?? { mode: "workspace-readwrite" },
      this.config.toolsConfig,
      this.paths.workspaceDir,
      this._groupLoopWorkingDir,
      this._bindings,
    );
    this._toolExecutor = new ToolExecutor(
      this.toolRegistry,
      permission,
      undefined,
      this.config.sandbox,
      this._sandbox ?? undefined,
      undefined,
      this.name,
    );
    this.conversationLoop = this.createLoop(this._toolExecutor, undefined, undefined, this.config.model);
  }

  // Agent 文件系统
  readonly paths: AgentPaths;
  readonly files: AgentFiles;
  readonly memoryStore: MemoryStore;
  private memoryWriter: MemoryWriter;

  // 每个用户/会话独立的对话循环 (with lastAccessTime for idle cleanup)
  private sessionLoops = new Map<string, { loop: ConversationLoop; lastAccessTime: number }>();
  private readonly SESSION_IDLE_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour

  constructor(config: AgentConfig, provider: LLMProvider, dataRoot?: string) {
    this.id = config.id;
    this.name = config.name;
    this.config = config;
    this.provider = provider;
    this.logger = createLogger(`agent:${config.name}`);

    // Agent 文件系统
    this.paths = AgentPaths.forAgent(config.id, dataRoot);
    this.files = new AgentFiles(this.paths);
    this.paths.ensureDirs();
    // 确保 EXPERIENCE.md 存在（Agent 文件体系要求；原 ExperienceWriter 构造副作用）
    this.files.ensureExperienceFile();

    // 从文件系统加载增强信息
    const character = this.files.readCharacter();
    const fileConfig = this.files.readConfig();

    // 合并 name（CHARACTER.md 优先 — 支持新旧两种格式）
    if (character) {
      let nameMatch = character.match(/\*\*姓名\*\*:\s*(.+)/); // 新格式: **姓名**: xxx
      if (!nameMatch) {
        nameMatch = character.match(/-\s*(?:Name|姓名):\s*(.+)/); // 旧格式: - Name: xxx 或 - 姓名: xxx
      }
      if (nameMatch) {
        (this as any).name = nameMatch[1].trim();
      }
    }

    // 合并配置（config.json 补充 AgentConfig）
    const mergedConfig = { ...config, ...fileConfig };

    // 记忆系统（统一 MemoryStore，延迟初始化）
    this.memoryStore = MemoryStore.createLazy(this.paths.directory, {
      charLimits: (globalThis as any).__cobeingConfig?.memory?.charLimits,
    });

    // 兼容旧接口
    this.memoryWriter = new MemoryWriter(this.paths.memoryDir);

    // 初始化工具系统
    this.toolRegistry = new ToolRegistry();
    const enabledTools = mergedConfig.tools ?? mergedConfig.toolsConfig?.enabled ?? [];
    this._pendingToolNames = enabledTools;
    for (const toolName of enabledTools) {
      const tool = BUILTIN_TOOLS[toolName];
      if (tool) {
        this.toolRegistry.register(tool);
      }
      // 非内置工具名不报 warning — 子类（如 ButlerAgent）会在构造时注册额外工具
    }

    // 注册 memory / TODO / 群组记忆 / 阶段总结 / 克隆 / 增强 等内置工具（实现见 agent-tools.ts）
    const todoDataRoot = path.dirname(path.dirname(this.paths.directory));
    // 群组 TODO 存储/扫描器经全局 __cobeingGroupManager 解析
    // （历史 bug：store getter 传 undefined 导致群组成员的 todo-list 等工具
    //   群组级调用永远返回"无法确定 TODO 存储"）
    const getGroupTodoStore = (groupId: string) => {
      const groupManager = (globalThis as any).__cobeingGroupManager;
      return groupManager?.getGroupTodoStore?.(groupId);
    };
    const getGroupTodoScanner = (groupId: string) => {
      const groupManager = (globalThis as any).__cobeingGroupManager;
      return groupManager?.getScanner?.(groupId);
    };
    registerAgentTools({
      paths: this.paths,
      files: this.files,
      memoryStore: this.memoryStore,
      provider: this.provider,
      model: mergedConfig.model,
      getGroupTodoStore,
      getGroupTodoScanner,
      getGroupAgentMemory: (groupId, agentId) => {
        const groupManager = (globalThis as any).__cobeingGroupManager;
        return groupManager?.get(groupId)?.getAgentMemory(agentId);
      },
      getProvider: (providerId) => this._allProviders.get(providerId),
      getCloneModel: () => this.config.model,
      getCloneName: () => this.name,
    }, this.toolRegistry);

    const permission = new PermissionEnforcer(
      mergedConfig.permissions ?? { mode: "workspace-readwrite" },
      mergedConfig.toolsConfig,
      this.paths.workspaceDir,
      this._groupLoopWorkingDir,
      this._bindings,
    );

    // 创建沙箱（如果启用）
    if (mergedConfig.sandbox?.enabled) {
      this._sandbox = new DockerSandbox(
        config.id,
        mergedConfig.sandbox,
        this.paths.directory,
      );
    }

    const toolExecutor = new ToolExecutor(
      this.toolRegistry,
      permission,
      undefined,
      mergedConfig.sandbox,
      this._sandbox ?? undefined,
      undefined, // observabilityDB set later via setObservabilityDB
      this.name,
    );
    this._toolExecutor = toolExecutor;

    // MCP 管理器
    this.mcpManager = new MCPManager();

    // Skill 统一工具（Phase 8.2: 注入 SkillRepository + 3 个统一工具）
    const requestedSkills = mergedConfig.skills as string[] | undefined;

    this.conversationLoop = this.createLoop(toolExecutor, undefined, undefined, mergedConfig.model);

    // 构建并冻结前缀（缓存优化：共享前缀跨 Agent 一致，Agent 前缀跨请求一致）
    const { sharedPrefix, agentPrefix } = buildCacheablePrompt(
      this.files,
      { name: this.name, role: this.config.role, systemPrompt: this.config.systemPrompt },
    );
    this._sharedPrefix = sharedPrefix;
    this._agentPrefix = agentPrefix;
    this.loadBindings();

    // Emit agent:create hook
    const hookBus = (globalThis as any).__cobeingHookBus;
    if (hookBus) {
      setImmediate(() => {
        hookBus.emit("agent:create", {
          id: this.id, name: this.name, role: this.config.role,
        }).catch(() => {});
      });
    }
  }

  private createLoop(
    toolExecutor: ToolExecutor,
    sessionId?: string,
    systemPrompt?: string,
    model?: string,
  ): ConversationLoop {
    return new ConversationLoop({
      agentConfig: {
        name: this.name,
        role: this.config.role,
        systemPrompt: systemPrompt ?? this.config.systemPrompt,
        model: model ?? this.config.model,
      },
      provider: this.provider,
      tools: this.toolRegistry.listDefinitions(),
      toolExecutor,
      agentId: this.id,
      sessionId: sessionId ?? "default",
      workingDir: this.effectiveWorkspace,
      maxToolRounds: this.config.maxToolRounds,
      maxTotalTokens: this.config.maxTotalTokens,
      fallbackProviders: this.buildFallbackList(),
      observabilityDB: this.observabilityDB,
      promptBuilder: systemPrompt
        ? undefined  // 固定 prompt 的场景（如 butler），不用回调
        : () => {
            // 三层架构：共享前缀（跨 Agent 缓存） + Agent 前缀（跨请求缓存） + 动态 volatile
            const { volatile } = buildCacheablePrompt(
              this.files,
              { name: this.name, role: this.config.role, systemPrompt: this.config.systemPrompt },
              undefined,
              this._groupContext,
            );
            const parts = [this._sharedPrefix, this._agentPrefix];
            if (volatile) parts.push(volatile);
            // Plugin prompt layers
            const promptLayers = (globalThis as any).__cobeingPromptLayers;
            if (promptLayers) {
              const pluginContent = promptLayers.build({ agentId: this.id });
              if (pluginContent) parts.push(pluginContent);
            }
            return parts.join("\n\n");
          },
    });
  }

  /** 为群组创建隔离的 ConversationLoop — groupContext 通过 snapshot 对象引用，每次 promptBuilder 调用时读取最新值 */
  private createGroupLoop(toolExecutor: ToolExecutor, groupId: string, snapshot: { context?: string; guideContent?: string }, workingDir?: string): ConversationLoop {
    return new ConversationLoop({
      agentConfig: {
        name: this.name,
        role: this.config.role,
        systemPrompt: this.config.systemPrompt,
        model: this.config.model,
      },
      provider: this.provider,
      tools: this.toolRegistry.listDefinitions(),
      toolExecutor,
      agentId: this.id,
      sessionId: `group:${groupId}`,
      workingDir: workingDir ?? this.effectiveWorkspace,
      maxToolRounds: this.config.maxToolRounds,
      maxTotalTokens: this.config.maxTotalTokens,
      fallbackProviders: this.buildFallbackList(),
      promptBuilder: () => {
        // 组装群组 volatile：GUIDE.md 规则优先，再拼接协作上下文
        let groupCtx = "";
        if (snapshot.guideContent) {
          groupCtx = "## 群组规则 (GUIDE.md)\n\n" + snapshot.guideContent.slice(0, 4000) + "\n\n";
        }
        if (snapshot.context) {
          groupCtx += snapshot.context;
        }
        const { volatile } = buildCacheablePrompt(
          this.files,
          { name: this.name, role: this.config.role, systemPrompt: this.config.systemPrompt },
          undefined,
          groupCtx || undefined,
        );
        const parts = [
          this._sharedPrefix,
          GROUP_MECHANICS_NOTICE,
          `# 工作目录
- 你的工作目录是：\`${workingDir ?? this.effectiveWorkspace}\`。所有文件操作（write-file / read-file / edit-file / glob / grep）都以它为基础。
- **文件路径只使用工作目录内的相对路径**（如 \`note.md\`、\`docs/note.md\`、\`game.html\`）。**禁止以 \`data/\`、\`coreagents/\`、\`agents/\`、\`groups/\`、\`skills/\` 等前缀书写路径，也禁止绝对路径**——那会指向数据目录的其他位置，系统会拒绝（路径必须解析在你的工作目录内）。
- 你的工作目录本身就在数据目录内，但你**不需要也不应该**引用任何 \`data/\` 下的其他目录；所有产物直接写在当前目录或子目录。
- 写入的产物文件会保存在工作目录，群组其他成员与用户都能看到。交付物（HTML/代码/文档）必须实际写入工作目录中的文件。
- **大文件必须分块写入**：单次 write-file 的 content 不超过 3000 字符。先 write-file 写文件骨架，再用 edit-file 逐块追加/替换内容，直到完成。`,
          this._agentPrefix,
        ];
        if (volatile) parts.push(volatile);
        // Plugin prompt layers (with groupId)
        const promptLayers = (globalThis as any).__cobeingPromptLayers;
        if (promptLayers) {
          const pluginContent = promptLayers.build({ agentId: this.id, groupId });
          if (pluginContent) parts.push(pluginContent);
        }
        return parts.join("\n\n");
      },
    });
  }

  /** 群组上下文快照 — 按 groupId 存储最新值，promptBuilder 闭包读取此引用 */
  private _groupContextSnapshots = new Map<string, { context?: string; guideContent?: string }>();

  /** 获取或创建群组隔离的 ConversationLoop */
  private getGroupLoop(groupId: string, groupContext?: string, guideContent?: string, workingDir?: string): ConversationLoop {
    this.pruneIdleSessions();
    this._groupLoopWorkingDir = workingDir;
    const key = `group:${groupId}`;
    // 更新快照（无论 loop 是否已存在，确保 promptBuilder 读到最新值）
    const snapshot = this._groupContextSnapshots.get(key) || { context: undefined };
    snapshot.context = groupContext;
    snapshot.guideContent = guideContent;
    this._groupContextSnapshots.set(key, snapshot);

    let entry = this.sessionLoops.get(key);
    if (!entry) {
      const effectiveWd = workingDir ?? this.effectiveWorkspace;
      const permission = new PermissionEnforcer(
        this.config.permissions ?? { mode: "workspace-readwrite" },
        this.config.toolsConfig,
        this.paths.workspaceDir,
        this._groupLoopWorkingDir,
        this._bindings,
      );
      const toolExecutor = new ToolExecutor(
        this.toolRegistry,
        permission,
        undefined,
        this.config.sandbox,
        this._sandbox ?? undefined,
        this.observabilityDB,
        this.name,
      );
      entry = { loop: this.createGroupLoop(toolExecutor, groupId, snapshot, effectiveWd), lastAccessTime: Date.now() };
      this.sessionLoops.set(key, entry);
    }
    entry.lastAccessTime = Date.now();
    // Always clear history for group calls — context is rebuilt each time by WakeSystem
    entry.loop.clearHistory();
    return entry.loop;
  }

  /** 注入 SkillRepository，注册 3 个统一工具 */
  injectSkillRepository(repo: SkillRepository): void {
    const allowedSkills = this.config.skills;
    this.toolRegistry.register(makeSkillExecuteTool(repo, () => this.provider, allowedSkills));
    this.toolRegistry.register(makeSkillListTool(repo, allowedSkills));
    this.toolRegistry.register(makeSkillCreateTool(repo));

    // 重建 conversation loop 以包含新工具（复用已有 _toolExecutor）
    this.conversationLoop = this.createLoop(this._toolExecutor);

    this.logger.info("SkillRepository injected: %d skills available (filter: %s)",
      repo.size, allowedSkills?.join(",") ?? "all");
  }

  /** 注入群组通信工具（group-members / talk-create / talk-send / talk-read / group-send / group-update-progress / group-experience-add / group-experience-summarize） */
  injectGroupTools(getGroup: (groupId: string) => import("../group/group.js").Group | undefined): void {
    // 避免重复注册
    const existing = this.toolRegistry.listDefinitions().map(t => t.function.name);
    if (!existing.includes("group-members")) {
      this.toolRegistry.register(makeGroupMembersTool(getGroup, (id) => id));
    }
    if (!existing.includes("talk-create")) {
      this.toolRegistry.register(makeTalkCreateTool(getGroup));
    }
    if (!existing.includes("talk-send")) {
      this.toolRegistry.register(makeTalkSendTool(getGroup));
    }
    if (!existing.includes("talk-read")) {
      this.toolRegistry.register(makeTalkReadTool(getGroup));
    }
    if (!existing.includes("talk-close")) {
      this.toolRegistry.register(makeTalkCloseTool(getGroup));
    }
    if (!existing.includes("group-send")) {
      this.toolRegistry.register(makeGroupSendTool(getGroup, () => this));
    }
    if (!existing.includes("group-update-progress")) {
      this.toolRegistry.register(makeGroupUpdateProgressTool(getGroup));
    }
    if (!existing.includes("group-experience-add")) {
      this.toolRegistry.register(makeGroupExperienceAddTool(getGroup));
    }
    if (!existing.includes("group-experience-summarize")) {
      this.toolRegistry.register(makeGroupExperienceSummarizeTool(getGroup));
    }

    // 重建 conversation loop 以包含新工具（复用已有 _toolExecutor）
    this.conversationLoop = this.createLoop(this._toolExecutor);

    this.logger.info("Group tools injected");
  }

  /** 注入 agent-message 工具（需要 registry 引用，避免模块级单例） */
  injectAgentMessageTool(registry: AgentRegistry): void {
    this.toolRegistry.register(makeAgentMessageTool(registry));
    // 重建 conversation loop 以包含新工具
    this.conversationLoop = this.createLoop(this._toolExecutor);
    this.logger.info("Agent-message tool injected");
  }

  /** Set all available providers for fallback degradation */
  setAllProviders(providers: Map<string, LLMProvider>): void {
    this._allProviders = providers;
    // Rebuilt via rebuildLoop or the next createLoop call
  }

  /** Set the shared observability database */
  setObservabilityDB(db: ObservabilityDB): void {
    this.observabilityDB = db;
    if (this._toolExecutor) {
      (this._toolExecutor as any).observabilityDB = db;
    }
    // Update existing loops (created before setObservabilityDB was called)
    (this.conversationLoop as any).observabilityDB = db;
    for (const entry of this.sessionLoops.values()) {
      (entry.loop as any).observabilityDB = db;
    }
  }

  private buildFallbackList(): LLMProvider[] {
    const result: LLMProvider[] = [];
    for (const [id, prov] of this._allProviders) {
      if (id !== this.config.provider) result.push(prov);
    }
    return result;
  }

  /** 重建 conversation loop（在外部注册工具后调用） */
  rebuildLoop(): void {
    this.conversationLoop = this.createLoop(this._toolExecutor);
  }

  /** 绑定 channel */
  addChannel(channel: ChannelAdapter): void {
    this.channels.push(channel);
    channel.onMessage(async (msg) => {
      await this.handleIncomingMessage(msg);
    });
    this.logger.info("Channel bound: %s", channel.name);
  }

  /** 注册 channel 用于发送回复（不注册 onMessage，避免与 runtime 路由重复） */
  addSendChannel(channel: ChannelAdapter): void {
    this.channels.push(channel);
  }

  /** 处理收到的消息，返回回复内容（用于 WS 广播） */
  async handleIncomingMessage(msg: { channelId: string; senderId: string; senderName: string; content: string; metadata?: Record<string, unknown> }): Promise<string> {
    if (this._disposed) return "[系统] Agent 已被销毁，无法处理新消息";
    const sessionKey = `${msg.channelId}:${msg.senderId}`;
    this._errorFlag = false;
    if (this._activeSessions.has(sessionKey)) {
      this.logger.warn("Session %s already running, refusing concurrent call", sessionKey);
      return "[系统] Agent 正在处理该会话的上一请求，请稍后再试";
    }

    this.pruneIdleSessions();
    let entry = this.sessionLoops.get(sessionKey);
    if (!entry) {
      const permission = new PermissionEnforcer(
        this.config.permissions ?? { mode: "workspace-readwrite" },
        this.config.toolsConfig,
        this.paths.workspaceDir,
        this._groupLoopWorkingDir,
        this._bindings,
      );
      const toolExecutor = new ToolExecutor(
        this.toolRegistry,
        permission,
        undefined,
        this.config.sandbox,
        this._sandbox ?? undefined,
        this.observabilityDB,
        this.name,
      );
      entry = { loop: this.createLoop(toolExecutor, sessionKey), lastAccessTime: Date.now() };
      this.sessionLoops.set(sessionKey, entry);
    }
    entry.lastAccessTime = Date.now();
    const loop = entry.loop;

    this._activeSessions.add(sessionKey);
    const ac = new AbortController();
    this._abortControllers.set(sessionKey, ac);

    try {
      await this.memoryWriter.append({
        session: sessionKey,
        role: "user",
        content: msg.content,
      });

      const events: ConversationLoopEvents = {
        onToken: (_token) => {},
      };

      const response = await loop.run(msg.content, events, ac.signal);

      // 保存助手回复
      await this.memoryWriter.append({
        session: sessionKey,
        role: "assistant",
        content: response.content,
      });

      // 发送回复
      for (const channel of this.channels) {
        if (msg.channelId.startsWith(channel.id)) {
          await channel.send({
            channelId: msg.channelId,
            content: response.content,
            metadata: msg.metadata,
          });
        }
      }

      this.logger.info("Replied to %s: %d chars", msg.senderId, response.content.length);
      return response.content;
    } catch (err) {
      this._errorFlag = true;
      this.logger.error("Error handling message: %s", err);
      return "";
    } finally {
      this._abortControllers.delete(sessionKey);
      this._activeSessions.delete(sessionKey);
    }
  }

  /** 直接运行（非 channel 输入，用于测试/GUI/群组唤醒） */
  async run(input: string, optionsOrEvents?: RunOptions | ConversationLoopEvents): Promise<AgentResponse> {
    if (this._disposed) {
      return { content: "[系统] Agent 已被销毁，无法处理新任务", usage: { inputTokens: 0, outputTokens: 0 } };
    }
    // 确保 MemoryStore 已初始化
    await this.memoryStore.ready();

    // 兼容旧签名 run(input, events)
    const options: RunOptions = optionsOrEvents && "groupId" in optionsOrEvents
      ? optionsOrEvents
      : { events: optionsOrEvents as ConversationLoopEvents | undefined };

    const isGroup = !!options.groupId;
    const sessionKey = isGroup ? `group:${options.groupId}` : "main";

    this._errorFlag = false;
    this._stopping = false;

    // 防并发：同一 session 已在运行中则拒绝（允许多 session 并行）
    if (this._activeSessions.has(sessionKey)) {
      this.logger.warn("Session %s already running — refusing concurrent run() (input: %s)", sessionKey, input.slice(0, 80));
      return { content: "[已停止] Agent 正在处理该会话的上一个请求，请稍后再试", usage: { inputTokens: 0, outputTokens: 0 } };
    }

    const wasIdle = this._activeSessions.size === 0;
    this._activeSessions.add(sessionKey);

    // Emit agent:wake hook if transitioning from idle
    if (wasIdle) {
      const hookBus = (globalThis as any).__cobeingHookBus;
      if (hookBus) {
        const trigger = isGroup ? "mention" as const : "manual" as const;
        hookBus.emit("agent:wake", { id: this.id, name: this.name }, { groupId: options.groupId, trigger }).catch(() => {});
      }
    }

    const ac = new AbortController();
    this._abortControllers.set(sessionKey, ac);

    // 兜底超时：防止 LLM 调用挂起导致 WakeSystem 永久阻塞
    const RUN_TIMEOUT_MS = 300_000; // 5 分钟
    const timeoutId = setTimeout(() => {
      this.logger.warn("Session %s timed out after %dms — aborting", sessionKey, RUN_TIMEOUT_MS);
      ac.abort();
    }, RUN_TIMEOUT_MS);

    try {
      this.memoryStore.appendHistory({
        session: sessionKey,
        role: "user",
        content: input,
      });

      const loop = isGroup
        ? this.getGroupLoop(options.groupId!, options.groupContext, options.guideContent, options.workingDir)
        : this.conversationLoop;

      // 群组模式下初始化唤醒轨迹记录器
      if (isGroup) {
        const wakeSession = new WakeSession();
        this.wakeSessions.set(sessionKey, wakeSession);
        this.wakeSession = wakeSession;
        loop.wakeSession = wakeSession;
      }

      const response = await loop.run(input, options.events, ac.signal);

      // 保存助手回复
      this.memoryStore.appendHistory({
        session: sessionKey,
        role: "assistant",
        content: response.content,
      });

      // 后台反思（不阻塞返回，仅非群组调用时触发）
      if (!isGroup) {
        this.reflectInBackground(input, response.content);
      }

      // 群组模式下触发个人记忆智能体（异步，不阻塞返回）
      const completedWakeSession = isGroup ? this.wakeSessions.get(sessionKey) : undefined;
      if (isGroup && completedWakeSession) {
        const trace = completedWakeSession.getTrace();
        const hasToolCalls = trace.toolCalls.length > 0;
        if (hasToolCalls) {
          setImmediate(async () => {
            try {
              const memoryResult = await runMemoryAgent(
                "personal",
                {
                  agentName: this.name,
                  agentId: this.id,
                  trace,
                  taskContext: input,
                },
                this.provider,
                this.config.model,
                this.effectiveWorkspace,
              );
              if (memoryResult.entries.length > 0) {
                for (const entry of memoryResult.entries) {
                  this.files.appendExperience({
                    task: `[${entry.category}] ${entry.summary}`,
                    problem: `Memory extracted from wake session in ${this.name}`,
                    solution: entry.detail || entry.summary,
                  });
                }
                this.logger.info("Memory: saved %d entries from wake session", memoryResult.entries.length);
              }
            } catch (err) {
              this.logger.debug("Memory agent failed (non-blocking): %s", err);
            }
          });
        }
      }

      return response;
    } catch (err: any) {
      this._errorFlag = true;
      // AbortError：超时或 stop() 触发 — 返回友好消息而非向上抛
      if (err?.name === "AbortError" || ac.signal.aborted) {
        this.logger.warn("Session %s aborted (timeout or stopped) — %s", sessionKey, err?.message || "unknown");
        return { content: "[已取消] Agent 执行被中断，请重试", usage: { inputTokens: 0, outputTokens: 0 } };
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
      if (this._abortControllers.get(sessionKey) === ac) {
        this._abortControllers.delete(sessionKey);
        this._activeSessions.delete(sessionKey);
      }
      this.wakeSessions.delete(sessionKey);
      if (isGroup) {
        const remainingWakeSessions = [...this.wakeSessions.values()];
        this.wakeSession = remainingWakeSessions[remainingWakeSessions.length - 1];
      }

      // Emit agent:sleep hook if all sessions complete (skip if stop() already handled it)
      if (this._activeSessions.size === 0 && !this._stopping) {
        const hookBus = (globalThis as any).__cobeingHookBus;
        if (hookBus) {
          hookBus.emit("agent:sleep", { id: this.id, name: this.name }, { activeSessions: [] }).catch(() => {});
        }
      }
      if (this._activeSessions.size === 0) {
        this._stopping = false;
      }
    }
  }

  /** 后台反思：传入完整对话历史，仅在有工具调用时触发 */
  private reflectInBackground(task: string, response: string): void {
    setImmediate(async () => {
      try {
        // 获取完整对话历史（包含工具调用和结果）
        const history = this.conversationLoop.getHistory();

        // 条件反思：只在对话包含工具调用时触发
        const hasToolCalls = history.some(m => m.role === "tool" || (m.toolCalls && m.toolCalls.length > 0));
        if (!hasToolCalls) {
          this.logger.debug("Skipping reflection: no tool calls in conversation");
          return;
        }

        await this.memoryStore.reflectFromHistory(task, history, this.provider, this.config.model);
      } catch {
        // 反思失败不影响主流程
      }
    });
  }

  getStatus(): AgentStatus {
    if (this._disposed) return "stopped";
    if (this._errorFlag) return "error";
    if (this._activeSessions.size > 0) return "running";
    return "idle";
  }

  /** 获取当前活跃的会话键列表（"main" 或 "group:<id>"） */
  getActiveSessions(): string[] {
    return [...this._activeSessions];
  }

  /** 获取任务摘要（从 TaskInbox 聚合） */
  getTaskSummary(): import("@cobeing/shared").AgentTaskSummary {
    try {
      const inbox = this.files.readInbox();
      const active = inbox.filter(t => !["completed", "cancelled"].includes(t.status));
      return {
        activeCount: active.length,
        blockedCount: active.filter(t => t.status === "blocked").length,
        waitingUserCount: active.filter(t => t.status === "waiting_user").length,
        waitingDependencyCount: active.filter(t => t.status === "waiting_dependency").length,
        dominantStatus: active.length === 0 ? "idle"
          : active.some(t => t.status === "failed") ? "failed"
          : active.some(t => t.status === "blocked") ? "blocked"
          : active.some(t => t.status === "waiting_user") ? "waiting_user"
          : active.some(t => t.status === "waiting_dependency") ? "waiting_dependency"
          : active.some(t => t.status === "running") ? "running"
          : "pending",
        recentFailures: inbox.filter(t => t.status === "failed").slice(-3).map(t => t.title),
      };
    } catch {
      return { activeCount: 0, blockedCount: 0, waitingUserCount: 0, waitingDependencyCount: 0, dominantStatus: "idle", recentFailures: [] };
    }
  }

  /** Expose ToolRegistry for ToolAgent use */
  getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }

  /** 停止所有正在执行的任务（跨所有活跃 session） */
  stop(): void {
    if (this._abortControllers.size > 0 || this._activeSessions.size > 0) {
      const count = this._abortControllers.size;
      for (const ac of this._abortControllers.values()) {
        ac.abort();
      }
      this._stopping = true;
      this.logger.info("Agent execution stopped (%d sessions)", count);

      // Emit agent:sleep hook
      const hookBus = (globalThis as any).__cobeingHookBus;
      if (hookBus) {
        hookBus.emit("agent:sleep", { id: this.id, name: this.name }, { activeSessions: [] }).catch(() => {});
      }
    }
  }

  async stopAndWait(timeoutMs = 2_000): Promise<void> {
    this.stop();
    const deadline = Date.now() + timeoutMs;
    while (this._activeSessions.size > 0 && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (this._activeSessions.size > 0) {
      this.logger.warn("Disposing while sessions still active: %s", [...this._activeSessions].join(", "));
    }
  }

  /** 获取沙箱实例（用于群组挂载等） */
  get sandboxRunner(): DockerSandbox | null {
    return this._sandbox;
  }

  /** 连接 MCP 服务器 */
  async connectMCPServer(id: string, config: import("@cobeing/shared").MCPServerConfig): Promise<void> {
    await this.mcpManager.connect(id, config);
    // 注册 MCP 工具到 registry
    for (const tool of this.mcpManager.getServerTools(id)) {
      this.toolRegistry.register(tool);
    }
    // 更新 conversation loop 的 tool definitions（复用已有 _toolExecutor）
    this.conversationLoop = this.createLoop(this._toolExecutor);
    this.logger.info("MCP server '%s' connected, tools registered", id);
  }

  async disconnectMCPServer(id: string): Promise<void> {
    await this.mcpManager.disconnect(id);
    for (const tool of this.toolRegistry.listAll()) {
      if (tool.name.startsWith(`mcp:${id}:`)) {
        this.toolRegistry.unregister(tool.name);
      }
    }
    this.conversationLoop = this.createLoop(this._toolExecutor);
    this.logger.info("MCP server '%s' disconnected, tools unregistered", id);
  }

  private eventBusUnsub?: () => void;

  /** 订阅事件总线，接收自发消息 */
  subscribeToBus(bus: AgentEventBus): void {
    this.eventBusUnsub = bus.subscribe(this.id, async (msg) => {
      if (msg.fromAgentId === this.id) return;

      this.logger.info("Received spontaneous message from %s", msg.fromAgentId);

      const context = msg.groupId
        ? `[群组 ${msg.groupId} 中 @${this.id}]\n`
        : `[${msg.fromAgentId} 私信]\n`;
      const prompt = `${context}${msg.content}`;

      try {
        await this.run(prompt);
      } catch (err) {
        this.logger.error("Failed to handle spontaneous message: %s", err);
      }
    });
  }

  /** 清除指定群组的对话循环历史（用于错误恢复） */
  clearGroupLoop(groupId: string): void {
    const key = `group:${groupId}`;
    const entry = this.sessionLoops.get(key);
    if (entry) {
      entry.loop.clearHistory();
      this.logger.info("Cleared group loop history for group: %s", groupId);
    }
  }

  /** Prune session loops that have been idle for over 1 hour */
  private pruneIdleSessions(): void {
    const cutoff = Date.now() - this.SESSION_IDLE_TIMEOUT_MS;
    for (const [key, entry] of this.sessionLoops) {
      if (entry.lastAccessTime < cutoff) {
        this.sessionLoops.delete(key);
        this.logger.debug("Pruned idle session: %s", key);
      }
    }
  }

  /**
   * 执行一次性（无状态）审核调用
   * 用于 Review Agent 审核其他 Agent 的群组消息
   */
  async reviewOnce(input: ReviewInput): Promise<ReviewResult> {
    const prompt = buildReviewPrompt(input)
    try {
      const response = await chatCompleteWithGateway<string>(this.provider, {
        model: this.config.model,
        messages: [{ role: "user", content: prompt }],
        maxTokens: 512,
        temperature: 0.1,
      })
      return parseReviewResult(response)
    } catch {
      return { pass: true, reason: '' }
    }
  }

  /** 关闭资源 */
  async dispose(): Promise<void> {
    if (this._disposed) return;
    this._disposed = true;
    await this.stopAndWait();
    // Emit agent:destroy hook — await completion before cleanup
    const hookBus = (globalThis as any).__cobeingHookBus;
    if (hookBus) {
      try {
        await hookBus.emit("agent:destroy", {
          id: this.id, name: this.name, role: this.config.role,
        });
      } catch { /* hooks run in parallel, errors caught internally */ }
    }

    this.eventBusUnsub?.();
    this.memoryStore.close();
    await this.mcpManager.close();
    if (this._sandbox) {
      await this._sandbox.destroy();
      this._sandbox = null;
    }
  }
}
