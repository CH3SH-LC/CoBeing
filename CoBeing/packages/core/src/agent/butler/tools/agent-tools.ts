/**
 * Butler agent lifecycle tools
 * (butler-create-agent, butler-destroy-agent, butler-modify-agent, butler-find-agent)
 */
import type { AgentConfig, Tool, ToolContext, ToolResult } from "@cobeing/shared";
import type { LLMProvider } from "@cobeing/providers";
import path from "node:path";
import fs from "node:fs";
import { Agent } from "../../agent.js";
import { AgentPaths, AgentFiles, createDefaultCapabilityCard } from "../../paths.js";
import { AgentRegistry } from "../../registry.js";
import { runAgentCreator } from "../../tool-agent/creator.js";
import type { GroupManager } from "../../../group/manager.js";
import { ButlerRegistry } from "../../butler-registry.js";
import { createLogger, addAgentToRegistry, markDirectoryForDeletion, removeAgentFromRegistry, updateGroupMembers } from "@cobeing/shared";
import { DockerSandbox } from "../../../tools/sandbox/docker-sandbox.js";

const log = createLogger("butler");

export function makeCreateAgentTool(
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
        expression: {
          type: "string",
          description: "自定义 EXPRESSION.md 内容（人味表达规范：怎么说——篇幅/句式/禁语，不涉及身份设定）。如果不传则由子智能体自动生成。",
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
      if (params.expression) provided.expression = params.expression as string;
      if (params.job) provided.job = params.job as string;

      // 对管家未传入的核心文件，用 AgentCreator ToolAgent 生成
      const missingFields = (["expression", "job"] as const).filter(
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
      if (provided.expression) {
        fs.writeFileSync(path.join(agentPaths.directory, "EXPRESSION.md"), provided.expression, "utf-8");
      }
      if (provided.job) {
        fs.writeFileSync(path.join(agentPaths.directory, "JOB.md"), provided.job, "utf-8");
      }

      // 从模板复制其余核心文件（如果目标不存在且没有自定义内容）
      const templatesDir = path.resolve("packages/core/src/templates/agent");
      const templateFiles = ["EXPRESSION.md", "JOB.md", "AGENTS.md", "MEMORY.md", "EXPERIENCE.md"];
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

export function makeDestroyAgentTool(
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

export function makeModifyAgentTool(registry: AgentRegistry): Tool {
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

export function makeFindAgentTool(registry: AgentRegistry, dataRoot: string, provider: LLMProvider, model: string): Tool {
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
