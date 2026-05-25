# HostAgent 增强 + 本地模型过滤层 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 增强群主沟通协作能力，引入本地小模型过滤层，实现群主与 TODO 全流程联动

**Architecture:** 本地模型（node-llama-cpp + Qwen 3.5 2B GGUF）作为 WakeSystem 的过滤层，对每条群消息判断是否唤醒群主。群主获得 6 个新工具实现讨论引导、任务拆解、TODO 管理等能力。群主拥有独立的 data/host/ 目录。

**Tech Stack:** TypeScript, node-llama-cpp, GGUF, Vitest

---

## 文件结构

### 新建文件

| 文件 | 职责 |
|------|------|
| `packages/core/src/group/local-filter.ts` | LocalFilterEngine — 本地模型加载 + 过滤推理 |
| `packages/core/src/group/local-filter.test.ts` | LocalFilterEngine 单元测试 |
| `packages/core/src/group/host-tools.ts` | 群主专属工具（6 个 host-* 工具） |
| `packages/core/src/group/host-tools.test.ts` | 群主工具单元测试 |
| `packages/core/src/group/filter-prompt.ts` | 过滤层 prompt 模板（硬编码） |
| `scripts/convert-to-gguf.sh` | safetensors → GGUF 转换脚本 |

### 修改文件

| 文件 | 改动 |
|------|------|
| `packages/core/src/group/wake-system.ts` | 新增 localFilter + ownerId，消息到达时异步评估 |
| `packages/core/src/group/group.ts` | 新增 getOwnerId()，传递 owner 信息给 WakeSystem |
| `packages/core/src/runtime.ts` | 初始化 LocalFilterEngine，注册 host 专属工具 |
| `packages/core/src/config/schema.ts` | 新增 localModel 配置字段 |
| `packages/shared/src/types.ts` | 新增 FilterResult 类型 |
| `packages/core/src/index.ts` | 导出新模块 |
| `config/default.json` | 新增 localModel 配置段 |
| `STRUCTURE.md` | 更新文件结构文档 |

---

### Task 1: 类型定义 + 过滤 Prompt

**Files:**
- Modify: `packages/shared/src/types.ts`
- Create: `packages/core/src/group/filter-prompt.ts`
- Create: `packages/core/src/group/filter-prompt.test.ts`

- [ ] **Step 1: 在 shared/types.ts 新增 FilterResult 类型**

在文件末尾 `SandboxRunner` 接口之后添加：

```typescript
// ============================================================
// 本地过滤层类型
// ============================================================

export interface FilterResult {
  shouldWake: boolean;
  reason: string;
  summary?: string;
  priority: "high" | "normal" | "low";
}

export interface LocalModelConfig {
  enabled: boolean;
  path: string;
  contextSize?: number;
  filterDebounceMs?: number;
}
```

- [ ] **Step 2: 创建 filter-prompt.ts**

```typescript
// packages/core/src/group/filter-prompt.ts

/** 过滤层 system prompt — 硬编码，告诉本地模型做什么 */
export const FILTER_SYSTEM_PROMPT = `你是群组协调助手。你的任务是分析群聊消息，判断是否需要群主介入。

判断准则：
- 有新问题或新需求 → shouldWake: true
- 有人表达困惑或求助 → shouldWake: true
- 出现观点分歧需要决策 → shouldWake: true
- 有重要进展需要确认 → shouldWake: true
- 不确定时一律选 shouldWake: true（宁可多叫不漏叫）
- 成员之间的简单回复、闲聊、已明确的执行中任务 → shouldWake: false

你必须以 JSON 格式回复，不要输出任何其他内容。`;

/** 构建用户 prompt：将最近消息格式化给模型 */
export function buildFilterUserPrompt(
  groupId: string,
  messages: Array<{ fromAgentId: string; content: string; timestamp: number }>,
): string {
  const lines = messages.map(m => {
    const time = new Date(m.timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    return `[${time}] ${m.fromAgentId}: ${m.content}`;
  });

  return `群组 ${groupId} 的最近消息：

${lines.join("\n")}

