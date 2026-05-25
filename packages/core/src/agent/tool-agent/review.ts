/**
 * Review Tool Agent — 审查 Agent 消息
 */
import type { LLMProvider } from "@cobeing/providers";
import { ToolRegistry } from "../../tools/registry.js";
import { runToolAgent } from "./base.js";
import type { ReviewInput, ToolAgentResult } from "./types.js";

const REVIEW_SYSTEM_PROMPT = `# 审核任务

你正在审核一条即将发布到群组的消息。

## 审核标准
1. 该 Agent 是否确实进行了实质性工作（调用了工具、产生了具体输出）？
2. 工作方法是否符合任务要求？
3. 该 Agent 是否在偷懒（仅声明意图而未展示实际工作成果）？

## 输出格式
只输出一个 JSON 对象：
{"pass": true|false, "reason": "用中文简要说明审核通过/不通过的原因"}

pass=true 表示消息可以发布。pass=false 表示需要修改。`;

export async function runReviewAgent(
  input: ReviewInput,
  provider: LLMProvider,
  toolRegistry: ToolRegistry,
  model: string,
  workingDir: string,
  parentAgentId: string,
): Promise<ToolAgentResult> {
  const userPrompt = buildReviewUserPrompt(input);
  return runToolAgent(
    {
      id: `tool-review-${Date.now()}`,
      type: "review",
      parentAgentId,
      model,
      maxIterations: 2,
      tools: [],
      systemPrompt: REVIEW_SYSTEM_PROMPT,
      userPrompt,
      workingDir,
    },
    provider,
    toolRegistry,
    workingDir,
  );
}

function buildReviewUserPrompt(input: ReviewInput): string {
  return `## 该 Agent 的职责（JOB.md）
${input.agentJobMd}

## 本轮唤醒的工作轨迹
${input.agentTrace.thinking.map(t => `[思考]: ${t}`).join('\n')}
${input.agentTrace.toolCalls.map(tc =>
  `[工具:${tc.tool}] 参数:${JSON.stringify(tc.args)} → 结果:${tc.result.slice(0, 500)}`
).join('\n')}

## 待发送的群组消息
${input.agentTrace.finalMessage}

## 群组最近的讨论
${input.groupRecentMessages.join('\n')}

## 对该 Agent 的 @mention
${input.agentMentions.join('\n')}

## 群组 TASK.md
${input.groupTaskMd.slice(0, 1000)}

## 群组 PLAN.md
${input.groupPlanMd.slice(0, 1000)}

## 群组 PROGRESS.md
${input.groupProgressMd.slice(0, 1000)}

请审核以上内容，输出 JSON。`;
}

export function parseReviewOutput(output: string): { pass: boolean; reason: string } {
  try {
    const jsonMatch = output.match(/\{[\s\S]*"pass"[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return { pass: !!parsed.pass, reason: parsed.reason || '' };
    }
  } catch { /* fall through */ }
  return { pass: true, reason: '' };
}
