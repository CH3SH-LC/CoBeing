import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runToolAgent } from "./base.js";
import { runJudgmentAgent } from "./judgment.js";
import { parseReviewOutput } from "./review.js";
import { runMemoryAgent } from "./memory.js";
import { ToolRegistry } from "../../tools/registry.js";
import type { ToolAgentConfig } from "./types.js";
import type { LLMProvider } from "@cobeing/providers";
import type { ChatChunk, ChatParams } from "@cobeing/shared";
import { bashTool } from "../../tools/bash.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cobeing-tool-agent-"));
});

afterEach(() => {
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

function mockProvider(responses: Array<AsyncIterable<ChatChunk>>): LLMProvider {
  let call = 0;
  return {
    id: "mock",
    name: "Mock",
    chat(_params: ChatParams): AsyncIterable<ChatChunk> {
      const chunks = responses[call] ?? responses[responses.length - 1];
      call++;
      return chunks;
    },
    chatComplete: async () => "",
    listModels: async () => [],
    capabilities: () => ({} as any),
  };
}

async function* textChunk(text: string): AsyncIterable<ChatChunk> {
  yield { type: "content", content: text } as ChatChunk;
  yield { type: "done" } as ChatChunk;
}

// ---- base.ts tests ----

describe("runToolAgent", () => {
  it("returns LLM text output when no tool calls", async () => {
    const provider = mockProvider([textChunk("任务已完成。")]);
    const registry = new ToolRegistry();

    const config: ToolAgentConfig = {
      id: "test-1",
      type: "review",
      parentAgentId: "agent-1",
      model: "test-model",
      maxIterations: 3,
      tools: [],
      systemPrompt: "你是测试助手。",
      userPrompt: "执行测试。",
      workingDir: tmpDir,
    };

    const result = await runToolAgent(config, provider, registry, tmpDir);
    expect(result.success).toBe(true);
    expect(result.output).toContain("任务已完成");
  });

  it("executes tools and returns final response", async () => {
    const provider = mockProvider([
      (async function* () {
        yield {
          type: "tool_call",
          toolCall: {
            id: "tc1",
            type: "function",
            function: { name: "bash", arguments: JSON.stringify({ command: "echo hello" }) },
          },
        } as ChatChunk;
        yield { type: "done" } as ChatChunk;
      })(),
      textChunk("命令执行成功，输出是 hello。"),
    ]);

    const registry = new ToolRegistry();
    registry.register(bashTool);

    const config: ToolAgentConfig = {
      id: "test-2",
      type: "clone",
      parentAgentId: "agent-1",
      model: "test-model",
      maxIterations: 3,
      tools: ["bash"],
      systemPrompt: "你是测试助手。",
      userPrompt: "执行测试。",
      workingDir: tmpDir,
    };

    const result = await runToolAgent(config, provider, registry, tmpDir);
    expect(result.success).toBe(true);
    expect(result.output).toContain("hello");
  });

  it("stops at maxIterations", async () => {
    const provider = mockProvider([
      (async function* () {
        yield {
          type: "tool_call",
          toolCall: {
            id: "tc_loop",
            type: "function",
            function: { name: "bash", arguments: JSON.stringify({ command: "echo x" }) },
          },
        } as ChatChunk;
        yield { type: "done" } as ChatChunk;
      })(),
    ]);

    const registry = new ToolRegistry();
    registry.register(bashTool);

    const config: ToolAgentConfig = {
      id: "test-3",
      type: "clone",
      parentAgentId: "agent-1",
      model: "test-model",
      maxIterations: 2,
      tools: ["bash"],
      systemPrompt: "你是测试助手。",
      userPrompt: "执行测试。",
      workingDir: tmpDir,
    };

    const result = await runToolAgent(config, provider, registry, tmpDir);
    expect(result.success).toBe(true);
  });

  it("returns aborted message when signal is set", async () => {
    const provider = mockProvider([textChunk("任务进行中...")]);
    const registry = new ToolRegistry();
    const controller = new AbortController();
    controller.abort(); // Abort before calling

    const config: ToolAgentConfig = {
      id: "test-4",
      type: "review",
      parentAgentId: "agent-1",
      model: "test-model",
      maxIterations: 3,
      tools: [],
      systemPrompt: "你是测试助手。",
      userPrompt: "执行测试。",
      workingDir: tmpDir,
      abortSignal: controller.signal,
    };

    const result = await runToolAgent(config, provider, registry, tmpDir);
    expect(result.success).toBe(false);
    expect(result.output).toBe("[已停止 — 超时或取消]");
  });
});

// ---- judgment.ts tests ----

describe("runJudgmentAgent", () => {
  it("returns wake_host=true on timeout", async () => {
    const provider: LLMProvider = {
      id: "slow",
      name: "Slow",
      chat(_params: ChatParams): AsyncIterable<ChatChunk> {
        // noinspection TypeScriptValidateJSTypes
        return (async function* () {
          // Wait for the abort signal before yielding anything
          await new Promise<void>((resolve) => {
            if (_params.abortSignal?.aborted) {
              resolve();
            } else {
              _params.abortSignal?.addEventListener("abort", () => resolve(), { once: true });
            }
          });
          yield { type: "done" } as ChatChunk;
        })();
      },
      chatComplete: async () => "",
      listModels: async () => [],
      capabilities: () => ({} as any),
    };

    const result = await runJudgmentAgent(
      {
        targetMessage: "测试消息",
        fromAgentId: "agent-1",
        fromAgentName: "Test",
        recentMessages: [],
        hostName: "Host",
        groupName: "TestGroup",
      },
      provider,
      "test-model",
      "parent-1",
      tmpDir,
      100,
    );

    expect(result.wake_host).toBe(true);
  });

  it("parses wake_host=false correctly", async () => {
    const provider = mockProvider([
      textChunk('{"wake_host": false, "reason": "例行进度更新", "urgency": "low"}'),
    ]);

    const result = await runJudgmentAgent(
      {
        targetMessage: "完成了 TASK-1",
        fromAgentId: "agent-1",
        fromAgentName: "Worker",
        recentMessages: [],
        hostName: "Host",
        groupName: "TestGroup",
      },
      provider,
      "test-model",
      "parent-1",
      tmpDir,
    );

    expect(result.wake_host).toBe(false);
    expect(result.reason).toBe("例行进度更新");
  });

  it("defaults to wake_host=true on unparseable output", async () => {
    const provider = mockProvider([textChunk("not json at all")]);
    const result = await runJudgmentAgent(
      {
        targetMessage: "test", fromAgentId: "a", fromAgentName: "A",
        recentMessages: [], hostName: "H", groupName: "G",
      },
      provider, "test-model", "parent-1", tmpDir,
    );
    expect(result.wake_host).toBe(true);
  });
});

// ---- review.ts tests ----

describe("parseReviewOutput", () => {
  it("returns pass=true for valid JSON", () => {
    const result = parseReviewOutput('{"pass": true, "reason": "工作内容充实"}');
    expect(result.pass).toBe(true);
  });

  it("returns pass=false for valid JSON with pass=false", () => {
    const result = parseReviewOutput('{"pass": false, "reason": "只说不做"}');
    expect(result.pass).toBe(false);
  });

  it("returns pass=true on parse failure", () => {
    const result = parseReviewOutput("不是 JSON");
    expect(result.pass).toBe(true);
  });

  it("extracts JSON from text with surrounding content", () => {
    const result = parseReviewOutput('分析完毕。\n{"pass": true, "reason": "ok"}\n以上是结果。');
    expect(result.pass).toBe(true);
  });
});

// ---- memory.ts tests ----

describe("runMemoryAgent", () => {
  it("returns empty entries for 'Nothing to save'", async () => {
    const provider = mockProvider([textChunk("Nothing to save.")]);
    const result = await runMemoryAgent(
      "personal",
      {
        agentName: "Test",
        agentId: "agent-1",
        trace: { thinking: [], toolCalls: [], finalMessage: "" },
        taskContext: "test",
      },
      provider,
      "test-model",
      tmpDir,
    );
    expect(result.entries).toEqual([]);
  });

  it("parses personal memory entries", async () => {
    const provider = mockProvider([
      textChunk(JSON.stringify([
        { category: "工具发现", summary: "bash 在 Windows 上需 chcp 65001", detail: "避免中文乱码" },
      ])),
    ]);
    const result = await runMemoryAgent(
      "personal",
      {
        agentName: "Test",
        agentId: "agent-1",
        trace: {
          thinking: ["需要执行命令"],
          toolCalls: [{ tool: "bash", args: { command: "dir" }, result: "中文乱码" }],
          finalMessage: "执行完成",
        },
        taskContext: "测试 bash 命令",
      },
      provider,
      "test-model",
      tmpDir,
    );
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].category).toBe("工具发现");
  });

  it("parses group memory with interface updates", async () => {
    const provider = mockProvider([
      textChunk(JSON.stringify({
        entries: [{ category: "协作模式", summary: "并行改同一文件需约定顺序" }],
        interfaceUpdates: [{ agentId: "agent-1", section: "API", entry: "提供 /search 接口" }],
      })),
    ]);
    const result = await runMemoryAgent(
      "group",
      {
        groupName: "TestGroup",
        groupId: "g1",
        phasePlan: "Phase 1",
        progressMd: "完成 Phase 1",
        interfaceMd: "## agent-1",
        memberContributions: ["agent-1: 完成搜索模块"],
      },
      provider,
      "test-model",
      tmpDir,
    );
    expect(result.entries).toHaveLength(1);
    expect(result.interfaceUpdates).toHaveLength(1);
  });

  it("returns empty entries on parse failure", async () => {
    const provider = mockProvider([textChunk("gibberish {{")]);
    const result = await runMemoryAgent(
      "personal",
      {
        agentName: "Test", agentId: "a", trace: { thinking: [], toolCalls: [], finalMessage: "" }, taskContext: "x",
      },
      provider, "test-model", tmpDir,
    );
    expect(result.entries).toEqual([]);
  });
});