请判断是否需要群主介入。以 JSON 格式回复：
{"shouldWake": boolean, "reason": "原因", "summary": "摘要", "priority": "high|normal|low"}`;
}

/** JSON grammar 定义 — 强制模型输出符合格式的 JSON */
export const FILTER_JSON_GRAMMAR = `
root   ::= object
object ::= "{" ws pair ("," ws pair)* "}"
pair   ::= key ":" ws value
key    ::= "\"shouldWake\"" | "\"reason\"" | "\"summary\"" | "\"priority\""
value  ::= boolean | string | null
boolean ::= "true" | "false"
string  ::= "\"" [^"]* "\""
null    ::= "null"
ws     ::= [ \\t\\n]*
`;
```

- [ ] **Step 3: 创建 filter-prompt.test.ts**

```typescript
// packages/core/src/group/filter-prompt.test.ts
import { describe, it, expect } from "vitest";
import { buildFilterUserPrompt, FILTER_SYSTEM_PROMPT, FILTER_JSON_GRAMMAR } from "./filter-prompt.js";

describe("filter-prompt", () => {
  it("buildFilterUserPrompt formats messages correctly", () => {
    const messages = [
      { fromAgentId: "alice", content: "大家觉得这个方案怎么样？", timestamp: 1714000000000 },
      { fromAgentId: "bob", content: "我觉得可以", timestamp: 1714000060000 },
    ];
    const prompt = buildFilterUserPrompt("test-group", messages);

    expect(prompt).toContain("群组 test-group");
    expect(prompt).toContain("alice: 大家觉得这个方案怎么样？");
    expect(prompt).toContain("bob: 我觉得可以");
    expect(prompt).toContain("shouldWake");
  });

  it("FILTER_SYSTEM_PROMPT contains key instructions", () => {
    expect(FILTER_SYSTEM_PROMPT).toContain("不确定时一律选 shouldWake: true");
    expect(FILTER_SYSTEM_PROMPT).toContain("JSON");
  });

  it("FILTER_JSON_GRAMMAR defines valid structure", () => {
    expect(FILTER_JSON_GRAMMAR).toContain("shouldWake");
    expect(FILTER_JSON_GRAMMAR).toContain("boolean");
  });
});
```

- [ ] **Step 4: 运行测试**

Run: `cd D:/agent-codes/CoBeing && pnpm vitest run packages/core/src/group/filter-prompt.test.ts`
Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/types.ts packages/core/src/group/filter-prompt.ts packages/core/src/group/filter-prompt.test.ts
git commit -m "feat(host): add FilterResult type and filter prompt template"
```

---

### Task 2: LocalFilterEngine 核心实现

**Files:**
- Create: `packages/core/src/group/local-filter.ts`
- Create: `packages/core/src/group/local-filter.test.ts`

- [ ] **Step 1: 安装 node-llama-cpp**

Run: `cd D:/agent-codes/CoBeing && pnpm add node-llama-cpp -w`

如果编译失败（Windows 环境），降级方案：创建 `LocalFilterEngine` 接口，`init()` 时检测 node-llama-cpp 是否可用，不可用则标记为 disabled。

- [ ] **Step 2: 创建 local-filter.test.ts**

```typescript
// packages/core/src/group/local-filter.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { LocalFilterEngine } from "./local-filter.js";
import type { GroupMessageV2 } from "./group-context-v2.js";

describe("LocalFilterEngine", () => {
  let engine: LocalFilterEngine;

  beforeEach(() => {
    engine = new LocalFilterEngine();
  });

  it("starts disabled when model not loaded", () => {
    expect(engine.isEnabled()).toBe(false);
  });

  it("evaluate returns default wake result when disabled", async () => {
    const messages: GroupMessageV2[] = [
      { id: "1", fromAgentId: "alice", content: "test", tag: "main", timestamp: Date.now(), mentions: [] },
    ];
    const result = await engine.evaluate("test-group", messages);
    expect(result.shouldWake).toBe(true); // disabled → always wake
    expect(result.priority).toBe("normal");
  });

  it("parseFilterResult parses valid JSON", () => {
    const json = '{"shouldWake": true, "reason": "有新问题", "summary": "讨论方案", "priority": "high"}';
    const result = (engine as any).parseFilterResult(json);
    expect(result.shouldWake).toBe(true);
    expect(result.reason).toBe("有新问题");
    expect(result.priority).toBe("high");
  });

  it("parseFilterResult handles invalid JSON gracefully", () => {
    const result = (engine as any).parseFilterResult("not json");
    expect(result.shouldWake).toBe(true); // fallback: always wake
    expect(result.priority).toBe("normal");
  });

  it("parseFilterResult handles partial JSON", () => {
    const json = '{"shouldWake": false}';
    const result = (engine as any).parseFilterResult(json);
    expect(result.shouldWake).toBe(false);
    expect(result.reason).toBe("");
  });

  it("dispose does not throw when not initialized", () => {
    expect(() => engine.dispose()).not.toThrow();
  });
});
```

- [ ] **Step 3: 运行测试验证失败**

Run: `cd D:/agent-codes/CoBeing && pnpm vitest run packages/core/src/group/local-filter.test.ts`
Expected: FAIL — `LocalFilterEngine` not found

- [ ] **Step 4: 实现 LocalFilterEngine**

```typescript
// packages/core/src/group/local-filter.ts
import { createLogger } from "@cobeing/shared";
import type { FilterResult } from "@cobeing/shared";
import type { GroupMessageV2 } from "./group-context-v2.js";
import { FILTER_SYSTEM_PROMPT, buildFilterUserPrompt, FILTER_JSON_GRAMMAR } from "./filter-prompt.js";

const log = createLogger("local-filter");

export class LocalFilterEngine {
  private model: any = null;
  private context: any = null;
  private _enabled = false;
  private evaluateTimeoutMs = 2000;

  isEnabled(): boolean {
    return this._enabled;
  }

  /** 初始化模型（加载 GGUF 文件） */
  async init(modelPath: string, contextSize = 8192): Promise<void> {
    try {
      const { getLlama, LlamaChatSession } = await import("node-llama-cpp");
      const llama = await getLlama();
      const model = await llama.loadModel({ modelPath });
      const context = await model.createContext({ contextSize });
      this.model = model;
      this.context = context;
      this._enabled = true;
      log.info("LocalFilterEngine initialized: %s (context=%d)", modelPath, contextSize);
    } catch (err: any) {
      log.warn("LocalFilterEngine init failed (will use fallback): %s", err.message);
      this._enabled = false;
    }
  }

  /** 评估群消息，返回过滤结果 */
  async evaluate(groupId: string, messages: GroupMessageV2[]): Promise<FilterResult> {
    // 未启用 → 默认唤醒
    if (!this._enabled || !this.model || !this.context) {
      return { shouldWake: true, reason: "本地过滤未启用", priority: "normal" };
    }

    try {
      const prompt = buildFilterUserPrompt(
        groupId,
        messages.map(m => ({
          fromAgentId: m.fromAgentId,
          content: m.content.slice(0, 500), // 截断长消息
          timestamp: m.timestamp,
        })),
      );

      const fullPrompt = `${FILTER_SYSTEM_PROMPT}\n\n${prompt}`;

      // 使用 node-llama-cpp 推理
      const { LlamaChatSession } = await import("node-llama-cpp");
      const session = new LlamaChatSession({
        contextSequence: this.context.getSequence(),
      });

      const response = await session.prompt(fullPrompt, {
        grammar: await this.context.createGrammar(FILTER_JSON_GRAMMAR),
        maxTokens: 256,
      });

      return this.parseFilterResult(response);
    } catch (err: any) {
      log.warn("LocalFilterEngine evaluate failed: %s", err.message);
      return { shouldWake: true, reason: "过滤推理失败，默认唤醒", priority: "normal" };
    }
  }

  /** 解析模型输出为 FilterResult */
  private parseFilterResult(raw: string): FilterResult {
    try {
      // 提取 JSON 部分（模型可能输出额外文本）
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return { shouldWake: true, reason: "无法解析过滤结果", priority: "normal" };
      }

      const parsed = JSON.parse(jsonMatch[0]);

      return {
        shouldWake: parsed.shouldWake !== false, // 默认 true
        reason: typeof parsed.reason === "string" ? parsed.reason : "",
        summary: typeof parsed.summary === "string" ? parsed.summary : undefined,
        priority: ["high", "normal", "low"].includes(parsed.priority) ? parsed.priority : "normal",
      };
    } catch {
      return { shouldWake: true, reason: "JSON 解析失败", priority: "normal" };
    }
  }

  /** 释放模型资源 */
  dispose(): void {
    try {
      this.context?.dispose();
      this.model?.dispose();
    } catch { /* ignore */ }
    this.context = null;
    this.model = null;
    this._enabled = false;
    log.info("LocalFilterEngine disposed");
  }
}
```

- [ ] **Step 5: 运行测试验证通过**

Run: `cd D:/agent-codes/CoBeing && pnpm vitest run packages/core/src/group/local-filter.test.ts`
Expected: 6 tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/group/local-filter.ts packages/core/src/group/local-filter.test.ts packages/core/package.json
git commit -m "feat(host): add LocalFilterEngine with node-llama-cpp integration"
```

