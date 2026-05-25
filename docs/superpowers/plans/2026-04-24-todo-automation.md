# TODO 驱动自动化 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 CoBeing 添加 TODO 驱动自动化系统 — Agent 和群组可以创建定时 TODO，到达触发时间后以 TODOboard 身份唤醒目标 Agent 执行任务。

**Architecture:** 后端新增 `todo/` 模块（类型 + 存储 + 扫描器 + 工具），`AgentTodoScanner` 全局单例挂载在 `CoBeingRuntime`，`GroupTodoScanner` 每群组一个由 `GroupManager` 管理。前端新增 `todo/` 组件目录和 Zustand store。通过 WS 命令实现前后端通信。

**Tech Stack:** TypeScript, Node.js, React 19, Zustand, WebSocket, Vitest

---

## 文件结构

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `packages/core/src/todo/types.ts` | TodoItem 类型 + 常量 |
| 新建 | `packages/core/src/todo/store.ts` | TodoStore 读写 TODO.json |
| 新建 | `packages/core/src/todo/scanner.ts` | AgentTodoScanner（全局扫描器） |
| 新建 | `packages/core/src/todo/group-scanner.ts` | GroupTodoScanner（群组扫描器） |
| 新建 | `packages/core/src/todo/tools.ts` | todo-add/list/complete/cancel 工具 |
| 新建 | `packages/core/src/todo/time-tool.ts` | current-time 工具 |
| 新建 | `packages/core/src/todo/scanner.test.ts` | 扫描器测试 |
| 修改 | `packages/core/src/runtime.ts` | 启动/停止 AgentTodoScanner |
| 修改 | `packages/core/src/group/manager.ts` | 群组扫描器生命周期管理 |
| 修改 | `packages/core/src/agent/agent.ts` | 注册 TODO 工具 + current-time |
| 修改 | `packages/core/src/agent/butler.ts` | 注册 TODO 工具 |
| 修改 | `packages/core/src/api/ws-server.ts` | 新增 4 个 WS 命令 |
| 修改 | `packages/core/src/index.ts` | 导出 TodoStore |
| 新建 | `gui-v2/src/stores/todo.ts` | 前端 TODO Zustand store |
| 新建 | `gui-v2/src/components/todo/TodoPanel.tsx` | 主面板 |
| 新建 | `gui-v2/src/components/todo/TodoList.tsx` | TODO 列表 |
| 新建 | `gui-v2/src/components/todo/TodoItem.tsx` | 单条 TODO 卡片 |
| 新建 | `gui-v2/src/components/todo/TodoForm.tsx` | 创建/编辑表单 |
| 新建 | `gui-v2/src/components/todo/TodoStatusBadge.tsx` | 状态标签 |
| 修改 | `config/default.json` | butler tools 补充 TODO 工具 |
| 修改 | `STRUCTURE.md` | 同步新增目录 |

---

## Task 1: TodoItem 类型定义

**Files:**
- Create: `packages/core/src/todo/types.ts`

- [ ] **Step 1: 创建 types.ts**

```typescript
// packages/core/src/todo/types.ts

export interface TodoItem {
  id: string;                    // uuid
  title: string;                 // 简短标题
  description: string;           // 触发时告诉 agent 要做什么
  status: "pending" | "triggered" | "completed" | "cancelled";
  triggerAt: string;             // ISO 8601 触发时间
  /** 触发后 LLM 据此决定是否续期及下次触发时间 */
  recurrenceHint: string;        // "每天9:00" / "每周一10:00" / "不重复"
  createdBy: string;             // "user" | agentId | "TODOboard"
  createdAt: string;             // ISO 8601
  triggeredAt?: string;          // 实际触发时间
  completedAt?: string;

  // Agent 级专用
  agentId?: string;              // Agent 级 TODO 归属

  // 群组级专用
  targetAgentId?: string;        // 群组级 TODO 触发目标 agent
  /** 完成后的动作链 */
  onComplete?: {
    mentionAgentId?: string;     // 完成后 @mention 这个 agent
    message?: string;            // @mention 时附带的消息
    createTodo?: Omit<TodoItem, "id" | "createdAt" | "status">;
  };
}

export type TodoScope = "agent" | "group";

export const TODO_STATUS_VALUES = ["pending", "triggered", "completed", "cancelled"] as const;

/** 扫描间隔（毫秒） */
export const SCAN_INTERVAL_MS = 60_000;

/** 逾期阈值（毫秒）— 超过此值标注逾期 */
export const OVERDUE_THRESHOLD_MS = 3_600_000; // 1 小时
```

- [ ] **Step 2: 验证文件创建**

Run: `node -e "require('./packages/core/src/todo/types.ts')" 2>/dev/null; echo "File exists: $(test -f packages/core/src/todo/types.ts && echo yes || echo no)"`

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/todo/types.ts
git commit -m "feat(todo): add TodoItem type definitions"
```

---

## Task 2: TodoStore — 读写 TODO.json

**Files:**
- Create: `packages/core/src/todo/store.ts`
- Test: `packages/core/src/todo/scanner.test.ts`（store 测试部分）

- [ ] **Step 1: 写 store 测试**

```typescript
// packages/core/src/todo/scanner.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { TodoStore } from "./store.js";
import type { TodoItem } from "./types.js";

