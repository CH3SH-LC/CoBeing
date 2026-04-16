/**
 * ButlerAgent — privileged agent that manages other agents and groups
 */
import type { AgentConfig, Tool, ToolContext, ToolResult, GroupProtocol } from "@myagents/shared";
import type { LLMProvider } from "@myagents/providers";
import { Agent } from "./agent.js";
import { AgentRegistry } from "./registry.js";
import { GroupManager } from "../group/manager.js";
import { ConversationLoop } from "../conversation/conversation-loop.js";
import { PermissionEnforcer } from "../tools/permission.js";
import { ToolExecutor } from "../tools/executor.js";
import { makeGroupSpeakTool, makeTalkCreateTool, makeTalkSendTool, makeTalkReadTool } from "../tools/group-tools.js";
import { ButlerRegistry } from "../butler/registry.js";
import { createLogger } from "@myagents/shared";

const log = createLogger("butler");

// ---- Butler Tools ----

function makeCreateAgentTool(
  registry: AgentRegistry,
  providerGetter: () => LLMProvider,
  butlerRegistry: ButlerRegistry,
  providerResolver?: (providerId: string) => LLMProvider | undefined,
): Tool {
  return {
    name: "butler-create-agent",
    description: "创建一个新 Agent（会自动创建独立文件系统）",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Agent 名称" },
        role: { type: "string", description: "Agent 角色" },
        systemPrompt: { type: "string", description: "系统提示词（可选）" },
        capabilities: { type: "string", description: "能力描述（可选）" },
        provider: { type: "string", description: "LLM Provider（默认 deepseek）" },
        model: { type: "string", description: "模型名称（默认 deepseek-chat）" },
      },
      required: ["name", "role"],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const name = params.name as string;
      const id = name.toLowerCase().replace(/\s+/g, "-");
      const providerId = (params.provider as string) || "deepseek";
      const model = (params.model as string) || "deepseek-chat";

      const config: AgentConfig = {
        id,
        name,
        role: params.role as string,
        systemPrompt: (params.systemPrompt as string) || `你是${name}，${params.role}`,
        provider: providerId,
        model,
        permissions: { mode: "workspace-write" },
        sandbox: { enabled: false, filesystem: "workspace-only", network: true },
        tools: ["bash", "read-file", "write-file", "glob", "grep", "web-fetch"],
      };

      // 使用 resolver 或 fallback 到默认 provider
      const provider = providerResolver?.(providerId) ?? providerGetter();
      const agent = new Agent(config, provider);
      registry.register(agent);

      // 写入 ButlerRegistry
      butlerRegistry.registerAgent({
        id,
        name,
        role: params.role as string,
        capabilities: (params.capabilities as string) || "",
        provider: providerId,
        model,
        systemPrompt: (params.systemPrompt as string) || `你是${name}，${params.role}`,
      });

      butlerRegistry.appendTaskLog({
        timestamp: new Date().toISOString(),
        task: `创建 Agent: ${name}`,
        action: "butler-create-agent",
        result: `成功 (ID: ${id})`,
      });

      log.info("Created agent: %s (%s)", name, id);
      return { toolCallId: "", content: `已创建 Agent ${name} (ID: ${id})` };
    },
  };
}

function makeDestroyAgentTool(registry: AgentRegistry, butlerRegistry: ButlerRegistry): Tool {
  return {
    name: "butler-destroy-agent",
    description: "销毁一个 Agent",
    parameters: {
      type: "object",
      properties: { agentId: { type: "string", description: "Agent ID" } },
      required: ["agentId"],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const id = params.agentId as string;
      const agent = registry.get(id);
      if (!agent) return { toolCallId: "", content: `未找到 Agent: ${id}`, isError: true };
      registry.unregister(id);
      butlerRegistry.unregisterAgent(id);
      return { toolCallId: "", content: `已销毁 Agent ${agent.name} (${id})` };
    },
  };
}

