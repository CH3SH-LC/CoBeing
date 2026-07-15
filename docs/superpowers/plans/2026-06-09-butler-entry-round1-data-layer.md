# Butler Entry Round 1: Data Layer + Core Agent Filtering — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build shared types for the Butler entry bridge, three backend JSON-file-persisted stores (GlobalTodoStore, ButlerTaskStore, GroupButlerBindingStore), frontend core agent filtering (butler/host hidden from user Agent views), and a placeholder butlerTasks Zustand store.

**Architecture:** Shared types in `@cobeing/shared` define the data contracts. Three independent JSON-file stores in `@cobeing/core` each follow the existing TodoStore pattern (atomic write via tmp+rename, auto-create directories). Frontend filtering is a pure function library (`coreAgents.ts`) applied at UI render points only — store data is preserved. A frontend Zustand store (`butlerTasks.ts`) provides an empty type scaffold for future API integration.

**Tech Stack:** TypeScript 5.x, Node.js (fs/path/crypto), Vitest, Zustand, React 18

---

## File Structure

| # | Action | File | Responsibility |
|---|--------|------|----------------|
| 1 | Create | `packages/shared/src/butler-bridge.ts` | Shared types: ButlerTask, GlobalTodoItem, GroupButlerBinding, ButlerEscalationEvent, ButlerUserQuestion, constants |
| 2 | Create | `packages/shared/src/butler-bridge.test.ts` | Validate constants and type structure |
| 3 | Modify | `packages/shared/src/index.ts` | Export `butler-bridge.ts` |
| 4 | Create | `packages/core/src/todo/global-store.ts` | GlobalTodoStore — CRUD for GlobalTodoItem, JSON file persistence |
| 5 | Create | `packages/core/src/todo/global-store.test.ts` | Tests: CRUD, persistence round-trip, edge cases |
| 6 | Create | `packages/core/src/butler/butler-task-store.ts` | ButlerTaskStore — CRUD + status transitions, JSON file persistence |
| 7 | Create | `packages/core/src/butler/butler-task-store.test.ts` | Tests: CRUD, state machine transitions, persistence |
| 8 | Create | `packages/core/src/butler/butler-binding-store.ts` | GroupButlerBindingStore — CRUD, auto-creation defaults |
| 9 | Create | `packages/core/src/butler/butler-binding-store.test.ts` | Tests: CRUD, defaults, filtering |
| 10 | Modify | `packages/core/src/index.ts` | Export new stores |
| 11 | Create | `gui-v2/src/lib/coreAgents.ts` | CORE_AGENT_IDS, isCoreAgent(), getVisibleUserAgents() |
| 12 | Create | `gui-v2/src/stores/butlerTasks.ts` | Zustand store: ButlerTaskSummary[], summary counts, placeholder |
| 13 | Modify | `gui-v2/src/lib/types.ts` | Add ButlerTaskSummary frontend type |
| 14 | Modify | `gui-v2/src/components/layout/Sidebar.tsx` | Filter butler/host from Agent list and auto-select |
| 15 | Modify | `gui-v2/src/components/agent/AgentDetailPanel.tsx` | Guard: return null for core agents |
| 16 | Modify | `gui-v2/src/components/group/GroupMembersTab.tsx` | Filter butler/host from member selection |
| 17 | Modify | `gui-v2/src/components/group/CreateGroupDialog.tsx` | Filter butler/host from initial member candidates |

**Total: 10 new files, 7 modified files**

---

### Task 1: Shared Types — Butler Bridge

**Files:**
- Create: `packages/shared/src/butler-bridge.ts`
- Create: `packages/shared/src/butler-bridge.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Create the shared types file**

Write `packages/shared/src/butler-bridge.ts`:

```ts
// packages/shared/src/butler-bridge.ts
// Butler entry bridge shared types — Round 1 data layer

// ========== Escalation Event Types ==========

export type ButlerEscalationType =
  | "needs_user_decision"
  | "blocked"
  | "completed"
  | "failed"
  | "scope_change"
  | "status_digest";

// ========== User Question ==========

export interface ButlerUserQuestion {
  prompt: string;
  choices?: Array<{
    id: string;
    label: string;
    description?: string;
    recommended?: boolean;
  }>;
  freeformAllowed: boolean;
}

// ========== Escalation Event ==========

export interface ButlerEscalationEvent {
  id: string;
  type: ButlerEscalationType;
  butlerTaskId: string;
  groupId: string;
  fromAgentId: string;
  severity: "info" | "warning" | "critical";
  summary: string;
  question?: ButlerUserQuestion;
  options?: Array<{
    id: string;
    label: string;
    tradeoff?: string;
    recommended?: boolean;
  }>;
  artifacts?: Array<{
    name: string;
    path?: string;
    url?: string;
    description?: string;
  }>;
  suggestedNextStep?: string;
  createdAt: string;
}

// ========== Butler Task ==========

export type ButlerTaskStatus =
  | "routing"
  | "dispatched"
  | "running"
  | "waiting_user"
  | "completed"
  | "failed"
  | "cancelled";

export interface MarketResourceRef {
  id: string;
  kind: "agent" | "group" | "skill" | "plugin";
  source: "official" | "community" | "local";
  status: "suggested" | "approved" | "installed" | "rejected";
}

export interface ButlerTask {
  id: string;
  globalTodoId: string;
  userMessageId?: string;
  title: string;
  goal: string;
  targetType: "agent" | "group";
  targetId: string;
  status: ButlerTaskStatus;
  acceptance?: string;
  constraints?: string[];
  userPreferences?: string[];
  marketResources?: MarketResourceRef[];
  latestSummary?: string;
  pendingQuestion?: ButlerUserQuestion;
  createdAt: string;
  updatedAt: string;
}

// ========== Global TODO Item ==========

export type GlobalTodoStatus =
  | "pending"
  | "running"
  | "waiting_user"
  | "completed"
  | "cancelled";

export interface ExecutionRef {
  scope: "agent" | "group";
  ownerId: string;
  todoId: string;
}

