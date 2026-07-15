/**
 * Agent Resource 工具 — 向 Butler 请求资源
 */
import type { Tool, ToolContext, ToolResult } from "@cobeing/shared";

export function makeAgentRequestResourceTool(): Tool {
  return {
    name: "agent-request-resource",
    description: "向管家 (Butler) 请求缺少的资源（技能、插件、模板等）。你只能提出需求，不能自行安装。" +
      "\n\n⚠️ 管家收到请求后会检索 Market 并征求用户确认，确认后才安装资源。",
    parameters: {
      type: "object",
      properties: {
        resourceType: { type: "string", enum: ["skill", "plugin", "template", "tool", "other"], description: "需要的资源类型" },
        description: { type: "string", description: "描述你需要什么资源以及为什么需要它" },
        urgency: { type: "string", enum: ["low", "medium", "high"], description: "紧急程度" },
      },
      required: ["resourceType", "description"],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const resourceType = params.resourceType as string;
      const description = params.description as string;
      const urgency = (params.urgency as string) ?? "low";

      const typeLabel: Record<string, string> = { skill: "技能", plugin: "插件", template: "模板", tool: "工具", other: "资源" };

      return {
        toolCallId: "",
        content: `📋 资源请求已发送给管家:\n` +
          `- **类型**: ${typeLabel[resourceType] || resourceType}\n` +
          `- **需求**: ${description}\n` +
          `- **紧急程度**: ${urgency}\n\n` +
          `管家会在审查后联系你。请不要自行安装任何资源。`,
      };
    },
  };
}
