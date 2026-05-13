/**
 * 群组通信工具 — talk-create, talk-send, talk-read, group-members
 * Phase 8.3: 使用 GroupContextV2 替代旧 GroupContext
 */
import type { Tool, ToolContext, ToolResult } from "@cobeing/shared";
import type { Group } from "../group/group.js";
import { createLogger } from "@cobeing/shared";

const log = createLogger("group-tools");

type GroupGetter = (groupId: string) => Group | undefined;

// ---- group-members ----

export function makeGroupMembersTool(getGroup: GroupGetter, agentNameResolver?: (id: string) => string): Tool {
  return {
    name: "group-members",
    description: "查看群组内所有成员（包括 user 和所有 Agent）。返回成员 ID、名称和角色。",
    parameters: {
      type: "object",
      properties: {
        groupId: { type: "string", description: "群组 ID" },
      },
      required: ["groupId"],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const groupId = params.groupId as string;
      const group = getGroup(groupId);

      if (!group) {
        return { toolCallId: "", content: `未找到群组: ${groupId}`, isError: true };
      }

      const resolve = agentNameResolver ?? ((id: string) => id);
      const members = [
        { id: "user", name: "用户", role: "用户" },
        ...group.config.members.map(id => ({
          id,
          name: resolve(id),
          role: "成员",
        })),
      ];

      // 标记群主
      if (group.config.owner) {
        const owner = members.find(m => m.id === group.config.owner);
        if (owner) owner.role = "群主";
      }

      const lines = members.map(m => `- ${m.name} (${m.id}) [${m.role}]`);
      return {
        toolCallId: "",
        content: `群组 ${group.config.name} 成员列表:\n${lines.join("\n")}`,
      };
    },
  };
}

// ---- talk-create ----

export function makeTalkCreateTool(getGroup: GroupGetter): Tool {
  return {
    name: "talk-create",
    description: "在群组内创建私有讨论，仅参与者可见。",
    parameters: {
      type: "object",
      properties: {
        groupId: { type: "string", description: "群组 ID" },
        members: {
          type: "array",
          items: { type: "string" },
          description: "参与者 Agent ID 列表",
        },
        topic: { type: "string", description: "讨论主题" },
      },
      required: ["groupId", "members", "topic"],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const groupId = params.groupId as string;
      const group = getGroup(groupId);

      if (!group) {
        return { toolCallId: "", content: `未找到群组: ${groupId}`, isError: true };
      }

      const talkId = group.createTalk(
        params.members as string[],
        params.topic as string,
      );

      return {
        toolCallId: "",
        content: `已创建私有讨论: ${talkId} (主题: ${params.topic}, 成员: ${(params.members as string[]).join(", ")})`,
      };
    },
  };
}

// ---- talk-send ----

export function makeTalkSendTool(getGroup: GroupGetter): Tool {
  return {
    name: "talk-send",
    description: "在私有讨论中发言。仅参与者可见。",
    parameters: {
      type: "object",
      properties: {
        groupId: { type: "string", description: "群组 ID" },
        talkId: { type: "string", description: "讨论 ID" },
        message: { type: "string", description: "发言内容" },
      },
      required: ["groupId", "talkId", "message"],
    },
    async execute(params, context: ToolContext): Promise<ToolResult> {
      const groupId = params.groupId as string;
      const talkId = params.talkId as string;
      const group = getGroup(groupId);

      if (!group) {
        return { toolCallId: "", content: `未找到群组: ${groupId}`, isError: true };
      }

      const talk = group.ctxV2.getTalk(talkId);
      if (!talk) {
        return { toolCallId: "", content: `未找到讨论: ${talkId}`, isError: true };
      }

      if (!talk.members.includes(context.agentId)) {
        return { toolCallId: "", content: `你不是讨论 ${talkId} 的参与者`, isError: true };
      }

      group.postToTalk(talkId, context.agentId, params.message as string);

      return {
        toolCallId: "",
        content: `已在讨论 ${talkId} 中发言。`,
      };
    },
  };
}

// ---- talk-read ----