export interface GlobalTodoItem {
  id: string;
  title: string;
  description: string;
  status: GlobalTodoStatus;
  assigneeType: "butler" | "agent" | "group";
  assigneeId: string;
  responsibleAgentId?: string;
  butlerTaskId?: string;
  executionRefs?: ExecutionRef[];
  lastEvent?: ButlerEscalationEvent;
  blockerReason?: string;
  nextAction?: string;
  createdBy: "user" | "butler";
  createdAt: string;
  updatedAt: string;
}

// ========== Group Butler Binding ==========

export interface GroupButlerBinding {
  groupId: string;
  butlerId: "butler";
  alias: string;
  enabled: boolean;
  allowedEvents: ButlerEscalationType[];
  escalationPolicy: {
    routineProgress: "silent";
    blocked: "notify";
    needsUserDecision: "notify";
    completed: "notify";
    failed: "notify";
    scopeChange: "notify";
  };
  createdAt: string;
  updatedAt: string;
}

// ========== Constants ==========

export const DEFAULT_ESCALATION_POLICY: GroupButlerBinding["escalationPolicy"] = {
  routineProgress: "silent",
  blocked: "notify",
  needsUserDecision: "notify",
  completed: "notify",
  failed: "notify",
  scopeChange: "notify",
};

export const DEFAULT_ALLOWED_EVENTS: ButlerEscalationType[] = [
  "needs_user_decision",
  "blocked",
  "completed",
  "failed",
  "scope_change",
  "status_digest",
];

export const CORE_AGENT_IDS = new Set(["butler", "host"]);
```

- [ ] **Step 2: Create the test file**

Write `packages/shared/src/butler-bridge.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  CORE_AGENT_IDS,
  DEFAULT_ALLOWED_EVENTS,
  DEFAULT_ESCALATION_POLICY,
} from "./butler-bridge.js";

describe("CORE_AGENT_IDS", () => {
  it("contains butler and host", () => {
    expect(CORE_AGENT_IDS.has("butler")).toBe(true);
    expect(CORE_AGENT_IDS.has("host")).toBe(true);
  });

  it("does not contain arbitrary ids", () => {
    expect(CORE_AGENT_IDS.has("random-agent")).toBe(false);
    expect(CORE_AGENT_IDS.has("")).toBe(false);
  });

  it("is a Set with size 2", () => {
    expect(CORE_AGENT_IDS.size).toBe(2);
  });
});

describe("DEFAULT_ESCALATION_POLICY", () => {
  it("has all escalation policies set", () => {
    expect(DEFAULT_ESCALATION_POLICY.routineProgress).toBe("silent");
    expect(DEFAULT_ESCALATION_POLICY.blocked).toBe("notify");
    expect(DEFAULT_ESCALATION_POLICY.needsUserDecision).toBe("notify");
    expect(DEFAULT_ESCALATION_POLICY.completed).toBe("notify");
    expect(DEFAULT_ESCALATION_POLICY.failed).toBe("notify");
    expect(DEFAULT_ESCALATION_POLICY.scopeChange).toBe("notify");
  });
});

describe("DEFAULT_ALLOWED_EVENTS", () => {
  it("contains all six event types", () => {
    expect(DEFAULT_ALLOWED_EVENTS).toContain("needs_user_decision");
    expect(DEFAULT_ALLOWED_EVENTS).toContain("blocked");
    expect(DEFAULT_ALLOWED_EVENTS).toContain("completed");
    expect(DEFAULT_ALLOWED_EVENTS).toContain("failed");
    expect(DEFAULT_ALLOWED_EVENTS).toContain("scope_change");
    expect(DEFAULT_ALLOWED_EVENTS).toContain("status_digest");
  });

  it("has exactly six items", () => {
    expect(DEFAULT_ALLOWED_EVENTS).toHaveLength(6);
  });
});
```

- [ ] **Step 3: Run tests to verify they pass**

```powershell
npx vitest run packages/shared/src/butler-bridge.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 4: Add export to shared index**

Edit `packages/shared/src/index.ts` — add one line after the last export:

```ts
export * from "./butler-bridge.js";
```

- [ ] **Step 5: Build shared package to verify**

```powershell
pnpm --filter @cobeing/shared build
```

Expected: tsc compiles without errors.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/butler-bridge.ts packages/shared/src/butler-bridge.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): add Butler bridge types (ButlerTask, GlobalTodoItem, GroupButlerBinding, ButlerEscalationEvent)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: GlobalTodoStore

**Files:**
- Create: `packages/core/src/todo/global-store.ts`
- Create: `packages/core/src/todo/global-store.test.ts`

- [ ] **Step 1: Create GlobalTodoStore**

Write `packages/core/src/todo/global-store.ts`:

```ts
// packages/core/src/todo/global-store.ts
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createLogger } from "@cobeing/shared";
import type { GlobalTodoItem, GlobalTodoStatus } from "@cobeing/shared";

const log = createLogger("global-todo-store");

export class GlobalTodoStore {
  private filePath: string;

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, "global-todos.json");
  }

  /** 创建全局 TODO 条目 */
  create(input: Omit<GlobalTodoItem, "id" | "createdAt" | "updatedAt">): GlobalTodoItem {
    const now = new Date().toISOString();
    const item: GlobalTodoItem = {
      ...input,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    const items = this.readAll();
    items.push(item);
    this.writeAll(items);
    return item;
  }

  /** 获取单个条目 */
  get(id: string): GlobalTodoItem | undefined {
    return this.readAll().find(i => i.id === id);
  }

  /** 更新条目（部分字段） */
  update(id: string, patch: Partial<Omit<GlobalTodoItem, "id" | "createdAt">>): GlobalTodoItem | undefined {
    const items = this.readAll();
    const idx = items.findIndex(i => i.id === id);
    if (idx < 0) return undefined;
    items[idx] = { ...items[idx], ...patch, updatedAt: new Date().toISOString() };
    this.writeAll(items);
    return items[idx];
  }

  /** 删除条目 */
  delete(id: string): boolean {
    const items = this.readAll();
    const idx = items.findIndex(i => i.id === id);
    if (idx < 0) return false;
    items.splice(idx, 1);
    this.writeAll(items);
    return true;
  }

  /** 列出条目，支持过滤 */
  list(filter?: {
    status?: GlobalTodoStatus;
    assigneeType?: string;
    assigneeId?: string;
  }): GlobalTodoItem[] {
    let items = this.readAll();
    if (filter?.status) items = items.filter(i => i.status === filter.status);
    if (filter?.assigneeType) items = items.filter(i => i.assigneeType === filter.assigneeType);
    if (filter?.assigneeId) items = items.filter(i => i.assigneeId === filter.assigneeId);
    return items;
  }

  /** 按 ButlerTask ID 查找 */
  getByButlerTaskId(butlerTaskId: string): GlobalTodoItem | undefined {
    return this.readAll().find(i => i.butlerTaskId === butlerTaskId);
  }

  /** 按执行接受者查找 */
  getByAssignee(assigneeId: string): GlobalTodoItem[] {
    return this.readAll().filter(i => i.assigneeId === assigneeId);
  }

  /** 条目总数 */
  get count(): number {
    return this.readAll().length;
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
      log.error("Failed to read global-todos file %s: %s", this.filePath, err.message);
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

- [ ] **Step 2: Create the test file**

Write `packages/core/src/todo/global-store.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { GlobalTodoStore } from "./global-store.js";

describe("GlobalTodoStore", () => {
  let tmpDir: string;
  let store: GlobalTodoStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "global-todo-test-"));
    store = new GlobalTodoStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("create", () => {
    it("creates a new global todo item with auto-generated id and timestamps", () => {
      const item = store.create({
        title: "Plan trip",
        description: "Plan a 3-day trip to Hangzhou",
        status: "pending",
        assigneeType: "group",
        assigneeId: "group-1",
        createdBy: "user",
      });

      expect(item.id).toBeTruthy();
      expect(typeof item.id).toBe("string");
      expect(item.title).toBe("Plan trip");
      expect(item.status).toBe("pending");
      expect(item.createdAt).toBeTruthy();
      expect(item.updatedAt).toBeTruthy();
    });
  });

  describe("get", () => {
    it("returns item by id", () => {
      const created = store.create({
        title: "Test",
        description: "",
        status: "pending",
        assigneeType: "agent",
        assigneeId: "agent-1",
        createdBy: "butler",
      });

      const found = store.get(created.id);
      expect(found).toBeDefined();
      expect(found!.title).toBe("Test");
    });

    it("returns undefined for non-existent id", () => {
      expect(store.get("nonexistent")).toBeUndefined();
    });
  });

  describe("update", () => {
    it("updates fields and refreshes updatedAt", () => {
      const created = store.create({
        title: "Original",
        description: "",
        status: "pending",
        assigneeType: "agent",
        assigneeId: "a1",
        createdBy: "user",
      });

      const originalUpdatedAt = created.updatedAt;
      const updated = store.update(created.id, { status: "running", blockerReason: "waiting for input" });

      expect(updated).toBeDefined();
      expect(updated!.status).toBe("running");
      expect(updated!.blockerReason).toBe("waiting for input");
      expect(updated!.title).toBe("Original"); // unchanged fields preserved
      expect(updated!.updatedAt).not.toBe(originalUpdatedAt);
    });

    it("returns undefined for non-existent id", () => {
      expect(store.update("nonexistent", { status: "completed" })).toBeUndefined();
    });
  });

  describe("delete", () => {
    it("deletes item and returns true", () => {
      const created = store.create({
        title: "To delete",
        description: "",
        status: "pending",
        assigneeType: "butler",
        assigneeId: "butler",
        createdBy: "user",
      });

      expect(store.delete(created.id)).toBe(true);
      expect(store.get(created.id)).toBeUndefined();
    });

    it("returns false for non-existent id", () => {
      expect(store.delete("nonexistent")).toBe(false);
    });
  });

  describe("list", () => {
    it("returns all items without filter", () => {
      store.create({ title: "A", description: "", status: "pending", assigneeType: "agent", assigneeId: "a1", createdBy: "user" });
      store.create({ title: "B", description: "", status: "completed", assigneeType: "group", assigneeId: "g1", createdBy: "butler" });

      expect(store.list()).toHaveLength(2);
    });

    it("filters by status", () => {
      store.create({ title: "A", description: "", status: "pending", assigneeType: "agent", assigneeId: "a1", createdBy: "user" });
      store.create({ title: "B", description: "", status: "completed", assigneeType: "agent", assigneeId: "a1", createdBy: "user" });

      const pending = store.list({ status: "pending" });
      expect(pending).toHaveLength(1);
      expect(pending[0].title).toBe("A");
    });

    it("filters by assigneeType", () => {
      store.create({ title: "A", description: "", status: "pending", assigneeType: "agent", assigneeId: "a1", createdBy: "user" });
      store.create({ title: "B", description: "", status: "pending", assigneeType: "group", assigneeId: "g1", createdBy: "user" });

      const agents = store.list({ assigneeType: "agent" });
      expect(agents).toHaveLength(1);
      expect(agents[0].title).toBe("A");
    });

    it("filters by assigneeId", () => {
      store.create({ title: "A", description: "", status: "pending", assigneeType: "agent", assigneeId: "a1", createdBy: "user" });
      store.create({ title: "B", description: "", status: "pending", assigneeType: "agent", assigneeId: "a2", createdBy: "user" });

      const forA1 = store.list({ assigneeId: "a1" });
      expect(forA1).toHaveLength(1);
    });
  });

  describe("getByButlerTaskId", () => {
    it("finds item by butlerTaskId", () => {
      store.create({
        title: "Test",
        description: "",
        status: "pending",
        assigneeType: "group",
        assigneeId: "g1",
        createdBy: "butler",
        butlerTaskId: "bt-1",
      });

      const found = store.getByButlerTaskId("bt-1");
      expect(found).toBeDefined();
      expect(found!.title).toBe("Test");
    });

    it("returns undefined when no match", () => {
      expect(store.getByButlerTaskId("nonexistent")).toBeUndefined();
    });
  });

  describe("getByAssignee", () => {
    it("returns all items for a given assignee", () => {
      store.create({ title: "Task 1", description: "", status: "pending", assigneeType: "group", assigneeId: "g1", createdBy: "user" });
      store.create({ title: "Task 2", description: "", status: "running", assigneeType: "group", assigneeId: "g1", createdBy: "butler" });
      store.create({ title: "Task 3", description: "", status: "pending", assigneeType: "agent", assigneeId: "a1", createdBy: "user" });

      const g1Items = store.getByAssignee("g1");
      expect(g1Items).toHaveLength(2);
    });
  });

  describe("count", () => {
    it("returns the number of items", () => {
      expect(store.count).toBe(0);
      store.create({ title: "A", description: "", status: "pending", assigneeType: "agent", assigneeId: "a1", createdBy: "user" });
      expect(store.count).toBe(1);
      store.create({ title: "B", description: "", status: "pending", assigneeType: "agent", assigneeId: "a1", createdBy: "user" });
      expect(store.count).toBe(2);
    });
  });

  describe("persistence round-trip", () => {
    it("survives store re-creation", () => {
      const store1 = new GlobalTodoStore(tmpDir);
      const created = store1.create({
        title: "Persist me",
        description: "Test",
        status: "pending",
        assigneeType: "agent",
        assigneeId: "a1",
        createdBy: "user",
      });

      const store2 = new GlobalTodoStore(tmpDir);
      const loaded = store2.get(created.id);
      expect(loaded).toBeDefined();
      expect(loaded!.title).toBe("Persist me");
    });
  });
});
```

- [ ] **Step 3: Run tests**

```powershell
npx vitest run packages/core/src/todo/global-store.test.ts
```

Expected: All 12 tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/todo/global-store.ts packages/core/src/todo/global-store.test.ts
git commit -m "feat(core): add GlobalTodoStore for user-level task ledger

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: ButlerTaskStore

**Files:**
- Create: `packages/core/src/butler/butler-task-store.ts`
- Create: `packages/core/src/butler/butler-task-store.test.ts`

- [ ] **Step 1: Create ButlerTaskStore**

Write `packages/core/src/butler/butler-task-store.ts`:

```ts
// packages/core/src/butler/butler-task-store.ts
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createLogger } from "@cobeing/shared";
import type { ButlerTask, ButlerTaskStatus } from "@cobeing/shared";