function makeCreateGroupTool(groupManager: GroupManager, butlerRegistry: ButlerRegistry): Tool {
  return {
    name: "butler-create-group",
    description: "创建一个 Agent 群组",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "群组名称" },
        members: { type: "array", items: { type: "string" }, description: "成员 Agent ID 列表" },
        protocol: { type: "string", description: "讨论协议: round-robin / free-form / moderated" },
      },
      required: ["name", "members", "protocol"],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const id = (params.name as string).toLowerCase().replace(/\s+/g, "-");
      const group = groupManager.create({
        id,
        name: params.name as string,
        members: params.members as string[],
        protocol: params.protocol as GroupProtocol,
      });

      butlerRegistry.registerGroup({
        id,
        name: params.name as string,
        members: params.members as string[],
        protocol: params.protocol as string,
      });

      return { toolCallId: "", content: `已创建群组 ${group.config.name} (ID: ${id})` };
    },
  };
}

function makeDestroyGroupTool(groupManager: GroupManager, butlerRegistry: ButlerRegistry): Tool {
  return {
    name: "butler-destroy-group",
    description: "销毁一个群组",
    parameters: {
      type: "object",
      properties: { groupId: { type: "string", description: "群组 ID" } },
      required: ["groupId"],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const id = params.groupId as string;
      const group = groupManager.get(id);
      if (!group) return { toolCallId: "", content: `未找到群组: ${id}`, isError: true };
      groupManager.delete(id);
      butlerRegistry.unregisterGroup(id);
      return { toolCallId: "", content: `已销毁群组 ${group.config.name}` };
    },
  };
}

function makeListTool(registry: AgentRegistry, groupManager: GroupManager): Tool {
  return {
    name: "butler-list",
    description: "列出所有 Agent 和群组",
    parameters: { type: "object", properties: {} },
    async execute(_params, _context: ToolContext): Promise<ToolResult> {
      const agents = registry.list().map(a => `  - ${a.name} (${a.id}) [${a.getStatus()}]`).join("\n");
      const groups = groupManager.list().map(g => `  - ${g.config.name} (${g.id}) [${g.config.members.length} members, ${g.config.protocol}]`).join("\n");
      return {
        toolCallId: "",
        content: `Agents:\n${agents || "  (none)"}\n\nGroups:\n${groups || "  (none)"}`,
      };
    },
  };
}

function makeRunGroupTool(groupManager: GroupManager, butlerRegistry: ButlerRegistry): Tool {
  return {
    name: "butler-run-group",
    description: "启动群组讨论",
    parameters: {
      type: "object",
      properties: {
        groupId: { type: "string", description: "群组 ID" },
        topic: { type: "string", description: "讨论主题" },
      },
      required: ["groupId", "topic"],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const group = groupManager.get(params.groupId as string);
      if (!group) return { toolCallId: "", content: `未找到群组: ${params.groupId}`, isError: true };
      const history = await group.run(params.topic as string);
      const summary = history.map(m => `[${m.fromAgentId}]: ${m.content.slice(0, 200)}`).join("\n\n");

      // 保存到 GroupContext
      const ctx = groupManager.getContext(params.groupId as string);
      if (ctx) {
        for (const msg of history) {
          ctx.speakToMain(msg.fromAgentId, msg.content);
        }
        ctx.saveMain();
      }

      // 记录任务日志
      butlerRegistry.appendTaskLog({
        timestamp: new Date().toISOString(),
        task: `群组讨论: ${params.topic}`,
        action: `butler-run-group (${params.groupId})`,
        result: `${history.length} 条消息`,
      });

      return { toolCallId: "", content: `讨论完成 (${history.length} 条消息):\n\n${summary}` };
    },
  };
}

function makeAddToGroupTool(groupManager: GroupManager, butlerRegistry: ButlerRegistry): Tool {
  return {
    name: "butler-add-to-group",
    description: "将已有 Agent 加入群组",
    parameters: {
      type: "object",
      properties: {
        groupId: { type: "string", description: "群组 ID" },
        agentId: { type: "string", description: "Agent ID" },
      },
      required: ["groupId", "agentId"],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const group = groupManager.get(params.groupId as string);
      if (!group) return { toolCallId: "", content: `未找到群组: ${params.groupId}`, isError: true };
      group.addMember(params.agentId as string);

      // 更新注册表
      const gEntry = butlerRegistry.parseGroupsRegistry().find(g => g.id === params.groupId);
      if (gEntry) {
        const members = [...gEntry.members, params.agentId as string];
        butlerRegistry.registerGroup({ ...gEntry, members });
      }

      return { toolCallId: "", content: `已将 ${params.agentId} 加入群组 ${params.groupId}` };
    },
  };
}

// ---- Channel 绑定工具 ----

