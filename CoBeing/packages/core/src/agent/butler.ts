/**
 * ButlerAgent — privileged agent that manages other agents and groups
 */
import type { AgentConfig, Tool, ToolContext, ToolResult } from "@cobeing/shared";
import type { LLMProvider } from "@cobeing/providers";
import type { AppConfig } from "../config/schema.js";
import path from "node:path";
import fs from "node:fs";
import { Agent } from "./agent.js";
import { AgentPaths, AgentFiles, createDefaultCapabilityCard } from "./paths.js";
import { AgentRegistry } from "./registry.js";
import { runAgentCreator } from "./tool-agent/creator.js";
import type { GroupManager } from "../group/manager.js";
import { dispatchButlerTask, type ButlerDispatchDeps, type ButlerDispatchReceipt } from "../butler/dispatch.js";
import { ConversationLoop } from "../conversation/conversation-loop.js";
import { PermissionEnforcer } from "../tools/permission.js";
import { ToolExecutor } from "../tools/executor.js";
import { makeGroupMembersTool, makeTalkCreateTool, makeTalkSendTool, makeTalkReadTool, makeGroupSendTool } from "../tools/group-tools.js";
import { ButlerRegistry } from "./butler-registry.js";
import { WorkflowEngine } from "../workflow/engine.js";
import { createLogger, addAgentToRegistry, markDirectoryForDeletion, removeAgentFromRegistry, updateGroupMembers } from "@cobeing/shared";
import { DockerSandbox } from "../tools/sandbox/docker-sandbox.js";
import { makeTodoAddTool, makeTodoListTool, makeTodoCompleteTool, makeTodoRemoveTool, makeTodoReviewTool } from "../todo/tools.js";
import {
  makeGlobalTodoAddTool,
  makeGlobalTodoListTool,
  makeGlobalTodoUpdateTool,
  makeGlobalTodoLinkExecutionTool,
  makeGlobalTodoContinueTool,
} from "../todo/global-tools.js";

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
    description: "创建一个新 Agent（会自动创建独立文件系统和核心文件）。通过 character/job 参数传入自定义内容，未传入的文件会由子智能体自动生成。\n⚠️ 创建前先用 butler-list 检查是否已有同类 Agent。Agent 按技能命名（如\"前端工程师\"），不按项目命名。已有 Agent 可用 butler-add-to-group 加入多个群组。",
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
          description: "要装载的可复用工作流技能（匹配 skills/ 目录下的技能目录名，如 ['code-review', 'project-planning', 'group-coordination']）。技能是方法论，不是领域知识——领域知识写在 character/job 参数里。",
        },
        character: {
          type: "string",
          description: "自定义 CHARACTER.md 内容（人物形象：背景/外观/语言风格）。如果不传则由子智能体自动生成。",
        },
        job: {
          type: "string",
          description: "自定义 JOB.md 内容（工作范式：思考方式/工作流程/决策原则/输出规范）。如果不传则由子智能体自动生成。",
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
      if (params.character) provided.character = params.character as string;
      if (params.job) provided.job = params.job as string;

      // 对管家未传入的核心文件，用 AgentCreator ToolAgent 生成
      const missingFields = (["character", "job"] as const).filter(
        f => !provided[f],
      );

      if (missingFields.length > 0) {
        try {
          const result = await runAgentCreator(provider, model, {
            name,
            role,
            fields: [...missingFields],
          });

          for (const field of missingFields) {
            if (result.files[field] && !provided[field]) {
              provided[field] = result.files[field];
            }
          }

          log.info("AgentCreator generated files for %s: %s", id, missingFields.filter(f => result.files[f]).join(", "));
        } catch (err) {
          log.warn("AgentCreator generation failed for %s, falling back to templates: %s", id, err);
        }
      }

      // 写入核心文件（已传入或子智能体生成的）
      if (provided.character) {
        fs.writeFileSync(path.join(agentPaths.directory, "CHARACTER.md"), provided.character, "utf-8");
      }
      if (provided.job) {
        fs.writeFileSync(path.join(agentPaths.directory, "JOB.md"), provided.job, "utf-8");
      }

      // 从模板复制其余核心文件（如果目标不存在且没有自定义内容）
      const templatesDir = path.resolve("packages/core/src/templates/agent");
      const templateFiles = ["CHARACTER.md", "JOB.md", "AGENTS.md", "MEMORY.md", "EXPERIENCE.md"];
      for (const tmplFile of templateFiles) {
        const src = path.join(templatesDir, tmplFile);
        const dst = path.join(agentPaths.directory, tmplFile);
        if (fs.existsSync(src) && !fs.existsSync(dst)) {
          let content = fs.readFileSync(src, "utf-8");
          content = content.replace(/\{\{name\}\}/g, name).replace(/\{\{role\}\}/g, role);
          fs.writeFileSync(dst, content, "utf-8");
        }
      }
      agentFiles.writeCapability(createDefaultCapabilityCard({
        agentId: id,
        displayName: name,
        role,
        capabilities: params.capabilities as string | undefined,
        tools: config.tools,
        skills: params.skills as string[] | undefined,
      }));

      const agent = new Agent(config, provider);
      registry.register(agent);
      agent.injectAgentMessageTool(registry);
      // Set up provider fallback
      const runtime = (globalThis as any).__cobeing?.runtime;
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
        await agent.stopAndWait();
        await agent.dispose();
      } catch (e: any) {
        log.error("Failed to dispose agent %s: %s", id, e.message);
      }
      // 等待原生模块释放（Better-SQLite3 Windows 内存映射防护）
      await new Promise(r => setTimeout(r, 500));

      // 3. 从注册表移除
      registry.unregister(id);
      removeAgentFromRegistry(dataRoot, id);
      butlerRegistry.unregisterAgent(id);

      // 4. 安全删除：rename 目录（不触碰文件内容）
      const agentPaths = AgentPaths.forAgent(id, dataRoot);
      if (fs.existsSync(agentPaths.directory)) {
        const deletedDir = markDirectoryForDeletion(agentPaths.directory, { kind: "agent", id, reason: "butler-destroy-agent" });
        if (deletedDir) {
          log.info("Agent data renamed for cleanup: %s -> %s", agentPaths.directory, deletedDir);
        } else {
          log.warn("Agent data marked for deletion but still locked: %s", agentPaths.directory);
        }
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

      // 唤醒群主启动工作回合（不唤醒组员）
      const memberNames = members.map((m: string) => {
        const a = registry.get(m);
        return a?.name ?? m;
      }).join("、");
      group.postMessage("system", `@host 新群组"${params.name}"已创建，成员包括：${memberNames}。

作为群主，请启动首次工作回合：
1. 向用户自我介绍并确认群组定位和场景
2. 说明各成员的能力和职责范围
3. 询问用户当前是否有具体需求需要推进，还是先设置群组规则`);

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
    description: "将 Agent 的工作目录绑定到外部文件夹。Agent 的文件操作（读/写/bash）将在绑定目录执行，但核心文件（CHARACTER/JOB/memory）仍保留在原位置。传入空路径可解绑。",
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
      "修改已有 Agent 的核心文件（CHARACTER/JOB）。传入新内容即覆盖写入，不传 content 则返回当前文件内容供查阅。",
    parameters: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "要修改的 Agent ID" },
        file: {
          type: "string",
          description: "要修改的文件名（不含 .md 后缀）",
          enum: ["CHARACTER", "JOB"],
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

// ---- butler-find-agent ----

function makeFindAgentTool(registry: AgentRegistry, dataRoot: string, provider: LLMProvider, model: string): Tool {
  return {
    name: "butler-find-agent",
    description: "根据任务描述匹配最合适的 Agent。扫描所有 Agent 的 capability.json，用 LLM 匹配最佳人选。",
    parameters: {
      type: "object",
      properties: {
        taskDescription: { type: "string", description: "需要完成的任务描述" },
        requiredDomains: { type: "array", items: { type: "string" }, description: "需要的领域（可选）" },
        excludeAgentIds: { type: "array", items: { type: "string" }, description: "排除的 Agent ID（可选）" },
      },
      required: ["taskDescription"],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const taskDesc = params.taskDescription as string;
      const excludeIds = (params.excludeAgentIds as string[]) ?? [];

      const agentsDir = path.join(dataRoot, "agents");
      const coreAgentsDir = path.join(dataRoot, "coreagents");
      const capabilities: import("@cobeing/shared").AgentCapabilityCard[] = [];

      for (const dir of [agentsDir, coreAgentsDir]) {
        if (!fs.existsSync(dir)) continue;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (!entry.isDirectory() || excludeIds.includes(entry.name)) continue;
          const capPath = path.join(dir, entry.name, "capability.json");
          if (fs.existsSync(capPath)) {
            try {
              const card = JSON.parse(fs.readFileSync(capPath, "utf-8")) as import("@cobeing/shared").AgentCapabilityCard;
              if (card.agentId && card.domains?.length > 0) {
                capabilities.push(card);
              }
            } catch { /* skip malformed */ }
          }
        }
      }

      if (capabilities.length === 0) {
        return { toolCallId: "", content: "未找到任何有能力画像的 Agent。请先让管家为 Agent 创建能力画像。" };
      }

      const capsSummary = capabilities.map(c =>
        `- **${c.displayName}** (${c.agentId}): 领域=[${c.domains.join(", ")}], 擅长=[${c.strengths.join(", ")}]`
      ).join("\n");

      try {
        // Use synchronous chat for matching
        let text = "";
        for await (const chunk of provider.chat({
          model,
          messages: [
            { role: "system", content: "你是一个 Agent 匹配器。根据任务描述从候选 Agent 中选择最合适的。返回 JSON: { bestAgentId: string, confidence: number, reasoning: string, alternatives: string[] }" },
            { role: "user", content: `## 任务描述\n${taskDesc}\n\n## 候选 Agent\n${capsSummary}` },
          ],
          temperature: 0.1,
          maxTokens: 500,
        })) {
          if (chunk.type === "content" && chunk.content) text += chunk.content;
        }

        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const match = JSON.parse(jsonMatch[0]);
          const agent = capabilities.find(c => c.agentId === match.bestAgentId);
          return {
            toolCallId: "",
            content: `🎯 推荐 Agent: **${agent?.displayName ?? match.bestAgentId}**\n` +
              `匹配度: ${match.confidence ?? "N/A"}\n` +
              `理由: ${match.reasoning ?? "无"}\n` +
              `备选: ${(match.alternatives ?? []).join(", ") || "无"}`,
          };
        }
      } catch (e) {
        return { toolCallId: "", content: `找到 ${capabilities.length} 个有能力画像的 Agent，自动匹配失败: ${(e as Error).message}` };
      }

      return { toolCallId: "", content: "匹配完成" };
    },
  };
}

