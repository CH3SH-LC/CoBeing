import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runToolAgent } from "./base.js";
import { loadToolAgentSpec } from "./spec.js";
import { runJudgmentAgent } from "./judgment.js";
import { parseReviewOutput } from "./review.js";
import { runMemoryAgent } from "./memory.js";
import { runGroupCreator } from "./creator.js";
import { ToolRegistry } from "../../tools/registry.js";
import type { ToolAgentConfig, ToolAgentType } from "./types.js";
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

describe("ToolAgent spec", () => {
  it("treats creator as a ToolAgent type", () => {
    const type: ToolAgentType = "creator";
    expect(type).toBe("creator");
  });

  it("loads a unified ToolAgentSpec with defaults from data files", () => {
    const root = path.join(tmpDir, "toolagents");
    const creatorDir = path.join(root, "creator");
    fs.mkdirSync(creatorDir, { recursive: true });
    fs.writeFileSync(path.join(creatorDir, "config.json"), JSON.stringify({
      model: "deepseek-chat",
      maxIterations: 2,
    }), "utf-8");
    fs.writeFileSync(path.join(creatorDir, "prompt.md"), "创建资源草案", "utf-8");

    const spec = loadToolAgentSpec("creator", root);

    expect(spec).toMatchObject({
      type: "creator",
      name: "creator",
      purpose: "创建资源草案",
      trigger: "manual",
      maxIterations: 2,
      visibility: "hidden",
      writePolicy: "caller_applies",
      failurePolicy: "escalate",
    });
    expect(spec.systemPrompt).toBe("创建资源草案");
  });
});

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

  it("parses personal memory updates separately from experience entries", async () => {
    const provider = mockProvider([
      textChunk(JSON.stringify({
        entries: [
          { category: "用户偏好", summary: "用户希望输出更短" },
        ],
        memoryUpdates: [
          {
            target: "MEMORY.md",
            operation: "append",
            reason: "稳定用户偏好",
            content: "用户偏好：回复保持简洁。",
            sensitivity: "low",
          },
        ],
        warnings: ["不写入群组私密内容"],
      })),
    ]);
    const result = await runMemoryAgent(
      "personal",
      {
        agentName: "Test",
        agentId: "agent-1",
        trace: {
          thinking: ["用户要求简洁"],
          toolCalls: [],
          finalMessage: "收到，我会保持简洁。",
        },
        taskContext: "用户反馈",
      },
      provider,
      "test-model",
      tmpDir,
    );
    expect(result.entries).toHaveLength(1);
    expect(result.memoryUpdates).toEqual([
      {
        target: "MEMORY.md",
        operation: "append",
        reason: "稳定用户偏好",
        content: "用户偏好：回复保持简洁。",
        sensitivity: "low",
      },
    ]);
    expect(result.warnings).toEqual(["不写入群组私密内容"]);
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

  it("记忆纪律：normalizes ttl/provenance and defaults missing ones (决策 #6 / spec #3)", async () => {
    const provider = mockProvider([
      textChunk(JSON.stringify({
        entries: [
          { category: "错误教训", summary: "不要直接删 data 目录", ttl: "P0" },
          { category: "工具发现", summary: "chcp 65001 可解乱码", detail: "Windows 下" },
        ],
      })),
    ]);
    const result = await runMemoryAgent(
      "personal",
      {
        agentName: "Test", agentId: "agent-1",
        trace: { thinking: [], toolCalls: [], finalMessage: "" }, taskContext: "x",
      },
      provider, "test-model", tmpDir,
    );
    expect(result.entries).toHaveLength(2);
    // P0 保留显式值；缺失 ttl 默认 P1
    expect(result.entries[0].ttl).toBe("P0");
    expect(result.entries[1].ttl).toBe("P1");
    // provenance 缺省补执行者 agentId
    expect(result.entries[0].provenance).toBe("agent-1");
    expect(result.entries[1].provenance).toBe("agent-1");
  });

  it("记忆纪律：filters entries without summary", async () => {
    const provider = mockProvider([
      textChunk(JSON.stringify({
        entries: [
          { category: "经验", summary: "" },
          { category: "有效模式", summary: "分批提交更稳", ttl: "P1" },
        ],
      })),
    ]);
    const result = await runMemoryAgent(
      "personal",
      { agentName: "Test", agentId: "a", trace: { thinking: [], toolCalls: [], finalMessage: "" }, taskContext: "x" },
      provider, "test-model", tmpDir,
    );
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].summary).toBe("分批提交更稳");
  });
});

// ---- creator.ts tests ----

describe("runGroupCreator", () => {
  it("parses group GUIDE, member suggestions, and initial tasks", async () => {
    const provider = mockProvider([
      textChunk(JSON.stringify({
        guide: "# 研究小组规则\n\n先澄清目标，再分工。",
        memberSuggestions: [
          { role: "资料检索", reason: "需要查证来源" },
        ],
        initialTasks: [
          { title: "澄清研究范围", assigneeHint: "host", acceptance: "形成范围清单" },
        ],
        plan: "## 阶段计划\n\n1. 澄清范围\n2. 收集资料",
        userConfirmations: ["是否需要联网检索？"],
      })),
    ]);

    const result = await runGroupCreator(provider, "test-model", {
      name: "研究小组",
      topic: "整理旅行方案",
      members: [
        { id: "host", name: "群主", role: "协调" },
        { id: "researcher", name: "研究员", role: "资料检索" },
      ],
    });

    expect(result.guide).toContain("研究小组规则");
    expect(result.memberSuggestions).toHaveLength(1);
    expect(result.initialTasks[0]).toMatchObject({
      title: "澄清研究范围",
      assigneeHint: "host",
    });
    expect(result.plan).toContain("阶段计划");
    expect(result.userConfirmations).toEqual(["是否需要联网检索？"]);
  });
});
