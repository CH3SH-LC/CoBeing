/**
 * 群组通信工具 — group-speak, talk-create, talk-send, talk-read
 * Phase 8.3: 使用 GroupContextV2 替代旧 GroupContext
 */
import type { Tool, ToolContext, ToolResult } from "@myagents/shared";
import type { Group } from "../group/group.js";

type GroupGetter = (groupId: string) => Group | undefined;

// ---- group-speak ----

export function makeGroupSpeakTool(getGroup: GroupGetter): Tool {
  return {
    name: "group-speak",
    description: "在群组 main 频道发言（所有人可见）。用 @agent-id 提及特定 Agent，@all 提及所有人。",
    parameters: {
      type: "object",
      properties: {
        groupId: { type: "string", description: "群组 ID" },
        message: { type: "string", description: "发言内容。可用 @agent-id 提及。" },
      },
      required: ["groupId", "message"],
    },
    async execute(params, context: ToolContext): Promise<ToolResult> {
      const groupId = params.groupId as string;
      const message = params.message as string;
      const group = getGroup(groupId);

      if (!group) {
        return { toolCallId: "", content: `未找到群组: ${groupId}`, isError: true };
      }

      group.postMessage(context.agentId, message);

      return {
        toolCallId: "",
        content: `已在 ${groupId} main 频道发言。`,
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
