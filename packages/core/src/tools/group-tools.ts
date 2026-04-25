/**
 * 群组通信工具 — talk-create, talk-send, talk-read, group-members
 * Phase 8.3: 使用 GroupContextV2 替代旧 GroupContext
 */
import type { Tool, ToolContext, ToolResult } from "@cobeing/shared";
import type { Group } from "../group/group.js";

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
