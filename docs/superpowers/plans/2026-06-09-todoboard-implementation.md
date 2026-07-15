# TODOboard 全局与群组协作 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现三层 TODOboard（Global/Group/Agent），让 Butler 具备跨群组任务编排能力，核心亮点是自动续作——任务承担 Agent 完成 TODO 后判断是否生成后续任务。

**Architecture:** 5 个 Phase 顺序推进。Phase 1 建数据模型（GlobalTodoItem + GlobalTodoStore），Phase 2 给 Butler 注册 5 个编排工具，Phase 3 打通 Group/Agent 完成事件到 Global 的回传链路，Phase 4 实现自动续作判断核心，Phase 5 做前端 UX（Butler 左侧栏 + Agent TODO 条件显示）。

**Tech Stack:** TypeScript, Node.js (JSON file store), React + Zustand (frontend), Vitest (testing)

**Spec:** `docs/superpowers/specs/2026-06-09-todoboard-implementation-design.md`

---

## File Structure

```
packages/core/src/todo/
├── types.ts                          # Modify: add GlobalTodoItem, extend TodoScope, extend TodoItem.onComplete
├── store.ts                          # Unchanged
├── global-store.ts                   # CREATE: GlobalTodoStore class
├── global-store.test.ts              # CREATE: GlobalTodoStore tests
├── scanner.ts                        # Unchanged
├── group-scanner.ts                  # Modify: complete() enhancement (Phase 3 + 4)
├── tools.ts                          # Modify: tool description updates (Phase 4)
├── global-tools.ts                   # CREATE: 5 Butler orchestration tools
├── global-tools.test.ts              # CREATE: tool tests
├── continuation-judgment.ts          # CREATE: auto-continuation core
└── continuation-judgment.test.ts     # CREATE: continuation tests

packages/core/src/
├── index.ts                          # Modify: exports (Phase 1 + 2)
├── runtime.ts                        # Modify: init GlobalTodoStore, expose (Phase 1-3)
├── agent/butler.ts                   # Modify: register 5 tools (Phase 2)
└── api/ws-server.ts                  # Modify: get_global_todos, fix get_group_health (Phase 3), broadcast (Phase 5)

gui-v2/src/
├── components/todo/GlobalTodoPanel.tsx  # CREATE: Butler sidebar panel
├── components/layout/Sidebar.tsx        # Modify: show GlobalTodoPanel for butler view
├── components/chat/ChatView.tsx         # Modify: conditional TodoPanelInline
├── hooks/useWebSocket.ts                # Modify: handle global_todos events
├── stores/todo.ts                       # Modify: add globalTodos state
└── lib/types.ts                         # Modify: add GlobalTodoInfo type
```

---

## Phase 1: Global TODO 数据模型

### Task 1.1: 新增 GlobalTodoItem 类型 + 扩展 TodoScope

**Files:**
- Modify: `packages/core/src/todo/types.ts`

- [ ] **Step 1: 在 types.ts 末尾追加 GlobalTodoItem 接口和扩展 TodoScope**

在 `packages/core/src/todo/types.ts` 的 `OVERDUE_THRESHOLD_MS` 导出之后追加：

```ts
// ============ Global TODO ============

export interface GlobalTodoItem {
  id: string;
  goal: string;
  description: string;
  status: "pending" | "running" | "waiting_user" | "completed" | "cancelled";

  assigneeType: "butler" | "agent" | "group";
  assigneeId?: string;
  responsibleAgentId?: string;

  automationPolicy: {
    autoDispatch: boolean;
    autoMonitor: boolean;
    autoEscalate: boolean;
    autoArchive: boolean;
    autoContinue: boolean;
  };

  continuationPolicy?: {
    mode: "none" | "request_coordinator" | "auto_generate" | "ask_user";
    maxDepth?: number;
    stopWhen?: string;
    nextCheckHint?: string;
  };

  executionRefs: Array<{
    scope: "agent" | "group";
    id: string;
    todoIds?: string[];
    messageIds?: string[];
  }>;

  progressSummary: string;
  nextAction: string;
  lastEvent?: { type: string; summary: string; at: string };

  internalBlocker?: {
    type: "missing_info" | "dependency" | "resource" | "tool_error" | "agent_stalled";
    summary: string;
    since: string;
  };

  createdAt: string;
  updatedAt: string;
}
```

同时修改 `TodoScope` 类型定义（文件顶部附近）：

```ts
// 旧：
export type TodoScope = "agent" | "group";
// 新：
export type TodoScope = "agent" | "group" | "global";
```

- [ ] **Step 2: 验证类型编译**

```powershell
cd CoBeing; node_modules\.bin\tsc.cmd -p packages\core\tsconfig.json --noEmit
```

Expected: 零新增错误。

---

### Task 1.2: 创建 GlobalTodoStore 类

**Files:**
- Create: `packages/core/src/todo/global-store.ts`

- [ ] **Step 1: 编写 GlobalTodoStore**

```ts
// packages/core/src/todo/global-store.ts
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createLogger } from "@cobeing/shared";
import type { GlobalTodoItem } from "./types.js";

const log = createLogger("global-todo-store");

export class GlobalTodoStore {
  private filePath: string;

  constructor(baseDir: string, filename = "global-todos.json") {
    this.filePath = path.join(baseDir, filename);
  }

  /** 列出所有 Global TODO，可选按状态筛选 */
  list(statusFilter?: GlobalTodoItem["status"]): GlobalTodoItem[] {
    const items = this.readAll();
    if (statusFilter) return items.filter(i => i.status === statusFilter);
    return items;
  }

  /** 获取单条 */
  get(id: string): GlobalTodoItem | undefined {
    return this.readAll().find(i => i.id === id);
  }

  /** 新增 */
  add(input: Omit<GlobalTodoItem, "id" | "createdAt" | "updatedAt">): GlobalTodoItem {
    const now = new Date().toISOString();
    const item: GlobalTodoItem = {
      ...input,
      id: randomUUID(),
      progressSummary: input.progressSummary || "",
      nextAction: input.nextAction || "",
      executionRefs: input.executionRefs || [],
      automationPolicy: input.automationPolicy || {
        autoDispatch: true,
        autoMonitor: true,
        autoEscalate: true,
        autoArchive: true,
        autoContinue: true,
      },
      createdAt: now,
      updatedAt: now,
    };
    const items = this.readAll();
    items.push(item);
    this.writeAll(items);
    log.info("Global TODO added: %s (%s)", item.id, item.goal);
    return item;
  }

  /** 更新（部分字段） */
  update(id: string, patch: Partial<GlobalTodoItem>): GlobalTodoItem | undefined {
    const items = this.readAll();
    const idx = items.findIndex(i => i.id === id);
    if (idx < 0) return undefined;
    items[idx] = { ...items[idx], ...patch, updatedAt: new Date().toISOString() };
    this.writeAll(items);
    return items[idx];
  }

  /** 删除 */
  remove(id: string): boolean {
    const items = this.readAll();
    const idx = items.findIndex(i => i.id === id);
    if (idx < 0) return false;
    items.splice(idx, 1);
    this.writeAll(items);
    return true;
  }

  /** 按指派对象查找 */
  getByAssignee(type: string, id: string): GlobalTodoItem[] {
    return this.readAll().filter(i => i.assigneeType === type && i.assigneeId === id);
  }

  /** 按执行引用查找（反向：哪些 Global TODO 引用了某个 Group/Agent） */
  getByExecutionRef(scope: string, id: string): GlobalTodoItem[] {
    return this.readAll().filter(i =>
      i.executionRefs.some(ref => ref.scope === scope && ref.id === id)
    );
  }

  /** 获取所有等待用户的 TODO */
  getWaitingUser(): GlobalTodoItem[] {
    return this.readAll().filter(i => i.status === "waiting_user");
  }

  /** 获取停滞任务（updatedAt 超过指定小时数且状态为 running） */
  getStalled(hoursThreshold: number): GlobalTodoItem[] {
    const cutoff = Date.now() - hoursThreshold * 3600000;
    return this.readAll().filter(i =>
      i.status === "running" && new Date(i.updatedAt).getTime() < cutoff
    );
  }

  /** 设置状态 */
  setStatus(id: string, status: GlobalTodoItem["status"]): boolean {
    return !!this.update(id, { status });
  }

  /** 设置阻塞信息 */
  setBlocker(id: string, blocker: GlobalTodoItem["internalBlocker"]): boolean {
    return !!this.update(id, { internalBlocker: blocker });
  }

  /** 清除阻塞 */
  clearBlocker(id: string): boolean {
    return !!this.update(id, { internalBlocker: undefined });
  }

  /** 添加执行引用 */
  addExecutionRef(id: string, ref: GlobalTodoItem["executionRefs"][0]): boolean {
    const item = this.get(id);
    if (!item) return false;
    const existing = item.executionRefs.findIndex(
      r => r.scope === ref.scope && r.id === ref.id
    );
    if (existing >= 0) {
      // merge todoIds
      const merged = [...new Set([...(item.executionRefs[existing].todoIds || []), ...(ref.todoIds || [])])];
      item.executionRefs[existing] = { ...item.executionRefs[existing], todoIds: merged };
    } else {
      item.executionRefs.push(ref);
    }
    return !!this.update(id, { executionRefs: item.executionRefs });
  }

  // ---- Private ----

  private readAll(): GlobalTodoItem[] {
    try {
      if (!fs.existsSync(this.filePath)) return [];
      const raw = fs.readFileSync(this.filePath, "utf-8").trim();
      if (!raw) return [];
      const data = JSON.parse(raw);
      return Array.isArray(data) ? data : [];
    } catch (err: any) {
      log.error("Failed to read Global TODO file %s: %s", this.filePath, err.message);
      return [];
    }
  }

  private writeAll(items: GlobalTodoItem[]): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmpPath = this.filePath + ".tmp";
    fs.writeFileSync(tmpPath, JSON.stringify(items, null, 2), "utf-8");
    fs.renameSync(tmpPath, this.filePath);
  }
}
```

