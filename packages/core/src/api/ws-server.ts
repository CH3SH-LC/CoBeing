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
import type { AgentConfig, ReviewLogEvent } from "@cobeing/shared";
import { encrypt, decrypt } from "../config/secret-store.js";
import { SubAgentSpawner } from "../agent/spawner.js";
import { rmDirRecursive, addAgentToRegistry, removeAgentFromRegistry, addGroupToRegistry, removeGroupFromRegistry, updateGroupMembers } from "@cobeing/shared";
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

  constructor(private port: number = 18765, private configPath?: string) {
    (globalThis as any).__cobeingWSServer = this;
  }

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
          metadata: undefined,
        },
      });
    });
    // 设置 Agent 事件广播回调（agent_started / agent_completed / agent_error）
    gm.setOnAgentEvent((event) => {
      this.broadcast({
        type: event.type,
        payload: {
          agentId: event.agentId,
          agentName: event.agentName,
          groupId: event.groupId,
          mentions: event.mentions,
          error: (event as any).error,
          timestamp: Date.now(),
        },
      });
    });

    // 设置唤醒队列变更回调
    gm.setOnQueueChange((groupId, queueData) => {
      this.broadcast({
        type: "wake_queue_update",
        payload: { groupId, queue: queueData.queue, processing: queueData.processing, processingAgents: queueData.processingAgents, timestamp: Date.now() },
      });
    });

    // 设置消息广播回调 — postMessage 时广播 metadata（reviewOverridden 等）
    gm.setOnMessageBroadcast((groupId, msg) => {
      this.broadcast({
        type: "group_message",
        payload: {
          groupId,
          fromAgentId: msg.fromAgentId,
          content: msg.content,
          mentions: msg.mentions,
          timestamp: msg.timestamp,
          metadata: msg.metadata,
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
      this.wss = new WebSocketServer({ port: this.port, host: "127.0.0.1" });

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

  async stop(): Promise<void> {
    // 通知所有客户端立即保存数据，然后等待 flush
    this.broadcast({ type: "server_shutting_down", payload: { timestamp: Date.now() } });
    await new Promise(resolve => setTimeout(resolve, 800));
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

  /** 广播审核日志事件到所有 GUI 客户端 */
  emitReviewLog(event: ReviewLogEvent): void {
    this.broadcast({
      type: "review_log",
      payload: event,
    });
  }

  private async handleMessage(ws: WebSocket, msg: WSMessage): Promise<void> {
    switch (msg.type) {
      case "get_state":
        this.sendToClient(ws, { type: "state", payload: this.getState() });
        break;

      case "get_wake_queue": {
        const queues = this.groupManager?.getAllWakeQueues() ?? {};
        const formatted: Record<string, { groupId: string; groupName: string; queue: any[]; processing: string | null; processingAgents: string[] }> = {};
        for (const [gid, data] of Object.entries(queues)) {
          const group = this.groupManager?.get(gid);
          const groupName: string = (group as any)?.config?.name || gid;
          formatted[gid] = { groupId: gid, groupName, queue: data.queue, processing: data.processing, processingAgents: data.processingAgents ?? [] };
        }
        // 额外收集所有非空闲 Agent（含直接对话和 TODO 触发路径）
        const activeAgents: Array<{ agentId: string; agentName: string; status: string; groupId?: string }> = [];
        const allAgents = this.agentRegistry?.list() ?? [];
        for (const a of allAgents) {
          const st = a.getStatus();
          if (st !== "idle") {
            activeAgents.push({ agentId: a.id, agentName: a.name, status: st });
          }
        }
        this.sendToClient(ws, { type: "wake_queue_update", payload: { queues: formatted, activeAgents, timestamp: Date.now() } });
        break;
      }

      case "send_message": {
        const { agentId, content } = msg.payload as { agentId: string; content: string };
        const agent = this.agentRegistry?.get(agentId);
        if (!agent) {
          this.sendToClient(ws, { type: "error", payload: { message: `Agent not found: ${agentId}` } });
          break;
        }
        // Check if this is a group-context message (content starts with [群组 groupId])
        const groupMatch = content.match(/^\[群组 ([^\]]+)\]\s*(.*)/s);
        let collabContext: string | undefined;
        if (groupMatch) {
          const gId = groupMatch[1];
          const gContent = groupMatch[2];
          const group = this.groupManager?.get(gId);
          if (group) {
            // Post to group context
            group.postMessage("user", gContent);

            // 构建群组协作上下文（局部变量，通过 run() 参数传递，不设置 Agent 全局状态）
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

            collabContext = buildGroupCollaborationContext(
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
          }
        }

        this.logMessage("in", content);
        // 广播 agent 开始处理 — 前端用于显示触发链路
        const triggerContent = groupMatch ? groupMatch[2] : content;
        const channelId = groupMatch ? groupMatch[1] : agentId;
        // 提取 @mentions 并按 resolved agent ID 去重，附加通道信息
        const rawMentions = triggerContent.match(/@([\w一-鿿][\w一-鿿-]{2,})/g)?.map(m => m.slice(1)) || [];
        const seenIds = new Set<string>();
        const dedupedMentions: Array<{ text: string; channel: string }> = [];
        for (const m of rawMentions) {
          const resolved = this.agentRegistry?.get(m)?.id
            || this.agentRegistry?.list().find(a => a.name === m)?.id
            || m;
          if (!seenIds.has(resolved)) {
            seenIds.add(resolved);
            dedupedMentions.push({ text: `@${m}`, channel: channelId });
          }
        }
        this.broadcast({
          type: "agent_started",
          payload: {
            agentId,
            agentName: agent.config?.name || agentId,
            groupId: groupMatch ? groupMatch[1] : undefined,
            mentions: dedupedMentions.length > 0 ? dedupedMentions : undefined,
            timestamp: Date.now(),
          },
        });
        agent.run(content, {
          groupId: groupMatch ? groupMatch[1] : undefined,
          groupContext: collabContext,
          workingDir: groupMatch ? this.groupManager?.get(groupMatch[1])?.effectiveWorkspace : undefined,
          events: {
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
            onUsage: (usage) => {
              this.broadcast({
                type: "usage_stats",
                payload: {
                  agentId,
                  inputTokens: usage.inputTokens,
                  outputTokens: usage.outputTokens,
                  cacheHitTokens: usage.cacheHitTokens ?? 0,
                  cacheMissTokens: usage.cacheMissTokens ?? 0,
                  timestamp: Date.now(),
                },
              });
            },
          },
        }).then((response) => {

          this.logMessage("out", response.content);
          this.sendToClient(ws, { type: "agent_response", payload: { content: response.content, groupId: groupMatch?.[1], agentId, agentName: agent.config?.name || agentId } });

          // 检查回复是否包含错误
          const isError = response.content.startsWith("⚠️") || response.content.startsWith("[错误]") || response.content === "达到最大工具调用轮数限制";

          // 广播 agent 完成/错误处理
          this.broadcast({
            type: isError ? "agent_error" : "agent_completed",
            payload: {
              agentId,
              agentName: agent.config?.name || agentId,
              groupId: groupMatch ? groupMatch[1] : undefined,
              error: isError ? response.content : undefined,
              timestamp: Date.now(),
            },
          });
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
                metadata: undefined,
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
          // 广播 agent_error
          this.broadcast({
            type: "agent_error",
            payload: {
              agentId,
              agentName: agent.config?.name || agentId,
              groupId: groupMatch ? groupMatch[1] : undefined,
              error: `AI 服务异常: ${errMsg.slice(0, 200)}`,
              timestamp: Date.now(),
            },
          });
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
          // 解密所有 provider 的 apiKey（用于解析环境变量，但不返回明文）
          if (config.providers) {
            for (const prov of Object.values(config.providers) as Array<Record<string, unknown>>) {
              if (typeof prov.apiKey === "string") {
                const decrypted = decrypt(prov.apiKey);
                prov.apiKey = decrypted;
              }
            }
            resolveProviderApiKeys(config.providers as Record<string, Record<string, unknown>>);
            // 移除明文 apiKey，只保留掩码值 _apiKeyResolved
            for (const prov of Object.values(config.providers) as Array<Record<string, unknown>>) {
              delete prov.apiKey;
            }
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
            // 防止前端将掩码值（含 ****）回传导致加密损坏
            if (value.includes("****")) {
              // 跳过更新 apiKey，保留现有加密值
              this.sendToClient(ws, { type: "config_updated", payload: { path: cfgPath, success: true } });
              break;
            }
            storedValue = encrypt(value);
          }
          // 如果更新的是整个 provider 对象且含 apiKey，加密其中的 apiKey
          if (cfgPath.match(/^providers\.[^.]+$/) && typeof value === "object" && value !== null) {
            const obj = value as Record<string, unknown>;
            if (typeof obj.apiKey === "string" && obj.apiKey) {
              if (obj.apiKey.includes("****")) {
                // 掩码值，使用现有加密 key
                const existing = config.providers?.[cfgPath.split(".").pop()!] as Record<string, unknown> | undefined;
                storedValue = { ...obj, apiKey: existing?.apiKey ?? obj.apiKey };
              } else {
                storedValue = { ...obj, apiKey: encrypt(obj.apiKey) };
              }
            } else if (!("apiKey" in obj) || obj.apiKey === undefined || obj.apiKey === "") {
              // 未传 apiKey：保留现有加密值，防止误删
              const existing = config.providers?.[cfgPath.split(".").pop()!] as Record<string, unknown> | undefined;
              if (existing?.apiKey) {
                storedValue = { ...obj, apiKey: existing.apiKey };
              }
            }
          }

          setNestedValue(config, cfgPath, storedValue);
          fs.writeFileSync(configFilePath, JSON.stringify(config, null, 2) + "\n", "utf-8");
          this.sendToClient(ws, { type: "config_updated", payload: { path: cfgPath, success: true } });

          // 广播配置时解密 apiKey + 解析环境变量（但不返回明文）
          const broadcastConfig = JSON.parse(JSON.stringify(config));
          if (broadcastConfig.providers) {
            for (const prov of Object.values(broadcastConfig.providers) as Array<Record<string, unknown>>) {
              if (typeof prov.apiKey === "string") {
                prov.apiKey = decrypt(prov.apiKey);
              }
            }
            resolveProviderApiKeys(broadcastConfig.providers as Record<string, Record<string, unknown>>);
            for (const prov of Object.values(broadcastConfig.providers) as Array<Record<string, unknown>>) {
              delete prov.apiKey;
            }
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
          tools: ["bash", "read-file", "write-file", "edit-file", "glob", "grep", "web-fetch", "agent-message"],
          skills,
        };

        // Write config to agent directory
        const agentPaths = AgentPaths.forAgent(id, this.dataRoot);
        agentPaths.ensureDirs();
        new AgentFiles(agentPaths).writeConfig({
          name, role, provider: providerId, model: modelId,
          permissions: { mode: "workspace-write" },
          sandbox: sandboxConfig,
          tools: ["bash", "read-file", "write-file", "edit-file", "glob", "grep", "web-fetch", "agent-message"],
          skills,
        });

        // 用子智能体生成核心文件（soul/character/job/bootstrap）
        const provided: Record<string, string> = {};
        const missing = ["soul", "character", "job", "bootstrap"];

        try {
          const spawner = new SubAgentSpawner(config, prov, agentPaths.workspaceDir);
          const creatorSystemPrompt = `你是 Agent 创建专家。你的任务是为一个新 Agent 生成核心文件内容。

核心文件定义：
- soul: AI 的性格特质和行为准则。像个人说话，不要像客服。用聊天的语气。
- character: AI 的人物描写 — 姓名、背景、个性。要像一个活生生的人，有口癖、有小习惯、有态度。不要"专业、严谨、有条理"这种空话。
- job: AI 的专注领域 — 擅长什么、如何工作。写具体工具和方法论。
- bootstrap: Agent 出生时就知道的关键知识。可写入项目背景、行为提醒等。

要求：
- character 必须有血有肉：写出说话习惯、背景故事、真实的小癖好
- 像个人，不像客服。回答简洁自然
- 性格别太极端——但要有温度、有态度
- job 必须具体：列出擅长做的事、使用的工具、工作方式
- 定位面向技能领域，不面向具体项目
- 所有内容用中文写`;

          const generated = await spawner.spawnForJSON({
            systemPrompt: creatorSystemPrompt,
            task: `为 Agent "${name}" 生成核心文件。角色：${role}。请生成以下字段：${missing.join(", ")}`,
            expectedFields: missing,
          });

          for (const field of missing) {
            if (generated[field]) {
              provided[field] = generated[field];
            }
          }
          log.info("Sub-agent generated files for %s: %s", id, missing.filter(f => generated[f]).join(", "));
        } catch (err) {
          log.warn("Sub-agent generation failed for %s, falling back to templates: %s", id, err);
        }

        // 写入 LLM 生成的内容
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

        // 从模板复制其余文件（USER, AGENTS, TOOLS, MEMORY, EXPERIENCE — 仅未生成或未写入的）
        const templatesDir = path.resolve("config/templates");
        const templateFiles = ["SOUL.md", "CHARACTER.md", "JOB.md", "USER.md", "AGENTS.md", "TOOLS.md", "MEMORY.md", "EXPERIENCE.md", "BOOTSTRAP.md"];
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
        const runtime = (globalThis as any).__cobeingRuntime;
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

        // 为初始成员注入群组通信工具
        for (const memberId of allMembers) {
          const mAgent = this.agentRegistry?.get(memberId);
          if (mAgent && this.groupManager) {
            mAgent.injectGroupTools((gid) => this.groupManager!.get(gid));
          }
        }

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

        // 唤醒群主与用户对接（不唤醒组员）
        const newGroup = this.groupManager!.get(id);
        if (newGroup) {
          newGroup.postMessage("system", `@host 新群组"${name}"已创建，成员包括：${allMembers.map(m => {
            const a = this.agentRegistry?.get(m);
            return a?.name ?? m;
          }).join("、")}。请与用户对接，明确任务目标和分工方案。`);
        }
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
          await agent.dispose();
        } catch (e: any) {
          log.error("Failed to dispose agent %s: %s", agentId, e.message);
        }
        this.agentRegistry!.unregister(agentId);
        // 从 master registry 移除
        removeAgentFromRegistry(this.dataRoot, agentId);
        // 删除本地数据目录
        const agentPaths = AgentPaths.forAgent(agentId, this.dataRoot);
        try {
          rmDirRecursive(agentPaths.directory);
          log.info("Deleted agent data: %s", agentPaths.directory);
        } catch (e: any) {
          log.error("Failed to delete agent data %s: %s", agentPaths.directory, e.message);
          // Fallback: at least delete/rename config.json to prevent resurrection on restart
          try {
            if (fs.existsSync(agentPaths.configPath)) {
              try {
                fs.unlinkSync(agentPaths.configPath);
                log.info("Deleted config.json to prevent agent resurrection: %s", agentPaths.configPath);
              } catch (unlinkErr: any) {
                const renamedPath = agentPaths.configPath + ".deleted." + Date.now();
                fs.renameSync(agentPaths.configPath, renamedPath);
                log.info("Renamed config.json to prevent agent resurrection: %s", renamedPath);
              }
            }
          } catch (e2: any) {
            log.error("Failed to delete/rename config.json %s: %s", agentPaths.configPath, e2.message);
          }
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
        // 发送解散通知
        const groupName = group.config.name;
        const memberNames = group.config.members.map((m: string) => {
          const a = this.agentRegistry?.get(m);
          return a?.name ?? m;
        }).join("、");
        try {
          group.postMessage("system", `[系统] 群组 "${groupName}" 已被解散。前成员: ${memberNames}。相关文件已清理。`);
        } catch {}
        this.groupManager!.delete(groupId);
        const butlerReg = new ButlerRegistry(this.dataRoot);
        butlerReg.unregisterGroup(groupId);
        this.logMessage("system", `Group destroyed: ${groupId}`);
        this.sendToClient(ws, { type: "group_destroyed", payload: { groupId } });
        this.broadcastState();
        break;
      }

      case "stop_agent": {
        const { agentId: stopId } = msg.payload as { agentId: string };
        const target = this.agentRegistry?.get(stopId);
        if (!target) { this.sendToClient(ws, { type: "error", payload: { message: `Agent not found: ${stopId}` } }); break; }
        target.stop();
        this.sendToClient(ws, { type: "agent_stopped", payload: { agentId: stopId } });
        this.broadcastState();
        break;
      }

      case "bind_workspace": {
        const { agentId, workspacePath } = msg.payload as { agentId: string; workspacePath?: string };
        const agent = this.agentRegistry?.get(agentId);
        if (!agent) {
          this.sendToClient(ws, { type: "error", payload: { message: `Agent not found: ${agentId}` } });
          break;
        }
        const raw = workspacePath?.trim();
        if (!raw || raw === "default") {
          agent.setBoundWorkspace(null);
          this.sendToClient(ws, { type: "workspace_bound", payload: { agentId, path: null, effectiveWorkspace: agent.effectiveWorkspace } });
          this.logMessage("system", `Workspace unbound for ${agent.name}, restored: ${agent.effectiveWorkspace}`);
          break;
        }
        const resolved = path.resolve(raw);
        if (!fs.existsSync(resolved)) {
          this.sendToClient(ws, { type: "error", payload: { message: `Directory not found: ${resolved}` } });
          break;
        }
        agent.setBoundWorkspace(resolved);
        this.sendToClient(ws, { type: "workspace_bound", payload: { agentId, path: resolved, effectiveWorkspace: agent.effectiveWorkspace } });
        this.logMessage("system", `Workspace bound for ${agent.name}: ${resolved}`);
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
        agent.rebuildLoop();
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
        // 为新成员注入群组通信工具
        const addAgent = this.agentRegistry?.get(addAId);
        if (addAgent && this.groupManager) {
          addAgent.injectGroupTools((gid) => this.groupManager!.get(gid));
        }
        // 更新 master registry
        updateGroupMembers(this.dataRoot, addGId, addGroup.config.members);
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
        // 更新 master registry
        updateGroupMembers(this.dataRoot, rmGId, rmGroup.config.members);
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

      case "get_group_history": {
        const { groupId, before, limit } = msg.payload as { groupId: string; before?: number; limit?: number };
        if (!groupId) {
          this.sendToClient(ws, { type: "error", payload: { message: "groupId is required" } });
          break;
        }
        const ghGroup = this.groupManager?.get(groupId);
        if (!ghGroup) {
          this.sendToClient(ws, { type: "group_history", payload: { groupId, messages: [], hasMore: false } });
          break;
        }
        const db = ghGroup.groupDb;
        if (!db) {
          this.sendToClient(ws, { type: "group_history", payload: { groupId, messages: [], hasMore: false } });
          break;
        }
        const actualLimit = Math.min(limit ?? 50, 100);
        const stored = db.getAllMessages({ before, limit: actualLimit });
        const hasMore = stored.length > actualLimit;
        const msgs = stored.slice(0, actualLimit);
        const formatted = msgs.map((m) => ({
          direction: "out" as const,
          content: m.content,
          timestamp: m.timestamp,
          senderId: m.from_agent_id,
        }));
        this.sendToClient(ws, { type: "group_history", payload: { groupId, messages: formatted, hasMore } });
        break;
      }

      case "get_dashboard": {
        const { groupId: gId } = (msg.payload as { groupId?: string }) ?? {};
        const rt = (globalThis as any).__cobeingRuntime;
        if (!rt?.observabilityDB) {
          this.sendToClient(ws, { type: "dashboard", payload: { error: "Observability not available" } });
          break;
        }
        this.sendToClient(ws, { type: "dashboard", payload: rt.observabilityDB.getDashboard(gId) });
        break;
      }

      case "get_llm_stats": {
        const { agentId, groupId, since, limit } = (msg.payload as any) ?? {};
        const rt = (globalThis as any).__cobeingRuntime;
        if (!rt?.observabilityDB) {
          this.sendToClient(ws, { type: "llm_stats", payload: { error: "Observability not available" } });
          break;
        }
        this.sendToClient(ws, { type: "llm_stats", payload: rt.observabilityDB.getLLMStats({ agentId, groupId, since, limit }) });
        break;
      }

      case "get_tool_stats": {
        const { agentId, groupId, since, limit } = (msg.payload as any) ?? {};
        const rt = (globalThis as any).__cobeingRuntime;
        if (!rt?.observabilityDB) {
          this.sendToClient(ws, { type: "tool_stats", payload: { error: "Observability not available" } });
          break;
        }
        this.sendToClient(ws, { type: "tool_stats", payload: rt.observabilityDB.getToolStats({ agentId, groupId, since, limit }) });
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
        break;
      }

      case "save_chat_current": {
        const { conversations: saveConvs } = msg.payload as { conversations: Record<string, unknown[]> };
        if (!saveConvs) break;
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
        break;
      }

      case "clear_chat_current": {
        // Clear all agent current.md (only registered agents)
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
        // Clear all group current.md (only registered groups)
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

      case "update_todo_status": {
        const { todoId: sTodoId, status: sStatus, scope: sScope, agentId: sAgentId, groupId: sGroupId } = msg.payload as {
          todoId: string; status: string; scope: "agent" | "group"; agentId?: string; groupId?: string;
        };
        const store = this.resolveTodoStore(sScope, sAgentId, sGroupId);
        if (!store) {
          this.sendToClient(ws, { type: "error", payload: { message: "无法确定 TODO 存储" } });
          break;
        }
        const result = store.updateStatus(sTodoId, sStatus as any);
        if (!result.ok) {
          this.sendToClient(ws, { type: "error", payload: { message: result.error || "更新失败" } });
          break;
        }
        this.broadcast({ type: "todo_updated", payload: { scope: sScope, agentId: sAgentId, groupId: sGroupId } });
        break;
      }

      case "batch_complete_todo": {
        const { todoIds, scope: bcScope, agentId: bcAgentId, groupId: bcGroupId } = msg.payload as {
          todoIds: string[]; scope: "agent" | "group"; agentId?: string; groupId?: string;
        };
        const store = this.resolveTodoStore(bcScope, bcAgentId, bcGroupId);
        if (!store) { this.sendToClient(ws, { type: "error", payload: { message: "无法确定 TODO 存储" } }); break; }
        const result = store.batchComplete(todoIds);
        this.sendToClient(ws, { type: "todo_batch_result", payload: { action: "complete", ...result } });
        this.broadcast({ type: "todo_updated", payload: { scope: bcScope, agentId: bcAgentId, groupId: bcGroupId } });
        break;
      }

      case "batch_remove_todo": {
        const { todoIds: brIds, scope: brScope, agentId: brAgentId, groupId: brGroupId } = msg.payload as {
          todoIds: string[]; scope: "agent" | "group"; agentId?: string; groupId?: string;
        };
        const store = this.resolveTodoStore(brScope, brAgentId, brGroupId);
        if (!store) { this.sendToClient(ws, { type: "error", payload: { message: "无法确定 TODO 存储" } }); break; }
        const result = store.batchRemove(brIds);
        this.sendToClient(ws, { type: "todo_batch_result", payload: { action: "remove", ...result } });
        this.broadcast({ type: "todo_updated", payload: { scope: brScope, agentId: brAgentId, groupId: brGroupId } });
        break;
      }

      case "batch_update_todo": {
        const { todoIds: buIds, scope: buScope, agentId: buAgentId, groupId: buGroupId, targetAgentId } = msg.payload as {
          todoIds: string[]; scope: "agent" | "group"; agentId?: string; groupId?: string; targetAgentId?: string;
        };
        const store = this.resolveTodoStore(buScope, buAgentId, buGroupId);
        if (!store) { this.sendToClient(ws, { type: "error", payload: { message: "无法确定 TODO 存储" } }); break; }
        const result = store.batchUpdate(buIds, { targetAgentId });
        this.sendToClient(ws, { type: "todo_batch_result", payload: { action: "update", ...result } });
        this.broadcast({ type: "todo_updated", payload: { scope: buScope, agentId: buAgentId, groupId: buGroupId } });
        break;
      }

      case "get_screener_stats": {
        const { groupId: scrGroupId } = msg.payload as { groupId: string };
        const gm = this.groupManager;
        if (!gm) { this.sendToClient(ws, { type: "error", payload: { message: "GroupManager 未初始化" } }); break; }
        const g = gm.get(scrGroupId);
        if (!g) { this.sendToClient(ws, { type: "error", payload: { message: `群组未找到: ${scrGroupId}` } }); break; }
        const screener = (g as any).screener;
        if (!screener?.getStats) {
          this.sendToClient(ws, { type: "screener_stats", payload: { groupId: scrGroupId, totalChecked: 0, totalFiltered: 0, estimatedTokensSaved: 0 } });
        } else {
          this.sendToClient(ws, { type: "screener_stats", payload: { groupId: scrGroupId, ...screener.getStats() } });
        }
        break;
      }

      case "get_group_health": {
        const { groupId: hlGroupId } = msg.payload as { groupId: string };
        const gm2 = this.groupManager;
        if (!gm2) { this.sendToClient(ws, { type: "error", payload: { message: "GroupManager 未初始化" } }); break; }
        const g2 = gm2.get(hlGroupId);
        if (!g2) { this.sendToClient(ws, { type: "error", payload: { message: `群组未找到: ${hlGroupId}` } }); break; }

        // TODO 完成率
        const todoStore = (g2 as any).groupTodoStore;
        let totalTodos = 0; let completedTodos = 0; let longestPendingHours = 0;
        if (todoStore) {
          const all = todoStore.list();
          totalTodos = all.length;
          completedTodos = all.filter((t: any) => t.status === "completed").length;
          const now = Date.now();
          let oldestPending = Infinity;
          for (const t of all) {
            if (t.status !== "completed") {
              const triggerTime = new Date(t.triggerAt).getTime();
              if (triggerTime < oldestPending) oldestPending = triggerTime;
            }
          }
          if (oldestPending < Infinity) {
            longestPendingHours = Math.round((now - oldestPending) / 3600000 * 10) / 10;
          }
        }

        // 成员参与度
        const memberActivity: Array<{ agentId: string; name: string; messageCount: number; lastActive: string | null }> = [];
        for (const m of g2.config.members) {
          const agent = this.agentRegistry?.get(m);
          const history = (g2 as any).ctxV2?.getMessages?.() ?? [];
          const agentMsgs = history.filter((msg: any) => msg.fromAgentId === m);
          const lastMsg = agentMsgs.length > 0 ? agentMsgs[agentMsgs.length - 1] : null;
          memberActivity.push({
            agentId: m,
            name: agent?.name ?? m,
            messageCount: agentMsgs.length,
            lastActive: lastMsg?.timestamp ? new Date(lastMsg.timestamp).toISOString() : null,
          });
        }

        // 群组状态
        const status = (g2 as any).status ?? "active";
        const createdAt = (g2 as any).createdAt ?? "";

        this.sendToClient(ws, {
          type: "group_health",
          payload: {
            groupId: hlGroupId,
            status,
            createdAt,
            memberCount: g2.config.members.length,
            memberActivity,
            todoStats: { total: totalTodos, completed: completedTodos, completionRate: totalTodos > 0 ? Math.round(completedTodos / totalTodos * 100) : 0 },
            longestPendingHours,
          },
        });
        break;
      }

      case "get_agent_timeline": {
        const { agentId: tlAgentId, limit: tlLimit } = msg.payload as { agentId: string; limit?: number };
        const obsDb = (globalThis as any).__cobeingObsDb;
        if (!obsDb) { this.sendToClient(ws, { type: "error", payload: { message: "Observability DB 未初始化" } }); break; }
        try {
          const { calls } = obsDb.getToolStats({ agentId: tlAgentId, limit: tlLimit ?? 50 });
          this.sendToClient(ws, { type: "agent_timeline", payload: { agentId: tlAgentId, events: calls } });
        } catch { this.sendToClient(ws, { type: "agent_timeline", payload: { agentId: tlAgentId, events: [] } }); }
        break;
      }

      case "search_conversation": {
        const { query, groupId: scGroupId, session: scSession } = msg.payload as { query: string; groupId?: string; session?: string };
        if (!query?.trim()) { this.sendToClient(ws, { type: "error", payload: { message: "query required" } }); break; }
        try {
          const agentId = "butler";
          const agentDir = path.join(this.dataRoot, "agents", agentId);
          const { MemoryStore } = await import("../memory/memory-store.js");
          const store = MemoryStore.createLazy(agentDir);
          await store.ready();
          const results = store.searchHistory(query, scSession ?? scGroupId, 20);
          this.sendToClient(ws, { type: "search_results", payload: { query, results } });
        } catch (err: any) {
          this.sendToClient(ws, { type: "error", payload: { message: `搜索失败: ${err.message}` } });
        }
        break;
      }

      case "export_data": {
        const { exportType, exportAgentId, exportGroupId } = msg.payload as { exportType: string; exportAgentId?: string; exportGroupId?: string };
        try {
          // 路径穿越防护
          const safeId = (id: string): boolean => /^[\w-]+$/.test(id);
          if (exportAgentId && !safeId(exportAgentId)) { this.sendToClient(ws, { type: "error", payload: { message: "非法 agentId" } }); break; }
          if (exportGroupId && !safeId(exportGroupId)) { this.sendToClient(ws, { type: "error", payload: { message: "非法 groupId" } }); break; }

          const files: Array<{ path: string; content: string }> = [];
          let targetDir: string;

          if (exportType === "agent" && exportAgentId) {
            targetDir = path.join(this.dataRoot, "agents", exportAgentId);
          } else if (exportType === "group" && exportGroupId) {
            targetDir = path.join(this.dataRoot, "groups", exportGroupId);
          } else {
            targetDir = this.dataRoot;
          }

          // 二次确认目标目录在 dataRoot 内
          const normalizedTarget = path.resolve(targetDir);
          const normalizedRoot = path.resolve(this.dataRoot);
          if (!normalizedTarget.startsWith(normalizedRoot)) {
            this.sendToClient(ws, { type: "error", payload: { message: "导出路径超出数据目录" } });
            break;
          }

          if (fs.existsSync(targetDir)) {
            const collectFiles = (dir: string, prefix: string) => {
              for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const fp = path.join(dir, entry.name);
                const rel = path.join(prefix, entry.name);
                if (entry.isDirectory()) {
                  collectFiles(fp, rel);
                } else if (entry.isFile() && !entry.name.endsWith(".db") && !entry.name.endsWith(".db-wal") && !entry.name.endsWith(".db-shm")) {
                  try {
                    const content = fs.readFileSync(fp, "utf-8");
                    if (content.length < 500_000) {
                      files.push({ path: rel, content });
                    } else {
                      files.push({ path: rel, content: `[文件过大 ${content.length} chars，已省略]` });
                    }
                  } catch {
                    files.push({ path: rel, content: "[二进制文件，已省略]" });
                  }
                }
              }
            };
            collectFiles(targetDir, "");
          }

          const json = JSON.stringify({ exportType, exportedAt: new Date().toISOString(), files });
          this.sendToClient(ws, { type: "export_result", payload: { exportType, data: json, fileCount: files.length } });
        } catch (err: any) {
          this.sendToClient(ws, { type: "error", payload: { message: `导出失败: ${err.message}` } });
        }
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
          status: g.config.status || 'active',
        }))
      : [];

    log.info("getState: %d agents, %d groups (registry=%s, groupManager=%s)",
      agents.length, groups.length,
      this.agentRegistry ? "set" : "null",
      this.groupManager ? "set" : "null");

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
  const matches = content.match(/@([\w一-鿿][\w一-鿿-]{2,})/g);
  return matches ? [...new Set(matches.map(m => m.slice(1)))] : [];
}

/** 解析 current.md 内容：支持 JSONL 和 markdown 包裹 JSON 两种格式 */
function parseCurrentMd(raw: string): unknown[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  /** 将内部消息格式转换为前端 LogMessage 格式 */
  function toFrontendMsg(obj: Record<string, unknown>): Record<string, unknown> {
    const fromAgentId = obj.fromAgentId as string | undefined;
    const direction = obj.direction as string | undefined;
    // Preserve direction/senderId if already in frontend format, otherwise infer
    if (direction) {
      return {
        direction,
        content: obj.content,
        timestamp: obj.timestamp,
        senderId: obj.senderId || obj.senderName || fromAgentId,
      };
    }
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
          m.direction ? m : toFrontendMsg(m),
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

/** 按 "a.b.c" 路径设置嵌套对象值（防止原型污染） */
function setNestedValue(obj: Record<string, unknown>, cfgPath: string, value: unknown): void {
  const keys = cfgPath.split(".");
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    // 防止原型污染
    if (key === "__proto__" || key === "constructor" || key === "prototype") return;
    if (!(key in current) || typeof current[key] !== "object") {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  const lastKey = keys[keys.length - 1];
  if (lastKey === "__proto__" || lastKey === "constructor" || lastKey === "prototype") return;
  current[lastKey] = value;
}
