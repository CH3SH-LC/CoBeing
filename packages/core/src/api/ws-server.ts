/**
 * Core WebSocket 服务 — 为 GUI 提供状态查询和控制接口
 * 直接从 AgentRegistry / GroupManager 读取实时状态
 */
import { WebSocketServer, WebSocket } from "ws";
import fs from "node:fs";
import path from "node:path";
import { createLogger } from "@cobeing/shared";
import { Agent } from "../agent/agent.js";
import { AgentPaths, AgentFiles } from "../agent/paths.js";
import type { AgentRegistry } from "../agent/registry.js";
import type { GroupManager } from "../group/manager.js";
import type { ChannelRouter } from "../group/router.js";
import { ButlerRegistry } from "../butler/registry.js";
import { SkillRepository } from "../skills/repository.js";
import type { AgentConfig } from "@cobeing/shared";
import { encrypt, decrypt } from "../config/secret-store.js";
import { rmDirRecursive } from "@cobeing/shared";
import type { LLMProvider } from "@cobeing/providers";
import { TodoStore } from "../todo/store.js";
import { DockerSandbox } from "../tools/sandbox/docker-sandbox.js";

/** 对 API Key 做脱敏：保留前4后4，中间用 **** 替代 */
function maskApiKey(key: string): string {
  if (!key) return "";
  if (key.length <= 8) return "****";
  return key.slice(0, 4) + "****" + key.slice(-4);
}

/** 为 providers 补充 _apiKeyResolved 字段（环境变量解析后的 masked 值） */
function resolveProviderApiKeys(providers: Record<string, Record<string, unknown>>) {
  for (const prov of Object.values(providers)) {
    if (typeof prov.apiKey === "string" && prov.apiKey) {
      // 已有直接存储的 apiKey（已解密），直接 mask
      prov._apiKeyResolved = maskApiKey(prov.apiKey);
    } else if (typeof prov.apiKeyEnv === "string" && prov.apiKeyEnv) {
      // 尝试从环境变量读取
      const envValue = process.env[prov.apiKeyEnv];
      if (envValue) {
        prov._apiKeyResolved = maskApiKey(envValue);
      }
    }
  }
}

const log = createLogger("ws-server");

interface WSMessage {
  type: string;
  payload?: unknown;
}

export class CoreWSServer {
  private wss: WebSocketServer | null = null;
  private agentRegistry: AgentRegistry | null = null;
  private groupManager: GroupManager | null = null;
  private router: ChannelRouter | null = null;
  private clients = new Set<WebSocket>();
  private messageLog: Array<{ timestamp: number; direction: string; content: string }> = [];
  private providerResolver: ((id: string) => LLMProvider | undefined) | null = null;
  private skillRepo: SkillRepository | null = null;
  private dataRoot: string = "data";
  private onProviderChange: ((providerId: string) => void) | null = null;
  private onMcpConfigChange: ((serverId: string, config: unknown) => Promise<void>) | null = null;

  constructor(private port: number = 18765, private configPath?: string) {}

  /** 注入 AgentRegistry — 后续 getState 直接读取 */
  setAgentRegistry(registry: AgentRegistry): void {
    this.agentRegistry = registry;
  }

  /** 注入 GroupManager */
  setGroupManager(gm: GroupManager): void {
    this.groupManager = gm;
    // 设置 Agent 响应回调，广播到前端
    gm.setOnAgentResponse((groupId, agentId, content, tag) => {
      this.broadcast({
        type: "group_message",
        payload: {
          groupId,
          fromAgentId: agentId,
          content,
          mentions: extractMentions(content),
          timestamp: Date.now(),
        },
      });
    });
  }

  /** 注入 ChannelRouter */
  setChannelRouter(router: ChannelRouter): void {
    this.router = router;
  }

  /** 注入 Provider 解析器（用于创建 Agent） */
  setProviderResolver(resolver: (id: string) => LLMProvider | undefined): void {
    this.providerResolver = resolver;
  }

  /** 注入 Provider 变更回调（用于热重载） */
  setOnProviderChange(cb: (providerId: string) => void): void {
    this.onProviderChange = cb;
  }

  /** 注入 MCP 配置变更回调（用于热重载） */
  setOnMcpConfigChange(handler: (serverId: string, config: unknown) => Promise<void>): void {
    this.onMcpConfigChange = handler;
  }

  /** 注入 SkillRepository */
  setSkillRepository(repo: SkillRepository): void {
    this.skillRepo = repo;
  }

