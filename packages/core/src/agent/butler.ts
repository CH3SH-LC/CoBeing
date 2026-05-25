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
import type { GroupManager } from "../group/manager.js";
import { ConversationLoop } from "../conversation/conversation-loop.js";
import { PermissionEnforcer } from "../tools/permission.js";
import { ToolExecutor } from "../tools/executor.js";
import { makeGroupMembersTool, makeTalkCreateTool, makeTalkSendTool, makeTalkReadTool } from "../tools/group-tools.js";
import { ButlerRegistry } from "./butler-registry.js";
import { WorkflowEngine } from "../workflow/engine.js";
import { createLogger, rmDirRecursive, addAgentToRegistry, removeAgentFromRegistry, updateGroupMembers } from "@cobeing/shared";
import { DockerSandbox } from "../tools/sandbox/docker-sandbox.js";
import { makeTodoAddTool, makeTodoListTool, makeTodoCompleteTool, makeTodoRemoveTool, makeTodoReviewTool } from "../todo/tools.js";

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
        permissions: { mode: "workspace-readwrite" },
        sandbox: sandboxConfig,
        tools: ["bash", "read-file", "write-file", "edit-file", "glob", "grep", "web-fetch", "agent-message"],
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
        permissions: { mode: "workspace-readwrite" },
        sandbox: sandboxConfig,
        tools: ["bash", "read-file", "write-file", "edit-file", "glob", "grep", "web-fetch", "agent-message"],
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
      agent.injectAgentMessageTool(registry);
      // Set up provider fallback
      const runtime = (globalThis as any).__cobeingRuntime;
      if (runtime?.providersMap) {
        agent.setAllProviders(runtime.providersMap);
      }

      // 更新 master registry
      const dataRoot = (globalThis as any).__cobeingDataRoot || "data";
      addAgentToRegistry(dataRoot, {
        id, name, role,
        status: "active",
        createdAt: new Date().toISOString(),
      });

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

function makeDestroyAgentTool(
  registry: AgentRegistry,
  butlerRegistry: ButlerRegistry,
  groupManager: GroupManager,
  dataRoot: string,
): Tool {
  return {
    name: "butler-destroy-agent",
    description: "从系统中完全移除一个 Agent：退出所有群组、释放资源、删除本地数据。内置 Agent（butler/host）不可销毁。",
    parameters: {
      type: "object",
      properties: { agentId: { type: "string", description: "Agent ID" } },
      required: ["agentId"],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const id = params.agentId as string;

      if (id === "butler" || id === "host") {
        return { toolCallId: "", content: `无法销毁内置 Agent: ${id}`, isError: true };
      }

      const agent = registry.get(id);
      if (!agent) return { toolCallId: "", content: `未找到 Agent: ${id}`, isError: true };

      // 1. 级联：从所有所属群组中移除
      const affectedGroups = groupManager.getGroupsForAgent(id);
      for (const g of affectedGroups) {
        try {
          g.removeMember(id);
          // 同步 registry members（registry 优先于 config.json）
          updateGroupMembers(dataRoot, g.id, g.config.members);
          groupManager.saveGroup(g.id);
          g.postMessage("system", `[系统] 成员 ${agent.name} 已被销毁，已从群组移除。`);
          log.info("Removed %s from group %s", id, g.id);
        } catch (e: any) {
          log.error("Failed to remove %s from group %s: %s", id, g.id, e.message);
        }
      }

      // 2. 释放资源
      try {
        await agent.dispose();
      } catch (e: any) {
        log.error("Failed to dispose agent %s: %s", id, e.message);
      }

      // 3. 从注册表移除
      registry.unregister(id);
      removeAgentFromRegistry(dataRoot, id);
      butlerRegistry.unregisterAgent(id);

      // 4. 删除本地数据
      const agentPaths = AgentPaths.forAgent(id, dataRoot);
      try {
        rmDirRecursive(agentPaths.directory);
        log.info("Deleted agent data: %s", agentPaths.directory);
      } catch (e: any) {
        log.error("Failed to delete agent data %s: %s", agentPaths.directory, e.message);
      }

      // 5. 广播事件
      const ws = (globalThis as any).__cobeingWSServer;
      if (ws) {
        ws.broadcast({ type: "agent_destroyed", payload: { agentId: id } });
        ws.broadcastState();
      }

      // 6. 返回影响摘要
      const groupList = affectedGroups.map(g => g.config.name).join("、") || "无";
      return {
        toolCallId: "",
        content: `已销毁 Agent "${agent.name}" (${id})。\n退出群组: ${groupList}\n数据目录已清理。`,
      };
    },
  };
}

