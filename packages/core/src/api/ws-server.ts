/**
 * Core WebSocket 服务 — 为 GUI 提供状态查询和控制接口
 * 直接从 AgentRegistry / GroupManager 读取实时状态
 */
import { WebSocketServer, WebSocket } from "ws";
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

  constructor(private port: number = 18765) {}

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
