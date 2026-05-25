/**
 * Tool Agent 基类 — 独立 LLM 工具循环
 *
 * 不依赖 Agent 类，直接用 Provider.chat() + ToolExecutor 循环。
 */
import type { LLMProvider } from "@cobeing/providers";
import type { Message, ToolCall, ToolResult } from "@cobeing/shared";
import { ToolRegistry } from "../../tools/registry.js";
import { ToolExecutor } from "../../tools/executor.js";
import { PermissionEnforcer } from "../../tools/permission.js";
import { createLogger } from "@cobeing/shared";
import type { ToolAgentConfig, ToolAgentResult } from "./types.js";

const log = createLogger("tool-agent");

/** 从 provider 的流式输出中收集完整响应和工具调用 */
async function collectResponse(
  provider: LLMProvider,
  model: string,
  messages: Message[],
  tools: Array<{ type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }>,
  abortSignal?: AbortSignal,
): Promise<{ content: string; toolCalls: ToolCall[] }> {
  let content = "";
  const toolCalls: ToolCall[] = [];
  const toolCallMap = new Map<number, ToolCall>();

  for await (const chunk of provider.chat({
    model,
    messages,
    tools: tools.length > 0 ? tools : undefined,
    temperature: 0.1,
    maxTokens: 2048,
    abortSignal,
  })) {
    if (chunk.type === "content" && chunk.content) {
      content += chunk.content;
    }
    if (chunk.type === "tool_call" && chunk.toolCall) {
      const tc = chunk.toolCall as ToolCall & { index?: number };
      if (tc.index !== undefined) {
        const existing = toolCallMap.get(tc.index);
        if (existing) {
          existing.function.name += tc.function.name;
          existing.function.arguments += tc.function.arguments;
        } else {
          toolCallMap.set(tc.index, { ...tc });
        }
      } else {
        toolCalls.push(tc);
      }
    }
  }

  if (toolCallMap.size > 0) {
    const merged = [...toolCallMap.values()].map(tc => ({
      ...tc,
      id: tc.id || `tool_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    }));
    toolCalls.push(...merged);
  }

  return { content: content.trim(), toolCalls };
}

/** 独立 LLM 工具循环 */
export async function runToolAgent(
  config: ToolAgentConfig,
  provider: LLMProvider,
  toolRegistry: ToolRegistry,
  workingDir: string,
  permissionMode?: string,
  sandboxConfig?: import("@cobeing/shared").SandboxConfig,
  sandboxRunner?: import("@cobeing/shared").SandboxRunner,
): Promise<ToolAgentResult> {
  const permission = new PermissionEnforcer(
    { mode: (permissionMode as any) ?? "workspace-write" },
    undefined,
    workingDir,
  );
  const executor = new ToolExecutor(
    toolRegistry,
    permission,
    undefined,
    sandboxConfig ?? { enabled: false, filesystem: "isolated", network: { enabled: true, mode: "all" } },
    sandboxRunner,
  );

  const messages: Message[] = [
    { role: "system", content: config.systemPrompt },
    { role: "user", content: config.userPrompt },
  ];

  const toolDefs = toolRegistry.listDefinitions();

  for (let round = 0; round < config.maxIterations; round++) {
    const { content, toolCalls } = await collectResponse(
      provider,
      config.model,
      messages,
      toolDefs,
      config.abortSignal,
    );

    if (config.abortSignal?.aborted) {
      return { success: false, output: "[已停止]" };
    }

    if (content) {
      const lastAssistant = messages.filter(m => m.role === "assistant").length > 0
        ? messages[messages.length - 1]
        : null;
      if (lastAssistant && lastAssistant.role === "assistant") {
        lastAssistant.content += content;
      } else {
        messages.push({ role: "assistant", content });
      }
    }

    if (toolCalls.length === 0) {
      // No tool calls, LLM is done
      const finalContent = messages.filter(m => m.role === "assistant").map(m => m.content).join("\n").trim();
      return { success: true, output: finalContent || content };
    }

    // Execute tool calls
    const lastMsg: Message = { role: "assistant", content: content || "", toolCalls };
    if (!content) {
      const emptyIdx = messages.findIndex(m => m.role === "assistant" && !m.content && !m.toolCalls);
      if (emptyIdx >= 0) messages[emptyIdx] = lastMsg;
      else messages.push(lastMsg);
    }

    for (const tc of toolCalls) {
      const result: ToolResult = await executor.execute(tc, config.parentAgentId, config.id, workingDir);
      messages.push({
        role: "tool",
        content: result.isError ? `Error: ${result.content}` : result.content,
        toolCallId: tc.id,
      });
    }
  }

  // Max iterations reached — return current state
  const finalContent = messages.filter(m => m.role === "assistant").map(m => m.content).join("\n").trim();
  return { success: true, output: finalContent };
}
