/**
 * Butler registry tools
 * (butler-read-registry, butler-update-registry)
 */
import type { Tool, ToolContext, ToolResult } from "@cobeing/shared";
import { ButlerRegistry } from "../../butler-registry.js";

export function makeReadRegistryTool(butlerRegistry: ButlerRegistry): Tool {
  return {
    name: "butler-read-registry",
    description: "阅读 Agent/Group 注册表（了解已有 agent 和群组）",
    parameters: {
      type: "object",
      properties: {
        type: {
          type: "string",
          description: "读取类型: agents / groups / all",
        },
      },
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const type = (params.type as string) ?? "all";
      let content = "";

      if (type === "agents" || type === "all") {
        content += "=== Agent 注册表 ===\n" + (butlerRegistry.readAgentsRegistry() || "(空)");
      }
      if (type === "groups" || type === "all") {
        if (content) content += "\n\n";
        content += "=== 群组注册表 ===\n" + (butlerRegistry.readGroupsRegistry() || "(空)");
      }

      return { toolCallId: "", content };
    },
  };
}

export function makeUpdateRegistryTool(butlerRegistry: ButlerRegistry): Tool {
  return {
    name: "butler-update-registry",
    description: "更新 Agent/Group 信息到注册表",
    parameters: {
      type: "object",
      properties: {
        type: { type: "string", description: "更新类型: agent / group" },
        id: { type: "string", description: "Agent 或 Group ID" },
        updates: {
          type: "object",
          description: "要更新的字段（如 status, capabilities, outcome）",
        },
      },
      required: ["type", "id"],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const type = params.type as string;
      const id = params.id as string;
      const updates = (params.updates as Record<string, string>) ?? {};

      if (type === "agent") {
        const existing = butlerRegistry.getAgent(id);
        if (!existing) {
          return { toolCallId: "", content: `未找到 Agent: ${id}`, isError: true };
        }
        butlerRegistry.registerAgent({
          ...existing,
          ...updates,
          id: existing.id,
          name: updates.name ?? existing.name,
          role: updates.role ?? existing.role,
        });
        return { toolCallId: "", content: `已更新 Agent ${id}` };
      }

      if (type === "group") {
        const groups = butlerRegistry.parseGroupsRegistry();
        const existing = groups.find(g => g.id === id);
        if (!existing) {
          return { toolCallId: "", content: `未找到群组: ${id}`, isError: true };
        }
        butlerRegistry.registerGroup({
          ...existing,
          ...updates,
          id: existing.id,
          name: updates.name ?? existing.name,
          members: existing.members,
        });
        return { toolCallId: "", content: `已更新群组 ${id}` };
      }

      return { toolCallId: "", content: `未知类型: ${type}`, isError: true };
    },
  };
}
