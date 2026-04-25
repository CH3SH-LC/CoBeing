/**
 * GeminiProvider — Google Gemini REST API 实现
 * 使用原生 fetch，不依赖 SDK
 */
import type { ChatParams, ChatChunk, Message, ToolCall, ToolDefinition, ModelInfo, ModelCapabilities } from "@cobeing/shared";
import type { LLMProvider } from "../base/provider-interface.js";
import { GEMINI_MODELS } from "./gemini-models.js";

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

export interface GeminiConfig {
  id?: string;
  name?: string;
  apiKey: string;
  models?: ModelInfo[];
}

// ---- 消息格式转换 ----

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

function toGeminiContents(messages: Message[]): { systemInstruction?: string; contents: GeminiContent[] } {
  let systemInstruction: string | undefined;
  const contents: GeminiContent[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      systemInstruction = (systemInstruction ? systemInstruction + "\n\n" : "") + msg.content;
      continue;
    }

    const role = msg.role === "assistant" ? "model" : "user";

    if (msg.role === "tool") {
      // Tool result → functionResponse part (in user role)
      contents.push({
        role: "user",
        parts: [{
          functionResponse: {
            name: msg.toolCallId ?? "unknown",
            response: { result: msg.content },
          },
        }],
      });
      continue;
    }

    if (msg.toolCalls && msg.toolCalls.length > 0) {
      // Assistant with tool calls → functionCall parts
      contents.push({
        role: "model",
        parts: msg.toolCalls.map(tc => ({
          functionCall: {
            name: tc.function.name,
            args: JSON.parse(tc.function.arguments || "{}"),
          },
        })),
      });
      continue;
    }

    // Regular text message
    // Merge consecutive same-role messages
    const last = contents[contents.length - 1];
    if (last && last.role === role && last.parts.length === 1 && last.parts[0].text) {
      last.parts[0].text += "\n" + msg.content;
    } else {
      contents.push({ role, parts: [{ text: msg.content }] });
    }
  }

  return { systemInstruction, contents };
}

function toGeminiTools(tools?: ToolDefinition[]): Array<{ functionDeclarations: Array<{ name: string; description: string; parameters?: Record<string, unknown> }> }> {
  if (!tools || tools.length === 0) return [];

  return [{
    functionDeclarations: tools.map(t => ({
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters as Record<string, unknown>,
    })),
  }];
}

function fromGeminiToolCall(fc: { name: string; args: Record<string, unknown> }): ToolCall {
  return {
    id: `gemini_tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: "function",
    function: {
      name: fc.name,
      arguments: JSON.stringify(fc.args),
    },
  };
}

// ---- Provider ----

export class GeminiProvider implements LLMProvider {
  readonly id: string;
  readonly name: string;
  private apiKey: string;
  private models: ModelInfo[];

  constructor(config: GeminiConfig) {
    this.id = config.id ?? "gemini";
    this.name = config.name ?? "Google Gemini";
    this.apiKey = config.apiKey;
    this.models = config.models ?? GEMINI_MODELS;
  }

  async *chat(params: ChatParams): AsyncIterable<ChatChunk> {
    const { systemInstruction, contents } = toGeminiContents(params.messages);
    const tools = toGeminiTools(params.tools);

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {},
    };
    if (systemInstruction) {
      body.systemInstruction = { parts: [{ text: systemInstruction }] };
    }
    if (tools.length > 0) {
      body.tools = tools;
    }
    if (params.temperature !== undefined) {
      (body.generationConfig as Record<string, unknown>).temperature = params.temperature;
    }
    if (params.maxTokens !== undefined) {
      (body.generationConfig as Record<string, unknown>).maxOutputTokens = params.maxTokens;
    }

    const url = `${BASE_URL}/models/${params.model}:streamGenerateContent?key=${this.apiKey}&alt=sse`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Gemini API error ${response.status}: ${text.slice(0, 500)}`);
    }

    if (!response.body) {
      throw new Error("Gemini: no response body");
    }

    // Parse SSE stream
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr || jsonStr === "[DONE]") continue;

          try {
            const data = JSON.parse(jsonStr);
            const candidate = data.candidates?.[0];
            if (!candidate) continue;

            const parts = candidate.content?.parts ?? [];
            for (const part of parts) {
              if (part.text) {
                yield { type: "content", content: part.text };
              }
              if (part.functionCall) {
                yield { type: "tool_call", toolCall: fromGeminiToolCall(part.functionCall) };
              }
            }
          } catch {
            // Skip malformed JSON chunks
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async chatComplete(params: ChatParams): Promise<string> {
    let result = "";
    for await (const chunk of this.chat(params)) {
      if (chunk.type === "content" && chunk.content) {
        result += chunk.content;
      }
    }
    return result;
  }

  async listModels(): Promise<ModelInfo[]> {
    return this.models;
  }

  capabilities(model: string): ModelCapabilities {
    const info = this.models.find(m => m.id === model);
    return {
      tools: info?.supportsTools ?? true,
      vision: info?.supportsVision ?? false,
      streaming: true,
      maxTokens: info?.maxOutput ?? 8192,
      contextWindow: info?.contextWindow ?? 1048576,
    };
  }
}
