/**
 * MCP Client — JSON-RPC 2.0 客户端，管理 MCP 服务器连接
 */
import type { MCPServerConfig, MCPToolInfo, MCPResource } from "@cobeing/shared";
import { createLogger } from "@cobeing/shared";
import {
  MCPTransport,
  StdioTransport,
  HTTPTransport,
  type JSONRPCMessage,
  type JSONRPCResponse,
  type JSONRPCRequest,
  type JSONRPCNotification,
} from "./transport.js";

const log = createLogger("mcp-client");

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface MCPServerCapabilities {
  tools?: { listChanged?: boolean };
  resources?: { subscribe?: boolean; listChanged?: boolean };
  prompts?: { listChanged?: boolean };
  logging?: {};
}

export class MCPClient {
  private transport: MCPTransport;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private capabilities: MCPServerCapabilities = {};
  private serverInfo: { name: string; version: string } = { name: "", version: "" };
  private _connected = false;

  constructor(
    readonly id: string,
    config: MCPServerConfig,
  ) {
    if (config.transport === "stdio") {
      this.transport = new StdioTransport(config.command ?? "echo", config.args, config.env);
    } else {
      this.transport = new HTTPTransport(config.url ?? "", config.headers);
    }

    this.transport.onMessage((msg) => this.handleMessage(msg));
  }

  get connected(): boolean { return this._connected; }
  get serverName(): string { return this.serverInfo.name; }

  /** 连接到 MCP 服务器，完成初始化握手 */
  async connect(): Promise<void> {
    await this.transport.start();
    log.info("[%s] Transport started", this.id);

    // Initialize 握手
    const initResult = await this.request("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {
        roots: { listChanged: true },
      },
      clientInfo: { name: "CoBeing", version: "0.1.0" },
    }) as {
      protocolVersion: string;
      capabilities: MCPServerCapabilities;
      serverInfo: { name: string; version: string };
      instructions?: string;
    };

    log.info("[%s] Connected to %s v%s", this.id, initResult.serverInfo.name, initResult.serverInfo.version);
    this.capabilities = initResult.capabilities ?? {};
    this.serverInfo = initResult.serverInfo;

    // 发送 initialized 通知
    await this.notify("notifications/initialized");
    this._connected = true;
  }

  /** 列出服务器提供的工具 */
  async listTools(): Promise<MCPToolInfo[]> {
    if (!this.capabilities.tools) return [];
    const result = await this.request("tools/list", {}) as { tools: MCPToolInfo[] };
    return result.tools ?? [];
  }

  /** 调用一个工具 */
  async callTool(name: string, args: Record<string, unknown>): Promise<{ content: string; isError?: boolean }> {
    const result = await this.request("tools/call", { name, arguments: args }) as {
      content: Array<{ type: string; text?: string }>;
      isError?: boolean;
    };

    // 拼接所有 text 内容
    const text = result.content
      ?.filter(c => c.type === "text" && c.text)
      .map(c => c.text!)
      .join("\n") ?? "";

    return { content: text, isError: result.isError };
  }

  /** 列出资源 */
  async listResources(): Promise<MCPResource[]> {
    if (!this.capabilities.resources) return [];
    const result = await this.request("resources/list", {}) as { resources: MCPResource[] };
    return result.resources ?? [];
  }

  /** 读取资源 */
  async readResource(uri: string): Promise<string> {
    const result = await this.request("resources/read", { uri }) as {
      contents: Array<{ uri: string; text?: string; blob?: string }>;
    };
    return result.contents?.[0]?.text ?? "";
  }

  /** 健康检查 */
  async ping(): Promise<boolean> {
    try {
      await this.request("ping", {});
      return true;
    } catch {
      return false;
    }
  }

  /** 关闭连接 */
  async close(): Promise<void> {
    // 取消所有 pending
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Connection closed"));
      this.pending.delete(id);
    }
    await this.transport.close();
    this._connected = false;
    log.info("[%s] Disconnected", this.id);
  }

  // ---- JSON-RPC 内部 ----

  private async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    const message: JSONRPCRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, 30000);

      this.pending.set(id, { resolve, reject, timer });
      this.transport.send(message).catch(reject);
    });
  }

  private async notify(method: string, params?: Record<string, unknown>): Promise<void> {
    const message: JSONRPCNotification = {
      jsonrpc: "2.0",
      method,
      ...(params ? { params } : {}),
    };
    await this.transport.send(message);
  }

  private handleMessage(msg: JSONRPCMessage): void {
    // Response
    if ("id" in msg && !("method" in msg)) {
      const resp = msg as JSONRPCResponse;
      const id = resp.id as number;
      const pending = this.pending.get(id);
      if (!pending) return;

      clearTimeout(pending.timer);
      this.pending.delete(id);

      if (resp.error) {
        pending.reject(new Error(resp.error.message));
      } else {
        pending.resolve(resp.result);
      }
      return;
    }

    // Notification
    if ("method" in msg && !("id" in msg)) {
      const notif = msg as JSONRPCNotification;
      log.debug("[%s] Notification: %s", this.id, notif.method);
    }
  }
}