---

### Task 3: WakeSystem 改造 — 接入过滤层

**Files:**
- Modify: `packages/core/src/group/wake-system.ts`
- Modify: `packages/core/src/group/group.ts`

- [ ] **Step 1: 修改 WakeSystem 构造函数，新增 localFilter 和 ownerId**

在 `WakeSystemConfig` 接口中新增：

```typescript
export interface WakeSystemConfig {
  wakeDelayMs?: number;
  ownerId?: string;           // 新增：群主 agent ID
}
```

在 `WakeSystem` 类中新增字段：

```typescript
private ownerId?: string;
private localFilter?: import("./local-filter.js").LocalFilterEngine;
```

构造函数中初始化：

```typescript
this.ownerId = config?.ownerId;
```

- [ ] **Step 2: 新增 setLocalFilter 方法**

```typescript
/** 注入本地过滤引擎 */
setLocalFilter(filter: import("./local-filter.js").LocalFilterEngine): void {
  this.localFilter = filter;
}
```

- [ ] **Step 3: 修改 handleNewMessage，新增过滤路径**

在现有 @mention 扫描之后，`processQueue()` 调用之前，添加：

```typescript
// 本地过滤：判断是否唤醒群主
if (this.localFilter?.isEnabled() && this.ownerId && msg.fromAgentId !== this.ownerId) {
  this.evaluateForOwner(msg).catch(err =>
    log.warn("[%s] Owner filter evaluation failed: %s", this.ctx.groupId, err.message),
  );
}
```

- [ ] **Step 4: 新增 evaluateForOwner 方法**

```typescript
/** 异步评估是否唤醒群主 */
private async evaluateForOwner(msg: GroupMessageV2): Promise<void> {
  if (!this.localFilter) return;

  const recent = this.ctx.getMessages().slice(-20);
  const result = await this.localFilter.evaluate(this.ctx.groupId, recent);

  if (result.shouldWake) {
    log.info("[%s] Filter recommends waking owner: %s (priority: %s)",
      this.ctx.groupId, result.reason, result.priority);

    // 将过滤结果注入为群主的私有上下文
    const filterContext = `[本地过滤层建议唤醒群主]
原因: ${result.reason}
优先级: ${result.priority}${result.summary ? `\n摘要: ${result.summary}` : ""}`;

    // 唤醒群主，附带过滤上下文
    const agent = this.getAgent(this.ownerId!);
    if (agent) {
      this.wakeQueue.push({
        targetAgentId: this.ownerId!,
        triggerMsgId: msg.id,
        triggerTag: "main",
      });
      // 过滤上下文通过 group context 传递（在 executeWake 中处理）
      (this as any)._lastFilterContext = filterContext;
    }
  }
}
```

- [ ] **Step 5: 修改 executeWake，在唤醒群主时注入过滤上下文**

在 `executeWake` 方法中，读取 context 之后、唤醒 agent 之前：

```typescript
// 如果是群主且有过滤上下文，追加到 context
let enrichedContext = context;
if (entry.targetAgentId === this.ownerId && (this as any)._lastFilterContext) {
  enrichedContext = `${context}\n\n${(this as any)._lastFilterContext}`;
  (this as any)._lastFilterContext = null;
}
```

然后用 `enrichedContext` 替代 `context` 调用 `agent.run()`。

- [ ] **Step 6: 修改 Group 构造函数，传递 ownerId 给 WakeSystem**

```typescript
// 在 group.ts 构造函数中，创建 WakeSystem 时传入 ownerId
this.wakeSystem = new WakeSystem(
  this.ctxV2,
  (id) => this.registry.get(id),
  { ownerId: config.owner },  // 新增
  {
    currentMd: this.currentMd,
    getAgentMemory: (agentId) => this.getAgentMemory(agentId),
    getGroupMembers: () => this.config.members,
    maxCurrentMessages: this.maxCurrentMessages,
  },
);
```

