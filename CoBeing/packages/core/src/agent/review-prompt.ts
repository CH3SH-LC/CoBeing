/**
 * Agent 群组消息审核 prompt 构建与结果解析（从 agent.ts 提取，行为不变）
 */
import type { ReviewInput, ReviewResult } from "@cobeing/shared";

/** 构建审核 prompt */
export function buildReviewPrompt(input: ReviewInput): string {
  return `# 审核任务

你正在审核一条即将发布到群组的消息。

## 审核标准
1. 该 Agent 是否确实进行了实质性工作（调用了工具、产生了具体输出）？
2. 工作方法是否符合任务要求？
3. 该 Agent 是否在偷懒（仅声明意图而未展示实际工作成果）？

## 该 Agent 的职责（JOB.md）
${input.agentJobMd}

## 本轮唤醒的工作轨迹
${input.agentTrace.thinking.map(t => `[思考]: ${t}`).join('\n')}
${input.agentTrace.toolCalls.map(tc => `[工具:${tc.tool}] 参数:${JSON.stringify(tc.args)} → 结果:${tc.result.slice(0, 500)}`).join('\n')}

## 待发送的群组消息
${input.agentTrace.finalMessage}

## 群组最近的讨论
${input.groupRecentMessages.join('\n')}

## 针对该 Agent 的 @mention
${input.agentMentions.join('\n')}

## 群组任务
${input.groupTaskMd}

## 群组计划
${input.groupPlanMd}

## 进度
${input.groupProgressMd}

请严格按以下 JSON 格式回复（不要包含其他内容）：
{"pass": true/false, "reason": "如果不通过，请简要说明原因（50字以内）"}`
}

/** 解析审核结果 */
export function parseReviewResult(text: string): ReviewResult {
  try {
    return JSON.parse(text.trim())
  } catch {
    return { pass: true, reason: '' }
  }
}
