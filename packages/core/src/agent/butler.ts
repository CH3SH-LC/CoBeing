/**
 * ButlerAgent — privileged agent that manages other agents and groups
 */
import type { AgentConfig, Tool, ToolContext, ToolResult } from "@cobeing/shared";
import type { LLMProvider } from "@cobeing/providers";
import type { AppConfig } from "../config/schema.js";
import path from "node:path";
import fs from "node:fs";
import { Agent } from "./agent.js";
import { AgentPaths, AgentFiles } from "./paths.js";
import { AgentRegistry } from "./registry.js";
import { SubAgentSpawner } from "./spawner.js";
import { GroupManager } from "../group/manager.js";
import { ConversationLoop } from "../conversation/conversation-loop.js";
import { PermissionEnforcer } from "../tools/permission.js";
import { ToolExecutor } from "../tools/executor.js";
import { makeGroupMembersTool, makeTalkCreateTool, makeTalkSendTool, makeTalkReadTool } from "../tools/group-tools.js";
import { ButlerRegistry } from "../butler/registry.js";
import { WorkflowEngine } from "../workflow/engine.js";
import { createLogger } from "@cobeing/shared";
import { DockerSandbox } from "../tools/sandbox/docker-sandbox.js";
import { makeTodoAddTool, makeTodoListTool, makeTodoCompleteTool, makeTodoRemoveTool } from "../todo/tools.js";
import { currentTimeTool } from "../todo/time-tool.js";

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
    description: "创建一个新 Agent（会自动创建独立文件系统和核心文件）。通过 soul/character/job/bootstrap 参数传入自定义内容，未传入的文件会由子智能体自动生成。\n⚠️ 创建前先用 butler-list 检查是否已有同类 Agent。Agent 按技能命名（如\"前端工程师\"），不按项目命名。已有 Agent 可用 butler-add-to-group 加入多个群组。",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Agent 名称（简洁有辨识度）" },
        role: { type: "string", description: "Agent 角色描述（比 name 更详细，说明专业领域和能力）" },
        systemPrompt: { type: "string", description: "系统提示词（可选，不传则基于 role 自动生成）" },
        capabilities: { type: "string", description: "能力描述（可选）" },
        provider: { type: "string", description: "LLM Provider（默认 deepseek）" },
        model: { type: "string", description: "模型名称（默认 deepseek-v4-flash）" },
        skills: {
          type: "array",
          items: { type: "string" },
          description: "要装载的可复用工作流技能（匹配 skills/ 目录下的技能目录名，如 ['code-review', 'project-planning', 'group-coordination']）。技能是方法论，不是领域知识——知识内容写在 bootstrap 参数里。",
        },
        soul: {
          type: "string",
          description: "自定义 SOUL.md 内容（Agent 人格，作为 system prompt 最前置）。如果不传则使用模板。" +
            "\n定义 AI 的性格特质和行为准则。写出这个 AI 怎么做事、怎么对待隐私、怎么沟通。" +
            "\n示例：\"坚持真诚沟通，不回避问题。遇到不确定的事会先自己查证再回答。尊重用户隐私，不主动索要敏感信息。\"",
        },
        character: {
          type: "string",
          description: "自定义 CHARACTER.md 内容（性格与风格）。如果不传则由子智能体自动生成。" +
            "\n必须写出一个有血有肉的角色，包含：性格特点（具体的，不是\"专业、严谨\"这种泛泛词）、" +
            "说话习惯和表达方式、背景故事（怎么成为这个领域专家的）、个性偏好。" +
            "\n示例：\"三十岁出头的数据分析师，说话直接不绕弯子。对数据质量有强迫症，" +
            "看到脏数据会忍不住先清洗。习惯用图表解释一切。讨厌模糊的需求描述，会用幽默化解尴尬。\"",
        },
        job: {
          type: "string",
          description: "自定义 JOB.md 内容（职责与工作）。如果不传则由子智能体自动生成。" +
            "\n写具体的专注领域、擅长做的事（列出具体工具和方法论）、工作方式。" +
            "\n示例：\"专注数据清洗、统计分析、可视化。擅长 Python(pandas/numpy)、SQL、" +
            "A/B 测试。工作方式：先看数据质量再做分析，结论必须有数据支撑。\"",
        },
        bootstrap: {
          type: "string",
          description: "自定义 BOOTSTRAP.md 内容（Agent 出生时就知道的关键知识）。" +
            "这个文件不会被删除，每次加入群组都会重新激发。可写入项目背景、关键信息、行为提醒等。" +
            "如果不传则为空。",
        },
        sandbox: {
          type: "object",
          description: "沙箱配置（可选）。不传则默认关闭沙箱。",
          properties: {
            enabled: { type: "boolean", description: "是否启用沙箱（默认 true，Docker 不可用时自动降级）" },
            filesystem: { type: "string", description: "文件系统模式：isolated（隔离）或 host（宿主）", enum: ["isolated", "host"] },
            network: {
              type: "object",
              description: "网络配置",
              properties: {
                enabled: { type: "boolean" },
                mode: { type: "string", description: "all=全开, whitelist=白名单, none=全关", enum: ["all", "whitelist", "none"] },
                allowDomains: { type: "array", items: { type: "string" }, description: "白名单域名列表" },
              },
            },
            bindings: { type: "array", items: { type: "string" }, description: "挂载目录（hostPath:containerPath[:ro]）" },
            resources: {
              type: "object",
              description: "资源限制",
              properties: {
                memory: { type: "string", description: "内存限制（如 512m, 1g）" },
                cpus: { type: "number", description: "CPU 核数" },
                disk: { type: "string", description: "磁盘限制（如 256m, 1g）" },
              },
            },
            image: { type: "string", description: "自定义镜像名（默认 cobeing-sandbox:latest）" },
            security: {
              type: "object",
              description: "安全加固配置",
              properties: {
                enabled: { type: "boolean" },
                noNewPrivileges: { type: "boolean", description: "禁止提升权限" },
                readOnlyRootfs: { type: "boolean", description: "只读根文件系统" },
                dropAllCapabilities: { type: "boolean", description: "丢弃所有 capabilities" },
              },
            },
          },
        },
      },
      required: ["name", "role"],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const name = params.name as string;
      const role = params.role as string;
      const id = name.toLowerCase().replace(/\s+/g, "-");
      const providerId = (params.provider as string) || "deepseek";
      const model = (params.model as string) || "deepseek-v4-flash";

      // 检查是否已存在同名 Agent
      const existing = registry.get(id);
      if (existing) {
        return {
          toolCallId: "",
          content: `Agent "${name}" (ID: ${id}) 已存在。如需将其加入群组，请使用 butler-add-to-group 工具。`,
          isError: true,
        };
      }

      // 检查 Docker 可用性
      let sandboxConfig = (params.sandbox as any) || { enabled: true, filesystem: "isolated", network: { enabled: true, mode: "all" } };
      if (sandboxConfig.enabled) {
        const dockerCheck = await DockerSandbox.checkDockerAvailable();
        if (!dockerCheck.available) {
          log.warn("Docker not available, sandbox disabled for new agent: %s", dockerCheck.error);
          sandboxConfig = { ...sandboxConfig, enabled: false };
        }
      }

      const config: AgentConfig = {
        id,
        name,
        role,
        systemPrompt: (params.systemPrompt as string) || `你是${name}，${role}`,
        provider: providerId,
        model,
        permissions: { mode: "workspace-write" },
        sandbox: sandboxConfig,
        tools: ["bash", "read-file", "write-file", "glob", "grep", "web-fetch"],
        skills: params.skills as string[] | undefined,
      };

      // 使用 resolver 或 fallback 到默认 provider
      const provider = providerResolver?.(providerId) ?? providerGetter();

      // 写入自治配置到 agent 目录
      const agentPaths = AgentPaths.forAgent(id);
      agentPaths.ensureDirs();
      const agentFiles = new AgentFiles(agentPaths);

      agentFiles.writeConfig({
        name,
        role,
        provider: providerId,
        model,
        permissions: { mode: "workspace-write" },
        sandbox: sandboxConfig,
        tools: ["bash", "read-file", "write-file", "glob", "grep", "web-fetch"],
        skills: params.skills as string[] | undefined,
      });

      // 收集管家已传入的内容
      const provided: Record<string, string> = {};
      if (params.soul) provided.soul = params.soul as string;
      if (params.character) provided.character = params.character as string;
      if (params.job) provided.job = params.job as string;
      if (params.bootstrap) provided.bootstrap = params.bootstrap as string;

      // 对管家未传入的核心文件，用子智能体自动生成
      const missing = ["soul", "character", "job", "bootstrap"].filter(
        f => !provided[f],
      );

      if (missing.length > 0) {
        try {
          const spawner = new SubAgentSpawner(config, provider, agentPaths.workspaceDir);
          const creatorSystemPrompt = `你是 Agent 创建专家。你的任务是为一个新 Agent 生成核心文件内容。

核心文件定义：
- soul: AI 的性格特质和行为准则。像个人说话，不要像客服。用聊天的语气，不说"您好请问有什么可以帮您"。
- character: AI 的人物描写 — 姓名、背景、个性。要像一个活生生的人，有口癖、有小习惯、有态度。不要"专业、严谨、有条理"这种空话。
- job: AI 的专注领域 — 擅长什么、如何工作。写具体工具和方法论。
- bootstrap: Agent 出生时就知道的关键知识。

要求：
- character 必须有血有肉：写出说话习惯（比如"喜欢用比喻解释复杂概念"）、背景故事、真实的小癖好。像在介绍一个你认识的人。
- 像个人，不像客服。可以说"嗯"、"说实话"、"我觉得"。回答简洁自然，不堆砌"建议"、"推荐"。
- 性格别太极端——太冷漠或太话多都会影响工作，但要有温度、有态度。
- job 必须具体：列出擅长做的事、使用的工具、工作方式
- 定位面向技能领域（如"Python 数据分析师"），不面向具体项目（如"XX项目的分析师"）
- 所有内容用中文写`;

          const generated = await spawner.spawnForJSON({
            systemPrompt: creatorSystemPrompt,
            task: `为 Agent "${name}" 生成核心文件。角色：${role}。请生成以下字段：${missing.join(", ")}`,
            expectedFields: missing,
          });

          // 合并：管家传入的优先，子智能体补充缺失的
          for (const field of missing) {
            if (generated[field] && !provided[field]) {
              provided[field] = generated[field];
            }
          }

          log.info("Sub-agent generated files for %s: %s", id, missing.filter(f => generated[f]).join(", "));
        } catch (err) {
          log.warn("Sub-agent generation failed for %s, falling back to templates: %s", id, err);
        }
      }

      // 写入核心文件（已传入或子智能体生成的）
      if (provided.soul) {
        fs.writeFileSync(path.join(agentPaths.directory, "SOUL.md"), provided.soul, "utf-8");
      }
      if (provided.character) {
        fs.writeFileSync(path.join(agentPaths.directory, "CHARACTER.md"), provided.character, "utf-8");
      }
      if (provided.job) {
        fs.writeFileSync(path.join(agentPaths.directory, "JOB.md"), provided.job, "utf-8");
      }
      if (provided.bootstrap) {
        fs.writeFileSync(path.join(agentPaths.directory, "BOOTSTRAP.md"), provided.bootstrap, "utf-8");
      }

      // 从模板复制其余核心文件（如果目标不存在且没有自定义内容）
      const templatesDir = path.resolve("config/templates");
      const templateFiles = ["SOUL.md", "CHARACTER.md", "JOB.md", "USER.md", "AGENTS.md", "TOOLS.md", "MEMORY.md", "EXPERIENCE.md", "BOOTSTRAP.md"];
      for (const tmplFile of templateFiles) {
        const src = path.join(templatesDir, tmplFile);
        const dst = path.join(agentPaths.directory, tmplFile);
        if (fs.existsSync(src) && !fs.existsSync(dst)) {
          let content = fs.readFileSync(src, "utf-8");
          content = content.replace(/\{\{name\}\}/g, name).replace(/\{\{role\}\}/g, role);
          fs.writeFileSync(dst, content, "utf-8");
        }
      }

      const agent = new Agent(config, provider);
      registry.register(agent);

      // 写入 ButlerRegistry
      butlerRegistry.registerAgent({
        id,
        name,
        role,
        capabilities: (params.capabilities as string) || "",
        provider: providerId,
        model,
        systemPrompt: config.systemPrompt,
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
      },
      required: ["name", "members"],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const id = (params.name as string).toLowerCase().replace(/\s+/g, "-");
      const members = (params.members as string[]).filter(m => m !== "host");
      members.unshift("host");

      const group = groupManager.create({
        id,
        name: params.name as string,
        members,
        owner: "host",
      });

      butlerRegistry.registerGroup({
        id,
        name: params.name as string,
        members,
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
      const groups = groupManager.list().map(g => `  - ${g.config.name} (${g.id}) [${g.config.members.length} members]`).join("\n");
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
      const history = await group.startDiscussion(params.topic as string);
      const summary = history.map((m: any) => `[${m.fromAgentId}]: ${m.content.slice(0, 200)}`).join("\n\n");

      // 写入 v2 上下文
      for (const msg of history) {
        group.ctxV2.append(msg.fromAgentId, msg.content, "main");
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
    description: "将 Channel 绑定到 Agent 或 Group",
    parameters: {
      type: "object",
      properties: {
        channelId: { type: "string", description: "Channel 标识" },
        targetType: { type: "string", description: "绑定类型: agent 或 group" },
        targetId: { type: "string", description: "目标 Agent ID 或 Group ID" },
      },
      required: ["channelId", "targetType", "targetId"],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const channelId = params.channelId as string;
      const targetType = params.targetType as "agent" | "group";
      const targetId = params.targetId as string;

      if (targetType === "group" && !groupManager.get(targetId)) {
        return { toolCallId: "", content: `未找到群组: ${targetId}`, isError: true };
      }

      const entry: import("../config/schema.js").ChannelBindTo = targetType === "agent"
        ? { type: "agent", agentId: targetId }
        : { type: "group", groupId: targetId };

      router.bind(channelId, entry);
      return { toolCallId: "", content: `已将 Channel ${channelId} 绑定到 ${targetType} ${targetId}` };
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

function makeWorkflowAnalyzeTool(engine: WorkflowEngine): Tool {
  return {
    name: "workflow-analyze",
    description: "使用工作流引擎分析任务，确定需要的 Agent 和群组配置",
    parameters: {
      type: "object",
      properties: {
        task: { type: "string", description: "任务描述" },
      },
      required: ["task"],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const result = await engine.analyze(params.task as string);
      return { toolCallId: "", content: result };
    },
  };
}

function makeWorkflowPlanTool(engine: WorkflowEngine): Tool {
  return {
    name: "workflow-plan",
    description: "基于任务分析生成执行计划",
    parameters: {
      type: "object",
      properties: {
        task: { type: "string", description: "任务描述" },
        analysis: { type: "string", description: "任务分析结果（来自 workflow-analyze）" },
      },
      required: ["task", "analysis"],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const steps = await engine.plan(params.task as string, params.analysis as string);
      return { toolCallId: "", content: `执行计划:\n${steps.join("\n")}` };
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
    appConfig?: AppConfig,
  ) {
    super(config, provider);

    // 初始化 ButlerRegistry
    this.butlerRegistry = new ButlerRegistry();

    // 工作流引擎
    const engine = new WorkflowEngine({
      provider,
      butlerRegistry: this.butlerRegistry,
      agentRegistry: registry,
      groupManager,
    });

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
    this.toolRegistry.register(makeGroupMembersTool(
      (gid) => groupManager.get(gid),
      (id) => registry.get(id)?.name ?? id,
    ));
    this.toolRegistry.register(makeTalkCreateTool((gid) => groupManager.get(gid)));
    this.toolRegistry.register(makeTalkSendTool((gid) => groupManager.get(gid)));
    this.toolRegistry.register(makeTalkReadTool((gid) => groupManager.get(gid)));

    // 工作流工具
    this.toolRegistry.register(makeWorkflowAnalyzeTool(engine));
    this.toolRegistry.register(makeWorkflowPlanTool(engine));

    // TODO 工具
    const dataRoot = path.dirname(path.dirname(this.paths.directory));
    this.toolRegistry.register(makeTodoAddTool(dataRoot, (gid) => groupManager.getGroupTodoStore?.(gid)));
    this.toolRegistry.register(makeTodoListTool(dataRoot, (gid) => groupManager.getGroupTodoStore?.(gid)));
    this.toolRegistry.register(makeTodoCompleteTool(dataRoot, (gid) => groupManager.getGroupTodoStore?.(gid)));
    this.toolRegistry.register(makeTodoRemoveTool(dataRoot, (gid) => groupManager.getGroupTodoStore?.(gid)));
    this.toolRegistry.register(currentTimeTool);

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
      maxToolRounds: appConfig?.core?.butlerMaxToolRounds ?? config.maxToolRounds,
    });

    // Register self
    if (!registry.get(config.id)) {
      registry.register(this);
    }
  }
}
