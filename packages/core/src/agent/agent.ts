/**
 * Agent 核心 — 单个 Agent 的完整定义和运行时
 */
import type { AgentConfig, AgentResponse, AgentStatus } from "@myagents/shared";
import type { LLMProvider } from "@myagents/providers";
import type { ChannelAdapter } from "@myagents/channels";
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
import { SkillLoader } from "../skills/loader.js";
import { SkillMdLoader } from "../skills/md-loader.js";
import { SubAgentSpawner } from "./spawner.js";
import { AgentPaths, AgentFiles } from "./paths.js";
import { MemoryWriter } from "../memory/writer.js";
import { MemoryReader } from "../memory/reader.js";
import { createLogger } from "@myagents/shared";

/** 所有内置工具映射 */
const BUILTIN_TOOLS: Record<string, import("@myagents/shared").Tool> = {
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
  private mcpManager: MCPManager;
  private skillLoader: SkillLoader;
  private skillMdLoader: SkillMdLoader;
  private _spawner: SubAgentSpawner | null = null;
  private _status: AgentStatus = "idle";
  private logger: ReturnType<typeof createLogger>;

  // Agent 文件系统
  readonly paths: AgentPaths;
  readonly files: AgentFiles;
  private memoryWriter: MemoryWriter;

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
    const identity = this.files.readIdentity();
    const soulContent = this.files.readSoul();
    const memoryIndex = this.files.readMemoryIndex();
    const fileConfig = this.files.readConfig();

    // 合并 name（IDENTITY.md 优先）
    if (identity.name) {
      (this as any).name = identity.name;
    }

    // 合并配置（config.json 补充 AgentConfig）
    const mergedConfig = { ...config, ...fileConfig };
    const workingDir = this.paths.workspaceDir;

    // 增强 systemPrompt：SOUL.md + MEMORY.md
    let enhancedPrompt = config.systemPrompt || "";
    if (soulContent) {
      enhancedPrompt = soulContent + "\n\n" + enhancedPrompt;
    }
    if (memoryIndex) {
      enhancedPrompt += "\n\n# 你的历史记忆\n\n" + memoryIndex;
    }

    // 记忆系统
    this.memoryWriter = new MemoryWriter(this.paths.memoryDir);
    new MemoryReader(this.paths.memoryDir, this.paths.memoryIndexPath); // 初始化供外部使用

    // 初始化工具系统
    this.toolRegistry = new ToolRegistry();
    const enabledTools = mergedConfig.tools ?? mergedConfig.toolsConfig?.enabled ?? [];
    for (const toolName of enabledTools) {
      const tool = BUILTIN_TOOLS[toolName];
      if (tool) {
        this.toolRegistry.register(tool);
      } else {
        this.logger.warn("Unknown tool: %s", toolName);
      }
    }

    const permission = new PermissionEnforcer(
      mergedConfig.permissions ?? { mode: "ask" },
      mergedConfig.toolsConfig,
      workingDir,
    );
    const toolExecutor = new ToolExecutor(this.toolRegistry, permission);

    // MCP 管理器
    this.mcpManager = new MCPManager();

    // YAML/JSON 技能加载器
    this.skillLoader = new SkillLoader();
    this.skillLoader.load(
      mergedConfig.skillsDir ?? "skills",
      () => this.provider,
    );
    for (const tool of this.skillLoader.getTools()) {
      this.toolRegistry.register(tool);
    }

    // SKILL.md 加载器（Agent 私有 skills 目录）
    this.skillMdLoader = new SkillMdLoader();
    this.skillMdLoader.load(
      this.paths.skillsDir,
      () => this.provider,
    );
    for (const tool of this.skillMdLoader.getTools()) {
      this.toolRegistry.register(tool);
    }

    this.conversationLoop = this.createLoop(toolExecutor, undefined, enhancedPrompt, mergedConfig.model);
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
    });
  }

  /** 绑定 channel */
  addChannel(channel: ChannelAdapter): void {
    this.channels.push(channel);
    channel.onMessage(async (msg) => {
      await this.handleIncomingMessage(msg);
    });
    this.logger.info("Channel bound: %s", channel.name);
  }

  /** 处理收到的消息 */
  async handleIncomingMessage(msg: { channelId: string; senderId: string; senderName: string; content: string; metadata?: Record<string, unknown> }): Promise<void> {
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
      const toolExecutor = new ToolExecutor(this.toolRegistry, permission);
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
    } catch (err) {
      this.logger.error("Error handling message: %s", err);
    } finally {
      this._status = "idle";
    }
  }

  /** 直接运行（非 channel 输入，用于测试/GUI） */
  async run(input: string, events?: ConversationLoopEvents): Promise<AgentResponse> {
    this._status = "running";
    try {
      // 保存用户消息
      await this.memoryWriter.append({
        session: "main",
        role: "user",
        content: input,
      });

      const response = await this.conversationLoop.run(input, events);

      // 保存助手回复
      await this.memoryWriter.append({
        session: "main",
        role: "assistant",
        content: response.content,
      });

      return response;
    } finally {
      this._status = "idle";
    }
  }

  getStatus(): AgentStatus {
    return this._status;
  }

  /** 连接 MCP 服务器 */
  async connectMCPServer(id: string, config: import("@myagents/shared").MCPServerConfig): Promise<void> {
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

  /** 关闭资源 */
  async dispose(): Promise<void> {
    await this.mcpManager.close();
  }
}
