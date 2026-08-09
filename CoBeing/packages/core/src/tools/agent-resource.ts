/**
 * Agent Resource 工具 — 向 Butler 请求资源
 *
 * P0 Butler 托管闭环：请求不再只返回文本——广播 `butler_resource_request` 事件
 * 给前端/管家，并追加到管家工作区收件箱（RESOURCE_REQUESTS.md），管家据此检索
 * Market 并征求用户确认。
 */
import type { Tool, ToolContext, ToolResult } from "@cobeing/shared";
import { createLogger } from "@cobeing/shared";
import path from "node:path";
import fs from "node:fs";

const log = createLogger("agent-resource");

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
    async execute(params, context: ToolContext): Promise<ToolResult> {
      const resourceType = params.resourceType as string;
      const description = params.description as string;
      const urgency = (params.urgency as string) ?? "low";

      const typeLabel: Record<string, string> = { skill: "技能", plugin: "插件", template: "模板", tool: "工具", other: "资源" };
      const request = {
        id: `req-${Date.now()}`,
        resourceType,
        description,
        urgency,
        agentId: context.agentId,
        groupId: (context as any).groupId,
        createdAt: new Date().toISOString(),
      };

      // 广播给前端/管家（真实数据链路）
      const runtime = (globalThis as any).__cobeing?.runtime;
      runtime?.wsServer?.broadcast?.({ type: "butler_resource_request", payload: request });

      // 追加到管家工作区收件箱（持久化，管家可读）
      try {
        const dataRoot = runtime?.dataRoot ?? (globalThis as any).__cobeingDataRoot;
        if (dataRoot) {
          const inboxPath = path.join(dataRoot, "coreagents", "butler", "workspace", "RESOURCE_REQUESTS.md");
          fs.mkdirSync(path.dirname(inboxPath), { recursive: true });
          const line = `\n- [${request.createdAt}] (${request.agentId || "unknown"}) ${typeLabel[resourceType] || resourceType} · ${urgency} · ${description}`;
          fs.appendFileSync(inboxPath, line, "utf-8");
        }
      } catch { /* best effort */ }

      log.info("Resource request from %s: %s (%s)", context.agentId, description, resourceType);
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
