import type { Tool, ToolContext, ToolResult } from "@cobeing/shared";
import type { VoteStore } from "./store.js";
import { createLogger } from "@cobeing/shared";

const log = createLogger("vote-tools");

export function makeVoteCreateTool(getVoteStore: () => VoteStore): Tool {
  return {
    name: "vote-create",
    description: "发起投票表决。用于群组内有意见分歧时，列出多个方案让成员投票决定。每个选项可附优缺点。",
    parameters: {
      type: "object",
      properties: {
        groupId: { type: "string", description: "群组 ID" },
        title: { type: "string", description: "投票议题" },
        options: {
          type: "array",
          description: "候选方案列表（2个以上）。每个方案可附优缺点供参考。",
          items: {
            type: "object",
            properties: {
              text: { type: "string", description: "方案描述" },
              pros: { type: "string", description: "该方案的优点（可选）" },
              cons: { type: "string", description: "该方案的缺点（可选）" },
            },
            required: ["text"],
          },
        },
        deadline: {
          type: "string",
          description: "投票截止时间 (ISO 8601，如 2026-05-09T12:00:00+08:00)",
        },
      },
      required: ["groupId", "title", "options", "deadline"],
    },
    async execute(params, context: ToolContext): Promise<ToolResult> {
      const store = getVoteStore();
      const options = (params.options as Array<{ text: string; pros?: string; cons?: string }>).map(o => ({
        text: o.text,
        pros: o.pros,
        cons: o.cons,
        votes: [] as string[],
      }));

      if (options.length < 2) {
        return { toolCallId: "", content: "至少需要 2 个选项", isError: true };
      }

      const vote = store.create({
        groupId: params.groupId as string,
        title: params.title as string,
        options,
        createdBy: context.agentId,
        deadline: new Date(params.deadline as string).getTime(),
      });

      const optionLines = vote.options.map((o, i) =>
        `  ${i}. ${o.text}${o.pros ? `\n     优点: ${o.pros}` : ""}${o.cons ? `\n     缺点: ${o.cons}` : ""}`
      );

      log.info("Vote created: %s (%s)", vote.id, vote.title);
      return {
        toolCallId: "",
        content: `已发起投票: "${vote.title}" (ID: ${vote.id})\n\n截止: ${params.deadline}\n\n方案:\n${optionLines.join("\n")}\n\n请群组成员使用 vote-cast 工具投票。`,
      };
    },
  };
}

export function makeVoteCastTool(getVoteStore: () => VoteStore): Tool {
  return {
    name: "vote-cast",
    description: "投票表决，选择一个方案。可改票（重复调用会覆盖之前的投票）。",
    parameters: {
      type: "object",
      properties: {
        voteId: { type: "string", description: "投票 ID" },
        optionIndex: { type: "number", description: "选择的方案索引（从 0 开始）" },
      },
      required: ["voteId", "optionIndex"],
    },
    async execute(params, context: ToolContext): Promise<ToolResult> {
      const store = getVoteStore();
      const result = store.cast(
        params.voteId as string,
        context.agentId,
        params.optionIndex as number,
      );

      if (!result.ok) {
        return { toolCallId: "", content: result.error || "投票失败", isError: true };
      }

      const vote = store.get(params.voteId as string)!;
      const option = vote.options[params.optionIndex as number];
      let msg = `已投票: ${option.text}`;

      if (vote.status === "passed") {
        const summary = vote.options.map((o, i) =>
          `  ${i}. ${o.text} — ${o.votes.length} 票`
        ).join("\n");
        msg += `\n\n✅ 投票已通过！\n结果: ${vote.result}\n\n票数:\n${summary}`;
      }

      return { toolCallId: "", content: msg };
    },
  };
}

export function makeVoteResultTool(getVoteStore: () => VoteStore): Tool {
  return {
    name: "vote-result",
    description: "查看投票结果和当前票数。",
    parameters: {
      type: "object",
      properties: {
        voteId: { type: "string", description: "投票 ID" },
      },
      required: ["voteId"],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const store = getVoteStore();
      const vote = store.get(params.voteId as string);
      if (!vote) return { toolCallId: "", content: "未找到投票", isError: true };

      const totalVotes = vote.options.reduce((s, o) => s + o.votes.length, 0);
      const lines = [
        `议题: ${vote.title}`,
        `状态: ${vote.status}`,
        `发起人: ${vote.createdBy}`,
        `截止: ${new Date(vote.deadline).toISOString()}`,
        `总票数: ${totalVotes}`,
        "",
        "方案:",
        ...vote.options.map((o, i) => {
          let line = `  ${i}. ${o.text} — ${o.votes.length} 票`;
          if (o.votes.length > 0) line += ` (${o.votes.join(", ")})`;
          return line;
        }),
      ];

      if (vote.result) {
        lines.push("", `结果: ${vote.result}`);
      }

      if (vote.status === "arbitrating") {
        lines.push("", "⚠️ 需群主仲裁");
      }

      return { toolCallId: "", content: lines.join("\n") };
    },
  };
}
