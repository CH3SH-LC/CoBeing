/**
 * Core WebSocket 服务 — 为 GUI 提供状态查询和控制接口
 * 直接从 AgentRegistry / GroupManager 读取实时状态
 */
import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createLogger, DEFAULT_PROVIDER, DEFAULT_MODEL, markDirectoryForDeletion, MAX_AGENT_NAME_LENGTH, MAX_GROUP_NAME_LENGTH, MAX_MESSAGE_LENGTH } from "@cobeing/shared";
import { Agent } from "../agent/agent.js";
import { AgentPaths, AgentFiles, createDefaultCapabilityCard } from "../agent/paths.js";
import type { AgentRegistry } from "../agent/registry.js";
import type { GroupManager } from "../group/manager.js";
import type { ChannelRouter } from "../group/router.js";
import { ButlerRegistry } from "../agent/butler-registry.js";
import { SkillRepository } from "../skills/repository.js";
import type { AgentConfig, ReviewLogEvent } from "@cobeing/shared";
import { encrypt, decrypt } from "../config/secret-store.js";
import { runAgentCreator, runGroupCreator, type GroupCreatorResult } from "../agent/tool-agent/creator.js";
import { addAgentToRegistry, removeAgentFromRegistry, addGroupToRegistry, removeGroupFromRegistry, updateGroupMembers } from "@cobeing/shared";
import type { LLMProvider } from "@cobeing/providers";
import { scanContent } from "../memory/security-scan.js";
import { TodoStore } from "../todo/store.js";
import type { TodoScope } from "../todo/types.js";
import { DockerSandbox } from "../tools/sandbox/docker-sandbox.js";
import { dispatchButlerTask } from "../butler/dispatch.js";
import {
  maskApiKey, resolveProviderApiKeys, cloneForClient, isSafeId, isSafeLeafFilename,
  resolveWithin, isAllowedOrigin, isSafeConfigPath, setNestedValue,
} from "./security.js";
import { WSMessage, TodoMutationAction, TodoMutationContext, buildTodoMutationPayload, buildGroupCreatorDraftNote } from "./types.js";
import { loadCapabilityCards, scoreCapability } from "./capability.js";
import { extractMentions, parseCurrentMd } from "./parsing.js";
import { registerSystemHandlers } from "./handlers/system.js";
import { registerAgentHandlers } from "./handlers/agent.js";
import { registerBindingHandlers } from "./handlers/binding.js";
import { registerButlerPersonaHandlers } from "./handlers/butler-persona.js";
import { registerEnhancementHandlers } from "./handlers/enhancement.js";
import { registerGroupHandlers } from "./handlers/group.js";
import { registerMarketHandlers } from "./handlers/market.js";
import { registerMessageHandlers } from "./handlers/message.js";
import { registerOnboardingHandlers } from "./handlers/onboarding.js";
import { registerObservabilityHandlers } from "./handlers/observability.js";
import { registerPluginHandlers } from "./handlers/plugin.js";
import { registerSandboxHandlers } from "./handlers/sandbox.js";
import { registerSkillHandlers } from "./handlers/skill.js";
import { registerTodoHandlers } from "./handlers/todo.js";
import type { MarketCatalog } from "../market/catalog.js";
import type { MarketInstaller } from "../market/installer.js";

const log = createLogger("ws-server");

export class CoreWSServer {
  private wss: WebSocketServer | null = null;
  /** handler 可访问的依赖（B1 拆分后由 handler 模块经 server 引用读取） */
  public agentRegistry: AgentRegistry | null = null;
  public groupManager: GroupManager | null = null;
  public router: ChannelRouter | null = null;
  private clients = new Set<WebSocket>();
  public messageLog: Array<{ timestamp: number; direction: string; content: string }> = [];
  public providerResolver: ((id: string) => LLMProvider | undefined) | null = null;
  public skillRepo: SkillRepository | null = null;
  public marketCatalog: MarketCatalog | null = null;
  public marketInstaller: MarketInstaller | null = null;
  public dataRoot: string = "data";
  public rateLimits = new Map<string, {count: number, resetTime: number}>();
  public sendMessageCooldowns = new Map<string, number>();
  private connCounter = 0;
  public onProviderChange: ((providerId: string) => void) | null = null;
  public onMcpConfigChange: ((serverId: string, config: unknown) => Promise<void>) | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private readonly authToken = process.env.COBEING_WS_TOKEN;
  private handlers = new Map<string, import("./handlers/types.js").WsCommandHandler>();