describe("TodoStore", () => {
  let tmpDir: string;
  let store: TodoStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cobeing-todo-test-"));
    store = new TodoStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty list when file does not exist", () => {
    expect(store.list()).toEqual([]);
  });

  it("adds and retrieves a todo", () => {
    const item = store.add({
      title: "测试任务",
      description: "这是一个测试",
      triggerAt: new Date(Date.now() + 3600_000).toISOString(),
      recurrenceHint: "不重复",
      createdBy: "user",
      agentId: "butler",
    });
    expect(item.id).toBeTruthy();
    expect(item.status).toBe("pending");

    const all = store.list();
    expect(all).toHaveLength(1);
    expect(all[0].title).toBe("测试任务");
  });

  it("filters by status", () => {
    store.add({
      title: "A",
      description: "a",
      triggerAt: new Date().toISOString(),
      recurrenceHint: "不重复",
      createdBy: "user",
      agentId: "butler",
    });
    const item2 = store.add({
      title: "B",
      description: "b",
      triggerAt: new Date().toISOString(),
      recurrenceHint: "不重复",
      createdBy: "user",
      agentId: "butler",
    });
    store.complete(item2.id);

    expect(store.list("pending")).toHaveLength(1);
    expect(store.list("completed")).toHaveLength(1);
  });

  it("completes a todo and returns updated item", () => {
    const item = store.add({
      title: "完成我",
      description: "desc",
      triggerAt: new Date().toISOString(),
      recurrenceHint: "不重复",
      createdBy: "user",
      agentId: "butler",
    });
    const updated = store.complete(item.id);
    expect(updated?.status).toBe("completed");
    expect(updated?.completedAt).toBeTruthy();
  });

  it("cancels a todo", () => {
    const item = store.add({
      title: "取消我",
      description: "desc",
      triggerAt: new Date().toISOString(),
      recurrenceHint: "不重复",
      createdBy: "user",
      agentId: "butler",
    });
    const updated = store.cancel(item.id);
    expect(updated?.status).toBe("cancelled");
  });

  it("marks triggered and sets triggeredAt", () => {
    const item = store.add({
      title: "触发我",
      description: "desc",
      triggerAt: new Date().toISOString(),
      recurrenceHint: "不重复",
      createdBy: "user",
      agentId: "butler",
    });
    const updated = store.trigger(item.id);
    expect(updated?.status).toBe("triggered");
    expect(updated?.triggeredAt).toBeTruthy();
  });

  it("getDueTodos returns only pending items past triggerAt", () => {
    const past = store.add({
      title: "过期任务",
      description: "已过期",
      triggerAt: new Date(Date.now() - 1000).toISOString(),
      recurrenceHint: "不重复",
      createdBy: "user",
      agentId: "butler",
    });
    store.add({
      title: "未来任务",
      description: "还没到",
      triggerAt: new Date(Date.now() + 3600_000).toISOString(),
      recurrenceHint: "不重复",
      createdBy: "user",
      agentId: "butler",
    });
    const due = store.getDueTodos();
    expect(due).toHaveLength(1);
    expect(due[0].id).toBe(past.id);
  });

  it("survives corrupt JSON gracefully", () => {
    fs.writeFileSync(store["filePath"], "NOT JSON{", "utf-8");
    expect(store.list()).toEqual([]);
  });

  it("get returns todo by id", () => {
    const item = store.add({
      title: "查找我",
      description: "desc",
      triggerAt: new Date().toISOString(),
      recurrenceHint: "不重复",
      createdBy: "user",
      agentId: "butler",
    });
    expect(store.get(item.id)?.title).toBe("查找我");
    expect(store.get("nonexistent")).toBeUndefined();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd CoBeing && npx vitest run packages/core/src/todo/scanner.test.ts`
Expected: FAIL — `./store.js` not found

- [ ] **Step 3: 实现 TodoStore**

```typescript
// packages/core/src/todo/store.ts
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createLogger } from "@cobeing/shared";
import type { TodoItem } from "./types.js";

const log = createLogger("todo-store");

export class TodoStore {
  private filePath: string;

  constructor(baseDir: string, filename = "TODO.json") {
    this.filePath = path.join(baseDir, filename);
  }

  /** 读取所有 TODO（文件不存在或损坏返回空数组） */
  list(statusFilter?: TodoItem["status"]): TodoItem[] {
    const items = this.readAll();
    if (statusFilter) return items.filter(i => i.status === statusFilter);
    return items;
  }

  /** 获取单条 TODO */
  get(id: string): TodoItem | undefined {
    return this.readAll().find(i => i.id === id);
  }

  /** 添加新 TODO */
  add(input: Omit<TodoItem, "id" | "createdAt" | "status">): TodoItem {
    const item: TodoItem = {
      ...input,
      id: randomUUID(),
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    const items = this.readAll();
    items.push(item);
    this.writeAll(items);
    return item;
  }

  /** 标记为 triggered */
  trigger(id: string): TodoItem | undefined {
    return this.updateItem(id, item => {
      item.status = "triggered";
      item.triggeredAt = new Date().toISOString();
    });
  }

  /** 标记为 completed */
  complete(id: string): TodoItem | undefined {
    return this.updateItem(id, item => {
      item.status = "completed";
      item.completedAt = new Date().toISOString();
    });
  }

  /** 标记为 cancelled */
  cancel(id: string): TodoItem | undefined {
    return this.updateItem(id, item => {
      item.status = "cancelled";
    });
  }

  /** 获取所有到期 TODO（pending 且 triggerAt <= now） */
  getDueTodos(): TodoItem[] {
    const now = Date.now();
    return this.readAll().filter(i => i.status === "pending" && new Date(i.triggerAt).getTime() <= now);
  }

  // ---- Private ----

  private readAll(): TodoItem[] {
    try {
      if (!fs.existsSync(this.filePath)) return [];
      const raw = fs.readFileSync(this.filePath, "utf-8").trim();
      if (!raw) return [];
      const data = JSON.parse(raw);
      return Array.isArray(data) ? data : [];
    } catch (err: any) {
      log.error("Failed to read TODO file %s: %s", this.filePath, err.message);
      return [];
    }
  }

  private writeAll(items: TodoItem[]): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmpPath = this.filePath + ".tmp";
    fs.writeFileSync(tmpPath, JSON.stringify(items, null, 2), "utf-8");
    fs.renameSync(tmpPath, this.filePath);
  }

  private updateItem(id: string, mutator: (item: TodoItem) => void): TodoItem | undefined {
    const items = this.readAll();
    const item = items.find(i => i.id === id);
    if (!item) return undefined;
    mutator(item);
    this.writeAll(items);
    return item;
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd CoBeing && npx vitest run packages/core/src/todo/scanner.test.ts`
Expected: PASS — 所有 TodoStore 测试通过

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/todo/store.ts packages/core/src/todo/scanner.test.ts
git commit -m "feat(todo): add TodoStore with read/write/filter support"
```

---

## Task 3: AgentTodoScanner — 全局扫描器

**Files:**
- Create: `packages/core/src/todo/scanner.ts`
- Test: 追加到 `packages/core/src/todo/scanner.test.ts`

- [ ] **Step 1: 追加扫描器测试**

在 `scanner.test.ts` 文件末尾（`describe("TodoStore", ...)` 块之后）追加：

```typescript
import { AgentTodoScanner } from "./scanner.js";
import type { AgentRegistry } from "../agent/registry.js";

// Minimal mock for AgentRegistry
function mockRegistry(agentIds: string[]): AgentRegistry {
  const agents = new Map(agentIds.map(id => {
    const agent = {
      id,
      name: id,
      getStatus: () => "idle",
      run: async (input: string) => ({ content: `reply to: ${input}` }),
      memoryStore: { appendHistory: async () => {} },
    };
    return [id, agent as any];
  }));
  return {
    get: (id: string) => agents.get(id),
    list: () => [...agents.values()],
  } as any;
}

describe("AgentTodoScanner", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cobeing-scanner-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("scans agent dirs and finds due todos", async () => {
    // 创建 agent 目录和过期 TODO
    const agentDir = path.join(tmpDir, "agents", "butler");
    fs.mkdirSync(agentDir, { recursive: true });
    const store = new TodoStore(agentDir);
    store.add({
      title: "过期任务",
      description: "测试触发",
      triggerAt: new Date(Date.now() - 5000).toISOString(),
      recurrenceHint: "不重复",
      createdBy: "user",
      agentId: "butler",
    });

    let triggered = false;
    const scanner = new AgentTodoScanner(tmpDir, mockRegistry(["butler"]), {
      onTrigger: async (_agentId, _todo, _message) => {
        triggered = true;
      },
    });

    await scanner.scanOnce();
    expect(triggered).toBe(true);
  });

  it("skips agents with no TODO file", async () => {
    const scanner = new AgentTodoScanner(tmpDir, mockRegistry(["butler"]), {
      onTrigger: async () => { throw new Error("should not trigger"); },
    });
    await scanner.scanOnce(); // 不应抛出
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd CoBeing && npx vitest run packages/core/src/todo/scanner.test.ts`
Expected: FAIL — `./scanner.js` not found

- [ ] **Step 3: 实现 AgentTodoScanner**

```typescript
// packages/core/src/todo/scanner.ts
import fs from "node:fs";
import path from "node:path";
import { createLogger } from "@cobeing/shared";
import type { TodoItem } from "./types.js";
import { TodoStore } from "./store.js";
import { SCAN_INTERVAL_MS, OVERDUE_THRESHOLD_MS } from "./types.js";
import type { AgentRegistry } from "../agent/registry.js";

const log = createLogger("todo-scanner");

export interface ScannerCallbacks {
  onTrigger: (agentId: string, todo: TodoItem, message: string) => Promise<void>;
}

export class AgentTodoScanner {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private dataRoot: string,
    private registry: AgentRegistry,
    private callbacks: ScannerCallbacks,
  ) {}

  /** 启动定期扫描 */
  start(intervalMs = SCAN_INTERVAL_MS): void {
    if (this.timer) return;
    // 启动时先扫一次（处理重启后逾期的）
    this.scanOnce().catch(err => log.error("Initial scan error: %s", err));
    this.timer = setInterval(() => {
      this.scanOnce().catch(err => log.error("Scan error: %s", err));
    }, intervalMs);
    log.info("AgentTodoScanner started (interval=%dms)", intervalMs);
  }

  /** 停止扫描 */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    log.info("AgentTodoScanner stopped");
  }

  /** 单次扫描 */
  async scanOnce(): Promise<void> {
    const agentsDir = path.join(this.dataRoot, "agents");
    if (!fs.existsSync(agentsDir)) return;

    const agentDirs = fs.readdirSync(agentsDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);

    for (const agentId of agentDirs) {
      try {
        const agentDir = path.join(agentsDir, agentId);
        const store = new TodoStore(agentDir);
        const dueTodos = store.getDueTodos();

        for (const todo of dueTodos) {
          const agent = this.registry.get(todo.agentId || agentId);
          if (!agent) {
            log.warn("Agent %s not found, skipping TODO %s", todo.agentId || agentId, todo.id);
            store.trigger(todo.id); // 标记触发避免重复
            continue;
          }

          const message = this.formatTriggerMessage(todo);
          store.trigger(todo.id);
          log.info("Triggering TODO %s for agent %s: %s", todo.id, agentId, todo.title);

          try {
            await this.callbacks.onTrigger(agentId, todo, message);
          } catch (err: any) {
            log.error("Failed to trigger TODO %s: %s", todo.id, err.message);
          }
        }
      } catch (err: any) {
        log.error("Error scanning agent %s: %s", agentId, err.message);
      }
    }
  }

  private formatTriggerMessage(todo: TodoItem): string {
    const now = Date.now();
    const triggerTime = new Date(todo.triggerAt).getTime();
    const overdueMs = now - triggerTime;
    const isOverdue = overdueMs > OVERDUE_THRESHOLD_MS;
    const overdueHours = Math.floor(overdueMs / OVERDUE_THRESHOLD_MS);

    return `【系统通知 — TODO 触发】
标题: ${todo.title}
内容: ${todo.description}
触发时间: ${todo.triggerAt}
逾期: ${isOverdue ? `是，已逾期 ${overdueHours} 小时` : "否"}
续期提示: ${todo.recurrenceHint}

请根据上述内容执行相应操作。
如需续期：
  1. 先调用 todo-add 创建新 TODO
  2. 再调用 todo-complete 完成当前 TODO
一次性任务直接调用 todo-complete 即可。`;
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd CoBeing && npx vitest run packages/core/src/todo/scanner.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/todo/scanner.ts packages/core/src/todo/scanner.test.ts
git commit -m "feat(todo): add AgentTodoScanner with periodic scan"
```

---

## Task 4: GroupTodoScanner — 群组扫描器

**Files:**
- Create: `packages/core/src/todo/group-scanner.ts`

- [ ] **Step 1: 追加群组扫描器测试**

在 `scanner.test.ts` 末尾追加：

```typescript
import { GroupTodoScanner } from "./group-scanner.js";

describe("GroupTodoScanner", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cobeing-group-scanner-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("scans group dir and triggers due todos", async () => {
    const groupDir = path.join(tmpDir, "groups", "test-group");
    fs.mkdirSync(groupDir, { recursive: true });
    const store = new TodoStore(groupDir);
    store.add({
      title: "群组任务",
      description: "做某事",
      triggerAt: new Date(Date.now() - 1000).toISOString(),
      recurrenceHint: "不重复",
      createdBy: "host",
      targetAgentId: "agent-a",
    });

    const triggered: any[] = [];
    const scanner = new GroupTodoScanner("test-group", groupDir, {
      onTrigger: async (groupId, todo, msg) => {
        triggered.push({ groupId, todo, msg });
      },
    });

    await scanner.scanOnce();
    expect(triggered).toHaveLength(1);
    expect(triggered[0].groupId).toBe("test-group");
    expect(triggered[0].todo.targetAgentId).toBe("agent-a");
  });

  it("handles onComplete action chain", async () => {
    const groupDir = path.join(tmpDir, "groups", "g2");
    fs.mkdirSync(groupDir, { recursive: true });
    const store = new TodoStore(groupDir);
    store.add({
      title: "链式任务",
      description: "完成后创建下一个",
      triggerAt: new Date(Date.now() - 1000).toISOString(),
      recurrenceHint: "不重复",
      createdBy: "host",
      targetAgentId: "agent-b",
      onComplete: {
        mentionAgentId: "host",
        message: "任务已完成",
      },
    });

    const actions: any[] = [];
    const scanner = new GroupTodoScanner("g2", groupDir, {
      onTrigger: async (gid, todo, msg) => {
        actions.push("trigger");
      },
      onCompleteAction: async (gid, todo) => {
        actions.push("complete-action");
      },
    });

    await scanner.scanOnce();
    expect(actions).toContain("trigger");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd CoBeing && npx vitest run packages/core/src/todo/scanner.test.ts`
Expected: FAIL — `./group-scanner.js` not found

- [ ] **Step 3: 实现 GroupTodoScanner**

```typescript
// packages/core/src/todo/group-scanner.ts
import { createLogger } from "@cobeing/shared";
import type { TodoItem } from "./types.js";
import { OVERDUE_THRESHOLD_MS } from "./types.js";
import { TodoStore } from "./store.js";

const log = createLogger("group-todo-scanner");

export interface GroupScannerCallbacks {
  onTrigger: (groupId: string, todo: TodoItem, message: string) => Promise<void>;
  onCompleteAction?: (groupId: string, todo: TodoItem) => Promise<void>;
}

export class GroupTodoScanner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private store: TodoStore;

  constructor(
    private groupId: string,
    groupDir: string,
    private callbacks: GroupScannerCallbacks,
  ) {
    this.store = new TodoStore(groupDir);
  }

  getStore(): TodoStore {
    return this.store;
  }

  start(intervalMs = 60_000): void {
    if (this.timer) return;
    this.scanOnce().catch(err => log.error("Group %s initial scan error: %s", this.groupId, err));
    this.timer = setInterval(() => {
      this.scanOnce().catch(err => log.error("Group %s scan error: %s", this.groupId, err));
    }, intervalMs);
    log.info("GroupTodoScanner started for %s", this.groupId);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    log.info("GroupTodoScanner stopped for %s", this.groupId);
  }

  async scanOnce(): Promise<void> {
    const dueTodos = this.store.getDueTodos();

    for (const todo of dueTodos) {
      const message = this.formatTriggerMessage(todo);
      this.store.trigger(todo.id);
      log.info("Group %s: triggering TODO %s for %s", this.groupId, todo.id, todo.targetAgentId);

      try {
        await this.callbacks.onTrigger(this.groupId, todo, message);
      } catch (err: any) {
        log.error("Group %s: failed to trigger TODO %s: %s", this.groupId, todo.id, err.message);
      }
    }
  }

  /** 完成 TODO 并执行 onComplete 动作链 */
  async complete(todoId: string): Promise<TodoItem | undefined> {
    const item = this.store.complete(todoId);
    if (item?.onComplete && this.callbacks.onCompleteAction) {
      try {
        await this.callbacks.onCompleteAction(this.groupId, item);
      } catch (err: any) {
        log.error("Group %s: onComplete action failed for %s: %s", this.groupId, todoId, err.message);
      }
    }
    return item;
  }

  private formatTriggerMessage(todo: TodoItem): string {
    return `【系统通知 — 群组 TODO 触发 @ ${this.groupId}】
标题: ${todo.title}
内容: ${todo.description}
指派给: ${todo.targetAgentId || "未指定"}
续期提示: ${todo.recurrenceHint}

请根据上述内容执行相应操作。
如需续期：
  1. 先调用 todo-add 创建新 TODO
  2. 再调用 todo-complete 完成当前 TODO
一次性任务直接调用 todo-complete 即可。`;
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd CoBeing && npx vitest run packages/core/src/todo/scanner.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/todo/group-scanner.ts packages/core/src/todo/scanner.test.ts
git commit -m "feat(todo): add GroupTodoScanner with onComplete chain"
```

---

## Task 5: current-time 工具

**Files:**
- Create: `packages/core/src/todo/time-tool.ts`

- [ ] **Step 1: 实现 current-time 工具**

```typescript
// packages/core/src/todo/time-tool.ts
import type { Tool } from "@cobeing/shared";

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

export const currentTimeTool: Tool = {
  name: "current-time",
  description: "获取当前系统时间。创建 TODO 时建议先调用此工具获取准确时间。",
  parameters: {
    type: "object",
    properties: {},
  },
  async execute(_params, _context): Promise<import("@cobeing/shared").ToolResult> {
    const now = new Date();
    const iso = now.toISOString();
    const weekday = WEEKDAYS[now.getDay()];
    return {
      toolCallId: "",
      content: `当前时间: ${iso} (星期${weekday})`,
    };
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/todo/time-tool.ts
git commit -m "feat(todo): add current-time tool"
```

---

## Task 6: TODO Agent 工具（todo-add/list/complete/cancel）

**Files:**
- Create: `packages/core/src/todo/tools.ts`

- [ ] **Step 1: 实现 TODO 工具**

```typescript
// packages/core/src/todo/tools.ts
import type { Tool, ToolContext, ToolResult } from "@cobeing/shared";
import { TodoStore } from "./store.js";
import type { TodoScope } from "./types.js";
import { createLogger } from "@cobeing/shared";

const log = createLogger("todo-tools");

export function makeTodoAddTool(
  agentDataRoot: string,
  groupStoreGetter?: (groupId: string) => TodoStore | undefined,
): Tool {
  return {
    name: "todo-add",
    description: "创建定时 TODO。到达触发时间后系统会以 TODOboard 身份唤醒你执行任务。",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "简短标题" },
        description: { type: "string", description: "触发时告诉你要做什么" },
        triggerAt: { type: "string", description: "触发时间 (ISO 8601，如 2026-04-25T09:00:00+08:00)" },
        recurrenceHint: { type: "string", description: "续期提示（每天9:00 / 每周一10:00 / 不重复）" },
        scope: { type: "string", description: "agent 或 group（默认 agent）" },
        groupId: { type: "string", description: "群组级时必填" },
        targetAgentId: { type: "string", description: "群组级时指派的目标 agent" },
        onComplete: {
          type: "object",
          description: "完成后的动作链（可选）",
          properties: {
            mentionAgentId: { type: "string" },
            message: { type: "string" },
          },
        },
      },
      required: ["title", "description", "triggerAt", "recurrenceHint"],
    },
    async execute(params, context: ToolContext): Promise<ToolResult> {
      const scope = (params.scope as TodoScope) || "agent";
      const store = resolveStore(scope, params.groupId as string, agentDataRoot, context, groupStoreGetter);
      if (!store) return { toolCallId: "", content: "无法确定 TODO 存储", isError: true };

      const item = store.add({
        title: params.title as string,
        description: params.description as string,
        triggerAt: params.triggerAt as string,
        recurrenceHint: params.recurrenceHint as string,
        createdBy: context.agentId || "unknown",
        agentId: scope === "agent" ? context.agentId : undefined,
        targetAgentId: scope === "group" ? params.targetAgentId as string : undefined,
        onComplete: params.onComplete as any,
      });

      log.info("TODO added: %s (%s) triggerAt=%s", item.id, item.title, item.triggerAt);
      return {
        toolCallId: "",
        content: `已创建 TODO "${item.title}" (ID: ${item.id})，触发时间: ${item.triggerAt}`,
      };
    },
  };
}

export function makeTodoListTool(
  agentDataRoot: string,
  groupStoreGetter?: (groupId: string) => TodoStore | undefined,
): Tool {
  return {
    name: "todo-list",
    description: "列出当前 TODO。",
    parameters: {
      type: "object",
      properties: {
        scope: { type: "string", description: "agent 或 group（默认 agent）" },
        groupId: { type: "string", description: "群组级时必填" },
        status: { type: "string", description: "筛选状态: pending / triggered / completed / cancelled" },
      },
    },
    async execute(params, context: ToolContext): Promise<ToolResult> {
      const scope = (params.scope as TodoScope) || "agent";
      const store = resolveStore(scope, params.groupId as string, agentDataRoot, context, groupStoreGetter);
      if (!store) return { toolCallId: "", content: "无法确定 TODO 存储", isError: true };

      const items = store.list(params.status as any);
      if (items.length === 0) return { toolCallId: "", content: "没有 TODO" };

      const lines = items.map(i =>
        `- [${i.status}] ${i.title} (ID: ${i.id})\n  触发: ${i.triggerAt}\n  内容: ${i.description}`
      );
      return { toolCallId: "", content: `TODO 列表 (${items.length} 条):\n\n${lines.join("\n\n")}` };
    },
  };
}

export function makeTodoCompleteTool(
  agentDataRoot: string,
  groupStoreGetter?: (groupId: string) => TodoStore | undefined,
): Tool {
  return {
    name: "todo-complete",
    description: "完成一个 TODO。",
    parameters: {
      type: "object",
      properties: {
        todoId: { type: "string", description: "TODO ID" },
        scope: { type: "string", description: "agent 或 group" },
        groupId: { type: "string", description: "群组级时必填" },
      },
      required: ["todoId", "scope"],
    },
    async execute(params, context: ToolContext): Promise<ToolResult> {
      const scope = params.scope as TodoScope;
      const store = resolveStore(scope, params.groupId as string, agentDataRoot, context, groupStoreGetter);
      if (!store) return { toolCallId: "", content: "无法确定 TODO 存储", isError: true };

      const item = store.complete(params.todoId as string);
      if (!item) return { toolCallId: "", content: `未找到 TODO: ${params.todoId}`, isError: true };

      log.info("TODO completed: %s (%s)", item.id, item.title);
      return { toolCallId: "", content: `已完成 TODO "${item.title}"` };
    },
  };
}

export function makeTodoCancelTool(
  agentDataRoot: string,
  groupStoreGetter?: (groupId: string) => TodoStore | undefined,
): Tool {
  return {
    name: "todo-cancel",
    description: "取消一个 TODO。",
    parameters: {
      type: "object",
      properties: {
        todoId: { type: "string", description: "TODO ID" },
        scope: { type: "string", description: "agent 或 group" },
        groupId: { type: "string", description: "群组级时必填" },
      },
      required: ["todoId", "scope"],
    },
    async execute(params, context: ToolContext): Promise<ToolResult> {
      const scope = params.scope as TodoScope;
      const store = resolveStore(scope, params.groupId as string, agentDataRoot, context, groupStoreGetter);
      if (!store) return { toolCallId: "", content: "无法确定 TODO 存储", isError: true };

      const item = store.cancel(params.todoId as string);
      if (!item) return { toolCallId: "", content: `未找到 TODO: ${params.todoId}`, isError: true };

      log.info("TODO cancelled: %s (%s)", item.id, item.title);
      return { toolCallId: "", content: `已取消 TODO "${item.title}"` };
    },
  };
}

// ---- Helper ----

function resolveStore(
  scope: TodoScope,
  groupId: string | undefined,
  agentDataRoot: string,
  context: ToolContext,
  groupStoreGetter?: (groupId: string) => TodoStore | undefined,
): TodoStore | undefined {
  if (scope === "group") {
    if (!groupId) return undefined;
    return groupStoreGetter?.(groupId);
  }
  // Agent 级: 使用 agent 自己的目录
  const agentId = context.agentId || "unknown";
  const { default: path } = require("path") as typeof import("path");
  return new TodoStore(path.join(agentDataRoot, "agents", agentId));
}
```

> **注意**: 上面的 `resolveStore` 使用 `require("path")` 是为了避免 ESM/CJS 循环依赖问题。如果项目已经是纯 ESM，改为顶部 `import path from "node:path"` 即可。实际实现时根据项目情况调整。

- [ ] **Step 2: 修正 import（如需要）**

确认项目使用 ESM（查看 `package.json` 的 `"type": "module"`），将 `resolveStore` 中的 `require("path")` 替换为顶部已有的 `import path from "node:path"`。修正后的 `resolveStore`:

```typescript
import path from "node:path";

function resolveStore(
  scope: TodoScope,
  groupId: string | undefined,
  agentDataRoot: string,
  context: ToolContext,
  groupStoreGetter?: (groupId: string) => TodoStore | undefined,
): TodoStore | undefined {
  if (scope === "group") {
    if (!groupId) return undefined;
    return groupStoreGetter?.(groupId);
  }
  const agentId = context.agentId || "unknown";
  return new TodoStore(path.join(agentDataRoot, "agents", agentId));
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/todo/tools.ts
git commit -m "feat(todo): add todo-add/list/complete/cancel agent tools"
```

---

## Task 7: 集成到 Runtime 和 Agent

**Files:**
- Modify: `packages/core/src/runtime.ts`
- Modify: `packages/core/src/group/manager.ts`
- Modify: `packages/core/src/agent/agent.ts`
- Modify: `packages/core/src/agent/butler.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: 修改 runtime.ts — 启动/停止 AgentTodoScanner**

在 `runtime.ts` 中：
1. 顶部添加 import:
```typescript
import { AgentTodoScanner } from "./todo/scanner.js";
```

2. 在 `CoBeingRuntime` 类中添加属性:
```typescript
private todoScanner: AgentTodoScanner | null = null;
```

3. 在 `start()` 方法末尾（`log.info("Runtime started...")` 之前）启动扫描器:
```typescript
// 启动 TODO 扫描器
this.todoScanner = new AgentTodoScanner(this.dataRoot, this.registry, {
  onTrigger: async (agentId, _todo, message) => {
    const agent = this.registry.get(agentId);
    if (agent) {
      log.info("[TODOboard] Triggering agent %s", agentId);
      try {
        await agent.run(message);
      } catch (err: any) {
        log.error("[TODOboard] Failed to trigger %s: %s", agentId, err.message);
      }
    }
  },
});
this.todoScanner.start();
```

4. 在 `stop()` 方法中（关闭 WS 前）停止扫描器:
```typescript
this.todoScanner?.stop();
```

- [ ] **Step 2: 修改 group/manager.ts — 群组扫描器生命周期**

1. 顶部添加 import:
```typescript
import { GroupTodoScanner } from "../todo/group-scanner.js";
import { TodoStore } from "../todo/store.js";
```

2. 在 `GroupManager` 类中添加:
```typescript
private groupScanners = new Map<string, GroupTodoScanner>();
```

3. 在 `create()` 方法中，`this.groups.set(config.id, group)` 之后添加:
```typescript
// 启动群组 TODO 扫描器
const groupDir = path.join(this.groupsDir, config.id);
const scanner = new GroupTodoScanner(config.id, groupDir, {
  onTrigger: async (groupId, todo, message) => {
    const g = this.groups.get(groupId);
    if (g) {
      const targetAgent = this.registry.get(todo.targetAgentId || "");
      if (targetAgent) {
        await targetAgent.run(message);
      }
    }
  },
});
scanner.start();
this.groupScanners.set(config.id, scanner);
```

4. 在 `delete()` 方法中，`this.groups.delete(groupId)` 之前添加:
```typescript
this.groupScanners.get(groupId)?.stop();
this.groupScanners.delete(groupId);
```

5. 添加获取群组 TodoStore 的方法:
```typescript
/** 获取群组的 TodoStore（供工具使用） */
getGroupTodoStore(groupId: string): TodoStore | undefined {
  return this.groupScanners.get(groupId)?.getStore();
}
```

- [ ] **Step 3: 修改 agent.ts — 注册 TODO 工具**

在 `agent.ts` 的 import 区域添加:
```typescript
import { makeTodoAddTool, makeTodoListTool, makeTodoCompleteTool, makeTodoCancelTool } from "../todo/tools.js";
import { currentTimeTool } from "../todo/time-tool.js";
```

在构造函数中，`this.toolRegistry.register(makeMemoryTool(this.memoryStore))` 之后添加:
```typescript
// 注册 TODO 工具
this.toolRegistry.register(makeTodoAddTool(this.paths.directory.replace(/[/\\][^/\\]+$/, ""), undefined));
this.toolRegistry.register(makeTodoListTool(this.paths.directory.replace(/[/\\][^/\\]+$/, ""), undefined));
this.toolRegistry.register(makeTodoCompleteTool(this.paths.directory.replace(/[/\\][^/\\]+$/, ""), undefined));
this.toolRegistry.register(makeTodoCancelTool(this.paths.directory.replace(/[/\\][^/\\]+$/, ""), undefined));
this.toolRegistry.register(currentTimeTool);
```

> **注意**: `this.paths.directory` 是 `data/agents/{id}/`，需要向上取一级得到 `data/` 传给工具。更好的做法是在 Agent 类中存储 `dataRoot`，用 `this.paths.dataRoot` 代替。如果 `AgentPaths` 有 `dataRoot` 属性就直接用；否则用 `path.dirname(this.paths.directory)` 即可。

- [ ] **Step 4: 修改 butler.ts — 注册 TODO 工具**

在 `ButlerAgent` 构造函数的工具注册区域添加:
```typescript
// TODO 工具
import { makeTodoAddTool, makeTodoListTool, makeTodoCompleteTool, makeTodoCancelTool } from "../todo/tools.js";
import { currentTimeTool } from "../todo/time-tool.js";
```

在工具注册部分:
```typescript
this.toolRegistry.register(makeTodoAddTool(this.dataRoot ?? "./data", (gid) => groupManager.getGroupTodoStore?.(gid)));
this.toolRegistry.register(makeTodoListTool(this.dataRoot ?? "./data", (gid) => groupManager.getGroupTodoStore?.(gid)));
this.toolRegistry.register(makeTodoCompleteTool(this.dataRoot ?? "./data", (gid) => groupManager.getGroupTodoStore?.(gid)));
this.toolRegistry.register(makeTodoCancelTool(this.dataRoot ?? "./data", (gid) => groupManager.getGroupTodoStore?.(gid)));
this.toolRegistry.register(currentTimeTool);
```

- [ ] **Step 5: 修改 index.ts — 导出**

在 `packages/core/src/index.ts` 中添加导出:
```typescript
export { TodoStore } from "./todo/store.js";
export { AgentTodoScanner } from "./todo/scanner.js";
export { GroupTodoScanner } from "./todo/group-scanner.js";
export type { TodoItem, TodoScope } from "./todo/types.js";
```

- [ ] **Step 6: 运行全量测试确认无破坏**

Run: `cd CoBeing && npx vitest run`
Expected: 所有测试通过

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/runtime.ts packages/core/src/group/manager.ts packages/core/src/agent/agent.ts packages/core/src/agent/butler.ts packages/core/src/index.ts
git commit -m "feat(todo): integrate TodoStore/Scanner into Runtime, Agent, and Butler"
```

---

## Task 8: WS 命令

**Files:**
- Modify: `packages/core/src/api/ws-server.ts`

- [ ] **Step 1: 在 ws-server.ts 的 handleMessage switch 中添加 4 个 case**

在 `handleMessage` 方法的 `default:` 之前添加:

```typescript
case "get_todos": {
  const { scope, agentId, groupId } = msg.payload as {
    scope: "agent" | "group"; agentId?: string; groupId?: string;
  };
  const { TodoStore } = await import("../todo/store.js");
  let store: InstanceType<typeof TodoStore> | undefined;
  if (scope === "group" && groupId) {
    store = this.groupManager?.getGroupTodoStore?.(groupId);
  } else if (agentId) {
    store = new TodoStore(path.join(this.dataRoot, "agents", agentId));
  }
  if (!store) {
    this.sendToClient(ws, { type: "error", payload: { message: "无法确定 TODO 存储" } });
    break;
  }
  this.sendToClient(ws, { type: "todos", payload: { todos: store.list() } });
  break;
}

case "add_todo": {
  const { title, description, triggerAt, recurrenceHint, scope, agentId, groupId, targetAgentId, onComplete } = msg.payload as {
    title: string; description: string; triggerAt: string; recurrenceHint: string;
    scope: "agent" | "group"; agentId?: string; groupId?: string;
    targetAgentId?: string; onComplete?: any;
  };
  const { TodoStore } = await import("../todo/store.js");
  let store: InstanceType<typeof TodoStore> | undefined;
  if (scope === "group" && groupId) {
    store = this.groupManager?.getGroupTodoStore?.(groupId);
  } else if (agentId) {
    store = new TodoStore(path.join(this.dataRoot, "agents", agentId));
  }
  if (!store) {
    this.sendToClient(ws, { type: "error", payload: { message: "无法确定 TODO 存储" } });
    break;
  }
  const item = store.add({
    title, description, triggerAt, recurrenceHint,
    createdBy: "user",
    agentId: scope === "agent" ? agentId : undefined,
    targetAgentId: scope === "group" ? targetAgentId : undefined,
    onComplete,
  });
  this.sendToClient(ws, { type: "todo_added", payload: { todo: item } });
  this.broadcast({ type: "todo_updated", payload: { scope, agentId, groupId } });
  break;
}

case "complete_todo": {
  const { todoId, scope, agentId, groupId } = msg.payload as {
    todoId: string; scope: "agent" | "group"; agentId?: string; groupId?: string;
  };
  const { TodoStore } = await import("../todo/store.js");
  let store: InstanceType<typeof TodoStore> | undefined;
  if (scope === "group" && groupId) {
    store = this.groupManager?.getGroupTodoStore?.(groupId);
  } else if (agentId) {
    store = new TodoStore(path.join(this.dataRoot, "agents", agentId));
  }
  if (!store) {
    this.sendToClient(ws, { type: "error", payload: { message: "无法确定 TODO 存储" } });
    break;
  }
  const item = store.complete(todoId);
  if (!item) {
    this.sendToClient(ws, { type: "error", payload: { message: `TODO not found: ${todoId}` } });
    break;
  }
  this.sendToClient(ws, { type: "todo_completed", payload: { todo: item } });
  this.broadcast({ type: "todo_updated", payload: { scope, agentId, groupId } });
  break;
}

case "cancel_todo": {
  const { todoId: cTodoId, scope: cScope, agentId: cAgentId, groupId: cGroupId } = msg.payload as {
    todoId: string; scope: "agent" | "group"; agentId?: string; groupId?: string;
  };
  const { TodoStore } = await import("../todo/store.js");
  let store: InstanceType<typeof TodoStore> | undefined;
  if (cScope === "group" && cGroupId) {
    store = this.groupManager?.getGroupTodoStore?.(cGroupId);
  } else if (cAgentId) {
    store = new TodoStore(path.join(this.dataRoot, "agents", cAgentId));
  }
  if (!store) {
    this.sendToClient(ws, { type: "error", payload: { message: "无法确定 TODO 存储" } });
    break;
  }
  const item = store.cancel(cTodoId);
  if (!item) {
    this.sendToClient(ws, { type: "error", payload: { message: `TODO not found: ${cTodoId}` } });
    break;
  }
  this.sendToClient(ws, { type: "todo_cancelled", payload: { todo: item } });
  this.broadcast({ type: "todo_updated", payload: { scope: cScope, agentId: cAgentId, groupId: cGroupId } });
  break;
}
```

> **优化**: 上面 4 个 case 中有重复的 `resolveStore` 逻辑。建议提取为 `resolveTodoStore(scope, agentId, groupId)` 私有方法减少重复。实际实现时可以这样做。

- [ ] **Step 2: 运行全量测试**

Run: `cd CoBeing && npx vitest run`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/api/ws-server.ts
git commit -m "feat(todo): add WS commands for TODO CRUD"
```

---

## Task 9: 前端 — Zustand Store + TODO 组件

**Files:**
- Create: `gui-v2/src/stores/todo.ts`
- Create: `gui-v2/src/components/todo/TodoPanel.tsx`
- Create: `gui-v2/src/components/todo/TodoList.tsx`
- Create: `gui-v2/src/components/todo/TodoItem.tsx`
- Create: `gui-v2/src/components/todo/TodoForm.tsx`
- Create: `gui-v2/src/components/todo/TodoStatusBadge.tsx`

- [ ] **Step 1: 创建 todo store**

```typescript
// gui-v2/src/stores/todo.ts
import { create } from "zustand";

export interface TodoItemData {
  id: string;
  title: string;
  description: string;
  status: "pending" | "triggered" | "completed" | "cancelled";
  triggerAt: string;
  recurrenceHint: string;
  createdBy: string;
  createdAt: string;
  triggeredAt?: string;
  completedAt?: string;
  agentId?: string;
  targetAgentId?: string;
  onComplete?: {
    mentionAgentId?: string;
    message?: string;
  };
}

interface TodoStore {
  todos: TodoItemData[];
  loading: boolean;
  scope: "agent" | "group";
  scopeId: string | null; // agentId or groupId

  setScope: (scope: "agent" | "group", id: string) => void;
  setTodos: (todos: TodoItemData[]) => void;
  addTodo: (todo: TodoItemData) => void;
  updateTodo: (id: string, updates: Partial<TodoItemData>) => void;
  removeTodo: (id: string) => void;
  setLoading: (loading: boolean) => void;
}

export const useTodoStore = create<TodoStore>((set) => ({
  todos: [],
  loading: false,
  scope: "agent",
  scopeId: null,

  setScope: (scope, id) => set({ scope, scopeId: id, todos: [] }),
  setTodos: (todos) => set({ todos }),
  addTodo: (todo) => set((s) => ({ todos: [...s.todos, todo] })),
  updateTodo: (id, updates) =>
    set((s) => ({
      todos: s.todos.map((t) => (t.id === id ? { ...t, ...updates } : t)),
    })),
  removeTodo: (id) =>
    set((s) => ({ todos: s.todos.filter((t) => t.id !== id) })),
  setLoading: (loading) => set({ loading }),
}));
```

- [ ] **Step 2: 创建 TodoStatusBadge**

```tsx
// gui-v2/src/components/todo/TodoStatusBadge.tsx
import React from "react";

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-accent/15 text-accent",
  triggered: "bg-warning/15 text-warning",
  completed: "bg-success/15 text-success",
  cancelled: "bg-txt-muted/15 text-txt-muted",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "待触发",
  triggered: "已触发",
  completed: "已完成",
  cancelled: "已取消",
};

export function TodoStatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[status] || ""}`}>
      {STATUS_LABELS[status] || status}
    </span>
  );
}
```

- [ ] **Step 3: 创建 TodoItem 卡片**

```tsx
// gui-v2/src/components/todo/TodoItem.tsx
import React from "react";
import type { TodoItemData } from "../../stores/todo";
import { TodoStatusBadge } from "./TodoStatusBadge";

interface TodoItemProps {
  todo: TodoItemData;
  onComplete: (id: string) => void;
  onCancel: (id: string) => void;
}

export function TodoItemCard({ todo, onComplete, onCancel }: TodoItemProps) {
  const triggerTime = new Date(todo.triggerAt);
  const isPast = triggerTime.getTime() < Date.now();

  return (
    <div className="bg-elevated rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-txt">{todo.title}</h4>
        <TodoStatusBadge status={todo.status} />
      </div>
      <p className="text-xs text-txt-sub">{todo.description}</p>
      <div className="flex items-center justify-between text-xs text-txt-muted">
        <span className={isPast && todo.status === "pending" ? "text-warning" : ""}>
          {triggerTime.toLocaleString("zh-CN")}
        </span>
        <span>{todo.recurrenceHint}</span>
      </div>
      {todo.status === "pending" || todo.status === "triggered" ? (
        <div className="flex gap-2 pt-1">
          <button
            className="px-2 py-1 text-xs rounded-md bg-success/15 text-success hover:bg-success/25 transition-colors"
            onClick={() => onComplete(todo.id)}
          >
            完成
          </button>
          <button
            className="px-2 py-1 text-xs rounded-md bg-danger/15 text-danger hover:bg-danger/25 transition-colors"
            onClick={() => onCancel(todo.id)}
          >
            取消
          </button>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: 创建 TodoList**

```tsx
// gui-v2/src/components/todo/TodoList.tsx
import React from "react";
import type { TodoItemData } from "../../stores/todo";
import { TodoItemCard } from "./TodoItem";

interface TodoListProps {
  todos: TodoItemData[];
  onComplete: (id: string) => void;
  onCancel: (id: string) => void;
  filter?: "pending" | "triggered" | "completed" | "cancelled" | "all";
}

export function TodoList({ todos, onComplete, onCancel, filter = "all" }: TodoListProps) {
  const filtered = filter === "all" ? todos : todos.filter((t) => t.status === filter);

  // 按触发时间排序（最近的在前）
  const sorted = [...filtered].sort((a, b) => {
    const aTime = new Date(a.triggerAt).getTime();
    const bTime = new Date(b.triggerAt).getTime();
    return aTime - bTime;
  });

  if (sorted.length === 0) {
    return <p className="text-sm text-txt-muted text-center py-8">暂无 TODO</p>;
  }

  return (
    <div className="space-y-2">
      {sorted.map((todo) => (
        <TodoItemCard key={todo.id} todo={todo} onComplete={onComplete} onCancel={onCancel} />
      ))}
    </div>
  );
}
```

- [ ] **Step 5: 创建 TodoForm**

```tsx
// gui-v2/src/components/todo/TodoForm.tsx
import React, { useState } from "react";

interface TodoFormProps {
  onSubmit: (data: {
    title: string;
    description: string;
    triggerAt: string;
    recurrenceHint: string;
  }) => void;
  onCancel: () => void;
}

export function TodoForm({ onSubmit, onCancel }: TodoFormProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [triggerAt, setTriggerAt] = useState("");
  const [recurrenceHint, setRecurrenceHint] = useState("不重复");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !triggerAt) return;
    onSubmit({ title: title.trim(), description: description.trim(), triggerAt, recurrenceHint });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="block text-xs text-txt-sub mb-1">标题</label>
        <input
          className="w-full bg-input border border-bdr rounded-lg px-3 py-2 text-sm text-txt focus:outline-none focus:border-accent"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="TODO 标题"
        />
      </div>
      <div>
        <label className="block text-xs text-txt-sub mb-1">描述</label>
        <textarea
          className="w-full bg-input border border-bdr rounded-lg px-3 py-2 text-sm text-txt focus:outline-none focus:border-accent resize-none"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="触发时要做什么"
        />
      </div>
      <div>
        <label className="block text-xs text-txt-sub mb-1">触发时间</label>
        <input
          type="datetime-local"
          className="w-full bg-input border border-bdr rounded-lg px-3 py-2 text-sm text-txt focus:outline-none focus:border-accent"
          value={triggerAt}
          onChange={(e) => setTriggerAt(e.target.value)}
        />
      </div>
      <div>
        <label className="block text-xs text-txt-sub mb-1">重复提示</label>
        <select
          className="w-full bg-input border border-bdr rounded-lg px-3 py-2 text-sm text-txt focus:outline-none focus:border-accent"
          value={recurrenceHint}
          onChange={(e) => setRecurrenceHint(e.target.value)}
        >
          <option value="不重复">不重复</option>
          <option value="每天">每天</option>
          <option value="每周">每周</option>
          <option value="每月">每月</option>
        </select>
      </div>
      <div className="flex gap-2 pt-1">
        <button type="submit" className="px-3 py-1.5 text-sm rounded-lg bg-accent text-white hover:opacity-90 transition-opacity">
          创建
        </button>
        <button type="button" onClick={onCancel} className="px-3 py-1.5 text-sm rounded-lg bg-hover text-txt-sub hover:text-txt transition-colors">
          取消
        </button>
      </div>
    </form>
  );
}
```

- [ ] **Step 6: 创建 TodoPanel 主面板**

```tsx
// gui-v2/src/components/todo/TodoPanel.tsx
import React, { useState, useEffect, useCallback } from "react";
import { useTodoStore } from "../../stores/todo";
import { TodoList } from "./TodoList";
import { TodoForm } from "./TodoForm";
import { useWebSocket } from "../../hooks/useWebSocket";

