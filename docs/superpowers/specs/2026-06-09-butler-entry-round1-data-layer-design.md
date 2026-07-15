# Round 1：管家入口数据层 + 核心 Agent 过滤 — 实施规格

**日期**: 2026-06-09
**状态**: 已确认
**父文档**: `docs/GOALS/butler-entry-bridge-design.md` + `docs/GOALS/frontend-butler-entry-polish-design.md`

---

## 1. 概述

Round 1 是 CoBeing 管家入口升级的第一层。目标：建立前后端共同的类型语言，创建三个后端数据 Store，并在前端实现核心 Agent（butler/host）的过滤。

本规格覆盖"全栈并进 / 分层执行"策略中的第一层。

---

## 2. 交付物总览

| # | 类型 | 文件 | 说明 |
|---|------|------|------|
| 1 | 新建 | `packages/shared/src/butler-bridge.ts` | 共享类型定义 |
| 2 | 新建 | `packages/shared/src/butler-bridge.test.ts` | 类型验证测试 |
| 3 | 新建 | `packages/core/src/todo/global-store.ts` | GlobalTodoStore |
| 4 | 新建 | `packages/core/src/todo/global-store.test.ts` | GlobalTodoStore 测试 |
| 5 | 新建 | `packages/core/src/butler/butler-task-store.ts` | ButlerTaskStore |
| 6 | 新建 | `packages/core/src/butler/butler-task-store.test.ts` | ButlerTaskStore 测试 |
| 7 | 新建 | `packages/core/src/butler/butler-binding-store.ts` | GroupButlerBindingStore |
| 8 | 新建 | `packages/core/src/butler/butler-binding-store.test.ts` | GroupButlerBindingStore 测试 |
| 9 | 新建 | `gui-v2/src/lib/coreAgents.ts` | 核心 Agent 过滤常量和 helper |
| 10 | 新建 | `gui-v2/src/stores/butlerTasks.ts` | 前端 ButlerTask Zustand store |
| 11 | 修改 | `packages/shared/src/index.ts` | 导出新类型 |
| 12 | 修改 | `packages/core/src/index.ts` | 导出新 Store |
| 13 | 修改 | `gui-v2/src/components/layout/Sidebar.tsx` | 过滤 butler/host |
| 14 | 修改 | `gui-v2/src/components/agent/AgentDetailPanel.tsx` | 防御性过滤 |
| 15 | 修改 | `gui-v2/src/components/group/GroupMembersTab.tsx` | 成员选择过滤 |
| 16 | 修改 | `gui-v2/src/components/group/CreateGroupDialog.tsx` | 统一使用 helper |
| 17 | 修改 | `gui-v2/src/lib/types.ts` | 新增前端类型映射 |
| 18 | 修改 | `gui-v2/src/hooks/useWebSocket.ts` | WS state 处理中过滤核心 Agent |

---

## 3. 共享类型定义

### 3.1 `packages/shared/src/butler-bridge.ts`

```ts
// ========== 回传事件类型 ==========

export type ButlerEscalationType =
  | "needs_user_decision"
  | "blocked"
  | "completed"
  | "failed"
  | "scope_change"
  | "status_digest";

// ========== 用户决策项 ==========

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

// ========== 回传事件 ==========

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

// ========== ButlerTask ==========

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

// ========== GlobalTodoItem ==========

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

// ========== GroupButlerBinding ==========

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

// ========== 常量 ==========

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

---

## 4. GlobalTodoStore

### 4.1 位置

`packages/core/src/todo/global-store.ts`

### 4.2 设计

- JSON 文件持久化，文件路径：`{dataRoot}/global-todos.json`
- 与现有 Agent/Group TodoStore 独立，不继承或复用
- 通过 `executionRefs` 关联执行空间内的 TODO

### 4.3 接口

```ts
export class GlobalTodoStore {
  constructor(dataDir: string);

  // CRUD
  create(item: Omit<GlobalTodoItem, "id" | "createdAt" | "updatedAt">): GlobalTodoItem;
  get(id: string): GlobalTodoItem | undefined;
  update(id: string, patch: Partial<GlobalTodoItem>): GlobalTodoItem;
  delete(id: string): boolean;

