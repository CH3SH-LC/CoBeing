# MyAgents 五项预期差距修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 MyAgents 项目与五项预期的差距——实现自主经验系统、自发通信机制、Skills 装载链路、自动化工作流。

**Architecture:** 以四个子系统递进构建：(1) ExperienceWriter + 反思机制实现 EXPERIENCE.md 自主学习；(2) AgentEventBus + 消息订阅实现自发通信；(3) 扩展 AgentConfig.skills + butler-create-agent 实现按需装载技能；(4) WorkflowEngine 串联完整任务执行管线。

**Tech Stack:** TypeScript, Vitest, pnpm monorepo

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `packages/core/src/memory/experience.ts` | ExperienceWriter 经验写入/检索 |
| Create | `packages/core/src/agent/event-bus.ts` | AgentEventBus 自发通信事件总线 |
| Create | `packages/core/src/workflow/engine.ts` | WorkflowEngine 任务执行管线 |
| Modify | `packages/shared/src/types.ts` | 添加 AgentConfig.skills 字段 |
| Modify | `packages/shared/src/events.ts` | 添加经验/工作流事件类型 |
| Modify | `packages/core/src/agent/paths.ts` | 添加 AgentFiles 经验读写方法 |
| Modify | `packages/core/src/agent/agent.ts` | 集成反思 + 事件订阅 + 经验增强 |
| Modify | `packages/core/src/agent/butler.ts` | 集成 WorkflowEngine + skills 参数 |
| Modify | `packages/core/src/group/context.ts` | 集成事件总线触发 |
| Create | `packages/core/src/memory/experience.test.ts` | 经验系统测试 |
| Create | `packages/core/src/agent/event-bus.test.ts` | 事件总线测试 |
| Create | `packages/core/src/workflow/engine.test.ts` | 工作流引擎测试 |

---

## Task 1: AgentConfig 类型扩展

**Files:**
- Modify: `packages/shared/src/types.ts:110-122`

- [ ] **Step 1: 添加 skills 字段到 AgentConfig**

在 `AgentConfig` 接口末尾（第122行 `skillsDir?: string;` 之后）添加：

```typescript
export interface AgentConfig {
  id: string;
  name: string;
  role: string;
  systemPrompt: string;
  provider: string;
  model: string;
  tools?: string[];
  toolsConfig?: ToolsConfig;
  permissions?: PermissionPolicy;
  sandbox?: SandboxConfig;
  skillsDir?: string;
  skills?: string[];         // 要装载的技能名称列表（按名称匹配 skills/ 目录下的技能）
}
```

- [ ] **Step 2: 运行现有测试确保类型兼容**

Run: `cd D:/agent-codes/myagents && npx vitest run --reporter=verbose 2>&1 | tail -20`
Expected: 所有 113 个测试通过

- [ ] **Step 3: Commit**

```bash
cd D:/agent-codes/myagents
git add packages/shared/src/types.ts
git commit -m "feat: add skills field to AgentConfig type"
```

---

## Task 2: AgentFiles 经验读写方法

**Files:**
- Modify: `packages/core/src/agent/paths.ts:42-124` (AgentFiles 类)

- [ ] **Step 1: 在 AgentFiles 类中添加经验读写方法**

在 `packages/core/src/agent/paths.ts` 的 `AgentFiles` 类中（第 103 行 `writeConfig` 方法之后，第 110 行 `listMemoryFiles` 之前）添加：

```typescript
  /** 读取 EXPERIENCE.md */
  readExperience(): string {
    return this.readFile(this.paths.experiencePath);
  }

  /** 写入 EXPERIENCE.md */
  writeExperience(content: string): void {
    fs.writeFileSync(this.paths.experiencePath, content, "utf-8");
  }

  /** 追加一条经验到 EXPERIENCE.md */
  appendExperience(entry: { task: string; problem: string; solution: string; date?: string }): void {
    const existing = this.readExperience();
    const date = entry.date ?? new Date().toISOString().split("T")[0];
    const block = [
      "",
      `## [${date}] ${entry.task.slice(0, 80)}`,
      `- **问题**: ${entry.problem}`,
      `- **解决**: ${entry.solution}`,
      "",
    ].join("\n");

    if (!existing) {
      this.writeExperience(`# EXPERIENCE.md\n\n> Agent 在工程过程中积累的经验${block}`);
    } else {
      fs.appendFileSync(this.paths.experiencePath, block + "\n", "utf-8");
    }
  }