// ---- Butler tracked dispatch tools ----

function getButlerDispatchDeps(
  agentRegistry: AgentRegistry,
  groupManager: GroupManager,
  fallbackDataRoot: string,
): ButlerDispatchDeps | null {
  const runtime = (globalThis as any).__cobeing?.runtime;
  const dataRoot =
    runtime?.dataRoot
    ?? (globalThis as any).__cobeing?.dataRoot
    ?? (globalThis as any).__cobeingDataRoot
    ?? fallbackDataRoot;
  if (!runtime?.globalTodoStore || !runtime?.butlerTaskStore) {
    return null;
  }
  return {
    dataRoot,
    agentRegistry,
    groupManager,
    globalTodoStore: runtime.globalTodoStore,
    butlerTaskStore: runtime.butlerTaskStore,
    butlerBindingStore: runtime.butlerBindingStore,
    wsServer: runtime.wsServer ?? (globalThis as any).__cobeingWSServer,
  };
}

function formatDispatchReceipt(receipt: ButlerDispatchReceipt): string {
  return [
    "✅ 已创建可追踪管家任务",
    `Global TODO: ${receipt.globalTodo.id}`,
    `ButlerTask: ${receipt.butlerTaskId}`,
    `执行引用: ${receipt.executionRef.scope}/${receipt.executionRef.id}${receipt.executionRef.todoIds?.length ? ` (${receipt.executionRef.todoIds.join(", ")})` : ""}`,
  ].join("\n");
}

