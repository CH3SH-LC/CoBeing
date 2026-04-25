/**
 * Screener — 群主初筛模型（Phase 8.3）
 *
 * 群组中每出现新消息都触发 Screener（轻量模型）。
 * Screener 不执行工具，只判断是否需要唤醒主模型。
 */
import type { LLMProvider } from "@cobeing/providers";
import { createLogger } from "@cobeing/shared";

const log = createLogger("screener");

const SCREENER_PROMPT = `你是群组协作的初筛器。你的任务是判断群主是否需要介入当前协作。

请根据以下规则判断：

**需要介入的情况：**
- 协作偏离目标（2+ 轮无关内容）
- 成员间冲突升级（互相否定 3+ 轮）
- 长时间无实质进展（连续 5+ 条消息无新观点）
- 任务阻塞报告
- 成员请求帮助或指导

**不需要介入的情况：**
- 成员正在有效协作
- 工作正常推进
- 只是信息分享或状态更新
- 你没有比成员更好的见解

请严格按以下格式输出：

是否需要唤醒主模型：是/否
原因：一句话说明
建议：如果需要唤醒，给出建议群主做什么（不需要则填"无"）
冲突摘要：如果存在观点分歧，列出各方观点（没有则填"无"）

请分析以下最近消息：`;

export interface ScreenerResult {
  shouldWake: boolean;
  reason: string;
  suggestion: string;
  conflictSummary?: string;
}

export class Screener {
  private provider: LLMProvider;
  private model: string;

  constructor(provider: LLMProvider, model?: string) {
    this.provider = provider;
    this.model = model ?? "";
  }

  /** 分析最近消息，判断是否需要唤醒主模型 */
  async screen(recentMessages: string): Promise<ScreenerResult> {
    if (!recentMessages.trim()) {
      return { shouldWake: false, reason: "无消息", suggestion: "无" };
    }

    try {
      let result = "";
      for await (const chunk of this.provider.chat({
        model: this.model,
        messages: [
          { role: "system", content: SCREENER_PROMPT },
          { role: "user", content: recentMessages },
        ],
      })) {
        if (chunk.type === "content" && chunk.content) {
          result += chunk.content;
        }
      }

      return this.parseResult(result);
    } catch (err: any) {
      log.warn("Screener failed: %s", err.message);
      return { shouldWake: false, reason: `初筛失败: ${err.message}`, suggestion: "无" };
    }
  }

  /** 解析初筛结果 */
  private parseResult(raw: string): ScreenerResult {
    const shouldWake = raw.includes("是") && !raw.includes("是否需要唤醒主模型：否");

    const reasonMatch = raw.match(/原因[：:]\s*(.+)/);
    const suggestionMatch = raw.match(/建议[：:]\s*(.+)/);
    const conflictMatch = raw.match(/冲突摘要[：:]\s*(.+)/);

    const conflictRaw = conflictMatch?.[1]?.trim() ?? "";
    const hasConflict = conflictRaw && conflictRaw !== "无";

    return {
      shouldWake,
      reason: reasonMatch?.[1]?.trim() ?? "",
      suggestion: suggestionMatch?.[1]?.trim() ?? "无",
      conflictSummary: hasConflict ? conflictRaw : undefined,
    };
  }
}