- [ ] **Step 2: 验证编译**

```powershell
cd CoBeing; node_modules\.bin\tsc.cmd -p packages\core\tsconfig.json --noEmit
```

Expected: 零新增错误。

---

### Task 1.3: 编写 GlobalTodoStore 单元测试

**Files:**
- Create: `packages/core/src/todo/global-store.test.ts`

- [ ] **Step 1: 编写测试文件**

```ts
// packages/core/src/todo/global-store.test.ts
import { describe, it, beforeEach, afterEach } from "vitest";
import * as assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { GlobalTodoStore } from "./global-store.js";
import type { GlobalTodoItem } from "./types.js";

describe("GlobalTodoStore", () => {
  let testDir: string;
  let store: GlobalTodoStore;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "global-todo-test-"));
    store = new GlobalTodoStore(testDir);
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  // === CRUD ===

  it("adds and retrieves a global todo", () => {
    const item = store.add({
      goal: "规划日本旅行",
      description: "用户希望七月去日本",
      assigneeType: "group",
      assigneeId: "travel-group",
      status: "pending",
      automationPolicy: { autoDispatch: true, autoMonitor: true, autoEscalate: true, autoArchive: true, autoContinue: true },
      progressSummary: "",
      nextAction: "派发给 travel-group",
    });

    assert.ok(item.id);
    assert.equal(item.goal, "规划日本旅行");
    assert.equal(item.status, "pending");
    assert.ok(item.createdAt);
    assert.ok(item.updatedAt);

    const retrieved = store.get(item.id);
    assert.ok(retrieved);
    assert.equal(retrieved!.goal, "规划日本旅行");
  });

  it("lists all todos", () => {
    store.add(makeTodo("task1", "pending"));
    store.add(makeTodo("task2", "running"));
    store.add(makeTodo("task3", "completed"));

    assert.equal(store.list().length, 3);
  });

  it("lists by status filter", () => {
    store.add(makeTodo("task1", "pending"));
    store.add(makeTodo("task2", "running"));
    store.add(makeTodo("task3", "pending"));

    const pending = store.list("pending");
    assert.equal(pending.length, 2);
    assert.equal(store.list("running").length, 1);
    assert.equal(store.list("completed").length, 0);
  });

  it("updates a todo", () => {
    const item = store.add(makeTodo("test", "pending"));
    const updated = store.update(item.id, { status: "running", progressSummary: "已派发" });

    assert.ok(updated);
    assert.equal(updated!.status, "running");
    assert.equal(updated!.progressSummary, "已派发");

    const retrieved = store.get(item.id);
    assert.equal(retrieved!.status, "running");
  });

  it("removes a todo", () => {
    const item = store.add(makeTodo("test", "pending"));
    assert.equal(store.list().length, 1);

    const ok = store.remove(item.id);
    assert.ok(ok);
    assert.equal(store.list().length, 0);
    assert.equal(store.remove(item.id), false);
  });

  it("returns undefined for non-existent todo", () => {
    assert.equal(store.get("nonexistent"), undefined);
    assert.equal(store.update("nonexistent", { status: "running" }), undefined);
  });

  // === Queries ===

  it("getByAssignee filters by type and id", () => {
    store.add(makeTodo("g1", "running", "group", "travel-group"));
    store.add(makeTodo("g2", "pending", "group", "travel-group"));
    store.add(makeTodo("a1", "running", "agent", "agent-1"));

    const groupTodos = store.getByAssignee("group", "travel-group");
    assert.equal(groupTodos.length, 2);
    const agentTodos = store.getByAssignee("agent", "agent-1");
    assert.equal(agentTodos.length, 1);
  });

  it("getByExecutionRef finds reverse references", () => {
    const item = store.add({
      ...makeTodo("linked", "running", "group", "g1"),
      executionRefs: [
        { scope: "group", id: "g1", todoIds: ["t1", "t2"] },
        { scope: "agent", id: "a1", todoIds: ["t3"] },
      ],
    });

    const groupRefs = store.getByExecutionRef("group", "g1");
    assert.equal(groupRefs.length, 1);
    assert.equal(groupRefs[0].id, item.id);

    const agentRefs = store.getByExecutionRef("agent", "a1");
    assert.equal(agentRefs.length, 1);
  });

  it("getWaitingUser returns only waiting_user", () => {
    store.add(makeTodo("w1", "waiting_user"));
    store.add(makeTodo("w2", "running"));
    store.add(makeTodo("w3", "waiting_user"));

    const waiting = store.getWaitingUser();
    assert.equal(waiting.length, 2);
    assert.equal(waiting[0].status, "waiting_user");
  });

  it("getStalled returns long-unupdated running todos", () => {
    const item = store.add(makeTodo("stale", "running"));
    // Manually set updatedAt to 3 hours ago
    store.update(item.id, {
      updatedAt: new Date(Date.now() - 3 * 3600000).toISOString(),
    } as any);

    const stalled = store.getStalled(2); // 2 hour threshold
    assert.equal(stalled.length, 1);
  });

  // === Status transitions ===

  it("setStatus transitions status", () => {
    const item = store.add(makeTodo("test", "pending"));
    assert.ok(store.setStatus(item.id, "running"));
    assert.equal(store.get(item.id)!.status, "running");
  });

  it("setBlocker and clearBlocker", () => {
    const item = store.add(makeTodo("test", "running"));
    const blocker = { type: "agent_stalled" as const, summary: "Agent 无响应", since: new Date().toISOString() };

    assert.ok(store.setBlocker(item.id, blocker));
    assert.deepEqual(store.get(item.id)!.internalBlocker?.summary, "Agent 无响应");

    assert.ok(store.clearBlocker(item.id));
    assert.equal(store.get(item.id)!.internalBlocker, undefined);
  });

  // === Execution refs ===

  it("addExecutionRef adds new ref", () => {
    const item = store.add(makeTodo("test", "running"));
    assert.ok(store.addExecutionRef(item.id, { scope: "group", id: "g1", todoIds: ["t1"] }));

    const updated = store.get(item.id);
    assert.equal(updated!.executionRefs.length, 1);
    assert.equal(updated!.executionRefs[0].id, "g1");
  });

  it("addExecutionRef merges with existing ref for same scope+id", () => {
    const item = store.add({
      ...makeTodo("test", "running"),
      executionRefs: [{ scope: "group", id: "g1", todoIds: ["t1"] }],
    });

    store.addExecutionRef(item.id, { scope: "group", id: "g1", todoIds: ["t2"] });

    const updated = store.get(item.id);
    assert.equal(updated!.executionRefs.length, 1);
    assert.deepEqual(updated!.executionRefs[0].todoIds, ["t1", "t2"]);
  });

  it("addExecutionRef returns false for non-existent todo", () => {
    assert.equal(store.addExecutionRef("nonexistent", { scope: "group", id: "g1" }), false);
  });
});

// Test helper
function makeTodo(
  goal: string,
  status: GlobalTodoItem["status"],
  assigneeType: GlobalTodoItem["assigneeType"] = "group",
  assigneeId = "g1",
): Omit<GlobalTodoItem, "id" | "createdAt" | "updatedAt"> {
  return {
    goal,
    description: `Description for ${goal}`,
    status,
    assigneeType,
    assigneeId,
    automationPolicy: { autoDispatch: true, autoMonitor: true, autoEscalate: true, autoArchive: true, autoContinue: true },
    progressSummary: "",
    nextAction: "",
  };
}
```

- [ ] **Step 2: 运行测试**

```powershell
cd CoBeing; node_modules\.bin\vitest.cmd run packages/core/src/todo/global-store.test.ts
```

Expected: 所有测试通过。

- [ ] **Step 3: 运行全量测试确保无回归**

```powershell
cd CoBeing; node_modules\.bin\vitest.cmd run
```

Expected: 所有现有测试通过 + 新增测试通过。

---

### Task 1.4: 在 runtime.ts 中初始化 GlobalTodoStore

**Files:**
- Modify: `packages/core/src/runtime.ts`

- [ ] **Step 1: 导入 GlobalTodoStore，新增字段，构造函数中初始化**

在 `packages/core/src/runtime.ts` 顶部添加导入：

```ts
import { GlobalTodoStore } from "./todo/global-store.js";
```

在 `CoBeingRuntime` 类中添加字段（在 `private todoScanner` 之后）：

```ts
readonly globalTodoStore: GlobalTodoStore;
```

在构造函数中初始化（在 `this.observabilityDB` 初始化之后添加）：

```ts
// 初始化 Global TODO Store（Butler 编排层）
this.globalTodoStore = new GlobalTodoStore(
  path.join(this.dataRoot, "coreagents", "butler")
);
```

- [ ] **Step 2: 验证编译 + 测试**

```powershell
cd CoBeing; node_modules\.bin\tsc.cmd -p packages\core\tsconfig.json --noEmit
cd CoBeing; node_modules\.bin\vitest.cmd run
```

Expected: 编译通过，测试通过。

---

### Task 1.5: 更新 index.ts 导出

**Files:**
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: 确认导出**

检查 `packages/core/src/index.ts` 是否已包含以下行。如果 Line 53 已有 `export { GlobalTodoStore } from "./todo/global-store.js";`，则添加类型导出：

```ts
// 在现有 TodoItem/TodoScope 导出行修改：
export type { TodoItem, TodoScope, GlobalTodoItem } from "./todo/types.js";
```

- [ ] **Step 2: 验证编译**

```powershell
cd CoBeing; node_modules\.bin\tsc.cmd -p packages\core\tsconfig.json --noEmit
```

Expected: 零错误。

