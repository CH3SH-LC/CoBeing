/**
 * agent 域 WS 命令 handler — 从 ws-server.ts 的 switch 迁移
 * create_agent / destroy_agent / stop_agent / update_agent /
 * get_agent_files / read_agent_file / write_agent_file /
 * get_chat_current / save_chat_current / clear_chat_current /
 * find_agent / dispatch_task
 */
import fs from "node:fs";
import path from "node:path";
import { createLogger, DEFAULT_PROVIDER, DEFAULT_MODEL, markDirectoryForDeletion, MAX_AGENT_NAME_LENGTH, addAgentToRegistry, removeAgentFromRegistry, updateGroupMembers } from "@cobeing/shared";
import type { AgentConfig } from "@cobeing/shared";
import { Agent } from "../../agent/agent.js";
import { AgentPaths, AgentFiles, createDefaultCapabilityCard } from "../../agent/paths.js";
import { ButlerRegistry } from "../../agent/butler-registry.js";
import { runAgentCreator } from "../../agent/tool-agent/creator.js";
import { DockerSandbox } from "../../tools/sandbox/docker-sandbox.js";
import { dispatchButlerTask } from "../../butler/dispatch.js";
import { isSafeId, isSafeLeafFilename, resolveWithin } from "../security.js";
import { loadCapabilityCards, scoreCapability } from "../capability.js";
import { parseCurrentMd } from "../parsing.js";
import type { HandlerRegistrar } from "./types.js";

const log = createLogger("ws-server");

