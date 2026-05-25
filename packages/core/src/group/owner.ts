/**
 * GroupOwner — 群主 Agent 专用工具
 * 群主负责制定计划、邀请成员讨论、总结进展、分配任务
 * 使用 GroupContextV2 API
 */
import type { Tool, ToolContext, ToolResult } from "@cobeing/shared";
import type { GroupManager } from "./manager.js";
import type { Group } from "./group.js";

type GroupGetter = (groupId: string) => Group | undefined;

// ---- group-plan ----

export function makeGroupPlanTool(getGroup: GroupGetter): Tool {
  return {
    name: "group-plan",
    description: "制定群组讨论计划并发布到 main 频道（群主专用）",
    parameters: {
      type: "object",
      properties: {
        groupId: { type: "string", description: "群组 ID" },
        topic: { type: "string", description: "讨论主题" },
        goals: { type: "string", description: "讨论目标（可选）" },
      },
      required: ["groupId", "topic"],
    },
    async execute(params, context: ToolContext): Promise<ToolResult> {
      const group = getGroup(params.groupId as string);
      if (!group) return { toolCallId: "", content: `未找到群组: ${params.groupId}`, isError: true };

      const topic = params.topic as string;
      const goals = params.goals as string;
      const planMsg = `讨论计划\n主题: ${topic}${goals ? `\n目标: ${goals}` : ""}\n请各位成员发表意见。`;
      group.postMessage(context.agentId, planMsg);

      return { toolCallId: "", content: `已发布讨论计划到 ${params.groupId} main 频道。` };
    },
  };
}

// ---- group-invite-talk ----

export function makeGroupInviteTalkTool(getGroup: GroupGetter): Tool {
  return {
    name: "group-invite-talk",
    description: "邀请群组成员进入私有讨论（群主专用）",
    parameters: {
      type: "object",
      properties: {
        groupId: { type: "string", description: "群组 ID" },
        members: {
          type: "array",
          items: { type: "string" },
          description: "邀请的成员 ID 列表",
        },
        topic: { type: "string", description: "私有讨论主题" },
      },
      required: ["groupId", "members", "topic"],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const group = getGroup(params.groupId as string);
      if (!group) return { toolCallId: "", content: `未找到群组: ${params.groupId}`, isError: true };

      const talkId = group.createTalk(
        params.members as string[],
        params.topic as string,
      );

      return {
        toolCallId: "",
        content: `已创建私有讨论 ${talkId} (主题: ${params.topic})，已邀请: ${(params.members as string[]).join(", ")}`,
      };
    },
  };
}

// ---- group-summarize ----

export function makeGroupSummarizeTool(getGroup: GroupGetter): Tool {
  return {
    name: "group-summarize",
    description: "总结群组当前讨论状态并发布到 main 频道（群主专用）",
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

      const mainMsgs = group.ctxV2.getMessages().filter(m => m.tag === "main");
      const talks = group.ctxV2.listTalks();

      if (mainMsgs.length === 0) {
        return { toolCallId: "", content: "当前没有讨论记录。" };
      }

      const historyText = mainMsgs.slice(-20).map(m => `[${m.fromAgentId}]: ${m.content}`).join("\n\n");
      const talksInfo = talks.map(t => `- ${t.id}: ${t.topic} (${t.members.join(", ")})`).join("\n");

      const summary = [
        "讨论总结",
        "",
        "最近讨论:",
        historyText,
        "",
        "私有讨论:",
        talksInfo || "(无)",
      ].join("\n");

      group.postMessage(context.agentId, summary);

      return { toolCallId: "", content: `已发布讨论总结到 main 频道。\n\n${historyText}` };
    },
  };
}

// ---- group-assign-task ----

export function makeGroupAssignTaskTool(getGroup: GroupGetter): Tool {
  return {
    name: "group-assign-task",
    description: "给群组成员分配任务（群主专用）",
    parameters: {
      type: "object",
      properties: {
        groupId: { type: "string", description: "群组 ID" },
        agentId: { type: "string", description: "被分配的 Agent ID" },
        task: { type: "string", description: "任务描述" },
        deadline: { type: "string", description: "截止时间（可选）" },
      },
      required: ["groupId", "agentId", "task"],
    },
    async execute(params, context: ToolContext): Promise<ToolResult> {
      const group = getGroup(params.groupId as string);
      if (!group) return { toolCallId: "", content: `未找到群组: ${params.groupId}`, isError: true };

      const agentId = params.agentId as string;
      const task = params.task as string;
      const deadline = params.deadline as string;

      const msg = `@${agentId} 任务分配\n${task}${deadline ? `\n截止: ${deadline}` : ""}`;
      group.postMessage(context.agentId, msg);

      return { toolCallId: "", content: `已向 ${agentId} 分配任务: ${task}` };
    },
  };
}
