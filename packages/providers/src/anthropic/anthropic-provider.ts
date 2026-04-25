/**
 * Anthropic Claude Provider
 */
import Anthropic from "@anthropic-ai/sdk";
import type {
  ChatParams,
  ChatChunk,
  ModelInfo,
  ModelCapabilities,
  Message,
  ToolDefinition,
} from "@cobeing/shared";
import type { LLMProvider } from "../base/provider-interface.js";

/** Anthropic 模型目录 */
const MODEL_CATALOG: ModelInfo[] = [
  { id: "claude-opus-4-6", name: "Claude Opus 4.6", provider: "anthropic", contextWindow: 200000, maxOutput: 32000, supportsTools: true, supportsVision: true },
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", provider: "anthropic", contextWindow: 200000, maxOutput: 16000, supportsTools: true, supportsVision: true },
  { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", provider: "anthropic", contextWindow: 200000, maxOutput: 8192, supportsTools: true, supportsVision: true },
];

export class AnthropicProvider implements LLMProvider {
  readonly id = "anthropic";
  readonly name = "Anthropic";
  private client: Anthropic;

  constructor(apiKey?: string) {
    const key = apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!key) {
      throw new Error("ANTHROPIC_API_KEY is required");
    }
    this.client = new Anthropic({ apiKey: key });
  }

  async *chat(params: ChatParams): AsyncIterable<ChatChunk> {
    const { model, messages, tools, temperature, maxTokens } = params;

    const anthropicMessages = this.convertMessages(messages);
    const systemPrompt = this.extractSystem(messages);

    const stream = this.client.messages.stream({
      model,
      max_tokens: maxTokens ?? 4096,
      temperature: temperature ?? undefined,
      system: systemPrompt || undefined,
      messages: anthropicMessages,
      tools: tools ? this.convertTools(tools) : undefined,
    });

    let currentToolCall: { id: string; name: string; input: string } | null = null;

    for await (const event of stream) {
      if (event.type === "content_block_start") {
        if (event.content_block.type === "text") {
          // 文本块开始
        } else if (event.content_block.type === "tool_use") {
          currentToolCall = {
            id: event.content_block.id,
            name: event.content_block.name,
            input: "",
          };
        }
      } else if (event.type === "content_block_delta") {
        if (event.delta.type === "text_delta") {
          yield { type: "content", content: event.delta.text };
        } else if (event.delta.type === "input_json_delta" && currentToolCall) {
          currentToolCall.input += event.delta.partial_json;
        }
      } else if (event.type === "content_block_stop") {
        if (currentToolCall) {
          yield {
            type: "tool_call",
            toolCall: {
              id: currentToolCall.id,
              type: "function" as const,
              function: {
                name: currentToolCall.name,
                arguments: currentToolCall.input,
              },
            },
          };
          currentToolCall = null;
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
    return MODEL_CATALOG;
  }

  capabilities(model: string): ModelCapabilities {
    return {
      tools: true,
      vision: true,
      streaming: true,
      maxTokens: MODEL_CATALOG.find(m => m.id === model)?.maxOutput ?? 4096,
      contextWindow: 200000,
    };
  }

  /** 转换消息格式为 Anthropic 格式 */
  private convertMessages(messages: Message[]): Anthropic.MessageParam[] {
    return messages
      .filter(m => m.role !== "system")
      .map(m => {
        if (m.role === "tool") {
          return {
            role: "user" as const,
            content: [{
              type: "tool_result" as const,
              tool_use_id: m.toolCallId ?? "",
              content: m.content,
            }],
          };
        }
        if (m.role === "assistant" && m.toolCalls?.length) {
          return {
            role: "assistant" as const,
            content: m.toolCalls.map(tc => ({
              type: "tool_use" as const,
              id: tc.id,
              name: tc.function.name,
              input: JSON.parse(tc.function.arguments || "{}"),
            })),
          };
        }
        return {
          role: m.role as "user" | "assistant",
          content: m.content,
        };
      });
  }

  private extractSystem(messages: Message[]): string {
    return messages.filter(m => m.role === "system").map(m => m.content).join("\n");
  }

  private convertTools(tools: ToolDefinition[]): Anthropic.Tool[] {
    return tools.map(t => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters as Anthropic.Tool.InputSchema,
    }));
  }
}