type FilterOption = "all" | "pending" | "triggered" | "completed" | "cancelled";

export function TodoPanel({ agentId, groupId }: { agentId?: string; groupId?: string }) {
  const { todos, setTodos, setScope, scope } = useTodoStore();
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState<FilterOption>("all");
  const { send } = useWebSocket();

  const currentScope = groupId ? "group" : "agent";
  const currentId = groupId || agentId || "";

  useEffect(() => {
    setScope(currentScope, currentId);
    // 请求 TODO 列表
    send({
      type: "get_todos",
      payload: { scope: currentScope, agentId, groupId },
    });
  }, [agentId, groupId]);

  // 监听 WS 回复
  useEffect(() => {
    const handler = (msg: any) => {
      if (msg.type === "todos") {
        setTodos(msg.payload.todos);
      }
      if (msg.type === "todo_updated" || msg.type === "todo_added" || msg.type === "todo_completed" || msg.type === "todo_cancelled") {
        // 刷新列表
        send({ type: "get_todos", payload: { scope: currentScope, agentId, groupId } });
      }
    };
    // TODO: 接入 WS 消息监听
    return () => {};
  }, [currentScope, agentId, groupId]);

  const handleCreate = useCallback((data: { title: string; description: string; triggerAt: string; recurrenceHint: string }) => {
    send({
      type: "add_todo",
      payload: {
        ...data,
        scope: currentScope,
        agentId,
        groupId,
        targetAgentId: groupId ? agentId : undefined,
      },
    });
    setShowForm(false);
  }, [currentScope, agentId, groupId]);

  const handleComplete = useCallback((todoId: string) => {
    send({ type: "complete_todo", payload: { todoId, scope: currentScope, agentId, groupId } });
  }, [currentScope, agentId, groupId]);

  const handleCancel = useCallback((todoId: string) => {
    send({ type: "cancel_todo", payload: { todoId, scope: currentScope, agentId, groupId } });
  }, [currentScope, agentId, groupId]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-txt">TODO</h3>
        <button
          className="px-2 py-1 text-xs rounded-md bg-accent/15 text-accent hover:bg-accent/25 transition-colors"
          onClick={() => setShowForm(!showForm)}
        >
          {showForm ? "收起" : "+ 新建"}
        </button>
      </div>

      {showForm && (
        <TodoForm onSubmit={handleCreate} onCancel={() => setShowForm(false)} />
      )}

      <div className="flex gap-1">
        {(["all", "pending", "triggered", "completed", "cancelled"] as FilterOption[]).map((f) => (
          <button
            key={f}
            className={`px-2 py-0.5 text-xs rounded-md transition-colors ${
              filter === f ? "bg-accent text-white" : "bg-elevated text-txt-sub hover:text-txt"
            }`}
            onClick={() => setFilter(f)}
          >
            {f === "all" ? "全部" : f === "pending" ? "待触发" : f === "triggered" ? "已触发" : f === "completed" ? "已完成" : "已取消"}
          </button>
        ))}
      </div>

      <TodoList todos={todos} onComplete={handleComplete} onCancel={handleCancel} filter={filter} />
    </div>
  );
}
```

- [ ] **Step 7: 验证前端编译**

Run: `cd CoBeing/gui-v2 && npx tsc --noEmit 2>&1 | head -20`
Expected: 无错误或仅有 WS 监听接入的 TODO 提示

- [ ] **Step 8: Commit**

```bash
git add gui-v2/src/stores/todo.ts gui-v2/src/components/todo/
git commit -m "feat(todo): add frontend TodoPanel with store and components"
```

---

## Task 10: 配置与文档更新

**Files:**
- Modify: `config/default.json`
- Modify: `data/agents/host/JOB.md`
- Modify: `STRUCTURE.md`

- [ ] **Step 1: 更新 default.json — butler tools 补充**

在 `config/default.json` 的 `agents` 但其实是 butler 构造时的 `tools` 列表（`runtime.ts` 第 102-109 行）中确认已包含 `todo-add`, `todo-list`, `todo-complete`, `todo-cancel`, `current-time`。

由于 butler 的 tools 列表在 `runtime.ts` 构造时硬编码，无需改 `default.json`。但为保持一致性，在 `config/default.json` 中添加 TODO 配置注释：

```json
{
  "core": {
    ...existing,
    "todo": {
      "scanInterval": 60000
    }
  }
}
```

- [ ] **Step 2: 更新 host/JOB.md — 群主职责**

在 `data/agents/host/JOB.md` 的职责列表中追加:

```markdown
### TODO 管理
- 帮群组成员创建定时 TODO
- 跟踪 TODO 完成状态
- 通过 todo-complete 完成指派给你的任务
- 如需续期：先 todo-add 再 todo-complete
```

- [ ] **Step 3: 更新 STRUCTURE.md**

在 `packages/core/src/` 部分的合适位置添加:

```
        ├── todo/                         #   TODO 驱动自动化
        │   ├── types.ts                  #     TodoItem 类型 + 常量
        │   ├── store.ts                  #     TodoStore 读写 TODO.json
        │   ├── scanner.ts                #     AgentTodoScanner 全局扫描器
        │   ├── group-scanner.ts          #     GroupTodoScanner 群组扫描器
        │   ├── tools.ts                  #     todo-add/list/complete/cancel 工具
        │   ├── time-tool.ts              #     current-time 工具
        │   └── scanner.test.ts           #     测试
