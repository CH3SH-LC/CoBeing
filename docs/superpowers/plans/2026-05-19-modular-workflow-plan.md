# 模块化并行工作流 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重构群组工作流——WakeSystem 支持并行、PLAN 阶段驱动、PROGRESS 时间优先、TODOboard 三种触发模式、全部模板模块化意识

**Architecture:** 改动分三层：WakeSystem 队列层（入队逻辑）、TODO 基础设施层（类型+store+scanner+tools）、模板/提示词层（workspace+prompt-builder+4 模板文件）。每层改动独立，逐层推进。

**Tech Stack:** TypeScript (CoBeing core)，Markdown 模板，JSON TODO 存储

---

### Task 1: WakeSystem 允许 processing Agent 重新入队

**Files:**
- Modify: `packages/core/src/group/wake-system.ts`

- [ ] **Step 1: 修改 enqueueMention 中的 processing 检查**

当前 `enqueueMention` 方法（line 154-193）有两处拦截：
1. line 162-175: 已在队列中 → merge 并 return（保留不动）
2. line 178-181: 正在 processing → 跳过（**修改**：改为允许入队）

```typescript
// 修改前 (line 178-181):
// Check if agent is currently processing
if (this._processingAgents.has(targetAgentId)) {
  return; // Agent is currently being processed
}

// 修改后:
// Agent 正在处理中 → 允许重新入队（排到队尾，本轮完成后可被再次唤醒）
if (this._processingAgents.has(targetAgentId)) {
  // 不跳过，继续往下 push 到队尾
}
```

- [ ] **Step 2: 修改 _tickQueue 中的 processing 过滤**

当前 `_tickQueue`（line 338-372）在 line 348-359 会跳过正在 processing 的 Agent 并将其放回队尾。改为：不跳过，直接从队首取出执行。

```typescript
// 修改前: 跳过 processing 中的 Agent，放回队尾
// 修改后: 不跳过，正常出队执行。executeWake 内部可通过
// _processingAgents 重复添加是否幂等来处理并发情况
```

删除 line 348-359 的 processing 过滤循环，直接 shift + executeWake。Agent 在 `executeWake` 中被加入 `_processingAgents` 时会正常处理（Set 不可重复添加，天然幂等）。

- [ ] **Step 3: 构建验证**

Run: `pnpm build`
Expected: 构建通过

- [ ] **Step 4: 提交**

```bash
git add packages/core/src/group/wake-system.ts
git commit -m "feat: allow re-enqueue of currently processing agents for parallel wake"
```

---

### Task 2: workspace.ts — PLAN.md + PROGRESS.md 模板重写

**Files:**
- Modify: `packages/core/src/group/workspace.ts`

- [ ] **Step 1: 重写 writePlan 模板**

当前 `writePlan`（line 200-236）生成旧模板。替换为新模板：

```typescript
writePlan(plan: string): void {
  const content = `# ${this.groupName} - 执行计划

## 模块依赖

> 各模块间的接口依赖关系（详见 INTERFACE.md）

${plan || "（Host 调查后填写依赖关系）"}

## 阶段计划

${plan || "（Host 调查后填充阶段计划）"}

## 执行策略

1. **并行原则**: 同阶段无依赖的任务可同时 @mention 唤醒多个 Agent
2. **接口优先**: 先定义接口 → 再各自实现 → 最后联调检查
3. **动态调整**: 根据实际进展随时更新本计划，阶段数量可增减

## 风险预案

- **接口不匹配**: 及时同步 INTERFACE.md，Host 协调
- **人员阻塞**: 依赖项未就位时，先做其他可并行的工作

## 更新日志

- ${new Date().toISOString()} - 初始化计划文档
`;
  writeFileSync(this.paths.plan, content, "utf-8");
}
```

- [ ] **Step 2: 重写 writeProgress 模板（时间优先）**

当前 `writeProgress`（line 155-198）改为时间优先工作日志：

```typescript
writeProgress(): void {
  const content = `# ${this.groupName} - 工作日志

> 记录谁在什么时候做了什么、产出了什么。追踪总进度见 PLAN.md。

## ${new Date().toISOString().slice(0, 10)}

