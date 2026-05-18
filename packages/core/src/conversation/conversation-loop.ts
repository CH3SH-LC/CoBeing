/**
 * 对话主循环 — Agent 与 LLM 的核心交互循环
 *
 * 流程: 用户消息 → LLM → [工具调用 → LLM → ...] → 最终回复
 */
import type { Message, ToolCall, ToolDefinition, AgentResponse, TokenUsage } from "@cobeing/shared";
import type { LLMProvider } from "@cobeing/providers";
import { ContextWindow } from "./context-window.js";
import { buildSystemPrompt } from "./prompt-builder.js";
import { createLogger } from "@cobeing/shared";
import type { ToolExecutor } from "../tools/executor.js";
import type { WakeSession } from "../agent/wake-session.js";

const log = createLogger("conversation-loop");

export interface ConversationLoopConfig {
  agentConfig: {
    name: string;
    role: string;
    systemPrompt: string;
    model: string;
  };
  provider: LLMProvider;
  tools?: ToolDefinition[];
  toolExecutor?: ToolExecutor;
  agentId?: string;
  sessionId?: string;
  workingDir?: string;
  maxToolRounds?: number;
  maxContextMessages?: number;
  /** 每次 run() 时调用，实时构建 system prompt（优先于 buildSystemPrompt） */
  promptBuilder?: () => string;
  /** Fallback providers tried when primary fails (ordered) */
  fallbackProviders?: LLMProvider[];
  /** Observability database for logging LLM calls */
  observabilityDB?: import("../observability/observability-db.js").ObservabilityDB;
}

export interface ConversationLoopEvents {
  onToken?: (token: string) => void;
  onToolCall?: (toolCall: ToolCall) => void;
  onToolResult?: (toolCallId: string, result: string) => void;
  onRoundComplete?: (round: number, response: string) => void;
  /** 每轮 LLM 调用的 token 用量统计 */
  onUsage?: (usage: TokenUsage) => void;
}

export class ConversationLoop {
  private config: ConversationLoopConfig;
  private contextWindow: ContextWindow;
  private history: Message[] = [];
  private provider: LLMProvider;
  private fallbackProviders: LLMProvider[] = [];
  private observabilityDB?: import("../observability/observability-db.js").ObservabilityDB;

  /** 唤醒周期轨迹记录器（群组审核用） */
  wakeSession?: WakeSession;

  constructor(config: ConversationLoopConfig) {
    this.config = config;
    this.provider = config.provider;
    this.fallbackProviders = config.fallbackProviders ?? [];
    this.observabilityDB = config.observabilityDB;
    this.contextWindow = new ContextWindow(config.maxContextMessages ?? 100);
  }

  setFallbackProviders(providers: LLMProvider[]): void {
    this.fallbackProviders = providers;
  }

  /** Check if an error is eligible for provider fallback */
  private static isFallbackEligible(errMsg: string): boolean {
    return (
      errMsg.includes("timeout") || errMsg.includes("Timeout") ||
      errMsg.includes("ETIMEDOUT") || errMsg.includes("ECONNREFUSED") ||
      errMsg.includes("503") || errMsg.includes("500") ||
      errMsg.includes("429") || errMsg.includes("rate limit") ||
      errMsg.includes("402") || errMsg.includes("quota") ||
      errMsg.includes("overloaded") || errMsg.includes("Service Unavailable")
    );
  }

  private static buildProviderError(errMsg: string, model: string): string {
    if (errMsg.includes("timeout") || errMsg.includes("Timeout") || errMsg.includes("timed out") || errMsg.includes("ETIMEDOUT") || errMsg.includes("ECONNREFUSED")) {
      return "⚠️ 云端服务无响应（连接超时），请检查网络连接或 API 服务状态";
    } else if (errMsg.includes("401") || errMsg.includes("Unauthorized") || errMsg.includes("unauthorized") || errMsg.includes("API key") || errMsg.includes("api_key") || errMsg.includes("authentication")) {
      return "⚠️ API 密钥验证失败，请检查 Provider 配置中的 API Key 是否正确";
    } else if (errMsg.includes("402") || errMsg.includes("insufficient_quota") || errMsg.includes("quota") || errMsg.includes("rate limit") || errMsg.includes("429") || errMsg.includes("Too Many Requests")) {
      return "⚠️ API 配额不足或请求频率过高，请稍后重试或升级套餐";
    } else if (errMsg.includes("503") || errMsg.includes("Service Unavailable") || errMsg.includes("overloaded") || errMsg.includes("Internal Server Error") || errMsg.includes("500")) {
      return "⚠️ AI 服务暂时不可用（服务端错误），请稍后重试";
    } else if (errMsg.includes("model") && (errMsg.includes("not found") || errMsg.includes("not support") || errMsg.includes("unavailable"))) {
      return `⚠️ 模型不可用或不存在（${model}），请检查模型名称配置`;
    } else if (errMsg.includes("context_length") || errMsg.includes("max_tokens") || errMsg.includes("token limit") || errMsg.includes("too many tokens")) {
      return "⚠️ 上下文超出模型限制（token 超长），对话历史将被截断后重试";
    }
    return `⚠️ AI 服务调用异常: ${errMsg.slice(0, 200)}`;
  }