---

## Phase 2: Butler 编排工具

### Task 2.1: 创建 global-tools.ts（5 个工具工厂函数）

**Files:**
- Create: `packages/core/src/todo/global-tools.ts`

- [ ] **Step 1: 编写工具文件**

```ts
// packages/core/src/todo/global-tools.ts
import type { Tool, ToolContext, ToolResult } from "@cobeing/shared";
import { createLogger } from "@cobeing/shared";
import type { GlobalTodoStore } from "./global-store.js";
import type { GlobalTodoItem } from "./types.js";

const log = createLogger("global-todo-tools");

// ============ global-todo-add ============

export function makeGlobalTodoAddTool(store: GlobalTodoStore): Tool {
  return {
    name: "global-todo-add",
    description:
      "创建一个全局跟踪任务（Global TODO）。当你（Butler）判断用户的目标需要跨群组、跨 Agent 或长期跟踪时使用。" +
      "创建后，系统会自动监控进度、升级阻塞、并在完成后触发续作判断。",
    parameters: {
      type: "object",
      properties: {
        goal: { type: "string", description: "用户目标（简短、可执行的描述）" },
        description: { type: "string", description: "详细说明：为什么需要跟踪、期望结果" },
        assigneeType: {
          type: "string",
          enum: ["butler", "agent", "group"],
          description: "初始指派对象类型",
        },
        assigneeId: { type: "string", description: "指派对象的 ID（agentId 或 groupId）" },
        responsibleAgentId: {
          type: "string",
          description: "负责执行和续作判断的 Agent ID。如果是群组任务，指定群组内的实际执行者",
        },
        autoDispatch: { type: "boolean", description: "允许自动派发（默认 true）" },
        autoMonitor: { type: "boolean", description: "允许自动监控（默认 true）" },
        autoEscalate: { type: "boolean", description: "允许自动升级（默认 true）" },
        autoArchive: { type: "boolean", description: "完成后自动回收（默认 true）" },
        autoContinue: { type: "boolean", description: "允许任务承担者自动续作（默认 true）" },
        continuationMode: {
          type: "string",
          enum: ["none", "request_coordinator", "auto_generate", "ask_user"],
          description: "续作模式：none=不续作, request_coordinator=请求协调者, auto_generate=自动生成, ask_user=询问用户",
        },
        maxDepth: { type: "number", description: "最大续作深度（限制自动生成任务链长度）" },
        stopWhen: { type: "string", description: "停止续作的条件描述" },
      },
      required: ["goal", "description"],
    },
    async execute(params, _ctx: ToolContext): Promise<ToolResult> {
      const item = store.add({
        goal: params.goal as string,
        description: params.description as string,
        status: "pending",
        assigneeType: (params.assigneeType as GlobalTodoItem["assigneeType"]) || "butler",
        assigneeId: params.assigneeId as string,
        responsibleAgentId: params.responsibleAgentId as string,
        automationPolicy: {
          autoDispatch: params.autoDispatch !== false,
          autoMonitor: params.autoMonitor !== false,
          autoEscalate: params.autoEscalate !== false,
          autoArchive: params.autoArchive !== false,
          autoContinue: params.autoContinue !== false,
        },
        continuationPolicy: params.continuationMode
          ? {
              mode: params.continuationMode as GlobalTodoItem["continuationPolicy"]["mode"],
              maxDepth: params.maxDepth as number,
              stopWhen: params.stopWhen as string,
            }
          : undefined,
        progressSummary: "已创建，等待派发",
        nextAction: params.assigneeId
          ? `派发给 ${params.assigneeType} ${params.assigneeId}`
          : "需要 Butler 决定派发对象",
      });

      log.info("Global TODO created: %s → %s/%s", item.id, item.goal, item.assigneeType, item.assigneeId);
      return {
        toolCallId: "",
        content: `✅ 已创建全局任务 "${item.goal}" (ID: ${item.id})\n状态: ${item.status}\n下一步: ${item.nextAction}`,
      };
    },
  };
}

// ============ global-todo-list ============

export function makeGlobalTodoListTool(store: GlobalTodoStore): Tool {
  return {
    name: "global-todo-list",
    description: "列出全局跟踪任务。可按状态、指派对象筛选，也可只看等待用户处理的任务。",
    parameters: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["pending", "running", "waiting_user", "completed", "cancelled"],
          description: "按状态筛选",
        },
        assigneeType: {
          type: "string",
          enum: ["butler", "agent", "group"],
          description: "按指派对象类型筛选",
        },
        assigneeId: { type: "string", description: "按指派对象 ID 筛选" },
        waitingUser: { type: "boolean", description: "仅列出等待用户处理的任务" },
        stalled: { type: "number", description: "列出停滞超过 N 小时的任务" },
      },
    },
    async execute(params, _ctx: ToolContext): Promise<ToolResult> {
      let items: GlobalTodoItem[];

      if (params.waitingUser) {
        items = store.getWaitingUser();
      } else if (params.stalled) {
        items = store.getStalled(params.stalled as number);
      } else if (params.assigneeType && params.assigneeId) {
        items = store.getByAssignee(params.assigneeType as string, params.assigneeId as string);
      } else {
        items = store.list(params.status as GlobalTodoItem["status"]);
      }

      if (items.length === 0) return { toolCallId: "", content: "没有匹配的全局任务。" };

      const lines = items.map(i => {
        const statusLabel =
          i.status === "running" ? "🟢 执行中" :
          i.status === "waiting_user" ? "🟡 等待用户" :
          i.status === "completed" ? "✅ 已完成" :
          i.status === "cancelled" ? "❌ 已取消" : "⚪ 待派发";

        let line = `[${statusLabel}] ${i.goal} (ID: ${i.id})\n  指派: ${i.assigneeType}/${i.assigneeId || "未指定"}`;
        if (i.responsibleAgentId) line += `\n  负责人: ${i.responsibleAgentId}`;
        if (i.nextAction) line += `\n  下一步: ${i.nextAction}`;
        if (i.lastEvent) line += `\n  最近事件: ${i.lastEvent.summary}`;
        if (i.internalBlocker) line += `\n  ⚠ 阻塞: ${i.internalBlocker.summary}`;
        return line;
      });
      return { toolCallId: "", content: `全局任务 (${items.length} 条):\n\n${lines.join("\n\n")}` };
    },
  };
}

// ============ global-todo-update ============

export function makeGlobalTodoUpdateTool(store: GlobalTodoStore): Tool {
  return {
    name: "global-todo-update",
    description: "更新全局任务的状态、进度摘要、下一步行动或阻塞信息。",
    parameters: {
      type: "object",
      properties: {
        todoId: { type: "string", description: "全局 TODO ID" },
        status: {
          type: "string",
          enum: ["pending", "running", "waiting_user", "completed", "cancelled"],
          description: "新状态",
        },
        progressSummary: { type: "string", description: "当前进度摘要" },
        nextAction: { type: "string", description: "下一步行动" },
        assigneeType: { type: "string", enum: ["butler", "agent", "group"], description: "更改指派类型" },
        assigneeId: { type: "string", description: "更改指派对象" },
        responsibleAgentId: { type: "string", description: "更改负责人" },
        blockerType: {
          type: "string",
          enum: ["missing_info", "dependency", "resource", "tool_error", "agent_stalled"],
          description: "阻塞类型（设置阻塞）",
        },
        blockerSummary: { type: "string", description: "阻塞描述" },
        clearBlocker: { type: "boolean", description: "清除阻塞" },
        eventType: { type: "string", description: "记录事件类型" },
        eventSummary: { type: "string", description: "记录事件摘要" },
      },
      required: ["todoId"],
    },
    async execute(params, _ctx: ToolContext): Promise<ToolResult> {
      const id = params.todoId as string;
      const existing = store.get(id);
      if (!existing) return { toolCallId: "", content: `未找到全局任务: ${id}`, isError: true };

      const patch: Partial<GlobalTodoItem> = {};

      if (params.status) patch.status = params.status as GlobalTodoItem["status"];
      if (params.progressSummary !== undefined) patch.progressSummary = params.progressSummary as string;
      if (params.nextAction !== undefined) patch.nextAction = params.nextAction as string;
      if (params.assigneeType) patch.assigneeType = params.assigneeType as GlobalTodoItem["assigneeType"];
      if (params.assigneeId !== undefined) patch.assigneeId = params.assigneeId as string;
      if (params.responsibleAgentId !== undefined) patch.responsibleAgentId = params.responsibleAgentId as string;

      if (params.eventType || params.eventSummary) {
        patch.lastEvent = {
          type: (params.eventType as string) || "update",
          summary: (params.eventSummary as string) || "状态更新",
          at: new Date().toISOString(),
        };
      }

      if (params.clearBlocker) {
        patch.internalBlocker = undefined;
      } else if (params.blockerType) {
        patch.internalBlocker = {
          type: params.blockerType as GlobalTodoItem["internalBlocker"]["type"],
          summary: (params.blockerSummary as string) || "",
          since: existing.internalBlocker?.since || new Date().toISOString(),
        };
      }

      const updated = store.update(id, patch);
      if (!updated) return { toolCallId: "", content: `更新失败: ${id}`, isError: true };

      log.info("Global TODO updated: %s → status=%s", id, updated.status);
      return {
        toolCallId: "",
        content: `✅ 已更新全局任务 "${updated.goal}"\n状态: ${updated.status}${updated.nextAction ? `\n下一步: ${updated.nextAction}` : ""}`,
      };
    },
  };
}

// ============ global-todo-link-execution ============

export function makeGlobalTodoLinkExecutionTool(store: GlobalTodoStore): Tool {
  return {
    name: "global-todo-link-execution",
    description: "将全局任务链接到具体的群组或 Agent 执行实例。派发任务后调用此工具建立跟踪引用。",
    parameters: {
      type: "object",
      properties: {
        todoId: { type: "string", description: "全局 TODO ID" },
        scope: {
          type: "string",
          enum: ["agent", "group"],
          description: "执行范围",
        },
        refId: { type: "string", description: "执行对象的 ID（agentId 或 groupId）" },
        refTodoIds: {
          type: "array",
          items: { type: "string" },
          description: "在该范围内创建的对应 TODO ID 列表",
        },
        action: {
          type: "string",
          enum: ["add", "remove"],
          description: "添加或移除引用",
        },
      },
      required: ["todoId", "scope", "refId"],
    },
    async execute(params, _ctx: ToolContext): Promise<ToolResult> {
      const id = params.todoId as string;
      const existing = store.get(id);
      if (!existing) return { toolCallId: "", content: `未找到全局任务: ${id}`, isError: true };

      const ok = store.addExecutionRef(id, {
        scope: params.scope as "agent" | "group",
        id: params.refId as string,
        todoIds: params.refTodoIds as string[],
      });

      if (!ok) return { toolCallId: "", content: `链接失败: ${id}`, isError: true };

      log.info("Global TODO linked: %s → %s/%s", id, params.scope, params.refId);
      return {
        toolCallId: "",
        content: `🔗 已将全局任务 "${existing.goal}" 链接到 ${params.scope} ${params.refId}`,
      };
    },
  };
}

// ============ global-todo-continue ============

export function makeGlobalTodoContinueTool(store: GlobalTodoStore): Tool {
  return {
    name: "global-todo-continue",
    description:
      "对全局任务执行续作决策。当任务完成或阶段结束时，判断是否需要生成后续任务。\n" +
      "决策选项:\n" +
      "- complete: 任务已完全结束，收束归档\n" +
      "- continue: 任务需要继续，生成后续 TODO\n" +
      "- wait_user: 下一步需要用户确认或选择\n" +
      "- cancel: 取消此任务",
    parameters: {
      type: "object",
      properties: {
        todoId: { type: "string", description: "全局 TODO ID" },
        decision: {
          type: "string",
          enum: ["complete", "continue", "wait_user", "cancel"],
          description: "续作决策",
        },
        nextGoal: { type: "string", description: "如果 continue，描述下一步目标" },
        nextDescription: { type: "string", description: "如果 continue，描述下一步详情" },
        nextAssigneeType: { type: "string", enum: ["butler", "agent", "group"], description: "下一步指派类型" },
        nextAssigneeId: { type: "string", description: "下一步指派对象" },
        reason: { type: "string", description: "决策理由（供用户理解为什么做此决定）" },
      },
      required: ["todoId", "decision", "reason"],
    },
    async execute(params, _ctx: ToolContext): Promise<ToolResult> {
      const id = params.todoId as string;
      const decision = params.decision as string;
      const reason = params.reason as string;

      const existing = store.get(id);
      if (!existing) return { toolCallId: "", content: `未找到全局任务: ${id}`, isError: true };

      if (decision === "complete" || decision === "cancel") {
        store.update(id, {
          status: decision === "complete" ? "completed" : "cancelled",
          nextAction: `已${decision === "complete" ? "完成" : "取消"}。原因: ${reason}`,
          lastEvent: { type: "continue_decision", summary: reason, at: new Date().toISOString() },
        });
        return { toolCallId: "", content: `✅ 全局任务 "${existing.goal}" 已${decision === "complete" ? "完成收束" : "取消"}。` };
      }

      if (decision === "wait_user") {
        store.update(id, {
          status: "waiting_user",
          nextAction: reason,
          lastEvent: { type: "waiting_user", summary: reason, at: new Date().toISOString() },
        });
        return { toolCallId: "", content: `🟡 全局任务 "${existing.goal}" 已进入等待用户状态。\n原因: ${reason}` };
      }

      if (decision === "continue") {
        if (!params.nextGoal) {
          return { toolCallId: "", content: "continue 决策必须提供 nextGoal", isError: true };
        }

        // 检查续作深度
        const currentDepth = existing.continuationPolicy?.maxDepth;
        if (currentDepth !== undefined && currentDepth <= 0) {
          store.update(id, { status: "waiting_user", nextAction: "续作深度已达上限，需要用户决定是否继续" });
          return { toolCallId: "", content: `⚠ 续作深度已达上限，任务进入等待用户状态。` };
        }

        const nextItem = store.add({
          goal: params.nextGoal as string,
          description: (params.nextDescription as string) || `续作自: ${existing.goal}`,
          status: "pending",
          assigneeType: (params.nextAssigneeType as GlobalTodoItem["assigneeType"]) || existing.assigneeType,
          assigneeId: (params.nextAssigneeId as string) || existing.assigneeId,
          responsibleAgentId: existing.responsibleAgentId,
          automationPolicy: existing.automationPolicy,
          continuationPolicy: currentDepth !== undefined
            ? { ...existing.continuationPolicy!, maxDepth: currentDepth - 1 }
            : existing.continuationPolicy,
          progressSummary: "续作自上一阶段",
          nextAction: `等待派发（续作自: ${existing.goal}）`,
        });

        store.update(id, {
          status: "completed",
          nextAction: `已生成后续任务: ${nextItem.goal}`,
          lastEvent: { type: "continue_decision", summary: reason, at: new Date().toISOString() },
        });

        log.info("Global TODO continued: %s → %s", id, nextItem.id);
        return {
          toolCallId: "",
          content: `🔄 已生成后续任务 "${nextItem.goal}" (ID: ${nextItem.id})\n当前任务已标记完成。\n原因: ${reason}`,
        };
      }

      return { toolCallId: "", content: `未知决策: ${decision}`, isError: true };
    },
  };
}
```

