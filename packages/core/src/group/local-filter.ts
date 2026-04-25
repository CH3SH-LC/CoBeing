// packages/core/src/group/local-filter.ts
import { createLogger } from "@cobeing/shared";
import type { FilterResult } from "@cobeing/shared";
import type { GroupMessageV2 } from "./group-context-v2.js";
import { FILTER_SYSTEM_PROMPT, buildFilterUserPrompt } from "./filter-prompt.js";

const log = createLogger("local-filter");

/** GBNF grammar 强制模型输出 JSON */
const FILTER_GRAMMAR = `
root   ::= "{" ws "\\"shouldWake\\":" ws boolean "," ws "\\"reason\\":" ws string "," ws "\\"summary\\":" ws value "," ws "\\"priority\\":" ws string "}"
value  ::= string | "null"
boolean ::= "true" | "false"
string  ::= "\\"" ([^"\\\\] | "\\\\" .)* "\\""
ws     ::= ([ \\t\\n])*
`;

export class LocalFilterEngine {
  private llama: any = null;
  private model: any = null;
  private context: any = null;
  private grammar: any = null;
  private _enabled = false;

  isEnabled(): boolean {
    return this._enabled;
  }

  /** 初始化模型（加载 GGUF 文件） */
  async init(modelPath: string, contextSize = 8192): Promise<void> {
    try {
      const { getLlama, LlamaGrammar } = await import("node-llama-cpp");
      const llama = await getLlama();
      const model = await llama.loadModel({ modelPath });
      const context = await model.createContext({ contextSize });
      const grammar = new LlamaGrammar(llama, { grammar: FILTER_GRAMMAR });

      this.llama = llama;
      this.model = model;
      this.context = context;
      this.grammar = grammar;
      this._enabled = true;
      log.info("LocalFilterEngine initialized: %s (context=%d)", modelPath, contextSize);
    } catch (err: any) {
      log.warn("LocalFilterEngine init failed (will use fallback): %s", err.message);
      this._enabled = false;
    }
  }

  /** 评估群消息，返回过滤结果 */
  async evaluate(groupId: string, messages: GroupMessageV2[]): Promise<FilterResult> {
    if (!this._enabled || !this.model || !this.context) {
      return { shouldWake: true, reason: "本地过滤未启用", priority: "normal" };
    }

    try {
      const prompt = buildFilterUserPrompt(
        groupId,
        messages.map(m => ({
          fromAgentId: m.fromAgentId,
          content: m.content.slice(0, 500),
          timestamp: m.timestamp,
        })),
      );

      const { LlamaChatSession } = await import("node-llama-cpp");
      const sequence = this.context.getSequence();
      const session = new LlamaChatSession({ contextSequence: sequence });

      const response = await session.prompt(
        `${FILTER_SYSTEM_PROMPT}\n\n${prompt}`,
        {
          grammar: this.grammar,
          maxTokens: 256,
        },
      );

      return this.parseFilterResult(response);
    } catch (err: any) {
      log.warn("LocalFilterEngine evaluate failed: %s", err.message);
      return { shouldWake: true, reason: "过滤推理失败，默认唤醒", priority: "normal" };
    }
  }

  /** 解析模型输出为 FilterResult */
  private parseFilterResult(raw: string): FilterResult {
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return { shouldWake: true, reason: "无法解析过滤结果", priority: "normal" };
      }

      const parsed = JSON.parse(jsonMatch[0]);

      return {
        shouldWake: parsed.shouldWake !== false,
        reason: typeof parsed.reason === "string" ? parsed.reason : "",
        summary: typeof parsed.summary === "string" ? parsed.summary : undefined,
        priority: ["high", "normal", "low"].includes(parsed.priority) ? parsed.priority : "normal",
      };
    } catch {
      return { shouldWake: true, reason: "JSON 解析失败", priority: "normal" };
    }
  }

  /** 释放模型资源 */
  dispose(): void {
    try {
      this.context?.dispose();
      this.model?.dispose();
    } catch { /* ignore */ }
    this.context = null;
    this.model = null;
    this.grammar = null;
    this._enabled = false;
    log.info("LocalFilterEngine disposed");
  }
}
