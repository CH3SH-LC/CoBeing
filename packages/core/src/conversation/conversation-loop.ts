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
}

export interface ConversationLoopEvents {
  onToken?: (token: string) => void;
  onToolCall?: (toolCall: ToolCall) => void;
  onToolResult?: (toolCallId: string, result: string) => void;
  onRoundComplete?: (round: number, response: string) => void;
}

export class ConversationLoop {
  private config: ConversationLoopConfig;
  private contextWindow: ContextWindow;
  private history: Message[] = [];
  private provider: LLMProvider;

  constructor(config: ConversationLoopConfig) {
    this.config = config;
    this.provider = config.provider;
    this.contextWindow = new ContextWindow(config.maxContextMessages ?? 100);
  }

  /**
   * 运行一轮对话
   * @returns 最终回复内容
   */
  async run(
    userInput: string,
    events?: ConversationLoopEvents,
  ): Promise<AgentResponse> {
    // 加入用户消息（非空时）
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
      const messages = this.contextWindow.trim([
        { role: "system", content: systemPrompt },
        ...this.history,
      ]);

      // 调用 LLM
      let fullContent = "";
      let fullReasoning = "";
      const toolCalls: ToolCall[] = [];

      for await (const chunk of this.provider.chat({
        model: this.config.agentConfig.model,
        messages,
        tools: this.config.tools,
      })) {
        if (chunk.type === "content" && chunk.content) {
          fullContent += chunk.content;
          events?.onToken?.(chunk.content);
        }
        if (chunk.type === "reasoning" && chunk.content) {
          fullReasoning += chunk.content;
        }
        if (chunk.type === "tool_call" && chunk.toolCall) {
          toolCalls.push(chunk.toolCall);
          events?.onToolCall?.(chunk.toolCall);
        }
      }

      // 没有工具调用 → 返回最终回复
      if (toolCalls.length === 0) {
        this.history.push({ role: "assistant", content: fullContent, reasoningContent: fullReasoning || undefined });
        events?.onRoundComplete?.(round, fullContent);
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
        }
        // 继续下一轮 LLM 调用
        continue;
      }

      // 无 ToolExecutor → 返回让外部处理
      return { content: fullContent, toolCalls, usage: totalUsage };
    }

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