  // Query
  list(filter?: { status?: GlobalTodoStatus; assigneeType?: string; assigneeId?: string }): GlobalTodoItem[];
  getByButlerTaskId(butlerTaskId: string): GlobalTodoItem | undefined;
  getByAssignee(assigneeId: string): GlobalTodoItem[];

  // 内部
  private load(): void;
  private save(): void;

  // 属性
  get count(): number;
}
```

### 4.4 数据流

```
Butler 派发任务 → GlobalTodoStore.create() → JSON 文件
                 → ButlerTaskStore.create() → JSON 文件（关联 globalTodoId）
Group 完成    → GlobalTodoStore.update(status="completed")
              → ButlerTaskStore.update(status="completed")
```

---

## 5. ButlerTaskStore

### 5.1 位置

`packages/core/src/butler/butler-task-store.ts`

### 5.2 设计

- JSON 文件持久化，文件路径：`{dataRoot}/butler-tasks.json`
- 记录管家侧的任务编排状态
- 与 GlobalTodoStore 通过 `globalTodoId` 双向关联

### 5.3 接口

```ts
export class ButlerTaskStore {
  constructor(dataDir: string);

  // CRUD
  create(task: Omit<ButlerTask, "id" | "createdAt" | "updatedAt">): ButlerTask;
  get(id: string): ButlerTask | undefined;
  update(id: string, patch: Partial<ButlerTask>): ButlerTask;
  delete(id: string): boolean;

  // Query
  list(filter?: { status?: ButlerTaskStatus; targetType?: string; targetId?: string }): ButlerTask[];
  getByGlobalTodoId(globalTodoId: string): ButlerTask | undefined;
  getByTarget(targetId: string): ButlerTask[];

  // 状态迁移（含校验）
  transition(id: string, to: ButlerTaskStatus): ButlerTask;

  // 内部
  private load(): void;
  private save(): void;
  private validateTransition(from: ButlerTaskStatus, to: ButlerTaskStatus): boolean;
}
```

### 5.4 状态机

```
routing → dispatched → running → waiting_user → running
                                     ↓              ↓
                                  completed ← waiting_user
                                     ↑
                                   failed ← running
                                     ↑
                                 cancelled (from any state)
```

---

## 6. GroupButlerBindingStore

### 6.1 位置

`packages/core/src/butler/butler-binding-store.ts`

### 6.2 设计

- JSON 文件持久化，文件路径：`{dataRoot}/butler-bindings.json`
- 群组创建/删除时自动维护绑定

### 6.3 接口

```ts
export class GroupButlerBindingStore {
  constructor(dataDir: string);

  // CRUD
  create(groupId: string, overrides?: Partial<GroupButlerBinding>): GroupButlerBinding;
  get(groupId: string): GroupButlerBinding | undefined;
  update(groupId: string, patch: Partial<GroupButlerBinding>): GroupButlerBinding;
  delete(groupId: string): boolean;

  // Query
  list(): GroupButlerBinding[];
  listEnabled(): GroupButlerBinding[];

  // 内部
  private load(): void;
  private save(): void;
}
```

### 6.4 自动创建时机

`GroupManager` 中创建 Group 时调用 `bindingStore.create(groupId)`，销毁 Group 时调用 `bindingStore.delete(groupId)`。

---

## 7. 前端 coreAgents.ts

### 7.1 位置

`gui-v2/src/lib/coreAgents.ts`

### 7.2 实现

```ts
export const CORE_AGENT_IDS = new Set(["butler", "host"]);

export function isCoreAgent(id: string): boolean {
  return CORE_AGENT_IDS.has(id);
}