  /**
   * 运行一轮对话
   * @returns 最终回复内容
   */
  /** 修复不完整的 tool_calls 序列（上次执行被中断时残留）。
   *  从后往前扫描，找到第一个不完整的 assistant(tool_calls) 就截断整个尾部。 */
  private repairIncompleteToolCalls(): void {
    for (let i = this.history.length - 1; i >= 0; i--) {
      const msg = this.history[i];
      if (msg.role !== "assistant" || !msg.toolCalls?.length) continue;

      const requiredIds = new Set(msg.toolCalls.map(tc => tc.id));
      let foundCount = 0;
      for (let j = i + 1; j < this.history.length; j++) {
        const later = this.history[j];
        if (later.role === "tool" && later.toolCallId && requiredIds.has(later.toolCallId)) {
          foundCount++;
        }
      }

      if (foundCount < requiredIds.size) {
        log.warn("Truncating incomplete tool_calls at history[%d]: %d/%d results, dropping %d msgs",
          i, foundCount, requiredIds.size, this.history.length - i);
        this.history = this.history.slice(0, i);
        return;
      }
    }
  }

  async run(
    userInput: string,
    events?: ConversationLoopEvents,
    abortSignal?: AbortSignal,
  ): Promise<AgentResponse> {
    this.repairIncompleteToolCalls();

    if (userInput) {
      this.history.push({ role: "user", content: userInput });
    }

    const systemPrompt = this.config.promptBuilder
      ? this.config.promptBuilder()
      : buildSystemPrompt({
          id: "",
          name: this.config.agentConfig.name,
          role: this.config.agentConfig.role,
          systemPrompt: this.config.agentConfig.systemPrompt,
          provider: "",
          model: "",
        });

    const maxRounds = this.config.maxToolRounds ?? Infinity;
    let totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 };