function makeDispatchToAgentTool(
  agentRegistry: AgentRegistry,
  groupManager: GroupManager,
  dataRoot: string,
): Tool {
  return {
    name: "butler-dispatch-to-agent",
    description: "将任务派发给指定 Agent，并自动创建 Global TODO、ButlerTask 和 Agent inbox 条目。",
    parameters: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "目标 Agent ID" },
        title: { type: "string", description: "任务标题" },
        goal: { type: "string", description: "任务目标和详细描述" },
        acceptance: { type: "string", description: "验收标准" },
        constraints: { type: "array", items: { type: "string" }, description: "约束条件" },
        notifyTarget: { type: "boolean", description: "是否立即通知目标 Agent，默认 true" },
      },
      required: ["agentId", "title", "goal"],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const agentId = params.agentId as string;
      const deps = getButlerDispatchDeps(agentRegistry, groupManager, dataRoot);
      if (!deps) {
        return { toolCallId: "", content: "Runtime 尚未挂载 Butler/Global TODO 存储，无法派发可追踪任务。", isError: true };
      }

      try {
        const receipt = await dispatchButlerTask(deps, {
          targetType: "agent",
          targetId: agentId,
          title: params.title as string,
          goal: params.goal as string,
          acceptance: params.acceptance as string | undefined,
          constraints: params.constraints as string[] | undefined,
          notifyTarget: params.notifyTarget as boolean | undefined,
        });
        return { toolCallId: "", content: formatDispatchReceipt(receipt) };
      } catch (e) {
        return { toolCallId: "", content: `派发失败: ${(e as Error).message}`, isError: true };
      }
    },
  };
}