function makeCreateGroupTool(groupManager: GroupManager, butlerRegistry: ButlerRegistry, registry: AgentRegistry): Tool {
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

      // 为初始成员注入群组通信工具
      for (const memberId of members) {
        const agent = registry.get(memberId);
        if (agent) {
          agent.injectGroupTools((gid) => groupManager.get(gid));
        }
      }

      butlerRegistry.registerGroup({
        id,
        name: params.name as string,
        members,
      });

      // 唤醒群主与用户对接（不唤醒组员）
      const memberNames = members.map((m: string) => {
        const a = registry.get(m);
        return a?.name ?? m;
      }).join("、");
      group.postMessage("system", `@host 新群组"${params.name}"已创建，成员包括：${memberNames}。请与用户对接，明确任务目标和分工方案。`);

      return { toolCallId: "", content: `已创建群组 ${group.config.name} (ID: ${id})` };
    },
  };
}

function makeDestroyGroupTool(groupManager: GroupManager, butlerRegistry: ButlerRegistry): Tool {
  return {
    name: "butler-destroy-group",
    description: "解散一个群组：通知所有成员、释放资源、删除群组数据。",
    parameters: {
      type: "object",
      properties: { groupId: { type: "string", description: "群组 ID" } },
      required: ["groupId"],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const id = params.groupId as string;
      const group = groupManager.get(id);
      if (!group) return { toolCallId: "", content: `未找到群组: ${id}`, isError: true };

      const groupName = group.config.name;
      const memberCount = group.config.members.length;
      const memberNames = group.config.members.map(m => {
        const agent = (globalThis as any).__cobeingAgentRegistry?.get?.(m);
        return agent?.name ?? m;
      }).join("、");

      // 1. 发送解散通知
      try {
        group.postMessage("system", `[系统] 群组 "${groupName}" 已被管家解散。成员: ${memberNames}。相关文件已清理。`);
      } catch {}

      // 2. 释放资源（关闭 GroupDB 等）
      groupManager.delete(id);
      butlerRegistry.unregisterGroup(id);

      // 3. 广播事件
      const ws = (globalThis as any).__cobeingWSServer;
      if (ws) {
        ws.broadcast({ type: "group_destroyed", payload: { groupId: id } });
        ws.broadcastState();
      }

      return {
        toolCallId: "",
        content: `已解散群组 "${groupName}" (${id})。\n前成员 (${memberCount} 人): ${memberNames}\n群组数据已清理。`,
      };
    },
  };
}

function makeBindWorkspaceTool(registry: AgentRegistry): Tool {
  return {
    name: "butler-bind-workspace",
    description: "将 Agent 的工作目录绑定到外部文件夹。Agent 的文件操作（读/写/bash）将在绑定目录执行，但核心文件（SOUL/CHARACTER/JOB/memory）仍保留在原位置。传入空路径可解绑。",
    parameters: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "目标 Agent ID" },
        path: { type: "string", description: "要绑定的外部目录路径（绝对路径）。留空或填 'default' 可解绑恢复默认工作区。" },
      },
      required: ["agentId"],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const agentId = params.agentId as string;
      const agent = registry.get(agentId);
      if (!agent) return { toolCallId: "", content: `未找到 Agent: ${agentId}`, isError: true };

      const rawPath = (params.path as string)?.trim();
      let bindPath: string | null = null;

      if (!rawPath || rawPath === "default" || rawPath === "") {
        // 解绑
        agent.clearBindings();
        return {
          toolCallId: "",
          content: `已解绑 ${agent.name} 的外部工作目录，恢复默认工作区: ${agent.effectiveWorkspace}`,
        };
      }

      // 验证路径
      const fs = await import("node:fs");
      const path = await import("node:path");
      const resolved = path.resolve(rawPath);
      if (!fs.existsSync(resolved)) {
        return { toolCallId: "", content: `绑定目录不存在: ${resolved}`, isError: true };
      }

      agent.addBinding({ path: resolved, mode: "readwrite" });
      return {
        toolCallId: "",
        content: `已将 ${agent.name} 绑定到外部工作目录:\n绑定路径: ${resolved}\n核心文件仍在: ${(agent as any).paths.directory}`,
      };
    },
  };
}

