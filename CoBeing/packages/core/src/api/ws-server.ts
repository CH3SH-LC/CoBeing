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

const SENSITIVE_KEY_RE = /(^api[-_]?key$|token|secret|password|authorization|cookie|^headers?$|^env$)/i;

function cloneForClient(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneForClient);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY_RE.test(key)) {
      if (typeof child === "string") out[key] = maskApiKey(child);
      else if (Array.isArray(child)) out[key] = child.map(cloneForClient);
      else if (child && typeof child === "object") {
        out[key] = Object.fromEntries(
          Object.entries(child as Record<string, unknown>).map(([childKey, childValue]) => [
            childKey,
            typeof childValue === "string" ? maskApiKey(childValue) : cloneForClient(childValue),
          ]),
        );
      }
      else out[key] = child;
    } else {
      out[key] = cloneForClient(child);
    }
  }
  return out;
}

function isSafeId(id: string): boolean {
  if (!id || id.length > 128) return false;
  if (id === "." || id === "..") return false;
  if (path.isAbsolute(id)) return false;
  return !/[\\/\x00-\x1F<>:"|?*]|\s$|\.$/u.test(id);
}

function isSafeLeafFilename(filename: string): boolean {
  return /^[A-Za-z0-9_.-]+$/.test(filename) && !filename.includes("..") && !path.isAbsolute(filename);
}

function resolveWithin(baseDir: string, filename: string): string {
  if (!isSafeLeafFilename(filename)) throw new Error("Invalid filename");
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(resolvedBase, filename);
  const rel = path.relative(resolvedBase, resolvedTarget);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Path traversal denied");
  }
  return resolvedTarget;
}

function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  if (origin === "tauri://localhost" || origin === "http://tauri.localhost" || origin === "https://tauri.localhost") return true;
  try {
    const u = new URL(origin);
    const host = u.hostname.toLowerCase();
    const port = u.port;
    if ((host === "localhost" || host === "127.0.0.1") && (port === "1420" || port === "5173" || port === "4173")) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

interface WSMessage {
  type: string;
  payload?: unknown;
}

export type TodoMutationAction =
  | "added"
  | "completed"
  | "removed"
  | "status-updated"
  | "batch-completed"
  | "batch-removed"
  | "batch-updated";

export interface TodoMutationContext {
  scope: TodoScope;
  agentId?: string;
  groupId?: string;
}

export function buildTodoMutationPayload<TExtra extends Record<string, unknown>>(
  action: TodoMutationAction,
  context: TodoMutationContext,
  extra: TExtra,
): { action: TodoMutationAction; scope: TodoScope; agentId?: string; groupId?: string } & TExtra {
  return {
    action,
    scope: context.scope,
    ...(context.agentId ? { agentId: context.agentId } : {}),
    ...(context.groupId ? { groupId: context.groupId } : {}),
    ...extra,
  };
}

export function buildGroupCreatorDraftNote(draft: GroupCreatorResult): string {
  const memberSuggestions = draft.memberSuggestions.length
    ? `\n\n## Creator 建议补充的成员缺口\n${draft.memberSuggestions.map(s => `- ${s.role}${s.suggestedName ? `（建议名：${s.suggestedName}）` : ""}：${s.reason}`).join("\n")}`
    : "";
  const initialTasks = draft.initialTasks.length
    ? `\n\n## Creator 建议的初始任务\n${draft.initialTasks.map(t => `- ${t.title}${t.assigneeHint ? `（建议承担：${t.assigneeHint}）` : ""}${t.acceptance ? `；验收：${t.acceptance}` : ""}`).join("\n")}`
    : "";
  const confirmations = draft.userConfirmations.length
    ? `\n\n## 需要向用户确认\n${draft.userConfirmations.map(q => `- ${q}`).join("\n")}`
    : "";
  return [memberSuggestions, initialTasks, confirmations].join("");
}

function loadCapabilityCards(
  dataRoot: string,
  excludeAgentIds: string[] = [],
): import("@cobeing/shared").AgentCapabilityCard[] {
  const cards: import("@cobeing/shared").AgentCapabilityCard[] = [];
  for (const dir of [path.join(dataRoot, "agents"), path.join(dataRoot, "coreagents")]) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || excludeAgentIds.includes(entry.name)) continue;
      const capPath = path.join(dir, entry.name, "capability.json");
      if (!fs.existsSync(capPath)) continue;
      try {
        const card = JSON.parse(fs.readFileSync(capPath, "utf-8")) as import("@cobeing/shared").AgentCapabilityCard;
        if (card.agentId) cards.push(card);
      } catch {
        // Ignore malformed local capability files.
      }
    }
  }
  return cards;
}

