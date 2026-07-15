# TODOboard 全局与群组协作 — 实现设计规格

> 日期：2026-06-09 | 状态：设计已确认，待实施
>
> 依据：[TODOboard 全局与群组协作设计文档](../GOALS/todoboard-global-group-design.md)（2026-06-08）

## 设计决策

| 决策项 | 选择 |
|--------|------|
| 实现策略 | 逐阶段推进（5 Phase），每 Phase 独立可测 |
| Global TODO 数据模型 | 独立 `GlobalTodoItem` 类型 + `GlobalTodoStore` 类，不复用现有 `TodoItem` |
| Butler 工具 | 5 个新工具注册到 Butler |
| 前端暴露 | Butler 左侧栏 Global TODO 摘要；独立 Agent 对话上方显示 Agent TODO；群组中 Agent 不显示 TODO |

## Phase 1: Global TODO 数据模型

### 新增类型

```ts
// packages/core/src/todo/types.ts — 追加

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

// 扩展现有枚举
export type TodoScope = "agent" | "group" | "global";
```

### 新增 GlobalTodoStore

```ts
// packages/core/src/todo/global-store.ts — 新建

export class GlobalTodoStore {
  constructor(filePath: string); // data/coreagents/butler/global-todos.json

  list(statusFilter?: GlobalTodoItem["status"]): GlobalTodoItem[];
  get(id: string): GlobalTodoItem | undefined;
  add(input: Omit<GlobalTodoItem, "id" | "createdAt" | "updatedAt">): GlobalTodoItem;
  update(id: string, patch: Partial<GlobalTodoItem>): GlobalTodoItem | undefined;
  remove(id: string): boolean;

  getByAssignee(type: string, id: string): GlobalTodoItem[];
  getByExecutionRef(scope: string, id: string): GlobalTodoItem[];
  getWaitingUser(): GlobalTodoItem[];
  getStalled(hoursThreshold: number): GlobalTodoItem[];

  setStatus(id: string, status: GlobalTodoItem["status"]): boolean;
  setBlocker(id: string, blocker: GlobalTodoItem["internalBlocker"]): boolean;
  clearBlocker(id: string): boolean;
  addExecutionRef(id: string, ref: GlobalTodoItem["executionRefs"][0]): boolean;
}
```

存储方式：JSON 文件读写（与现有 `TodoStore` 模式一致），独立文件 `data/coreagents/butler/global-todos.json`。

### 修改文件

| 文件 | 变更 |
|------|------|
| `packages/core/src/todo/types.ts` | 新增 `GlobalTodoItem`，`TodoScope` 加 `"global"` |
| `packages/core/src/todo/global-store.ts` | **创建** — GlobalTodoStore 类 |
| `packages/core/src/todo/global-store.test.ts` | **创建** — 单元测试 |
| `packages/core/src/runtime.ts` | 初始化 GlobalTodoStore 实例，暴露给 Butler |
| `packages/core/src/index.ts` | 导出新类型和 GlobalTodoStore |

### 不碰的文件

`TodoItem`, `TodoStore`, `AgentTodoScanner`, `GroupTodoScanner`, 所有现有工具, `TodoPanel.tsx`, 所有现有 WS 端点。

---

## Phase 2: Butler 编排工具

### 5 个新工具

| 工具 | 触发场景 | 核心参数 |
|------|---------|---------|
| `global-todo-add` | 用户提出长期/多步骤/跨群组目标 | goal, assigneeType, assigneeId, automationPolicy, continuationPolicy |
| `global-todo-list` | 查看跟进中任务、定期检查、用户问进度 | status, assigneeType, assigneeId, waitingUser filter |
| `global-todo-update` | 收到回传、发现停滞、用户确认后 | todoId, status, progressSummary, nextAction, blocker, lastEvent |
| `global-todo-link-execution` | 派发后/完成后建立引用链 | todoId, executionRef, action (add/remove) |
| `global-todo-continue` | 任务完成/阶段结束/用户确认后 | todoId, decision, nextGoal, reason |

### 修改文件

| 文件 | 变更 |
|------|------|
| `packages/core/src/todo/global-tools.ts` | **创建** — 5 个工具工厂函数 |
| `packages/core/src/todo/global-tools.test.ts` | **创建** — 工具单元测试 |
| `packages/core/src/agent/butler.ts` | 注册 5 个 Global TODO 工具（在现有 TODO 工具注册后） |
| `packages/core/src/runtime.ts` | 将 GlobalTodoStore 实例传给工具工厂 |
| `packages/core/src/index.ts` | 导出工具工厂函数 |