const log = createLogger("butler-task-store");

/** 状态迁移合法性映射 */
const VALID_TRANSITIONS: Record<ButlerTaskStatus, ButlerTaskStatus[]> = {
  routing: ["dispatched", "cancelled"],
  dispatched: ["running", "cancelled"],
  running: ["waiting_user", "completed", "failed", "cancelled"],
  waiting_user: ["running", "completed", "cancelled"],
  completed: ["running"], // 返工
  failed: ["running", "cancelled"], // 重试或取消
  cancelled: [], // 终态
};

export class ButlerTaskStore {
  private filePath: string;

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, "butler-tasks.json");
  }

  /** 创建 ButlerTask */
  create(input: Omit<ButlerTask, "id" | "createdAt" | "updatedAt">): ButlerTask {
    const now = new Date().toISOString();
    const task: ButlerTask = {
      ...input,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    const tasks = this.readAll();
    tasks.push(task);
    this.writeAll(tasks);
    return task;
  }

  /** 获取单个任务 */
  get(id: string): ButlerTask | undefined {
    return this.readAll().find(t => t.id === id);
  }

  /** 更新任务字段 */
  update(id: string, patch: Partial<Omit<ButlerTask, "id" | "createdAt">>): ButlerTask | undefined {
    const tasks = this.readAll();
    const idx = tasks.findIndex(t => t.id === id);
    if (idx < 0) return undefined;
    tasks[idx] = { ...tasks[idx], ...patch, updatedAt: new Date().toISOString() };
    this.writeAll(tasks);
    return tasks[idx];
  }

  /** 状态迁移（含校验） */
  transition(id: string, to: ButlerTaskStatus): ButlerTask | undefined {
    const task = this.get(id);
    if (!task) return undefined;

    const allowed = VALID_TRANSITIONS[task.status];
    if (!allowed.includes(to)) {
      log.warn("Invalid transition: %s -> %s (task %s)", task.status, to, id);
      return undefined;
    }

    return this.update(id, { status: to });
  }

  /** 删除任务 */
  delete(id: string): boolean {
    const tasks = this.readAll();
    const idx = tasks.findIndex(t => t.id === id);
    if (idx < 0) return false;
    tasks.splice(idx, 1);
    this.writeAll(tasks);
    return true;
  }

  /** 列出任务，支持过滤 */
  list(filter?: { status?: ButlerTaskStatus; targetType?: string; targetId?: string }): ButlerTask[] {
    let tasks = this.readAll();
    if (filter?.status) tasks = tasks.filter(t => t.status === filter.status);
    if (filter?.targetType) tasks = tasks.filter(t => t.targetType === filter.targetType);
    if (filter?.targetId) tasks = tasks.filter(t => t.targetId === filter.targetId);
    return tasks;
  }

  /** 按 GlobalTodo ID 查找 */
  getByGlobalTodoId(globalTodoId: string): ButlerTask | undefined {
    return this.readAll().find(t => t.globalTodoId === globalTodoId);
  }

  /** 按目标（Agent/Group）查找 */
  getByTarget(targetId: string): ButlerTask[] {
    return this.readAll().filter(t => t.targetId === targetId);
  }

  /** 条目总数 */
  get count(): number {
    return this.readAll().length;
  }

  // ---- Private ----

  private readAll(): ButlerTask[] {
    try {
      if (!fs.existsSync(this.filePath)) return [];
      const raw = fs.readFileSync(this.filePath, "utf-8").trim();
      if (!raw) return [];
      const data = JSON.parse(raw);
      return Array.isArray(data) ? data : [];
    } catch (err: any) {
      log.error("Failed to read butler-tasks file %s: %s", this.filePath, err.message);
      return [];
    }
  }

  private writeAll(tasks: ButlerTask[]): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmpPath = this.filePath + ".tmp";
    fs.writeFileSync(tmpPath, JSON.stringify(tasks, null, 2), "utf-8");
    fs.renameSync(tmpPath, this.filePath);
  }
}
```

- [ ] **Step 2: Create the test file**

Write `packages/core/src/butler/butler-task-store.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ButlerTaskStore } from "./butler-task-store.js";

