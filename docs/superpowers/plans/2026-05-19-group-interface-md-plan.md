# 群组模块化接口系统 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 群组新增 INTERFACE.md，Agent 各自维护接口段落，自动注入到群组上下文中。

**Architecture:** 在 GroupWorkspace 中新增 readInterface/writeInterface/appendInterfaceSection 三个方法，prompt-builder 将 INTERFACE.md 注入 GROUP_CONTEXT 段，addMember 自动追加章节，initialize 创建初始文件。

**Tech Stack:** TypeScript (CoBeing core)，Markdown 文件

---

### Task 1: GroupWorkspace 新增 INTERFACE.md 读写方法

**Files:**
- Modify: `packages/core/src/group/workspace.ts`

- [ ] **Step 1: 在 GroupWorkspacePaths 接口中添加 interface 路径**

在 `workspace.ts` 的 `GroupWorkspacePaths` 接口中（约 line 17-26），添加：

```typescript
interface GroupWorkspacePaths {
  // ... 现有字段
  interface: string;  // ← 新增
}
```

- [ ] **Step 2: 在构造函数中初始化 interface 路径**

在构造函数中（约 line 38-47），添加：

```typescript
this.paths = {
  // ... 现有赋值
  interface: join(workspaceRoot, "INTERFACE.md"),  // ← 新增
};
```

- [ ] **Step 3: 新增 writeInterface 方法**

参照 `writeTask` 模式（line 129-153），新增：

```typescript
writeInterface(content: string = ''): void {
  const defaultContent = content
    ? content
    : '# 群组接口\n\n' + this.memberNames.map(n => `## ${n}\n`).join('\n');
  writeFileSync(this.paths.interface, defaultContent, 'utf-8');
}
```

- [ ] **Step 4: 新增 readInterface 方法**

参照 `readTask` 模式（line 318-321），新增：

```typescript
readInterface(): string | null {
  if (!existsSync(this.paths.interface)) return null;
  return readFileSync(this.paths.interface, 'utf-8');
}
```

- [ ] **Step 5: 新增 appendInterfaceSection 方法**

参照 `appendExperience` 模式（line 292-305），新增：

```typescript
appendInterfaceSection(agentName: string): void {
  const current = this.readInterface() || '# 群组接口\n';
  // 幂等：该 agent 已有章节则跳过
  if (current.includes(`## ${agentName}`)) return;
  const entry = `\n## ${agentName}\n`;
  appendFileSync(this.paths.interface, entry, 'utf-8');
}
```

- [ ] **Step 6: 在 initialize() 中添加 INTERFACE.md 初始创建**

在 `initialize()` 方法中（line 54-68），紧跟 `writeExperience()` 之后添加：

```typescript
if (!existsSync(this.paths.interface)) this.writeInterface('');
```

- [ ] **Step 7: 在 getSummary() 中添加 interface 字段**

在 `getSummary()` 方法中（约 line 400-416），添加：

```typescript
interface: this.readInterface(),
```

- [ ] **Step 8: 构建验证**

Run: `pnpm build`
Expected: 构建通过

- [ ] **Step 9: 提交**

```bash
git add packages/core/src/group/workspace.ts
git commit -m "feat: add INTERFACE.md read/write/append methods to GroupWorkspace"
```

---

### Task 2: addMember 自动追加 INTERFACE.md 章节

**Files:**
- Modify: `packages/core/src/group/group.ts`

- [ ] **Step 1: 在 addMember 末尾追加 INTERFACE.md 章节**

在 `group.ts` 的 `addMember()` 方法中（line 371-398），在 MEMBERS.md 同步之后（line 397 之后），添加：

```typescript
// 在 INTERFACE.md 中追加新成员的章节
const agent = this.registry.get(agentId);
const agentName = agent?.config?.name || agentId;
this.workspace.appendInterfaceSection(agentName);
```

**注意**：需要确认 `agent.config.name` 的正确访问路径。在现有 `addMember` 中已有 `const agent = this.registry.get(agentId)` 调用，如果不存在则需单独获取。

- [ ] **Step 2: 构建验证**

Run: `pnpm build`
Expected: 构建通过

- [ ] **Step 3: 提交**

```bash
git add packages/core/src/group/group.ts
git commit -m "feat: auto-append INTERFACE.md section on addMember"
```

---

### Task 3: prompt-builder 注入 INTERFACE.md 到群组上下文

**Files:**
- Modify: `packages/core/src/conversation/prompt-builder.ts`

- [ ] **Step 1: 在 GroupWorkspaceData 接口添加 interface 字段**

在 `prompt-builder.ts` 的 `GroupWorkspaceData` 接口中（约 line 213-218），添加：

```typescript
export interface GroupWorkspaceData {
  task?: string | null;
  plan?: string | null;
  progress?: string | null;
  experienceSummary?: string | null;
  interface?: string | null;  // ← 新增
}
```

- [ ] **Step 2: 在 buildGroupCollaborationContext 中注入 INTERFACE.md**

在 `buildGroupCollaborationContext()` 方法中（约 line 305-308，紧跟 PROGRESS 块之后），添加：

```typescript
if (workspace.interface) {
  const truncated = workspace.interface.length > 2000
    ? workspace.interface.slice(0, 2000) + "..."
    : workspace.interface;
  parts.push(`## 群组接口\n\n${truncated}`);
}
```

- [ ] **Step 3: 在调用方传入 interface 字段**

找到 `buildGroupCollaborationContext({...})` 的调用位置，确认 `workspace` 参数从 `GroupWorkspace` 构建。在构建 `GroupWorkspaceData` 对象处，添加：

```typescript
interface: group.workspace.readInterface(),
```

**注意**：搜索 prompt-builder.ts 中哪里从 group.workspace 读取 task/plan/progress 来构建 workspaceData，在同一个位置添加 interface。

- [ ] **Step 4: 构建验证**

Run: `pnpm build`
Expected: 构建通过

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/conversation/prompt-builder.ts
git commit -m "feat: inject INTERFACE.md into group collaboration context"
```