- [ ] **Step 2: 验证编译**

```powershell
cd CoBeing; node_modules\.bin\tsc.cmd -p packages\core\tsconfig.json --noEmit
```

Expected: 零新增错误。

---

### Task 2.2: 编写工具单元测试

**Files:**
- Create: `packages/core/src/todo/global-tools.test.ts`

- [ ] **Step 1: 编写测试**

```ts
// packages/core/src/todo/global-tools.test.ts
import { describe, it, beforeEach, afterEach } from "vitest";
import * as assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { GlobalTodoStore } from "./global-store.js";
import {
  makeGlobalTodoAddTool,
  makeGlobalTodoListTool,
  makeGlobalTodoUpdateTool,
  makeGlobalTodoLinkExecutionTool,
  makeGlobalTodoContinueTool,
} from "./global-tools.js";
import type { ToolContext } from "@cobeing/shared";

const CTX: ToolContext = { agentId: "butler", sessionId: "test", workingDir: "/tmp" };

describe("global-todo-add", () => {
  let store: GlobalTodoStore;
  let tool: ReturnType<typeof makeGlobalTodoAddTool>;
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "global-tools-test-"));
    store = new GlobalTodoStore(testDir);
    tool = makeGlobalTodoAddTool(store);
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("creates a global todo with defaults", async () => {
    const result = await tool.execute({ goal: "测试任务", description: "测试描述" }, CTX);
    assert.ok(!result.isError);
    assert.match(result.content, /已创建全局任务/);
    assert.equal(store.list().length, 1);
    assert.equal(store.list()[0].goal, "测试任务");
    assert.equal(store.list()[0].status, "pending");
    assert.equal(store.list()[0].assigneeType, "butler");
  });

  it("creates with full params", async () => {
    const result = await tool.execute(
      {
        goal: "完整任务",
        description: "完整描述",
        assigneeType: "group",
        assigneeId: "g1",
        responsibleAgentId: "agent-1",
        continuationMode: "auto_generate",
        maxDepth: 3,
        stopWhen: "用户确认后停止",
      },
      CTX,
    );
    assert.ok(!result.isError);
    const item = store.list()[0];
    assert.equal(item.assigneeType, "group");
    assert.equal(item.assigneeId, "g1");
    assert.equal(item.responsibleAgentId, "agent-1");
    assert.equal(item.continuationPolicy?.mode, "auto_generate");
    assert.equal(item.continuationPolicy?.maxDepth, 3);
  });
});

describe("global-todo-list", () => {
  let store: GlobalTodoStore;
  let tool: ReturnType<typeof makeGlobalTodoListTool>;
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "global-tools-test-"));
    store = new GlobalTodoStore(testDir);
    tool = makeGlobalTodoListTool(store);
    store.add({ goal: "t1", description: "", status: "pending", assigneeType: "group", assigneeId: "g1", automationPolicy: defAP(), progressSummary: "", nextAction: "" });
    store.add({ goal: "t2", description: "", status: "running", assigneeType: "agent", assigneeId: "a1", automationPolicy: defAP(), progressSummary: "", nextAction: "" });
    store.add({ goal: "t3", description: "", status: "waiting_user", assigneeType: "group", assigneeId: "g1", automationPolicy: defAP(), progressSummary: "", nextAction: "" });
  });

  afterEach(() => fs.rmSync(testDir, { recursive: true, force: true }));

  it("lists all", async () => {
    const result = await tool.execute({}, CTX);
    assert.match(result.content, /3 条/);
  });

  it("filters by status", async () => {
    const result = await tool.execute({ status: "running" }, CTX);
    assert.match(result.content, /1 条/);
    assert.match(result.content, /t2/);
  });

  it("filters by assignee", async () => {
    const result = await tool.execute({ assigneeType: "group", assigneeId: "g1" }, CTX);
    assert.match(result.content, /2 条/);
  });

  it("filters waiting_user", async () => {
    const result = await tool.execute({ waitingUser: true }, CTX);
    assert.match(result.content, /1 条/);
    assert.match(result.content, /等待用户/);
  });
});

describe("global-todo-update", () => {
  let store: GlobalTodoStore;
  let tool: ReturnType<typeof makeGlobalTodoUpdateTool>;
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "global-tools-test-"));
    store = new GlobalTodoStore(testDir);
    tool = makeGlobalTodoUpdateTool(store);
  });

  afterEach(() => fs.rmSync(testDir, { recursive: true, force: true }));

  it("updates status and progress", async () => {
    const item = store.add({ goal: "test", description: "", status: "pending", assigneeType: "butler", automationPolicy: defAP(), progressSummary: "", nextAction: "" });
    const result = await tool.execute({ todoId: item.id, status: "running", progressSummary: "已派发" }, CTX);
    assert.ok(!result.isError);
    assert.equal(store.get(item.id)!.status, "running");
    assert.equal(store.get(item.id)!.progressSummary, "已派发");
  });

  it("sets blocker", async () => {
    const item = store.add({ goal: "test", description: "", status: "running", assigneeType: "butler", automationPolicy: defAP(), progressSummary: "", nextAction: "" });
    await tool.execute({ todoId: item.id, blockerType: "agent_stalled", blockerSummary: "无响应" }, CTX);
    assert.ok(store.get(item.id)!.internalBlocker);
    assert.equal(store.get(item.id)!.internalBlocker!.type, "agent_stalled");
  });

  it("clears blocker", async () => {
    const item = store.add({ goal: "test", description: "", status: "running", assigneeType: "butler", automationPolicy: defAP(), progressSummary: "", nextAction: "", internalBlocker: { type: "missing_info", summary: "x", since: new Date().toISOString() } });
    await tool.execute({ todoId: item.id, clearBlocker: true }, CTX);
    assert.equal(store.get(item.id)!.internalBlocker, undefined);
  });

  it("returns error for non-existent", async () => {
    const result = await tool.execute({ todoId: "bad" }, CTX);
    assert.ok(result.isError);
  });
});

describe("global-todo-link-execution", () => {
  let store: GlobalTodoStore;
  let tool: ReturnType<typeof makeGlobalTodoLinkExecutionTool>;
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "global-tools-test-"));
    store = new GlobalTodoStore(testDir);
    tool = makeGlobalTodoLinkExecutionTool(store);
  });

  afterEach(() => fs.rmSync(testDir, { recursive: true, force: true }));

  it("links execution ref", async () => {
    const item = store.add({ goal: "test", description: "", status: "pending", assigneeType: "butler", automationPolicy: defAP(), progressSummary: "", nextAction: "" });
    const result = await tool.execute({ todoId: item.id, scope: "group", refId: "g1", refTodoIds: ["t1", "t2"] }, CTX);
    assert.ok(!result.isError);
    assert.equal(store.get(item.id)!.executionRefs.length, 1);
    assert.deepEqual(store.get(item.id)!.executionRefs[0].todoIds, ["t1", "t2"]);
  });
});

describe("global-todo-continue", () => {
  let store: GlobalTodoStore;
  let tool: ReturnType<typeof makeGlobalTodoContinueTool>;
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "global-tools-test-"));
    store = new GlobalTodoStore(testDir);
    tool = makeGlobalTodoContinueTool(store);
  });

  afterEach(() => fs.rmSync(testDir, { recursive: true, force: true }));

  it("completes a task", async () => {
    const item = store.add({ goal: "test", description: "", status: "running", assigneeType: "butler", automationPolicy: defAP(), progressSummary: "", nextAction: "" });
    const result = await tool.execute({ todoId: item.id, decision: "complete", reason: "任务已全部完成" }, CTX);
    assert.ok(!result.isError);
    assert.equal(store.get(item.id)!.status, "completed");
  });

  it("waits for user", async () => {
    const item = store.add({ goal: "test", description: "", status: "running", assigneeType: "butler", automationPolicy: defAP(), progressSummary: "", nextAction: "" });
    const result = await tool.execute({ todoId: item.id, decision: "wait_user", reason: "需要用户选择方案" }, CTX);
    assert.ok(!result.isError);
    assert.equal(store.get(item.id)!.status, "waiting_user");
  });

  it("continues with next task", async () => {
    const item = store.add({
      goal: "phase 1",
      description: "",
      status: "running",
      assigneeType: "group",
      assigneeId: "g1",
      automationPolicy: defAP(),
      continuationPolicy: { mode: "auto_generate", maxDepth: 2 },
      progressSummary: "",
      nextAction: "",
    });
    const result = await tool.execute({
      todoId: item.id,
      decision: "continue",
      reason: "需要下一阶段",
      nextGoal: "phase 2",
      nextDescription: "第二阶段",
    }, CTX);
    assert.ok(!result.isError);
    // 当前任务标记完成
    assert.equal(store.get(item.id)!.status, "completed");
    // 创建了后续任务
    const all = store.list();
    assert.equal(all.length, 2);
    assert.equal(all[1].goal, "phase 2");
    // 深度递减
    assert.equal(all[1].continuationPolicy?.maxDepth, 1);
  });

  it("blocks continuation at maxDepth=0", async () => {
    const item = store.add({
      goal: "final",
      description: "",
      status: "running",
      assigneeType: "butler",
      automationPolicy: defAP(),
      continuationPolicy: { mode: "auto_generate", maxDepth: 0 },
      progressSummary: "",
      nextAction: "",
    });
    const result = await tool.execute({
      todoId: item.id,
      decision: "continue",
      reason: "想继续",
      nextGoal: "should not create",
    }, CTX);
    assert.ok(!result.isError);
    assert.match(result.content, /上限/);
    assert.equal(store.get(item.id)!.status, "waiting_user");
    assert.equal(store.list().length, 1); // 没有创建新任务
  });
});

function defAP() {
  return { autoDispatch: true, autoMonitor: true, autoEscalate: true, autoArchive: true, autoContinue: true };
}
```

