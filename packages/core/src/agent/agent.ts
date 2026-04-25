/**
 * Agent 核心 — 单个 Agent 的完整定义和运行时
 */
import path from "node:path";
import type { AgentConfig, AgentResponse, AgentStatus } from "@cobeing/shared";
import type { LLMProvider } from "@cobeing/providers";
import type { ChannelAdapter } from "@cobeing/channels";
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
import { agentMessageTool } from "../tools/agent-message.js";
import { MCPManager } from "../mcp/manager.js";
import type { SkillRepository } from "../skills/repository.js";
import { makeSkillExecuteTool, makeSkillListTool, makeSkillCreateTool } from "../tools/skill-tools.js";
import { SubAgentSpawner } from "./spawner.js";
import { AgentPaths, AgentFiles } from "./paths.js";
import { DockerSandbox } from "../tools/sandbox/docker-sandbox.js";
import { MemoryWriter } from "../memory/writer.js";
import { MemoryReader } from "../memory/reader.js";
import { ExperienceWriter } from "../memory/experience.js";
import { MemoryStore } from "../memory/memory-store.js";
import { makeMemoryTool } from "../memory/memory-tool.js";
import { AgentEventBus } from "./event-bus.js";
import { makeTodoAddTool, makeTodoListTool, makeTodoCompleteTool, makeTodoRemoveTool } from "../todo/tools.js";
import { currentTimeTool } from "../todo/time-tool.js";
import { buildSystemPromptFromFiles } from "../conversation/prompt-builder.js";
import { makeGroupMemorySearchTool } from "../tools/group-memory-search.js";
import { makeExperienceReflectTool } from "../tools/experience-reflect.js";
import { createLogger } from "@cobeing/shared";