function makeListTool(registry: AgentRegistry, groupManager: GroupManager): Tool {
  return {
    name: "butler-list",
    description: "列出所有 Agent 和群组，含 Agent 运行状态（空闲/忙碌中/异常）",
    parameters: { type: "object", properties: {} },
    async execute(_params, _context: ToolContext): Promise<ToolResult> {
      const agents = registry.list().map(a => {
        const st = a.getStatus();
        const statusLabel = st === "running" ? "忙碌中" : st === "error" ? "异常" : "空闲";
        return `  - ${a.name} (${a.id}) [${statusLabel}]`;
      }).join("\n");
      const groups = groupManager.list().map(g =>
        `  - ${g.config.name} (${g.id}) [${g.config.members.length} 成员]`
      ).join("\n");
      return {
        toolCallId: "",
        content: `## Agent 列表\n${agents || "  (无)"}\n\n## 群组列表\n${groups || "  (无)"}`,
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

function makeAddToGroupTool(groupManager: GroupManager, butlerRegistry: ButlerRegistry, registry: AgentRegistry): Tool {
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

      // 为新成员注入群组通信工具
      const agent = registry.get(params.agentId as string);
      if (agent) {
        agent.injectGroupTools((gid) => groupManager.get(gid));
      }

      // 更新 master registry + 持久化
      updateGroupMembers((globalThis as any).__cobeingDataRoot || "data", params.groupId as string, group.config.members);
      groupManager.saveGroup(params.groupId as string);

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

// ---- butler-check-group ----

function makeCheckGroupTool(groupManager: GroupManager): Tool {
  return {
    name: "butler-check-group",
    description: "检查群组进展：读取 PROGRESS.md 和 TODO 状态，返回结构化报告。当用户询问群组进展时调用。",
    parameters: {
      type: "object",
      properties: {
        groupId: { type: "string", description: "群组 ID" },
      },
      required: ["groupId"],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const groupId = params.groupId as string;
      const group = groupManager.get(groupId);
      if (!group) return { toolCallId: "", content: `未找到群组: ${groupId}`, isError: true };

      const parts: string[] = [];
      parts.push(`## 群组进展报告: ${group.config.name}`);

      // 1. PROGRESS.md
      const progressContent = group.workspace.readProgress() ?? "";
      if (progressContent) {
        const preview = progressContent.slice(0, 1500);
        parts.push(`### PROGRESS.md\n${preview}${progressContent.length > 1500 ? "\n...(已截断)" : ""}`);
      } else {
        parts.push("### PROGRESS.md\n暂无进展记录");
      }

      // 2. TODO 状态
      const scanner = groupManager.getScanner?.(groupId);
      if (scanner) {
        const store = scanner.getStore();
        const pending = store.list("pending");
        const inProgress = store.list("in-progress");
        const completed = store.list("completed");
        parts.push("### TODO 状态");
        parts.push(`- 待处理: ${pending.length} 项`);
        if (inProgress.length > 0) parts.push(`- 进行中: ${inProgress.length} 项`);
        parts.push(`- 已完成: ${completed.length} 项`);
        const total = pending.length + inProgress.length + completed.length;
        if (total > 0) parts.push(`- 完成率: ${Math.round((completed.length / total) * 100)}%`);
        if (pending.length > 0) {
          parts.push("待处理任务:");
          for (const t of pending.slice(0, 10)) {
            parts.push(`  - [${t.id}] ${t.title}`);
          }
          if (pending.length > 10) parts.push(`  ... 还有 ${pending.length - 10} 项`);
        }
      } else {
        parts.push("### TODO 状态\n无法获取");
      }

      // 3. 成员
      const profiles = group.getMemberProfiles();
      if (profiles.length > 0) {
        parts.push(`### 成员 (${profiles.length})`);
        for (const m of profiles) parts.push(`  - ${m.name || m.id}`);
      }

      return { toolCallId: "", content: parts.join("\n\n") };
    },
  };
}

// ---- butler-modify-agent ----

function makeModifyAgentTool(registry: AgentRegistry): Tool {
  return {
    name: "butler-modify-agent",
    description:
      "修改已有 Agent 的核心文件（SOUL/CHARACTER/JOB/BOOTSTRAP/TOOLS）。传入新内容即覆盖写入，不传 content 则返回当前文件内容供查阅。",
    parameters: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "要修改的 Agent ID" },
        file: {
          type: "string",
          description: "要修改的文件名（不含 .md 后缀）",
          enum: ["SOUL", "CHARACTER", "JOB", "BOOTSTRAP", "TOOLS"],
        },
        content: {
          type: "string",
          description: "新的文件内容（传入则覆盖写入，不传则返回当前内容供查阅）",
        },
      },
      required: ["agentId", "file"],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const agentId = params.agentId as string;
      const file = params.file as string;
      const content = params.content as string | undefined;

      const agent = registry.get(agentId);
      if (!agent) {
        return { toolCallId: "", content: `未找到 Agent: ${agentId}`, isError: true };
      }

      const filePath = path.join(agent.paths.directory, `${file}.md`);

      if (content !== undefined) {
        // 写入模式
        fs.writeFileSync(filePath, content, "utf-8");
        log.info("Butler modified %s for agent %s", file, agentId);
        return { toolCallId: "", content: `已更新 ${agent.name} (${agentId}) 的 ${file}.md` };
      } else {
        // 读取模式
        if (!fs.existsSync(filePath)) {
          return { toolCallId: "", content: `${file}.md 不存在于 ${agent.name} (${agentId})`, isError: true };
        }
        const current = fs.readFileSync(filePath, "utf-8");
        return { toolCallId: "", content: `=== ${agent.name} 的 ${file}.md ===\n\n${current}` };
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
    const bsDataRoot = path.dirname(path.dirname(this.paths.directory));
    this.toolRegistry.register(makeCreateAgentTool(registry, () => provider, this.butlerRegistry, providerResolver));
    this.toolRegistry.register(makeDestroyAgentTool(registry, this.butlerRegistry, groupManager, bsDataRoot));
    this.toolRegistry.register(makeCreateGroupTool(groupManager, this.butlerRegistry, registry));
    this.toolRegistry.register(makeDestroyGroupTool(groupManager, this.butlerRegistry));
    this.toolRegistry.register(makeBindWorkspaceTool(registry));
    this.toolRegistry.register(makeListTool(registry, groupManager));
    this.toolRegistry.register(makeRunGroupTool(groupManager, this.butlerRegistry));
    this.toolRegistry.register(makeAddToGroupTool(groupManager, this.butlerRegistry, registry));

    // 新增管家工具
    this.toolRegistry.register(makeReadRegistryTool(this.butlerRegistry));
    this.toolRegistry.register(makeUpdateRegistryTool(this.butlerRegistry));
    this.toolRegistry.register(makeModifyAgentTool(registry));
    this.toolRegistry.register(makeCheckGroupTool(groupManager));

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
    this.toolRegistry.register(makeTodoCompleteTool(dataRoot, (gid) => groupManager.getGroupTodoStore?.(gid), (gid) => groupManager.getScanner?.(gid)));
    this.toolRegistry.register(makeTodoRemoveTool(dataRoot, (gid) => groupManager.getGroupTodoStore?.(gid)));
    this.toolRegistry.register(makeTodoReviewTool(dataRoot, (gid) => groupManager.getGroupTodoStore?.(gid)));

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
      workingDir: this.effectiveWorkspace,
      maxToolRounds: appConfig?.core?.butlerMaxToolRounds ?? config.maxToolRounds,
    });

    // Register self
    if (!registry.get(config.id)) {
      registry.register(this);
    }
  }
}