    for (let round = 0; round < maxRounds; round++) {
      // 检查是否被外部停止
      if (abortSignal?.aborted) {
        return { content: "[已停止]", usage: totalUsage };
      }
      const messages = this.contextWindow.trim([
        { role: "system", content: systemPrompt },
        ...this.history,
      ]);

      // 诊断：验证 tool_calls 序列完整性
      for (let mi = 0; mi < messages.length; mi++) {
        const m = messages[mi];
        if (m.role === "assistant" && m.toolCalls?.length) {
          const needed = new Set(m.toolCalls.map(tc => tc.id));
          let toolCount = 0;
          for (let mj = mi + 1; mj < messages.length; mj++) {
            const later = messages[mj];
            if (later.role === "tool" && later.toolCallId && needed.has(later.toolCallId)) {
              needed.delete(later.toolCallId);
              toolCount++;
              continue;
            }
            // 非 tool 消息 → tool results 必须已全部收集完
            if (later.role !== "tool") break;
          }
          if (needed.size > 0) {
            log.error("ROUND %d: broken tool_calls at msg[%d] (%d tool msgs after, %d/%d results). History len=%d trim=%s",
              round, mi, toolCount, m.toolCalls.length - needed.size, m.toolCalls.length,
              this.history.length, this.history.length > (this.config.maxContextMessages ?? 100) ? "yes" : "no");
            // 自愈：从 history 中截断到损坏点之前
            const histIdx = mi - 1; // messages[0] = system, messages[1..] = history
            this.history = this.history.slice(0, histIdx);
            // 重建 messages
            const rebuilt = this.contextWindow.trim([
              { role: "system", content: systemPrompt },
              ...this.history,
            ]);
            messages.length = 0;
            messages.push(...rebuilt);
            break;
          }
        }
      }

      // 调用 LLM (with provider fallback)
      let fullContent = "";
      let fullReasoning = "";
      const toolCalls: ToolCall[] = [];
      let providerError: string | null = null;

      const roundStart = Date.now();
      const fallbackList = [this.provider, ...this.fallbackProviders];
      let chatSucceeded = false;
      let usedProviderName = fallbackList[0].constructor.name;
      const prevTotalInput = totalUsage.inputTokens;
      const prevTotalOutput = totalUsage.outputTokens;
      const prevCacheHit = totalUsage.cacheHitTokens ?? 0;
      const prevCacheMiss = totalUsage.cacheMissTokens ?? 0;

      for (const chatProvider of fallbackList) {
        try {
          for await (const chunk of chatProvider.chat({
            model: this.config.agentConfig.model,
            messages,
            tools: this.config.tools,
            abortSignal,
          })) {
            if (chunk.type === "content" && chunk.content) {
              fullContent += chunk.content;
              events?.onToken?.(chunk.content);
              this.wakeSession?.recordThinking(chunk.content);
            }
            if (chunk.type === "reasoning" && chunk.content) {
              fullReasoning += chunk.content;
              this.wakeSession?.recordThinking(chunk.content);
            }
            if (chunk.type === "tool_call" && chunk.toolCall) {
              toolCalls.push(chunk.toolCall);
              events?.onToolCall?.(chunk.toolCall);
            }
            if (chunk.type === "usage" && chunk.usage) {
              totalUsage.inputTokens += chunk.usage.inputTokens;
              totalUsage.outputTokens += chunk.usage.outputTokens;
              totalUsage.cacheHitTokens = (totalUsage.cacheHitTokens ?? 0) + (chunk.usage.cacheHitTokens ?? 0);
              totalUsage.cacheMissTokens = (totalUsage.cacheMissTokens ?? 0) + (chunk.usage.cacheMissTokens ?? 0);
            }
          }
          chatSucceeded = true;
          providerError = null; // clear error from previous failed attempt
          if (chatProvider !== this.provider) {
            log.info("Switched to fallback provider for future rounds");
            this.provider = chatProvider;
          }
          usedProviderName = chatProvider.constructor.name;
          break;
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          // 外部 stop() 触发取消：直接返回停止状态，不尝试 fallback
          if (abortSignal?.aborted || (err as any)?.name === "AbortError" || errMsg.includes("aborted") && errMsg.includes("Abort")) {
            return { content: "[已停止]", usage: totalUsage };
          }
          log.error("Provider chat error (round %d, provider %s): %s", round, chatProvider.constructor.name, errMsg);
          providerError = ConversationLoop.buildProviderError(errMsg, this.config.agentConfig.model);
          // Stop trying fallbacks if error is not retryable
          if (!ConversationLoop.isFallbackEligible(errMsg)) break;
          log.warn("Trying next fallback provider...");
        }
      }

      if (!chatSucceeded && providerError) {
        // All providers exhausted — log error then return
        if (this.observabilityDB) {
          this.observabilityDB.insertLLMCall({
            agent_id: this.config.agentId ?? "unknown",
            agent_name: this.config.agentConfig.name,
            group_id: this.config.sessionId?.startsWith("group:") ? this.config.sessionId.slice(6) : undefined,
            model: this.config.agentConfig.model,
            provider: fallbackList[0].constructor.name,
            latency_ms: Date.now() - roundStart,
            input_tokens: 0, output_tokens: 0, cache_hit_tokens: 0, cache_miss_tokens: 0,
            is_error: 1,
            error_message: providerError,
            fallback_used: 0,
            round: round + 1,
            timestamp: Date.now(),
          });
        }
        return { content: providerError, usage: totalUsage };
      }

      // 缓存命中率日志 + 事件上报
      const hit = totalUsage.cacheHitTokens ?? 0;
      const miss = totalUsage.cacheMissTokens ?? 0;
      if (hit + miss > 0) {
        const hitRate = Math.round((hit / (hit + miss)) * 100);
        log.info("Round %d cache: %d%% hit (%d/%d tokens), input=%d output=%d",
          round, hitRate, hit, hit + miss, totalUsage.inputTokens, totalUsage.outputTokens);
      }
      events?.onUsage?.({ ...totalUsage });

      // Observability: log LLM call (per-round token delta)
      if (this.observabilityDB) {
        const roundInput = totalUsage.inputTokens - prevTotalInput;
        const roundOutput = totalUsage.outputTokens - prevTotalOutput;
        this.observabilityDB.insertLLMCall({
          agent_id: this.config.agentId ?? "unknown",
          agent_name: this.config.agentConfig.name,
          group_id: this.config.sessionId?.startsWith("group:") ? this.config.sessionId.slice(6) : undefined,
          model: this.config.agentConfig.model,
          provider: usedProviderName,
          latency_ms: Date.now() - roundStart,
          input_tokens: roundInput,
          output_tokens: roundOutput,
          cache_hit_tokens: (totalUsage.cacheHitTokens ?? 0) - prevCacheHit,
          cache_miss_tokens: (totalUsage.cacheMissTokens ?? 0) - prevCacheMiss,
          is_error: providerError ? 1 : 0,
          error_message: providerError ?? undefined,
          fallback_used: usedProviderName !== fallbackList[0].constructor.name ? 1 : 0,
          round: round + 1,
          timestamp: Date.now(),
        });
      }

      // Provider 调用异常 → 返回错误，不继续
      if (providerError) {
        return { content: providerError, usage: totalUsage };
      }

      // 没有工具调用 → 返回最终回复
      if (toolCalls.length === 0) {
        this.history.push({ role: "assistant", content: fullContent, reasoningContent: fullReasoning || undefined });
        events?.onRoundComplete?.(round, fullContent);
        if (this.wakeSession) this.wakeSession.finalMessage = fullContent;
        return { content: fullContent, usage: totalUsage };
      }

      // 有工具调用
      this.history.push({
        role: "assistant",
        content: fullContent,
        toolCalls,
        reasoningContent: fullReasoning || undefined,
      });

      log.debug("Round %d: %d tool calls", round, toolCalls.length);

      // 如果有 ToolExecutor，自动执行工具并继续循环
      if (this.config.toolExecutor) {
        for (const tc of toolCalls) {
          // 工具执行前检查是否被外部停止 — 补全剩余 tool 结果防止 history 断裂
          if (abortSignal?.aborted) {
            // 为尚未执行的 tool_calls 补写取消结果
            for (const remaining of toolCalls.slice(toolCalls.indexOf(tc))) {
              this.history.push({ role: "tool", content: "[已停止]", toolCallId: remaining.id });
            }
            return { content: "[已停止]", usage: totalUsage };
          }
          let result: import("@cobeing/shared").ToolResult;
          try {
            result = await this.config.toolExecutor.execute(
              tc,
              this.config.agentId ?? "unknown",
              this.config.sessionId ?? "unknown",
              this.config.workingDir ?? process.cwd(),
            );
          } catch (err) {
            // 工具执行异常也必须写入 history，否则 tool_calls 链断裂
            const errMsg = err instanceof Error ? err.message : String(err);
            log.error("Tool execution threw: %s", errMsg);
            result = { toolCallId: tc.id, content: `工具执行异常: ${errMsg}`, isError: true };
          }
          this.history.push({
            role: "tool",
            content: result.content,
            toolCallId: tc.id,
          });
          events?.onToolResult?.(tc.id, result.content);
          // Record tool call in wake session for group review
          let callArgs: Record<string, unknown> = {};
          try { callArgs = JSON.parse(tc.function.arguments || "{}"); } catch { /* ignore parse errors */ }
          this.wakeSession?.recordToolCall(tc.function.name, callArgs, result.content);
        }
        // 继续下一轮 LLM 调用
        continue;
      }

      // 无 ToolExecutor → 返回让外部处理
      return { content: fullContent, toolCalls, usage: totalUsage };
    }

    if (this.wakeSession) this.wakeSession.finalMessage = "达到最大工具调用轮数限制";
    return {
      content: "达到最大工具调用轮数限制",
      usage: totalUsage,
    };
  }

  /** 获取当前对话历史 */
  getHistory(): Message[] {
    return [...this.history];
  }

  /** 清空历史（保留最近 N 条） */
  clearHistory(keepLast = 0): void {
    if (keepLast > 0) {
      this.history = this.history.slice(-keepLast);
    } else {
      this.history = [];
    }
  }
}