---

### Task 4: BOOTSTRAP.md 追加接口更新提示

**Files:**
- Modify: `config/templates/BOOTSTRAP.md`

- [ ] **Step 1: 在行为提醒区添加接口更新条目**

在 `BOOTSTRAP.md` 的 `## 行为提醒` 区块（现有 items 1-5），追加：

```markdown
6. 加入群组后先读 INTERFACE.md 了解与其他成员的协作接口
7. 如有可供其他成员使用的产出（数据、函数、资源、需求），在群组 INTERFACE.md 你的章节下按 `- 位置/标识 — 关键参数 — 具体用途` 格式追加一行。已有条目勿重复
```

- [ ] **Step 2: 验证**

Bash: `cat config/templates/BOOTSTRAP.md` — 确认格式正确

- [ ] **Step 3: 提交**

```bash
git add config/templates/BOOTSTRAP.md
git commit -m "feat: add INTERFACE.md read/write hints to BOOTSTRAP"
```

---

### Task 5: 端到端验证

**Files:**
- Modify: `packages/core/src/group/manager.ts`（仅确认已正确委托 initialize）
- Modify: 各测试文件（若需要）

- [ ] **Step 1: 运行全量构建**

```bash
pnpm build
```
Expected: 6/6 pkgs pass

- [ ] **Step 2: 运行全量测试**

```bash
pnpm test
```
Expected: 282 tests pass

- [ ] **Step 3: 验证 initialize 自动创建 INTERFACE.md**

确认 `workspace.ts` 的 `initialize()` 中已添加 `if (!existsSync(this.paths.interface)) this.writeInterface('');`（Task 1 已做）

- [ ] **Step 4: 提交**

```bash
git add PROGRESS.md STRUCTURE.md
git commit -m "docs: update progress and structure for INTERFACE.md feature"
```

---

### 自审查清单

- [x] **Spec 覆盖度**：
  - INTERFACE.md 创建（initialize）→ Task 1
  - readInterface/writeInterface/appendInterfaceSection → Task 1
  - addMember 追加章节 → Task 2
  - prompt-builder 注入 → Task 3
  - BOOTSTRAP 提示 → Task 4
  - 删除成员不删章节 → 无需实现代码（appendInterfaceSection 已幂等，不删除即保留）

- [x] **无占位符**：全部代码块完整

- [x] **类型一致性**：readInterface/writeInterface/appendInterfaceSection 在 Task 1 定义，后续任务使用方法名一致
