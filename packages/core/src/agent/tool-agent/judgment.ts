/**
 * Judgment Tool Agent — 判断是否需要唤醒群主
 */
import type { LLMProvider } from "@cobeing/providers";
import { ToolRegistry } from "../../tools/registry.js";
import { runToolAgent } from "./base.js";
import type { JudgmentInput, JudgmentResult, ToolAgentResult } from "./types.js";

const JUDGMENT_SYSTEM_PROMPT = `你是群组中的判断助手。唯一职责：审查 Agent 发言，决定是否需要唤醒群主。

需要唤醒群主（wake_host: true）：
1. 发言包含对群主的直接提问或决策请求
2. 报告了关键错误、阻塞问题、安全隐患
3. 群组明显偏离方向、陷入死循环、成员间严重冲突
4. 用户需求发生变化，需要群主重新确认方向
5. 有 Agent 反复失败同一任务超过合理次数
6. 成员完成了阶段任务或关键里程碑，需要群主推进下一阶段

不需要唤醒群主（wake_host: false）：
1. 例行进度更新（"我完成了 X"、"正在做 Y"）
2. 子任务完成通知（非阶段结束）
3. Agent 间的内部协调沟通
4. 对他人消息的确认/回应
5. 工具调用结果的正常汇报

输出格式（仅 JSON，无其他内容）：
{"wake_host":true|false,"reason":"一句话原因","urgency":"high"|"medium"|"low"}`;

export async function runJudgmentAgent(
  input: JudgmentInput,
  provider: LLMProvider,
  model: string,
  parentAgentId: string,
  workingDir: string,
  timeoutMs = 15000,
): Promise<JudgmentResult> {
  const toolRegistry = new ToolRegistry();

  const userPrompt = `## 群组信息
群组: ${input.groupName}
群主: ${input.hostName}

## 触发消息
发送者: ${input.fromAgentName} (${input.fromAgentId})
内容: ${input.targetMessage}

## 群组最近消息（从 current.md）
${input.recentMessages.join('\n')}

请判断是否需要唤醒群主。只输出 JSON。`;

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), timeoutMs);

  try {
    const result = await runToolAgent(
      {
        id: `tool-judgment-${Date.now()}`,
        type: "judgment",
        parentAgentId,
        model,
        maxIterations: 2,
        tools: [],
        systemPrompt: JUDGMENT_SYSTEM_PROMPT,
        userPrompt,
        workingDir,
        abortSignal: abortController.signal,
      },
      provider,
      toolRegistry,
      workingDir,
    );
    return parseJudgmentOutput(result.output);
  } catch {
    return { wake_host: true, reason: "判断超时，默认唤醒群主", urgency: "medium" };
  } finally {
    clearTimeout(timeout);
  }
}

function parseJudgmentOutput(output: string): JudgmentResult {
  try {
    const jsonMatch = output.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        wake_host: parsed.wake_host === true,
        reason: parsed.reason || '',
        urgency: parsed.urgency || 'medium',
      };
    }
  } catch { /* fall through */ }
  return { wake_host: true, reason: "判断结果解析失败，默认唤醒", urgency: "medium" };
}