function scoreCapability(
  card: import("@cobeing/shared").AgentCapabilityCard,
  taskDescription: string,
  requiredDomains: string[] = [],
): { score: number; confidence: number; reason: string } {
  const taskTerms = taskDescription
    .toLowerCase()
    .split(/[\s,.;:，。；、：()[\]{}"'`]+/u)
    .map(t => t.trim())
    .filter(t => t.length > 1);
  const required = requiredDomains.map(d => d.toLowerCase().trim()).filter(Boolean);
  const haystack = [
    card.role,
    ...(card.domains ?? []),
    ...(card.strengths ?? []),
    ...(card.limitations ?? []),
    ...(card.taskTypes ?? []).flatMap(t => [t.label, ...t.examples, ...t.inputRequirements, ...t.outputFormats]),
    ...(card.preferredTools ?? []),
    ...(card.preferredSkills ?? []),
  ].join(" ").toLowerCase();

  let score = 0;
  const hits: string[] = [];
  for (const term of [...required, ...taskTerms]) {
    if (haystack.includes(term)) {
      score += required.includes(term) ? 3 : 1;
      if (!hits.includes(term)) hits.push(term);
    }
  }
  const confidence = Math.min(0.95, Math.max(0.1, score / Math.max(4, required.length * 3 + taskTerms.length)));
  return {
    score,
    confidence,
    reason: hits.length > 0 ? `命中能力关键词: ${hits.slice(0, 8).join(", ")}` : "未命中明确关键词，按现有能力画像排序",
  };
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
  private rateLimits = new Map<string, {count: number, resetTime: number}>();
  private sendMessageCooldowns = new Map<string, number>();
  private connCounter = 0;
  private onProviderChange: ((providerId: string) => void) | null = null;
  private onMcpConfigChange: ((serverId: string, config: unknown) => Promise<void>) | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private readonly authToken = process.env.COBEING_WS_TOKEN;

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

        // Pong timeout: if no pong received in 20 seconds, terminate the connection
        let pongTimeout: ReturnType<typeof setTimeout> | null = null;
        const refreshPong = () => {
          if (pongTimeout) clearTimeout(pongTimeout);
          pongTimeout = setTimeout(() => {
            log.warn("WS client pong timeout — terminating connection");
            ws.terminate();
          }, 20000);
        };
        ws.on("pong", refreshPong);
        refreshPong(); // start initial timeout

        // 发送当前状态
        this.sendToClient(ws, { type: "state", payload: this.getState() });

        ws.on("message", (raw) => {
          refreshPong(); // reset pong timeout on any client message (WebView2 may not send protocol-level pongs)
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
          if (pongTimeout) clearTimeout(pongTimeout);
          this.clients.delete(ws);
          this.rateLimits.delete(connId);
          this.sendMessageCooldowns.delete(connId);
        });
      });

      this.wss.on("listening", () => {
        log.info("Core WS server listening on port %d", this.port);
        // Heartbeat: ping all connected clients every 30 seconds
        this.heartbeatInterval = setInterval(() => {
          for (const client of this.clients) {
            if (client.readyState === WebSocket.OPEN) {
              client.ping();
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
    switch (msg.type) {
      // ═══════════════════════════════════════════════════════════
      // State & Monitoring
      // ═══════════════════════════════════════════════════════════

      case "_ping":
        // 前端应用层心跳（辅助 WebView2 窗口失焦时连接保持）
        this.sendToClient(ws, { type: "_pong" });
        break;

      case "get_state":
        this.sendToClient(ws, { type: "state", payload: this.getState() });
        break;

      case "list_ui_extensions": {
        const registry = (globalThis as any).__cobeing?.uiExtensions;
        const exts = registry && typeof registry.list === "function" ? registry.list() : [];
        this.sendToClient(ws, {
          type: "ui_extensions",
          payload: { extensions: exts.map((e: any) => ({ id: e.id, type: e.type, label: e.label, componentPath: e.componentPath, icon: e.icon })) },
        });
        break;
      }

      case "list_plugins": {
        const plugins = this.listPlugins();
        this.sendToClient(ws, { type: "plugins", payload: plugins });
        break;
      }

      case "add_plugin_instance": {
        const { pluginId, instanceId, config } = msg.payload as {
          pluginId: string; instanceId: string; config: Record<string, unknown>;
        };
        // Validate instanceId: only allow alphanumeric, hyphens, underscores
        if (!instanceId || !/^[\w][\w\-]*$/.test(instanceId)) {
          this.sendToClient(ws, { type: "error", payload: { message: "Invalid instanceId: must be alphanumeric with hyphens/underscores only" } });
          break;
        }
        try {
          const runtime = (globalThis as any).__cobeing?.runtime;
          const pluginRegistry = runtime?.pluginRegistry;
          if (!pluginRegistry || !pluginRegistry.plugins[pluginId]) {
            this.sendToClient(ws, { type: "error", payload: { message: `Plugin not found: ${pluginId}` } });
            break;
          }
          const entry = pluginRegistry.plugins[pluginId];
          if (entry.dir && (entry.dir.includes("..") || path.isAbsolute(entry.dir))) {
            this.sendToClient(ws, { type: "error", payload: { message: "Invalid plugin directory" } });
            break;
          }
          const pluginDir = path.join(this.dataRoot, "plugins", entry.dir || "");
          const instancesDir = path.join(pluginDir, "instances");
          fs.mkdirSync(instancesDir, { recursive: true });
          const instancePath = path.join(instancesDir, `${instanceId}.json`);
          // Defense-in-depth: verify resolved path is within instances directory
          const resolved = path.resolve(instancePath);
          if (!resolved.startsWith(path.resolve(instancesDir))) {
            this.sendToClient(ws, { type: "error", payload: { message: "Path traversal denied" } });
            break;
          }
          const instanceData = { id: instanceId, ...config };
          fs.writeFileSync(instancePath, JSON.stringify(instanceData, null, 2), "utf-8");
          if (entry.kind === "model-provider" && typeof (runtime as any).rebuildProvider === "function") {
            (runtime as any).rebuildProvider(instanceId);
          }
          this.sendToClient(ws, {
            type: "plugin_instance_added",
            payload: { pluginId, instanceId, config: instanceData },
          });
        } catch (err: any) {
          this.sendToClient(ws, { type: "error", payload: { message: err.message } });
        }
        break;
      }

      case "remove_plugin_instance": {
        const { pluginId, instanceId } = msg.payload as { pluginId: string; instanceId: string };
        // Validate instanceId: only allow alphanumeric, hyphens, underscores
        if (!instanceId || !/^[\w][\w\-]*$/.test(instanceId)) {
          this.sendToClient(ws, { type: "error", payload: { message: "Invalid instanceId: must be alphanumeric with hyphens/underscores only" } });
          break;
        }
        try {
          const runtime = (globalThis as any).__cobeing?.runtime;
          const pluginRegistry = runtime?.pluginRegistry;
          if (!pluginRegistry || !pluginRegistry.plugins[pluginId]) {
            this.sendToClient(ws, { type: "error", payload: { message: `Plugin not found: ${pluginId}` } });
            break;
          }
          const entry = pluginRegistry.plugins[pluginId];
          if (entry.dir && (entry.dir.includes("..") || path.isAbsolute(entry.dir))) {
            this.sendToClient(ws, { type: "error", payload: { message: "Invalid plugin directory" } });
            break;
          }
          const instancesDir = path.join(this.dataRoot, "plugins", entry.dir || "", "instances");
          const instancePath = path.join(instancesDir, `${instanceId}.json`);
          // Defense-in-depth: verify resolved path is within instances directory
          const resolved = path.resolve(instancePath);
          if (!resolved.startsWith(path.resolve(instancesDir))) {
            this.sendToClient(ws, { type: "error", payload: { message: "Path traversal denied" } });
            break;
          }
          if (fs.existsSync(instancePath)) fs.rmSync(instancePath);
          this.sendToClient(ws, {
            type: "plugin_instance_removed",
            payload: { pluginId, instanceId },
          });
        } catch (err: any) {
          this.sendToClient(ws, { type: "error", payload: { message: err.message } });
        }
        break;
      }

      case "update_plugin_instance": {
        const { pluginId, instanceId, config } = msg.payload as {
          pluginId: string; instanceId: string; config: Record<string, unknown>;
        };
        // Validate instanceId: only allow alphanumeric, hyphens, underscores
        if (!instanceId || !/^[\w][\w\-]*$/.test(instanceId)) {
          this.sendToClient(ws, { type: "error", payload: { message: "Invalid instanceId: must be alphanumeric with hyphens/underscores only" } });
          break;
        }
        try {
          const runtime = (globalThis as any).__cobeing?.runtime;
          const pluginRegistry = runtime?.pluginRegistry;
          if (!pluginRegistry || !pluginRegistry.plugins[pluginId]) {
            this.sendToClient(ws, { type: "error", payload: { message: `Plugin not found: ${pluginId}` } });
            break;
          }
          const entry = pluginRegistry.plugins[pluginId];
          if (entry.dir && (entry.dir.includes("..") || path.isAbsolute(entry.dir))) {
            this.sendToClient(ws, { type: "error", payload: { message: "Invalid plugin directory" } });
            break;
          }
          const instancesDir = path.join(this.dataRoot, "plugins", entry.dir || "", "instances");
          const instancePath = path.join(instancesDir, `${instanceId}.json`);
          // Defense-in-depth: verify resolved path is within instances directory
          const resolved = path.resolve(instancePath);
          if (!resolved.startsWith(path.resolve(instancesDir))) {
            this.sendToClient(ws, { type: "error", payload: { message: "Path traversal denied" } });
            break;
          }
          let existing: Record<string, unknown> = { id: instanceId };
          if (fs.existsSync(instancePath)) {
            try { existing = JSON.parse(fs.readFileSync(instancePath, "utf-8")); } catch { /* use default */ }
          }
          const merged = { ...existing, ...config, id: instanceId };
          fs.mkdirSync(instancesDir, { recursive: true });
          fs.writeFileSync(instancePath, JSON.stringify(merged, null, 2), "utf-8");
          if (entry.kind === "model-provider" && typeof (runtime as any).rebuildProvider === "function") {
            (runtime as any).rebuildProvider(instanceId);
          }
          this.sendToClient(ws, {
            type: "plugin_instance_updated",
            payload: { pluginId, instanceId, config: merged },
          });
        } catch (err: any) {
          this.sendToClient(ws, { type: "error", payload: { message: err.message } });
        }
        break;
      }

      case "toggle_plugin": {
        const { pluginId, enabled } = msg.payload as { pluginId: string; enabled: boolean };
        if (!pluginId || typeof pluginId !== "string" || !/^[\w][\w\-]*$/.test(pluginId) || pluginId.length > 64) {
          this.sendToClient(ws, { type: "error", payload: { message: "无效的 pluginId" } });
          break;
        }
        if (typeof enabled !== "boolean") {
          this.sendToClient(ws, { type: "error", payload: { message: "缺少 pluginId 或 enabled" } });
          break;
        }
        const registryPath = path.join(this.dataRoot, "plugins", "registry.json");
        try {
          let registry = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
          if (!registry.plugins[pluginId]) {
            this.sendToClient(ws, { type: "error", payload: { message: `插件 ${pluginId} 不存在` } });
            break;
          }
          registry.plugins[pluginId].enabled = enabled;
          const tmpPath = registryPath + ".tmp." + Date.now();
          fs.writeFileSync(tmpPath, JSON.stringify(registry, null, 2), "utf-8");
          fs.renameSync(tmpPath, registryPath);
          // Sync runtime state
          const rt = (globalThis as any).__cobeing?.runtime;
          if (rt && rt.pluginRegistry && rt.pluginRegistry.plugins[pluginId]) {
            rt.pluginRegistry.plugins[pluginId].enabled = enabled;
          }
          this.broadcastState();
          this.sendToClient(ws, { type: "plugin_toggled", payload: { pluginId, enabled } });
        } catch (err) {
          this.sendToClient(ws, { type: "error", payload: { message: `操作失败: ${(err as Error).message}` } });
        }
        break;
      }

      case "update_plugin_config": {
        const { pluginId: upcPluginId, config } = msg.payload as { pluginId: string; config: Record<string, unknown> };
        if (!upcPluginId || typeof upcPluginId !== "string" || !/^[\w][\w\-]*$/.test(upcPluginId) || upcPluginId.length > 64) {
          this.sendToClient(ws, { type: "error", payload: { message: "无效的 pluginId" } });
          break;
        }
        if (!config) {
          this.sendToClient(ws, { type: "error", payload: { message: "缺少 pluginId 或 config" } });
          break;
        }
        if (typeof config !== "object" || Array.isArray(config)) {
          this.sendToClient(ws, { type: "error", payload: { message: "config 必须是对象" } });
          break;
        }
        const upcRegistryPath = path.join(this.dataRoot, "plugins", "registry.json");
        try {
          let upcRegistry = JSON.parse(fs.readFileSync(upcRegistryPath, "utf-8"));
          if (!upcRegistry.plugins[upcPluginId]) {
            this.sendToClient(ws, { type: "error", payload: { message: `插件 ${upcPluginId} 不存在` } });
            break;
          }
          upcRegistry.plugins[upcPluginId].config = config;
          const tmpPath = upcRegistryPath + ".tmp." + Date.now();
          fs.writeFileSync(tmpPath, JSON.stringify(upcRegistry, null, 2), "utf-8");
          fs.renameSync(tmpPath, upcRegistryPath);
          // Sync runtime state
          const rt = (globalThis as any).__cobeing?.runtime;
          if (rt && rt.pluginRegistry && rt.pluginRegistry.plugins[upcPluginId]) {
            rt.pluginRegistry.plugins[upcPluginId].config = config;
          }
          this.broadcastState();
          this.sendToClient(ws, { type: "plugin_config_updated", payload: { pluginId: upcPluginId, config } });
        } catch (err) {
          this.sendToClient(ws, { type: "error", payload: { message: `操作失败: ${(err as Error).message}` } });
        }
        break;
      }

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
            // 从活跃 session 中提取 groupId（"group:<id>" → "<id>"）
            const sessions = typeof a.getActiveSessions === "function" ? a.getActiveSessions() : [];
            const groupSession = sessions.find((s: string) => s.startsWith("group:"));
            activeAgents.push({
              agentId: a.id,
              agentName: a.name,
              status: st,
              groupId: groupSession ? groupSession.slice(6) : undefined,
            });
          }
        }
        this.sendToClient(ws, { type: "wake_queue_update", payload: { queues: formatted, activeAgents, timestamp: Date.now() } });
        break;
      }

      // ═══════════════════════════════════════════════════════════
      // Message Routing & Chat Persistence
      // ═══════════════════════════════════════════════════════════

      case "send_message": {
        // Cooldown check: max 1 send_message every 2 seconds per connection
        const msgConnId = (ws as any).__connId as string;
        const cooldownNow = Date.now();
        const lastTime = this.sendMessageCooldowns.get(msgConnId) ?? 0;
        if (cooldownNow - lastTime < 2000) {
          this.sendToClient(ws, { type: "error", payload: { message: "消息发送过于频繁，请稍等 2 秒后再试" } });
          break;
        }
        this.sendMessageCooldowns.set(msgConnId, cooldownNow);

        const { agentId, content } = msg.payload as { agentId: string; content: string };
        // 消息长度限制
        if (content.length > MAX_MESSAGE_LENGTH) {
          this.sendToClient(ws, { type: "error", payload: { message: `消息内容不能超过 ${MAX_MESSAGE_LENGTH} 个字符` } });
          break;
        }
        // 安全扫描：检测用户消息中的注入/劫持威胁
        const scan = scanContent(content);
        if (!scan.safe) {
          log.warn("Security scan blocked message to %s: %s", agentId, scan.threat);
          this.sendToClient(ws, { type: "error", payload: { message: `消息被安全策略拦截（检测到: ${scan.threat}）` } });
          break;
        }
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
                interface: workspace.interface,
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
          guideContent: groupMatch ? this.groupManager?.get(groupMatch[1])?.workspace.readGuide() ?? undefined : undefined,
          workingDir: groupMatch ? this.groupManager?.get(groupMatch[1])?.effectiveWorkspace : undefined,
          events: {
            onToken: (token) => {
              this.sendToClient(ws, { type: "stream_token", payload: { token, groupId: groupMatch?.[1], agentId } });
            },
            onToolCall: (tc) => {
              this.broadcast({
                type: "tool_event",
                payload: {
                  agentId,
                  groupId: groupMatch?.[1],
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
                  groupId: groupMatch?.[1],
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
          // Broadcast agent_response so reconnected clients also receive the final text.
          // Previously sendToClient(ws) — lost on WS disconnect during tool execution.
          this.broadcast({ type: "agent_response", payload: { content: response.content, groupId: groupMatch?.[1], agentId, agentName: agent.config?.name || agentId } });

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

      // ═══════════════════════════════════════════════════════════
      // Configuration
      // ═══════════════════════════════════════════════════════════

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
          // Merge plugin-loaded providers into config response (async import)
          try {
            const { getAllProviders } = await import("@cobeing/providers");
            const allProviders = getAllProviders();
            if (!config.providers) config.providers = {};
            for (const p of allProviders) {
              if (!config.providers[p.id]) {
                config.providers[p.id] = {
                  name: p.id,
                  type: "openai-compat",
                  _pluginManaged: true,
                };
              }
            }
          } catch (err: any) {
            log.warn("Failed to merge plugin providers into config: %s", err.message);
          }
          // Merge plugin-loaded channels (async import)
          try {
            const { getAllChannels } = await import("@cobeing/channels");
            const allChannels = getAllChannels();
            if (!config.channels) config.channels = {};
            for (const ch of allChannels) {
              if (!config.channels[ch.id]) {
                config.channels[ch.id] = {
                  name: ch.id,
                  enabled: true,
                  type: ch.id,
                  _pluginManaged: true,
                };
              }
            }
          } catch (err: any) {
            log.warn("Failed to merge plugin channels into config: %s", err.message);
          }
          this.sendToClient(ws, { type: "config", payload: cloneForClient(config) });
        } catch (err) {
          this.sendToClient(ws, { type: "error", payload: { message: `Failed to read config: ${err}` } });
        }
        break;
      }

      case "update_config": {
        const { path: cfgPath, value } = msg.payload as { path: string; value: unknown };
        const configFilePath = this.configPath || path.resolve("config/default.json");
        try {
          if (!isSafeConfigPath(cfgPath)) {
            this.sendToClient(ws, { type: "error", payload: { message: "Invalid config path" } });
            break;
          }
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
          this.broadcast({ type: "config", payload: cloneForClient(broadcastConfig) });

          // Provider 变更时触发热重载
          const providerMatch = cfgPath.match(/^providers\.([^.]+)/);
          if (providerMatch && this.onProviderChange) {
            // Don't allow overwriting plugin-managed providers via config update
            const targetProvider = (config.providers as any)?.[providerMatch[1]];
            if ((targetProvider as any)?._pluginManaged) {
              this.sendToClient(ws, { type: "error", payload: { message: `Provider '${providerMatch[1]}' is managed by a plugin and cannot be modified via config` } });
              break;
            }
            this.onProviderChange(providerMatch[1]);
          }

          // MCP 服务器配置变更时触发热重载
          if (cfgPath.startsWith("mcpServers.") && this.onMcpConfigChange) {
            const serverId = cfgPath.split(".")[1];
            const serverConfig = (config.mcpServers as any)?.[serverId] ?? null;
            this.onMcpConfigChange(serverId, serverConfig).catch(err => {
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

      // ═══════════════════════════════════════════════════════════
      // Agent Lifecycle
      // ═══════════════════════════════════════════════════════════

      case "create_agent": {
        const { name, role, provider, model, systemPrompt, skills, sandbox: payloadSandbox } = msg.payload as {
          name: string; role: string; provider?: string; model?: string;
          systemPrompt?: string; skills?: string[]; sandbox?: any;
        };
        if (!name || !role) {
          this.sendToClient(ws, { type: "error", payload: { message: "name and role are required" } });
          break;
        }
        // Name length + character validation
        if (name.length > MAX_AGENT_NAME_LENGTH) {
          this.sendToClient(ws, { type: "error", payload: { message: `名称不能超过 ${MAX_AGENT_NAME_LENGTH} 个字符` } });
          break;
        }
        if (!/^[\w一-鿿㐀-䶿 -]+$/.test(name)) {
          this.sendToClient(ws, { type: "error", payload: { message: "名称只能包含字母、数字、中文、连字符、下划线和空格" } });
          break;
        }
        const id = name.toLowerCase().replace(/\s+/g, "-");
        if (this.agentRegistry?.get(id)) {
          this.sendToClient(ws, { type: "error", payload: { message: `Agent already exists: ${id}` } });
          break;
        }

        const providerId = provider || DEFAULT_PROVIDER;
        const modelId = model || DEFAULT_MODEL;
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

        // 用 AgentCreator ToolAgent 生成核心文件
        const provided: Record<string, string> = {};
        const missingFields = (["character", "job"] as const);

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
        if (provided.character) {
          fs.writeFileSync(path.join(agentPaths.directory, "CHARACTER.md"), provided.character, "utf-8");
        }
        if (provided.job) {
          fs.writeFileSync(path.join(agentPaths.directory, "JOB.md"), provided.job, "utf-8");
        }

        // 从模板复制其余文件（AGENTS, MEMORY, EXPERIENCE — 仅未生成或未写入的）
        const templatesDir = path.resolve("packages/core/src/templates/agent");
        const templateFiles = ["CHARACTER.md", "JOB.md", "AGENTS.md", "MEMORY.md", "EXPERIENCE.md"];
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
        break;
      }

      // ═══════════════════════════════════════════════════════════
      // Group Lifecycle
      // ═══════════════════════════════════════════════════════════

      case "create_group": {
        const { name, members, topic } = msg.payload as {
          name: string; members: string[]; topic?: string;
        };
        if (!name || !members || members.length === 0) {
          this.sendToClient(ws, { type: "error", payload: { message: "name and members are required" } });
          break;
        }
        // Name length + character validation
        if (name.length > MAX_GROUP_NAME_LENGTH) {
          this.sendToClient(ws, { type: "error", payload: { message: `群组名称不能超过 ${MAX_GROUP_NAME_LENGTH} 个字符` } });
          break;
        }
        if (!/^[\w一-鿿㐀-䶿 -]+$/.test(name)) {
          this.sendToClient(ws, { type: "error", payload: { message: "群组名称只能包含字母、数字、中文、连字符、下划线和空格" } });
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

        // 用 Creator ToolAgent 生成群组初始草案，调用方负责应用，失败不阻塞创建。
        let creatorDraftNote = "";
        const newGroup = this.groupManager!.get(id);
        if (newGroup) {
          const creatorProvider = this.providerResolver?.(DEFAULT_PROVIDER);
          if (creatorProvider) {
            try {
              const draft = await runGroupCreator(creatorProvider, DEFAULT_MODEL, {
                name,
                topic,
                members: allMembers.map(memberId => {
                  const member = this.agentRegistry?.get(memberId);
                  return {
                    id: memberId,
                    name: member?.name ?? memberId,
                    role: (member as any)?.config?.role,
                  };
                }),
              });

              if (draft.guide) {
                fs.writeFileSync(newGroup.workspace.paths.guide, draft.guide, "utf-8");
              }
              if (draft.plan) {
                newGroup.workspace.writeFile("plan", draft.plan);
              }

              creatorDraftNote = buildGroupCreatorDraftNote(draft);
            } catch (err) {
              log.warn("GroupCreator generation failed for %s, keeping default group templates: %s", id, err);
            }
          } else {
            log.warn("GroupCreator skipped for %s: default provider %s not found", id, DEFAULT_PROVIDER);
          }
        }

        // 唤醒群主与用户对接（不唤醒组员）
        if (newGroup) {
          newGroup.postMessage("system", `@host 新群组"${name}"已创建，成员包括：${allMembers.map(m => {
            const a = this.agentRegistry?.get(m);
            return a?.name ?? m;
          }).join("、")}。

【重要】在开始任何工作之前，你必须先与用户沟通：
1. 向用户打招呼，介绍群组已创建及其成员
2. 了解用户的具体需求和期望目标
3. 讨论任务范围和优先级
4. 获得用户确认后再开始规划和分配工作
${creatorDraftNote}

不要自行决定任务方向或直接开始工作——必须先征求用户意见。`);
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

      case "add_binding": {
        const { agentId, workspacePath, mode, label } = msg.payload as {
          agentId: string;
          workspacePath: string;
          mode: "readonly" | "readwrite";
          label?: string;
        };
        const agent = this.agentRegistry?.get(agentId);
        if (!agent) {
          this.sendToClient(ws, { type: "error", payload: { message: `Agent not found: ${agentId}` } });
          break;
        }

        // 安全校验：符号链接解析
        let realPath: string;
        try { realPath = fs.realpathSync(workspacePath); } catch {
          this.sendToClient(ws, { type: "error", payload: { message: `路径不存在或无法解析: ${workspacePath}` } });
          break;
        }

        // 安全校验：禁止系统目录（含根目录）
        const FORBIDDEN = [
          /^\/etc(\/|$)/, /^\/proc(\/|$)/, /^\/sys(\/|$)/, /^\/dev(\/|$)/,
          /^\/$/,
          /^[A-Z]:\\$/i,
          /[\\/]Windows[\\/]/i, /[\\/]Program Files[\\/]/i, /[\\/]ProgramData[\\/]/i,
          /[\\/]\.ssh[\\/]/, /[\\/]\.gnupg[\\/]/, /[\\/]\.aws[\\/]/, /[\\/]\.config[\\/]/,
        ];
        let blocked = false;
        for (const re of FORBIDDEN) {
          if (re.test(realPath)) {
            this.sendToClient(ws, { type: "error", payload: { message: `禁止绑定系统/敏感目录: ${workspacePath}` } });
            blocked = true;
            break;
          }
        }
        if (blocked) break;

        // 安全校验：禁止绑定 CoBeing 其他 Agent 数据目录
        const agentsDir = path.join(this.dataRoot, "agents");
        if (realPath.startsWith(agentsDir)) {
          const rel = path.relative(agentsDir, realPath);
          const agentIdFromPath = rel.split(path.sep)[0];
          if (agentIdFromPath && agentIdFromPath !== agentId) {
            this.sendToClient(ws, { type: "error", payload: { message: "禁止绑定其他 Agent 的数据目录" } });
            break;
          }
        }

        agent.addBinding({ path: realPath, mode, label });
        this.sendToClient(ws, { type: "binding_added", payload: { agentId, bindings: agent.bindings } });
        this.logMessage("system", `Binding added for ${agent.name}: ${realPath} (${mode})`);
        this.broadcastState();
        break;
      }

      case "remove_binding": {
        const { agentId, workspacePath } = msg.payload as { agentId: string; workspacePath: string };
        const agent = this.agentRegistry?.get(agentId);
        if (!agent) {
          this.sendToClient(ws, { type: "error", payload: { message: `Agent not found: ${agentId}` } });
          break;
        }
        agent.removeBinding(workspacePath);
        this.sendToClient(ws, { type: "binding_removed", payload: { agentId, bindings: agent.bindings } });
        this.broadcastState();
        break;
      }

      case "list_bindings": {
        const { agentId } = msg.payload as { agentId: string };
        const agent = this.agentRegistry?.get(agentId);
        if (!agent) {
          this.sendToClient(ws, { type: "error", payload: { message: `Agent not found: ${agentId}` } });
          break;
        }
        this.sendToClient(ws, { type: "bindings_list", payload: { agentId, bindings: agent.bindings } });
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
        const defaultProvider = this.providerResolver(DEFAULT_PROVIDER);
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
        if (!isSafeId(gfGId) || !isSafeLeafFilename(gfName)) {
          this.sendToClient(ws, { type: "error", payload: { message: "Invalid filename" } });
          break;
        }
        const gfGroup = this.groupManager?.get(gfGId);
        if (!gfGroup) {
          this.sendToClient(ws, { type: "error", payload: { message: `Group not found: ${gfGId}` } });
          break;
        }
        const gfPath = resolveWithin(path.join(this.dataRoot, "groups", gfGId), gfName);
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
        if (!isSafeId(sfGId) || !isSafeLeafFilename(sfName)) {
          this.sendToClient(ws, { type: "error", payload: { message: "Invalid filename" } });
          break;
        }
        const sfGroup = this.groupManager?.get(sfGId);
        if (!sfGroup) {
          this.sendToClient(ws, { type: "error", payload: { message: `Group not found: ${sfGId}` } });
          break;
        }
        const sfDir = path.join(this.dataRoot, "groups", sfGId);
        if (!fs.existsSync(sfDir)) fs.mkdirSync(sfDir, { recursive: true });
        fs.writeFileSync(resolveWithin(sfDir, sfName), sfContent, "utf-8");
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
        const rt = (globalThis as any).__cobeing?.runtime;
        if (!rt?.observabilityDB) {
          this.sendToClient(ws, { type: "dashboard", payload: { error: "Observability not available" } });
          break;
        }
        this.sendToClient(ws, { type: "dashboard", payload: rt.observabilityDB.getDashboard(gId) });
        break;
      }

      case "get_llm_stats": {
        const { agentId, groupId, since, limit } = (msg.payload as any) ?? {};
        const rt = (globalThis as any).__cobeing?.runtime;
        if (!rt?.observabilityDB) {
          this.sendToClient(ws, { type: "llm_stats", payload: { error: "Observability not available" } });
          break;
        }
        this.sendToClient(ws, { type: "llm_stats", payload: rt.observabilityDB.getLLMStats({ agentId, groupId, since, limit }) });
        break;
      }

      case "get_tool_stats": {
        const { agentId, groupId, since, limit } = (msg.payload as any) ?? {};
        const rt = (globalThis as any).__cobeing?.runtime;
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
        if (!isSafeId(aId) || !this.agentRegistry?.get(aId)) {
          this.sendToClient(ws, { type: "error", payload: { message: "Agent not found" } });
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
        if (!isSafeId(rAId) || !this.agentRegistry?.get(rAId) || !isSafeLeafFilename(filename)) {
          this.sendToClient(ws, { type: "error", payload: { message: "Invalid filename" } });
          break;
        }
        const rPaths = AgentPaths.forAgent(rAId, this.dataRoot);
        const filePath = resolveWithin(rPaths.directory, filename);
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
        if (!isSafeId(wAId) || !this.agentRegistry?.get(wAId) || !isSafeLeafFilename(wFilename)) {
          this.sendToClient(ws, { type: "error", payload: { message: "Invalid filename" } });
          break;
        }
        const wPaths = AgentPaths.forAgent(wAId, this.dataRoot);
        const wFilePath = resolveWithin(wPaths.directory, wFilename);
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
        const payload = buildTodoMutationPayload("added", { scope, agentId, groupId }, { todo: item });
        this.sendToClient(ws, { type: "todo_added", payload });
        this.broadcast({ type: "todo_updated", payload });
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
        const item = scope === "group" && groupId
          ? await this.groupManager?.completeGroupTodo?.(groupId, todoId)
          : store.complete(todoId);
        if (!item) {
          this.sendToClient(ws, { type: "error", payload: { message: `TODO not found: ${todoId}` } });
          break;
        }
        const payload = buildTodoMutationPayload("completed", { scope, agentId, groupId }, { todo: item });
        this.sendToClient(ws, { type: "todo_completed", payload });
        this.broadcast({ type: "todo_updated", payload });
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
        const payload = buildTodoMutationPayload("removed", { scope: rScope, agentId: rAgentId, groupId: rGroupId }, { todoId: rTodoId });
        this.sendToClient(ws, { type: "todo_removed", payload });
        this.broadcast({ type: "todo_updated", payload });
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
        if (sScope === "group" && sGroupId && sStatus === "completed") {
          const item = await this.groupManager?.completeGroupTodo?.(sGroupId, sTodoId);
          if (!item) {
            this.sendToClient(ws, { type: "error", payload: { message: `TODO not found: ${sTodoId}` } });
            break;
          }
        } else {
          const result = store.updateStatus(sTodoId, sStatus as any);
          if (!result.ok) {
            this.sendToClient(ws, { type: "error", payload: { message: result.error || "更新失败" } });
            break;
          }
        }
        this.broadcast({
          type: "todo_updated",
          payload: buildTodoMutationPayload("status-updated", { scope: sScope, agentId: sAgentId, groupId: sGroupId }, {
            todoId: sTodoId,
            status: sStatus,
          }),
        });
        break;
      }

      case "batch_complete_todo": {
        const { todoIds, scope: bcScope, agentId: bcAgentId, groupId: bcGroupId } = msg.payload as {
          todoIds: string[]; scope: "agent" | "group"; agentId?: string; groupId?: string;
        };
        const store = this.resolveTodoStore(bcScope, bcAgentId, bcGroupId);
        if (!store) { this.sendToClient(ws, { type: "error", payload: { message: "无法确定 TODO 存储" } }); break; }
        let result: { completed: number; failed: Array<{ id: string; reason: string }> };
        if (bcScope === "group" && bcGroupId && this.groupManager?.completeGroupTodo) {
          let completed = 0;
          const failed: Array<{ id: string; reason: string }> = [];
          for (const id of todoIds) {
            const item = await this.groupManager.completeGroupTodo(bcGroupId, id);
            if (item) completed++;
            else failed.push({ id, reason: "未找到" });
          }
          result = { completed, failed };
        } else {
          result = store.batchComplete(todoIds);
        }
        this.sendToClient(ws, { type: "todo_batch_result", payload: { action: "complete", scope: bcScope, agentId: bcAgentId, groupId: bcGroupId, ...result } });
        this.broadcast({
          type: "todo_updated",
          payload: buildTodoMutationPayload("batch-completed", { scope: bcScope, agentId: bcAgentId, groupId: bcGroupId }, { result }),
        });
        break;
      }

      case "batch_remove_todo": {
        const { todoIds: brIds, scope: brScope, agentId: brAgentId, groupId: brGroupId } = msg.payload as {
          todoIds: string[]; scope: "agent" | "group"; agentId?: string; groupId?: string;
        };
        const store = this.resolveTodoStore(brScope, brAgentId, brGroupId);
        if (!store) { this.sendToClient(ws, { type: "error", payload: { message: "无法确定 TODO 存储" } }); break; }
        const result = store.batchRemove(brIds);
        this.sendToClient(ws, { type: "todo_batch_result", payload: { action: "remove", scope: brScope, agentId: brAgentId, groupId: brGroupId, ...result } });
        this.broadcast({
          type: "todo_updated",
          payload: buildTodoMutationPayload("batch-removed", { scope: brScope, agentId: brAgentId, groupId: brGroupId }, { result }),
        });
        break;
      }

      case "batch_update_todo": {
        const { todoIds: buIds, scope: buScope, agentId: buAgentId, groupId: buGroupId, targetAgentId } = msg.payload as {
          todoIds: string[]; scope: "agent" | "group"; agentId?: string; groupId?: string; targetAgentId?: string;
        };
        const store = this.resolveTodoStore(buScope, buAgentId, buGroupId);
        if (!store) { this.sendToClient(ws, { type: "error", payload: { message: "无法确定 TODO 存储" } }); break; }
        const result = store.batchUpdate(buIds, { targetAgentId });
        this.sendToClient(ws, { type: "todo_batch_result", payload: { action: "update", scope: buScope, agentId: buAgentId, groupId: buGroupId, ...result } });
        this.broadcast({
          type: "todo_updated",
          payload: buildTodoMutationPayload("batch-updated", { scope: buScope, agentId: buAgentId, groupId: buGroupId }, { result, targetAgentId }),
        });
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
        const todoStore = this.groupManager?.getGroupTodoStore?.(hlGroupId);
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

      case "get_global_todos": {
        const gts = (globalThis as any).__cobeing?.runtime?.globalTodoStore;
        if (!gts) {
          this.sendToClient(ws, { type: "error", payload: { message: "GlobalTodoStore 未初始化" } });
          break;
        }
        const items = gts.list();
        this.sendToClient(ws, { type: "global_todos", payload: { todos: items } });
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
          if (exportAgentId && !isSafeId(exportAgentId)) { this.sendToClient(ws, { type: "error", payload: { message: "非法 agentId" } }); break; }
          if (exportGroupId && !isSafeId(exportGroupId)) { this.sendToClient(ws, { type: "error", payload: { message: "非法 groupId" } }); break; }

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
            case "start":
              // 容器按需启动，在 Agent 首次使用沙箱时自动触发
              break;
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

      // ===== Agent Enhancement endpoints =====

      case "get_agent_capability": {
        const { agentId: aId } = msg.payload as { agentId: string };
        if (!aId || !isSafeId(aId)) {
          this.sendToClient(ws, { type: "error", payload: { message: "Invalid agentId" } });
          break;
        }
        const aPaths = AgentPaths.forAgent(aId, this.dataRoot);
        const capPath = aPaths.capabilityPath;
        if (!fs.existsSync(capPath)) {
          this.sendToClient(ws, { type: "agent_capability", payload: { agentId: aId, capability: null } });
          break;
        }
        try {
          const capability = JSON.parse(fs.readFileSync(capPath, "utf-8"));
          this.sendToClient(ws, { type: "agent_capability", payload: { agentId: aId, capability } });
        } catch {
          this.sendToClient(ws, { type: "error", payload: { message: "Failed to read capability" } });
        }
        break;
      }

      case "get_agent_inbox": {
        const { agentId: inId } = msg.payload as { agentId: string };
        if (!inId || !isSafeId(inId)) {
          this.sendToClient(ws, { type: "error", payload: { message: "Invalid agentId" } });
          break;
        }
        const inPaths = AgentPaths.forAgent(inId, this.dataRoot);
        const inboxPath = inPaths.inboxPath;
        if (!fs.existsSync(inboxPath)) {
          this.sendToClient(ws, { type: "agent_inbox", payload: { agentId: inId, active: [], archived: [] } });
          break;
        }
        try {
          const data = JSON.parse(fs.readFileSync(inboxPath, "utf-8"));
          const active = Array.isArray(data) ? data : (data.active ?? []);
          const archived = Array.isArray(data) ? [] : (data.archived ?? []);
          this.sendToClient(ws, { type: "agent_inbox", payload: { agentId: inId, active, archived } });
        } catch {
          this.sendToClient(ws, { type: "error", payload: { message: "Failed to read inbox" } });
        }
        break;
      }

      case "get_agent_proposals": {
        const { agentId: pId } = msg.payload as { agentId: string };
        if (!pId || !isSafeId(pId)) {
          this.sendToClient(ws, { type: "error", payload: { message: "Invalid agentId" } });
          break;
        }
        const pPaths = AgentPaths.forAgent(pId, this.dataRoot);
        const proposalsDir = pPaths.proposalsDir;
        if (!fs.existsSync(proposalsDir)) {
          this.sendToClient(ws, { type: "agent_proposals", payload: { agentId: pId, proposals: [] } });
          break;
        }
        const proposals: import("@cobeing/shared").AgentGrowthProposal[] = [];
        for (const pf of fs.readdirSync(proposalsDir)) {
          if (!pf.endsWith(".json")) continue;
          try {
            proposals.push(JSON.parse(fs.readFileSync(path.join(proposalsDir, pf), "utf-8")));
          } catch { /* skip */ }
        }
        this.sendToClient(ws, { type: "agent_proposals", payload: { agentId: pId, proposals } });
        break;
      }

      case "approve_proposal": {
        const { agentId: apId, proposalId } = msg.payload as { agentId: string; proposalId: string };
        if (!apId || !isSafeId(apId) || !proposalId || !isSafeLeafFilename(proposalId + ".json")) {
          this.sendToClient(ws, { type: "error", payload: { message: "Invalid parameters" } });
          break;
        }
        const apPaths = AgentPaths.forAgent(apId, this.dataRoot);
        const propPath = apPaths.proposalPath(proposalId);
        if (!fs.existsSync(propPath)) {
          this.sendToClient(ws, { type: "error", payload: { message: "Proposal not found" } });
          break;
        }
        try {
          const prop = JSON.parse(fs.readFileSync(propPath, "utf-8")) as import("@cobeing/shared").AgentGrowthProposal;
          prop.status = "applied";
          prop.reviewedBy = "user";
          prop.reviewedAt = new Date().toISOString();
          fs.writeFileSync(propPath, JSON.stringify(prop, null, 2), "utf-8");

          const apFiles = new AgentFiles(apPaths);
          if (prop.targetFile === "CHARACTER.md") {
            apFiles.writeCharacter(prop.proposedPatch);
          } else if (prop.targetFile === "config.json") {
            try {
              const newConfig = JSON.parse(prop.proposedPatch);
              apFiles.writeConfig(newConfig);
            } catch {
              this.sendToClient(ws, { type: "error", payload: { message: "Proposed config.json patch is not valid JSON" } });
              break;
            }
          }

          this.sendToClient(ws, { type: "proposal_applied", payload: { agentId: apId, proposalId, targetFile: prop.targetFile } });
        } catch (e) {
          this.sendToClient(ws, { type: "error", payload: { message: `Failed to apply proposal: ${(e as Error).message}` } });
        }
        break;
      }

      case "reject_proposal": {
        const { agentId: rpId, proposalId: rPropId } = msg.payload as { agentId: string; proposalId: string };
        if (!rpId || !isSafeId(rpId) || !rPropId || !isSafeLeafFilename(rPropId + ".json")) {
          this.sendToClient(ws, { type: "error", payload: { message: "Invalid parameters" } });
          break;
        }
        const rpPaths = AgentPaths.forAgent(rpId, this.dataRoot);
        const rPropPath = rpPaths.proposalPath(rPropId);
        if (!fs.existsSync(rPropPath)) {
          this.sendToClient(ws, { type: "error", payload: { message: "Proposal not found" } });
          break;
        }
        try {
          const prop = JSON.parse(fs.readFileSync(rPropPath, "utf-8")) as import("@cobeing/shared").AgentGrowthProposal;
          prop.status = "rejected";
          prop.reviewedBy = "user";
          prop.reviewedAt = new Date().toISOString();
          fs.writeFileSync(rPropPath, JSON.stringify(prop, null, 2), "utf-8");
          this.sendToClient(ws, { type: "proposal_rejected", payload: { agentId: rpId, proposalId: rPropId } });
        } catch (e) {
          this.sendToClient(ws, { type: "error", payload: { message: `Failed to reject proposal: ${(e as Error).message}` } });
        }
        break;
      }

      case "find_agent": {
        const { taskDescription, requiredDomains, excludeAgentIds } = msg.payload as {
          taskDescription: string;
          requiredDomains?: string[];
          excludeAgentIds?: string[];
        };
        if (!taskDescription) {
          this.sendToClient(ws, { type: "error", payload: { message: "taskDescription is required" } });
          break;
        }
        const cards = loadCapabilityCards(this.dataRoot, excludeAgentIds ?? []);
        if (cards.length === 0) {
          this.sendToClient(ws, {
            type: "find_agent_result",
            payload: { bestAgentId: null, confidence: 0, reasoning: "未找到任何能力画像", alternatives: [] },
          });
          break;
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
        break;
      }

      case "dispatch_task": {
        const { agentId: dtId, title, goal, acceptance, constraints } = msg.payload as {
          agentId: string; title: string; goal: string; acceptance?: string; constraints?: string[];
        };
        if (!dtId || !title || !goal) {
          this.sendToClient(ws, { type: "error", payload: { message: "agentId, title and goal are required" } });
          break;
        }
        if (!isSafeId(dtId)) {
          this.sendToClient(ws, { type: "error", payload: { message: "Invalid agentId" } });
          break;
        }
        if (!this.agentRegistry?.get(dtId)) {
          this.sendToClient(ws, { type: "error", payload: { message: `Agent not found: ${dtId}` } });
          break;
        }
        const runtime = (globalThis as any).__cobeing?.runtime;
        if (!runtime?.globalTodoStore || !runtime?.butlerTaskStore) {
          this.sendToClient(ws, { type: "error", payload: { message: "Butler runtime stores are not available" } });
          break;
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
            targetType: "agent",
            targetId: dtId,
            title,
            goal,
            acceptance,
            constraints,
          });
          this.sendToClient(ws, {
            type: "dispatch_task_result",
            payload: {
              ok: true,
              agentId: dtId,
              globalTodoId: receipt.globalTodo.id,
              butlerTaskId: receipt.butlerTaskId,
              executionRef: receipt.executionRef,
            },
          });
        } catch (e) {
          this.sendToClient(ws, { type: "dispatch_task_result", payload: { ok: false, error: (e as Error).message } });
        }
        break;
      }

      default:
        log.warn("Unknown WS message type: %s", msg.type);
    }
  }

  /** 广播 Global TODO 变更事件（供工具层调用） */
  broadcastGlobalTodoUpdate(): void {
    this.broadcast({ type: "global_todo_updated", payload: { timestamp: Date.now() } });
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

  private listPlugins(): Array<{
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
  if (value === null) {
    delete current[lastKey];
    return;
  }
  current[lastKey] = value;
}

function isSafeConfigPath(cfgPath: string): boolean {
  if (!cfgPath || cfgPath.length > 200) return false;
  const keys = cfgPath.split(".");
  if (keys.length === 0 || keys.length > 8) return false;
  return keys.every(key =>
    /^[A-Za-z0-9_-]+$/.test(key) &&
    key !== "__proto__" &&
    key !== "constructor" &&
    key !== "prototype"
  );
}