### 集成注意

Butler 在工具注册后已有 `rebuildLoop()` 逻辑（`butler.ts` line 940-962），新工具在 Butler 下次对话时自动生效。

---

## Phase 3: 完成事件回传 + 状态同步

### A. GroupTodoScanner.complete() 增强

在现有 `complete()` 末尾（Memory Agent 之前）追加 GlobalTodoStore 通知：

```
Group TODO completed → 查找 executionRefs 中引用了此 Group 的 Global TODO
                    → 更新 lastEvent + progressSummary
```

### B. WS 端点

- 新增 `get_global_todos` — 前端拉取 Global TODO 列表
- 新增 `global_todo_updated` — Global TODO 变更时广播事件
- 修复 `get_group_health` — `(g2 as any).groupTodoStore` → `groupManager.getGroupTodoStore()`

### 修改文件

| 文件 | 变更 |
|------|------|
| `packages/core/src/todo/group-scanner.ts` | complete() 末尾追加 GlobalTodoStore 通知 |
| `packages/core/src/api/ws-server.ts` | 新增 get_global_todos + global_todo_updated 广播；修复 get_group_health |
| `packages/core/src/runtime.ts` | globalTodoStore 暴露到 globalThis + 传给 WsServer |
| `packages/core/src/todo/scanner.test.ts` | 新增 Global TODO 回传测试 |

---

## Phase 4: 自动续作 / 生成后续任务

### 核心函数

```ts
// packages/core/src/todo/continuation-judgment.ts — 新建

export async function runContinuationJudgment(params: {
  completedTodo: TodoItem | GlobalTodoItem;
  continuationPolicy: GlobalTodoItem["continuationPolicy"];
  agentContext: { agentId: string; provider: LLMProvider; model: string };
  workspaceDir: string;
  globalTodoStore?: GlobalTodoStore;
  groupTodoStore?: TodoStore;
  isGroupContext: boolean;
}): Promise<ContinuationResult>

interface ContinuationResult {
  decision: "complete" | "wait_user" | "auto_generate" | "request_cross_layer";
  reason: string;
  nextTodo?: { goal: string; description: string; scope: "agent" | "group" | "global"; assigneeType?: string; assigneeId?: string };
  crossLayerRequest?: { target: "butler" | "host"; request: string };
}
```

### 续作判断流程

```
TODO 完成 → 读取 continuationPolicy
         → 任务承担 Agent 收集交付物和上下文
         → 判断：
             不需要继续 → 收束归档
             需要用户确认 → waiting_user
             可自动继续 → 创建后续 TODO（受 maxDepth/stopWhen 约束）
             需要跨层 → 向 Butler/群主提出请求
```

### 边界约束

- **可自动做**：低风险明确后续、强依赖下游、周期性提醒、失败补救
- **必须上浮**：用户主观选择、授权付款、隐私操作、范围扩大、资源安装
- **不扩散**：`maxDepth` 限制深度，`stopWhen` 条件停止，reason 字段可解释

### 集成点

- `GroupTodoScanner.complete()` 末尾（Phase 3 GlobalTodoStore 通知之后）
- `todo-complete` 工具执行完成后，提示 Agent 运行续作判断
- `TodoItem.onComplete` 扩展 `continuationPolicy` 字段

### 修改文件

| 文件 | 变更 |
|------|------|
| `packages/core/src/todo/continuation-judgment.ts` | **创建** — 续作判断核心 |
| `packages/core/src/todo/continuation-judgment.test.ts` | **创建** — 单元测试 |
| `packages/core/src/todo/group-scanner.ts` | complete() 末尾加续作判断 |
| `packages/core/src/todo/tools.ts` | todo-complete/todo-add 工具描述更新 |
| `packages/core/src/todo/types.ts` | TodoItem.onComplete 扩展 continuationPolicy |

---

## Phase 5: 前端 UX

### Butler 视图：GlobalTodoPanel（左侧栏）