- [ ] **Step 7: 运行现有测试确保无破坏**

Run: `cd D:/agent-codes/CoBeing && pnpm test`
Expected: 全部通过（242+ tests）

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/group/wake-system.ts packages/core/src/group/group.ts
git commit -m "feat(host): integrate LocalFilterEngine into WakeSystem"
```

---

### Task 4: 群主专属工具（6 个 host-* 工具）

**Files:**
- Create: `packages/core/src/group/host-tools.ts`
- Create: `packages/core/src/group/host-tools.test.ts`

- [ ] **Step 1: 创建 host-tools.test.ts**

```typescript
// packages/core/src/group/host-tools.test.ts
import { describe, it, expect, vi } from "vitest";
import {
  makeHostGuideDiscussionTool,
  makeHostDecomposeTaskTool,
  makeHostSummarizeProgressTool,
  makeHostRecordDecisionTool,
  makeHostManageTodoTool,
  makeHostReviewTodoTool,
} from "./host-tools.js";

function mockGroup() {
  return {
    postMessage: vi.fn(),
    ctxV2: {
      getMessages: vi.fn().mockReturnValue([
        { id: "1", fromAgentId: "alice", content: "讨论方案A", tag: "main", timestamp: Date.now(), mentions: [] },
      ]),
    },
    workspace: {
      updateTask: vi.fn(),
      appendProgress: vi.fn(),
      getSummary: vi.fn().mockReturnValue({ task: "", plan: "", progress: "" }),
    },
    config: { id: "g1", name: "test-group", members: ["alice", "bob"], owner: "host" },
  };
}

describe("host-guide-discussion", () => {
  it("posts discussion guide to group", async () => {
    const group = mockGroup();
    const tool = makeHostGuideDiscussionTool(() => group as any);
    const result = await tool.execute(
      { groupId: "g1", topic: "方案选择", goals: "确定最终方案" },
      { agentId: "host" } as any,
    );
    expect(group.postMessage).toHaveBeenCalledWith("host", expect.stringContaining("方案选择"));
    expect(result.isError).toBeFalsy();
  });

  it("returns error for missing group", async () => {
    const tool = makeHostGuideDiscussionTool(() => undefined);
    const result = await tool.execute({ groupId: "missing", topic: "test" }, { agentId: "host" } as any);
    expect(result.isError).toBe(true);
  });
});

describe("host-decompose-task", () => {
  it("creates TODOs for subtasks", async () => {
    const addTodo = vi.fn().mockReturnValue({ id: "todo-1", title: "sub-1" });
    const group = mockGroup();
    const tool = makeHostDecomposeTaskTool(() => group as any, addTodo);
    const result = await tool.execute(
      {
        groupId: "g1",
        task: "实现登录功能",
        subtasks: [
          { title: "设计接口", assignee: "alice", triggerAt: "2026-04-26T09:00:00+08:00" },
          { title: "实现后端", assignee: "bob", triggerAt: "2026-04-27T09:00:00+08:00" },
        ],
      },
      { agentId: "host" } as any,
    );
    expect(addTodo).toHaveBeenCalledTimes(2);
    expect(group.postMessage).toHaveBeenCalled();
    expect(result.isError).toBeFalsy();
  });
});

describe("host-summarize-progress", () => {
  it("writes summary to group workspace", async () => {
    const group = mockGroup();
    const tool = makeHostSummarizeProgressTool(() => group as any);
    const result = await tool.execute(
      { groupId: "g1", summary: "完成方案讨论，确定方案A" },
      { agentId: "host" } as any,
    );
    expect(group.workspace.appendProgress).toHaveBeenCalled();
    expect(result.isError).toBeFalsy();
  });
});

describe("host-record-decision", () => {
  it("records decision to group context and file", async () => {
    const group = mockGroup();
    const appendDecision = vi.fn();
    const tool = makeHostRecordDecisionTool(() => group as any, appendDecision);
    const result = await tool.execute(
      { groupId: "g1", decision: "采用方案A", reason: "性能更好" },
      { agentId: "host" } as any,
    );
    expect(group.postMessage).toHaveBeenCalled();
    expect(appendDecision).toHaveBeenCalled();
    expect(result.isError).toBeFalsy();
  });
});

describe("host-manage-todo", () => {
  it("lists group todos", async () => {
    const listTodos = vi.fn().mockReturnValue([
      { id: "t1", title: "task-1", status: "pending", triggerAt: "2026-04-26T09:00:00+08:00" },
    ]);
    const tool = makeHostManageTodoTool(listTodos);
    const result = await tool.execute(
      { action: "list", groupId: "g1" },
      { agentId: "host" } as any,
    );
    expect(listTodos).toHaveBeenCalled();
    expect(result.content).toContain("task-1");
  });

  it("assigns todo to member", async () => {
    const updateTodo = vi.fn().mockReturnValue({ id: "t1" });
    const tool = makeHostManageTodoTool(() => [], updateTodo);
    const result = await tool.execute(
      { action: "assign", groupId: "g1", todoId: "t1", assignee: "alice" },
      { agentId: "host" } as any,
    );
    expect(updateTodo).toHaveBeenCalled();
  });
});

