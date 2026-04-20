/**
 * Core WebSocket 服务 — 为 GUI 提供状态查询和控制接口
 * 直接从 AgentRegistry / GroupManager 读取实时状态
 */
import { WebSocketServer, WebSocket } from "ws";
import fs from "node:fs";
import path from "node:path";
import { createLogger } from "@myagents/shared";
import type { Agent } from "../agent/agent.js";
import type { AgentRegistry } from "../agent/registry.js";
import type { GroupManager } from "../group/manager.js";

const log = createLogger("ws-server");

interface WSMessage {
  type: string;
  payload?: unknown;
}

export class CoreWSServer {
  private wss: WebSocketServer | null = null;
  private agentRegistry: AgentRegistry | null = null;
  private groupManager: GroupManager | null = null;
  private clients = new Set<WebSocket>();
  private messageLog: Array<{ timestamp: number; direction: string; content: string }> = [];

  constructor(private port: number = 18765, private configPath?: string) {}

  /** 注入 AgentRegistry — 后续 getState 直接读取 */
  setAgentRegistry(registry: AgentRegistry): void {
    this.agentRegistry = registry;
  }

  /** 注入 GroupManager */
  setGroupManager(gm: GroupManager): void {
    this.groupManager = gm;
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.wss = new WebSocketServer({ port: this.port });
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
      // 如果还没注入 registry，至少能通过这条路径追踪 butler
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

  private handleMessage(ws: WebSocket, msg: WSMessage): void {
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
        this.logMessage("in", content);
        agent.run(content, {
          onToken: (token) => {
            this.sendToClient(ws, { type: "stream_token", payload: { token } });
          },
        }).then((response) => {
          this.logMessage("out", response.content);
          this.sendToClient(ws, { type: "agent_response", payload: { content: response.content } });
          this.broadcastState();
        }).catch((err) => {
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
          setNestedValue(config, cfgPath, value);
          fs.writeFileSync(configFilePath, JSON.stringify(config, null, 2) + "\n", "utf-8");
          this.sendToClient(ws, { type: "config_updated", payload: { path: cfgPath, success: true } });
          this.broadcast({ type: "config", payload: config });
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

      default:
        log.warn("Unknown WS message type: %s", msg.type);
    }
  }

  private getState() {
    // 直接从 AgentRegistry 读取 — 包含所有已注册的 Agent（butler + 动态创建的）
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
          protocol: g.config.protocol,
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