function makeDispatchToGroupTool(
  agentRegistry: AgentRegistry,
  groupManager: GroupManager,
  dataRoot: string,
): Tool {
  return {
    name: "butler-dispatch-to-group",
    description: "将任务派发给指定群组，并自动创建 Global TODO、ButlerTask、群组 TODO 和管家绑定。",
    parameters: {
      type: "object",
      properties: {
        groupId: { type: "string", description: "目标群组 ID" },
        title: { type: "string", description: "任务标题" },
        goal: { type: "string", description: "任务目标和详细描述" },
        acceptance: { type: "string", description: "验收标准" },
        constraints: { type: "array", items: { type: "string" }, description: "约束条件" },
        responsibleAgentId: { type: "string", description: "群组内首要负责 Agent，默认 host" },
      },
      required: ["groupId", "title", "goal"],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const deps = getButlerDispatchDeps(agentRegistry, groupManager, dataRoot);
      if (!deps) {
        return { toolCallId: "", content: "Runtime 尚未挂载 Butler/Global TODO 存储，无法派发可追踪任务。", isError: true };
      }

      try {
        const receipt = await dispatchButlerTask(deps, {
          targetType: "group",
          targetId: params.groupId as string,
          title: params.title as string,
          goal: params.goal as string,
          acceptance: params.acceptance as string | undefined,
          constraints: params.constraints as string[] | undefined,
          responsibleAgentId: params.responsibleAgentId as string | undefined,
        });
        return { toolCallId: "", content: formatDispatchReceipt(receipt) };
      } catch (e) {
        return { toolCallId: "", content: `派发失败: ${(e as Error).message}`, isError: true };
      }
    },
  };
}