export function registerAgentHandlers(register: HandlerRegistrar): void {
  register("create_agent", async function (ws, msg) {
    const { name, role, provider, model, systemPrompt, skills, sandbox: payloadSandbox } = msg.payload as {
      name: string; role: string; provider?: string; model?: string;
      systemPrompt?: string; skills?: string[]; sandbox?: any;
    };
    if (!name || !role) {
      this.sendToClient(ws, { type: "error", payload: { message: "name and role are required" } });
      return;
    }
    // Name length + character validation
    if (name.length > MAX_AGENT_NAME_LENGTH) {
      this.sendToClient(ws, { type: "error", payload: { message: `名称不能超过 ${MAX_AGENT_NAME_LENGTH} 个字符` } });
      return;
    }
    if (!/^[\w一-鿿㐀-䶿 -]+$/.test(name)) {
      this.sendToClient(ws, { type: "error", payload: { message: "名称只能包含字母、数字、中文、连字符、下划线和空格" } });
      return;
    }
    const id = name.toLowerCase().replace(/\s+/g, "-");
    if (this.agentRegistry?.get(id)) {
      this.sendToClient(ws, { type: "error", payload: { message: `Agent already exists: ${id}` } });
      return;
    }

    const providerId = provider || DEFAULT_PROVIDER;
    const modelId = model || DEFAULT_MODEL;
    const prov = this.providerResolver?.(providerId);
    if (!prov) {
      this.sendToClient(ws, { type: "error", payload: { message: `Provider not found: ${providerId}` } });
      return;
    }

    // 检查 Docker 可用性
    let sandboxConfig = payloadSandbox || { enabled: true, filesystem: "isolated", network: { enabled: true, mode: "all" } };
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
      systemPrompt: systemPrompt || `你是${name}，${role}`,
      provider: providerId,
      model: modelId,
      permissions: { mode: "workspace-readwrite" },
      sandbox: sandboxConfig,
      tools: ["bash", "read-file", "write-file", "edit-file", "glob", "grep", "web-fetch", "agent-message"],
      skills,
    };

    // Write config to agent directory
    const agentPaths = AgentPaths.forAgent(id, this.dataRoot);
    agentPaths.ensureDirs();
    const agentFiles = new AgentFiles(agentPaths);
    agentFiles.writeConfig({
      name, role, provider: providerId, model: modelId,
      permissions: { mode: "workspace-readwrite" },
      sandbox: sandboxConfig,
      tools: ["bash", "read-file", "write-file", "edit-file", "glob", "grep", "web-fetch", "agent-message"],
      skills,
    });
    agentFiles.writeCapability(createDefaultCapabilityCard({
      agentId: id,
      displayName: name,
      role,
      tools: config.tools,
      skills,
    }));

    // 用 AgentCreator ToolAgent 生成核心文件（表达规范 + 工作范式；不再生成人物形象）
    const provided: Record<string, string> = {};
    const missingFields = (["expression", "job"] as const);

    try {
      const result = await runAgentCreator(prov, modelId, {
        name,
        role,
        fields: [...missingFields],
      });

      for (const field of missingFields) {
        if (result.files[field]) {
          provided[field] = result.files[field];
        }
      }
      log.info("AgentCreator generated files for %s: %s", id, missingFields.filter(f => result.files[f]).join(", "));
    } catch (err) {
      log.warn("AgentCreator generation failed for %s, falling back to templates: %s", id, err);
    }

    // 写入 LLM 生成的内容
    if (provided.expression) {
      fs.writeFileSync(path.join(agentPaths.directory, "EXPRESSION.md"), provided.expression, "utf-8");
    }
    if (provided.job) {
      fs.writeFileSync(path.join(agentPaths.directory, "JOB.md"), provided.job, "utf-8");
    }

    // 从模板复制其余文件（EXPRESSION, JOB, AGENTS, MEMORY, EXPERIENCE — 仅未生成或未写入的）
    const templatesDir = path.resolve("packages/core/src/templates/agent");
    const templateFiles = ["EXPRESSION.md", "JOB.md", "AGENTS.md", "MEMORY.md", "EXPERIENCE.md"];
    for (const tmplFile of templateFiles) {
      const dst = path.join(agentPaths.directory, tmplFile);
      if (!fs.existsSync(dst)) {
        const src = path.join(templatesDir, tmplFile);
        if (fs.existsSync(src)) {
          let content = fs.readFileSync(src, "utf-8");
          content = content.replace(/\{\{name\}\}/g, name).replace(/\{\{role\}\}/g, role);
          fs.writeFileSync(dst, content, "utf-8");
        }
      }
    }

    const agent = new Agent(config, prov, this.dataRoot);
    this.agentRegistry!.register(agent);

    // 注册 skills 和群组通信工具
    if (this.skillRepo) {
      agent.injectSkillRepository(this.skillRepo);
    }
    if (this.groupManager) {
      agent.injectGroupTools((gid) => this.groupManager!.get(gid));
    }
    if (this.agentRegistry) {
      agent.injectAgentMessageTool(this.agentRegistry);
    }
    // Set up provider fallback via runtime
    const runtime = (globalThis as any).__cobeing?.runtime;
    if (runtime?.providersMap) {
      agent.setAllProviders(runtime.providersMap);
    }

    // 更新 master registry（单一真相源）
    addAgentToRegistry(this.dataRoot, {
      id, name, role,
      status: "active",
      createdAt: new Date().toISOString(),
    });

    // Update ButlerRegistry
    const butlerReg = new ButlerRegistry(this.dataRoot);
    butlerReg.registerAgent({
      id, name, role,
      provider: providerId, model: modelId,
      systemPrompt: config.systemPrompt,
    });

    this.logMessage("system", `Agent created: ${name} (${id})`);
    this.sendToClient(ws, { type: "agent_created", payload: { id, name } });
    this.broadcastState();
  });

  register("destroy_agent", async function (ws, msg) {
    const { agentId } = msg.payload as { agentId: string };
    if (!agentId) {
      this.sendToClient(ws, { type: "error", payload: { message: "agentId is required" } });
      return;
    }
    if (agentId === "butler" || agentId === "host") {
      this.sendToClient(ws, { type: "error", payload: { message: `Cannot destroy built-in agent: ${agentId}` } });
      return;
    }
    const agent = this.agentRegistry?.get(agentId);
    if (!agent) {
      this.sendToClient(ws, { type: "error", payload: { message: `Agent not found: ${agentId}` } });
      return;
    }
    // 级联：从所有所属群组中移除
    const agentName = agent.name;
    if (this.groupManager) {
      const affectedGroups = this.groupManager.getGroupsForAgent(agentId);
      for (const g of affectedGroups) {
        try {
          g.removeMember(agentId);
          // 同步 registry members（registry 优先于 config.json）
          updateGroupMembers(this.dataRoot, g.id, g.config.members);
          this.groupManager.saveGroup(g.id);
          g.postMessage("system", `[系统] 成员 ${agentName} 已被销毁，已从群组移除。`);
        } catch (e: any) {
          log.error("Failed to remove %s from group %s: %s", agentId, g.id, e.message);
        }
      }
    }
    // 释放资源
    try {
      await agent.stopAndWait();
      await agent.dispose();
    } catch (e: any) {
      log.error("Failed to dispose agent %s: %s", agentId, e.message);
    }
    // 等待原生模块释放（Better-SQLite3 Windows 内存映射防护）
    await new Promise(r => setTimeout(r, 500));
    this.agentRegistry!.unregister(agentId);
    // 从 master registry 移除
    removeAgentFromRegistry(this.dataRoot, agentId);
    // 安全删除：先 rename 整个目录（不触碰文件内容，避免原生崩溃）
    const agentPaths = AgentPaths.forAgent(agentId, this.dataRoot);
    if (fs.existsSync(agentPaths.directory)) {
      const deletedDir = markDirectoryForDeletion(agentPaths.directory, { kind: "agent", id: agentId, reason: "ws-destroy-agent" });
      if (deletedDir) {
        log.info("Agent data renamed for cleanup: %s -> %s", agentPaths.directory, deletedDir);
      } else {
        log.warn("Agent data marked for deletion but still locked: %s", agentPaths.directory);
      }
    }
    const butlerReg = new ButlerRegistry(this.dataRoot);
    butlerReg.unregisterAgent(agentId);
    this.logMessage("system", `Agent destroyed: ${agentId}`);
    this.sendToClient(ws, { type: "agent_destroyed", payload: { agentId } });
    this.broadcastState();
  });

  register("stop_agent", function (ws, msg) {
    const { agentId: stopId } = msg.payload as { agentId: string };
    const target = this.agentRegistry?.get(stopId);
    if (!target) { this.sendToClient(ws, { type: "error", payload: { message: `Agent not found: ${stopId}` } }); return; }
    target.stop();
    this.sendToClient(ws, { type: "agent_stopped", payload: { agentId: stopId } });
    this.broadcastState();
  });

  register("update_agent", function (ws, msg) {
    const { agentId, config } = msg.payload as {
      agentId: string;
      config: Partial<{ name: string; role: string; provider: string; model: string; systemPrompt: string; permissions: any; sandbox: any; tools: string[]; skills: string[] }>;
    };
    if (!agentId) {
      this.sendToClient(ws, { type: "error", payload: { message: "agentId is required" } });
      return;
    }
    const agent = this.agentRegistry?.get(agentId);
    if (!agent) {
      this.sendToClient(ws, { type: "error", payload: { message: `Agent not found: ${agentId}` } });
      return;
    }
    // Update agent config.json
    const agentPaths = AgentPaths.forAgent(agentId, this.dataRoot);
    const files = new AgentFiles(agentPaths);
    const currentConfig = files.readConfig();
    const merged = { ...currentConfig, ...config };
    files.writeConfig(merged);
    // Also update in-memory config
    Object.assign(agent.config, config);
    agent.rebuildLoop();
    this.logMessage("system", `Agent updated: ${agentId}`);
    this.sendToClient(ws, { type: "agent_updated", payload: { agentId } });
    this.broadcastState();
  });

  register("get_agent_files", function (ws, msg) {
    const { agentId: aId } = msg.payload as { agentId: string };
    if (!aId) {
      this.sendToClient(ws, { type: "error", payload: { message: "agentId is required" } });
      return;
    }
    if (!isSafeId(aId) || !this.agentRegistry?.get(aId)) {
      this.sendToClient(ws, { type: "error", payload: { message: "Agent not found" } });
      return;
    }
    const aPaths = AgentPaths.forAgent(aId, this.dataRoot);
    const dir = aPaths.directory;
    if (!fs.existsSync(dir)) {
      this.sendToClient(ws, { type: "agent_files", payload: { agentId: aId, files: [] } });
      return;
    }
    const fileList = fs.readdirSync(dir)
      .filter(f => f.endsWith(".md") || f.endsWith(".json"))
      .map(name => {
        const stat = fs.statSync(path.join(dir, name));
        return { name, size: stat.size, modified: stat.mtime.toISOString() };
      });
    this.sendToClient(ws, { type: "agent_files", payload: { agentId: aId, files: fileList } });
  });

  register("read_agent_file", function (ws, msg) {
    const { agentId: rAId, filename } = msg.payload as { agentId: string; filename: string };
    if (!rAId || !filename) {
      this.sendToClient(ws, { type: "error", payload: { message: "agentId and filename are required" } });
      return;
    }
    // Security: prevent path traversal
    if (!isSafeId(rAId) || !this.agentRegistry?.get(rAId) || !isSafeLeafFilename(filename)) {
      this.sendToClient(ws, { type: "error", payload: { message: "Invalid filename" } });
      return;
    }
    const rPaths = AgentPaths.forAgent(rAId, this.dataRoot);
    const filePath = resolveWithin(rPaths.directory, filename);
    if (!fs.existsSync(filePath)) {
      this.sendToClient(ws, { type: "agent_file_content", payload: { agentId: rAId, filename, content: "" } });
      return;
    }
    const content = fs.readFileSync(filePath, "utf-8");
    this.sendToClient(ws, { type: "agent_file_content", payload: { agentId: rAId, filename, content } });
  });

  register("write_agent_file", function (ws, msg) {
    const { agentId: wAId, filename: wFilename, content: wContent } = msg.payload as {
      agentId: string; filename: string; content: string;
    };
    if (!wAId || !wFilename || wContent === undefined) {
      this.sendToClient(ws, { type: "error", payload: { message: "agentId, filename and content are required" } });
      return;
    }
    if (!isSafeId(wAId) || !this.agentRegistry?.get(wAId) || !isSafeLeafFilename(wFilename)) {
      this.sendToClient(ws, { type: "error", payload: { message: "Invalid filename" } });
      return;
    }
    const wPaths = AgentPaths.forAgent(wAId, this.dataRoot);
    const wFilePath = resolveWithin(wPaths.directory, wFilename);
    fs.writeFileSync(wFilePath, wContent, "utf-8");
    this.sendToClient(ws, { type: "file_saved", payload: { agentId: wAId, filename: wFilename } });
  });

  register("get_chat_current", function (ws, msg) {
    // Read current.md only for registered agents and groups
    const conversations: Record<string, unknown[]> = {};
    // Registered agents
    const agentsDir = path.join(this.dataRoot, "agents");
    if (fs.existsSync(agentsDir)) {
      for (const entry of fs.readdirSync(agentsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (!this.agentRegistry?.get(entry.name)) continue;
        const curPath = path.join(agentsDir, entry.name, "memory", "current.md");
        if (fs.existsSync(curPath)) {
          try {
            const raw = fs.readFileSync(curPath, "utf-8");
            const parsed = parseCurrentMd(raw);
            if (parsed.length > 0) conversations[entry.name] = parsed;
          } catch { /* ignore parse errors */ }
        }
      }
    }
    // Registered groups
    const groupsDir = path.join(this.dataRoot, "groups");
    if (fs.existsSync(groupsDir)) {
      for (const entry of fs.readdirSync(groupsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (!this.groupManager?.get(entry.name)) continue;
        const curPath = path.join(groupsDir, entry.name, "memory", "current.md");
        if (fs.existsSync(curPath)) {
          try {
            const raw = fs.readFileSync(curPath, "utf-8");
            const parsed = parseCurrentMd(raw);
            if (parsed.length > 0) conversations[entry.name] = parsed;
          } catch { /* ignore parse errors */ }
        }
      }
    }
    this.sendToClient(ws, { type: "chat_current", payload: { conversations } });
  });

  register("save_chat_current", function (ws, msg) {
    const { conversations: saveConvs } = msg.payload as { conversations: Record<string, unknown[]> };
    if (!saveConvs) return;
    for (const [convId, msgs] of Object.entries(saveConvs)) {
      if (!Array.isArray(msgs) || msgs.length === 0) continue;
      // Only save for registered agents or groups (prevent zombie dir creation)
      const isAgent = this.agentRegistry?.get(convId);
      const isGroup = this.groupManager?.get(convId);
      if (!isAgent && !isGroup) continue;
      // Determine path: agents/ or groups/
      let memDir: string;
      if (isAgent) {
        memDir = path.join(this.dataRoot, "agents", convId, "memory");
      } else {
        memDir = path.join(this.dataRoot, "groups", convId, "memory");
      }
      if (!fs.existsSync(memDir)) fs.mkdirSync(memDir, { recursive: true });
      const curPath = path.join(memDir, "current.md");
      const jsonStr = JSON.stringify({ messages: msgs, savedAt: Date.now() }, null, 2);
      const mdContent = `# Current Chat History\n\n> Auto-saved by CoBeing. Do not edit manually.\n\n\`\`\`json\n${jsonStr}\n\`\`\`\n`;
      fs.writeFileSync(curPath, mdContent, "utf-8");
    }
  });

  register("clear_chat_current", function (ws, msg) {
    const { conversationId } = (msg.payload as { conversationId?: string }) || {};
    // Clear specific conversation (agent or group) only
    if (conversationId) {
      const isAgent = this.agentRegistry?.get(conversationId);
      const isGroup = this.groupManager?.get(conversationId);
      if (isAgent) {
        const curPath = path.join(this.dataRoot, "agents", conversationId, "memory", "current.md");
        if (fs.existsSync(curPath)) {
          const empty = `# Current Chat History\n\n> Cleared.\n\n\`\`\`json\n${JSON.stringify({ messages: [], savedAt: Date.now() }, null, 2)}\n\`\`\`\n`;
          fs.writeFileSync(curPath, empty, "utf-8");
        }
      }
      if (isGroup) {
        const curPath = path.join(this.dataRoot, "groups", conversationId, "memory", "current.md");
        if (fs.existsSync(curPath)) {
          const empty = `# Current Chat History\n\n> Cleared.\n\n\`\`\`json\n${JSON.stringify({ messages: [], savedAt: Date.now() }, null, 2)}\n\`\`\`\n`;
          fs.writeFileSync(curPath, empty, "utf-8");
        }
      }
    } else {
      // Backward compat: clear ALL conversations (no conversationId provided)
      const clrAgentsDir = path.join(this.dataRoot, "agents");
      if (fs.existsSync(clrAgentsDir)) {
        for (const entry of fs.readdirSync(clrAgentsDir, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          if (!this.agentRegistry?.get(entry.name)) continue;
          const curPath = path.join(clrAgentsDir, entry.name, "memory", "current.md");
          if (fs.existsSync(curPath)) {
            const empty = `# Current Chat History\n\n> Cleared.\n\n\`\`\`json\n${JSON.stringify({ messages: [], savedAt: Date.now() }, null, 2)}\n\`\`\`\n`;
            fs.writeFileSync(curPath, empty, "utf-8");
          }
        }
      }
      const clrGroupsDir = path.join(this.dataRoot, "groups");
      if (fs.existsSync(clrGroupsDir)) {
        for (const entry of fs.readdirSync(clrGroupsDir, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          if (!this.groupManager?.get(entry.name)) continue;
          const curPath = path.join(clrGroupsDir, entry.name, "memory", "current.md");
          if (fs.existsSync(curPath)) {
            const empty = `# Current Chat History\n\n> Cleared.\n\n\`\`\`json\n${JSON.stringify({ messages: [], savedAt: Date.now() }, null, 2)}\n\`\`\`\n`;
            fs.writeFileSync(curPath, empty, "utf-8");
          }
        }
      }
    }
    this.sendToClient(ws, { type: "chat_current_cleared", payload: { success: true } });
  });

  register("find_agent", function (ws, msg) {
    const { taskDescription, requiredDomains, excludeAgentIds } = msg.payload as {
      taskDescription: string;
      requiredDomains?: string[];
      excludeAgentIds?: string[];
    };
    if (!taskDescription) {
      this.sendToClient(ws, { type: "error", payload: { message: "taskDescription is required" } });
      return;
    }
    const cards = loadCapabilityCards(this.dataRoot, excludeAgentIds ?? []);
    if (cards.length === 0) {
      this.sendToClient(ws, {
        type: "find_agent_result",
        payload: { bestAgentId: null, confidence: 0, reasoning: "未找到任何能力画像", alternatives: [] },
      });
      return;
    }
    const ranked = cards
      .map(card => ({ card, ...scoreCapability(card, taskDescription, requiredDomains ?? []) }))
      .sort((a, b) => b.score - a.score);
    const best = ranked[0];
    this.sendToClient(ws, {
      type: "find_agent_result",
      payload: {
        bestAgentId: best.card.agentId,
        displayName: best.card.displayName,
        confidence: Number(best.confidence.toFixed(2)),
        reasoning: best.reason,
        alternatives: ranked.slice(1, 4).map(item => ({
          agentId: item.card.agentId,
          displayName: item.card.displayName,
          confidence: Number(item.confidence.toFixed(2)),
          reasoning: item.reason,
        })),
      },
    });
  });

  register("dispatch_task", async function (ws, msg) {
    const { agentId: dtId, groupId, targetType: rawTargetType, title, goal, acceptance, constraints, notifyTarget } = msg.payload as {
      agentId?: string; groupId?: string; targetType?: string; title: string; goal: string;
      acceptance?: string; constraints?: string[]; notifyTarget?: boolean;
    };
    if (!title || !goal) {
      this.sendToClient(ws, { type: "error", payload: { message: "title and goal are required" } });
      return;
    }
    // targetType 默认 "agent"，保持旧 payload（仅 agentId）向后兼容
    const targetType: "agent" | "group" = rawTargetType === "group" ? "group" : "agent";
    const targetId = targetType === "group" ? groupId : dtId;
    if (!targetId) {
      this.sendToClient(ws, {
        type: "error",
        payload: { message: targetType === "group" ? "groupId is required for group target" : "agentId is required" },
      });
      return;
    }
    if (!isSafeId(targetId)) {
      this.sendToClient(ws, { type: "error", payload: { message: `Invalid ${targetType}Id` } });
      return;
    }
    if (targetType === "agent" && !this.agentRegistry?.get(targetId)) {
      this.sendToClient(ws, { type: "error", payload: { message: `Agent not found: ${targetId}` } });
      return;
    }
    if (targetType === "group" && !this.groupManager?.get(targetId)) {
      this.sendToClient(ws, { type: "error", payload: { message: `Group not found: ${targetId}` } });
      return;
    }
    const runtime = (globalThis as any).__cobeing?.runtime;
    if (!runtime?.globalTodoStore || !runtime?.butlerTaskStore) {
      this.sendToClient(ws, { type: "error", payload: { message: "Butler runtime stores are not available" } });
      return;
    }
    try {
      const receipt = await dispatchButlerTask({
        dataRoot: runtime.dataRoot ?? this.dataRoot,
        agentRegistry: this.agentRegistry,
        groupManager: this.groupManager ?? undefined,
        globalTodoStore: runtime.globalTodoStore,
        butlerTaskStore: runtime.butlerTaskStore,
        butlerBindingStore: runtime.butlerBindingStore,
        wsServer: this,
      }, {
        targetType,
        targetId,
        title,
        goal,
        acceptance,
        constraints,
        notifyTarget,
      });
      this.sendToClient(ws, {
        type: "dispatch_task_result",
        payload: {
          ok: true,
          agentId: targetType === "agent" ? targetId : undefined,
          groupId: targetType === "group" ? targetId : undefined,
          targetType,
          targetId,
          globalTodoId: receipt.globalTodo.id,
          butlerTaskId: receipt.butlerTaskId,
          executionRef: receipt.executionRef,
        },
      });
    } catch (e) {
      this.sendToClient(ws, { type: "dispatch_task_result", payload: { ok: false, error: (e as Error).message } });
    }
  });
}
