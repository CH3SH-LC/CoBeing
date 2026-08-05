/**
 * Butler workspace tools
 * (butler-bind-workspace, butler-list)
 */
import type { Tool, ToolContext, ToolResult } from "@cobeing/shared";
import type { GroupManager } from "../../../group/manager.js";
import { AgentRegistry } from "../../registry.js";

export function makeBindWorkspaceTool(registry: AgentRegistry): Tool {
  return {
    name: "butler-bind-workspace",
    description: "将 Agent 的工作目录绑定到外部文件夹。Agent 的文件操作（读/写/bash）将在绑定目录执行，但核心文件（CHARACTER/JOB/memory）仍保留在原位置。传入空路径可解绑。",
    parameters: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "目标 Agent ID" },
        path: { type: "string", description: "要绑定的外部目录路径（绝对路径）。留空或填 'default' 可解绑恢复默认工作区。" },
      },
      required: ["agentId"],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const agentId = params.agentId as string;
      const agent = registry.get(agentId);
      if (!agent) return { toolCallId: "", content: `未找到 Agent: ${agentId}`, isError: true };

      const rawPath = (params.path as string)?.trim();
      let bindPath: string | null = null;

      if (!rawPath || rawPath === "default" || rawPath === "") {
        // 解绑
        agent.clearBindings();
        return {
          toolCallId: "",
          content: `已解绑 ${agent.name} 的外部工作目录，恢复默认工作区: ${agent.effectiveWorkspace}`,
        };
      }

      // 验证路径
      const fs = await import("node:fs");
      const path = await import("node:path");
      const resolved = path.resolve(rawPath);
      if (!fs.existsSync(resolved)) {
        return { toolCallId: "", content: `绑定目录不存在: ${resolved}`, isError: true };
      }

      agent.addBinding({ path: resolved, mode: "readwrite" });
      return {
        toolCallId: "",
        content: `已将 ${agent.name} 绑定到外部工作目录:\n绑定路径: ${resolved}\n核心文件仍在: ${(agent as any).paths.directory}`,
      };
    },
  };
}

export function makeListTool(registry: AgentRegistry, groupManager: GroupManager): Tool {
  return {
    name: "butler-list",
    description: "列出所有 Agent 和群组，含 Agent 运行状态（空闲/忙碌中/异常）",
    parameters: { type: "object", properties: {} },
    async execute(_params, _context: ToolContext): Promise<ToolResult> {
      const agents = registry.list().map(a => {
        const st = a.getStatus();
        const statusLabel = st === "running" ? "忙碌中" : st === "error" ? "异常" : "空闲";
        return `  - ${a.name} (${a.id}) [${statusLabel}]`;
      }).join("\n");
      const groups = groupManager.list().map(g =>
        `  - ${g.config.name} (${g.id}) [${g.config.members.length} 成员]`
      ).join("\n");
      return {
        toolCallId: "",
        content: `## Agent 列表\n${agents || "  (无)"}\n\n## 群组列表\n${groups || "  (无)"}`,
      };
    },
  };
}