  constructor(private port: number = 18765, public configPath?: string) {
    (globalThis as any).__cobeingWSServer = this;
    this.registerHandlers();
  }

  /** 注册单个 WS 命令 handler（供 api/handlers 模块调用） */
  registerCommand(type: string, handler: import("./handlers/types.js").WsCommandHandler): void {
    this.handlers.set(type, handler);
  }

  /** 注册所有 WS 命令 handler（来自 api/handlers/*.ts） */
  private registerHandlers(): void {
    registerSystemHandlers((t, h) => this.registerCommand(t, h));
    registerAgentHandlers((t, h) => this.registerCommand(t, h));
    registerBindingHandlers((t, h) => this.registerCommand(t, h));
    registerButlerPersonaHandlers((t, h) => this.registerCommand(t, h));
    registerEnhancementHandlers((t, h) => this.registerCommand(t, h));
    registerGroupHandlers((t, h) => this.registerCommand(t, h));
    registerMarketHandlers((t, h) => this.registerCommand(t, h));
    registerMessageHandlers((t, h) => this.registerCommand(t, h));
    registerOnboardingHandlers((t, h) => this.registerCommand(t, h));
    registerObservabilityHandlers((t, h) => this.registerCommand(t, h));
    registerPluginHandlers((t, h) => this.registerCommand(t, h));
    registerSandboxHandlers((t, h) => this.registerCommand(t, h));
    registerSkillHandlers((t, h) => this.registerCommand(t, h));
    registerTodoHandlers((t, h) => this.registerCommand(t, h));
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
    // 过滤内部消息：user、TODOboard、system 不广播到前端
    gm.setOnMessageBroadcast((groupId, msg) => {
      if (msg.fromAgentId === "user" || msg.fromAgentId === "TODOboard" || msg.fromAgentId === "system") return;
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

    // 设置 condition TODO 扫描回调 — Agent 发言时触发 condition 检查
    gm.setOnMessage((groupId, fromAgentId) => {
      const scanner = gm.getScanner(groupId);
      scanner?.checkConditionTodos(fromAgentId).catch(() => {});
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

  /** 注入 Market 分级服务（catalog + installer） */
  setMarketServices(catalog: MarketCatalog, installer: MarketInstaller): void {
    this.marketCatalog = catalog;
    this.marketInstaller = installer;
  }

  /** 注入数据根目录 */
  setDataRoot(dataRoot: string): void {
    this.dataRoot = dataRoot;
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.wss = new WebSocketServer({
        port: this.port,
        host: "127.0.0.1",
        maxPayload: 1024 * 1024,
        verifyClient: (info, done) => {
          if (!this.authorizeRequest(info.req)) {
            done(false, 401, "Unauthorized");
            return;
          }
          done(true);
        },
      });

      this.wss.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
          log.error("Port %d is already in use. Please close the process using it or change the port in config.", this.port);
        } else {
          log.error("WS server error: %s", err.message);
        }
        reject(err);
      });

      this.wss.on("connection", (ws) => {
        const connId = String(++this.connCounter);
        (ws as any).__connId = connId;
        this.clients.add(ws);
        log.info("GUI client connected");

        // Pong 超时：仅在心跳 ping 之后武装（20s 内无 pong/消息则终止）。
        // 历史 bug：连接建立时立即武装 20s 超时，而心跳间隔 30s——
        // 静默但存活的客户端（如测试脚本）在首个 ping 到来前（t=20s）就被误杀。
        const clearPongTimeout = () => {
          if ((ws as any).__pongTimeout) {
            clearTimeout((ws as any).__pongTimeout);
            (ws as any).__pongTimeout = null;
          }
        };
        ws.on("pong", clearPongTimeout);

        // 发送当前状态
        this.sendToClient(ws, { type: "state", payload: this.getState() });

        ws.on("message", (raw) => {
          clearPongTimeout(); // 任意客户端消息说明连接活跃，清除超时（WebView2 可能不发协议级 pong）
          try {
            // Per-connection rate limiting: max 60 messages per 60 seconds
            const now = Date.now();
            const rl = this.rateLimits.get(connId);
            if (rl) {
              if (now > rl.resetTime) {
                rl.count = 0;
                rl.resetTime = now + 60000;
              }
              if (rl.count >= 60) {
                this.sendToClient(ws, { type: "error", payload: { message: "Rate limit exceeded. Max 60 messages per minute." } });
                return;
              }
              rl.count++;
            } else {
              this.rateLimits.set(connId, { count: 1, resetTime: now + 60000 });
            }

            const msg = JSON.parse(raw.toString()) as WSMessage;
            this.handleMessage(ws, msg);
          } catch (err) {
            log.error("Invalid WS message: %s", err);
          }
        });

        ws.on("close", () => {
          clearPongTimeout();
          this.clients.delete(ws);
          this.rateLimits.delete(connId);
          this.sendMessageCooldowns.delete(connId);
        });
      });

      this.wss.on("listening", () => {
        log.info("Core WS server listening on port %d", this.port);
        // Heartbeat: ping all connected clients every 30 seconds，ping 后武装 20s pong 超时
        this.heartbeatInterval = setInterval(() => {
          for (const client of this.clients) {
            if (client.readyState === WebSocket.OPEN) {
              client.ping();
              const t = (client as any).__pongTimeout;
              if (t) clearTimeout(t);
              (client as any).__pongTimeout = setTimeout(() => {
                log.warn("WS client pong timeout — terminating connection");
                client.terminate();
              }, 20000);
            }
          }
        }, 30000);
        resolve();
      });
    });
  }

