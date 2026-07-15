/**
 * group-memory-search — 搜索 Agent 在群组中的历史消息和重要片段
 */
import type { Tool, ToolContext, ToolResult } from "@cobeing/shared";
import type { GroupAgentMemory } from "../group/agent-memory.js";

type MemoryGetter = (groupId: string, agentId: string) => GroupAgentMemory | undefined;

export function makeGroupMemorySearchTool(getMemory: MemoryGetter): Tool {
  return {
    name: "group-memory-search",
    description: "搜索你在本群组中的历史消息和重要片段。用于回忆之前的讨论内容、查找关键决策、检索技术细节。",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "搜索关键词" },
        type: {
          type: "string",
          enum: ["messages", "fragments", "all"],
          description: "搜索范围：messages=消息, fragments=重要片段, all=全部（默认）",
        },
        limit: { type: "number", description: "返回条数，默认 10" },
      },
      required: ["query"],
    },
    async execute(params, context: ToolContext): Promise<ToolResult> {
      const query = params.query as string;
      const type = (params.type as string) || "all";
      const limit = (params.limit as number) || 10;

      // 从 context 中获取 groupId
      const groupId = (context as any).groupId as string | undefined;
      if (!groupId) {
        return { toolCallId: "", content: "此工具只能在群组上下文中使用。", isError: true };
      }

      const memory = getMemory(groupId, context.agentId);
      if (!memory) {
        return { toolCallId: "", content: `未找到群组 ${groupId} 的记忆存储。`, isError: true };
      }

      const results: string[] = [];

      if (type === "messages" || type === "all") {
        const messages = memory.search(query, limit);
        if (messages.length > 0) {
          results.push("=== 匹配的消息 ===");
          for (const msg of messages) {
            const time = new Date(msg.timestamp).toLocaleString("zh-CN");
            results.push(`[${time}] [${msg.fromAgentId}] (${msg.tag}): ${msg.content}`);
          }
        }
      }

      if (type === "fragments" || type === "all") {
        const fragments = memory.searchFragments(query, limit);
        if (fragments.length > 0) {
          results.push("=== 匹配的重要片段 ===");
          for (const frag of fragments) {
            const time = new Date(frag.timestamp).toLocaleString("zh-CN");
            results.push(`[${time}] ${frag.content}${frag.reason ? ` (${frag.reason})` : ""}`);
          }
        }
      }

      if (results.length === 0) {
        return { toolCallId: "", content: `未找到包含 "${query}" 的记录。` };
      }

      return { toolCallId: "", content: results.join("\n") };
    },
  };
}
