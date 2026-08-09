/**
 * 安全分类器工具智能体（决策 #10 / spec #5）
 *
 * 对齐 Claude Code auto 模式的 yoloClassifier 机制：
 * - 每次工具调用前的独立 LLM 裁决（非规则引擎），裁决三值 allow/deny/ask
 * - reasoning-blind 是防御核心：输入 = 用户消息 + 待裁决调用 + 工作区边界，
 *   不含工具结果、不含 Agent 推理（防话术说服、防 prompt injection 操纵）
 * - fail-closed：分类器不可用/超时/解析失败 → 默认 deny（现状 fail-open 必须改）
 * - 熔断：连续 N 次 deny / 累计 M 次 block → fail-closed deny（防止分类器被攻破后无限通过）
 * - 缓存：allow 缓存（同 tool+参数摘要），deny 不缓存
 * - 不注册进任何 Agent 工具白名单（iron gate：分类器被 Agent 触达即失效）
 *
 * 分类器自身使用轻量判断模型（DEFAULT_JUDGMENT_MODEL），避免镜像主模型成本。
 */
import { runToolAgent } from "../agent/tool-agent/base.js";
import { ToolRegistry } from "./registry.js";
import type { LLMProvider } from "@cobeing/providers";
import { DEFAULT_PROVIDER, DEFAULT_JUDGMENT_MODEL, createLogger } from "@cobeing/shared";

const log = createLogger("safety-classifier");

export type SafetyVerdict = "allow" | "deny" | "ask";
export interface ClassifyResult {
  verdict: SafetyVerdict;
  reason: string;
}
export interface ClassifyInput {
  toolName: string;
  /** 参数摘要（裁剪后的 JSON，避免泄露敏感原文过大） */
  paramsSummary: string;
  agentId: string;
  workingDir: string;
  userMessage?: string;
}

const SYSTEM_PROMPT = `你是 CoBeing 的工具调用安全分类器（只读裁决器，不做任何执行）。
对给定的工具调用判断是否安全放行。只输出 JSON：{"verdict":"allow"|"deny"|"ask","reason":"一句话理由"}。

- allow：安全、无害、符合用户意图，或属于工作区内的常规编辑
- deny：危险/破坏性/越权（删除关键文件、清空数据、外发敏感信息、绕过高权限操作、路径逃逸等）
- ask：模糊或高影响，需要用户确认（若调用方无人工确认通道，会把 ask 降级为 deny）

裁决依据仅限：用户消息 + 待裁决调用 + 工作区边界。禁止臆测工具结果或 Agent 的推理过程。`;

function resolveJudgeProvider(): LLMProvider | undefined {
  const getProvider = (globalThis as any).__cobeingGetProvider;
  const p = getProvider?.(DEFAULT_PROVIDER);
  if (p) return p;
  const map: Map<string, LLMProvider> | undefined = (globalThis as any).__cobeing?.runtime?.providersMap;
  if (map && map.size > 0) return map.values().next().value;
  return undefined;
}

export class SafetyClassifier {
  private consecutiveDenies = 0;
  private totalBlocks = 0;
  private allowCache = new Map<string, true>();

  constructor(
    private provider?: LLMProvider,
    private model?: string,
    private maxConsecutiveDenies = 3,
    private maxTotalBlocks = 20,
  ) {}

  /** 熔断已触发 → fail-closed deny */
  private tripped(): boolean {
    return (
      this.consecutiveDenies >= this.maxConsecutiveDenies ||
      this.totalBlocks >= this.maxTotalBlocks
    );
  }

  async classify(input: ClassifyInput): Promise<ClassifyResult> {
    const cacheKey = `${input.toolName}:${input.paramsSummary}`;
    if (this.allowCache.has(cacheKey)) {
      return { verdict: "allow", reason: "cached allow" };
    }
    if (this.tripped()) {
      this.totalBlocks++;
      return { verdict: "deny", reason: "安全分类器熔断已触发，fail-closed 拒绝" };
    }

    const provider = this.provider ?? resolveJudgeProvider();
    if (!provider) {
      log.warn("Safety classifier unavailable (no provider) — fail-closed deny");
      return this.denyAndCount("安全分类器不可用（无 Provider），默认拒绝（fail-closed）");
    }

    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), 15000);
    const toolRegistry = new ToolRegistry();
    const userPrompt = `## 用户消息
${input.userMessage || "(无)"}

## 待裁决的工具调用
工具: ${input.toolName}
参数: ${input.paramsSummary}
执行者 Agent: ${input.agentId}
工作目录: ${input.workingDir}

请裁决该调用是否放行。只输出 JSON。`;

    try {
      const result = await runToolAgent(
        {
          id: `tool-classify-${Date.now()}`,
          type: "judgment",
          parentAgentId: input.agentId,
          model: this.model || DEFAULT_JUDGMENT_MODEL,
          maxIterations: 1,
          tools: [],
          systemPrompt: SYSTEM_PROMPT,
          userPrompt,
          workingDir: input.workingDir,
          abortSignal: abortController.signal,
        },
        provider,
        toolRegistry,
        input.workingDir,
      );
      return this.record(parseVerdict(result.output), cacheKey);
    } catch (err: any) {
      log.warn("Safety classifier error (%s) — fail-closed deny", err?.message);
      return this.denyAndCount("安全分类器异常，默认拒绝（fail-closed）");
    } finally {
      clearTimeout(timeout);
    }
  }

  private denyAndCount(reason: string): ClassifyResult {
    this.consecutiveDenies++;
    this.totalBlocks++;
    return { verdict: "deny", reason };
  }

  private record(result: { verdict: SafetyVerdict; reason: string }, cacheKey: string): ClassifyResult {
    if (result.verdict === "deny" || result.verdict === "ask") {
      this.consecutiveDenies++;
      this.totalBlocks++;
    } else {
      this.consecutiveDenies = 0;
      this.allowCache.set(cacheKey, true);
    }
    return result;
  }
}

function parseVerdict(output: string): { verdict: SafetyVerdict; reason: string } {
  try {
    const jsonMatch = output.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const v = parsed.verdict;
      if (v === "allow" || v === "deny" || v === "ask") {
        return { verdict: v, reason: parsed.reason || "" };
      }
    }
  } catch {
    /* fall through */
  }
  return { verdict: "deny", reason: "分类器输出解析失败，默认拒绝（fail-closed）" };
}