export function getVisibleUserAgents<T extends { id: string }>(agents: T[]): T[] {
  return agents.filter((agent) => !isCoreAgent(agent.id));
}
```

### 7.3 应用位置

| 文件 | 修改 |
|------|------|
| `layout/Sidebar.tsx` | `agents` → `getVisibleUserAgents(agents)` 用于列表展示和自动选择 |
| `agent/AgentDetailPanel.tsx` | 入口处检测 `isCoreAgent(id)`，是则返回 null |
| `group/GroupMembersTab.tsx` | 添加成员选择器使用 `getVisibleUserAgents` |
| `group/CreateGroupDialog.tsx` | 初始成员候选使用 `getVisibleUserAgents` |
| `hooks/useWebSocket.ts` | 收到 `state` 后，如果需要在 store 层过滤（或保留原始数据，仅 UI 过滤） |

### 7.4 边界说明

- store 中保留 butler/host 数据（供管家配置、群组系统逻辑使用）
- 仅 UI 层面过滤，不删除 store 数据
- 管家入口（activeView="butler"）仍正常使用 butler Agent

---

## 8. 前端 butlerTasks Store

### 8.1 位置

`gui-v2/src/stores/butlerTasks.ts`

### 8.2 实现（第一阶段，mock 数据）

```ts
interface ButlerTaskSummary {
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

interface ButlerTasksState {
  tasks: ButlerTaskSummary[];
  loading: boolean;
  summary: {
    running: number;
    waitingUser: number;
    completed: number;
  };
  // Actions
  setTasks: (tasks: ButlerTaskSummary[]) => void;
  setSummary: (summary: ButlerTasksState["summary"]) => void;
  getByStatus: (status: ButlerTaskSummary["status"]) => ButlerTaskSummary[];
}
```

- 第一阶段不请求后端 API，初始化为空状态
- 后续 Round 接入 `butler-get-work-status` WS 命令后替换真实数据

---

## 9. 集成点

### 9.1 Runtime 初始化

`runtime.ts` 启动时：
1. 创建 `GlobalTodoStore` 实例
2. 创建 `ButlerTaskStore` 实例
3. 创建 `GroupButlerBindingStore` 实例
4. 存入 `__cobeing` 命名空间或 runtime 字段（供后续工具访问）

### 9.2 GroupManager 集成

`GroupManager.create()` 中调用 `bindingStore.create(groupId)`。
`GroupManager.delete()` 中调用 `bindingStore.delete(groupId)`。

### 9.3 导出

`packages/shared/src/index.ts` 新增：
```ts
export * from "./butler-bridge.js";
```

`packages/core/src/index.ts` 新增：
```ts
export { GlobalTodoStore } from "./todo/global-store.js";
export { ButlerTaskStore } from "./butler/butler-task-store.js";
export { GroupButlerBindingStore } from "./butler/butler-binding-store.js";
```

---

## 10. 测试要求

### 10.1 后端 Store 测试

每个 Store 至少覆盖：
- 创建/读取/更新/删除基础 CRUD
- 列表和过滤查询
- 状态迁移校验（ButlerTaskStore）
- 持久化往返（写入→重新 load→读取一致）
- 空状态和边界情况

### 10.2 共享类型测试

`butler-bridge.test.ts`：
- 验证常量值正确
- 验证默认策略包含所有事件类型
- 验证 CORE_AGENT_IDS 包含 butler 和 host

### 10.3 前端测试

- `coreAgents.ts`：纯函数，验证过滤逻辑

---

## 11. 构建与验证

1. `pnpm build` — 7 个 workspace 包编译零错误
2. `pnpm test` — 所有现有 427 测试 + 新增测试通过
3. `gui-v2 npx tsc --noEmit` — 前端零类型错误
4. 手动检查：Agent 页面不显示 butler/host

---

## 12. 不在本 Round 范围

- ❌ GroupButlerBridge（事件桥接逻辑）— Round 3
- ❌ 新的 butler-* / host-* 工具 — Round 3
- ❌ Market 资源检索/安装 — 后续
- ❌ ButlerSidebar / TaskReceiptCard / ChatInputActions — Round 2
- ❌ 前端质感优化 — Round 2
- ❌ WS 端点扩展 — Round 3

---

## 13. 验收标准

1. `pnpm build` 零错误
2. `pnpm test` 全部通过（含新增 Store 测试）
3. `gui-v2 npx tsc --noEmit` 零错误
4. Agent 侧栏不显示 butler 和 host
5. Agent 自动选择不会选中 butler 或 host
6. 群组成员添加选择器不提供 butler 或 host
7. 创建群组初始成员不包含 butler 或 host
8. 管家入口仍可正常聊天（`activeView="butler"` → `ChatView key="butler"`）
9. 全局 Todo / ButlerTask / Binding Store 的 CRUD 测试通过
10. Store 持久化往返测试通过
