/**
 * MCP Server — JSON-RPC 2.0 over stdio
 *
 * 实现 MCP 协议的最小服务器端，通过 stdin/stdout 与客户端通信。
 * 每个 JSON-RPC 消息为一行 JSON（末尾换行）。
 *
 * 支持的方法:
 *   - initialize          → 握手，返回 capabilities
 *   - notifications/initialized  → 客户端初始化完成通知
 *   - tools/list          → 返回工具列表
 *   - tools/call          → 调用工具
 *   - ping                → 健康检查
 */
import { createLogger } from "@cobeing/shared";
import type { MCPToolInfo } from "@cobeing/shared";

const log = createLogger("mcp-server");

interface Tool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  execute: (params: Record<string, unknown>) => Promise<{ content: string; isError?: boolean }>;
}

interface ServerConfig {
  serverInfo: { name: string; version: string };
  capabilities: { tools?: { listChanged?: boolean } };
  tools: Tool[];
}

type JSONRPCRequest = {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
};

type JSONRPCNotification = {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
};

type JSONRPCMessage = JSONRPCRequest | JSONRPCNotification;

export class MCPServer {
  private config: ServerConfig;

  constructor(config: ServerConfig) {
    this.config = config;
  }

  async run(): Promise<void> {
    // stdin 流式读取（行分隔）
    let buffer = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      // 最后一个可能是不完整的行
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) {
          this.handleMessage(trimmed).catch((err) =>
            log.error("Handle error: %s", err.message)
          );
        }
      }
    });

    process.stdin.on("end", () => {
      log.info("stdin closed, exiting");
      process.exit(0);
    });

    process.stdin.on("error", (err) => {
      log.error("stdin error: %s", err.message);
      process.exit(1);
    });
  }

  private async handleMessage(raw: string): Promise<void> {
    let msg: JSONRPCMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      log.error("Invalid JSON: %s", raw.slice(0, 200));
      return;
    }

    // Notification（无 id）
    if (!("id" in msg) || msg.id === undefined) {
      this.handleNotification(msg);
      return;
    }

    const id = msg.id;
    const { method, params } = msg;

    try {
      switch (method) {
        case "initialize":
          await this.handleInitialize(id, params);
          break;
        case "ping":
          this.sendResponse(id, {});
          break;
        case "tools/list":
          this.handleToolsList(id);
          break;
        case "tools/call":
          await this.handleToolCall(id, params);
          break;
        default:
          this.sendError(id, -32601, `Method not found: ${method}`);
      }
    } catch (err: any) {
      log.error("Method %s error: %s", method, err.message);
      this.sendError(id, -32603, `Internal error: ${err.message}`);
    }
  }

  private handleNotification(msg: JSONRPCNotification): void {
    switch (msg.method) {
      case "notifications/initialized":
        log.info("Client initialized");
        break;
      default:
        log.debug("Unhandled notification: %s", msg.method);
    }
  }

  private async handleInitialize(
    id: number,
    params?: Record<string, unknown>,
  ): Promise<void> {
    const clientInfo = params?.clientInfo as
      | { name?: string; version?: string }
      | undefined;
    log.info(
      "Initialize from %s v%s",
      clientInfo?.name ?? "unknown",
      clientInfo?.version ?? "?",
    );

    this.sendResponse(id, {
      protocolVersion: "2025-11-25",
      capabilities: this.config.capabilities,
      serverInfo: this.config.serverInfo,
    });
  }

  private handleToolsList(id: number): void {
    const tools: MCPToolInfo[] = this.config.tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));

    this.sendResponse(id, { tools });
  }

  private async handleToolCall(
    id: number,
    params?: Record<string, unknown>,
  ): Promise<void> {
    const name = params?.name as string | undefined;
    const args = (params?.arguments as Record<string, unknown>) || {};

    if (!name) {
      this.sendError(id, -32602, "Missing tool name");
      return;
    }

    const tool = this.config.tools.find((t) => t.name === name);
    if (!tool) {
      this.sendError(id, -32602, `Unknown tool: ${name}`);
      return;
    }

    try {
      const result = await tool.execute(args);
      this.sendResponse(id, {
        content: [{ type: "text", text: result.content }],
        isError: result.isError,
      });
    } catch (err: any) {
      this.sendResponse(id, {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true,
      });
    }
  }

  private sendResponse(id: number, result: unknown): void {
    const msg = JSON.stringify({ jsonrpc: "2.0", id, result });
    process.stdout.write(msg + "\n");
  }

  private sendError(id: number, code: number, message: string): void {
    const msg = JSON.stringify({
      jsonrpc: "2.0",
      id,
      error: { code, message },
    });
    process.stdout.write(msg + "\n");
  }
}
