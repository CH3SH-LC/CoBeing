import { describe, it, expect } from "vitest";
import { ConversationLoop } from "./conversation-loop.js";
import type { LLMProvider } from "@cobeing/providers";

/**
 * 聚焦测试：会话工作目录（workingDir）缺失时的 fail-fast 行为。
 * 回归场景：workingDir 为 undefined 时绝不静默兜底 process.cwd()，
 * 否则 grep/glob 等无 path 参数的工具会从项目根全盘扫描导致 OOM。
 */

function stubProvider(toolCallName: string): LLMProvider {
  let rounds = 0;
  let secondRoundSeenBlocked = false;
  return {
    id: "stub",
    name: "stub",
    chat: async function* (params: { messages: Array<{ role: string; content?: string }> }) {
      rounds++;
      if (rounds === 1) {
        yield {
          type: "tool_call",
          toolCall: { id: "tc1", function: { name: toolCallName, arguments: "{}" } },
        };
      } else {
        // 第二轮：检查模型是否看到了工具拒绝信息
        const toolMsgs = (params.messages || []).filter(m => m.role === "tool");
        secondRoundSeenBlocked = toolMsgs.some(m => String(m.content || "").includes("工作目录未配置"));
        yield { type: "content", content: secondRoundSeenBlocked ? "blocked-ok" : "done" };
      }
    },
    listModels: async () => [],
    __secondRoundSeenBlocked: () => secondRoundSeenBlocked,
  } as unknown as LLMProvider;
}

function makeLoop(overrides: { workingDir?: string } = {}) {
  let executed = false;
  let receivedWorkingDir: string | undefined;
  const provider = stubProvider("read-file");
  const loop = new ConversationLoop({
    agentConfig: { name: "t", role: "", systemPrompt: "test", model: "m" },
    provider,
    sessionId: "s1",
    workingDir: overrides.workingDir,
    toolExecutor: {
      execute: async (_tc: unknown, _agentId: string, _sessionId: string, workingDir: string) => {
        executed = true;
        receivedWorkingDir = workingDir;
        return { toolCallId: "tc1", content: "ok" };
      },
    } as never,
  });
  return { loop, getExecuted: () => executed, getReceivedWorkingDir: () => receivedWorkingDir, getProvider: () => provider as unknown as { __secondRoundSeenBlocked: () => boolean } };
}

describe("ConversationLoop workingDir fail-fast", () => {
  it("workingDir 缺失时不执行工具，模型收到明确拒绝信息", async () => {
    const { loop, getExecuted, getProvider } = makeLoop({ workingDir: undefined });
    await loop.run("hello");
    expect(getExecuted()).toBe(false); // 工具未被执行
    expect(getProvider().__secondRoundSeenBlocked()).toBe(true); // 模型收到了拒绝信息
  });

  it("workingDir 正常时工具正常执行并透传工作目录", async () => {
    const { loop, getExecuted, getReceivedWorkingDir, getProvider } = makeLoop({ workingDir: "/tmp/ws" });
    await loop.run("hello");
    expect(getExecuted()).toBe(true);
    expect(getReceivedWorkingDir()).toBe("/tmp/ws");
    expect(getProvider().__secondRoundSeenBlocked()).toBe(false);
  });
});

describe("ConversationLoop 预算熔断（决策 #5）", () => {
  function usageProvider(usagePerRound: { inputTokens: number; outputTokens: number }): LLMProvider {
    return {
      id: "usage-stub",
      name: "usage-stub",
      chat: async function* () {
        yield { type: "usage", usage: usagePerRound };
        yield { type: "content", content: "hi" };
      },
      listModels: async () => [],
    } as unknown as LLMProvider;
  }

  it("超过 maxTotalTokens 时中断并返回预算超限提示", async () => {
    const loop = new ConversationLoop({
      agentConfig: { name: "t", role: "", systemPrompt: "test", model: "m" },
      provider: usageProvider({ inputTokens: 3000, outputTokens: 3000 }),
      sessionId: "budget1",
      workingDir: "/tmp/ws",
      maxTotalTokens: 5000, // 第一轮 6000 > 5000 → 中断
    });
    const resp = await loop.run("hello");
    expect(resp.content).toContain("[预算超限]");
  });

  it("未超限时正常返回最终回复", async () => {
    const loop = new ConversationLoop({
      agentConfig: { name: "t", role: "", systemPrompt: "test", model: "m" },
      provider: usageProvider({ inputTokens: 3000, outputTokens: 3000 }),
      sessionId: "budget2",
      workingDir: "/tmp/ws",
      maxTotalTokens: 20000,
    });
    const resp = await loop.run("hello");
    expect(resp.content).toBe("hi");
    expect(resp.usage.inputTokens).toBe(3000);
  });
});
