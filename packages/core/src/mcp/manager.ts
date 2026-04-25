/**
 * MCP Manager — 管理多个 MCP 服务器连接，桥接工具
 */
import type { MCPServerConfig, Tool, ToolContext, ToolResult } from "@cobeing/shared";
import { createLogger } from "@cobeing/shared";
import { MCPClient } from "./client.js";

const log = createLogger("mcp-manager");

/**
 * 将一个 MCP 工具包装为 Tool 接口
 */
function bridgeTool(client: MCPClient, toolInfo: { name: string; description?: string; inputSchema: Record<string, unknown> }): Tool {
  const mcpName = toolInfo.name;
  const prefixedName = `mcp:${client.id}:${mcpName}`;

  return {
    name: prefixedName,
    description: toolInfo.description ?? `MCP tool: ${mcpName}`,
    parameters: toolInfo.inputSchema,
    async execute(params: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
      try {
        const result = await client.callTool(mcpName, params);
        return {
          toolCallId: "",
          content: result.content || "(no output)",
          isError: result.isError,
        };
      } catch (err: any) {
        return {
          toolCallId: "",
          content: `MCP tool error: ${err.message}`,
          isError: true,
        };
      }
    },
  };
}

export class MCPManager {
  private clients = new Map<string, MCPClient>();
  private tools: Tool[] = [];

  /** 连接到一个 MCP 服务器 */
  async connect(id: string, config: MCPServerConfig): Promise<void> {
    if (this.clients.has(id)) {
      log.warn("[%s] Already connected, reconnecting", id);
      await this.disconnect(id);
    }

    const client = new MCPClient(id, config);
    await client.connect();

    // 发现工具
    const mcpTools = await client.listTools();
    const bridged = mcpTools.map(t => bridgeTool(client, t));

    this.clients.set(id, client);
    this.tools.push(...bridged);

    log.info("[%s] Connected: %d tools available", id, bridged.length);
  }

  /** 断开一个 MCP 服务器 */
  async disconnect(id: string): Promise<void> {
    const client = this.clients.get(id);
    if (!client) return;
    await client.close();
    this.clients.delete(id);
    // 移除该 client 的桥接工具
    this.tools = this.tools.filter(t => !t.name.startsWith(`mcp:${id}:`));
  }

  /** 获取所有桥接的 Tool 对象 */
  getTools(): Tool[] {
    return [...this.tools];
  }

  /** 获取所有已连接的客户端信息 */
  getClients(): Array<{ id: string; serverName: string; connected: boolean }> {
    return [...this.clients.values()].map(c => ({
      id: c.id,
      serverName: c.serverName,
      connected: c.connected,
    }));
  }

  /** 关闭所有连接 */
  async close(): Promise<void> {
    for (const [id, client] of this.clients) {
      try {
        await client.close();
      } catch {
        log.warn("[%s] Error closing", id);
      }
    }
    this.clients.clear();
    this.tools = [];
  }
}