- [ ] **Step 2: 运行工具测试**

```powershell
cd CoBeing; node_modules\.bin\vitest.cmd run packages/core/src/todo/global-tools.test.ts
```

Expected: 所有测试通过。

---

### Task 2.3: 在 Butler 中注册 5 个工具

**Files:**
- Modify: `packages/core/src/agent/butler.ts`

- [ ] **Step 1: 导入工具工厂并注册**

在 `packages/core/src/agent/butler.ts` 顶部添加导入：

```ts
import {
  makeGlobalTodoAddTool,
  makeGlobalTodoListTool,
  makeGlobalTodoUpdateTool,
  makeGlobalTodoLinkExecutionTool,
  makeGlobalTodoContinueTool,
} from "../todo/global-tools.js";
```

在现有的 TODO 工具注册块（`todo-review` 注册之后）添加 Global TODO 工具注册。Butler 构造函数需要接收 `GlobalTodoStore`。找到 `butler.ts` 中 `registerButlerTools` 或构造函数中工具注册的位置，在 `makeTodoReviewTool` 注册之后添加：

```ts
// Global TODO 编排工具（Phase 2）
const globalTodoStore = (globalThis as any).__cobeing?.runtime?.globalTodoStore;
if (globalTodoStore) {
  this.toolRegistry.register(makeGlobalTodoAddTool(globalTodoStore));
  this.toolRegistry.register(makeGlobalTodoListTool(globalTodoStore));
  this.toolRegistry.register(makeGlobalTodoUpdateTool(globalTodoStore));
  this.toolRegistry.register(makeGlobalTodoLinkExecutionTool(globalTodoStore));
  this.toolRegistry.register(makeGlobalTodoContinueTool(globalTodoStore));
}
```

- [ ] **Step 2: 验证编译 + 全量测试**

```powershell
cd CoBeing; node_modules\.bin\tsc.cmd -p packages\core\tsconfig.json --noEmit
cd CoBeing; node_modules\.bin\vitest.cmd run
```

Expected: 编译通过，所有测试通过。

---

## Phase 3: 完成事件回传 + 状态同步

### Task 3.1: GroupTodoScanner.complete() 增强

**Files:**
- Modify: `packages/core/src/todo/group-scanner.ts`

- [ ] **Step 1: 在 complete() 末尾的 Memory Agent 之前追加 GlobalTodoStore 通知**

在 `group-scanner.ts` 的 `complete()` 方法中，找到工作区同步（1.5）之后、Memory Agent（3）之前的位置，插入以下代码段：

```ts
// 2. 通知 GlobalTodoStore：查找引用了此 Group 的 Global TODO 并更新进度
try {
  const globalStore = (globalThis as any).__cobeing?.runtime?.globalTodoStore as
    import("./global-store.js").GlobalTodoStore | undefined;
  if (globalStore) {
    const refs = globalStore.getByExecutionRef("group", this.groupId);
    for (const ref of refs) {
      globalStore.update(ref.id, {
        lastEvent: {
          type: "group_todo_completed",
          summary: `群组 TODO "${item.title}" 已完成`,
          at: new Date().toISOString(),
        },
        progressSummary: `群组 ${this.groupId}: "${item.title}" 已完成`,
        updatedAt: new Date().toISOString(),
      });
      log.info("Global TODO %s updated from group %s completion", ref.id, this.groupId);
    }
  }
} catch (err: any) {
  log.error("GlobalTodoStore notification failed for group %s: %s", this.groupId, err.message);
}
```

- [ ] **Step 2: 验证编译 + 测试**

```powershell
cd CoBeing; node_modules\.bin\tsc.cmd -p packages\core\tsconfig.json --noEmit
cd CoBeing; node_modules\.bin\vitest.cmd run
```

---

### Task 3.2: WS 端点 get_global_todos + 修复 get_group_health

**Files:**
- Modify: `packages/core/src/api/ws-server.ts`

- [ ] **Step 1: 在 ws-server.ts 添加 get_global_todos case**

在 `ws-server.ts` 的 `handleMessage` switch 中添加（在 `get_group_health` case 附近）：

