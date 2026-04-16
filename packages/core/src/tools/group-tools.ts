/**
 * 群组通信工具 — group-speak, talk-create, talk-send, talk-read
 * 替代旧的 agent-message，所有通信在群组内进行
 */
import type { Tool, ToolContext, ToolResult } from "@myagents/shared";
import type { GroupContext } from "../group/context.js";

// ---- group-speak ----

export function makeGroupSpeakTool(getContext: (groupId: string) => GroupContext | undefined): Tool {
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
      const ctx = getContext(groupId);

      if (!ctx) {
        return { toolCallId: "", content: `未找到群组: ${groupId}`, isError: true };
      }

      ctx.speakToMain(context.agentId, message);
      ctx.saveMain();

      return {
        toolCallId: "",
        content: `已在 ${groupId} main 频道发言。`,
      };
    },
  };
}

// ---- talk-create ----

export function makeTalkCreateTool(getContext: (groupId: string) => GroupContext | undefined): Tool {
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
      const ctx = getContext(groupId);

      if (!ctx) {
        return { toolCallId: "", content: `未找到群组: ${groupId}`, isError: true };
      }

      const talk = ctx.createTalk(
        params.members as string[],
        params.topic as string,
      );
      ctx.saveTalk(talk.id);

      return {
        toolCallId: "",
        content: `已创建私有讨论: ${talk.id} (主题: ${talk.topic}, 成员: ${talk.members.join(", ")})`,
      };
    },
  };
}

// ---- talk-send ----

export function makeTalkSendTool(getContext: (groupId: string) => GroupContext | undefined): Tool {
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
      const ctx = getContext(groupId);

      if (!ctx) {
        return { toolCallId: "", content: `未找到群组: ${groupId}`, isError: true };
      }

      const talk = ctx.getTalk(talkId);
      if (!talk) {
        return { toolCallId: "", content: `未找到讨论: ${talkId}`, isError: true };
      }

      if (!talk.isMember(context.agentId)) {
        return { toolCallId: "", content: `你不是讨论 ${talkId} 的参与者`, isError: true };
      }

      talk.speak(context.agentId, params.message as string);
      ctx.saveTalk(talkId);

      return {
        toolCallId: "",
        content: `已在讨论 ${talkId} 中发言。`,
      };
    },
  };
}

// ---- talk-read ----

export function makeTalkReadTool(getContext: (groupId: string) => GroupContext | undefined): Tool {
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
      const ctx = getContext(groupId);

      if (!ctx) {
        return { toolCallId: "", content: `未找到群组: ${groupId}`, isError: true };
      }

      const talk = ctx.getTalk(talkId);
      if (!talk) {
        return { toolCallId: "", content: `未找到讨论: ${talkId}`, isError: true };
      }

      if (!talk.isMember(context.agentId)) {
        return { toolCallId: "", content: `你不是讨论 ${talkId} 的参与者`, isError: true };
      }

      const history = talk.getHistory();
      const formatted = history.map(m => `[${m.fromAgentId}]: ${m.content}`).join("\n\n");

      return {
        toolCallId: "",
        content: formatted || "(暂无消息)",
      };
    },
  };
}