- **位置**：`Sidebar.tsx` 在 `activeView === "butler"` 时渲染（替代当前返回 null）
- **组件**：`GlobalTodoPanel`（新建）
- **内容**：
  - 顶部统计条：running N / waiting_user N / completed N
  - 按状态分组列表（色标：running=蓝 / waiting_user=黄 / completed=灰）
  - 列表项：goal + assignee 名称 + lastEvent 摘要
  - 点击展开：progressSummary + nextAction + executionRefs 简要
- **不暴露**：复杂看板、甘特图、大表格

### Agent 视图：条件 TODO 面板

| 场景 | TODO 面板 | 位置 |
|------|----------|------|
| 管家 (Butler) | Global TODO 摘要 | 左侧栏 |
| 独立 Agent | Agent TODO（紧凑版） | 对话区上方 |
| 群组内 Agent | 不显示 | — |

### 修改文件

| 文件 | 变更 |
|------|------|
| `gui-v2/src/components/todo/GlobalTodoPanel.tsx` | **创建** — Butler 专属侧栏面板 |
| `gui-v2/src/components/layout/Sidebar.tsx` | butler view 渲染 GlobalTodoPanel |
| `gui-v2/src/components/chat/ChatView.tsx` | 独立 Agent 对话上方嵌入 TodoPanelInline |
| `gui-v2/src/hooks/useWebSocket.ts` | 处理 global_todos / global_todo_updated |
| `gui-v2/src/stores/todo.ts` | 新增 globalTodos 状态 |
| `gui-v2/src/lib/types.ts` | 新增 GlobalTodoInfo 前端类型 |
| `packages/core/src/api/ws-server.ts` | global_todo_updated 广播完善 |

---

## 验证标准

每个 Phase 完成的验证标准：

### Phase 1
- `GlobalTodoStore` CRUD 单元测试通过
- `tsc` 零错误
- `pnpm build` 零错误
- 现有 427 测试不回归

### Phase 2
- 5 个工具单元测试通过（创建/列表/更新/链接/续作）
- Butler 工具列表包含新工具（日志验证）
- `pnpm test` 全部通过

### Phase 3
- Group TODO 完成 → GlobalTodoStore 收到 lastEvent 更新（测试）
- WS `get_global_todos` 返回正确数据
- `get_group_health` 使用公开 API
- `pnpm test` 全部通过

### Phase 4
- `runContinuationJudgment` 4 种决策测试通过
- 边界约束测试（maxDepth/stopWhen/上浮）
- 集成测试：Group TODO 完成触发续作判断
- `pnpm test` 全部通过

### Phase 5
- `tsc -p gui-v2/tsconfig.json` 零错误
- `vite build` 通过
- 手动验证：Butler 视图左侧栏显示 Global TODO
- 手动验证：独立 Agent 对话上方显示 TODO，群组中不显示

---

## 与现有代码的关系

### 不改动的模块

- `TodoItem` 接口 — 状态和字段不变
- `TodoStore` — 不动
- `AgentTodoScanner` — 不动（只扫描 Agent TODO）
- `GroupTodoScanner` — 增强但不破坏现有逻辑
- 现有 7 个 TODO 工具 — 不动
- 现有 WS 端点（除 get_group_health 修复）— 不动
- TodoPanel / TodoKanban / TodoList — 不动

### 仅扩展的模块

- `TodoScope` — 加 `"global"`
- `TodoItem.onComplete` — 加 `continuationPolicy`
- `GroupTodoScanner.complete()` — 末尾加回传和续作（现有逻辑不删改）

### 全新模块

- `GlobalTodoItem` / `GlobalTodoStore` / `global-tools.ts` / `continuation-judgment.ts`
- `GlobalTodoPanel` / `todoStore.globalTodos`

---

## 已知风险与缓解

| # | 风险 | 缓解 |
|---|------|------|
| 1 | `get_group_health` 使用 `(g2 as any).groupTodoStore` | Phase 3 修复 |
| 2 | GUI scope 只有 agent/group | 新增 global scope，前端 GlobalTodoPanel 独立组件 |
| 3 | 状态命名不统一（Agent/Group vs Global） | GlobalTodoItem 独立状态枚举，不混用 |
| 4 | 动态工具注册后需 rebuildLoop | butler.ts 已有 rebuild 逻辑，新工具自动生效 |
| 5 | 自动续作可能失控 | maxDepth + stopWhen + reason 日志 + 高风险上浮 |