export function makeTalkReadTool(getGroup: GroupGetter): Tool {
  return {
    name: "talk-read",
    description: "读取私有讨论的历史消息。仅参与者可读。",
    parameters: {
      type: "object",
      properties: {
        groupId: { type: "string", description: "群组 ID" },
        talkId: { type: "string", description: "讨论 ID" },
      },
      required: ["groupId", "talkId"],
    },
    async execute(params, context: ToolContext): Promise<ToolResult> {
      const groupId = params.groupId as string;
      const talkId = params.talkId as string;
      const group = getGroup(groupId);

      if (!group) {
        return { toolCallId: "", content: `未找到群组: ${groupId}`, isError: true };
      }

      const talk = group.ctxV2.getTalk(talkId);
      if (!talk) {
        return { toolCallId: "", content: `未找到讨论: ${talkId}`, isError: true };
      }

      if (!talk.members.includes(context.agentId)) {
        return { toolCallId: "", content: `你不是讨论 ${talkId} 的参与者`, isError: true };
      }

      // 获取该 talk 的消息
      const msgs = group.ctxV2.getMessages().filter(m => m.tag === talkId);
      const formatted = msgs.map(m => `[${m.fromAgentId}]: ${m.content}`).join("\n\n");

      return {
        toolCallId: "",
        content: formatted || "(暂无消息)",
      };
    },
  };
}

// ---- talk-close ----

export function makeTalkCloseTool(getGroup: GroupGetter): Tool {
  return {
    name: "talk-close",
    description: "关闭私有讨论。自动生成讨论摘要并发回 main 频道，供群组所有成员知晓讨论结果。",
    parameters: {
      type: "object",
      properties: {
        groupId: { type: "string", description: "群组 ID" },
        talkId: { type: "string", description: "讨论 ID" },
        conclusion: { type: "string", description: "讨论结论或产出摘要" },
      },
      required: ["groupId", "talkId", "conclusion"],
    },
    async execute(params, context: ToolContext): Promise<ToolResult> {
      const groupId = params.groupId as string;
      const talkId = params.talkId as string;
      const group = getGroup(groupId);

      if (!group) {
        return { toolCallId: "", content: `未找到群组: ${groupId}`, isError: true };
      }

      const talk = group.ctxV2.getTalk(talkId);
      if (!talk) {
        return { toolCallId: "", content: `未找到讨论: ${talkId}`, isError: true };
      }

      // 获取讨论消息摘要
      const msgs = group.ctxV2.getMessages().filter(m => m.tag === talkId);
      const participantIds = [...new Set(msgs.map(m => m.fromAgentId))];
      const topic = talk.topic || talkId;

      // 向 main 频道发送结构化讨论总结
      const summary = JSON.stringify({
        type: "talk_summary",
        talkId,
        topic,
        participants: participantIds,
        conclusion: params.conclusion as string,
        messageCount: msgs.length,
        closedBy: context.agentId,
        closedAt: new Date().toISOString(),
      });

      group.postMessage("system", summary);

      log.info("[%s] Talk %s closed by %s, summary posted to main", groupId, talkId, context.agentId);
      return {
        toolCallId: "",
        content: `讨论 "${topic}" 已关闭，摘要已发布到 main 频道。`,
      };
    },
  };
}

// ---- group-send ----

export function makeGroupSendTool(getGroup: GroupGetter): Tool {
  return {
    name: "group-send",
    description: "主动向群组 main 频道发送消息。用于主动求助、进度同步、阻塞上报等需要主动发起对话的场景。如果需要特定成员回应，使用 mention 参数 @对方。",
    parameters: {
      type: "object",
      properties: {
        groupId: { type: "string", description: "群组 ID" },
        message: { type: "string", description: "消息内容" },
        mention: { type: "string", description: "@mention 的目标（可选），如 @butler 或 @group-owner" },
        context: { type: "string", description: "发送原因说明（仅日志记录，不进入消息内容）" },
      },
      required: ["groupId", "message"],
    },
    async execute(params, context: ToolContext): Promise<ToolResult> {
      const group = getGroup(params.groupId as string);
      if (!group) return { toolCallId: "", content: `未找到群组: ${params.groupId}`, isError: true };

      const mention = params.mention as string | undefined;
      const msg = mention
        ? `${mention} ${params.message}`
        : (params.message as string);

      group.postMessage(context.agentId, msg);
      log.info("[%s] %s sent proactive message via group-send", params.groupId, context.agentId);

      return { toolCallId: "", content: "消息已发送到群组。" };
    },
  };
}

// ---- group-update-progress ----