describe("ButlerTaskStore", () => {
  let tmpDir: string;
  let store: ButlerTaskStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "butler-task-test-"));
    store = new ButlerTaskStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("create", () => {
    it("creates a task with auto-generated id", () => {
      const task = store.create({
        globalTodoId: "gt-1",
        title: "Plan trip",
        goal: "3-day Hangzhou trip",
        targetType: "group",
        targetId: "group-1",
        status: "routing",
      });

      expect(task.id).toBeTruthy();
      expect(task.globalTodoId).toBe("gt-1");
      expect(task.status).toBe("routing");
      expect(task.createdAt).toBeTruthy();
    });
  });

  describe("get", () => {
    it("returns task by id", () => {
      const created = store.create({
        globalTodoId: "gt-1",
        title: "Test",
        goal: "",
        targetType: "agent",
        targetId: "a1",
        status: "dispatched",
      });
      expect(store.get(created.id)?.title).toBe("Test");
    });
  });

  describe("update", () => {
    it("updates fields", () => {
      const created = store.create({
        globalTodoId: "gt-1",
        title: "Original",
        goal: "",
        targetType: "agent",
        targetId: "a1",
        status: "routing",
      });
      const updated = store.update(created.id, { title: "Updated", latestSummary: "In progress" });
      expect(updated?.title).toBe("Updated");
      expect(updated?.latestSummary).toBe("In progress");
    });
  });

  describe("transition", () => {
    it("allows valid routing -> dispatched", () => {
      const created = store.create({
        globalTodoId: "gt-1",
        title: "Test",
        goal: "",
        targetType: "group",
        targetId: "g1",
        status: "routing",
      });
      const result = store.transition(created.id, "dispatched");
      expect(result?.status).toBe("dispatched");
    });

    it("allows valid dispatched -> running", () => {
      const created = store.create({
        globalTodoId: "gt-1",
        title: "Test",
        goal: "",
        targetType: "group",
        targetId: "g1",
        status: "dispatched",
      });
      const result = store.transition(created.id, "running");
      expect(result?.status).toBe("running");
    });

    it("allows valid running -> waiting_user", () => {
      const created = store.create({
        globalTodoId: "gt-1",
        title: "Test",
        goal: "",
        targetType: "group",
        targetId: "g1",
        status: "running",
      });
      const result = store.transition(created.id, "waiting_user");
      expect(result?.status).toBe("waiting_user");
    });

    it("allows valid waiting_user -> completed", () => {
      const created = store.create({
        globalTodoId: "gt-1",
        title: "Test",
        goal: "",
        targetType: "group",
        targetId: "g1",
        status: "waiting_user",
      });
      const result = store.transition(created.id, "completed");
      expect(result?.status).toBe("completed");
    });

    it("allows completed -> running (rework)", () => {
      const created = store.create({
        globalTodoId: "gt-1",
        title: "Test",
        goal: "",
        targetType: "group",
        targetId: "g1",
        status: "completed",
      });
      const result = store.transition(created.id, "running");
      expect(result?.status).toBe("running");
    });

    it("rejects invalid routing -> completed", () => {
      const created = store.create({
        globalTodoId: "gt-1",
        title: "Test",
        goal: "",
        targetType: "group",
        targetId: "g1",
        status: "routing",
      });
      const result = store.transition(created.id, "completed");
      expect(result).toBeUndefined();
      expect(store.get(created.id)?.status).toBe("routing");
    });

    it("rejects transition from cancelled", () => {
      const created = store.create({
        globalTodoId: "gt-1",
        title: "Test",
        goal: "",
        targetType: "group",
        targetId: "g1",
        status: "cancelled",
      });
      const result = store.transition(created.id, "running");
      expect(result).toBeUndefined();
    });
  });

  describe("delete", () => {
    it("deletes and returns true", () => {
      const created = store.create({
        globalTodoId: "gt-1",
        title: "Delete me",
        goal: "",
        targetType: "agent",
        targetId: "a1",
        status: "routing",
      });
      expect(store.delete(created.id)).toBe(true);
      expect(store.get(created.id)).toBeUndefined();
    });
  });

  describe("list", () => {
    it("filters by status", () => {
      store.create({ globalTodoId: "gt-1", title: "A", goal: "", targetType: "agent", targetId: "a1", status: "routing" });
      store.create({ globalTodoId: "gt-2", title: "B", goal: "", targetType: "group", targetId: "g1", status: "running" });

      const routing = store.list({ status: "routing" });
      expect(routing).toHaveLength(1);
    });

    it("filters by targetType", () => {
      store.create({ globalTodoId: "gt-1", title: "A", goal: "", targetType: "agent", targetId: "a1", status: "routing" });
      store.create({ globalTodoId: "gt-2", title: "B", goal: "", targetType: "group", targetId: "g1", status: "routing" });

      expect(store.list({ targetType: "group" })).toHaveLength(1);
    });
  });

  describe("getByGlobalTodoId", () => {
    it("finds by global todo id", () => {
      store.create({ globalTodoId: "gt-1", title: "Test", goal: "", targetType: "agent", targetId: "a1", status: "routing" });
      expect(store.getByGlobalTodoId("gt-1")?.title).toBe("Test");
      expect(store.getByGlobalTodoId("nonexistent")).toBeUndefined();
    });
  });

  describe("getByTarget", () => {
    it("returns all tasks for a target", () => {
      store.create({ globalTodoId: "gt-1", title: "A", goal: "", targetType: "agent", targetId: "a1", status: "routing" });
      store.create({ globalTodoId: "gt-2", title: "B", goal: "", targetType: "agent", targetId: "a1", status: "running" });
      store.create({ globalTodoId: "gt-3", title: "C", goal: "", targetType: "agent", targetId: "a2", status: "routing" });

      expect(store.getByTarget("a1")).toHaveLength(2);
    });
  });

  describe("persistence round-trip", () => {
    it("survives store re-creation", () => {
      const s1 = new ButlerTaskStore(tmpDir);
      const created = s1.create({
        globalTodoId: "gt-1",
        title: "Persist",
        goal: "Test persistence",
        targetType: "group",
        targetId: "g1",
        status: "routing",
        acceptance: "Done",
      });

      const s2 = new ButlerTaskStore(tmpDir);
      const loaded = s2.get(created.id);
      expect(loaded?.title).toBe("Persist");
      expect(loaded?.acceptance).toBe("Done");
    });
  });
});
```

- [ ] **Step 3: Run tests**

```powershell
npx vitest run packages/core/src/butler/butler-task-store.test.ts
```

Expected: All tests pass (14 tests covering CRUD, transitions, filters, persistence).

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/butler/butler-task-store.ts packages/core/src/butler/butler-task-store.test.ts
git commit -m "feat(core): add ButlerTaskStore with state machine transitions

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: GroupButlerBindingStore

**Files:**
- Create: `packages/core/src/butler/butler-binding-store.ts`
- Create: `packages/core/src/butler/butler-binding-store.test.ts`

- [ ] **Step 1: Create GroupButlerBindingStore**

Write `packages/core/src/butler/butler-binding-store.ts`:

```ts
// packages/core/src/butler/butler-binding-store.ts
import fs from "node:fs";
import path from "node:path";
import { createLogger } from "@cobeing/shared";
import {
  DEFAULT_ALLOWED_EVENTS,
  DEFAULT_ESCALATION_POLICY,
  type GroupButlerBinding,
} from "@cobeing/shared";