function makeGetWorkStatusTool(
  agentRegistry: AgentRegistry,
  groupManager: GroupManager,
  dataRoot: string,
): Tool {
  return {
    name: "butler-get-work-status",
    description: "查询 ButlerTask 与 Global TODO 的当前状态。",
    parameters: {
      type: "object",
      properties: {
        globalTodoId: { type: "string", description: "Global TODO ID" },
        butlerTaskId: { type: "string", description: "ButlerTask ID" },
        targetId: { type: "string", description: "按 Agent/Group ID 查询" },
        status: { type: "string", description: "按 ButlerTask 状态筛选" },
      },
      required: [],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const deps = getButlerDispatchDeps(agentRegistry, groupManager, dataRoot);
      if (!deps) {
        return { toolCallId: "", content: "Runtime 尚未挂载 Butler/Global TODO 存储，无法查询。", isError: true };
      }

      const globalTodoId = params.globalTodoId as string | undefined;
      const butlerTaskId = params.butlerTaskId as string | undefined;
      if (globalTodoId || butlerTaskId) {
        const globalTodo = globalTodoId
          ? deps.globalTodoStore.get(globalTodoId)
          : deps.globalTodoStore.getByButlerTaskId(butlerTaskId as string);
        const task = butlerTaskId
          ? deps.butlerTaskStore.get(butlerTaskId)
          : globalTodo?.butlerTaskId
            ? deps.butlerTaskStore.get(globalTodo.butlerTaskId)
            : undefined;
        if (!globalTodo && !task) {
          return { toolCallId: "", content: "未找到对应任务。", isError: true };
        }
        return { toolCallId: "", content: JSON.stringify({ globalTodo, butlerTask: task }, null, 2) };
      }

      const tasks = deps.butlerTaskStore.list({
        status: params.status as any,
        targetId: params.targetId as string | undefined,
      });
      return { toolCallId: "", content: JSON.stringify({ tasks }, null, 2) };
    },
  };
}

function makeCancelWorkTool(
  agentRegistry: AgentRegistry,
  groupManager: GroupManager,
  dataRoot: string,
): Tool {
  return {
    name: "butler-cancel-work",
    description: "取消一个可追踪 Butler 工作项，同步更新 ButlerTask 与 Global TODO。",
    parameters: {
      type: "object",
      properties: {
        globalTodoId: { type: "string", description: "Global TODO ID" },
        butlerTaskId: { type: "string", description: "ButlerTask ID" },
        reason: { type: "string", description: "取消原因" },
      },
      required: [],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const deps = getButlerDispatchDeps(agentRegistry, groupManager, dataRoot);
      if (!deps) {
        return { toolCallId: "", content: "Runtime 尚未挂载 Butler/Global TODO 存储，无法取消。", isError: true };
      }

      let globalTodoId = params.globalTodoId as string | undefined;
      let butlerTaskId = params.butlerTaskId as string | undefined;
      const task = butlerTaskId ? deps.butlerTaskStore.get(butlerTaskId) : undefined;
      if (!globalTodoId && task) globalTodoId = task.globalTodoId;
      const globalTodo = globalTodoId ? deps.globalTodoStore.get(globalTodoId) : undefined;
      if (!butlerTaskId && globalTodo?.butlerTaskId) butlerTaskId = globalTodo.butlerTaskId;

      if (!globalTodo && !task) {
        return { toolCallId: "", content: "未找到可取消的任务。", isError: true };
      }

      const reason = (params.reason as string | undefined) || "Cancelled by Butler";
      if (globalTodoId) {
        deps.globalTodoStore.update(globalTodoId, {
          status: "cancelled",
          progressSummary: reason,
          nextAction: "No further action",
        } as any);
      }
      if (butlerTaskId) {
        deps.butlerTaskStore.update(butlerTaskId, {
          status: "cancelled",
          latestSummary: reason,
        });
      }
      deps.wsServer?.broadcastGlobalTodoUpdate?.();
      deps.wsServer?.broadcast?.({ type: "butler_task_updated", payload: { butlerTaskId, globalTodoId, timestamp: Date.now() } });
      return { toolCallId: "", content: `已取消任务。Global TODO: ${globalTodoId || "无"}；ButlerTask: ${butlerTaskId || "无"}` };
    },
  };
}

