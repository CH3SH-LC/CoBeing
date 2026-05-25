/**
 * MCP Server — JSON-RPC 2.0 over stdio
 *
 * 实现 MCP 协议的最小服务器端，通过 stdin/stdout 与客户端通信。
 * 每个 JSON-RPC 消息为一行 JSON（末尾换行）。
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

export class MCPServer {
  private config: ServerConfig;

  constructor(config: ServerConfig) {
    this.config = config;
  }

  async run(): Promise<void> {
    let buffer = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) this.handleMessage(trimmed).catch(e => log.error("Handle error: %s", e.message));
      }
    });
    process.stdin.on("end", () => { log.info("stdin closed, exiting"); process.exit(0); });
    process.stdin.on("error", (err) => { log.error("stdin error: %s", err.message); process.exit(1); });
  }

  private async handleMessage(raw: string): Promise<void> {
    let msg: any;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!("id" in msg) || msg.id === undefined) return;
    const id = msg.id;
    try {
      switch (msg.method) {
        case "initialize": this.handleInitialize(id, msg.params); break;
        case "ping": this.sendResponse(id, {}); break;
        case "tools/list": this.handleToolsList(id); break;
        case "tools/call": await this.handleToolCall(id, msg.params); break;
        default: this.sendError(id, -32601, `Method not found: ${msg.method}`);
      }
    } catch (err: any) {
      this.sendError(id, -32603, `Internal error: ${err.message}`);
    }
  }

  private handleInitialize(id: number, _params?: any): void {
    this.sendResponse(id, {
      protocolVersion: "2025-11-25",
      capabilities: this.config.capabilities,
      serverInfo: this.config.serverInfo,
    });
  }

  private handleToolsList(id: number): void {
    const tools: MCPToolInfo[] = this.config.tools.map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
    this.sendResponse(id, { tools });
  }

  private async handleToolCall(id: number, params?: any): Promise<void> {
    const name = params?.name as string | undefined;
    const args = (params?.arguments as Record<string, unknown>) || {};
    if (!name) { this.sendError(id, -32602, "Missing tool name"); return; }
    const tool = this.config.tools.find(t => t.name === name);
    if (!tool) { this.sendError(id, -32602, `Unknown tool: ${name}`); return; }
    try {
      const result = await tool.execute(args);
      this.sendResponse(id, { content: [{ type: "text", text: result.content }], isError: result.isError });
    } catch (err: any) {
      this.sendResponse(id, { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true });
    }
  }

  private sendResponse(id: number, result: unknown): void {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
  }
  private sendError(id: number, code: number, message: string): void {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n");
  }
}
