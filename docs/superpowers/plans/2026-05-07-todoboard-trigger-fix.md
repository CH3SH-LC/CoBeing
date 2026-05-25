# TODOboard 触发链路修复 实现计划

> 基于 `docs/superpowers/specs/2026-05-07-todoboard-trigger-fix-design.md`

---

## 任务分解

### Task 1: Agent TODO 触发添加事件广播

**文件**: `packages/core/src/runtime.ts`

在 `todoScanner` 的 `onTrigger` 回调中，在 `agent.run()` 前后添加广播：

- `wsServer.broadcast({ type: "agent_started", payload: { agentId, agentName, source: "TODOboard" } })`
- 执行 `agent.run(message)`，获取 response
- `wsServer.broadcast({ type: "agent_completed", payload: { agentId, agentName, source: "TODOboard" } })`
- `wsServer.logMessage("system", \`[TODOboard] ${agent.name} 执行 TODO: ${todo.title}\`)`

需要注入 `CoreWSServer` 引用到 `onTrigger` 闭包（`this.wsServer` 已可用）。

### Task 2: 群组 TODO 触发改用 WakeSystem

**文件**: `packages/core/src/group/manager.ts`

将 `create()` 和 `restoreGroups()` 中的 `GroupTodoScanner` `onTrigger` 回调：

**前**:
```typescript
onTrigger: async (groupId, todo, message) => {
    const g = this.groups.get(groupId);
    if (g) {
        const targetAgent = this.registry.get(todo.targetAgentId || "");
        if (targetAgent) {
            await targetAgent.run(message);
        }
    }
},
```

**后**:
```typescript
onTrigger: async (groupId, todo, message) => {
    const g = this.groups.get(groupId);
    if (!g) return;
    const targetId = todo.targetAgentId;
    if (targetId) {
        // 通过 postMessage 触发 WakeSystem 自然唤醒
        g.postMessage("TODOboard", `@${targetId} ${message}`);
    } else {
        // 未指定目标时 @all
        g.postMessage("TODOboard", `@all ${message}`);
    }
},
```

### Task 3: ButlerAgent todo-complete 传参修复

**文件**: `packages/core/src/agent/butler.ts`

修改 `makeTodoCompleteTool` 调用为 3 参数，同时传入 `groupStoreGetter` 和 `groupScannerGetter`：

```typescript
this.toolRegistry.register(makeTodoCompleteTool(
    dataRoot,
    (gid) => groupManager.getGroupTodoStore?.(gid),
    (gid) => groupManager.getScanner?.(gid),
));
```

### Task 4: 验证构建

- `pnpm --filter @cobeing/core run build`
- `pnpm test`

---

## 文件修改清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `packages/core/src/runtime.ts` | 修改 | Agent TODO 触发添加事件广播 |
| `packages/core/src/group/manager.ts` | 修改 | 群组 TODO 触发改用 WakeSystem |
| `packages/core/src/agent/butler.ts` | 修改 | todo-complete 传 3 参 |
| `PROGRESS.md` | 修改 | 追加修复记录 |