describe("host-review-todo", () => {
  it("reviews overdue todos and recommends action", async () => {
    const getDueTodos = vi.fn().mockReturnValue([
      { id: "t1", title: "overdue-task", targetAgentId: "alice", triggerAt: "2026-04-20T09:00:00+08:00" },
    ]);
    const tool = makeHostReviewTodoTool(getDueTodos);
    const result = await tool.execute(
      { groupId: "g1" },
      { agentId: "host" } as any,
    );
    expect(result.content).toContain("overdue-task");
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd D:/agent-codes/CoBeing && pnpm vitest run packages/core/src/group/host-tools.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 实现 host-tools.ts**

```typescript
// packages/core/src/group/host-tools.ts
import type { Tool, ToolContext, ToolResult } from "@cobeing/shared";
import type { Group } from "./group.js";
import type { TodoStore } from "../todo/store.js";
import { createLogger } from "@cobeing/shared";

const log = createLogger("host-tools");

type GroupGetter = (groupId: string) => Group | undefined;

// ---- host-guide-discussion ----

export function makeHostGuideDiscussionTool(getGroup: GroupGetter): Tool {
  return {
    name: "host-guide-discussion",
    description: "主动发起或引导群组讨论（群主专用）。设定议题、@mention 相关成员、给出讨论框架。",
    parameters: {
      type: "object",
      properties: {
        groupId: { type: "string", description: "群组 ID" },
        topic: { type: "string", description: "讨论主题" },
        goals: { type: "string", description: "讨论目标（可选）" },
        members: { type: "array", items: { type: "string" }, description: "邀请参与的成员（可选，默认全部）" },
        framework: { type: "string", description: "讨论框架/步骤（可选）" },
      },
      required: ["groupId", "topic"],
    },
    async execute(params, context: ToolContext): Promise<ToolResult> {
      const group = getGroup(params.groupId as string);
      if (!group) return { toolCallId: "", content: `未找到群组: ${params.groupId}`, isError: true };

      const topic = params.topic as string;
      const goals = params.goals as string;
      const framework = params.framework as string;
      const members = (params.members as string[]) || group.config.members;

      const mentions = members.map(m => `@${m}`).join(" ");
      const parts = [`# 讨论: ${topic}`, ""];
      if (goals) parts.push(`目标: ${goals}`, "");
      if (framework) parts.push(`框架:\n${framework}`, "");
      parts.push(`${mentions} 请就以上主题发表观点。`);

      group.postMessage(context.agentId, parts.join("\n"));

      log.info("[%s] Discussion guide posted: %s", params.groupId, topic);
      return { toolCallId: "", content: `已发起讨论「${topic}」，已通知: ${members.join(", ")}` };
    },
  };
}

// ---- host-decompose-task ----

interface SubTask {
  title: string;
  assignee?: string;
  triggerAt: string;
  description?: string;
}

export function makeHostDecomposeTaskTool(
  getGroup: GroupGetter,
  addTodo: (input: any) => any,
): Tool {
  return {
    name: "host-decompose-task",
    description: "拆解任务为子任务，创建 TODO 并分配给成员（群主专用）。",
    parameters: {
      type: "object",
      properties: {
        groupId: { type: "string", description: "群组 ID" },
        task: { type: "string", description: "总体任务描述" },
        subtasks: {
          type: "array",
          description: "子任务列表",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              assignee: { type: "string", description: "分配给哪个成员" },
              triggerAt: { type: "string", description: "触发时间 (ISO 8601)" },
              description: { type: "string" },
            },
            required: ["title", "triggerAt"],
          },
        },
      },
      required: ["groupId", "task", "subtasks"],
    },
    async execute(params, context: ToolContext): Promise<ToolResult> {
      const group = getGroup(params.groupId as string);
      if (!group) return { toolCallId: "", content: `未找到群组: ${params.groupId}`, isError: true };

      const subtasks = params.subtasks as SubTask[];
      const created: string[] = [];

      for (const st of subtasks) {
        const todo = addTodo({
          title: st.title,
          description: st.description || `来自任务拆解: ${params.task}`,
          triggerAt: st.triggerAt,
          recurrenceHint: "不重复",
          scope: "group",
          groupId: params.groupId,
          targetAgentId: st.assignee,
          createdBy: context.agentId,
        });
        created.push(`- ${st.title}${st.assignee ? ` → @${st.assignee}` : ""} (ID: ${todo.id})`);
      }

      const summary = `任务拆解: ${params.task}\n\n${created.join("\n")}`;
      group.postMessage(context.agentId, summary);

      log.info("[%s] Task decomposed: %d subtasks", params.groupId, subtasks.length);
      return { toolCallId: "", content: `已拆解为 ${subtasks.length} 个子任务:\n${created.join("\n")}` };
    },
  };
}

// ---- host-summarize-progress ----

export function makeHostSummarizeProgressTool(getGroup: GroupGetter): Tool {
  return {
    name: "host-summarize-progress",
    description: "总结群组讨论进展，写入工作区 PROGRESS.md（群主专用）。",
    parameters: {
      type: "object",
      properties: {
        groupId: { type: "string", description: "群组 ID" },
        summary: { type: "string", description: "进展总结内容" },
      },
      required: ["groupId", "summary"],
    },
    async execute(params, context: ToolContext): Promise<ToolResult> {
      const group = getGroup(params.groupId as string);
      if (!group) return { toolCallId: "", content: `未找到群组: ${params.groupId}`, isError: true };

      const summary = params.summary as string;
      group.workspace.appendProgress(context.agentId, summary);
      group.postMessage(context.agentId, `## 进展总结\n\n${summary}`);

      log.info("[%s] Progress summarized", params.groupId);
      return { toolCallId: "", content: `已更新进展总结到群组工作区。` };
    },
  };
}

// ---- host-record-decision ----