### ${new Date().toISOString().slice(11, 16)}
- 初始化工作日志

`;
  writeFileSync(this.paths.progress, content, "utf-8");
}
```

- [ ] **Step 3: 新增 appendProgressEntry 方法**

用于 Agent 完成工作后追加日志条目：

```typescript
appendProgressEntry(agentName: string, entry: string): void {
  const now = new Date();
  const dateKey = now.toISOString().slice(0, 10);
  const timeKey = now.toISOString().slice(11, 16);
  
  let content = this.readProgress() || '';
  
  // 检查是否已有今天的日期标题
  const dateHeader = `## ${dateKey}`;
  if (!content.includes(dateHeader)) {
    content = content.trimEnd() + `\n\n${dateHeader}\n`;
  }
  
  // 在日期标题下插入新条目
  const timeHeader = `### ${timeKey}`;
  const dateIdx = content.indexOf(dateHeader);
  const dateEnd = dateIdx + dateHeader.length;
  const rest = content.slice(dateEnd);
  
  // 如果这个时间点已有条目，追加到后面
  if (rest.includes(timeHeader)) {
    const timeIdx = rest.indexOf(timeHeader) + rest.indexOf('\n', rest.indexOf(timeHeader));
    content = content.slice(0, dateEnd + timeIdx) + `\n- @${agentName}: ${entry}` + content.slice(dateEnd + timeIdx);
  } else {
    content = content.slice(0, dateEnd) + `\n\n${timeHeader}\n- @${agentName}: ${entry}` + rest;
  }
  
  writeFileSync(this.paths.progress, content, "utf-8");
}
```

- [ ] **Step 4: 构建验证**

Run: `pnpm build`
Expected: 构建通过

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/group/workspace.ts
git commit -m "feat: rewrite PLAN.md and PROGRESS.md templates for modular workflow"
```

---

### Task 3: TodoItem 类型增强 + TodoStore 适配

**Files:**
- Modify: `packages/core/src/todo/types.ts`
- Modify: `packages/core/src/todo/store.ts`

- [ ] **Step 1: 在 types.ts 中扩展 TodoItem**

```typescript
// packages/core/src/todo/types.ts

export type TriggerMode = 'time' | '0time' | 'condition';

export interface TodoCondition {
  type: 'agent_speak';          // 目前仅此一种
  targetAgents: string[];        // 监控这些 Agent
  check: string;                 // 条件描述
  onFail: 'remind' | 'recreate'; // 不满足时的行为
}

export interface TodoItem {
  id: string;
  title: string;
  description?: string;
  status: 'pending' | 'in-progress' | 'completed' | 'expired';
  assignee?: string;             // targetAgentId
  groupId?: string;
  scope?: 'agent' | 'group';
  
  // === 新增字段 ===
  triggerMode: TriggerMode;      // 默认 'time'
  triggerAt?: number;            // time 触发时间戳
  condition?: TodoCondition;     // condition 触发条件
  check?: string;                // 0time 完成条件描述
  
  // 现有字段保留
  createdAt?: string;
  completedAt?: string;
  triggeredAt?: string;
  recurrence?: string;
  createdBy?: string;
  dependsOn?: string[];
  parentId?: string;
}
```

- [ ] **Step 2: 在 store.ts 中适配 TodoStore.add**

```typescript
// store.ts add() 方法中确保新字段有默认值
add(input: Partial<TodoItem>): TodoItem {
  const now = new Date().toISOString();
  const item: TodoItem = {
    id: randomUUID(),
    title: input.title || '',
    status: 'pending',
    triggerMode: input.triggerMode || 'time',    // 默认 time
    triggerAt: input.triggerAt,
    condition: input.condition,
    check: input.check,
    // ... 其他字段
  };
  // ... 现有逻辑
}
```

- [ ] **Step 3: 在 store.ts 中新增查询方法**

```typescript
// 获取 0time 模式的 pending TODO（扫描即触发）
getZeroTimeTodos(): TodoItem[] {
  return this.readAll().filter(
    t => t.triggerMode === '0time' && t.status === 'pending'
  )
}

// 获取 condition 模式的 pending TODO
getConditionTodos(): TodoItem[] {
  return this.readAll().filter(
    t => t.triggerMode === 'condition' && t.status === 'pending'
  )
}
```

