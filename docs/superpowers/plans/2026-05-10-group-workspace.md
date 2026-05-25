# Group Workspace — 群组工作区实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Group 拥有与 Agent 对称的 workspace 机制，Agent 在群组上下文中执行时文件工具自动指向群组工作区。

**Architecture:** Group 新增 `_boundWorkspace`/`effectiveWorkspace`/`workspaceDir`（对称 Agent），通过 `RunOptions.workingDir` 经 `getGroupLoop()` → `createGroupLoop()` → `ConversationLoopConfig.workingDir` → `ToolExecutor.execute()` → 最终到达每个文件工具的 `context.workingDir`。

**Tech Stack:** TypeScript, better-sqlite3, Node.js fs

---

### Task 1: Group 类 — 工作区字段

**Files:**
- Modify: `packages/core/src/group/group.ts`

- [ ] **Step 1: 添加 workspace 字段和访问器**

在 Group 类中添加以下字段和方法。首先在文件顶部 import 中加入 `fs`：

```typescript
import fs from "node:fs";  // 新增 import
```

在 `private _dataRoot: string;` 之后、`private agentMemories` 之前插入：

```typescript
/** 绑定的外部工作目录（null 则使用默认群组 workspace） */
private _boundWorkspace: string | null = null;

/** 默认工作区目录 */
get workspaceDir(): string {
  return path.join(this._dataRoot, "groups", this.config.id, "workspace");
}

/** 有效工作目录：绑定路径优先，否则默认 workspace */
get effectiveWorkspace(): string {
  return this._boundWorkspace ?? this.workspaceDir;
}

/** 获取当前绑定路径（null 表示未绑定） */
get boundWorkspace(): string | null {
  return this._boundWorkspace;
}

/** 绑定到外部工作目录 */
setBoundWorkspace(dir: string | null): void {
  if (dir) {
    fs.mkdirSync(dir, { recursive: true });
  }
  this._boundWorkspace = dir;
  log.info("[%s] Bound workspace: %s", this.id, dir ?? "(cleared)");
}
```

- [ ] **Step 2: 在 constructor 中确保 workspace/ 目录存在**

在 Group 构造函数中（`this.workspace = new GroupWorkspace(...)` 之后）添加：

```typescript
// 确保群组 workspace/ 目录存在
try {
  fs.mkdirSync(this.workspaceDir, { recursive: true });
} catch { /* ignore */ }
```

- [ ] **Step 3: 构建验证**

Run: `pnpm --filter @cobeing/core run build`

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/group/group.ts
git commit -m "feat: add workspaceDir/effectiveWorkspace/boundWorkspace to Group"
```

---

### Task 2: Agent — RunOptions 扩展 + getGroupLoop 改造

**Files:**
- Modify: `packages/core/src/agent/agent.ts`

- [ ] **Step 1: RunOptions 新增 workingDir**

在 `RunOptions` 接口中添加字段（`groupContext` 之后）：

```typescript
export interface RunOptions {
  groupId?: string;
  groupContext?: string;
  /** 覆盖工作目录（群组上下文时传入 group.effectiveWorkspace） */
  workingDir?: string;
  events?: ConversationLoopEvents;
}
```

- [ ] **Step 2: createGroupLoop 接收 workingDir 参数**

修改 `createGroupLoop` 方法签名，添加 `workingDir` 参数，替换硬编码的 `this.effectiveWorkspace`：

```typescript
private createGroupLoop(
  toolExecutor: ToolExecutor,
  groupId: string,
  snapshot: { context?: string },
  workingDir?: string,
): ConversationLoop {
  return new ConversationLoop({
    agentConfig: {
      name: this.name,
      role: this.config.role,
      systemPrompt: this.config.systemPrompt,
      model: this.config.model,
    },
    provider: this.provider,
    tools: this.toolRegistry.listDefinitions(),
    toolExecutor,
    agentId: this.id,
    sessionId: `group:${groupId}`,
    workingDir: workingDir ?? this.effectiveWorkspace,
    maxToolRounds: this.config.maxToolRounds,
    fallbackProviders: this.buildFallbackList(),
    promptBuilder: () => {
      const { volatile } = buildCacheablePrompt(
        this.files,
        { name: this.name, role: this.config.role, systemPrompt: this.config.systemPrompt },
        undefined,
        snapshot.context,
      );
      const parts = [this._sharedPrefix, this._agentPrefix];
      if (volatile) parts.push(volatile);
      return parts.join("\n\n");
    },
  });
}
```

- [ ] **Step 3: getGroupLoop 接收 workingDir 参数**

修改 `getGroupLoop` 方法签名和内部实现：

```typescript
private getGroupLoop(groupId: string, groupContext?: string, workingDir?: string): ConversationLoop {
  const key = `group:${groupId}`;
  const snapshot = this._groupContextSnapshots.get(key) || { context: undefined };
  snapshot.context = groupContext;
  this._groupContextSnapshots.set(key, snapshot);

  let loop = this.sessionLoops.get(key);
  if (!loop) {
    const effectiveWd = workingDir ?? this.effectiveWorkspace;
    const permission = new PermissionEnforcer(
      this.config.permissions ?? { mode: "ask" },
      this.config.toolsConfig,
      effectiveWd,                                          // ← 使用群组 workspace
    );
    const toolExecutor = new ToolExecutor(
      this.toolRegistry,
      permission,
      undefined,
      this.config.sandbox,
      this._sandbox ?? undefined,
      this.observabilityDB,
      this.name,
    );
    loop = this.createGroupLoop(toolExecutor, groupId, snapshot, effectiveWd);
    this.sessionLoops.set(key, loop);
  }
  loop.clearHistory();
  return loop;
}
```

- [ ] **Step 4: run() 传递 workingDir**

修改 `agent.run()` 中调用 `getGroupLoop()` 的行，传入 `options.workingDir`：

```typescript
const loop = isGroup
  ? this.getGroupLoop(options.groupId!, options.groupContext, options.workingDir)
  : this.conversationLoop;