function makeChannelBindTool(router: import("../group/router.js").ChannelRouter, groupManager: GroupManager): Tool {
  return {
    name: "channel-bind",
    description: "将 Channel 绑定到 Group（动态）",
    parameters: {
      type: "object",
      properties: {
        channelId: { type: "string", description: "Channel 标识" },
        groupId: { type: "string", description: "目标 Group ID" },
        role: { type: "string", description: "绑定角色: user（实时发言） | owner（私聊群主）" },
      },
      required: ["channelId", "groupId", "role"],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const channelId = params.channelId as string;
      const groupId = params.groupId as string;
      const role = params.role as "user" | "owner";

      if (!groupManager.get(groupId)) {
        return { toolCallId: "", content: `未找到群组: ${groupId}`, isError: true };
      }

      if (role !== "user" && role !== "owner") {
        return { toolCallId: "", content: `无效角色: ${role}，必须是 user 或 owner`, isError: true };
      }

      router.bind(channelId, groupId, role);
      return { toolCallId: "", content: `已将 Channel ${channelId} 绑定到群组 ${groupId} (角色: ${role})` };
    },
  };
}

function makeChannelUnbindTool(router: import("../group/router.js").ChannelRouter): Tool {
  return {
    name: "channel-unbind",
    description: "解除 Channel 绑定",
    parameters: {
      type: "object",
      properties: {
        channelId: { type: "string", description: "Channel 标识" },
      },
      required: ["channelId"],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const channelId = params.channelId as string;
      router.unbind(channelId);
      return { toolCallId: "", content: `已解除 Channel ${channelId} 的绑定` };
    },
  };
}

// ---- 新增管家工具 ----

function makeReadRegistryTool(butlerRegistry: ButlerRegistry): Tool {
  return {
    name: "butler-read-registry",
    description: "阅读 Agent/Group 注册表（了解已有 agent 和群组）",
    parameters: {
      type: "object",
      properties: {
        type: {
          type: "string",
          description: "读取类型: agents / groups / all",
        },
      },
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const type = (params.type as string) ?? "all";
      let content = "";

      if (type === "agents" || type === "all") {
        content += "=== Agent 注册表 ===\n" + (butlerRegistry.readAgentsRegistry() || "(空)");
      }
      if (type === "groups" || type === "all") {
        if (content) content += "\n\n";
        content += "=== 群组注册表 ===\n" + (butlerRegistry.readGroupsRegistry() || "(空)");
      }

      return { toolCallId: "", content };
    },
  };
}

function makeUpdateRegistryTool(butlerRegistry: ButlerRegistry): Tool {
  return {
    name: "butler-update-registry",
    description: "更新 Agent/Group 信息到注册表",
    parameters: {
      type: "object",
      properties: {
        type: { type: "string", description: "更新类型: agent / group" },
        id: { type: "string", description: "Agent 或 Group ID" },
        updates: {
          type: "object",
          description: "要更新的字段（如 status, capabilities, outcome）",
        },
      },
      required: ["type", "id"],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const type = params.type as string;
      const id = params.id as string;
      const updates = (params.updates as Record<string, string>) ?? {};

      if (type === "agent") {
        const existing = butlerRegistry.getAgent(id);
        if (!existing) {
          return { toolCallId: "", content: `未找到 Agent: ${id}`, isError: true };
        }
        butlerRegistry.registerAgent({
          ...existing,
          ...updates,
          id: existing.id,
          name: updates.name ?? existing.name,
          role: updates.role ?? existing.role,
        });
        return { toolCallId: "", content: `已更新 Agent ${id}` };
      }

      if (type === "group") {
        const groups = butlerRegistry.parseGroupsRegistry();
        const existing = groups.find(g => g.id === id);
        if (!existing) {
          return { toolCallId: "", content: `未找到群组: ${id}`, isError: true };
        }
        butlerRegistry.registerGroup({
          ...existing,
          ...updates,
          id: existing.id,
          name: updates.name ?? existing.name,
          members: existing.members,
          protocol: updates.protocol ?? existing.protocol,
        });
        return { toolCallId: "", content: `已更新群组 ${id}` };
      }

      return { toolCallId: "", content: `未知类型: ${type}`, isError: true };
    },
  };
}