export function makeHostRecordDecisionTool(
  getGroup: GroupGetter,
  appendDecision: (groupId: string, decision: string, reason: string) => void,
): Tool {
  return {
    name: "host-record-decision",
    description: "记录群组决策到群主 DECISIONS.md 和群组上下文（群主专用）。",
    parameters: {
      type: "object",
      properties: {
        groupId: { type: "string", description: "群组 ID" },
        decision: { type: "string", description: "决策内容" },
        reason: { type: "string", description: "决策理由" },
      },
      required: ["groupId", "decision", "reason"],
    },
    async execute(params, context: ToolContext): Promise<ToolResult> {
      const group = getGroup(params.groupId as string);
      if (!group) return { toolCallId: "", content: `未找到群组: ${params.groupId}`, isError: true };

      const decision = params.decision as string;
      const reason = params.reason as string;

      appendDecision(params.groupId as string, decision, reason);
      group.postMessage(context.agentId, `## 决策记录\n\n**决策**: ${decision}\n**理由**: ${reason}`);

      log.info("[%s] Decision recorded: %s", params.groupId, decision);
      return { toolCallId: "", content: `已记录决策: ${decision}` };
    },
  };
}

// ---- host-manage-todo ----

export function makeHostManageTodoTool(
  listTodos: (groupId: string, status?: string) => any[],
  updateTodo?: (todoId: string, updates: any) => any,
  removeTodo?: (todoId: string) => boolean,
): Tool {
  return {
    name: "host-manage-todo",
    description: "管理群组 TODO（群主专用）。支持 list/assign/complete/remove 操作。",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", description: "操作: list / assign / complete / remove", enum: ["list", "assign", "complete", "remove"] },
        groupId: { type: "string", description: "群组 ID" },
        todoId: { type: "string", description: "TODO ID（assign/complete/remove 时必填）" },
        assignee: { type: "string", description: "分配给谁（assign 时必填）" },
        status: { type: "string", description: "筛选状态（list 时可选）" },
      },
      required: ["action", "groupId"],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const action = params.action as string;
      const groupId = params.groupId as string;

      switch (action) {
        case "list": {
          const todos = listTodos(groupId, params.status as string);
          if (todos.length === 0) return { toolCallId: "", content: "没有 TODO" };
          const lines = todos.map(t =>
            `- [${t.status}] ${t.title} (ID: ${t.id}) → ${t.targetAgentId || "未分配"} | 触发: ${t.triggerAt}`
          );
          return { toolCallId: "", content: `群组 TODO (${todos.length}):\n${lines.join("\n")}` };
        }
        case "assign": {
          if (!updateTodo) return { toolCallId: "", content: "updateTodo 未配置", isError: true };
          const updated = updateTodo(params.todoId as string, { targetAgentId: params.assignee });
          return { toolCallId: "", content: updated ? `已分配 TODO ${params.todoId} 给 ${params.assignee}` : "未找到 TODO" };
        }
        case "complete": {
          if (!updateTodo) return { toolCallId: "", content: "updateTodo 未配置", isError: true };
          const completed = updateTodo(params.todoId as string, { status: "completed", completedAt: new Date().toISOString() });
          return { toolCallId: "", content: completed ? `已完成 TODO ${params.todoId}` : "未找到 TODO" };
        }
        case "remove": {
          if (!removeTodo) return { toolCallId: "", content: "removeTodo 未配置", isError: true };
          const removed = removeTodo(params.todoId as string);
          return { toolCallId: "", content: removed ? `已删除 TODO ${params.todoId}` : "未找到 TODO" };
        }
        default:
          return { toolCallId: "", content: `未知操作: ${action}`, isError: true };
      }
    },
  };
}

// ---- host-review-todo ----

export function makeHostReviewTodoTool(
  getDueTodos: (groupId: string) => any[],
): Tool {
  return {
    name: "host-review-todo",
    description: "检查到期/逾期 TODO，决定是否催促或重新分配（群主专用）。",
    parameters: {
      type: "object",
      properties: {
        groupId: { type: "string", description: "群组 ID" },
      },
      required: ["groupId"],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const groupId = params.groupId as string;
      const dueTodos = getDueTodos(groupId);

      if (dueTodos.length === 0) {
        return { toolCallId: "", content: "没有到期的 TODO。" };
      }

      const lines = dueTodos.map(t => {
        const overdueMs = Date.now() - new Date(t.triggerAt).getTime();
        const overdueHours = Math.floor(overdueMs / 3600000);
        return `- ${t.title} (ID: ${t.id}) → ${t.targetAgentId || "未分配"} | 逾期 ${overdueHours}h`;
      });

      return {
        toolCallId: "",
        content: `到期 TODO (${dueTodos.length}):\n${lines.join("\n")}\n\n建议：检查是否需要催促或重新分配。`,
      };
    },
  };
}
```

- [ ] **Step 4: 运行测试**

Run: `cd D:/agent-codes/CoBeing && pnpm vitest run packages/core/src/group/host-tools.test.ts`
Expected: 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/group/host-tools.ts packages/core/src/group/host-tools.test.ts
git commit -m "feat(host): add 6 host-* tools for discussion guidance, task decomposition, TODO management"
```

---

### Task 5: HostAgent data/host/ 目录 + 配置

**Files:**
- Modify: `packages/core/src/runtime.ts`
- Modify: `packages/core/src/config/schema.ts`
- Modify: `config/default.json`

- [ ] **Step 1: 在 schema.ts 新增 localModel 配置**

在 `AppConfig` 接口的 `core` 字段中新增：

```typescript
core: {
  // ... existing fields ...
  localModel?: {
    enabled: boolean;
    path: string;
    contextSize?: number;
    filterDebounceMs?: number;
  };
};
```

- [ ] **Step 2: 更新 config/default.json**

在 `core` 段新增：

```json
{
  "core": {
    "localModel": {
      "enabled": true,
      "path": "./data/models/qwen3.5-2b",
      "contextSize": 8192,
      "filterDebounceMs": 3000
    }
  }
}
```

- [ ] **Step 3: 修改 runtime.ts — 初始化 LocalFilterEngine**

在 `start()` 方法中，`this.todoScanner.start()` 之后添加：

