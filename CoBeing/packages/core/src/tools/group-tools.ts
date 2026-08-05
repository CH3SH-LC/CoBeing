/**
 * 群组通信工具 — talk-create, talk-send, talk-read, group-members
 * Phase 8.3: 使用 GroupContextV2 替代旧 GroupContext
 */
import type { Tool, ToolContext, ToolResult } from "@cobeing/shared";
import type { Group } from "../group/group.js";
import type { Agent } from "../agent/agent.js";
import { createLogger } from "@cobeing/shared";
import { injectReviewExperience } from "../group/review-experience.js";
import { runReviewAgent, parseReviewOutput } from "../agent/tool-agent/review.js";

const log = createLogger("group-tools");

type GroupGetter = (groupId: string) => Group | undefined;
type AgentGetter = (agentId: string) => Agent | undefined;

function ensureGroupMember(group: Group, context: ToolContext): ToolResult | null {
  // Butler and host are orchestrators — they can message any group
  if (context.agentId === "user" || context.agentId === "butler" || context.agentId === "host") return null;
  if (group.config.members.includes(context.agentId)) return null;
  return {
    toolCallId: "",
    content: `Agent ${context.agentId} is not a member of group ${group.id}`,
    isError: true,
  };
}

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
    async execute(params, context: ToolContext): Promise<ToolResult> {
      const groupId = params.groupId as string;
      const group = getGroup(groupId);

      if (!group) {
        return { toolCallId: "", content: `未找到群组: ${groupId}`, isError: true };
      }

      const memberError = ensureGroupMember(group, context);
      if (memberError) return memberError;

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
    async execute(params, context: ToolContext): Promise<ToolResult> {
      const groupId = params.groupId as string;
      const group = getGroup(groupId);

      if (!group) {
        return { toolCallId: "", content: `未找到群组: ${groupId}`, isError: true };
      }

      const memberError = ensureGroupMember(group, context);
      if (memberError) return memberError;

      const members = [...(params.members as string[])];
      if (!members.includes(context.agentId)) members.push(context.agentId);
      const invalidMember = members.find(id => id !== "user" && !group.config.members.includes(id));
      if (invalidMember) {
        return { toolCallId: "", content: `Agent ${invalidMember} is not a member of group ${groupId}`, isError: true };
      }

      const talkId = group.createTalk(
        members,
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

      const memberError = ensureGroupMember(group, context);
      if (memberError) return memberError;

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

      const memberError = ensureGroupMember(group, context);
      if (memberError) return memberError;

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

      const memberError = ensureGroupMember(group, context);
      if (memberError) return memberError;

      const talk = group.ctxV2.getTalk(talkId);
      if (!talk) {
        return { toolCallId: "", content: `未找到讨论: ${talkId}`, isError: true };
      }

      // 获取讨论消息摘要
      if (!talk.members.includes(context.agentId)) {
        return { toolCallId: "", content: `Agent ${context.agentId} is not a participant of talk ${talkId}`, isError: true };
      }

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

export function makeGroupSendTool(getGroup: GroupGetter, getAgent?: AgentGetter): Tool {
  return {
    name: "group-send",
    description: `向群组 main 频道发送协作消息。这是**协作旁路消息**，不是最终回复——发送后默认继续自己的工作，除非消息明确表示需要暂停等待。

使用场景：
- 中途发起协作：需要其他 Agent 帮助时 @mention 对方。
- 上报阻塞：无法继续推进时说明阻塞原因。
- 请求审批：需要用户或群主确认时提交选项。
- 申请资源：发现能力缺口时向群主说明。

使用时应包含（5 要素）：
1. 当前自己正在做什么
2. 需要对方做什么
3. 对方输出会被如何使用
4. 是否需要立刻回复
5. 自己是继续工作还是暂停等待

推荐格式：
@目标Agent
我正在做：...
我需要你：...
你的输出会用于：...
我会：继续推进 / 暂停等待

注意：如果需要别人接力或协作，请使用此工具。不要在最终回复里写 @mention 来唤醒别人。`,
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

      const memberError = ensureGroupMember(group, context);
      if (memberError) return memberError;

      const mention = params.mention as string | undefined;
      const msg = mention
        ? `${mention} ${params.message}`
        : (params.message as string);

      // === 审核拦截：消息发送前经过 Review Tool Agent 检查 ===
      // reviewer 未配置时视为启用（默认 maxRounds=3）；?? {} 修复 reviewerCfg 为 undefined 时
      // `?.enabled !== false` 求值为 true 却随后访问 reviewerCfg.maxRounds 崩溃的问题
      const reviewerCfg = group.config.reviewer ?? { enabled: true, maxRounds: 3 };
      if (getAgent && reviewerCfg.enabled !== false && reviewerCfg.maxRounds !== 0) {
        const agent = getAgent(context.agentId);
        if (agent) {
          const runtime = (globalThis as any).__cobeing?.runtime;
          const provider = runtime?.getProvider(agent.config.provider) as import("@cobeing/providers").LLMProvider | undefined;
          if (provider) {
            const trace = agent.wakeSession?.getTrace();
            if (trace) {
              trace.finalMessage = msg;
              const ws = (globalThis as any).__cobeingWSServer;
              const recentMessages = group.getRecentMessages(10);
              const mentions = group.getMentionsFor(context.agentId);
              const workspace = group.workspace;
              const truncate = (s: string, max: number) => s.length > max ? s.slice(0, max) + '...' : s;

              const reviewInput = {
                agentJobMd: agent.files.readJob(),
                agentTrace: trace,
                groupRecentMessages: recentMessages.map(m => `[${m.fromAgentId}]: ${m.content}`),
                agentMentions: mentions.map(m => `[${m.fromAgentId}]: ${m.content}`),
                groupTaskMd: truncate(workspace.readTask() ?? '', 1000),
                groupPlanMd: truncate(workspace.readPlan() ?? '', 1000),
                groupProgressMd: truncate(workspace.readProgress() ?? '', 1000),
              };

              const maxRounds = reviewerCfg.maxRounds ?? 3;
              let retryCount = 0;

              for (let round = 0; round < maxRounds; round++) {
                ws?.emitReviewLog({ type: 'review_pending', agentId: context.agentId, groupId: group.id });
                let toolResult;
                try {
                  toolResult = await runReviewAgent(
                    reviewInput,
                    provider,
                    agent.getToolRegistry(),
                    agent.config.model,
                    agent.effectiveWorkspace,
                    context.agentId,
                  );
                } catch (err: any) {
                  log.error("[%s] Review agent crashed for %s: %s — allowing message through", params.groupId, context.agentId, err.message);
                  group.postMessage(context.agentId, msg);
                  ws?.emitReviewLog({ type: 'review_passed', agentId: context.agentId, groupId: group.id });
                  return { toolCallId: "", content: "消息已发送到群组（审核跳过）。" };
                }
                const parsed = parseReviewOutput(toolResult.output);
                retryCount = round + 1;
                (context as any).reviewRetryCount = retryCount;

                if (parsed.pass) {
                  group.postMessage(context.agentId, msg);
                  log.info("[%s] %s message passed review", params.groupId, context.agentId);
                  ws?.emitReviewLog({ type: 'review_passed', agentId: context.agentId, groupId: group.id });
                  return { toolCallId: "", content: "消息已发送到群组。" };
                }

                // 不通过 → 写入经验
                await injectReviewExperience(agent, group, parsed.reason, false).catch(() => {});
                log.info("[%s] %s message rejected by review (attempt %d/%d)", params.groupId, context.agentId, retryCount, maxRounds);
                ws?.emitReviewLog({ type: 'review_failed', agentId: context.agentId, groupId: group.id, reason: parsed.reason, rounds: round });

                if (retryCount >= maxRounds) break;
                // 否则重试（Agent 会在同一唤醒周期内重新调用 group-send）
                return {
                  toolCallId: "",
                  content: `【审核未通过】原因：${parsed.reason}。请根据反馈修正后重新发送消息。还可重试 ${maxRounds - retryCount} 次。`,
                };
              }

              // 轮次耗尽 → 强制发布
              await injectReviewExperience(agent, group, reviewInput.agentTrace.finalMessage ? "轮次耗尽" : "", true).catch(() => {});
              group.postMessage(context.agentId, msg, { reviewOverridden: true });
              log.warn("[%s] %s message force-published after review rounds exhausted", params.groupId, context.agentId);
              ws?.emitReviewLog({ type: 'review_failed_override', agentId: context.agentId, groupId: group.id, rounds: retryCount });
              return {
                toolCallId: "",
                content: `消息已强制发送（经 ${retryCount} 轮审核未通过）。`,
              };
            }
          }
        }
      }

      // 审核关闭或无法审核 → 直接发布
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

      const memberError = ensureGroupMember(group, context);
      if (memberError) return memberError;

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

      const memberError = ensureGroupMember(group, context);
      if (memberError) return memberError;

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

      const memberError = ensureGroupMember(group, context);
      if (memberError) return memberError;

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