/** 所有内置工具映射 */
const BUILTIN_TOOLS: Record<string, import("@cobeing/shared").Tool> = {
  "bash": bashTool,
  "read-file": readFileTool,
  "write-file": writeFileTool,
  "edit-file": editFileTool,
  "glob": globTool,
  "grep": grepTool,
  "web-fetch": webFetchTool,
  "agent-message": agentMessageTool,
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
  private mcpManager: MCPManager;

  /** 注册额外工具（供子类或 runtime 扩展） */
  registerTool(tool: import("@cobeing/shared").Tool): void {
    this.toolRegistry.register(tool);
  }
  private _spawner: SubAgentSpawner | null = null;
  private _sandbox: DockerSandbox | null = null;
  private _status: AgentStatus = "idle";
  private _groupContext?: string;
  private logger: ReturnType<typeof createLogger>;

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

  // Agent 文件系统
  readonly paths: AgentPaths;
  readonly files: AgentFiles;
  readonly memoryStore: MemoryStore;
  private memoryWriter: MemoryWriter;
  private experienceWriter: ExperienceWriter;

  // 每个用户/会话独立的对话循环
  private sessionLoops = new Map<string, ConversationLoop>();

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

    // 从文件系统加载增强信息
    const character = this.files.readCharacter();
    const fileConfig = this.files.readConfig();

    // 合并 name（CHARACTER.md 优先 — 从 "- Name: xxx" 行提取）
    if (character) {
      const nameMatch = character.match(/-\s*Name:\s*(.+)/);
      if (nameMatch) {
        (this as any).name = nameMatch[1].trim();
      }
    }

    // 合并配置（config.json 补充 AgentConfig）
    const mergedConfig = { ...config, ...fileConfig };
    const workingDir = this.paths.workspaceDir;

    // 记忆系统（统一 MemoryStore，延迟初始化）
    this.memoryStore = MemoryStore.createLazy(this.paths.directory, {
      charLimits: (globalThis as any).__cobeingConfig?.memory?.charLimits,
    });

    // 兼容旧接口
    this.memoryWriter = new MemoryWriter(this.paths.memoryDir);
    this.experienceWriter = new ExperienceWriter(this.paths.experiencePath, this.provider);

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

    // 注册 memory 工具
    this.toolRegistry.register(makeMemoryTool(this.memoryStore));

    // 注册经验总结工具（所有 agent 无条件可用）
    this.toolRegistry.register(makeExperienceReflectTool(
      this.paths.experiencePath,
      () => this.provider,
    ));

    // 注册 TODO 工具
    const todoDataRoot = path.dirname(path.dirname(this.paths.directory));
    this.toolRegistry.register(makeTodoAddTool(todoDataRoot, undefined));
    this.toolRegistry.register(makeTodoListTool(todoDataRoot, undefined));
    this.toolRegistry.register(makeTodoCompleteTool(todoDataRoot, undefined, (groupId) => {
      const groupManager = (globalThis as any).__cobeingGroupManager;
      return groupManager?.getScanner?.(groupId);
    }));
    this.toolRegistry.register(makeTodoRemoveTool(todoDataRoot, undefined));
    this.toolRegistry.register(currentTimeTool);

    // 群组记忆搜索工具
    this.toolRegistry.register(makeGroupMemorySearchTool(
      (groupId, agentId) => {
        const groupManager = (globalThis as any).__cobeingGroupManager;
        return groupManager?.get(groupId)?.getAgentMemory(agentId);
      }
    ));

    const permission = new PermissionEnforcer(
      mergedConfig.permissions ?? { mode: "ask" },
      mergedConfig.toolsConfig,
      workingDir,
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
    );

    // MCP 管理器
    this.mcpManager = new MCPManager();

    // Skill 统一工具（Phase 8.2: 注入 SkillRepository + 3 个统一工具）
    const requestedSkills = mergedConfig.skills as string[] | undefined;

    this.conversationLoop = this.createLoop(toolExecutor, undefined, undefined, mergedConfig.model);
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
      workingDir: this.paths.workspaceDir,
      maxToolRounds: this.config.maxToolRounds,
      promptBuilder: systemPrompt
        ? undefined  // 固定 prompt 的场景（如 butler），不用回调
        : () => {
            const base = buildSystemPromptFromFiles(
              this.files,
              { name: this.name, role: this.config.role, systemPrompt: this.config.systemPrompt },
              undefined,  // 不传 memoryStore，走文件读取路径，实现实时更新
            );
            return this._groupContext
              ? `${base}\n\n${this._groupContext}`
              : base;
          },
    });
  }

  /** 注入 SkillRepository，注册 3 个统一工具 */
  injectSkillRepository(repo: SkillRepository): void {
    const allowedSkills = this.config.skills;
    this.toolRegistry.register(makeSkillExecuteTool(repo, () => this.provider, allowedSkills));
    this.toolRegistry.register(makeSkillListTool(repo, allowedSkills));
    this.toolRegistry.register(makeSkillCreateTool(repo));

    // 重建 conversation loop 以包含新工具
    const perm = new PermissionEnforcer(
      this.config.permissions ?? { mode: "ask" },
      this.config.toolsConfig,
      this.paths.workspaceDir,
    );
    const executor = new ToolExecutor(
      this.toolRegistry,
      perm,
      undefined,
      this.config.sandbox,
      this._sandbox ?? undefined,
    );
    this.conversationLoop = this.createLoop(executor);

    this.logger.info("SkillRepository injected: %d skills available (filter: %s)",
      repo.size, allowedSkills?.join(",") ?? "all");
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
    if (this._status !== "idle") {
      this.logger.debug("Busy, queuing message from %s", msg.senderId);
    }

    const sessionKey = `${msg.channelId}:${msg.senderId}`;
    let loop = this.sessionLoops.get(sessionKey);
    if (!loop) {
      const permission = new PermissionEnforcer(
        this.config.permissions ?? { mode: "ask" },
        this.config.toolsConfig,
        this.paths.workspaceDir,
      );
      const toolExecutor = new ToolExecutor(
        this.toolRegistry,
        permission,
        undefined,
        this.config.sandbox,
        this._sandbox ?? undefined,
      );
      loop = this.createLoop(toolExecutor, sessionKey);
      this.sessionLoops.set(sessionKey, loop);
    }

    this._status = "running";

    try {
      // 保存用户消息
      await this.memoryWriter.append({
        session: sessionKey,
        role: "user",
        content: msg.content,
      });

      const events: ConversationLoopEvents = {
        onToken: (_token) => {
          // 流式 token 推送到 GUI（后续接入）
        },
      };

      const response = await loop.run(msg.content, events);

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
      this.logger.error("Error handling message: %s", err);
      return "";
    } finally {
      this._status = "idle";
    }
  }

  /** 直接运行（非 channel 输入，用于测试/GUI） */
  async run(input: string, events?: ConversationLoopEvents): Promise<AgentResponse> {
    this._status = "running";
    try {
      // 保存用户消息
      this.memoryStore.appendHistory({
        session: "main",
        role: "user",
        content: input,
      });

      const response = await this.conversationLoop.run(input, events);

      // 保存助手回复
      this.memoryStore.appendHistory({
        session: "main",
        role: "assistant",
        content: response.content,
      });

      // 后台反思（不阻塞返回，Phase 8.4: 传入完整历史 + 条件触发）
      this.reflectInBackground(input, response.content);

      return response;
    } finally {
      this._status = "idle";
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
    return this._status;
  }

  /** 获取沙箱实例（用于群组挂载等） */
  get sandboxRunner(): DockerSandbox | null {
    return this._sandbox;
  }

  /** 连接 MCP 服务器 */
  async connectMCPServer(id: string, config: import("@cobeing/shared").MCPServerConfig): Promise<void> {
    await this.mcpManager.connect(id, config);
    // 注册 MCP 工具到 registry
    for (const tool of this.mcpManager.getTools()) {
      this.toolRegistry.register(tool);
    }
    // 更新 conversation loop 的 tool definitions
    this.conversationLoop = this.createLoop(
      new ToolExecutor(
        this.toolRegistry,
        new PermissionEnforcer(this.config.permissions ?? { mode: "ask" }, this.config.toolsConfig, this.paths.workspaceDir),
        undefined,
        this.config.sandbox,
        this._sandbox ?? undefined,
      ),
    );
    this.logger.info("MCP server '%s' connected, tools registered", id);
  }

  /** 获取 SubAgentSpawner */
  get spawner(): SubAgentSpawner {
    if (!this._spawner) {
      this._spawner = new SubAgentSpawner(this.config, this.provider, this.paths.workspaceDir);
    }
    return this._spawner;
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

  /** 关闭资源 */
  async dispose(): Promise<void> {
    this.eventBusUnsub?.();
    this.memoryStore.close();
    await this.mcpManager.close();
    if (this._sandbox) {
      await this._sandbox.destroy();
      this._sandbox = null;
    }
  }
}
