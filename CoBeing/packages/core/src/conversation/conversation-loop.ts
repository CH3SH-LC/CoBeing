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
import { chatWithGateway } from "../gateway/llm-gateway.js";

const log = createLogger("conversation-loop");

// ── Circuit Breaker ───────────────────────────────────────────
const CIRCUIT_OPEN_THRESHOLD = 3;       // consecutive failures to trip
const CIRCUIT_TIMEOUT_MS = 60_000;      // try again after 60s (half-open)

interface CircuitState {
  failures: number;
  openUntil: number; // ms timestamp
}

const providerCircuits = new Map<string, CircuitState>();

function checkCircuit(providerId: string): boolean {
  const state = providerCircuits.get(providerId);
  if (!state) return true; // no history → allow

  if (state.failures < CIRCUIT_OPEN_THRESHOLD) return true; // not tripped

  // Circuit is open — check if timeout has elapsed (half-open)
  if (Date.now() >= state.openUntil) {
    // Enter half-open: allow one trial request
    providerCircuits.delete(providerId);
    return true;
  }

  // Circuit is open — skip this provider
  log.warn("Circuit OPEN for provider %s — skipping until %s",
    providerId, new Date(state.openUntil).toISOString());
  return false;
}

function recordCircuitSuccess(providerId: string): void {
  providerCircuits.delete(providerId);
}

function recordCircuitFailure(providerId: string): void {
  const state = providerCircuits.get(providerId) ?? { failures: 0, openUntil: 0 };
  state.failures += 1;
  if (state.failures >= CIRCUIT_OPEN_THRESHOLD) {
    state.openUntil = Date.now() + CIRCUIT_TIMEOUT_MS;
    log.warn("Circuit TRIPPED for provider %s (%d consecutive failures) — open for %ds",
      providerId, state.failures, CIRCUIT_TIMEOUT_MS / 1000);
  }
  providerCircuits.set(providerId, state);
}
// ─────────────────────────────────────────────────────────────

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

/** 群组工作唤醒防"只说不做"：文本承诺但未产出文件时的推回指令 */
const WORK_PUSHBACK_DIRECTIVE = `【系统提示】你本轮没有产出任何文件。如果当前任务需要交付文件（HTML/代码/文档等），请立即调用 write-file 工具写出完整交付物，然后回复结果；如果任务确实不需要产出文件，请先简要说明原因再回复。`;

export class ConversationLoop {
  private config: ConversationLoopConfig;
  private contextWindow: ContextWindow;
  private history: Message[] = [];
  private provider: LLMProvider;
  private fallbackProviders: LLMProvider[] = [];
  private observabilityDB?: import("../observability/observability-db.js").ObservabilityDB;