  /** 注入数据根目录 */
  setDataRoot(dataRoot: string): void {
    this.dataRoot = dataRoot;
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.wss = new WebSocketServer({ port: this.port });

      this.wss.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
          log.error("Port %d is already in use. Please close the process using it or change the port in config.", this.port);
        } else {
          log.error("WS server error: %s", err.message);
        }
        reject(err);
      });

      this.wss.on("connection", (ws) => {
        this.clients.add(ws);
        log.info("GUI client connected");

        // 发送当前状态
        this.sendToClient(ws, { type: "state", payload: this.getState() });

        ws.on("message", (raw) => {
          try {
            const msg = JSON.parse(raw.toString()) as WSMessage;
            this.handleMessage(ws, msg);
          } catch (err) {
            log.error("Invalid WS message: %s", err);
          }
        });

        ws.on("close", () => {
          this.clients.delete(ws);
        });
      });

      this.wss.on("listening", () => {
        log.info("Core WS server listening on port %d", this.port);
        resolve();
      });
    });
  }

  stop(): void {
    this.wss?.close();
    this.wss = null;
  }

  /** 注册 agent（兼容旧接口，同时设置 registry） */
  registerAgent(agent: Agent): void {
    if (!this.agentRegistry) {
      this.agentRegistry = (agent as any).config?.__registry ?? null;
    }
    this.broadcastState();
  }

  /** 广播当前状态（从 Registry 实时读取） */
  broadcastState(): void {
    this.broadcast({ type: "state", payload: this.getState() });
  }

  /** 广播消息到所有 GUI 客户端 */
  broadcast(message: WSMessage): void {
    const data = JSON.stringify(message);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  /** 记录消息日志 */
  logMessage(direction: "in" | "out" | "system", content: string): void {
    const entry = { timestamp: Date.now(), direction, content };
    this.messageLog.push(entry);
    if (this.messageLog.length > 500) this.messageLog.shift();
    this.broadcast({ type: "message", payload: entry });
    // 推送给日志订阅者
    const logData = JSON.stringify({ type: "log_entry", payload: entry });
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN && (client as any).__subscribedLog) {
        client.send(logData);
      }
    }
  }

  private async handleMessage(ws: WebSocket, msg: WSMessage): Promise<void> {
    switch (msg.type) {
      case "get_state":
        this.sendToClient(ws, { type: "state", payload: this.getState() });
        break;

      case "send_message": {
        const { agentId, content } = msg.payload as { agentId: string; content: string };
        const agent = this.agentRegistry?.get(agentId);
        if (!agent) {
          this.sendToClient(ws, { type: "error", payload: { message: `Agent not found: ${agentId}` } });
          break;
        }
        // Check if this is a group-context message (content starts with [群组 groupId])
        const groupMatch = content.match(/^\[群组 ([^\]]+)\]\s*(.*)/s);
        if (groupMatch) {
          const gId = groupMatch[1];
          const gContent = groupMatch[2];
          const group = this.groupManager?.get(gId);
          if (group) {
            // Post to group context
            group.postMessage("user", gContent);

            // 为群主设置群组协作上下文
            const { buildGroupCollaborationContext } = await import("../conversation/prompt-builder.js");
            const members = group.getMemberProfiles();
            const workspace = group.workspace.getSummary();
            const experienceSummary = group.workspace.readExperienceSummary();

            let todos: import("../conversation/prompt-builder.js").GroupTodoSummary[] = [];
            const scanner = this.groupManager?.getScanner?.(gId);
            if (scanner) {
              const store = scanner.getStore();
              const pendingTodos = store.list("pending");
              todos = pendingTodos.map((t: any) => ({
                id: t.id,
                title: t.title,
                status: t.status,
                assignee: t.targetAgentId,
              }));
            }

            const collabContext = buildGroupCollaborationContext(
              agentId,
              members,
              {
                task: workspace.task,
                plan: workspace.plan,
                progress: workspace.progress,
                experienceSummary,
              },
              todos,
              group.config.owner,
              gId,
            );
            agent.setGroupContext(collabContext);
          }
        }

        this.logMessage("in", content);
        agent.run(content, {
          onToken: (token) => {
            this.sendToClient(ws, { type: "stream_token", payload: { token } });
          },
          onToolCall: (tc) => {
            this.broadcast({
              type: "tool_event",
              payload: {
                agentId,
                toolName: tc.function.name,
                params: (() => { try { return JSON.parse(tc.function.arguments); } catch { return {}; } })(),
                status: "start",
              },
            });
          },
          onToolResult: (tcId, result) => {
            this.broadcast({
              type: "tool_event",
              payload: {
                agentId,
                toolCallId: tcId,
                result: typeof result === "string" ? result.slice(0, 2000) : String(result),
                status: "complete",
              },
            });
          },
        }).then((response) => {
          // 清理群组协作上下文
          if (groupMatch) agent.clearGroupContext();

          this.logMessage("out", response.content);
          this.sendToClient(ws, { type: "agent_response", payload: { content: response.content } });
          // Broadcast group_message if this was a group context
          if (groupMatch) {
            const gId = groupMatch[1];
            const group = this.groupManager?.get(gId);
            if (group) {
              // 写回 GroupContextV2（silent，不触发回调避免重复唤醒）
              const replyMsg = group.ctxV2.appendSilent(agentId, response.content, "main");

              // 同步到 current.md
              group.currentMd.append({
                id: replyMsg.id,
                tag: replyMsg.tag,
                fromAgentId: replyMsg.fromAgentId,
                content: replyMsg.content,
                timestamp: replyMsg.timestamp,
              });

              // 持久化到 context.jsonl
              this.groupManager?.appendContextMessage(gId, {
                fromAgentId: replyMsg.fromAgentId,
                content: replyMsg.content,
                tag: replyMsg.tag,
                timestamp: replyMsg.timestamp,
              });
            }

            this.broadcast({
              type: "group_message",
              payload: {
                groupId: gId,
                fromAgentId: agentId,
                content: response.content,
                mentions: extractMentions(response.content),
                timestamp: Date.now(),
              },
            });
          }
          this.broadcastState();
        }).catch((err) => {
          // 清理群组协作上下文
          if (groupMatch) agent.clearGroupContext();
          const errMsg = err instanceof Error ? err.message : String(err);
          this.logMessage("system", `LLM Error: ${errMsg}`);
          this.sendToClient(ws, { type: "error", payload: { message: errMsg } });
          this.broadcastState();
        });
        break;
      }

      case "get_log":
        this.sendToClient(ws, { type: "log", payload: this.messageLog });
        break;

      case "get_config": {
        const configFilePath = this.configPath || path.resolve("config/default.json");
        try {
          const raw = fs.readFileSync(configFilePath, "utf-8");
          const config = JSON.parse(raw);
          // 解密所有 provider 的 apiKey
          if (config.providers) {
            for (const prov of Object.values(config.providers) as Array<Record<string, unknown>>) {
              if (typeof prov.apiKey === "string") {
                prov.apiKey = decrypt(prov.apiKey);
              }
            }
            resolveProviderApiKeys(config.providers as Record<string, Record<string, unknown>>);
          }
          this.sendToClient(ws, { type: "config", payload: config });
        } catch (err) {
          this.sendToClient(ws, { type: "error", payload: { message: `Failed to read config: ${err}` } });
        }
        break;
      }

      case "update_config": {
        const { path: cfgPath, value } = msg.payload as { path: string; value: unknown };
        const configFilePath = this.configPath || path.resolve("config/default.json");
        try {
          const raw = fs.readFileSync(configFilePath, "utf-8");
          const config = JSON.parse(raw);

          // 如果更新的是 provider 的 apiKey，加密后存储
          let storedValue = value;
          if (cfgPath.match(/^providers\.[^.]+\.apiKey$/) && typeof value === "string" && value) {
            storedValue = encrypt(value);
          }
          // 如果更新的是整个 provider 对象且含 apiKey，加密其中的 apiKey
          if (cfgPath.match(/^providers\.[^.]+$/) && typeof value === "object" && value !== null) {
            const obj = value as Record<string, unknown>;
            if (typeof obj.apiKey === "string" && obj.apiKey) {
              storedValue = { ...obj, apiKey: encrypt(obj.apiKey) };
            }
          }

          setNestedValue(config, cfgPath, storedValue);
          fs.writeFileSync(configFilePath, JSON.stringify(config, null, 2) + "\n", "utf-8");
          this.sendToClient(ws, { type: "config_updated", payload: { path: cfgPath, success: true } });

          // 广播配置时解密 apiKey + 解析环境变量
          const broadcastConfig = JSON.parse(JSON.stringify(config));
          if (broadcastConfig.providers) {
            for (const prov of Object.values(broadcastConfig.providers) as Array<Record<string, unknown>>) {
              if (typeof prov.apiKey === "string") {
                prov.apiKey = decrypt(prov.apiKey);
              }
            }
            resolveProviderApiKeys(broadcastConfig.providers as Record<string, Record<string, unknown>>);
          }
          this.broadcast({ type: "config", payload: broadcastConfig });

          // Provider 变更时触发热重载
          const providerMatch = cfgPath.match(/^providers\.([^.]+)/);
          if (providerMatch && this.onProviderChange) {
            this.onProviderChange(providerMatch[1]);
          }

          // MCP 服务器配置变更时触发热重载
          if (cfgPath.startsWith("mcpServers.") && this.onMcpConfigChange) {
            const serverId = cfgPath.split(".")[1];
            this.onMcpConfigChange(serverId, value).catch(err => {
              log.warn("MCP config change handler error: %s", String(err));
            });
          }
        } catch (err) {
          this.sendToClient(ws, { type: "error", payload: { message: `Failed to update config: ${err}` } });
        }
        break;
      }

      case "subscribe_log": {
        this.sendToClient(ws, { type: "log", payload: this.messageLog });
        (ws as any).__subscribedLog = true;
        break;
      }

      case "create_agent": {
        const { name, role, provider, model, systemPrompt, skills, sandbox: payloadSandbox } = msg.payload as {
          name: string; role: string; provider?: string; model?: string;
          systemPrompt?: string; skills?: string[]; sandbox?: any;
        };
        if (!name || !role) {
          this.sendToClient(ws, { type: "error", payload: { message: "name and role are required" } });
          break;
        }
        const id = name.toLowerCase().replace(/\s+/g, "-");
        if (this.agentRegistry?.get(id)) {
          this.sendToClient(ws, { type: "error", payload: { message: `Agent already exists: ${id}` } });
          break;
        }

        const providerId = provider || "deepseek";
        const modelId = model || "deepseek-v4-flash";
        const prov = this.providerResolver?.(providerId);
        if (!prov) {
          this.sendToClient(ws, { type: "error", payload: { message: `Provider not found: ${providerId}` } });
          break;
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
          permissions: { mode: "workspace-write" },
          sandbox: sandboxConfig,
          tools: ["bash", "read-file", "write-file", "glob", "grep", "web-fetch"],
          skills,
        };

        // Write config to agent directory
        const agentPaths = AgentPaths.forAgent(id, this.dataRoot);
        agentPaths.ensureDirs();
        new AgentFiles(agentPaths).writeConfig({
          name, role, provider: providerId, model: modelId,
          permissions: { mode: "workspace-write" },
          sandbox: sandboxConfig,
          tools: ["bash", "read-file", "write-file", "glob", "grep", "web-fetch"],
          skills,
        });

        // Copy templates
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

        const agent = new Agent(config, prov, this.dataRoot);
        this.agentRegistry!.register(agent);

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
        break;
      }

      case "create_group": {
        const { name, members, topic } = msg.payload as {
          name: string; members: string[]; topic?: string;
        };
        if (!name || !members || members.length === 0) {
          this.sendToClient(ws, { type: "error", payload: { message: "name and members are required" } });
          break;
        }
        const id = name.toLowerCase().replace(/\s+/g, "-");
        if (this.groupManager?.get(id)) {
          this.sendToClient(ws, { type: "error", payload: { message: `Group already exists: ${id}` } });
          break;
        }

        // 强制要求群主智能体
        const hostAgent = this.agentRegistry?.get("host");
        if (!hostAgent) {
          this.sendToClient(ws, { type: "error", payload: { message: "群主智能体不可用，无法创建群组" } });
          break;
        }

        const allMembers = ["host", ...members.filter(m => m !== "host")];

        this.groupManager!.create({
          id,
          name,
          members: allMembers,
          owner: "host",
          topic,
        });

        // Update ButlerRegistry
        const butlerReg = new ButlerRegistry(this.dataRoot);
        butlerReg.registerGroup({
          id,
          name,
          members: allMembers,
        });

        this.logMessage("system", `Group created: ${name} (${id})`);
        this.sendToClient(ws, { type: "group_created", payload: { id, name } });
        this.broadcastState();
        break;
      }

      case "destroy_agent": {
        const { agentId } = msg.payload as { agentId: string };
        if (!agentId) {
          this.sendToClient(ws, { type: "error", payload: { message: "agentId is required" } });
          break;
        }
        if (agentId === "butler" || agentId === "host") {
          this.sendToClient(ws, { type: "error", payload: { message: `Cannot destroy built-in agent: ${agentId}` } });
          break;
        }
        const agent = this.agentRegistry?.get(agentId);
        if (!agent) {
          this.sendToClient(ws, { type: "error", payload: { message: `Agent not found: ${agentId}` } });
          break;
        }
        // 释放资源
        try {
          await agent.dispose();
        } catch (e: any) {
          log.error("Failed to dispose agent %s: %s", agentId, e.message);
        }
        this.agentRegistry!.unregister(agentId);
        // 删除本地数据目录
        const agentPaths = AgentPaths.forAgent(agentId, this.dataRoot);
        try {
          rmDirRecursive(agentPaths.directory);
          log.info("Deleted agent data: %s", agentPaths.directory);
        } catch (e: any) {
          log.error("Failed to delete agent data %s: %s", agentPaths.directory, e.message);
        }
        const butlerReg = new ButlerRegistry(this.dataRoot);
        butlerReg.unregisterAgent(agentId);
        this.logMessage("system", `Agent destroyed: ${agentId}`);
        this.sendToClient(ws, { type: "agent_destroyed", payload: { agentId } });
        this.broadcastState();
        break;
      }

      case "destroy_group": {
        const { groupId } = msg.payload as { groupId: string };
        if (!groupId) {
          this.sendToClient(ws, { type: "error", payload: { message: "groupId is required" } });
          break;
        }
        const group = this.groupManager?.get(groupId);
        if (!group) {
          this.sendToClient(ws, { type: "error", payload: { message: `Group not found: ${groupId}` } });
          break;
        }
        this.groupManager!.delete(groupId);
        const butlerReg = new ButlerRegistry(this.dataRoot);
        butlerReg.unregisterGroup(groupId);
        this.logMessage("system", `Group destroyed: ${groupId}`);
        this.sendToClient(ws, { type: "group_destroyed", payload: { groupId } });
        this.broadcastState();
        break;
      }

      case "bind_channel": {
        const { channelName, targetType, targetId } = msg.payload as {
          channelName: string;
          targetType: "agent" | "group";
          targetId: string;
        };
        if (!channelName || !targetType || !targetId) {
          this.sendToClient(ws, { type: "error", payload: { message: "channelName, targetType, targetId are required" } });
          break;
        }
        if (!this.router) {
          this.sendToClient(ws, { type: "error", payload: { message: "Router not available" } });
          break;
        }
        if (targetType === "group" && this.groupManager && !this.groupManager.get(targetId)) {
          this.sendToClient(ws, { type: "error", payload: { message: `Group not found: ${targetId}` } });
          break;
        }
        if (targetType === "agent" && this.agentRegistry && !this.agentRegistry.get(targetId)) {
          this.sendToClient(ws, { type: "error", payload: { message: `Agent not found: ${targetId}` } });
          break;
        }
        const entry = targetType === "agent"
          ? { type: "agent" as const, agentId: targetId }
          : { type: "group" as const, groupId: targetId };
        this.router.bind(channelName, entry);
        // 持久化到 config/default.json
        try {
          const cfgPath = this.configPath || path.resolve("config/default.json");
          const raw = fs.readFileSync(cfgPath, "utf-8");
          const config = JSON.parse(raw);
          setNestedValue(config, `channels.${channelName}.bindTo`, entry);
          fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
        } catch (err) {
          this.logMessage("system", `Failed to persist binding: ${err}`);
        }
        this.logMessage("system", `Channel ${channelName} bound to ${targetType} ${targetId}`);
        this.sendToClient(ws, { type: "channel_bound", payload: { channelName, targetType, targetId } });
        break;
      }

      case "unbind_channel": {
        const { channelName: unbindName } = msg.payload as { channelName: string };
        if (!unbindName) {
          this.sendToClient(ws, { type: "error", payload: { message: "channelName is required" } });
          break;
        }
        if (!this.router) {
          this.sendToClient(ws, { type: "error", payload: { message: "Router not available" } });
          break;
        }
        this.router.unbind(unbindName);
        // 持久化：移除 bindTo
        try {
          const cfgPath = this.configPath || path.resolve("config/default.json");
          const raw = fs.readFileSync(cfgPath, "utf-8");
          const config = JSON.parse(raw);
          setNestedValue(config, `channels.${unbindName}.bindTo`, null);
          fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
        } catch (err) {
          this.logMessage("system", `Failed to persist unbinding: ${err}`);
        }
        this.logMessage("system", `Channel ${unbindName} unbound`);
        this.sendToClient(ws, { type: "channel_unbound", payload: { channelName: unbindName } });
        break;
      }

      case "update_agent": {
        const { agentId, config } = msg.payload as {
          agentId: string;
          config: Partial<{ name: string; role: string; provider: string; model: string; systemPrompt: string; permissions: any; sandbox: any; tools: string[]; skills: string[] }>;
        };
        if (!agentId) {
          this.sendToClient(ws, { type: "error", payload: { message: "agentId is required" } });
          break;
        }
        const agent = this.agentRegistry?.get(agentId);
        if (!agent) {
          this.sendToClient(ws, { type: "error", payload: { message: `Agent not found: ${agentId}` } });
          break;
        }
        // Update agent config.json
        const agentPaths = AgentPaths.forAgent(agentId, this.dataRoot);
        const files = new AgentFiles(agentPaths);
        const currentConfig = files.readConfig();
        const merged = { ...currentConfig, ...config };
        files.writeConfig(merged);
        // Also update in-memory config
        Object.assign(agent.config, config);
        this.logMessage("system", `Agent updated: ${agentId}`);
        this.sendToClient(ws, { type: "agent_updated", payload: { agentId } });
        this.broadcastState();
        break;
      }

      case "get_skills": {
        if (!this.skillRepo) {
          this.sendToClient(ws, { type: "skill_list", payload: { skills: [] } });
          break;
        }
        const skills = this.skillRepo.list().map(s => ({
          name: s.name,
          description: s.description,
          tools: [] as string[],
        }));
        this.sendToClient(ws, { type: "skill_list", payload: { skills } });
        break;
      }

      case "get_skill_doc": {
        const { name } = msg.payload as { name: string };
        if (!name) {
          this.sendToClient(ws, { type: "error", payload: { message: "name is required" } });
          break;
        }
        if (!this.skillRepo) {
          this.sendToClient(ws, { type: "skill_doc", payload: { name, content: null } });
          break;
        }
        const skill = this.skillRepo.get(name);
        if (!skill) {
          this.sendToClient(ws, { type: "skill_doc", payload: { name, content: null } });
          break;
        }
        this.sendToClient(ws, { type: "skill_doc", payload: { name, content: skill.body } });
        break;
      }

      case "execute_skill": {
        const { name, task, params } = msg.payload as { name: string; task: string; params?: Record<string, unknown> };
        if (!name || !task) {
          this.sendToClient(ws, { type: "error", payload: { message: "name and task are required" } });
          break;
        }
        if (!this.skillRepo || !this.providerResolver) {
          this.sendToClient(ws, { type: "error", payload: { message: "Skill system not available" } });
          break;
        }
        const defaultProvider = this.providerResolver("deepseek");
        if (!defaultProvider) {
          this.sendToClient(ws, { type: "error", payload: { message: "No default provider available" } });
          break;
        }
        this.skillRepo.execute(name, task, params || {}, () => defaultProvider)
          .then((result) => {
            this.sendToClient(ws, { type: "skill_result", payload: { name, result } });
          })
          .catch((err) => {
            this.sendToClient(ws, { type: "error", payload: { message: `Skill execution failed: ${err.message}` } });
          });
        break;
      }

      case "skill_create": {
        const { name: sName, description: sDesc, prompt: sPrompt } = msg.payload as {
          name: string; description: string; prompt: string;
        };
        if (!sName || !sDesc || !sPrompt) {
          this.sendToClient(ws, { type: "error", payload: { message: "name, description and prompt are required" } });
          break;
        }
        if (!this.skillRepo) {
          this.sendToClient(ws, { type: "error", payload: { message: "Skill system not available" } });
          break;
        }
        this.skillRepo.create(sName, sDesc, sPrompt);
        this.sendToClient(ws, { type: "skill_created", payload: { name: sName } });
        break;
      }

      case "add_group_member": {
        const { groupId: addGId, agentId: addAId } = msg.payload as { groupId: string; agentId: string };
        if (!addGId || !addAId) {
          this.sendToClient(ws, { type: "error", payload: { message: "groupId and agentId are required" } });
          break;
        }
        const addGroup = this.groupManager?.get(addGId);
        if (!addGroup) {
          this.sendToClient(ws, { type: "error", payload: { message: `Group not found: ${addGId}` } });
          break;
        }
        addGroup.addMember(addAId);
        this.groupManager!.saveGroup(addGId);
        // Update ButlerRegistry
        const addButlerReg = new ButlerRegistry(this.dataRoot);
        const addGEntry = addButlerReg.parseGroupsRegistry().find(g => g.id === addGId);
        if (addGEntry) {
          addButlerReg.registerGroup({ ...addGEntry, members: [...addGEntry.members, addAId] });
        }
        this.sendToClient(ws, { type: "member_added", payload: { groupId: addGId, agentId: addAId } });
        this.broadcastState();
        break;
      }

      case "remove_group_member": {
        const { groupId: rmGId, agentId: rmAId } = msg.payload as { groupId: string; agentId: string };
        if (!rmGId || !rmAId) {
          this.sendToClient(ws, { type: "error", payload: { message: "groupId and agentId are required" } });
          break;
        }
        // 群主不可被移除
        if (rmAId === "host") {
          this.sendToClient(ws, { type: "error", payload: { message: "群主不可被移除" } });
          break;
        }
        const rmGroup = this.groupManager?.get(rmGId);
        if (!rmGroup) {
          this.sendToClient(ws, { type: "error", payload: { message: `Group not found: ${rmGId}` } });
          break;
        }
        rmGroup.removeMember(rmAId);
        this.groupManager!.saveGroup(rmGId);
        // Update ButlerRegistry
        const rmButlerReg = new ButlerRegistry(this.dataRoot);
        const rmGEntry = rmButlerReg.parseGroupsRegistry().find(g => g.id === rmGId);
        if (rmGEntry) {
          rmButlerReg.registerGroup({ ...rmGEntry, members: rmGEntry.members.filter(m => m !== rmAId) });
        }
        this.sendToClient(ws, { type: "member_removed", payload: { groupId: rmGId, agentId: rmAId } });
        this.broadcastState();
        break;
      }

      case "get_group_workspace": {
        const { groupId: wsGId } = msg.payload as { groupId: string };
        if (!wsGId) {
          this.sendToClient(ws, { type: "error", payload: { message: "groupId is required" } });
          break;
        }
        const wsGroup = this.groupManager?.get(wsGId);
        if (!wsGroup) {
          this.sendToClient(ws, { type: "error", payload: { message: `Group not found: ${wsGId}` } });
          break;
        }
        const summary = wsGroup.workspace.getSummary();
        this.sendToClient(ws, {
          type: "group_workspace",
          payload: { groupId: wsGId, docs: summary },
        });
        break;
      }

      case "get_group_workspace_file": {
        const { groupId: gfGId, filename: gfName } = msg.payload as { groupId: string; filename: string };
        if (!gfGId || !gfName) {
          this.sendToClient(ws, { type: "error", payload: { message: "groupId and filename are required" } });
          break;
        }
        if (gfName.includes("..") || path.isAbsolute(gfName)) {
          this.sendToClient(ws, { type: "error", payload: { message: "Invalid filename" } });
          break;
        }
        const gfGroup = this.groupManager?.get(gfGId);
        if (!gfGroup) {
          this.sendToClient(ws, { type: "error", payload: { message: `Group not found: ${gfGId}` } });
          break;
        }
        const gfPath = path.join(this.dataRoot, "groups", gfGId, gfName);
        const content = fs.existsSync(gfPath) ? fs.readFileSync(gfPath, "utf-8") : "";
        this.sendToClient(ws, {
          type: "group_workspace_file",
          payload: { groupId: gfGId, filename: gfName, content },
        });
        break;
      }

      case "save_group_workspace_file": {
        const { groupId: sfGId, filename: sfName, content: sfContent } = msg.payload as {
          groupId: string; filename: string; content: string;
        };
        if (!sfGId || !sfName || sfContent === undefined) {
          this.sendToClient(ws, { type: "error", payload: { message: "groupId, filename and content are required" } });
          break;
        }
        if (sfName.includes("..") || path.isAbsolute(sfName)) {
          this.sendToClient(ws, { type: "error", payload: { message: "Invalid filename" } });
          break;
        }
        const sfDir = path.join(this.dataRoot, "groups", sfGId);
        if (!fs.existsSync(sfDir)) fs.mkdirSync(sfDir, { recursive: true });
        fs.writeFileSync(path.join(sfDir, sfName), sfContent, "utf-8");
        this.sendToClient(ws, {
          type: "group_workspace_file_saved",
          payload: { groupId: sfGId, filename: sfName },
        });
        break;
      }

      case "get_agent_files": {
        const { agentId: aId } = msg.payload as { agentId: string };
        if (!aId) {
          this.sendToClient(ws, { type: "error", payload: { message: "agentId is required" } });
          break;
        }
        const aPaths = AgentPaths.forAgent(aId, this.dataRoot);
        const dir = aPaths.directory;
        if (!fs.existsSync(dir)) {
          this.sendToClient(ws, { type: "agent_files", payload: { agentId: aId, files: [] } });
          break;
        }
        const fileList = fs.readdirSync(dir)
          .filter(f => f.endsWith(".md") || f.endsWith(".json"))
          .map(name => {
            const stat = fs.statSync(path.join(dir, name));
            return { name, size: stat.size, modified: stat.mtime.toISOString() };
          });
        this.sendToClient(ws, { type: "agent_files", payload: { agentId: aId, files: fileList } });
        break;
      }

      case "read_agent_file": {
        const { agentId: rAId, filename } = msg.payload as { agentId: string; filename: string };
        if (!rAId || !filename) {
          this.sendToClient(ws, { type: "error", payload: { message: "agentId and filename are required" } });
          break;
        }
        // Security: prevent path traversal
        if (filename.includes("..") || path.isAbsolute(filename)) {
          this.sendToClient(ws, { type: "error", payload: { message: "Invalid filename" } });
          break;
        }
        const rPaths = AgentPaths.forAgent(rAId, this.dataRoot);
        const filePath = path.join(rPaths.directory, filename);
        if (!fs.existsSync(filePath)) {
          this.sendToClient(ws, { type: "agent_file_content", payload: { agentId: rAId, filename, content: "" } });
          break;
        }
        const content = fs.readFileSync(filePath, "utf-8");
        this.sendToClient(ws, { type: "agent_file_content", payload: { agentId: rAId, filename, content } });
        break;
      }

      case "write_agent_file": {
        const { agentId: wAId, filename: wFilename, content: wContent } = msg.payload as {
          agentId: string; filename: string; content: string;
        };
        if (!wAId || !wFilename || wContent === undefined) {
          this.sendToClient(ws, { type: "error", payload: { message: "agentId, filename and content are required" } });
          break;
        }
        if (wFilename.includes("..") || path.isAbsolute(wFilename)) {
          this.sendToClient(ws, { type: "error", payload: { message: "Invalid filename" } });
          break;
        }
        const wPaths = AgentPaths.forAgent(wAId, this.dataRoot);
        const wFilePath = path.join(wPaths.directory, wFilename);
        fs.writeFileSync(wFilePath, wContent, "utf-8");
        this.sendToClient(ws, { type: "file_saved", payload: { agentId: wAId, filename: wFilename } });
        break;
      }

      case "get_chat_current": {
        // Read current.md from each agent's memory/ directory
        const conversations: Record<string, unknown[]> = {};
        const agentsDir = path.join(this.dataRoot, "agents");
        if (fs.existsSync(agentsDir)) {
          for (const entry of fs.readdirSync(agentsDir, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
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
        // Also read group current.md
        const groupsDir = path.join(this.dataRoot, "groups");
        if (fs.existsSync(groupsDir)) {
          for (const entry of fs.readdirSync(groupsDir, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
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
        break;
      }

      case "save_chat_current": {
        const { conversations: saveConvs } = msg.payload as { conversations: Record<string, unknown[]> };
        if (!saveConvs) break;
        for (const [convId, msgs] of Object.entries(saveConvs)) {
          if (!Array.isArray(msgs) || msgs.length === 0) continue;
          // Determine path: try agents/ first, then groups/
          let memDir = path.join(this.dataRoot, "agents", convId, "memory");
          if (!fs.existsSync(path.join(this.dataRoot, "agents", convId))) {
            memDir = path.join(this.dataRoot, "groups", convId, "memory");
          }
          if (!fs.existsSync(memDir)) fs.mkdirSync(memDir, { recursive: true });
          const curPath = path.join(memDir, "current.md");
          const jsonStr = JSON.stringify({ messages: msgs, savedAt: Date.now() }, null, 2);
          const mdContent = `# Current Chat History\n\n> Auto-saved by CoBeing. Do not edit manually.\n\n\`\`\`json\n${jsonStr}\n\`\`\`\n`;
          fs.writeFileSync(curPath, mdContent, "utf-8");
        }
        break;
      }

      case "clear_chat_current": {
        // Clear all agent current.md
        const clrAgentsDir = path.join(this.dataRoot, "agents");
        if (fs.existsSync(clrAgentsDir)) {
          for (const entry of fs.readdirSync(clrAgentsDir, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const curPath = path.join(clrAgentsDir, entry.name, "memory", "current.md");
            if (fs.existsSync(curPath)) {
              const empty = `# Current Chat History\n\n> Cleared.\n\n\`\`\`json\n${JSON.stringify({ messages: [], savedAt: Date.now() }, null, 2)}\n\`\`\`\n`;
              fs.writeFileSync(curPath, empty, "utf-8");
            }
          }
        }
        // Clear all group current.md
        const clrGroupsDir = path.join(this.dataRoot, "groups");
        if (fs.existsSync(clrGroupsDir)) {
          for (const entry of fs.readdirSync(clrGroupsDir, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const curPath = path.join(clrGroupsDir, entry.name, "memory", "current.md");
            if (fs.existsSync(curPath)) {
              const empty = `# Current Chat History\n\n> Cleared.\n\n\`\`\`json\n${JSON.stringify({ messages: [], savedAt: Date.now() }, null, 2)}\n\`\`\`\n`;
              fs.writeFileSync(curPath, empty, "utf-8");
            }
          }
        }
        this.sendToClient(ws, { type: "chat_current_cleared", payload: { success: true } });
        break;
      }

      case "get_todos": {
        const { scope, agentId, groupId } = msg.payload as {
          scope: "agent" | "group"; agentId?: string; groupId?: string;
        };
        const store = this.resolveTodoStore(scope, agentId, groupId);
        if (!store) {
          this.sendToClient(ws, { type: "error", payload: { message: "无法确定 TODO 存储" } });
          break;
        }
        this.sendToClient(ws, { type: "todos", payload: { todos: store.list() } });
        break;
      }

      case "add_todo": {
        const { title, description, triggerAt, recurrenceHint, scope, agentId, groupId, targetAgentId, onComplete } = msg.payload as {
          title: string; description: string; triggerAt: string; recurrenceHint: string;
          scope: "agent" | "group"; agentId?: string; groupId?: string;
          targetAgentId?: string; onComplete?: any;
        };
        const store = this.resolveTodoStore(scope, agentId, groupId);
        if (!store) {
          this.sendToClient(ws, { type: "error", payload: { message: "无法确定 TODO 存储" } });
          break;
        }
        const item = store.add({
          title, description, triggerAt, recurrenceHint,
          createdBy: "user",
          agentId: scope === "agent" ? agentId : undefined,
          targetAgentId: scope === "group" ? targetAgentId : undefined,
          onComplete,
        });
        this.sendToClient(ws, { type: "todo_added", payload: { todo: item } });
        this.broadcast({ type: "todo_updated", payload: { scope, agentId, groupId } });
        break;
      }

      case "complete_todo": {
        const { todoId, scope, agentId, groupId } = msg.payload as {
          todoId: string; scope: "agent" | "group"; agentId?: string; groupId?: string;
        };
        const store = this.resolveTodoStore(scope, agentId, groupId);
        if (!store) {
          this.sendToClient(ws, { type: "error", payload: { message: "无法确定 TODO 存储" } });
          break;
        }
        const item = store.complete(todoId);
        if (!item) {
          this.sendToClient(ws, { type: "error", payload: { message: `TODO not found: ${todoId}` } });
          break;
        }
        this.sendToClient(ws, { type: "todo_completed", payload: { todo: item } });
        this.broadcast({ type: "todo_updated", payload: { scope, agentId, groupId } });
        break;
      }

      case "remove_todo": {
        const { todoId: rTodoId, scope: rScope, agentId: rAgentId, groupId: rGroupId } = msg.payload as {
          todoId: string; scope: "agent" | "group"; agentId?: string; groupId?: string;
        };
        const store = this.resolveTodoStore(rScope, rAgentId, rGroupId);
        if (!store) {
          this.sendToClient(ws, { type: "error", payload: { message: "无法确定 TODO 存储" } });
          break;
        }
        const ok = store.remove(rTodoId);
        if (!ok) {
          this.sendToClient(ws, { type: "error", payload: { message: `TODO not found: ${rTodoId}` } });
          break;
        }
        this.sendToClient(ws, { type: "todo_removed", payload: { todoId: rTodoId } });
        this.broadcast({ type: "todo_updated", payload: { scope: rScope, agentId: rAgentId, groupId: rGroupId } });
        break;
      }

      case "get_sandbox_status": {
        const agents = this.agentRegistry?.list() ?? [];
        const statuses = agents.map(agent => {
          const sandboxRunner = (agent as any).sandboxRunner;
          const status = sandboxRunner?.getStatus() ?? { containerId: null, running: false };

          return {
            agentId: agent.id,
            agentName: agent.name,
            containerId: status.containerId,
            running: status.running,
            uptime: 0,
            memoryUsage: 0,
            memoryLimit: 0,
            cpuPercent: 0,
            diskUsage: 0,
            diskLimit: 0,
          };
        });

        this.sendToClient(ws, { type: "sandbox_status", payload: statuses });
        break;
      }

      case "sandbox_action": {
        const { agentId, action } = msg.payload as { agentId: string; action: "start" | "stop" | "restart" | "delete" };
        const agent = this.agentRegistry?.get(agentId);

        if (!agent) {
          this.sendToClient(ws, { type: "error", payload: { message: `Agent not found: ${agentId}` } });
          break;
        }

        const sandboxRunner = (agent as any).sandboxRunner;
        if (!sandboxRunner) {
          this.sendToClient(ws, { type: "error", payload: { message: `Agent ${agentId} has no sandbox` } });
          break;
        }

        try {
          switch (action) {
            case "stop":
            case "delete":
              await sandboxRunner.destroy();
              break;
            case "restart":
              await sandboxRunner.destroy();
              break;
          }
          this.sendToClient(ws, { type: "sandbox_action_result", payload: { agentId, action, success: true } });
        } catch (err: any) {
          this.sendToClient(ws, { type: "sandbox_action_result", payload: { agentId, action, success: false, error: err.message } });
        }
        break;
      }

      default:
        log.warn("Unknown WS message type: %s", msg.type);
    }
  }

  /** 解析 TODO Store（Agent 级或群组级） */
  private resolveTodoStore(scope: "agent" | "group", agentId?: string, groupId?: string): TodoStore | undefined {
    if (scope === "group" && groupId) {
      return this.groupManager?.getGroupTodoStore?.(groupId);
    } else if (agentId) {
      return new TodoStore(path.join(this.dataRoot, "agents", agentId));
    }
    return undefined;
  }

  private getState() {
    const agents = this.agentRegistry
      ? this.agentRegistry.list().map(a => ({
          id: a.id,
          name: a.name,
          role: a.config.role,
          status: a.getStatus(),
          model: a.config.model,
          provider: a.config.provider,
        }))
      : [];

    const groups = this.groupManager
      ? this.groupManager.list().map(g => ({
          id: g.id,
          name: g.config.name,
          members: g.config.members,
          topic: g.config.topic,
        }))
      : [];

    return {
      agents,
      groups,
      channels: [] as string[],
      timestamp: Date.now(),
    };
  }

  private sendToClient(ws: WebSocket, msg: WSMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }
}

/** 按 "a.b.c" 路径设置嵌套对象值 */
/** Extract @mentions from content */
function extractMentions(content: string): string[] {
  const matches = content.match(/@([\w-]+)/g);
  return matches ? [...new Set(matches.map(m => m.slice(1)))] : [];
}

/** 解析 current.md 内容：支持 JSONL 和 markdown 包裹 JSON 两种格式 */
function parseCurrentMd(raw: string): unknown[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  /** 将内部消息格式转换为前端 LogMessage 格式 */
  function toFrontendMsg(obj: Record<string, unknown>): Record<string, unknown> {
    const fromAgentId = obj.fromAgentId as string | undefined;
    return {
      direction: fromAgentId === "user" ? "in" : "out",
      content: obj.content,
      timestamp: obj.timestamp,
      senderId: fromAgentId,
    };
  }

  // 1. 尝试 markdown 包裹 JSON 格式
  const jsonMatch = trimmed.match(/```json\n([\s\S]*?)\n```/);
  if (jsonMatch) {
    try {
      const data = JSON.parse(jsonMatch[1]);
      if (data.messages && Array.isArray(data.messages)) {
        return data.messages.map((m: Record<string, unknown>) =>
          m.senderId ? m : toFrontendMsg(m),
        );
      }
    } catch { /* fall through */ }
  }

  // 2. 尝试 JSONL 格式（每行一个 JSON 对象，来自 CurrentMd.append）
  const lines = trimmed.split("\n").filter(Boolean);
  const messages: unknown[] = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj && typeof obj === "object" && obj.id && obj.content) {
        messages.push(toFrontendMsg(obj));
      }
    } catch { /* skip non-JSON lines (e.g. markdown headers) */ }
  }
  return messages;
}

/** 按 "a.b.c" 路径设置嵌套对象值 */
function setNestedValue(obj: Record<string, unknown>, cfgPath: string, value: unknown): void {
  const keys = cfgPath.split(".");
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!(keys[i] in current) || typeof current[keys[i]] !== "object") {
      current[keys[i]] = {};
    }
    current = current[keys[i]] as Record<string, unknown>;
  }
  current[keys[keys.length - 1]] = value;
}
