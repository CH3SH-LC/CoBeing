/**
 * MCP Discover & Register 工具
 *
 * 允许 Agent 按需发现和注册 MCP 服务器提供的工具，而非启动时自动推给所有 Agent。
 *
 * mcp-discover: 列出所有已连接的 MCP 服务器及其工具
 * mcp-register: 将指定 MCP 服务器的工具注册到当前 Agent
 */
import type { Tool, ToolContext, ToolResult } from "@cobeing/shared";
import type { MCPManager } from "../mcp/manager.js";

export function makeMCPDiscoverTool(mcpManager: MCPManager): Tool {
  return {
    name: "mcp-discover",
    description: `发现可用的 MCP 服务器及其提供的工具。
返回每个 MCP 服务器的 ID、名称、可用工具列表（含工具名和描述）。
调用后你可以选择用 mcp-register 注册你需要的工具到当前会话。`,
    parameters: {
      type: "object",
      properties: {
        serverId: { type: "string", description: "可选：只查询指定服务器的工具" },
      },
    },
    async execute(params: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
      const serverId = params.serverId as string | undefined;
      const servers = mcpManager.getServers();

      if (servers.length === 0) {
        return { toolCallId: "", content: "当前没有已连接的 MCP 服务器。\n请确保 config/default.json 中的 mcpServers 已正确配置。" };
      }

      if (serverId) {
        const server = servers.find(s => s.id === serverId);
        if (!server) {
          return { toolCallId: "", content: `未找到 MCP 服务器 "${serverId}"。可用服务器: ${servers.map(s => s.id).join(", ")}`, isError: true };
        }
        const toolLines = server.tools.map(t =>
          `  - ${t.name}${t.description ? `\n    用途: ${t.description.split("\n")[0]}` : ""}`
        );
        return {
          toolCallId: "",
          content: [
            `MCP 服务器: ${server.id}`,
            `  名称: ${server.serverName}`,
            `  工具数: ${server.toolCount}`,
            `  状态: ${server.connected ? "已连接" : "未连接"}`,
            ``,
            `可用工具:`,
            ...toolLines,
            ``,
            `提示: 用 mcp-register serverId="${server.id}" 注册这些工具到当前会话。`,
          ].join("\n"),
        };
      }

      const serverLines = servers.map(s =>
        `- ${s.id} (${s.serverName}): ${s.toolCount} 个工具${s.connected ? " [已连接]" : " [未连接]"}`
      );
      return {
        toolCallId: "",
        content: [
          `可用 MCP 服务器 (${servers.length}):`,
          ...serverLines,
          ``,
          `提示: 用 mcp-discover serverId="xxx" 查看具体工具列表，用 mcp-register serverId="xxx" 注册工具。`,
        ].join("\n"),
      };
    },
  };
}

export function makeMCPRegisterTool(mcpManager: MCPManager): Tool {
  return {
    name: "mcp-register",
    description: `注册指定 MCP 服务器的工具到当前 Agent。
注册后你就可以在当前会话中直接使用这些工具。
先调用 mcp-discover 查看有哪些 MCP 服务器和工具可用。`,
    parameters: {
      type: "object",
      properties: {
        serverId: { type: "string", description: '要注册的 MCP 服务器 ID，如 "qqbot"' },
      },
      required: ["serverId"],
    },
    async execute(params: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const serverId = params.serverId as string;
      if (!serverId) {
        return { toolCallId: "", content: "请指定 serverId", isError: true };
      }

      const tools = mcpManager.getServerTools(serverId);
      if (tools.length === 0) {
        const servers = mcpManager.getServers();
        const known = servers.map(s => s.id).join(", ");
        return {
          toolCallId: "",
          content: `MCP 服务器 "${serverId}" 没有可用工具${known ? `。已知服务器: ${known}` : "，请先检查配置"}。`,
          isError: true,
        };
      }

      // 通过 context.agentId 查 registry 来注册工具（runtime 注入 registry 引用）
      const registry = (globalThis as any).__cobeingAgentRegistry;
      const agent = registry?.get(context.agentId);
      if (!agent) {
        return { toolCallId: "", content: `Agent ${context.agentId} 未在注册表中，无法注册工具`, isError: true };
      }

      const toolNames: string[] = [];
      for (const tool of tools) {
        agent.registerTool(tool);
        toolNames.push(tool.name);
      }
      // 重建 conversation loop 以包含新工具
      if (typeof (agent as any).rebuildLoop === "function") {
        (agent as any).rebuildLoop();
      }

      // server 的 instructions 使用指南（若有），让 Agent 获得「怎么用」而非只拿到工具名
      const instructions = mcpManager.getInstructions(serverId);

      return {
        toolCallId: "",
        content: [
          `已注册 MCP 服务器 "${serverId}" 的 ${tools.length} 个工具到当前会话:`,
          ...toolNames.map(n => `  - ${n}`),
          ...(instructions
            ? ["", "【使用指南】", instructions]
            : []),
        ].join("\n"),
      };
    },
  };
}