  /** 群组工作推回：本轮是否产出过文件（write-file/edit-file 成功调用） */
  private _producedFile = false;
  /** 群组工作推回：已推回次数（上限 2，防止死循环） */
  private _pushbackCount = 0;
  /** 思考轮计数：推理模型只产出 reasoning 未产出正文的轮次（上限 3） */
  private _thinkingRounds = 0;

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
      errMsg.includes("fetch failed") || errMsg.includes("ENOTFOUND") ||
      errMsg.includes("EAI_AGAIN") || errMsg.includes("ECONNRESET") ||
      errMsg.includes("UND_ERR") || errMsg.includes("getaddrinfo") ||
      errMsg.includes("socket") || errMsg.includes("network") ||
      errMsg.includes("503") || errMsg.includes("500") ||
      errMsg.includes("429") || errMsg.includes("rate limit") ||
      errMsg.includes("402") || errMsg.includes("quota") ||
      errMsg.includes("overloaded") || errMsg.includes("Service Unavailable")
    );
  }

  private static buildProviderError(errMsg: string, model: string): string {
    if (errMsg.includes("timeout") || errMsg.includes("Timeout") || errMsg.includes("timed out") || errMsg.includes("ETIMEDOUT") || errMsg.includes("ECONNREFUSED")) {
      return "⚠️ 云端服务无响应（连接超时），请检查网络连接或 API 服务状态";
    } else if (errMsg.includes("fetch failed") || errMsg.includes("ENOTFOUND") || errMsg.includes("EAI_AGAIN") || errMsg.includes("ECONNRESET") || errMsg.includes("UND_ERR") || errMsg.includes("getaddrinfo") || errMsg.includes("socket") || errMsg.includes("network") || errMsg.includes("unexpected server response")) {
      return "⚠️ 网络连接不稳定（AI 服务暂不可达），请稍后重试或检查网络";
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
    // 每次 run 重置工作推回状态（loop 实例跨唤醒缓存，计数器不得跨 run 累积）
    this._producedFile = false;
    this._pushbackCount = 0;
    this._thinkingRounds = 0;
    this.repairIncompleteToolCalls();

    if (userInput) {
      this.history.push({ role: "user", content: userInput });

      // Emit message:receive hook
      const hookBus = (globalThis as any).__cobeingHookBus;
      if (hookBus) {
        hookBus.emit("message:receive", { content: userInput }, { agentId: this.config.agentId }).catch(() => {});
      }
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
    let accumulatedContent = "";  // 跨轮累积，确保 agent_response 携带完整文本

    for (let round = 0; round < maxRounds; round++) {
      // 检查是否被外部停止
      if (abortSignal?.aborted) {
        return { content: accumulatedContent || "[已停止]", usage: totalUsage };
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
        // Circuit breaker: skip providers with open circuits
        const providerId = (chatProvider as any).id || chatProvider.constructor.name;
        if (!checkCircuit(providerId)) continue;

        try {
          for await (const chunk of await chatWithGateway(chatProvider, {
            model: this.config.agentConfig.model,
            messages,
            tools: this.config.tools,
            abortSignal,
            // 历史 bug：provider 默认 max_tokens=4096，大参数工具调用
            // （如 write-file 携带完整文件内容）在 4096 处被截断 → 工具调用
            // 永远不完整 → 模型反复"思考"但发不出调用。配合分块写入指导提高到 8k。
            maxTokens: 8192,
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
          recordCircuitSuccess(providerId);
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
            return { content: accumulatedContent || "[已停止]", usage: totalUsage };
          }
          log.error("Provider chat error (round %d, provider %s): %s", round, chatProvider.constructor.name, errMsg);
          recordCircuitFailure(providerId);
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
        return { content: accumulatedContent || providerError, usage: totalUsage };
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
        return { content: accumulatedContent || providerError, usage: totalUsage };
      }

      // 没有工具调用 → 返回最终回复（群组工作唤醒先做"只说不做"推回）
      if (toolCalls.length === 0) {
        // 思考轮：推理模型只产出 reasoning（思考）未产出正文 → 继续循环而非当最终回复
        // （历史问题：deepseek-v4-flash 某些轮 output 上万 tokens 但 content 为空，
        //   被当作空最终回复触发推回空转；思考轮应让模型继续直到产出正文或工具调用）
        if (!fullContent.trim() && fullReasoning.trim()) {
          if (this._thinkingRounds < 3) {
            this._thinkingRounds++;
            this.history.push({ role: "assistant", content: fullContent, reasoningContent: fullReasoning || undefined });
            log.info("Thinking round %d/3: reasoning-only, continuing", this._thinkingRounds);
            continue;
          }
          // 思考轮超限：以推理摘要作为正文兜底，避免死循环
          fullContent = `[思考超限] ${fullReasoning.slice(0, 300)}`;
        }
        if (this.pushbackWorkCommitment(fullContent)) {
          this.history.push({ role: "assistant", content: fullContent, reasoningContent: fullReasoning || undefined });
          this.history.push({ role: "user", content: WORK_PUSHBACK_DIRECTIVE });
          continue;
        }
        accumulatedContent += fullContent;
        this.history.push({ role: "assistant", content: fullContent, reasoningContent: fullReasoning || undefined });
        events?.onRoundComplete?.(round, fullContent);
        if (this.wakeSession) this.wakeSession.finalMessage = accumulatedContent;

        // Emit message:send hook (use accumulatedContent for full text)
        try {
          const hookBus = (globalThis as any).__cobeingHookBus;
          if (hookBus) {
            const sendResult = await hookBus.emit("message:send",
              { content: accumulatedContent },
              { agentId: this.config.agentId, groupId: this.config.sessionId?.startsWith("group:") ? this.config.sessionId.slice(6) : undefined },
            );
            if (!sendResult.allowed) {
          const reason = sendResult.reason || "unknown";
          log.info("message:send blocked by plugin: %s", reason);
          return { content: `[消息被插件拦截: ${reason}]`, usage: totalUsage };
        }
            if (sendResult.message) accumulatedContent = sendResult.message.content;
          }
        } catch (err: any) {
          log.warn("message:send hook error: %s", err?.message);
        }
        return { content: accumulatedContent, usage: totalUsage };
      }

      // 有工具调用
      accumulatedContent += fullContent;
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
            return { content: accumulatedContent || "[已停止]", usage: totalUsage };
          }
          let result: import("@cobeing/shared").ToolResult;
          // 工作目录必须明确配置——缺失时拒绝执行工具并返回明确错误，
          // 绝不静默兜底 process.cwd()（否则 grep/glob 等无 path 参数的工具会从项目根全盘扫描，内存耗尽崩溃）
          if (!this.config.workingDir) {
            log.error("Tool %s blocked: workingDir is not configured for session %s", tc.function?.name, this.config.sessionId);
            this.history.push({ role: "tool", content: `工具执行被拒绝：会话工作目录未配置（workingDir 缺失）。请联系管理员检查 Agent 工作目录配置。`, toolCallId: tc.id });
            continue;
          }
          try {
            result = await this.config.toolExecutor.execute(
              tc,
              this.config.agentId ?? "unknown",
              this.config.sessionId ?? "unknown",
              this.config.workingDir,
            );
          } catch (err) {
            // 工具执行异常也必须写入 history，否则 tool_calls 链断裂
            const errMsg = err instanceof Error ? err.message : String(err);
            log.error("Tool execution threw: %s", errMsg);
            result = { toolCallId: tc.id, content: `工具执行异常: ${errMsg}`, isError: true };
          }
          // 工具结果截断：防止巨型结果（大文件读取/大输出）撑爆上下文窗口
          const MAX_TOOL_RESULT_CHARS = 8000;
          const toolResultContent = result.content.length > MAX_TOOL_RESULT_CHARS
            ? result.content.slice(0, MAX_TOOL_RESULT_CHARS) + `\n...[已截断，原 ${result.content.length} 字符，如需完整内容请用 read-file 分块读取]`
            : result.content;
          this.history.push({
            role: "tool",
            content: toolResultContent,
            toolCallId: tc.id,
          });
          events?.onToolResult?.(tc.id, toolResultContent);
          // 记录是否产出过文件（供"只说不做"推回判断）
          if (tc.function.name === "write-file" || tc.function.name === "edit-file") {
            this._producedFile = true;
          }
          // Record tool call in wake session for group review
          let callArgs: Record<string, unknown> = {};
          try { callArgs = JSON.parse(tc.function.arguments || "{}"); } catch { /* ignore parse errors */ }
          this.wakeSession?.recordToolCall(tc.function.name, callArgs, result.content);
        }
        // 继续下一轮 LLM 调用
        continue;
      }

      // 无 ToolExecutor → 返回让外部处理
      try {
        const hookBus = (globalThis as any).__cobeingHookBus;
        if (hookBus) {
          const sendResult = await hookBus.emit("message:send",
            { content: accumulatedContent },
            { agentId: this.config.agentId, groupId: this.config.sessionId?.startsWith("group:") ? this.config.sessionId.slice(6) : undefined },
          );
          if (!sendResult.allowed) {
          const reason = sendResult.reason || "unknown";
          log.info("message:send blocked by plugin: %s", reason);
          return { content: `[消息被插件拦截: ${reason}]`, usage: totalUsage };
        }
          if (sendResult.message) accumulatedContent = sendResult.message.content;
        }
      } catch (err: any) {
        log.warn("message:send hook error: %s", err?.message);
      }
      return { content: accumulatedContent, toolCalls, usage: totalUsage };
    }

    if (this.wakeSession) this.wakeSession.finalMessage = accumulatedContent || "达到最大工具调用轮数限制";
    return {
      content: accumulatedContent || "达到最大工具调用轮数限制",
      usage: totalUsage,
    };
  }

  /**
   * 群组工作唤醒防"只说不做"：成员以文本承诺/状态回复结束但未产出文件时，
   * 推回一条"立即调用 write-file 产出交付物"的指令并继续循环（上限 2 次）。
   * 仅对具备写文件能力的群组成员生效（host 等协调者无 write-file 工具，不受影响）。
   */
  private pushbackWorkCommitment(fullContent: string): boolean {
    if (this._pushbackCount >= 2) return false;
    if (!this.config.sessionId?.startsWith("group:")) return false;
    const hasWriteTool = this.config.tools?.some(t =>
      t.function.name === "write-file" || t.function.name === "edit-file");
    if (!hasWriteTool) return false;
    if (this._producedFile) return false;
    const trimmed = fullContent.trim();
    // 空响应（模型空输出）同样推回，避免静默 0 字符结束
    if (!trimmed) {
      this._pushbackCount++;
      log.info("Group work pushback %d/2: empty response, retrying with directive", this._pushbackCount);
      return true;
    }
    // 承诺/状态句式（"收到/开始/开写/马上/我先…"）或过短回复 → 疑似只说不做
    const commitment = /(收到|开始|动手|马上|立即|开写|正在做|稍等|我会|我来|这就|立刻|先看|先写|先做|先读|稍后|待会)/.test(trimmed);
    if (!commitment && trimmed.length >= 30) return false;
    this._pushbackCount++;
    log.info("Group work pushback %d/2: no file produced, retrying with directive", this._pushbackCount);
    return true;
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