function makeAnalyzeTaskTool(providerGetter: () => LLMProvider, butlerRegistry: ButlerRegistry): Tool {
  return {
    name: "butler-analyze-task",
    description: "分析任务需要什么类型的 Agent，返回建议的 Agent 角色和能力",
    parameters: {
      type: "object",
      properties: {
        task: { type: "string", description: "用户任务描述" },
      },
      required: ["task"],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const task = params.task as string;
      const provider = providerGetter();
      if (!provider) {
        return { toolCallId: "", content: "No LLM provider available", isError: true };
      }

      // 获取已有 Agent 信息
      const agents = butlerRegistry.parseAgentsRegistry();
      const existingInfo = agents.map(a => `- ${a.id}: ${a.role} (${a.capabilities || "无能力描述"})`).join("\n");

      const prompt = `你是任务分析器。根据用户任务，分析需要什么类型的 Agent。

已有 Agent:
${existingInfo || "(无)"}

用户任务: ${task}

请回答：
1. 需要哪些类型的 Agent（角色 + 能力）
2. 已有哪些 Agent 可以复用
3. 需要新创建哪些 Agent
4. 建议的群组配置（讨论协议）

用简洁的中文回答。`;

      try {
        let result = "";
        for await (const chunk of provider.chat({
          model: "",
          messages: [{ role: "user", content: prompt }],
        })) {
          if (chunk.type === "content" && chunk.content) {
            result += chunk.content;
          }
        }
        return { toolCallId: "", content: result || "分析完成" };
      } catch (err: any) {
        return { toolCallId: "", content: `分析失败: ${err.message}`, isError: true };
      }
    },
  };
}

// ---- ButlerAgent ----

export class ButlerAgent extends Agent {
  readonly butlerRegistry: ButlerRegistry;

  constructor(
    config: AgentConfig,
    provider: LLMProvider,
    registry: AgentRegistry,
    groupManager: GroupManager,
    providerResolver?: (providerId: string) => LLMProvider | undefined,
    router?: import("../group/router.js").ChannelRouter,
  ) {
    super(config, provider);

    // 初始化 ButlerRegistry
    this.butlerRegistry = new ButlerRegistry();

    // Register butler tools
    this.toolRegistry.register(makeCreateAgentTool(registry, () => provider, this.butlerRegistry, providerResolver));
    this.toolRegistry.register(makeDestroyAgentTool(registry, this.butlerRegistry));
    this.toolRegistry.register(makeCreateGroupTool(groupManager, this.butlerRegistry));
    this.toolRegistry.register(makeDestroyGroupTool(groupManager, this.butlerRegistry));
    this.toolRegistry.register(makeListTool(registry, groupManager));
    this.toolRegistry.register(makeRunGroupTool(groupManager, this.butlerRegistry));
    this.toolRegistry.register(makeAddToGroupTool(groupManager, this.butlerRegistry));

    // 新增管家工具
    this.toolRegistry.register(makeReadRegistryTool(this.butlerRegistry));
    this.toolRegistry.register(makeUpdateRegistryTool(this.butlerRegistry));
    this.toolRegistry.register(makeAnalyzeTaskTool(() => provider, this.butlerRegistry));

    // Register channel binding tools
    if (router) {
      this.toolRegistry.register(makeChannelBindTool(router, groupManager));
      this.toolRegistry.register(makeChannelUnbindTool(router));
    }

    // Register group communication tools
    this.toolRegistry.register(makeGroupSpeakTool((gid) => groupManager.getContext(gid)));
    this.toolRegistry.register(makeTalkCreateTool((gid) => groupManager.getContext(gid)));
    this.toolRegistry.register(makeTalkSendTool((gid) => groupManager.getContext(gid)));
    this.toolRegistry.register(makeTalkReadTool((gid) => groupManager.getContext(gid)));

    // Re-create conversation loop with updated tools
    const perm = new PermissionEnforcer({ mode: "full-access" }, undefined, this.paths.workspaceDir);
    const executor = new ToolExecutor(this.toolRegistry, perm);
    this.conversationLoop = new ConversationLoop({
      agentConfig: {
        name: config.name,
        role: config.role,
        systemPrompt: config.systemPrompt,
        model: config.model,
      },
      provider,
      tools: this.toolRegistry.listDefinitions(),
      toolExecutor: executor,
      agentId: config.id,
      sessionId: "butler",
      workingDir: this.paths.workspaceDir,
    });

    // Register self
    if (!registry.get(config.id)) {
      registry.register(this);
    }
  }
}