const log = createLogger("butler-binding-store");

export class GroupButlerBindingStore {
  private filePath: string;

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, "butler-bindings.json");
  }

  /** 创建群组管家绑定（使用默认策略） */
  create(
    groupId: string,
    overrides?: Partial<Pick<GroupButlerBinding, "alias" | "enabled" | "allowedEvents" | "escalationPolicy">>,
  ): GroupButlerBinding {
    // 检查是否已存在
    const existing = this.get(groupId);
    if (existing) return existing;

    const now = new Date().toISOString();
    const binding: GroupButlerBinding = {
      groupId,
      butlerId: "butler",
      alias: overrides?.alias ?? "管家",
      enabled: overrides?.enabled ?? true,
      allowedEvents: overrides?.allowedEvents ?? [...DEFAULT_ALLOWED_EVENTS],
      escalationPolicy: overrides?.escalationPolicy ?? { ...DEFAULT_ESCALATION_POLICY },
      createdAt: now,
      updatedAt: now,
    };

    const bindings = this.readAll();
    bindings.push(binding);
    this.writeAll(bindings);
    return binding;
  }

  /** 获取绑定 */
  get(groupId: string): GroupButlerBinding | undefined {
    return this.readAll().find(b => b.groupId === groupId);
  }

  /** 更新绑定 */
  update(groupId: string, patch: Partial<Omit<GroupButlerBinding, "groupId" | "butlerId" | "createdAt">>): GroupButlerBinding | undefined {
    const bindings = this.readAll();
    const idx = bindings.findIndex(b => b.groupId === groupId);
    if (idx < 0) return undefined;
    bindings[idx] = { ...bindings[idx], ...patch, updatedAt: new Date().toISOString() };
    this.writeAll(bindings);
    return bindings[idx];
  }

  /** 删除绑定 */
  delete(groupId: string): boolean {
    const bindings = this.readAll();
    const idx = bindings.findIndex(b => b.groupId === groupId);
    if (idx < 0) return false;
    bindings.splice(idx, 1);
    this.writeAll(bindings);
    return true;
  }

  /** 列出所有绑定 */
  list(): GroupButlerBinding[] {
    return this.readAll();
  }

  /** 列出已启用的绑定 */
  listEnabled(): GroupButlerBinding[] {
    return this.readAll().filter(b => b.enabled);
  }

  /** 绑定总数 */
  get count(): number {
    return this.readAll().length;
  }

  // ---- Private ----

  private readAll(): GroupButlerBinding[] {
    try {
      if (!fs.existsSync(this.filePath)) return [];
      const raw = fs.readFileSync(this.filePath, "utf-8").trim();
      if (!raw) return [];
      const data = JSON.parse(raw);
      return Array.isArray(data) ? data : [];
    } catch (err: any) {
      log.error("Failed to read butler-bindings file %s: %s", this.filePath, err.message);
      return [];
    }
  }

  private writeAll(bindings: GroupButlerBinding[]): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmpPath = this.filePath + ".tmp";
    fs.writeFileSync(tmpPath, JSON.stringify(bindings, null, 2), "utf-8");
    fs.renameSync(tmpPath, this.filePath);
  }
}
```

- [ ] **Step 2: Create the test file**

Write `packages/core/src/butler/butler-binding-store.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { GroupButlerBindingStore } from "./butler-binding-store.js";