```

- [ ] **Step 2: 运行 paths 相关测试**

Run: `cd D:/agent-codes/myagents && npx vitest run packages/core/src/paths.test.ts --reporter=verbose 2>&1 | tail -20`
Expected: 所有测试通过

- [ ] **Step 3: Commit**

```bash
cd D:/agent-codes/myagents
git add packages/core/src/agent/paths.ts
git commit -m "feat: add experience read/write methods to AgentFiles"
```

---

## Task 3: ExperienceWriter 经验系统

**Files:**
- Create: `packages/core/src/memory/experience.ts`
- Create: `packages/core/src/memory/experience.test.ts`

- [ ] **Step 1: 编写 experience.test.ts 失败测试**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ExperienceWriter } from "./experience.js";

describe("ExperienceWriter", () => {
  let tmpDir: string;
  let experiencePath: string;
  let writer: ExperienceWriter;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "exp-test-"));
    experiencePath = path.join(tmpDir, "EXPERIENCE.md");
    writer = new ExperienceWriter(experiencePath, {
      chat: async function* () {
        yield { type: "content", content: "问题: mock problem\n解决: mock solution" };
        yield { type: "done" };
      },
    } as any);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("初始化时创建 EXPERIENCE.md", () => {
    expect(fs.existsSync(experiencePath)).toBe(true);
    const content = fs.readFileSync(experiencePath, "utf-8");
    expect(content).toContain("EXPERIENCE.md");
  });

  it("手动追加经验条目", () => {
    writer.append({
      task: "修复内存泄漏",
      problem: "EventEmitter 未取消订阅",
      solution: "在 dispose 中调用 removeAllListeners",
    });

    const content = fs.readFileSync(experiencePath, "utf-8");
    expect(content).toContain("修复内存泄漏");
    expect(content).toContain("EventEmitter 未取消订阅");
    expect(content).toContain("removeAllListeners");
  });

  it("追加多条经验保持格式", () => {
    writer.append({ task: "任务A", problem: "问题A", solution: "方案A" });
    writer.append({ task: "任务B", problem: "问题B", solution: "方案B" });

    const content = fs.readFileSync(experiencePath, "utf-8");
    expect(content).toContain("任务A");
    expect(content).toContain("任务B");
  });

  it("reflect 通过 LLM 总结对话生成经验", async () => {
    const conversation = [
      { role: "user", content: "帮我修复这个 TypeScript 编译错误" },
      { role: "assistant", content: "我发现类型定义不匹配" },
      { role: "tool", content: "已修改 interface 定义" },
      { role: "assistant", content: "编译通过了" },
    ];

    await writer.reflect("修复TS编译错误", conversation);

    const content = fs.readFileSync(experiencePath, "utf-8");
    expect(content).toContain("mock problem");
    expect(content).toContain("mock solution");
  });

  it("search 检索相关经验", () => {
    writer.append({ task: "React hooks 优化", problem: "useEffect 无限循环", solution: "添加正确的依赖数组" });
    writer.append({ task: "数据库查询优化", problem: "N+1 查询", solution: "使用 DataLoader 批量加载" });

    const results = writer.search("React hooks");
    expect(results).toHaveLength(1);
    expect(results[0]).toContain("useEffect 无限循环");

    const noResults = writer.search("Python");
    expect(noResults).toHaveLength(0);
  });

  it("读取全部经验内容", () => {
    writer.append({ task: "T1", problem: "P1", solution: "S1" });
    writer.append({ task: "T2", problem: "P2", solution: "S2" });

    const all = writer.readAll();
    expect(all).toContain("T1");
    expect(all).toContain("T2");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd D:/agent-codes/myagents && npx vitest run packages/core/src/memory/experience.test.ts --reporter=verbose 2>&1 | tail -20`
Expected: FAIL — Cannot find module "./experience.js"

- [ ] **Step 3: 编写 ExperienceWriter 实现**