function makeReplyToGroupTool(
  agentRegistry: AgentRegistry,
  groupManager: GroupManager,
  dataRoot: string,
): Tool {
  return {
    name: "butler-reply-to-group",
    description: "以管家身份向群组回复，并可同步刷新关联 ButlerTask / Global TODO 摘要。",
    parameters: {
      type: "object",
      properties: {
        groupId: { type: "string", description: "群组 ID" },
        content: { type: "string", description: "回复内容" },
        globalTodoId: { type: "string", description: "关联 Global TODO ID" },
        butlerTaskId: { type: "string", description: "关联 ButlerTask ID" },
      },
      required: ["groupId", "content"],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const groupId = params.groupId as string;
      const group = groupManager.get(groupId);
      if (!group) return { toolCallId: "", content: `未找到群组: ${groupId}`, isError: true };
      group.postMessage("butler", params.content as string);

      const deps = getButlerDispatchDeps(agentRegistry, groupManager, dataRoot);
      if (deps) {
        let globalTodoId = params.globalTodoId as string | undefined;
        let butlerTaskId = params.butlerTaskId as string | undefined;
        const task = butlerTaskId ? deps.butlerTaskStore.get(butlerTaskId) : undefined;
        if (!globalTodoId && task) globalTodoId = task.globalTodoId;
        const globalTodo = globalTodoId ? deps.globalTodoStore.get(globalTodoId) : undefined;
        if (!butlerTaskId && globalTodo?.butlerTaskId) butlerTaskId = globalTodo.butlerTaskId;
        if (globalTodoId) {
          deps.globalTodoStore.update(globalTodoId, {
            status: "running",
            progressSummary: `Butler replied to group ${groupId}`,
            nextAction: "Group should continue from Butler reply",
          } as any);
        }
        if (butlerTaskId) {
          deps.butlerTaskStore.update(butlerTaskId, {
            status: "running",
            latestSummary: `Butler replied to group ${groupId}`,
          });
        }
        deps.wsServer?.broadcastGlobalTodoUpdate?.();
        deps.wsServer?.broadcast?.({ type: "butler_task_updated", payload: { butlerTaskId, globalTodoId, timestamp: Date.now() } });
      }

      return { toolCallId: "", content: `已回复群组 ${groupId}` };
    },
  };
}

function makeDispatchTaskTool(
  agentRegistry: AgentRegistry,
  groupManager: GroupManager,
  dataRoot: string,
): Tool {
  const delegate = makeDispatchToAgentTool(agentRegistry, groupManager, dataRoot);
  return {
    ...delegate,
    name: "butler-dispatch-task",
    description: "兼容旧入口：将任务派发给指定 Agent，并创建 Global TODO、ButlerTask 和 Agent inbox 条目。",
    async execute(params, context: ToolContext): Promise<ToolResult> {
      return delegate.execute(params, context);
    },
  };
}

// ---- butler-review-proposals ----