describe("GroupButlerBindingStore", () => {
  let tmpDir: string;
  let store: GroupButlerBindingStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "butler-binding-test-"));
    store = new GroupButlerBindingStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("create", () => {
    it("creates a binding with defaults", () => {
      const binding = store.create("group-1");
      expect(binding.groupId).toBe("group-1");
      expect(binding.butlerId).toBe("butler");
      expect(binding.alias).toBe("管家");
      expect(binding.enabled).toBe(true);
      expect(binding.allowedEvents).toHaveLength(6);
      expect(binding.escalationPolicy.blocked).toBe("notify");
    });

    it("returns existing binding if already exists", () => {
      const first = store.create("group-1", { alias: "custom" });
      const second = store.create("group-1", { alias: "ignored" });
      expect(second.alias).toBe("custom");
      expect(store.count).toBe(1);
    });

    it("accepts custom overrides", () => {
      const binding = store.create("group-1", {
        alias: "自定义管家",
        enabled: false,
      });
      expect(binding.alias).toBe("自定义管家");
      expect(binding.enabled).toBe(false);
    });
  });

  describe("get", () => {
    it("returns binding by groupId", () => {
      store.create("group-1");
      expect(store.get("group-1")?.groupId).toBe("group-1");
    });

    it("returns undefined for missing", () => {
      expect(store.get("nonexistent")).toBeUndefined();
    });
  });

  describe("update", () => {
    it("updates enabled flag", () => {
      store.create("group-1");
      const updated = store.update("group-1", { enabled: false });
      expect(updated?.enabled).toBe(false);
    });

    it("returns undefined for missing group", () => {
      expect(store.update("nonexistent", { enabled: false })).toBeUndefined();
    });
  });

  describe("delete", () => {
    it("deletes and returns true", () => {
      store.create("group-1");
      expect(store.delete("group-1")).toBe(true);
      expect(store.get("group-1")).toBeUndefined();
    });
  });

  describe("list", () => {
    it("returns all bindings", () => {
      store.create("g1");
      store.create("g2");
      expect(store.list()).toHaveLength(2);
    });
  });

  describe("listEnabled", () => {
    it("returns only enabled bindings", () => {
      store.create("g1");
      store.create("g2", { enabled: false });
      const enabled = store.listEnabled();
      expect(enabled).toHaveLength(1);
      expect(enabled[0].groupId).toBe("g1");
    });
  });

  describe("count", () => {
    it("returns binding count", () => {
      expect(store.count).toBe(0);
      store.create("g1");
      expect(store.count).toBe(1);
    });
  });

  describe("persistence round-trip", () => {
    it("survives store re-creation", () => {
      const s1 = new GroupButlerBindingStore(tmpDir);
      s1.create("group-1", { alias: "test" });

      const s2 = new GroupButlerBindingStore(tmpDir);
      const loaded = s2.get("group-1");
      expect(loaded?.alias).toBe("test");
    });
  });
});
```

- [ ] **Step 3: Run tests**

```powershell
npx vitest run packages/core/src/butler/butler-binding-store.test.ts
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/butler/butler-binding-store.ts packages/core/src/butler/butler-binding-store.test.ts
git commit -m "feat(core): add GroupButlerBindingStore for butler-group bindings

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Export new stores from core index

**Files:**
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Add exports**

Edit `packages/core/src/index.ts` — add these lines before the final export:

```ts
export { GlobalTodoStore } from "./todo/global-store.js";
export { ButlerTaskStore } from "./butler/butler-task-store.js";
export { GroupButlerBindingStore } from "./butler/butler-binding-store.js";
```

- [ ] **Step 2: Build core package to verify**

```powershell
pnpm --filter @cobeing/core build
```

Expected: tsc compiles without errors.

- [ ] **Step 3: Run all tests**

```powershell
pnpm test
```

Expected: All existing 427 + new tests pass (approximately 460 total).

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/index.ts
git commit -m "feat(core): export GlobalTodoStore, ButlerTaskStore, GroupButlerBindingStore

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Frontend coreAgents.ts + ButlerTaskSummary type

**Files:**
- Create: `gui-v2/src/lib/coreAgents.ts`
- Modify: `gui-v2/src/lib/types.ts`
- Create: `gui-v2/src/stores/butlerTasks.ts`

- [ ] **Step 1: Create coreAgents.ts**

Write `gui-v2/src/lib/coreAgents.ts`:

```ts
// gui-v2/src/lib/coreAgents.ts
// Core agent filtering — keeps butler/host out of user-facing Agent views

export const CORE_AGENT_IDS = new Set(["butler", "host"]);

export function isCoreAgent(id: string): boolean {
  return CORE_AGENT_IDS.has(id);
}

export function getVisibleUserAgents<T extends { id: string }>(agents: T[]): T[] {
  return agents.filter((agent) => !isCoreAgent(agent.id));
}
```

- [ ] **Step 2: Add ButlerTaskSummary type to frontend types**

Edit `gui-v2/src/lib/types.ts` — add at the end of the file:

```ts
// ========== Butler Task (frontend summary) ==========

export interface ButlerTaskSummary {
  id: string;
  title: string;
  assigneeType: "agent" | "group";
  assigneeId: string;
  assigneeName: string;
  status: "running" | "waiting_user" | "completed" | "cancelled";
  lastEvent: string;
  nextAction?: string;
  updatedAt: number;
}
```

- [ ] **Step 3: Create butlerTasks Zustand store**

Write `gui-v2/src/stores/butlerTasks.ts`:

```ts
import { create } from "zustand";
import type { ButlerTaskSummary } from "@/lib/types";

interface ButlerTasksState {
  tasks: ButlerTaskSummary[];
  loading: boolean;
  summary: {
    running: number;
    waitingUser: number;
    completed: number;
  };

  setTasks: (tasks: ButlerTaskSummary[]) => void;
  setLoading: (loading: boolean) => void;
  updateSummary: () => void;
  getByStatus: (status: ButlerTaskSummary["status"]) => ButlerTaskSummary[];
}

export const useButlerTasksStore = create<ButlerTasksState>((set, get) => ({
  tasks: [],
  loading: false,
  summary: { running: 0, waitingUser: 0, completed: 0 },

  setTasks: (tasks) => {
    set({
      tasks,
      summary: {
        running: tasks.filter((t) => t.status === "running").length,
        waitingUser: tasks.filter((t) => t.status === "waiting_user").length,
        completed: tasks.filter((t) => t.status === "completed").length,
      },
    });
  },

  setLoading: (loading) => set({ loading }),

  updateSummary: () => {
    const { tasks } = get();
    set({
      summary: {
        running: tasks.filter((t) => t.status === "running").length,
        waitingUser: tasks.filter((t) => t.status === "waiting_user").length,
        completed: tasks.filter((t) => t.status === "completed").length,
      },
    });
  },

  getByStatus: (status) => {
    return get().tasks.filter((t) => t.status === status);
  },
}));
```