  private authorizeRequest(req: IncomingMessage): boolean {
    if (!isAllowedOrigin(req.headers.origin)) {
      log.warn("Rejected WS connection from origin: %s", req.headers.origin || "(none)");
      return false;
    }
    if (!this.authToken) return true;
    try {
      const host = req.headers.host || `127.0.0.1:${this.port}`;
      const url = new URL(req.url || "/", `ws://${host}`);
      const token = url.searchParams.get("token") || req.headers["x-cobeing-ws-token"];
      return token === this.authToken;
    } catch {
      return false;
    }
  }

  async stop(): Promise<void> {
    // 通知所有客户端立即保存数据，然后等待 flush
    this.broadcast({ type: "server_shutting_down", payload: { timestamp: Date.now() } });
    await new Promise(resolve => setTimeout(resolve, 800));
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
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
    // 已迁移到 api/handlers/ 的命令经注册表分发
    const handler = this.handlers.get(msg.type);
    if (handler) {
      await handler.call(this, ws, msg);
      return;
    }
  }

  /** 广播 Global TODO 变更事件（供工具层调用） */
  broadcastGlobalTodoUpdate(): void {
    this.broadcast({ type: "global_todo_updated", payload: { timestamp: Date.now() } });
  }

  /** 解析 TODO Store（Agent 级或群组级） */
  public resolveTodoStore(scope: "agent" | "group", agentId?: string, groupId?: string): TodoStore | undefined {
    if (scope === "group" && groupId) {
      return this.groupManager?.getGroupTodoStore?.(groupId);
    } else if (agentId) {
      return new TodoStore(path.join(this.dataRoot, "agents", agentId));
    }
    return undefined;
  }

  public getState() {
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

    const runtime = (globalThis as any).__cobeing?.runtime;
    const pluginRegistry = runtime?.pluginRegistry;
    const plugins: Array<{ id: string; kind: string; enabled: boolean }> = [];
    if (pluginRegistry) {
      for (const [pluginId, entry] of Object.entries(pluginRegistry.plugins as Record<string, any>)) {
        plugins.push({
          id: pluginId,
          kind: entry.kind || "unknown",
          enabled: entry.enabled === true,
        });
      }
    }

    log.info("getState: %d agents, %d groups (registry=%s, groupManager=%s)",
      agents.length, groups.length,
      this.agentRegistry ? "set" : "null",
      this.groupManager ? "set" : "null");

    return {
      agents,
      groups,
      channels: [] as string[],
      plugins,
      timestamp: Date.now(),
    };
  }