```typescript
// 初始化本地过滤引擎
if (this.config.core.localModel?.enabled) {
  const { LocalFilterEngine } = await import("./group/local-filter.js");
  const filter = new LocalFilterEngine();
  const modelPath = path.resolve(this.config.core.localModel.path);
  await filter.init(modelPath, this.config.core.localModel.contextSize);
  if (filter.isEnabled()) {
    (this as any)._localFilter = filter;
    log.info("Local filter engine enabled: %s", modelPath);
  }
}
```

- [ ] **Step 4: 修改 runtime.ts — 将过滤引擎注入到群组**

在 `GroupManager.create()` 和 `restoreGroups()` 中，创建 Group 后注入过滤引擎：

在 `Group` 类中新增 `setLocalFilter` 方法：

```typescript
// group.ts
setLocalFilter(filter: import("./local-filter.js").LocalFilterEngine): void {
  this.wakeSystem.setLocalFilter(filter);
}
```

在 `runtime.ts` 的 `start()` 中，群组恢复完成后：

```typescript
// 注入过滤引擎到所有群组
const localFilter = (this as any)._localFilter;
if (localFilter) {
  for (const group of this.groupManager.list()) {
    group.setLocalFilter(localFilter);
  }
}
```

- [ ] **Step 5: 修改 runtime.ts — 群主注册改造**

修改 `registerPrebuiltAgents()`，当 agentId === "host" 时：
- 从 `data/host/config.json` 读取配置
- 注册 host-* 专属工具

```typescript
// 在 registerPrebuiltAgents 的循环中，agentId === "host" 分支
if (agentId === "host") {
  // 群主专属工具
  const { makeHostGuideDiscussionTool, makeHostDecomposeTaskTool,
    makeHostSummarizeProgressTool, makeHostRecordDecisionTool,
    makeHostManageTodoTool, makeHostReviewTodoTool } = await import("./group/host-tools.js");

  const groupGetter = (gid: string) => this.groupManager.get(gid);
  const hostDataDir = path.join(this.dataRoot, "host");

  agent.registerTool(makeHostGuideDiscussionTool(groupGetter));
  agent.registerTool(makeHostDecomposeTaskTool(groupGetter, (input) => {
    // TODO: 接入 GroupTodoScanner
    return { id: "temp", ...input };
  }));
  agent.registerTool(makeHostSummarizeProgressTool(groupGetter));
  agent.registerTool(makeHostRecordDecisionTool(groupGetter, (gid, decision, reason) => {
    // fs already imported at top of runtime.ts
    const decPath = path.join(hostDataDir, "DECISIONS.md");
    const entry = `\n## ${new Date().toISOString()}\n**群组**: ${gid}\n**决策**: ${decision}\n**理由**: ${reason}\n`;
    fs.appendFileSync(decPath, entry, "utf-8");
  }));
  agent.registerTool(makeHostManageTodoTool(
    (gid, status) => this.groupManager.getGroupTodoStore(gid)?.list(status) ?? [],
    (todoId, updates) => { /* TODO: 接入 TodoStore.updateItem */ },
    (todoId) => { /* TODO: 接入 TodoStore.remove */ },
  ));
  agent.registerTool(makeHostReviewTodoTool(
    (gid) => this.groupManager.getGroupTodoStore(gid)?.getDueTodos() ?? [],
  ));
}
```

- [ ] **Step 6: 确保 data/host/ 目录结构**

在 `runtime.ts` 的 `start()` 开头：

```typescript
// 确保 data/host/ 目录存在
const hostDir = path.join(this.dataRoot, "host");
fs.mkdirSync(hostDir, { recursive: true });

// 如果不存在 config.json，创建默认配置
const hostConfigPath = path.join(hostDir, "config.json");
if (!fs.existsSync(hostConfigPath)) {
  fs.writeFileSync(hostConfigPath, JSON.stringify({
    name: "群主",
    role: "项目协调者和讨论引导者",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    permissions: { mode: "full-access" },
    sandbox: { enabled: false, filesystem: "isolated", network: { enabled: true, mode: "all" } },
    tools: [
      "bash", "read-file", "write-file", "glob", "grep",
      "group-plan", "group-invite-talk", "group-summarize", "group-assign-task",
      "host-guide-discussion", "host-decompose-task", "host-summarize-progress",
      "host-record-decision", "host-manage-todo", "host-review-todo",
      "todo-add", "todo-list", "todo-complete", "todo-remove",
    ],
  }, null, 2) + "\n", "utf-8");
}

// 如果不存在 DECISIONS.md，创建空文件
const decPath = path.join(hostDir, "DECISIONS.md");
if (!fs.existsSync(decPath)) {
  fs.writeFileSync(decPath, "# 群主决策记录\n", "utf-8");
}

// 如果不存在 GROUPS_REGISTRY.md，创建空文件
const regPath = path.join(hostDir, "GROUPS_REGISTRY.md");
if (!fs.existsSync(regPath)) {
  fs.writeFileSync(regPath, "# 群主管理的群组\n", "utf-8");
}
```

- [ ] **Step 7: 运行全量测试**

Run: `cd D:/agent-codes/CoBeing && pnpm test`
Expected: 全部通过

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/runtime.ts packages/core/src/config/schema.ts config/default.json packages/core/src/group/group.ts
git commit -m "feat(host): integrate HostAgent with data/host/ dir, local filter, and host-* tools"
```

---

### Task 6: 导出 + 文档更新

**Files:**
- Modify: `packages/core/src/index.ts`
- Modify: `STRUCTURE.md`

- [ ] **Step 1: 在 index.ts 新增导出**

```typescript
export { LocalFilterEngine } from "./group/local-filter.js";
export { FilterResult, LocalModelConfig } from "@cobeing/shared";
export {
  makeHostGuideDiscussionTool,
  makeHostDecomposeTaskTool,
  makeHostSummarizeProgressTool,
  makeHostRecordDecisionTool,
  makeHostManageTodoTool,
  makeHostReviewTodoTool,
} from "./group/host-tools.js";
```