```ts
case "get_global_todos": {
  const store = (globalThis as any).__cobeing?.runtime?.globalTodoStore;
  if (!store) {
    this.sendToClient(ws, { type: "error", payload: { message: "GlobalTodoStore 未初始化" } });
    break;
  }
  const status = (msg.payload as any)?.status;
  const todos = store.list(status || undefined);
  this.sendToClient(ws, { type: "global_todos", payload: { todos } });
  break;
}
```

- [ ] **Step 2: 在 Global TODO 工具调用处广播 global_todo_updated**

在 `global-todo-add`/`global-todo-update`/`global-todo-continue` 等工具的执行结果中，工具执行后不是直接广播（工具层不知道 WS）。改为在 ws-server 的 `send_message` 处理中检测 Agent 消息是否涉及 Global TODO 操作… 

**简化方案**：在工具执行完成后的 runtime 层广播。实际上，因为我们用 `globalThis.__cobeing.runtime` 访问，可以在工具工厂中接收一个广播回调。但对于 Phase 3，最小可行方案是：在 ws-server 的 `get_global_todos` 响应中前端拉取最新状态，轮询或事件驱动。

增加一个简单的广播机制：在 `global-tools.ts` 各工具的 execute 最后，通过 `globalThis` 发送 WS 广播：

```ts
// 在 global-tools.ts 中每个工具 execute 末尾追加：
try {
  const wsServer = (globalThis as any).__cobeing?.runtime?.wsServer;
  if (wsServer && typeof wsServer.broadcastGlobalTodoUpdate === "function") {
    wsServer.broadcastGlobalTodoUpdate();
  }
} catch { /* non-critical */ }
```

在 `ws-server.ts` 中新增方法：

```ts
broadcastGlobalTodoUpdate(): void {
  this.broadcast({ type: "global_todo_updated", payload: { timestamp: Date.now() } });
}
```

- [ ] **Step 3: 修复 get_group_health**

找到 `ws-server.ts` 中 `get_group_health` case（约 line 2226），修改：

```ts
// 旧：
const todoStore = (g2 as any).groupTodoStore;
// 新：
const todoStore = this.groupManager?.getGroupTodoStore?.(hlGroupId);
```

删除对 `(g2 as any).groupTodoStore` 的依赖。

- [ ] **Step 4: 验证编译 + 测试**

```powershell
cd CoBeing; node_modules\.bin\tsc.cmd -p packages\core\tsconfig.json --noEmit
cd CoBeing; node_modules\.bin\vitest.cmd run
```

---

## Phase 4: 自动续作 / 生成后续任务

### Task 4.1: 创建 continuation-judgment.ts

**Files:**
- Create: `packages/core/src/todo/continuation-judgment.ts`

- [ ] **Step 1: 编写续作判断核心**

```ts
// packages/core/src/todo/continuation-judgment.ts
import { createLogger, DEFAULT_PROVIDER, DEFAULT_JUDGMENT_MODEL } from "@cobeing/shared";
import type { LLMProvider } from "@cobeing/providers";
import type { TodoItem, GlobalTodoItem } from "./types.js";
import type { GlobalTodoStore } from "./global-store.js";
import type { TodoStore } from "./store.js";

const log = createLogger("continuation-judgment");

export interface ContinuationResult {
  decision: "complete" | "wait_user" | "auto_generate" | "request_cross_layer";
  reason: string;
  nextTodo?: {
    goal: string;
    description: string;
    scope: "agent" | "group" | "global";
    assigneeType?: string;
    assigneeId?: string;
  };
  crossLayerRequest?: {
    target: "butler" | "host";
    request: string;
  };
}

export interface ContinuationParams {
  completedTodo: TodoItem | GlobalTodoItem;
  continuationPolicy: GlobalTodoItem["continuationPolicy"];
  agentContext: {
    agentId: string;
    provider: LLMProvider;
    model: string;
  };
  workspaceDir: string;
  globalTodoStore?: GlobalTodoStore;
  groupTodoStore?: TodoStore;
  isGroupContext: boolean;
}

/** 边界约束：判断续作决策是否可自动执行 */
function isAutoAllowed(decision: ContinuationResult): boolean {
  // 如果决策涉及高风险操作，必须上浮
  const highRiskKeywords = [
    "付款", "支付", "付费", "购买",
    "授权", "权限", "安装", "删除",
    "隐私", "密码", "密钥", "token",
    "扩大", "范围扩大", "超出范围",
  ];
  const combined = `${decision.reason} ${decision.nextTodo?.goal || ""} ${decision.nextTodo?.description || ""}`;
  for (const kw of highRiskKeywords) {
    if (combined.includes(kw)) return false;
  }
  return true;
}

/** 主线续作判断：由任务承担 Agent 的 provider 直接调用 */
export async function runContinuationJudgment(
  params: ContinuationParams,
): Promise<ContinuationResult> {
  const { completedTodo, continuationPolicy, agentContext } = params;

  // 无续作策略，默认收束
  if (!continuationPolicy || continuationPolicy.mode === "none") {
    return { decision: "complete", reason: "无续作策略，任务收束" };
  }

  // ask_user 模式直接上浮
  if (continuationPolicy.mode === "ask_user") {
    return { decision: "wait_user", reason: "续作策略要求用户确认" };
  }

  // 使用轻量 LLM 调用做续作判断
  const prompt = buildContinuationPrompt(completedTodo, continuationPolicy, params.isGroupContext);
  try {
    const response = await agentContext.provider.chat({
      model: agentContext.model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 500,
    });
    const parsed = parseContinuationResponse(response.content);
    log.info("Continuation judgment for %s: %s → %s", completedTodo.id, parsed.decision, parsed.reason);

    // 如果应该自动生成但涉及高风险，降级为 wait_user
    if (parsed.decision === "auto_generate" && !isAutoAllowed(parsed)) {
      return {
        decision: "wait_user",
        reason: `需要用户确认（涉及高风险操作）: ${parsed.reason}`,
      };
    }

    return parsed;
  } catch (err: any) {
    log.error("Continuation judgment failed: %s", err.message);
    return { decision: "complete", reason: "续作判断失败，默认收束" };
  }
}

function buildContinuationPrompt(
  todo: TodoItem | GlobalTodoItem,
  policy: GlobalTodoItem["continuationPolicy"],
  isGroup: boolean,
): string {
  const title = "title" in todo ? todo.title : (todo as GlobalTodoItem).goal;
  const desc = todo.description;
  const deliverable = "deliverable" in todo ? todo.deliverable : undefined;

  return `你是一个任务的执行者。你刚刚完成了这个任务：

标题: ${title}
描述: ${desc}${deliverable ? `\n交付物: ${deliverable}` : ""}
上下文: ${isGroup ? "群组协作" : "个人任务"}

续作策略: ${policy?.mode || "none"}
${policy?.stopWhen ? `停止条件: ${policy.stopWhen}` : ""}

请判断：
1. 这个任务是否完全结束了？
2. 是否还有自然的下一步？
3. 下一步是否需要用户参与？

回复 JSON（不要其他内容）：
{
  "decision": "complete|wait_user|auto_generate|request_cross_layer",
  "reason": "你的判断理由",
  "nextGoal": "如果 decision=auto_generate，写下一步的简短目标",
  "nextDescription": "如果 decision=auto_generate，写下一步的详细描述"
}

规则：
- complete: 任务已完全结束，不需要继续
- wait_user: 下一步需要用户决定、确认或提供信息
- auto_generate: 下一步清晰明确、低风险、自然延续，可以自动创建
- request_cross_layer: 下一步需要跨群组或跨层协调

注意：涉及用户主观选择、付款、授权、隐私、范围扩大的操作，必须选择 wait_user。`;
}

function parseContinuationResponse(content: string): ContinuationResult {
  try {
    // 尝试提取 JSON
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found");
    const parsed = JSON.parse(jsonMatch[0]);

    const decision = parsed.decision || "complete";
    if (!["complete", "wait_user", "auto_generate", "request_cross_layer"].includes(decision)) {
      return { decision: "complete", reason: "无效决策，默认收束" };
    }

    const result: ContinuationResult = {
      decision,
      reason: parsed.reason || "无理由",
    };

    if (decision === "auto_generate" && parsed.nextGoal) {
      result.nextTodo = {
        goal: parsed.nextGoal,
        description: parsed.nextDescription || "",
        scope: "agent",
      };
    }

    return result;
  } catch {
    return { decision: "complete", reason: "无法解析续作判断结果，默认收束" };
  }
}

/** 执行续作结果：创建后续 TODO 或上浮请求 */
export async function applyContinuationResult(
  result: ContinuationResult,
  params: ContinuationParams,
): Promise<void> {
  if (result.decision === "auto_generate" && result.nextTodo) {
    const { groupTodoStore } = params;
    if (groupTodoStore && result.nextTodo.scope === "group") {
      groupTodoStore.add({
        title: result.nextTodo.goal,
        description: result.nextTodo.description,
        triggerMode: "0time",
        triggerAt: "",
        recurrenceHint: "不重复",
        createdBy: "continuation-judgment",
        groupId: params.completedTodo.groupId,
        targetAgentId: params.agentContext.agentId,
      });
      log.info("Auto-generated group continuation: %s", result.nextTodo.goal);
    }
    // Agent TODO 续作：由 Agent 通过工具自行创建
  }

  if (result.decision === "request_cross_layer" && result.crossLayerRequest) {
    if (result.crossLayerRequest.target === "butler" && params.globalTodoStore) {
      // 向 Butler 提出跨层续作请求 — 创建等待状态的 Global TODO
      params.globalTodoStore.add({
        goal: `[续作请求] ${result.crossLayerRequest.request}`,
        description: `由 Agent ${params.agentContext.agentId} 提出`,
        status: "pending",
        assigneeType: "butler",
        automationPolicy: { autoDispatch: true, autoMonitor: true, autoEscalate: true, autoArchive: true, autoContinue: true },
        progressSummary: "等待 Butler 评估续作请求",
        nextAction: "Butler 需要评估此跨层续作请求",
      });
      log.info("Cross-layer continuation request sent to Butler");
    }
  }
}
```

