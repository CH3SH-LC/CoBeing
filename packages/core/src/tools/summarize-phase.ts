/**
 * summarize-phase tool — Agent 主动压缩群组历史
 *
 * Agent 在完成阶段性任务后调用此工具，将近期对话压缩为摘要，
 * 更新压缩标记，使后续唤醒不再发送已压缩的原始消息。
 */
import type { Tool, ToolContext, ToolResult } from "@cobeing/shared";
import { CompressedHistory } from "../group/compressed-history.js";

export function makeSummarizePhaseTool(): Tool {
  return {
    name: "summarize-phase",
    description: "总结当前阶段的工作，压缩群组对话历史。完成一个阶段性任务后调用此工具，将近期对话压缩为摘要。",
    parameters: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "阶段摘要，2-5 句话概括这一阶段做了什么、遇到了什么问题、怎么解决的",
        },
        phaseTitle: {
          type: "string",
          description: "阶段标题，如'基础架构搭建'、'核心玩法实现'",
        },
        groupId: {
          type: "string",
          description: "群组 ID（在群组上下文中调用时必填）",
        },
      },
      required: ["summary", "phaseTitle", "groupId"],
    },
    execute: async (params: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> => {
      const summary = params.summary as string;
      const phaseTitle = params.phaseTitle as string;
      const groupId = params.groupId as string;
      const agentId = _context.agentId;

      const gm = (globalThis as any).__cobeingGroupManager;
      if (!gm) return { toolCallId: "", content: "GroupManager 不可用" };

      const group = gm.get(groupId);
      if (!group) return { toolCallId: "", content: `群组 ${groupId} 不存在` };

      const now = Date.now();
      const startDate = new Date(now - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
      const endDate = new Date(now).toISOString().slice(0, 10);

      // Get compressed history instance
      const fs = await import("node:fs");
      const path = await import("node:path");
      const memoryDir = path.join(
        (globalThis as any).__cobeingDataRoot ?? "data",
        "groups", groupId, "memory",
      );
      fs.mkdirSync(memoryDir, { recursive: true });
      const compressedHistory = new CompressedHistory(agentId, memoryDir);

      // Append phase to compressed history
      compressedHistory.appendPhase(
        { title: phaseTitle, startDate, endDate, summary },
        now,
      );

      // Update compression mark in main DB
      group.groupDb.setCompressionMark(agentId, now);

      // Physical cleanup of compressed messages from agent's perspective
      const cleaned = group.groupDb.cleanupCompressedMessages(agentId);

      const log = (await import("@cobeing/shared")).createLogger("summarize-phase");
      log.info("[%s] Agent %s compressed phase: %s (until %s, cleaned %d messages)",
        groupId, agentId, phaseTitle, new Date(now).toISOString(), cleaned);

      return {
        toolCallId: "",
        content: `已压缩阶段 "${phaseTitle}" 的历史。截至 ${endDate} 的对话已总结为摘要，${cleaned} 条旧消息已清理。`,
      };
    },
  };
}