```

- [ ] **Step 5: 构建验证**

Run: `pnpm --filter @cobeing/core run build`

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/agent/agent.ts
git commit -m "feat: add workingDir to RunOptions and getGroupLoop chain"
```

---

### Task 3: WakeSystem — 传递群组 workingDir

**Files:**
- Modify: `packages/core/src/group/wake-system.ts`

- [ ] **Step 1: executeWake 传递 workingDir**

找到 `executeWake()` 中调用 `agent.run()` 的两处位置，添加 `workingDir`：

WakeSystem 通过 `private getGroup: (() => Group | undefined) | null` 回调持有 Group 引用。

**位置 1 — 正常执行路径 (约 line 475)：**
```typescript
const response = await agent.run(enrichedContext, {
  groupId: this.ctx.groupId,
  workingDir: this.getGroup?.()?.effectiveWorkspace,   // ← 新增
});
```

**位置 2 — 错误恢复重试路径 (约 line 572)：**
```typescript
const response = await agent.run(retryContext, {
  groupId: this.ctx.groupId,
  workingDir: this.getGroup?.()?.effectiveWorkspace,   // ← 新增
});
```

- [ ] **Step 3: 构建验证**

Run: `pnpm --filter @cobeing/core run build`

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/group/wake-system.ts
git commit -m "feat: pass group effectiveWorkspace to agent.run() in WakeSystem"
```

---

### Task 4: WS send_message — 传递群组 workingDir

**Files:**
- Modify: `packages/core/src/api/ws-server.ts`

- [ ] **Step 1: send_message 群组路径传递 workingDir**

找到 `send_message` 处理器中调用 `agent.run()` 的位置（约 line 337），添加 `workingDir`：

```typescript
agent.run(content, {
  groupId: groupMatch ? groupMatch[1] : undefined,
  groupContext: collabContext,
  workingDir: groupMatch ? this.groupManager?.get(groupMatch[1])?.effectiveWorkspace : undefined,
  events: {
    onToken: (token) => {
      this.sendToClient(ws, { type: "stream_token", payload: { token } });
    },
    // ... 其余 events 保持不变
  },
});
```

- [ ] **Step 2: 构建验证**

Run: `pnpm --filter @cobeing/core run build`

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/api/ws-server.ts
git commit -m "feat: pass group effectiveWorkspace in WS send_message for group contexts"
```

---

### Task 5: 全量构建 + 测试

**Files:**
- Modify: `PROGRESS.md`

- [ ] **Step 1: 构建全部包**

```bash
pnpm build
```
Expected: 6 packages pass.

- [ ] **Step 2: 运行所有测试**

```bash
pnpm test
```
Expected: 281 tests pass.

- [ ] **Step 3: 构建 GUI**

```bash
cd gui-v2 && npm run build
```
Expected: build pass.

- [ ] **Step 4: 更新 PROGRESS.md**

在 `CoBeing/PROGRESS.md` 文件顶部（最新日期条目下方）追加变更记录。

- [ ] **Step 5: Commit**

```bash
git add PROGRESS.md
git commit -m "docs: update PROGRESS.md for group workspace feature"
```

---

### Task 6: 验证 — 手动测试

- [ ] **Step 1: 检查目录创建**

启动应用后验证 `data/groups/<groupId>/workspace/` 目录是否自动创建：
```bash
ls -la data/groups/*/workspace/
```

- [ ] **Step 2: 验证 workingDir 传递**

在 `packages/core/src/tools/executor.ts` 的 `execute()` 方法中临时添加调试日志：
```typescript
console.log(`[DEBUG] Tool: ${tool.function.name}, workingDir: ${workingDir}`);
```
确认群组上下文中 workingDir 指向 `data/groups/<id>/workspace/`。

- [ ] **Step 3: 验证 Agent 个人对话不受影响**

确认非群组对话（直接与 Agent 聊天）的 workingDir 仍为 `data/agents/<id>/workspace/`。

- [ ] **Step 4: 移除调试日志，最终构建**