- [ ] **Step 2: 更新 STRUCTURE.md**

在 `packages/core/src/group/` 段新增：

```
│   ├── local-filter.ts          #     LocalFilterEngine 本地模型过滤
│   ├── filter-prompt.ts         #     过滤层 prompt 模板
│   ├── host-tools.ts            #     群主专属工具（6 个 host-* 工具）
```

在 `config/default.json` 说明中新增 `localModel` 配置段。

在 `data/` 段新增 `host/` 和 `models/` 目录说明。

在 WS 命令表中保持不变（过滤层是内部机制，不暴露 WS 命令）。

- [ ] **Step 3: 运行全量测试**

Run: `cd D:/agent-codes/CoBeing && pnpm test`
Expected: 全部通过

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/index.ts STRUCTURE.md
git commit -m "docs(host): update exports and STRUCTURE.md for host enhancement"
```

---

### Task 7: 集成验证 + 降级测试

**Files:**
- Create: `packages/core/src/integration/host-filter.integration.test.ts`

- [ ] **Step 1: 创建集成测试**

```typescript
// packages/core/src/integration/host-filter.integration.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { LocalFilterEngine } from "../../group/local-filter.js";

describe("Host Filter Integration", () => {
  it("LocalFilterEngine degrades gracefully when model not available", async () => {
    const engine = new LocalFilterEngine();
    // 不调用 init()，模拟模型不可用
    expect(engine.isEnabled()).toBe(false);

    const result = await engine.evaluate("test-group", []);
    expect(result.shouldWake).toBe(true); // 默认唤醒
    expect(result.reason).toContain("未启用");
  });

  it("LocalFilterEngine handles empty messages", async () => {
    const engine = new LocalFilterEngine();
    const result = await engine.evaluate("test-group", []);
    expect(result.shouldWake).toBe(true);
  });

  it("LocalFilterEngine dispose is safe to call multiple times", () => {
    const engine = new LocalFilterEngine();
    engine.dispose();
    engine.dispose();
    expect(engine.isEnabled()).toBe(false);
  });
});
```

- [ ] **Step 2: 运行集成测试**

Run: `cd D:/agent-codes/CoBeing && pnpm vitest run packages/core/src/integration/host-filter.integration.test.ts`
Expected: 3 tests PASS

- [ ] **Step 3: 运行全量测试**

Run: `cd D:/agent-codes/CoBeing && pnpm test`
Expected: 全部通过

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/integration/host-filter.integration.test.ts
git commit -m "test(host): add integration tests for host filter degradation"
```

---

### Task 8: 模型转换脚本

**Files:**
- Create: `scripts/convert-to-gguf.sh`

- [ ] **Step 1: 创建转换脚本**

```bash
#!/bin/bash
# scripts/convert-to-gguf.sh
# 将 HuggingFace safetensors 模型转换为 GGUF 格式（供 node-llama-cpp 使用）
#
# 前置条件:
#   pip install llama-cpp-python  (或克隆 llama.cpp 仓库)
#
# 用法:
#   bash scripts/convert-to-gguf.sh <input_dir> <output_path>
#   例如: bash scripts/convert-to-gguf.sh data/models/qwen3.5-2b data/models/qwen3.5-2b/model.gguf

set -e

INPUT_DIR="${1:?用法: $0 <input_dir> <output_path>}"
OUTPUT="${2:?用法: $0 <input_dir> <output_path>}"

echo "=== CoBeing 模型转换工具 ==="
echo "输入目录: $INPUT_DIR"
echo "输出路径: $OUTPUT"

# 检查输入目录
if [ ! -f "$INPUT_DIR/config.json" ]; then
  echo "错误: $INPUT_DIR/config.json 不存在"
  exit 1
fi

# 检查是否已有 GGUF 文件
if [ -f "$OUTPUT" ]; then
  echo "GGUF 文件已存在: $OUTPUT"
  echo "如需重新转换，请先删除该文件"
  exit 0
fi

# 尝试使用 llama.cpp 的转换脚本
LLAMA_CPP_DIR="${LLAMA_CPP_DIR:-$HOME/llama.cpp}"

if [ -d "$LLAMA_CPP_DIR" ] && [ -f "$LLAMA_CPP_DIR/convert_hf_to_gguf.py" ]; then
  echo "使用 llama.cpp 转换..."
  python3 "$LLAMA_CPP_DIR/convert_hf_to_gguf.py" \
    "$INPUT_DIR" \
    --outfile "$OUTPUT" \
    --outtype q4_k_m
else
  echo "llama.cpp 未找到。请按以下步骤操作："
  echo ""
  echo "1. 克隆 llama.cpp:"
  echo "   git clone https://github.com/ggerganov/llama.cpp \$HOME/llama.cpp"
  echo ""
  echo "2. 安装依赖:"
  echo "   pip install -r \$HOME/llama.cpp/requirements.txt"
  echo ""
  echo "3. 重新运行本脚本"
  echo ""
  echo "或者手动运行:"
  echo "   python3 \$HOME/llama.cpp/convert_hf_to_gguf.py $INPUT_DIR --outfile $OUTPUT --outtype q4_k_m"
  exit 1
fi

echo "转换完成: $OUTPUT"
echo "文件大小: $(du -h "$OUTPUT" | cut -f1)"
```

- [ ] **Step 2: 设置执行权限**

Run: `chmod +x scripts/convert-to-gguf.sh`

- [ ] **Step 3: Commit**

```bash
git add scripts/convert-to-gguf.sh
git commit -m "feat(host): add safetensors to GGUF conversion script"
```
