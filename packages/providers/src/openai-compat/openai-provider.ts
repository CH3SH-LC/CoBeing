/**
 * OpenAI 兼容 Provider — 适配所有 OpenAI API 格式的模型
 * 覆盖 OpenAI、DeepSeek、自定义 endpoint 等
 */
import type {
  ChatParams,
  ChatChunk,
  ModelInfo,
  ModelCapabilities,
  Message,
  ToolDefinition,
} from "@cobeing/shared";
import type { LLMProvider } from "../base/provider-interface.js";

export interface OpenAICompatConfig {
  id: string;
  name: string;
  apiKey: string;
  baseURL: string;
  models?: ModelInfo[];
}

export class OpenAICompatProvider implements LLMProvider {
  readonly id: string;
  readonly name: string;
  private apiKey: string;
  private baseURL: string;
  private modelCatalog: ModelInfo[];

  constructor(config: OpenAICompatConfig) {
    this.id = config.id;
    this.name = config.name;
    this.apiKey = config.apiKey;
    this.baseURL = config.baseURL;
    this.modelCatalog = config.models ?? [];
  }

  async *chat(params: ChatParams): AsyncIterable<ChatChunk> {
    const { model, messages, tools, temperature, maxTokens, thinkingEnabled, reasoningEffort } = params;

    const body: Record<string, unknown> = {
      model,
      messages: this.convertMessages(messages),
      stream: true,
    };

    // 思考模式下不设置 temperature / top_p（API 会忽略）
    if (!thinkingEnabled) {
      body.temperature = temperature ?? undefined;
    }

    body.max_tokens = maxTokens ?? 4096;

    // DeepSeek V4 思考模式参数
    if (thinkingEnabled) {
      body.thinking = { type: "enabled" };
      if (reasoningEffort) {
        body.reasoning_effort = reasoningEffort;
      }
    }

    if (tools?.length) {
      body.tools = this.convertTools(tools);
    }

    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenAI compat error ${response.status}: ${text}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";

    // 累积 tool_calls 分片
    const pendingToolCalls = new Map<number, { id: string; name: string; arguments: string }>();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === "data: [DONE]") continue;
        if (!trimmed.startsWith("data: ")) continue;

        try {
          const json = JSON.parse(trimmed.slice(6));
          const delta = json.choices?.[0]?.delta;
          if (!delta) continue;

          if (delta.content) {
            yield { type: "content", content: delta.content };
          }
          // DeepSeek V4 思考模式：reasoning_content
          if (delta.reasoning_content) {
            yield { type: "reasoning", content: delta.reasoning_content };
          }
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              const existing = pendingToolCalls.get(idx);
              if (tc.function?.name) {
                // 新 tool_call 的第一个分片（带 name）
                pendingToolCalls.set(idx, {
                  id: tc.id ?? existing?.id ?? "",
                  name: tc.function.name,
                  arguments: tc.function.arguments ?? "",
                });
              } else if (tc.function?.arguments && existing) {
                // 后续分片（只有 arguments 增量）
                existing.arguments += tc.function.arguments;
              } else if (tc.id && !existing) {
                // 只有 id 的分片
                pendingToolCalls.set(idx, { id: tc.id, name: "", arguments: "" });
              }
            }
          }

          // finish_reason 说明这一轮结束，输出完整的 tool_calls
          const finishReason = json.choices?.[0]?.finish_reason;
          if (finishReason === "tool_calls" || finishReason === "stop") {
            if (pendingToolCalls.size > 0) {
              for (const [, tc] of pendingToolCalls) {
                yield {
                  type: "tool_call",
                  toolCall: {
                    id: tc.id,
                    type: "function",
                    function: { name: tc.name, arguments: tc.arguments },
                  },
                };
              }
              pendingToolCalls.clear();
            }
          }
        } catch {
          // skip malformed JSON lines
        }
      }
    }

    yield { type: "done" };
  }

  async chatComplete(params: ChatParams): Promise<string> {
    let fullContent = "";
    for await (const chunk of this.chat(params)) {
      if (chunk.type === "content" && chunk.content) {
        fullContent += chunk.content;
      }
    }
    return fullContent;
  }

  async listModels(): Promise<ModelInfo[]> {
    if (this.modelCatalog.length) return this.modelCatalog;
    // 尝试从 /models 拉取
    try {
      const resp = await fetch(`${this.baseURL}/models`, {
        headers: { "Authorization": `Bearer ${this.apiKey}` },
      });
      if (resp.ok) {
        const json = await resp.json() as { data: { id: string }[] };
        return (json.data ?? []).map(m => ({
          id: m.id,
          name: m.id,
          provider: this.id,
          contextWindow: 128000,
          maxOutput: 4096,
          supportsTools: true,
          supportsVision: false,
        }));
      }
    } catch { /* ignore */ }
    return [];
  }

  capabilities(_model: string): ModelCapabilities {
    return {
      tools: true,
      vision: false,
      streaming: true,
      maxTokens: 4096,
      contextWindow: 128000,
    };
  }

  private convertMessages(messages: Message[]): Record<string, unknown>[] {
    return messages.map(m => {
      const base: Record<string, unknown> = { role: m.role, content: m.content };

      // assistant 消息带 tool_calls
      if (m.role === "assistant" && m.toolCalls?.length) {
        base.tool_calls = m.toolCalls.map(tc => ({
          id: tc.id,
          type: "function",
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments,
          },
        }));
      }

      // assistant 消息带 reasoning_content（DeepSeek 思考模式）
      if (m.role === "assistant" && m.reasoningContent) {
        base.reasoning_content = m.reasoningContent;
      }

      // tool 消息必须带 tool_call_id
      if (m.role === "tool" && m.toolCallId) {
        base.tool_call_id = m.toolCallId;
      }

      return base;
    });
  }

  private convertTools(tools: ToolDefinition[]): Record<string, unknown>[] {
    return tools.map(t => ({
      type: "function",
      function: t.function,
    }));
  }
}
