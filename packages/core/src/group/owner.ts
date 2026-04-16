/**
 * GroupOwner — 群主 Agent 专用工具
 * 群主负责计划和发起讨论、组织轮次、创建 talk、总结讨论
 */
import type { Tool, ToolContext, ToolResult } from "@myagents/shared";
import type { GroupContext } from "./context.js";
import type { LLMProvider } from "@myagents/providers";

/** group-plan — 制定讨论计划 */
export function makeGroupPlanTool(
  getContext: (groupId: string) => GroupContext | undefined,
  _providerGetter: () => LLMProvider,
): Tool {
  return {
    name: "group-plan",
    description: "制定群组讨论计划（群主专用）",
    parameters: {
      type: "object",
      properties: {
        groupId: { type: "string", description: "群组 ID" },
        topic: { type: "string", description: "讨论主题" },
        goals: { type: "string", description: "讨论目标（可选）" },
      },
      required: ["groupId", "topic"],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const ctx = getContext(params.groupId as string);
      if (!ctx) return { toolCallId: "", content: `未找到群组: ${params.groupId}`, isError: true };

      const topic = params.topic as string;
      const goals = params.goals as string;

      // 发布计划到 main 频道
      const planMsg = `📋 讨论计划\n主题: ${topic}${goals ? `\n目标: ${goals}` : ""}\n请各位成员发表意见。`;
      ctx.speakToMain(_context.agentId, planMsg);
      ctx.saveMain();

      return { toolCallId: "", content: `已发布讨论计划到 ${params.groupId} main 频道。` };
    },
  };
}

/** group-invite-talk — 邀请成员进入私有讨论 */
export function makeGroupInviteTalkTool(
  getContext: (groupId: string) => GroupContext | undefined,
): Tool {
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
      const ctx = getContext(params.groupId as string);
      if (!ctx) return { toolCallId: "", content: `未找到群组: ${params.groupId}`, isError: true };

      const talk = ctx.createTalk(
        params.members as string[],
        params.topic as string,
      );
      ctx.saveTalk(talk.id);

      return {
        toolCallId: "",
        content: `已创建私有讨论 ${talk.id} (主题: ${talk.topic})，已邀请: ${talk.members.join(", ")}`,
      };
    },
  };
}

/** group-summarize — 总结当前讨论状态 */
export function makeGroupSummarizeTool(
  getContext: (groupId: string) => GroupContext | undefined,
  providerGetter: () => LLMProvider,
): Tool {
  return {
    name: "group-summarize",
    description: "总结群组当前讨论状态（群主专用）",
    parameters: {
      type: "object",
      properties: {
        groupId: { type: "string", description: "群组 ID" },
      },
      required: ["groupId"],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const ctx = getContext(params.groupId as string);
      if (!ctx) return { toolCallId: "", content: `未找到群组: ${params.groupId}`, isError: true };

      const history = ctx.getMainHistory();
      const talks = ctx.listTalks();

      if (history.length === 0) {
        return { toolCallId: "", content: "当前没有讨论记录。" };
      }

      const provider = providerGetter();
      if (!provider) {
        // 如果没有 LLM，直接返回原始总结
        const summary = history.slice(-10).map(m => `[${m.fromAgentId}]: ${m.content}`).join("\n");
        return { toolCallId: "", content: `最近讨论:\n${summary}` };
      }

      const historyText = history.slice(-20).map(m => `[${m.fromAgentId}]: ${m.content}`).join("\n\n");
      const talksInfo = talks.map(t => `- ${t.id}: ${t.topic} (${t.members.join(", ")})`).join("\n");

      const prompt = `总结以下群组讨论的状态。

讨论记录:
${historyText}

私有讨论:
${talksInfo || "(无)"}

请用简洁的中文总结：
1. 当前讨论进展
2. 各方观点
3. 共识和分歧
4. 建议的下一步`;

      try {
        let result = "";
        for await (const chunk of provider.chat({
          model: "",
          messages: [{ role: "user", content: prompt }],
        })) {
          if (chunk.type === "content" && chunk.content) {
            result += chunk.content;
          }
        }

        // 发布总结到 main 频道
        ctx.speakToMain(_context.agentId, `📝 讨论总结:\n${result}`);
        ctx.saveMain();

        return { toolCallId: "", content: result };
      } catch (err: any) {
        return { toolCallId: "", content: `总结失败: ${err.message}`, isError: true };
      }
    },
  };
}

/** group-assign-task — 给成员分配任务 */
export function makeGroupAssignTaskTool(
  getContext: (groupId: string) => GroupContext | undefined,
): Tool {
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
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const ctx = getContext(params.groupId as string);
      if (!ctx) return { toolCallId: "", content: `未找到群组: ${params.groupId}`, isError: true };

      const agentId = params.agentId as string;
      const task = params.task as string;
      const deadline = params.deadline as string;

      const msg = `📌 @${agentId} 任务分配\n${task}${deadline ? `\n截止: ${deadline}` : ""}`;
      ctx.speakToMain(_context.agentId, msg);
      ctx.saveMain();

      return { toolCallId: "", content: `已向 ${agentId} 分配任务: ${task}` };
    },
  };
}