  public listPlugins(): Array<{
    id: string; name: string; kind: string; version: string;
    enabled: boolean; configSchema?: any;
    models?: Array<{ id: string; name?: string }>;
    tools?: string[]; extensions?: Array<{ id: string; type: string; label: string }>;
    instances?: Array<{ id: string; isCustomInstance: boolean; config: Record<string, unknown> }>;
  }> {
    const result: Array<any> = [];
    const cobeing = (globalThis as any).__cobeing;
    const pluginRegistry = cobeing?.runtime?.pluginRegistry;
    if (!pluginRegistry || !pluginRegistry.plugins) return result;

    for (const [pluginId, entry] of Object.entries(pluginRegistry.plugins as Record<string, any>)) {
      if (!entry.enabled) continue;
      const info: any = {
        id: pluginId,
        name: entry.name || pluginId,
        kind: entry.kind || "unknown",
        version: entry.version || "0.0.0",
        enabled: true,
      };

      // Validate entry.dir for path traversal
      if (entry.dir && (entry.dir.includes("..") || path.isAbsolute(entry.dir))) continue;
      // Read manifest for name/version
      const pluginDir = path.join(this.dataRoot, "plugins", entry.dir || "");
      const manifestPath = path.join(pluginDir, "cobeing.plugin.json");
      if (fs.existsSync(manifestPath)) {
        try {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
          if (manifest.name) info.name = manifest.name;
          if (manifest.version) info.version = manifest.version;
          if (manifest.configSchema) {
            // Basic sanitization
            if (typeof manifest.configSchema === "object" && !Array.isArray(manifest.configSchema)) {
              info.configSchema = manifest.configSchema;
              // Limit fields array size
              if (info.configSchema.fields && info.configSchema.fields.length > 50) {
                info.configSchema.fields = info.configSchema.fields.slice(0, 50);
              }
              if (info.configSchema.features && info.configSchema.features.length > 50) {
                info.configSchema.features = info.configSchema.features.slice(0, 50);
              }
            }
          }
        } catch { /* ignore */ }
      }

      // model-provider: models and custom instances
      if (entry.kind === "model-provider") {
        const modelsPath = path.join(pluginDir, "models.json");
        if (fs.existsSync(modelsPath)) {
          try {
            const models = JSON.parse(fs.readFileSync(modelsPath, "utf-8"));
            info.models = Array.isArray(models) ? models : [];
          } catch { info.models = []; }
        }
        const instancesDir = path.join(pluginDir, "instances");
        if (fs.existsSync(instancesDir)) {
          try {
            const files = fs.readdirSync(instancesDir).filter(f => f.endsWith(".json"));
            info.instances = files.map(f => {
              const instanceId = f.replace(/\.json$/, "");
              let config: Record<string, unknown> = {};
              try {
                config = JSON.parse(fs.readFileSync(path.join(instancesDir, f), "utf-8"));
              } catch { /* ignore */ }
              return { id: `custom:${instanceId}`, isCustomInstance: true, config };
            });
          } catch { info.instances = []; }
        }
      }

      // channel: custom instances
      if (entry.kind === "channel") {
        const instancesDir = path.join(pluginDir, "instances");
        if (fs.existsSync(instancesDir)) {
          try {
            const files = fs.readdirSync(instancesDir).filter(f => f.endsWith(".json"));
            info.instances = files.map(f => {
              const instanceId = f.replace(/\.json$/, "");
              let config: Record<string, unknown> = {};
              try {
                config = JSON.parse(fs.readFileSync(path.join(instancesDir, f), "utf-8"));
              } catch { /* ignore */ }
              return { id: `custom:${instanceId}`, isCustomInstance: true, config };
            });
          } catch { info.instances = []; }
        }
      }

      // tool: read from pluginTools
      if (entry.kind === "tool") {
        const pluginTools = cobeing?.pluginTools;
        if (pluginTools) {
          info.tools = Object.keys(pluginTools).filter(k => k.startsWith(pluginId + ":") || k === pluginId);
        }
      }

      // extension: read from uiExtensions
      if (entry.kind === "extension") {
        const exts = cobeing?.uiExtensions?.list?.() ?? [];
        info.extensions = exts
          .filter((e: any) => e.pluginId === pluginId || e.id?.startsWith(pluginId + ":"))
          .map((e: any) => ({ id: e.id, type: e.type, label: e.label }));
      }

      result.push(info);

      // Flatten custom instances as top-level entries so the frontend
      // can discover and select them as standalone providers/channels.
      if (info.instances && Array.isArray(info.instances)) {
        for (const inst of info.instances) {
          result.push({
            id: inst.id,
            name: inst.config?.name || inst.id,
            kind: entry.kind,
            version: info.version,
            enabled: true,
            models: info.models || [],
            isCustomInstance: true,
            pluginId,
            instanceId: inst.id.replace(/^custom:/, ""),
            config: inst.config,
          });
        }
      }
    }
    return result;
  }

  public sendToClient(ws: WebSocket, msg: WSMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }
}