- [ ] **Step 2: 验证编译**

```powershell
cd CoBeing; node_modules\.bin\tsc.cmd -p packages\core\tsconfig.json --noEmit
```

---

### Task 4.2: 集成续作判断到 GroupTodoScanner

**Files:**
- Modify: `packages/core/src/todo/group-scanner.ts`

- [ ] **Step 1: 在 complete() 末尾（Phase 3 GlobalTodoStore 通知之后、Memory Agent 之前）追加续作判断**

```ts
// 2.5 续作判断（如果 TODO 有 continuationPolicy）
const cp = (item as any).continuationPolicy;
if (cp && cp.mode && cp.mode !== "none") {
  try {
    const agent = this.resolveContinuationAgent(item);
    if (agent) {
      const params = {
        completedTodo: item,
        continuationPolicy: cp,
        agentContext: {
          agentId: agent.id,
          provider: agent.provider,
          model: agent.config.model,
        },
        workspaceDir: agent.paths.workspaceDir,
        globalTodoStore: (globalThis as any).__cobeing?.runtime?.globalTodoStore,
        groupTodoStore: this.store,
        isGroupContext: true,
      };
      const result = await runContinuationJudgment(params);
      await applyContinuationResult(result, params);
      log.info("Group %s continuation: %s → %s", this.groupId, item.id, result.decision);
    }
  } catch (err: any) {
    log.error("Group %s continuation failed: %s", this.groupId, err.message);
  }
}
```

并在文件顶部添加导入：

```ts
import { runContinuationJudgment, applyContinuationResult } from "./continuation-judgment.js";
```

`resolveContinuationAgent` 是通过 `targetAgentId` 或群组成员找到承担 Agent 的辅助方法：

```ts
private resolveContinuationAgent(todo: TodoItem): any | null {
  const agentId = todo.targetAgentId;
  if (!agentId) return null;
  const registry = (globalThis as any).__cobeing?.runtime?.registry;
  if (!registry) return null;
  const agent = registry.get(agentId);
  if (!agent) return null;
  return {
    id: agent.id,
    provider: (globalThis as any).__cobeingGetProvider?.(agent.config.provider || DEFAULT_PROVIDER),
    model: agent.config.model || DEFAULT_MODEL,
    config: agent.config,
    paths: agent.paths || { workspaceDir: "" },
  };
}
```

- [ ] **Step 2: 更新 types.ts — TodoItem.onComplete 扩展**

在 `packages/core/src/todo/types.ts` 的 `TodoItem.onComplete` 中添加：

```ts
onComplete?: {
  mentionAgentId?: string;
  message?: string;
  createTodo?: Omit<TodoItem, "id" | "createdAt" | "status">;
  /** 续作策略（Phase 4） */
  continuationPolicy?: GlobalTodoItem["continuationPolicy"];
};
```

- [ ] **Step 3: 更新 tools.ts — todo-add 和 todo-complete 描述**

在 `packages/core/src/todo/tools.ts` 中：

`todo-add` 的 `onComplete` 参数描述添加 `continuationPolicy`：

```ts
onComplete: {
  type: "object",
  properties: {
    mentionAgentId: { type: "string" },
    message: { type: "string" },
    continuationPolicy: {
      type: "object",
      description: "续作策略（Phase 4）。任务完成后是否自动生成后续任务",
      properties: {
        mode: { type: "string", enum: ["none", "request_coordinator", "auto_generate", "ask_user"] },
        maxDepth: { type: "number" },
        stopWhen: { type: "string" },
      },
    },
  },
},
```

`todo-complete` 的描述更新，在 description 末尾追加续作提示：

```ts
description: "完成一个 TODO。完成后请判断是否需要续作：如果任务有自然延续，请先创建新 TODO 再完成当前 TODO。",
```

- [ ] **Step 4: 验证编译 + 全量测试**

```powershell
cd CoBeing; node_modules\.bin\tsc.cmd -p packages\core\tsconfig.json --noEmit
cd CoBeing; node_modules\.bin\vitest.cmd run
```

---

### Task 4.3: 编写续作判断单元测试

**Files:**
- Create: `packages/core/src/todo/continuation-judgment.test.ts`

- [ ] **Step 1: 编写测试**

```ts
// packages/core/src/todo/continuation-judgment.test.ts
import { describe, it } from "vitest";
import * as assert from "node:assert/strict";
import { runContinuationJudgment, applyContinuationResult } from "./continuation-judgment.js";
import type { ContinuationParams, ContinuationResult } from "./continuation-judgment.js";
import type { TodoItem, GlobalTodoItem } from "./types.js";

// Mock provider that returns a controlled response
function mockProvider(response: string) {
  return {
    chat: async () => ({ content: response }),
  } as any;
}

const mockTodo: TodoItem = {
  id: "t1",
  title: "测试任务",
  description: "测试描述",
  status: "in-progress",
  triggerAt: "",
  recurrenceHint: "不重复",
  createdBy: "test",
  createdAt: new Date().toISOString(),
};

const defaultParams = (provider: any): ContinuationParams => ({
  completedTodo: mockTodo,
  continuationPolicy: undefined,
  agentContext: { agentId: "a1", provider, model: "test-model" },
  workspaceDir: "/tmp",
  isGroupContext: false,
});

describe("runContinuationJudgment", () => {
  it("returns complete when no continuation policy", async () => {
    const result = await runContinuationJudgment(defaultParams(mockProvider("")));
    assert.equal(result.decision, "complete");
    assert.match(result.reason, /无续作策略/);
  });

  it("returns wait_user for ask_user mode", async () => {
    const result = await runContinuationJudgment({
      ...defaultParams(mockProvider("")),
      continuationPolicy: { mode: "ask_user" },
    });
    assert.equal(result.decision, "wait_user");
  });

  it("parses auto_generate from LLM response", async () => {
    const provider = mockProvider(JSON.stringify({
      decision: "auto_generate",
      reason: "自然延续",
      nextGoal: "下一步任务",
      nextDescription: "继续推进",
    }));
    const result = await runContinuationJudgment({
      ...defaultParams(provider),
      continuationPolicy: { mode: "auto_generate" },
    });
    assert.equal(result.decision, "auto_generate");
    assert.equal(result.nextTodo?.goal, "下一步任务");
  });

  it("parses complete from LLM response", async () => {
    const provider = mockProvider(JSON.stringify({
      decision: "complete",
      reason: "任务已全部完成",
    }));
    const result = await runContinuationJudgment({
      ...defaultParams(provider),
      continuationPolicy: { mode: "auto_generate" },
    });
    assert.equal(result.decision, "complete");
  });

  it("downgrades high-risk auto to wait_user", async () => {
    const provider = mockProvider(JSON.stringify({
      decision: "auto_generate",
      reason: "需要先付费购买资源",
      nextGoal: "付费购买服务器",
    }));
    const result = await runContinuationJudgment({
      ...defaultParams(provider),
      continuationPolicy: { mode: "auto_generate" },
    });
    // High-risk keywords like "付费" should force wait_user
    assert.equal(result.decision, "wait_user");
    assert.match(result.reason, /高风险/);
  });

  it("falls back to complete on invalid LLM response", async () => {
    const provider = mockProvider("not json at all");
    const result = await runContinuationJudgment({
      ...defaultParams(provider),
      continuationPolicy: { mode: "auto_generate" },
    });
    assert.equal(result.decision, "complete");
  });

  it("falls back to complete on error", async () => {
    const provider = {
      chat: async () => { throw new Error("API error"); },
    } as any;
    const result = await runContinuationJudgment({
      ...defaultParams(provider),
      continuationPolicy: { mode: "auto_generate" },
    });
    assert.equal(result.decision, "complete");
    assert.match(result.reason, /失败/);
  });
});

describe("applyContinuationResult", () => {
  it("does nothing for complete decision", async () => {
    // Should not throw
    await applyContinuationResult(
      { decision: "complete", reason: "done" },
      defaultParams(mockProvider("")),
    );
  });
});
```

- [ ] **Step 2: 运行测试**

```powershell
cd CoBeing; node_modules\.bin\vitest.cmd run packages/core/src/todo/continuation-judgment.test.ts
```

Expected: 7 tests pass。

---

## Phase 5: 前端 UX

### Task 5.1: 创建 GlobalTodoPanel 组件

**Files:**
- Create: `gui-v2/src/components/todo/GlobalTodoPanel.tsx`

- [ ] **Step 1: 编写组件**