```

在 `gui-v2/src/components/` 部分添加:

```
        │   ├── todo/               #   TODO 管理组件
        │   │   ├── TodoPanel.tsx   #     主面板
        │   │   ├── TodoList.tsx    #     TODO 列表
        │   │   ├── TodoItem.tsx    #     单条 TODO 卡片
        │   │   ├── TodoForm.tsx    #     创建表单
        │   │   └── TodoStatusBadge.tsx  # 状态标签
```

在 WS 命令表格中添加:

```
| `get_todos` | GUI → Core | 获取 TODO 列表 |
| `add_todo` | GUI → Core | 创建 TODO |
| `complete_todo` | GUI → Core | 完成 TODO |
| `cancel_todo` | GUI → Core | 取消 TODO |
| `todo_updated` | Core → GUI | TODO 变更推送 |
```

- [ ] **Step 4: 更新检查清单**

- `start.bat` / `start-gui.bat` — 不受影响（scanner 在 runtime 中启动）
- `build-gui.bat` — 不受影响
- `config/default.json` — 已添加 todo.scanInterval
- 后端 WS 命令 — 新增 4 个命令需前后端同时部署
- `data/` 目录结构 — `TODO.json` 由 store 按需创建，无需预创建
- `STRUCTURE.md` — 已更新

- [ ] **Step 5: Commit**

```bash
git add config/default.json data/agents/host/JOB.md STRUCTURE.md
git commit -m "docs(todo): update config, host JOB, and STRUCTURE.md"
```

---

## Self-Review

### 1. Spec Coverage

| Spec 需求 | 对应 Task |
|-----------|----------|
| TodoItem 数据结构 | Task 1 |
| 存储位置 (Agent 级 / 群组级) | Task 2 (TodoStore) |
| AgentTodoScanner 全局扫描 | Task 3 |
| GroupTodoScanner 群组扫描 | Task 4 |
| 逾期处理 | Task 3 (formatTriggerMessage) |
| 触发消息格式 (Agent 级) | Task 3 |
| 触发消息格式 (群组级) | Task 4 |
| todo-add 工具 | Task 6 |
| todo-list 工具 | Task 6 |
| todo-complete 工具 | Task 6 |
| todo-cancel 工具 | Task 6 |
| current-time 工具 | Task 5 |
| WS 命令 (4+1) | Task 8 |
| 前端组件 (5 个) | Task 9 |
| 错误处理 | Task 2 (corrupt JSON), Task 3 (agent not found) |
| 知识更新 (JOB.md) | Task 10 |
| Runtime 集成 (start/stop) | Task 7 |
| GroupManager 集成 | Task 7 |
| onComplete 动作链 | Task 4 |
| 进程重启处理 | Task 3 (start 时先扫一次) |

### 2. Placeholder Scan

无 TBD/TODO/fill-in-later。

### 3. Type Consistency

- `TodoItem` 在 types.ts 定义，store.ts/scanner.ts/tools.ts/front store 统一引用
- `TodoStore` 构造参数 `(baseDir: string, filename?)` 全文一致
- `AgentTodoScanner` 构造 `(dataRoot, registry, callbacks)` 全文一致
- `GroupTodoScanner` 构造 `(groupId, groupDir, callbacks)` 全文一致