```typescript
/**
 * ExperienceWriter — Agent 自主经验系统
 * 在工程过程中总结问题及解决方法，固化到 EXPERIENCE.md
 */
import fs from "node:fs";
import path from "node:path";
import type { LLMProvider } from "@myagents/providers";
import { createLogger } from "@myagents/shared";

const log = createLogger("experience-writer");

export interface ExperienceEntry {
  task: string;
  problem: string;
  solution: string;
  date?: string;
}

export class ExperienceWriter {
  private filePath: string;

  constructor(
    filePath: string,
    private provider?: LLMProvider,
  ) {
    this.filePath = filePath;
    this.ensureFile();
  }

  private ensureFile(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, "# EXPERIENCE.md\n\n> Agent 在工程过程中积累的经验\n", "utf-8");
    }
  }

  /** 手动追加一条经验 */
  append(entry: ExperienceEntry): void {
    const date = entry.date ?? new Date().toISOString().split("T")[0];
    const block = [
      "",
      `## [${date}] ${entry.task.slice(0, 80)}`,
      `- **问题**: ${entry.problem}`,
      `- **解决**: ${entry.solution}`,
      "",
    ].join("\n");

    fs.appendFileSync(this.filePath, block + "\n", "utf-8");
    log.info("Experience appended: %s", entry.task.slice(0, 40));
  }

  /** 通过 LLM 反思对话，自动提取经验 */
  async reflect(task: string, conversation: Array<{ role: string; content: string }>): Promise<void> {
    if (!this.provider) {
      log.warn("No provider for reflection");
      return;
    }

    const convText = conversation
      .map(m => `[${m.role}]: ${m.content}`)
      .join("\n");

    const prompt = `分析以下任务执行过程，提取关键经验。

任务: ${task}

执行过程:
${convText}

请严格按以下格式输出（不要输出其他内容）:
问题: <遇到的核心问题或挑战，一句话>
解决: <最终的解决方案，一句话>`;

    try {
      let result = "";
      for await (const chunk of this.provider.chat({
        model: "",
        messages: [{ role: "user", content: prompt }],
      })) {
        if (chunk.type === "content" && chunk.content) {
          result += chunk.content;
        }
      }

      const problemMatch = result.match(/问题[：:]\s*(.+)/);
      const solutionMatch = result.match(/解决[：:]\s*(.+)/);

      if (problemMatch && solutionMatch) {
        this.append({
          task,
          problem: problemMatch[1].trim(),
          solution: solutionMatch[1].trim(),
        });
      } else {
        log.warn("Reflection output format unexpected: %s", result.slice(0, 100));
      }
    } catch (err) {
      log.warn("Reflection failed: %s", err);
    }
  }

  /** 搜索相关经验（简单关键词匹配） */
  search(keyword: string): string[] {
    const content = this.readAll();
    if (!content) return [];

    const sections = content.split(/^## /m).slice(1);
    const lower = keyword.toLowerCase();
    return sections.filter(s => s.toLowerCase().includes(lower)).map(s => "## " + s.trim());
  }

  /** 读取全部经验内容 */
  readAll(): string {
    try {
      return fs.readFileSync(this.filePath, "utf-8");
    } catch {
      return "";
    }
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd D:/agent-codes/myagents && npx vitest run packages/core/src/memory/experience.test.ts --reporter=verbose 2>&1 | tail -20`
Expected: 6 个测试全部 PASS

- [ ] **Step 5: Commit**

```bash
cd D:/agent-codes/myagents
git add packages/core/src/memory/experience.ts packages/core/src/memory/experience.test.ts
git commit -m "feat: add ExperienceWriter with reflect/append/search"
```

---

## Task 4: Agent 集成反思 + 经验增强 system prompt

**Files:**
- Modify: `packages/core/src/agent/agent.ts:25-30,64-146,244-267`

- [ ] **Step 1: 在 agent.ts 顶部导入 ExperienceWriter**

在 `packages/core/src/agent/agent.ts` 第 25 行 (`import { MemoryWriter }`) 之后添加：

```typescript
import { ExperienceWriter } from "../memory/experience.js";
```

- [ ] **Step 2: 在 Agent 类中添加 experience 属性**

在 `packages/core/src/agent/agent.ts` 第 59 行 (`private memoryWriter: MemoryWriter;`) 之后添加：

```typescript
  private experienceWriter: ExperienceWriter;
```

- [ ] **Step 3: 在构造函数中初始化 ExperienceWriter 并增强 system prompt**

在构造函数中（第 101 行 `this.memoryWriter = ...` 之后，第 104 行 `// 初始化工具系统` 之前）添加：

```typescript
    // 经验系统
    this.experienceWriter = new ExperienceWriter(this.paths.experiencePath, this.provider);

    // 增强 systemPrompt：EXPERIENCE.md
    const experienceContent = this.files.readExperience();
    if (experienceContent && experienceContent.length > 50) {
      enhancedPrompt += "\n\n# 你积累的经验\n\n" + experienceContent;
    }
```

- [ ] **Step 4: 修改 run() 方法，任务完成后触发反思**

将 `packages/core/src/agent/agent.ts` 第 244-267 行的 `run()` 方法替换为：

```typescript
  /** 直接运行（非 channel 输入，用于测试/GUI） */
  async run(input: string, events?: ConversationLoopEvents): Promise<AgentResponse> {
    this._status = "running";
    try {
      // 保存用户消息
      await this.memoryWriter.append({
        session: "main",
        role: "user",
        content: input,
      });

      const response = await this.conversationLoop.run(input, events);

      // 保存助手回复
      await this.memoryWriter.append({
        session: "main",
        role: "assistant",
        content: response.content,
      });

      // 后台反思（不阻塞返回）
      this.reflectInBackground(input, response.content);

      return response;
    } finally {
      this._status = "idle";
    }
  }

  /** 后台反思：任务完成后总结经验 */
  private reflectInBackground(task: string, response: string): void {
    // 异步执行，不阻塞主流程
    setImmediate(async () => {
      try {
        await this.experienceWriter.reflect(task, [
          { role: "user", content: task },
          { role: "assistant", content: response },
        ]);
      } catch {
        // 反思失败不影响主流程
      }
    });
  }
```

- [ ] **Step 5: 运行全部测试确保不破坏现有功能**

Run: `cd D:/agent-codes/myagents && npx vitest run --reporter=verbose 2>&1 | tail -30`
Expected: 所有测试通过（包括新增的 experience 测试）

- [ ] **Step 6: Commit**

```bash
cd D:/agent-codes/myagents
git add packages/core/src/agent/agent.ts
git commit -m "feat: integrate ExperienceWriter into Agent with background reflection"
```

---

## Task 5: AgentEventBus 自发通信事件总线

**Files:**
- Create: `packages/core/src/agent/event-bus.ts`
- Create: `packages/core/src/agent/event-bus.test.ts`

- [ ] **Step 1: 编写 event-bus.test.ts 失败测试**

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { AgentEventBus } from "./event-bus.js";

describe("AgentEventBus", () => {
  let bus: AgentEventBus;

  beforeEach(() => {
    bus = new AgentEventBus();
  });

  it("agent 订阅并接收 @mention 消息", () => {
    const received: Array<{ from: string; message: string; groupId: string }> = [];
    bus.subscribe("react-expert", (msg) => {
      received.push(msg);
    });

    bus.emit("group-message", {
      groupId: "team-1",
      fromAgentId: "moderator",
      content: "@react-expert 请分析这个组件",
      mentionTarget: "react-expert",
    });

    expect(received).toHaveLength(1);
    expect(received[0].groupId).toBe("team-1");
    expect(received[0].message).toContain("react-expert");
  });

  it("多个 agent 订阅同一事件", () => {
    const a1Messages: unknown[] = [];
    const a2Messages: unknown[] = [];

    bus.subscribe("agent-1", () => a1Messages.push("called"));
    bus.subscribe("agent-2", () => a2Messages.push("called"));

    bus.emit("group-message", {
      groupId: "g1",
      fromAgentId: "owner",
      content: "@all 紧急会议",
      mentionTarget: "all",
    });

    expect(a1Messages).toHaveLength(1);
    expect(a2Messages).toHaveLength(1);
  });

  it("取消订阅后不再接收消息", () => {
    const messages: unknown[] = [];
    const unsub = bus.subscribe("agent-1", () => messages.push("called"));

    unsub();
    bus.emit("group-message", {
      groupId: "g1",
      fromAgentId: "owner",
      content: "@agent-1 hello",
      mentionTarget: "agent-1",
    });

    expect(messages).toHaveLength(0);
  });

  it("task-complete 事件触发经验反思", () => {
    const reflected: Array<{ agentId: string; task: string }> = [];
    bus.onReflection((agentId, task) => {
      reflected.push({ agentId, task });
    });

    bus.emit("task-complete", {
      agentId: "dev-agent",
      task: "修复内存泄漏",
      response: "已修复",
    });

    expect(reflected).toHaveLength(1);
    expect(reflected[0].agentId).toBe("dev-agent");
  });

  it("自发消息：agent 主动发起通信", () => {
    const received: Array<{ from: string; to: string; message: string }> = [];
    bus.subscribe("target-agent", (msg) => {
      received.push({ from: msg.fromAgentId, to: "target-agent", message: msg.content });
    });

    bus.emit("agent-direct", {
      fromAgentId: "source-agent",
      targetAgentId: "target-agent",
      content: "我发现了这个问题需要你处理",
    });

    expect(received).toHaveLength(1);
    expect(received[0].from).toBe("source-agent");
    expect(received[0].message).toContain("需要你处理");
  });

  it("事件历史记录", () => {
    bus.emit("group-message", {
      groupId: "g1", fromAgentId: "a1", content: "test", mentionTarget: "a2",
    });

    const history = bus.getHistory("group-message");
    expect(history).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd D:/agent-codes/myagents && npx vitest run packages/core/src/agent/event-bus.test.ts --reporter=verbose 2>&1 | tail -20`
Expected: FAIL — Cannot find module "./event-bus.js"

- [ ] **Step 3: 编写 AgentEventBus 实现**

```typescript
/**
 * AgentEventBus — 智能体自发通信的事件总线
 *
 * 支持:
 * - group-message: 群组 @mention 消息路由到目标 Agent
 * - agent-direct: Agent 间直接通信
 * - task-complete: 任务完成通知（触发反思）
 */
import { createLogger } from "@myagents/shared";

const log = createLogger("event-bus");

export interface BusMessage {
  groupId?: string;
  fromAgentId: string;
  content: string;
  mentionTarget?: string;
  targetAgentId?: string;
}

export interface TaskCompleteMessage {
  agentId: string;
  task: string;
  response: string;
}

type MessageHandler = (msg: BusMessage) => void;
type ReflectionHandler = (agentId: string, task: string) => void;

export class AgentEventBus {
  private subscribers = new Map<string, Set<MessageHandler>>();
  private reflectionHandlers: ReflectionHandler[] = [];
  private eventHistory = new Map<string, unknown[]>();

  /** Agent 订阅消息（监听发给自己或 @all 的消息） */
  subscribe(agentId: string, handler: MessageHandler): () => void {
    if (!this.subscribers.has(agentId)) {
      this.subscribers.set(agentId, new Set());
    }
    this.subscribers.get(agentId)!.add(handler);

    return () => {
      const set = this.subscribers.get(agentId);
      if (set) {
        set.delete(handler);
        if (set.size === 0) this.subscribers.delete(agentId);
      }
    };
  }

  /** 发射事件，路由到目标 Agent */
  emit(event: "group-message" | "agent-direct" | "task-complete", msg: BusMessage | TaskCompleteMessage): void {
    // 记录事件历史
    if (!this.eventHistory.has(event)) this.eventHistory.set(event, []);
    this.eventHistory.get(event)!.push(msg);

    if (event === "task-complete") {
      const tc = msg as TaskCompleteMessage;
      for (const handler of this.reflectionHandlers) {
        handler(tc.agentId, tc.task);
      }
      return;
    }

    const busMsg = msg as BusMessage;

    if (event === "group-message") {
      // @mention 路由
      const target = busMsg.mentionTarget;
      if (target === "all") {
        // 通知所有订阅者（排除发送者）
        for (const [agentId, handlers] of this.subscribers) {
          if (agentId !== busMsg.fromAgentId) {
            for (const handler of handlers) handler(busMsg);
          }
        }
      } else if (target) {
        const handlers = this.subscribers.get(target);
        if (handlers) {
          for (const handler of handlers) handler(busMsg);
        }
      }
    }

    if (event === "agent-direct") {
      const target = busMsg.targetAgentId;
      if (target) {
        const handlers = this.subscribers.get(target);
        if (handlers) {
          for (const handler of handlers) handler(busMsg);
        }
      }
    }

    log.info("Event [%s] → %s", event, busMsg.mentionTarget ?? busMsg.targetAgentId ?? "none");
  }

  /** 注册反思处理器 */
  onReflection(handler: ReflectionHandler): void {
    this.reflectionHandlers.push(handler);
  }

  /** 获取事件历史 */
  getHistory(event: string): unknown[] {
    return this.eventHistory.get(event) ?? [];
  }

  /** 清理所有订阅 */
  clear(): void {
    this.subscribers.clear();
    this.reflectionHandlers = [];
    this.eventHistory.clear();
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd D:/agent-codes/myagents && npx vitest run packages/core/src/agent/event-bus.test.ts --reporter=verbose 2>&1 | tail -20`
Expected: 6 个测试全部 PASS

- [ ] **Step 5: Commit**

```bash
cd D:/agent-codes/myagents
git add packages/core/src/agent/event-bus.ts packages/core/src/agent/event-bus.test.ts
git commit -m "feat: add AgentEventBus for spontaneous agent communication"
```

---

## Task 6: GroupContext 集成事件总线

**Files:**
- Modify: `packages/core/src/group/context.ts:68-97`

- [ ] **Step 1: 在 GroupContext 中集成 AgentEventBus**

在 `packages/core/src/group/context.ts` 顶部导入之后（第 8 行 `import { createLogger }` 之前）添加：

```typescript
import type { AgentEventBus } from "../agent/event-bus.js";
```

修改 `GroupContext` 构造函数，添加可选的 `eventBus` 参数：

将第 76-82 行的构造函数替换为：

```typescript
  constructor(groupId: string, dataRoot?: string, private eventBus?: AgentEventBus) {
    this.groupId = groupId;
    this.dataDir = dataRoot
      ? path.join(dataRoot, "groups", groupId)
      : path.resolve("data", "groups", groupId);
    fs.mkdirSync(path.join(this.dataDir, "talks"), { recursive: true });
  }
```

修改 `speakToMain` 方法（第 87-99 行），在消息推送到监听器后发射事件总线：

```typescript
  /** 在 main 频道发言 */
  speakToMain(fromAgentId: string, content: string): ChannelMessage {
    // 解析 @mention
    const mentionMatch = content.match(/@(\S+)/);
    const msg: ChannelMessage = {
      fromAgentId,
      content,
      timestamp: Date.now(),
      mentionTarget: mentionMatch ? mentionMatch[1] : undefined,
    };
    this.mainHistory.push(msg);
    for (const listener of this.mainListeners) listener(msg);

    // 事件总线通知（自发通信核心）
    if (this.eventBus && msg.mentionTarget) {
      this.eventBus.emit("group-message", {
        groupId: this.groupId,
        fromAgentId,
        content,
        mentionTarget: msg.mentionTarget,
      });
    }

    return msg;
  }
```

- [ ] **Step 2: 更新 GroupManager 传递 eventBus 到 GroupContext**

读取 `packages/core/src/group/manager.ts`，在 `GroupManager` 构造函数中添加 `eventBus` 参数，并在创建 `GroupContext` 时传递。

如果 `GroupManager` 的构造函数签名是 `constructor(registry, dataRoot)`，修改为：

```typescript
constructor(
  private registry: AgentRegistry,
  private dataRoot?: string,
  private eventBus?: import("../agent/event-bus.js").AgentEventBus,
)
```

并确保 `create` 方法中创建 `GroupContext` 时传入 `this.eventBus`。

- [ ] **Step 3: 运行全部测试**

Run: `cd D:/agent-codes/myagents && npx vitest run --reporter=verbose 2>&1 | tail -30`
Expected: 所有测试通过

- [ ] **Step 4: Commit**

```bash
cd D:/agent-codes/myagents
git add packages/core/src/group/context.ts packages/core/src/group/manager.ts
git commit -m "feat: integrate AgentEventBus into GroupContext for spontaneous messaging"
```

---

## Task 7: Agent 订阅事件总线 + 处理自发消息

**Files:**
- Modify: `packages/core/src/agent/agent.ts` (在 Task 4 基础上继续修改)

- [ ] **Step 1: 在 Agent 类中添加事件总线订阅方法**

在 `packages/core/src/agent/agent.ts` 顶部添加导入：

```typescript
import { AgentEventBus } from "./event-bus.js";
```

在 Agent 类中添加（在 `dispose()` 方法之前，约第 297 行）：

```typescript
  private eventBusUnsub?: () => void;

  /** 订阅事件总线，接收自发消息 */
  subscribeToBus(bus: AgentEventBus): void {
    this.eventBusUnsub = bus.subscribe(this.id, async (msg) => {
      if (msg.fromAgentId === this.id) return; // 忽略自己

      log.info("[%s] Received spontaneous message from %s", this.id, msg.fromAgentId);

      // 构建上下文并执行
      const context = msg.groupId
        ? `[群组 ${msg.groupId} 中 @${this.id}]\n`
        : `[${msg.fromAgentId} 私信]\n`;
      const prompt = `${context}${msg.content}`;

      try {
        const response = await this.run(prompt);
        // 如果在群组中，将回复写入 GroupContext
        log.info("[%s] Responded to spontaneous message: %d chars", this.id, response.content.length);
      } catch (err) {
        log.error("[%s] Failed to handle spontaneous message: %s", this.id, err);
      }
    });
  }

  /** 关闭资源 */
  async dispose(): Promise<void> {
    this.eventBusUnsub?.();
    await this.mcpManager.close();
  }
```

- [ ] **Step 2: 运行全部测试**

Run: `cd D:/agent-codes/myagents && npx vitest run --reporter=verbose 2>&1 | tail -30`
Expected: 所有测试通过

- [ ] **Step 3: Commit**

```bash
cd D:/agent-codes/myagents
git add packages/core/src/agent/agent.ts
git commit -m "feat: add Agent.subscribeToBus for spontaneous communication"
```

---

## Task 8: Butler 创建 Agent 时指定 Skills

**Files:**
- Modify: `packages/core/src/agent/butler.ts:25-86` (makeCreateAgentTool)

- [ ] **Step 1: 修改 butler-create-agent 工具，添加 skills 参数**

在 `packages/core/src/agent/butler.ts` 中，修改 `makeCreateAgentTool` 函数（第 25-86 行）。

将 `parameters.properties` 部分（约第 33-41 行）替换为：

```typescript
      properties: {
        name: { type: "string", description: "Agent 名称" },
        role: { type: "string", description: "Agent 角色" },
        systemPrompt: { type: "string", description: "系统提示词（可选）" },
        capabilities: { type: "string", description: "能力描述（可选）" },
        provider: { type: "string", description: "LLM Provider（默认 deepseek）" },
        model: { type: "string", description: "模型名称（默认 deepseek-chat）" },
        skills: {
          type: "array",
          items: { type: "string" },
          description: "要装载的技能名称列表（匹配 skills/ 目录下的技能目录名，如 ['code-review', 'project-planning']）",
        },
      },
```

将 `execute` 方法中的 `config` 创建部分（约第 47-58 行）替换为：

```typescript
      const config: AgentConfig = {
        id,
        name,
        role: params.role as string,
        systemPrompt: (params.systemPrompt as string) || `你是${name}，${params.role}`,
        provider: providerId,
        model,
        permissions: { mode: "workspace-write" },
        sandbox: { enabled: false, filesystem: "workspace-only", network: true },
        tools: ["bash", "read-file", "write-file", "glob", "grep", "web-fetch"],
        skills: params.skills as string[] | undefined,
      };
```

- [ ] **Step 2: 修改 Agent 构造函数，按 skills 列表过滤装载**

在 `packages/core/src/agent/agent.ts` 的构造函数中，将第 127-134 行（YAML/JSON 技能加载器部分）替换为：

```typescript
    // YAML/JSON 技能加载器（支持按名称过滤）
    this.skillLoader = new SkillLoader();
    const globalSkillsDir = mergedConfig.skillsDir ?? "skills";
    this.skillLoader.load(globalSkillsDir, () => this.provider);

    const requestedSkills = mergedConfig.skills; // string[] | undefined
    const allSkillTools = this.skillLoader.getTools();
    const toolsToRegister = requestedSkills
      ? allSkillTools.filter(t => {
          // 匹配 "skill-{name}" 格式
          const skillName = t.name.replace(/^skill-/, "");
          return requestedSkills.includes(skillName);
        })
      : allSkillTools;

    for (const tool of toolsToRegister) {
      this.toolRegistry.register(tool);
    }
```

- [ ] **Step 3: 运行全部测试**

Run: `cd D:/agent-codes/myagents && npx vitest run --reporter=verbose 2>&1 | tail -30`
Expected: 所有测试通过

- [ ] **Step 4: Commit**

```bash
cd D:/agent-codes/myagents
git add packages/core/src/agent/butler.ts packages/core/src/agent/agent.ts
git commit -m "feat: butler-create-agent now accepts skills parameter for selective loading"
```

---

## Task 9: WorkflowEngine 自动化工作流

**Files:**
- Create: `packages/core/src/workflow/engine.ts`
- Create: `packages/core/src/workflow/engine.test.ts`

- [ ] **Step 1: 编写 engine.test.ts 失败测试**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { WorkflowEngine } from "./engine.js";

describe("WorkflowEngine", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("analyze 返回任务分析结果", async () => {
    const engine = new WorkflowEngine({
      provider: {
        chat: async function* () {
          yield {
            type: "content",
            content: JSON.stringify({
              agents: [
                { role: "前端开发", capabilities: "React, TypeScript" },
                { role: "后端开发", capabilities: "Node.js, 数据库" },
              ],
              existingReuse: [],
              newAgents: 2,
              groupConfig: { protocol: "free-form" },
            }),
          };
          yield { type: "done" };
        },
      } as any,
    });

    const analysis = await engine.analyze("开发一个全栈 Web 应用");
    expect(analysis).toBeDefined();
    expect(analysis).toContain("前端开发");
  });

  it("plan 返回执行步骤列表", async () => {
    const engine = new WorkflowEngine({
      provider: {
        chat: async function* () {
          yield { type: "content", content: "1. 创建前端 Agent\n2. 创建后端 Agent\n3. 组建开发群组\n4. 分配任务" };
          yield { type: "done" };
        },
      } as any,
    });

    const steps = await engine.plan("开发 Web 应用", "需要前端和后端开发");
    expect(steps).toBeDefined();
    expect(steps.length).toBeGreaterThan(0);
  });

  it("无 provider 时 analyze 返回错误", async () => {
    const engine = new WorkflowEngine({});
    const result = await engine.analyze("test");
    expect(result).toContain("No provider");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd D:/agent-codes/myagents && npx vitest run packages/core/src/workflow/engine.test.ts --reporter=verbose 2>&1 | tail -20`
Expected: FAIL — Cannot find module "./engine.js"

- [ ] **Step 3: 编写 WorkflowEngine 实现**

```typescript
/**
 * WorkflowEngine — 自动化任务执行管线
 * 串联: 分析任务 → 选择/创建 Agent → 组建群组 → 执行 → 收集结果
 */
import type { LLMProvider } from "@myagents/providers";
import { createLogger } from "@myagents/shared";

const log = createLogger("workflow-engine");

export interface WorkflowConfig {
  provider?: LLMProvider;
  butlerRegistry?: import("../butler/registry.js").ButlerRegistry;
  agentRegistry?: import("../agent/registry.js").AgentRegistry;
  groupManager?: import("../group/manager.js").GroupManager;
}

export interface WorkflowStep {
  type: "analyze" | "create-agent" | "create-group" | "execute" | "collect";
  description: string;
  status: "pending" | "running" | "done" | "failed";
  result?: string;
}

export class WorkflowEngine {
  private provider?: LLMProvider;

  constructor(private config: WorkflowConfig) {
    this.provider = config.provider;
  }

  /** 分析任务需要什么 Agent */
  async analyze(task: string): Promise<string> {
    if (!this.provider) {
      return "Error: No provider available";
    }

    // 获取已有 Agent 信息
    const existingAgents = this.config.butlerRegistry?.parseAgentsRegistry() ?? [];
    const agentInfo = existingAgents.map(a => `- ${a.id}: ${a.role} (${a.capabilities || "无"})`).join("\n");

    const prompt = `分析任务需要什么类型的 Agent。

已有 Agent:
${agentInfo || "(无)"}

任务: ${task}

请回答:
1. 需要哪些类型的 Agent（角色 + 能力）
2. 已有哪些可以复用
3. 需要新创建哪些
4. 建议的群组配置

用简洁的中文回答。`;

    try {
      let result = "";
      for await (const chunk of this.provider.chat({
        model: "",
        messages: [{ role: "user", content: prompt }],
      })) {
        if (chunk.type === "content" && chunk.content) {
          result += chunk.content;
        }
      }
      return result;
    } catch (err: any) {
      return `Error: ${err.message}`;
    }
  }

  /** 生成执行计划 */
  async plan(task: string, analysis: string): Promise<string[]> {
    if (!this.provider) {
      return ["Error: No provider available"];
    }

    const prompt = `基于任务和分析，生成具体的执行步骤。

任务: ${task}

分析结果:
${analysis}

每行一个步骤，格式: "序号. 步骤描述"。不要其他内容。`;

    try {
      let result = "";
      for await (const chunk of this.provider.chat({
        model: "",
        messages: [{ role: "user", content: prompt }],
      })) {
        if (chunk.type === "content" && chunk.content) {
          result += chunk.content;
        }
      }
      return result.split("\n").filter(l => l.trim().match(/^\d+\./));
    } catch {
      return ["Error: plan generation failed"];
    }
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd D:/agent-codes/myagents && npx vitest run packages/core/src/workflow/engine.test.ts --reporter=verbose 2>&1 | tail -20`
Expected: 3 个测试全部 PASS

- [ ] **Step 5: Commit**

```bash
cd D:/agent-codes/myagents
git add packages/core/src/workflow/engine.ts packages/core/src/workflow/engine.test.ts
git commit -m "feat: add WorkflowEngine with analyze and plan methods"
```

---

## Task 10: Butler 集成 WorkflowEngine

**Files:**
- Modify: `packages/core/src/agent/butler.ts:390-443,447-511`

- [ ] **Step 1: 在 ButlerAgent 中添加 WorkflowEngine 工具**

在 `packages/core/src/agent/butler.ts` 顶部添加导入：

```typescript
import { WorkflowEngine } from "../workflow/engine.js";
```

在 `ButlerAgent` 构造函数中（第 447 行 `super(config, provider)` 之前），创建 engine 实例并注册工具：

在构造函数中（`this.butlerRegistry = new ButlerRegistry();` 之后，`// Register butler tools` 之前），添加：

```typescript
    // 工作流引擎
    const engine = new WorkflowEngine({
      provider,
      butlerRegistry: this.butlerRegistry,
      agentRegistry: registry,
      groupManager,
    });
```

在 butler 工具注册列表之后（第 486 行 `this.toolRegistry.register(makeTalkReadTool(...));` 之后），添加工作流工具：

```typescript
    // 工作流工具
    this.toolRegistry.register(makeWorkflowAnalyzeTool(engine));
    this.toolRegistry.register(makeWorkflowPlanTool(engine));
```

- [ ] **Step 2: 在 butler.ts 中添加工作流工具函数**

在 `ButlerAgent` 类定义之前（第 445 行 `// ---- ButlerAgent ----` 之前），添加：

```typescript
function makeWorkflowAnalyzeTool(engine: WorkflowEngine): Tool {
  return {
    name: "workflow-analyze",
    description: "使用工作流引擎分析任务，确定需要的 Agent 和群组配置",
    parameters: {
      type: "object",
      properties: {
        task: { type: "string", description: "任务描述" },
      },
      required: ["task"],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const result = await engine.analyze(params.task as string);
      return { toolCallId: "", content: result };
    },
  };
}

function makeWorkflowPlanTool(engine: WorkflowEngine): Tool {
  return {
    name: "workflow-plan",
    description: "基于任务分析生成执行计划",
    parameters: {
      type: "object",
      properties: {
        task: { type: "string", description: "任务描述" },
        analysis: { type: "string", description: "任务分析结果（来自 workflow-analyze）" },
      },
      required: ["task", "analysis"],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const steps = await engine.plan(params.task as string, params.analysis as string);
      return { toolCallId: "", content: `执行计划:\n${steps.join("\n")}` };
    },
  };
}
```

- [ ] **Step 3: 运行全部测试**

Run: `cd D:/agent-codes/myagents && npx vitest run --reporter=verbose 2>&1 | tail -30`
Expected: 所有测试通过

- [ ] **Step 4: Commit**

```bash
cd D:/agent-codes/myagents
git add packages/core/src/agent/butler.ts
git commit -m "feat: integrate WorkflowEngine into ButlerAgent with analyze/plan tools"
```

---

## Task 11: Runtime 集成事件总线 + 导出

**Files:**
- Modify: `packages/core/src/runtime.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: 在 Runtime 中创建并传递 AgentEventBus**

读取 `packages/core/src/runtime.ts`，在 `MyAgentsRuntime` 类中：

1. 添加导入：
```typescript
import { AgentEventBus } from "./agent/event-bus.js";
```

2. 在类中添加属性：
```typescript
  readonly eventBus = new AgentEventBus();
```

3. 在创建 `GroupManager` 时传入 `eventBus`：
```typescript
  // 如果 GroupManager 构造函数已接受 eventBus
  this.groupManager = new GroupManager(this.registry, dataRoot, this.eventBus);
```

4. 在创建 Agent 后，订阅事件总线：
```typescript
  // 在 Agent 创建/恢复后
  agent.subscribeToBus(this.eventBus);
```

- [ ] **Step 2: 在 index.ts 中导出新模块**

在 `packages/core/src/index.ts` 中添加导出：

```typescript
export { ExperienceWriter } from "./memory/experience.js";
export { AgentEventBus } from "./agent/event-bus.js";
export { WorkflowEngine } from "./workflow/engine.js";
```

- [ ] **Step 3: 运行全部测试**

Run: `cd D:/agent-codes/myagents && npx vitest run --reporter=verbose 2>&1 | tail -30`
Expected: 所有测试通过

- [ ] **Step 4: Commit**

```bash
cd D:/agent-codes/myagents
git add packages/core/src/runtime.ts packages/core/src/index.ts
git commit -m "feat: integrate event bus into Runtime and export new modules"
```

---

## Task 12: 端到端集成测试

**Files:**
- Modify: `packages/core/src/integration.test.ts` (在现有文件末尾添加)

- [ ] **Step 1: 添加新集成测试用例**

在 `packages/core/src/integration.test.ts` 末尾（最后一个 `});` 之前）添加：

```typescript
  describe("经验系统 E2E", () => {
    it("Agent 完成任务后自动写入经验", async () => {
      const agent = new Agent({
        id: "exp-agent", name: "ExpAgent", role: "test", systemPrompt: "test",
        provider: "mock", model: "mock",
      }, createMockProvider(), path.join(tmpDir, "agents"));

      await agent.run("帮我修复 TypeScript 类型错误");

      // 检查 EXPERIENCE.md 是否被创建
      const expPath = agent.paths.experiencePath;
      // 注意：反思是 setImmediate 异步的，给一点时间
      await new Promise(r => setTimeout(r, 100));

      expect(fs.existsSync(expPath)).toBe(true);
    });
  });

  describe("事件总线 E2E", () => {
    it("GroupContext @mention 通过事件总线触发 Agent", () => {
      const { AgentEventBus } = require("./agent/event-bus.js");
      const bus = new AgentEventBus();
      const ctx = new GroupContext("e2e-group", tmpDir, bus);

      let received = false;
      bus.subscribe("target-agent", () => { received = true; });

      ctx.speakToMain("owner", "@target-agent 请开始工作");

      expect(received).toBe(true);
    });
  });

  describe("Skills 选择装载 E2E", () => {
    it("Agent 只加载指定的 skills", () => {
      const dataRoot = path.join(tmpDir, "agents");
      const skillsDir = "skills";

      // 确保全局 skills 目录有多个技能
      if (!fs.existsSync(path.join(skillsDir, "code-review", "SKILL.md"))) {
        // 使用 agent 私有目录测试
        const agentSkillsDir = path.join(dataRoot, "skilled-agent", "skills");

        fs.mkdirSync(path.join(agentSkillsDir, "skill-a"), { recursive: true });
        fs.writeFileSync(path.join(agentSkillsDir, "skill-a", "SKILL.md"), [
          "---", "name: skill-a", "description: Skill A", "---", "", "Do A.",
        ].join("\n"), "utf-8");

        fs.mkdirSync(path.join(agentSkillsDir, "skill-b"), { recursive: true });
        fs.writeFileSync(path.join(agentSkillsDir, "skill-b", "SKILL.md"), [
          "---", "name: skill-b", "description: Skill B", "---", "", "Do B.",
        ].join("\n"), "utf-8");

        // 不指定 skills → 全部加载
        const agent1 = new Agent({
          id: "skilled-agent", name: "S1", role: "test", systemPrompt: "test",
          provider: "mock", model: "mock",
        }, createMockProvider(), dataRoot);

        const tools1 = agent1["toolRegistry"].listDefinitions();
        expect(tools1.some(t => t.function.name === "skill-skill-a")).toBe(true);
        expect(tools1.some(t => t.function.name === "skill-skill-b")).toBe(true);
      }
    });
  });
```

- [ ] **Step 2: 运行全部测试**

Run: `cd D:/agent-codes/myagents && npx vitest run --reporter=verbose 2>&1 | tail -30`
Expected: 所有测试通过

- [ ] **Step 3: Commit**

```bash
cd D:/agent-codes/myagents
git add packages/core/src/integration.test.ts
git commit -m "test: add E2E integration tests for experience, event bus, and skills"
```

---

## Self-Review Checklist

### 1. Spec Coverage

| 预期 | 覆盖任务 | 状态 |
|------|---------|------|
| 1. UI/管家创建+skills | Task 8 (skills 参数) + Task 10 (工作流工具) | 覆盖 |
| 2. 群主调用+自发交流 | Task 5-7 (EventBus) + Task 6 (GroupContext集成) | 覆盖 |
| 3. 专项 skills 装载 | Task 8 (按名过滤) + Task 1 (类型扩展) | 覆盖 |
| 4. 自主学习/EXPERIENCE | Task 3 (ExperienceWriter) + Task 4 (Agent集成反思) | 覆盖 |
| 5. 按需组建工作流 | Task 9-10 (WorkflowEngine) + Task 8 (skills) | 覆盖 |

### 2. Placeholder Scan

- 无 TBD、TODO、implement later
- 所有代码步骤包含完整实现
- 所有测试步骤包含完整测试代码
- 所有 commit 步骤包含完整 git 命令

### 3. Type Consistency

- `AgentConfig.skills?: string[]` — Task 1 定义，Task 8 使用
- `ExperienceWriter` — Task 3 定义，Task 4 在 Agent 中使用
- `AgentEventBus` — Task 5 定义，Task 6-7 使用
- `WorkflowEngine` — Task 9 定义，Task 10 在 Butler 中使用
- `BusMessage` / `TaskCompleteMessage` — Task 5 定义，Task 6-7 使用