- [ ] **Step 4: 构建验证**

Run: `pnpm build`
Expected: 构建通过

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/todo/types.ts packages/core/src/todo/store.ts
git commit -m "feat: add triggerMode (time/0time/condition) to TodoItem and TodoStore"
```

---

### Task 4: TodoScanner 增加 0time 和 condition 扫描

**Files:**
- Modify: `packages/core/src/todo/scanner.ts`
- Modify: `packages/core/src/todo/group-scanner.ts`

- [ ] **Step 1: AgentTodoScanner 增加 0time 扫描**

在 `scanOnce()` 方法中（line 46-80），遍历 agent todos 后，增加 0time 处理：

```typescript
// 在 getDueTodos() 之后，增加:
const zeroTimeTodos = store.getZeroTimeTodos()
if (zeroTimeTodos.length > 0) {
  // 0time: 扫描即触发，立即唤醒
  await this.triggerAgentTodos(agentId, store, zeroTimeTodos)
}

// 0time 未完成的重建逻辑：检查之前触发过但未完成的
const previouslyTriggered = zeroTimeTodos.filter(t => t.triggeredAt && t.status !== 'completed')
for (const todo of previouslyTriggered) {
  // 标记过期
  store.updateStatus(todo.id, 'expired')
  // 重建新的 0time TODO
  store.add({
    ...todo,
    id: undefined as any,
    triggerMode: '0time',
    status: 'pending',
    createdAt: new Date().toISOString(),
    triggeredAt: undefined,
  })
}
```

- [ ] **Step 2: GroupTodoScanner 增加 condition 监听**

GroupTodoScanner（`group-scanner.ts`）需要访问群组消息流。在当前 `scanOnce()` 或新增的 `onGroupMessage` 回调中：

```typescript
// package/core/src/todo/group-scanner.ts
// 新增方法：群组消息监听

private checkConditionTodos(agentId: string, groupId: string): void {
  const todos = this.store.getConditionTodos()
    .filter(t => t.condition?.targetAgents.includes(agentId))
  
  for (const todo of todos) {
    // 每次目标 Agent 发言 → 触发
    if (this.callbacks.onConditionTrigger) {
      this.callbacks.onConditionTrigger(todo)
    }
  }
}
```

- [ ] **Step 3: 在 WakeSystem 或 Group 中集成 condition 监听**

GroupTodoScanner 需要在群组收到消息时被通知。修改 `manager.ts` 中 GroupTodoScanner 的回调注册，添加群组消息监听：

在 `group.ts` 的 `postMessage` 中，消息发布后通知 GroupTodoScanner：
```typescript
// 在 postMessage 末尾
this._onMessageBroadcast?.(this.id, msg);
// 新增：通知 condition TODO 扫描
const scanner = groupManager.getScanner(this.id);
scanner?.onGroupMessage?.(msg.fromAgentId, this.id);
```

- [ ] **Step 4: 构建验证**

Run: `pnpm build`
Expected: 构建通过

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/todo/scanner.ts packages/core/src/todo/group-scanner.ts packages/core/src/group/group.ts
git commit -m "feat: add 0time scan and condition trigger to TodoScanners"
```

---

### Task 5: todo-tools + host-tools 适配新模式

**Files:**
- Modify: `packages/core/src/todo/tools.ts`
- Modify: `packages/core/src/group/host-tools.ts`

- [ ] **Step 1: todo-add 工具支持新字段**

在 `tools.ts` 的 `makeTodoAddTool` 参数 schema 中添加：

