/**
 * 唤醒上下文构建辅助模块（从 wake-system.ts 提取，行为不变）
 *
 * 职责：构建群组唤醒的三层上下文（协作上下文 / 压缩历史 / 近期消息）+ 触发消息拼接。
 * 纯函数，不依赖 WakeSystem 内部状态。
 */
import path from "node:path";
import type { GroupContextV2 } from "./group-context-v2.js";
import type { Group } from "./group.js";

/** 构建群组唤醒上下文所需依赖 */
export interface WakeContextDeps {
  groupId: string;
  /** 目标 Agent ID */
  targetAgentId: string;
  ownerId?: string;
  getGroup: () => Group | undefined;
  ctx: GroupContextV2;
  /** 触发消息内容列表 */
  triggerContents: string[];
}

/** 构建群组唤醒上下文（三层 + 触发消息） */
export async function buildWakeContext(deps: WakeContextDeps): Promise<string> {
  const { groupId, targetAgentId, ownerId, getGroup, ctx, triggerContents } = deps;
  const parts: string[] = [];

  // Layer 1: Abstract (group workspace files)
  if (getGroup) {
    const group = getGroup();
    if (group) {
      const { buildGroupCollaborationContext } = await import("../conversation/prompt-builder.js");
      const members = group.getMemberProfiles();
      const workspace = group.workspace.getSummary();
      const experienceSummary = group.workspace.readExperienceSummary();
      const activeStatuses = group.getActiveStatuses();

      let todos: import("../conversation/prompt-builder.js").GroupTodoSummary[] = [];
      const groupManager = (globalThis as any).__cobeingGroupManager;
      if (groupManager) {
        const scanner = groupManager.getScanner?.(groupId);
        if (scanner) {
          const store = scanner.getStore();
          const pendingTodos = store.list("pending");
          todos = pendingTodos.map((t: any) => ({
            id: t.id,
            title: t.title,
            status: t.status,
            assignee: t.targetAgentId,
          }));
        }
      }

      const abstractContext = buildGroupCollaborationContext(
        targetAgentId,
        members,
        {
          task: workspace.task,
          plan: workspace.plan,
          progress: workspace.progress,
          experienceSummary,
          interface: workspace.interface,
        },
        todos,
        ownerId,
        groupId,
        activeStatuses,
      );
      if (abstractContext) parts.push(`# 群组协作上下文\n\n${abstractContext}`);
    }
  }

  // Layer 2: Compressed history
  if (getGroup) {
    const group = getGroup();
    if (group) {
      const memoryDir = path.join(
        (globalThis as any).__cobeingDataRoot ?? "data",
        "groups", groupId, "memory",
      );
      const { CompressedHistory } = await import("./compressed-history.js");
      const ch = new CompressedHistory(targetAgentId, memoryDir);
      const compressedContext = ch.read();
      if (compressedContext) parts.push(`# 历史摘要\n\n${compressedContext}`);
    }
  }

  // Layer 3: Uncompressed recent messages from GroupDB
  if (getGroup) {
    const group = getGroup();
    if (group) {
      const compressedUntil = group.groupDb.getCompressionMark(targetAgentId);
      const recentMessages = group.groupDb.getMessagesForAgent(
        targetAgentId,
        { after: compressedUntil, limit: 60 },
      );
      if (recentMessages.length > 0) {
        const recentContext = recentMessages.map(msg => {
          const speaker = msg.from_agent_id;
          if (msg.tag === "main") {
            return `[${speaker}]: ${msg.content}`;
          }
          const talk = ctx.getTalk(msg.tag);
          const memberStr = talk ? talk.members.join(", ") : "?";
          return `[Talk: ${msg.tag} 成员: ${memberStr}] [${speaker}]: ${msg.content}`;
        }).join("\n\n");
        parts.push(`# 近期对话\n\n${recentContext}`);
      }
    }
  }

  let enrichedContext = parts.join("\n\n---\n\n");

  // Append trigger messages
  if (triggerContents.length > 0) {
    const triggerContext = triggerContents
      .map((content, i) => `\n\n[触发消息 ${i + 1}]:\n${content}`)
      .join("");
    enrichedContext = `${enrichedContext}${triggerContext}`;
  }

  return enrichedContext;
}