```tsx
// gui-v2/src/components/todo/GlobalTodoPanel.tsx
import { useEffect } from "react";
import { useTodoStore } from "@/stores/todo";
import { getWsClient } from "@/hooks/useWebSocket";
import type { GlobalTodoInfo } from "@/lib/types";

const STATUS_STYLE: Record<string, { label: string; color: string; bg: string }> = {
  pending: { label: "待派发", color: "var(--color-txt-muted)", bg: "var(--color-surface)" },
  running: { label: "执行中", color: "var(--color-accent)", bg: "color-mix(in srgb, var(--color-accent) 10%, transparent)" },
  waiting_user: { label: "等待用户", color: "var(--color-warning-fg)", bg: "color-mix(in srgb, var(--color-warning) 12%, transparent)" },
  completed: { label: "已完成", color: "var(--color-success)", bg: "color-mix(in srgb, var(--color-success) 10%, transparent)" },
  cancelled: { label: "已取消", color: "var(--color-txt-muted)", bg: "transparent" },
};

function StatBadge({ count, label, color }: { count: number; label: string; color: string }) {
  return (
    <div className="flex items-center rounded-md text-xs font-medium" style={{ gap: 4, padding: "3px 8px", backgroundColor: `color-mix(in srgb, ${color} 15%, transparent)`, color }}>
      <span className="text-sm font-bold">{count}</span>
      <span>{label}</span>
    </div>
  );
}

function GlobalTodoItem({ todo }: { todo: GlobalTodoInfo }) {
  const style = STATUS_STYLE[todo.status] || STATUS_STYLE.pending;
  return (
    <div
      className="rounded-lg cursor-pointer transition-colors hover:bg-surface-solid"
      style={{ padding: "8px 10px", borderLeft: `3px solid ${style.color}`, backgroundColor: style.bg }}
    >
      <div className="text-sm font-medium text-txt" style={{ marginBottom: 2 }}>{todo.goal}</div>
      <div className="flex items-center" style={{ gap: 6 }}>
        <span className="text-xs font-medium" style={{ color: style.color }}>{style.label}</span>
        {todo.assigneeId && (
          <span className="text-xs text-txt-muted">
            {todo.assigneeType === "group" ? "👥" : todo.assigneeType === "agent" ? "🤖" : "🏠"}{" "}
            {todo.assigneeId}
          </span>
        )}
      </div>
      {todo.lastEvent && (
        <div className="text-xs text-txt-muted mt-1 truncate">{todo.lastEvent.summary}</div>
      )}
    </div>
  );
}

export function GlobalTodoPanel() {
  const { globalTodos, setGlobalTodos } = useTodoStore();

  useEffect(() => {
    // Initial fetch
    const ws = getWsClient();
    ws?.send({ type: "get_global_todos", payload: {} });

    // Listen for updates
    const handler = () => {
      ws?.send({ type: "get_global_todos", payload: {} });
    };
    window.addEventListener("ws-global-todo-updated", handler);
    return () => window.removeEventListener("ws-global-todo-updated", handler);
  }, []);

  // Handle response via custom event — useWebSocket will dispatch
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ payload: { todos: GlobalTodoInfo[] } }>).detail;
      if (detail?.payload?.todos) {
        setGlobalTodos(detail.payload.todos);
      }
    };
    window.addEventListener("ws-global-todos", handler);
    return () => window.removeEventListener("ws-global-todos", handler);
  }, [setGlobalTodos]);

  const running = globalTodos.filter(t => t.status === "running").length;
  const waitingUser = globalTodos.filter(t => t.status === "waiting_user").length;
  const completed = globalTodos.filter(t => t.status === "completed").length;

  return (
    <aside
      className="flex flex-col shrink-0"
      style={{ width: 220, padding: "14px 12px", gap: 12, borderRight: "1px solid var(--color-bdr)", overflowY: "auto" }}
    >
      <div className="text-sm font-bold text-txt">📋 全局任务</div>

      {/* Stats bar */}
      <div className="flex flex-wrap" style={{ gap: 4 }}>
        {running > 0 && <StatBadge count={running} label="执行中" color="var(--color-accent)" />}
        {waitingUser > 0 && <StatBadge count={waitingUser} label="等待你" color="var(--color-warning-fg)" />}
        {completed > 0 && <StatBadge count={completed} label="已完成" color="var(--color-success)" />}
      </div>

      {/* Todo list */}
      {globalTodos.length === 0 ? (
        <div className="text-xs text-txt-muted text-center" style={{ padding: "20px 0" }}>
          暂无任务
        </div>
      ) : (
        <div className="flex flex-col" style={{ gap: 6 }}>
          {globalTodos
            .filter(t => t.status !== "completed" && t.status !== "cancelled")
            .map(t => (
              <GlobalTodoItem key={t.id} todo={t} />
            ))}
          {globalTodos.some(t => t.status === "completed" || t.status === "cancelled") && (
            <>
              <div className="text-xs text-txt-muted font-medium" style={{ marginTop: 4 }}>已完成</div>
              {globalTodos
                .filter(t => t.status === "completed" || t.status === "cancelled")
                .slice(0, 5)
                .map(t => (
                  <GlobalTodoItem key={t.id} todo={t} />
                ))}
            </>
          )}
        </div>
      )}
    </aside>
  );
}
```

- [ ] **Step 2: 验证编译**

```powershell
cd CoBeing\gui-v2; node_modules\.bin\tsc.cmd --noEmit
```

---

### Task 5.2: 集成 GlobalTodoPanel 到 Sidebar

**Files:**
- Modify: `gui-v2/src/components/layout/Sidebar.tsx`

- [ ] **Step 1: 修改 Sidebar — butler view 时渲染 GlobalTodoPanel**

在 `Sidebar` 函数中，将：

```tsx
if (activeView !== "agents" && activeView !== "groups") return null;
```

改为：

```tsx
import { GlobalTodoPanel } from "@/components/todo/GlobalTodoPanel";

// ... 在函数中：
if (activeView === "butler") {
  return <GlobalTodoPanel />;
}

if (activeView !== "agents" && activeView !== "groups") return null;
```

---

### Task 5.3: Agent TODO 条件显示 — ChatView 增强

**Files:**
- Modify: `gui-v2/src/components/chat/ChatView.tsx`

- [ ] **Step 1: 在独立 Agent 对话区上方嵌入 TodoPanelInline**

在 `ChatView` 组件的 return 中，在消息列表之前添加：

```tsx
{/* Agent TODO — 仅独立 Agent 显示，群组中隐藏 */}
{!isGroupChat && convId && convId !== "butler" && (
  <div style={{ maxWidth: 700, margin: "0 auto", width: "100%" }}>
    <TodoPanelInline agentId={convId} />
  </div>
)}
```

`TodoPanelInline` 是一个紧凑版单行组件。在 `gui-v2/src/components/todo/TodoPanel.tsx` 中新增一个简化导出，或直接在 ChatView 中内联一个简单的 pending TODO 列表。

最简单实现：在 ChatView 中直接读取 todoStore 的 pending TODOs 并在对话区上方显示为紧凑横条（2 行 max）。

```tsx
// Simple inline TODO preview for agent chat
function TodoPanelInline({ agentId }: { agentId: string }) {
  const { todos } = useTodoStore();
  const pending = useMemo(() => todos.filter(t => t.status === "pending").slice(0, 3), [todos]);

  useEffect(() => {
    const ws = getWsClient();
    ws?.send({ type: "get_todos", payload: { scope: "agent", agentId } });
  }, [agentId]);

  if (pending.length === 0) return null;

  return (
    <div className="flex items-center rounded-lg bg-surface border border-bdr/30 text-xs" style={{ padding: "6px 10px", gap: 8 }}>
      <span className="font-medium text-txt-sub shrink-0">📌 TODO</span>
      {pending.map(t => (
        <span key={t.id} className="truncate text-txt-muted">{t.title}</span>
      ))}
      <button
        className="ml-auto text-accent font-medium hover:underline shrink-0"
        onClick={() => {
          const ws = getWsClient();
          ws?.send({ type: "get_todos", payload: { scope: "agent", agentId } });
        }}
      >
        {pending.length} 项
      </button>
    </div>
  );
}
```

---

### Task 5.4: 前端类型和 Store 更新

**Files:**
- Modify: `gui-v2/src/lib/types.ts`
- Modify: `gui-v2/src/stores/todo.ts`
- Modify: `gui-v2/src/hooks/useWebSocket.ts`

- [ ] **Step 1: types.ts — 添加 GlobalTodoInfo**

```ts
// 追加到 gui-v2/src/lib/types.ts
export interface GlobalTodoInfo {
  id: string;
  goal: string;
  description: string;
  status: "pending" | "running" | "waiting_user" | "completed" | "cancelled";
  assigneeType: "butler" | "agent" | "group";
  assigneeId?: string;
  responsibleAgentId?: string;
  progressSummary: string;
  nextAction: string;
  lastEvent?: { type: string; summary: string; at: string };
  internalBlocker?: { type: string; summary: string; since: string };
  executionRefs: Array<{ scope: "agent" | "group"; id: string; todoIds?: string[] }>;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 2: todo.ts store — 新增 globalTodos 状态**

```ts
// 在 stores/todo.ts 的接口和实现中添加：

interface TodoState {
  // ... existing ...
  globalTodos: GlobalTodoInfo[];
  setGlobalTodos: (todos: GlobalTodoInfo[]) => void;
}

// 在 create 中：
globalTodos: [],
setGlobalTodos: (todos) => set({ globalTodos: todos }),
```

- [ ] **Step 3: useWebSocket.ts — 处理 global_todos 和 global_todo_updated 消息**

在 `useWebSocket.ts` 的 message handler switch 中添加：

```ts
case "global_todos":
  window.dispatchEvent(new CustomEvent("ws-global-todos", {
    detail: { payload: msg.payload },
  }));
  break;

case "global_todo_updated":
  window.dispatchEvent(new CustomEvent("ws-global-todo-updated"));
  break;
```

- [ ] **Step 4: 验证前端编译**

```powershell
cd CoBeing\gui-v2; node_modules\.bin\tsc.cmd --noEmit
cd CoBeing\gui-v2; node_modules\.bin\vite.cmd build
```

Expected: 零错误，构建成功。

---

## 验证（全部 Phase 完成）

```powershell
cd CoBeing
node_modules\.bin\tsc.cmd -p packages\core\tsconfig.json --noEmit
node_modules\.bin\tsc.cmd -p packages\shared\tsconfig.json --noEmit
node_modules\.bin\vitest.cmd run

cd gui-v2
node_modules\.bin\tsc.cmd --noEmit
node_modules\.bin\vite.cmd build
```

Expected:
- 所有 tsc 检查通过
- 所有 vitest 测试通过（现有 427+ 新增 ~25）
- vite build 成功