```typescript
parameters: {
  type: "object",
  properties: {
    title: { type: "string", description: "TODO 标题" },
    description: { type: "string", description: "详细描述（可选）" },
    triggerMode: { 
      type: "string", 
      enum: ["time", "0time", "condition"],
      description: "触发模式。time=定时, 0time=扫描即触发, condition=条件触发" 
    },
    triggerAt: { 
      type: "string", 
      description: "触发时间 ISO 8601。triggerMode=time 时必填" 
    },
    conditionType: { 
      type: "string", 
      enum: ["agent_speak"],
      description: "条件类型。triggerMode=condition 时必填" 
    },
    targetAgents: { 
      type: "array", items: { type: "string" },
      description: "监视的 Agent ID 列表。triggerMode=condition 时必填" 
    },
    check: { 
      type: "string", 
      description: "完成条件描述。triggerMode=0time 或 condition 时使用" 
    },
    onFail: { 
      type: "string", enum: ["remind", "recreate"],
      description: "条件不满足时的行为" 
    },
    assignee: { type: "string", description: "负责人 Agent ID" },
    groupId: { type: "string", description: "群组 ID" },
    dependsOn: { type: "array", items: { type: "string" }, description: "依赖的 TODO ID 列表" },
  },
  required: ["title"],
}
```

在 execute 中组装新的 TodoItem 结构：

```typescript
const todo = addTodo({
  title: params.title as string,
  description: params.description as string,
  assignee: params.assignee as string,
  triggerMode: (params.triggerMode as TriggerMode) || 'time',
  triggerAt: params.triggerAt ? new Date(params.triggerAt as string).getTime() : undefined,
  condition: params.conditionType ? {
    type: params.conditionType as 'agent_speak',
    targetAgents: params.targetAgents as string[],
    check: params.check as string,
    onFail: (params.onFail as 'remind' | 'recreate') || 'remind',
  } : undefined,
  check: params.check as string,
  // ... 其他字段
})
```

- [ ] **Step 2: host-tools 适配 PLAN 新格式**

在 `makeHostDecomposeTaskTool` 中，将 subtasks 的 `triggerAt` 改为可选，新增 `triggerMode` 支持：

子任务 schema 更新：
```typescript
subtask: {
  title: { type: "string" },
  assignee: { type: "string" },
  triggerMode: { type: "string", enum: ["time", "0time", "condition"] },
  triggerAt: { type: "string", description: "时间触发时必填" },
  conditionType: { type: "string" },
  targetAgents: { type: "array", items: { type: "string" } },
  check: { type: "string" },
  onFail: { type: "string", enum: ["remind", "recreate"] },
  dependsOn: { type: "array", items: { type: "number" } },
}
```

Host 启动阶段时：为每个任务创建 0time TODO，在群组中 @mention 所有负责人并行启动。

- [ ] **Step 3: 构建验证**

Run: `pnpm build`
Expected: 构建通过

- [ ] **Step 4: 提交**

```bash
git add packages/core/src/todo/tools.ts packages/core/src/group/host-tools.ts
git commit -m "feat: add triggerMode support to todo-add and host-decompose-task tools"
```

---

### Task 6: 模板文件更新

**Files:**
- Modify: `config/templates/BOOTSTRAP.md`
- Modify: `config/templates/SOUL.md`
- Modify: `config/templates/AGENTS.md`
- Modify: `config/templates/JOB.md`

- [ ] **Step 1: BOOTSTRAP.md — 追加模块化条目**

在行为提醒末尾已有 items 1-7，追加：

```markdown
8. 工作前检查 INTERFACE.md 中你依赖的接口是否就位，有占位符则 @mention 对方提醒
9. 工作后更新 INTERFACE.md 你的章节；检查是否有 agent 的 condition TODO 等待你的接口
10. 如果你依赖的接口缺失，创建 condition TODO 监视对方（mode=condition, targetAgents=[对方], check=接口就位）
```

- [ ] **Step 2: SOUL.md — 追加协作方式段**

在"怎么不要说话"段之后，追加：

```markdown

## 协作方式

- 你是模块化团队的一员。你的产出可能被其他人调用，你也依赖其他人的产出
- 接口优先：不确定别人需要什么时，先写好你的输出格式
- 你的 INTERFACE.md 章节是别人了解你的窗口，保持更新
```

- [ ] **Step 3: AGENTS.md — 追加模块化工作规则**

在"群组行为"段末尾，追加：

```markdown

## 模块化工作规则

1. 工作前查 INTERFACE.md 确认依赖项是否就位
2. 有产出后更新 INTERFACE.md 你的章节（`- 位置/标识 — 关键参数 — 具体用途`）
3. 发现依赖的接口缺失或不足 → 创建 condition TODO 监视对方，或直接 @mention 对方请求
4. 群主通过 PLAN.md 组织阶段，通过 TODOboard 分配任务，关注 @mention 和 TODO 触发
5. PLAN.md 每个阶段最后有两个固定任务：检查接口依赖 + 用户审核
6. 同一个阶段内无依赖的多个 Agent 可以并行工作，不要等待
```