function makeReviewProposalsTool(dataRoot: string): Tool {
  return {
    name: "butler-review-proposals",
    description: "扫描所有 Agent 的待审批成长建议 (GrowthProposals)，列出需要用户最终确认的建议。",
    parameters: { type: "object", properties: {}, required: [] },
    async execute(_params, _context: ToolContext): Promise<ToolResult> {
      const results: string[] = [];
      const agentsDir = path.join(dataRoot, "agents");
      const coreAgentsDir = path.join(dataRoot, "coreagents");

      for (const dir of [agentsDir, coreAgentsDir]) {
        if (!fs.existsSync(dir)) continue;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          const proposalsDir = path.join(dir, entry.name, "proposals");
          if (!fs.existsSync(proposalsDir)) continue;

          for (const pf of fs.readdirSync(proposalsDir)) {
            if (!pf.endsWith(".json")) continue;
            try {
              const proposal = JSON.parse(fs.readFileSync(path.join(proposalsDir, pf), "utf-8")) as import("@cobeing/shared").AgentGrowthProposal;
              if (proposal.status === "approved" && (proposal.targetFile === "CHARACTER.md" || proposal.targetFile === "config.json")) {
                results.push(`- [${proposal.targetFile}] **${entry.name}**: ${proposal.reason.slice(0, 100)} (风险: ${proposal.risk}) [${proposal.id}]`);
              }
            } catch { /* skip */ }
          }
        }
      }

      if (results.length === 0) {
        return { toolCallId: "", content: "没有需要用户确认的待审批成长建议。" };
      }

      return { toolCallId: "", content: `## 待用户确认的成长建议\n\n${results.join("\n")}\n\n使用 WS 命令 approve_proposal / reject_proposal 处理。` };
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
    this.toolRegistry.register(makeGroupSendTool((gid) => groupManager.get(gid)));

    // 工作流工具
    this.toolRegistry.register(makeWorkflowAnalyzeTool(engine));
    this.toolRegistry.register(makeWorkflowPlanTool(engine));

    // TODO 工具
    const dataRoot = path.dirname(path.dirname(this.paths.directory));
    this.toolRegistry.register(makeTodoAddTool(dataRoot, (gid) => groupManager.getGroupTodoStore?.(gid)));
    this.toolRegistry.register(makeTodoListTool(dataRoot, (gid) => groupManager.getGroupTodoStore?.(gid)));
    this.toolRegistry.register(makeTodoCompleteTool(dataRoot, (gid) => groupManager.getGroupTodoStore?.(gid), (gid) => groupManager.getScanner?.(gid)));
    this.toolRegistry.register(makeTodoRemoveTool(dataRoot, (gid) => groupManager.getGroupTodoStore?.(gid)));
    this.toolRegistry.register(makeTodoReviewTool(dataRoot, (gid) => groupManager.getGroupTodoStore?.(gid), (gid) => groupManager.getScanner?.(gid)));

    // Global TODO 编排工具（Phase 2）
    const globalTodoStore = (globalThis as any).__cobeing?.runtime?.globalTodoStore;
    if (globalTodoStore) {
      this.toolRegistry.register(makeGlobalTodoAddTool(globalTodoStore));
      this.toolRegistry.register(makeGlobalTodoListTool(globalTodoStore));
      this.toolRegistry.register(makeGlobalTodoUpdateTool(globalTodoStore));
      this.toolRegistry.register(makeGlobalTodoLinkExecutionTool(globalTodoStore));
      this.toolRegistry.register(makeGlobalTodoContinueTool(globalTodoStore));
    }

    // Agent Enhancement — Butler tools
    this.toolRegistry.register(makeFindAgentTool(registry, bsDataRoot, provider, config.model));
    this.toolRegistry.register(makeDispatchToAgentTool(registry, groupManager, bsDataRoot));
    this.toolRegistry.register(makeDispatchToGroupTool(registry, groupManager, bsDataRoot));
    this.toolRegistry.register(makeGetWorkStatusTool(registry, groupManager, bsDataRoot));
    this.toolRegistry.register(makeCancelWorkTool(registry, groupManager, bsDataRoot));
    this.toolRegistry.register(makeReplyToGroupTool(registry, groupManager, bsDataRoot));
    this.toolRegistry.register(makeDispatchTaskTool(registry, groupManager, bsDataRoot));
    this.toolRegistry.register(makeReviewProposalsTool(bsDataRoot));

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