- [ ] **Step 4: TypeScript check frontend**

```powershell
cd gui-v2; npx tsc --noEmit
```

Expected: Zero type errors from new files.

- [ ] **Step 5: Commit**

```bash
git add gui-v2/src/lib/coreAgents.ts gui-v2/src/lib/types.ts gui-v2/src/stores/butlerTasks.ts
git commit -m "feat(gui): add coreAgents filter helpers and butlerTasks Zustand store

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Frontend filtering — Sidebar, AgentDetailPanel, GroupMembersTab, CreateGroupDialog

**Files:**
- Modify: `gui-v2/src/components/layout/Sidebar.tsx`
- Modify: `gui-v2/src/components/agent/AgentDetailPanel.tsx`
- Modify: `gui-v2/src/components/group/GroupMembersTab.tsx`
- Modify: `gui-v2/src/components/group/CreateGroupDialog.tsx`

- [ ] **Step 1: Filter Sidebar Agent list**

Edit `gui-v2/src/components/layout/Sidebar.tsx`:

Add import near the top (after existing imports):

```ts
import { getVisibleUserAgents } from "@/lib/coreAgents";
```

Change line 22 from:
```ts
const agents = useAgentsStore((s) => s.agents);
```
to:
```ts
const rawAgents = useAgentsStore((s) => s.agents);
const agents = getVisibleUserAgents(rawAgents);
```

Change line 33 auto-select check from:
```ts
if (activeView === "agents" && agents.length > 0) {
```
to (no change — `agents` is already filtered):

The auto-select logic on line 32-38 already uses the `agents` variable which is now filtered. No additional change needed.

- [ ] **Step 2: Guard AgentDetailPanel**

Read `gui-v2/src/components/agent/AgentDetailPanel.tsx` first to understand its structure, then add a guard at the top of the component body that returns null for core agents:

Add import:
```ts
import { isCoreAgent } from "@/lib/coreAgents";
```

Add guard at the top of the component body (after hooks, before main JSX):
```ts
// Do not show detail panel for core agents (butler, host)
const selectedAgentId = useAgentsStore((s) => s.selectedAgent);
if (selectedAgentId && isCoreAgent(selectedAgentId)) return null;
```

- [ ] **Step 3: Filter GroupMembersTab member selection**

Read `gui-v2/src/components/group/GroupMembersTab.tsx` first. Find where the agent list is rendered for member selection, then wrap with `getVisibleUserAgents()`.

Add import:
```ts
import { getVisibleUserAgents } from "@/lib/coreAgents";
```

Find the agent list used for member selection and replace `agents` with `getVisibleUserAgents(agents)`.

- [ ] **Step 4: Filter CreateGroupDialog initial members**

Read `gui-v2/src/components/group/CreateGroupDialog.tsx` first. Find where initial member candidates are listed and apply the same filter.

Add import:
```ts
import { getVisibleUserAgents } from "@/lib/coreAgents";
```

Apply filter to the agent list used for member selection.

- [ ] **Step 5: TypeScript check frontend**

```powershell
cd gui-v2; npx tsc --noEmit
```

Expected: Zero type errors.

- [ ] **Step 6: Commit**

```bash
git add gui-v2/src/components/layout/Sidebar.tsx gui-v2/src/components/agent/AgentDetailPanel.tsx gui-v2/src/components/group/GroupMembersTab.tsx gui-v2/src/components/group/CreateGroupDialog.tsx
git commit -m "feat(gui): filter butler/host from user Agent views

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Full build + test verification

- [ ] **Step 1: Build all packages**

```powershell
pnpm build
```

Expected: All 7 workspace packages compile without errors.

- [ ] **Step 2: Run full test suite**

```powershell
pnpm test
```

Expected: All tests pass (existing 427 + new ~36 tests = ~463 total).

- [ ] **Step 3: Frontend type check**

```powershell
cd gui-v2; npx tsc --noEmit
```

Expected: Zero type errors.

- [ ] **Step 4: Verify file structure**

Check that new directories exist:

```powershell
# Backend
Test-Path "packages/core/src/butler/butler-task-store.ts"
Test-Path "packages/core/src/butler/butler-binding-store.ts"
Test-Path "packages/core/src/todo/global-store.ts"
Test-Path "packages/shared/src/butler-bridge.ts"

# Frontend
Test-Path "gui-v2/src/lib/coreAgents.ts"
Test-Path "gui-v2/src/stores/butlerTasks.ts"
```

Expected: All return `True`.

- [ ] **Step 5: Final commit if any changes from verification**

If all checks pass, no additional commit needed. If any fixes were applied:

```bash
git add -u
git commit -m "chore: final verification fixes for Round 1 data layer

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Summary

| Task | Files | New | Mod | Description |
|------|-------|-----|-----|-------------|
| 1 | 3 | 2 | 1 | Shared types (butler-bridge.ts + test + index export) |
| 2 | 2 | 2 | 0 | GlobalTodoStore (CRUD, JSON persistence) |
| 3 | 2 | 2 | 0 | ButlerTaskStore (CRUD, state machine, JSON persistence) |
| 4 | 2 | 2 | 0 | GroupButlerBindingStore (CRUD, defaults, JSON persistence) |
| 5 | 1 | 0 | 1 | Export new stores from core index |
| 6 | 3 | 2 | 1 | Frontend coreAgents.ts + ButlerTaskSummary type + Zustand store |
| 7 | 4 | 0 | 4 | UI filtering: Sidebar, AgentDetailPanel, GroupMembersTab, CreateGroupDialog |
| 8 | - | - | - | Full build + test verification |

**Total: 10 new files, 7 modified files, 8 tasks**