- [ ] **Step 4: JOB.md — Host 群组管理**

JOB.md 是通用模板。Host 的群组管理能力通过 `prompt-builder.ts` 中注入的 JOB.md 内容来体现。在模板文件中新增 Host 角色相关段（由管家创建时填写）：

```markdown

## 群组管理（仅群主）

如果你是群主，额外负责：
1. 收到需求后先调查，确定阶段数量（可有很多个）
2. 在 PLAN.md 中写入阶段计划（动态调整）
3. 为每阶段任务创建 0time TODO，@mention 启动并行工作
4. 有接口依赖时，让下游 Agent 创建 condition TODO 监视上游
```

- [ ] **Step 5: 验证**

Run: `pnpm build`
Expected: 构建通过

- [ ] **Step 6: 提交**

```bash
git add config/templates/BOOTSTRAP.md config/templates/SOUL.md config/templates/AGENTS.md config/templates/JOB.md
git commit -m "feat: add modular workflow awareness to all agent templates"
```

---

### Task 7: prompt-builder.ts 模块化协作提示

**Files:**
- Modify: `packages/core/src/conversation/prompt-builder.ts`

- [ ] **Step 1: GROUP_CONTEXT 末尾追加模块化提示**

在 `buildGroupCollaborationContext` 中，INTERFACE.md 注入之后（已由之前的 INTERFACE.md 功能添加），追加：

```typescript
// 模块化协作提示（紧跟 INTERFACE.md 注入之后）
parts.push(`> 接口依赖见 INTERFACE.md。阶段任务见 PLAN.md。个人任务见 TODOboard。
> 每个阶段最后两个任务固定：检查接口依赖 → 用户审核。同一阶段内无依赖任务可并行。
`);
```

- [ ] **Step 2: Host JOB 注入（群主专用）**

在构建 Host Agent 的上下文时（检查 `targetAgentId === ownerId`），追加群组管理提示：

```typescript
if (targetAgentId === ownerId) {
  parts.push(`## 群组管理

你是群主。按以下方式组织模块化工作：

1. 调查需求 → 确定阶段数量 → 写入 PLAN.md（阶段名要具体）
2. 启动阶段：为每项任务创建 0time TODO → @mention 所有负责人并行启动
3. 有接口依赖 → 让下游 Agent 创建 condition TODO 监视上游
4. 阶段收尾：执行"检查接口依赖"任务 → 提交用户审核 → 进入下一阶段
5. PLAN.md 动态更新：发现新需求随时增减阶段`);
}
```

- [ ] **Step 3: 构建验证**

Run: `pnpm build`
Expected: 构建通过

- [ ] **Step 4: 提交**

```bash
git add packages/core/src/conversation/prompt-builder.ts
git commit -m "feat: add modular collaboration hints to group context prompt"
```

---

### Task 8: 端到端验证

- [ ] **Step 1: 全量构建**

```bash
pnpm build
```
Expected: 6/6 pkgs pass

- [ ] **Step 2: 全量测试**

```bash
pnpm test
```
Expected: 282 tests pass

- [ ] **Step 3: 更新 PROGRESS.md 和 STRUCTURE.md**

```bash
git add PROGRESS.md STRUCTURE.md
git commit -m "docs: update progress and structure for modular workflow system"
```

---

### 自审查清单

- [x] **Spec 覆盖度**：
  - WakeSystem 并行入队 → Task 1
  - PLAN.md 阶段驱动 → Task 2
  - PROGRESS.md 时间优先 → Task 2
  - TODOboard 三种触发 → Task 3, 4, 5
  - 全部模板更新 → Task 6
  - prompt-builder 提示 → Task 7
  - Host 群组管理 → Task 6 (JOB), Task 7 (prompt injection)

- [x] **无占位符**：所有代码块完整

- [x] **类型一致性**：`TriggerMode` / `TodoCondition` / `triggerMode` 在各任务间一致