export function makeGroupUpdateProgressTool(getGroup: GroupGetter): Tool {
  return {
    name: "group-update-progress",
    description: "主动更新群组 PROGRESS.md 中的进度记录。完成阶段性工作后调用，让群组了解最新进展。",
    parameters: {
      type: "object",
      properties: {
        groupId: { type: "string", description: "群组 ID" },
        summary: { type: "string", description: "已完成工作的描述" },
        completedItems: {
          type: "array",
          items: { type: "string" },
          description: "完成的具体事项列表（可选）",
        },
      },
      required: ["groupId", "summary"],
    },
    async execute(params, context: ToolContext): Promise<ToolResult> {
      const group = getGroup(params.groupId as string);
      if (!group) return { toolCallId: "", content: `未找到群组: ${params.groupId}`, isError: true };

      const summary = params.summary as string;
      const items = params.completedItems as string[] | undefined;

      let content = `${context.agentId}: ${summary}`;
      if (items && items.length > 0) {
        content += "\n\n完成事项:\n" + items.map(i => `- [x] ${i}`).join("\n");
      }

      group.workspace.appendProgress(context.agentId, content);
      group.postMessage(context.agentId, `## 进度更新\n\n${content}`);
      log.info("[%s] %s updated progress via group-update-progress", params.groupId, context.agentId);

      return { toolCallId: "", content: "进度已更新。" };
    },
  };
}

// ---- group-experience-add ----

export function makeGroupExperienceAddTool(getGroup: GroupGetter): Tool {
  return {
    name: "group-experience-add",
    description: "将协作过程中的关键决策、学到的教训或有效的协作模式写入群组 EXPERIENCE.md，供其他成员参考。",
    parameters: {
      type: "object",
      properties: {
        groupId: { type: "string", description: "群组 ID" },
        section: {
          type: "string",
          description: "写入的章节: 关键决策 / 协作教训 / 有效模式",
          enum: ["关键决策", "协作教训", "有效模式"],
        },
        entry: { type: "string", description: "经验内容" },
      },
      required: ["groupId", "section", "entry"],
    },
    async execute(params, context: ToolContext): Promise<ToolResult> {
      const group = getGroup(params.groupId as string);
      if (!group) return { toolCallId: "", content: `未找到群组: ${params.groupId}`, isError: true };

      group.workspace.appendExperience(
        params.section as "关键决策" | "协作教训" | "有效模式",
        `[${context.agentId}] ${params.entry}`,
      );
      log.info("[%s] %s added experience to %s", params.groupId, context.agentId, params.section);
      return { toolCallId: "", content: `已记录到群组经验「${params.section}」。` };
    },
  };
}

// ---- group-experience-summarize ----

export function makeGroupExperienceSummarizeTool(getGroup: GroupGetter): Tool {
  return {
    name: "group-experience-summarize",
    description: "触发群组协作总结，将 EXPERIENCE.md 中的经验整理后发到 main 频道供全员参考。",
    parameters: {
      type: "object",
      properties: {
        groupId: { type: "string", description: "群组 ID" },
      },
      required: ["groupId"],
    },
    async execute(params, context: ToolContext): Promise<ToolResult> {
      const group = getGroup(params.groupId as string);
      if (!group) return { toolCallId: "", content: `未找到群组: ${params.groupId}`, isError: true };

      const experience = group.workspace.readExperience();
      if (!experience || experience.trim().length === 0) {
        return { toolCallId: "", content: "群组 EXPERIENCE.md 暂无内容。" };
      }

      // 提取各章节内容
      const sections = ["关键决策", "协作教训", "有效模式"];
      const summary: string[] = ["## 群组协作经验总结\n"];
      for (const sec of sections) {
        const regex = new RegExp(`## ${sec}[\\s\\S]*?(?=\\n## |$)`, "m");
        const match = experience.match(regex);
        if (match) {
          const lines = match[0].split("\n").filter(l => l.startsWith("- "));
          if (lines.length > 0) {
            summary.push(`### ${sec}\n${lines.slice(-10).join("\n")}\n`);
          }
        }
      }

      if (summary.length <= 1) {
        return { toolCallId: "", content: "群组经验中暂无条目。" };
      }

      group.postMessage(context.agentId, summary.join("\n"));
      log.info("[%s] Experience summarized by %s", params.groupId, context.agentId);
      return { toolCallId: "", content: "经验总结已发送到群组。" };
    },
  };
}
