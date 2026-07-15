# Agent 协作能力强化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从 Prompt 驱动角度强化 Agent 协作能力——通过 system prompt 注入协作上下文和行为指令，让 Agent 感知队友、接力协作、追踪任务、解决冲突、共享知识。

**Architecture:** 在 prompt-builder 中新增群组协作上下文注入（队友画像、TASK/PLAN/PROGRESS、TODO、群组经验），WakeSystem 唤醒 Agent 前设置 `agent.groupContext`，system prompt 末尾追加。AGENTS.md 模板新增协作行为指引。TODO 完成时自动 @mention 下一个 Agent。

**Tech Stack:** TypeScript, Node.js, better-sqlite3

**Spec:** `docs/superpowers/specs/2026-04-25-agent-collaboration-design.md`

---

## File Structure

| 文件 | 改动 | 职责 |
|------|------|------|
| `packages/core/src/agent/agent.ts` | 修改 | 新增 `_groupContext` 属性、`setGroupContext()`/`clearGroupContext()` 方法 |
| `packages/core/src/conversation/prompt-builder.ts` | 修改 | `buildSystemPromptFromFiles()` 增加 `groupContext` 参数，新增 `buildGroupCollaborationContext()` |
| `packages/core/src/group/wake-system.ts` | 修改 | `executeWake()` 中设置/清理 agent.groupContext |
| `packages/core/src/group/group.ts` | 修改 | 新增 `getMemberProfiles()` 方法 |
| `packages/core/src/group/workspace.ts` | 修改 | 新增 `readExperience()`/`writeExperience()`/`readExperienceSummary()`，`initialize()` 创建 EXPERIENCE.md |
| `packages/core/src/group/manager.ts` | 修改 | GroupTodoScanner 增加 `onCompleteAction` 回调 |
| `packages/core/src/todo/tools.ts` | 修改 | `makeTodoCompleteTool` 通过 groupScanner.complete() 执行 onComplete |
| `packages/core/src/group/screener.ts` | 修改 | 冲突检测时附带结构化摘要 |
| `config/templates/AGENTS.md` | 修改 | 新增「协作接力」和「认领任务」章节 |

---

### Task 1: Agent 增加 groupContext 属性

**Files:**
- Modify: `packages/core/src/agent/agent.ts:50-70`

- [ ] **Step 1: 添加 groupContext 属性和方法**

在 `Agent` 类中 `_status` 之后添加：

```typescript
  private _groupContext?: string;

  /** 设置群组协作上下文（WakeSystem 唤醒前调用） */
  setGroupContext(ctx: string): void {
    this._groupContext = ctx;
  }

  /** 清理群组协作上下文（Agent 回复后调用） */
  clearGroupContext(): void {
    this._groupContext = undefined;
  }

  /** 获取当前群组协作上下文（promptBuilder 闭包使用） */
  get groupContext(): string | undefined {
    return this._groupContext;
  }
```

- [ ] **Step 2: 修改 promptBuilder 闭包使用 groupContext**

找到 `createLoop()` 方法中的 promptBuilder 闭包（约 line 201-207），修改为：

```typescript
      promptBuilder: systemPrompt
        ? undefined
        : () => {
            const base = buildSystemPromptFromFiles(
              this.files,
              { name: this.name, role: this.config.role, systemPrompt: this.config.systemPrompt },
              undefined,
            );
            return this._groupContext
              ? `${base}\n\n${this._groupContext}`
              : base;
          },
```

- [ ] **Step 3: 运行现有测试确认无回归**

Run: `cd D:/agent-codes/cobeing && npx vitest run packages/core/src/agent/ --reporter=verbose 2>&1 | head -30`
Expected: 现有测试通过

- [ ] **Step 4: Commit**

```bash
cd D:/agent-codes/cobeing
git add packages/core/src/agent/agent.ts
git commit -m "feat(agent): add groupContext property for collaboration context injection"
```

---

### Task 2: prompt-builder 新增 buildGroupCollaborationContext

**Files:**
- Modify: `packages/core/src/conversation/prompt-builder.ts`

- [ ] **Step 1: 添加 MemberProfile 接口和 buildGroupCollaborationContext 函数**

在 `prompt-builder.ts` 末尾添加：

```typescript
/** 成员画像摘要 */
export interface MemberProfile {
  id: string;
  name: string;
  role: string; // JOB.md 专注领域摘要
}

/** 群组 workspace 数据 */
export interface GroupWorkspaceData {
  task?: string | null;
  plan?: string | null;
  progress?: string | null;
  experienceSummary?: string | null;
}

/** 群组 TODO 摘要 */
export interface GroupTodoSummary {
  id: string;
  title: string;
  status: string;
  assignee?: string;
}

/**
 * 构建群组协作上下文，注入到 system prompt 末尾
 */
export function buildGroupCollaborationContext(
  currentAgentId: string,
  members: MemberProfile[],
  workspace: GroupWorkspaceData,
  todos: GroupTodoSummary[],
): string {
  const parts: string[] = [];

  // 队友信息（排除自己）
  const teammates = members.filter(m => m.id !== currentAgentId);
  if (teammates.length > 0) {
    const lines = teammates.map(m => `- ${m.name} (${m.id}) — ${m.role}`);
    parts.push(`## 你的队友\n\n${lines.join("\n")}`);
  }

  // 当前任务
  if (workspace.task) {
    const truncated = workspace.task.length > 500 ? workspace.task.slice(0, 500) + "..." : workspace.task;
    parts.push(`## 当前任务\n\n${truncated}`);
  }

  // 当前计划
  if (workspace.plan) {
    const truncated = workspace.plan.length > 500 ? workspace.plan.slice(0, 500) + "..." : workspace.plan;
    parts.push(`## 当前计划\n\n${truncated}`);
  }

  // 当前进度
  if (workspace.progress) {
    const truncated = workspace.progress.length > 500 ? workspace.progress.slice(0, 500) + "..." : workspace.progress;
    parts.push(`## 当前进度\n\n${truncated}`);
  }

  // 待办事项
  if (todos.length > 0) {
    const lines = todos.map(t =>
      `- [${t.status}] ${t.title} (ID: ${t.id})${t.assignee ? ` → ${t.assignee}` : " → 待分配"}`
    );
    parts.push(`## 待办事项\n\n${lines.join("\n")}`);
  }

  // 群组经验
  if (workspace.experienceSummary) {
    parts.push(`## 群组经验\n\n${workspace.experienceSummary}`);
  }

  // 协作行为指引
  parts.push(`## 协作行为指引

- 讨论涉及你的 JOB 领域时，主动提供专业意见
- 任务超出你的 JOB 范围时，@mention 擅长该领域的队友求助
- 完成阶段性工作后，向群组汇报进度
- 遇到阻塞时，主动告知群组并说明原因
- 与队友观点分歧 2 轮仍无共识时，@mention 群主请求仲裁
- 群主做出决策后，执行决策，不要继续争论
- 不要对每条消息都回复，只在你能提供真正价值时才发言`);

  return `# 群组协作上下文\n\n${parts.join("\n\n")}`;
}
```

- [ ] **Step 2: 运行 TypeScript 编译确认无类型错误**

Run: `cd D:/agent-codes/cobeing && npx tsc --noEmit -p packages/core/tsconfig.json 2>&1 | head -20`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
cd D:/agent-codes/cobeing
git add packages/core/src/conversation/prompt-builder.ts
git commit -m "feat(prompt-builder): add buildGroupCollaborationContext for collaboration injection"
```

---

### Task 3: Group.getMemberProfiles() 方法

**Files:**
- Modify: `packages/core/src/group/group.ts`

- [ ] **Step 1: 添加 getMemberProfiles 方法**

在 `Group` 类中 `getAgentMemory()` 方法之后添加：

```typescript
  /** 获取所有成员的画像摘要（姓名 + JOB 摘要） */
  getMemberProfiles(): import("../conversation/prompt-builder.js").MemberProfile[] {
    const profiles: import("../conversation/prompt-builder.js").MemberProfile[] = [];
    for (const memberId of this.config.members) {
      const agent = this.registry.get(memberId);
      const agentPaths = AgentPaths.forAgent(memberId, this._dataRoot);
      const agentFiles = new AgentFiles(agentPaths);

      // 从 CHARACTER.md 提取姓名
      const character = agentFiles.readCharacter();
      let name = agent?.name || memberId;
      if (character) {
        const nameMatch = character.match(/-\s*Name:\s*(.+)/);
        if (nameMatch) name = nameMatch[1].trim();
      }

      // 从 JOB.md 提取专注领域
      const job = agentFiles.readJob();
      let role = "成员";
      if (job) {
        const roleMatch = job.match(/##\s*专注领域\s*\n+([^\n#]+)/);
        if (roleMatch) role = roleMatch[1].trim();
      }

      profiles.push({ id: memberId, name, role });
    }
    return profiles;
  }
```

- [ ] **Step 2: 运行 TypeScript 编译确认**

Run: `cd D:/agent-codes/cobeing && npx tsc --noEmit -p packages/core/tsconfig.json 2>&1 | head -20`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
cd D:/agent-codes/cobeing
git add packages/core/src/group/group.ts
git commit -m "feat(group): add getMemberProfiles for collaboration context"
```

---

### Task 4: GroupWorkspace 增加 EXPERIENCE.md

**Files:**
- Modify: `packages/core/src/group/workspace.ts`

- [ ] **Step 1: 添加 EXPERIENCE.md 路径到 GroupWorkspacePaths**

在 `GroupWorkspacePaths` 接口中 `conversations` 之后添加：

```typescript
  experience: string;
```

在构造函数中 `this.paths` 对象里添加：

```typescript
      experience: join(workspaceRoot, "EXPERIENCE.md"),
```

- [ ] **Step 2: 添加 EXPERIENCE.md 初始内容和读写方法**

在 `writePlan()` 方法之后添加：

```typescript
  /**
   * 写入 EXPERIENCE.md（群组级协作经验）
   */
  writeExperience(): void {
    const content = `# ${this.groupName} - 群组协作经验

> 本文档记录协作过程中的关键决策和教训

## 关键决策

_记录协作中的重要决策和理由_

- （暂无）

## 协作教训

_记录协作中发现的问题和改进_

- （暂无）

## 有效模式

_记录哪些协作方式效果好_

- （暂无）

## 更新日志

- ${new Date().toISOString()} - 初始化协作经验文档
`;
    writeFileSync(this.paths.experience, content, "utf-8");
  }

  /**
   * 读取 EXPERIENCE.md
   */
  readExperience(): string | null {
    if (!existsSync(this.paths.experience)) return null;
    return readFileSync(this.paths.experience, "utf-8");
  }

  /**
   * 读取 EXPERIENCE.md 摘要（最近的内容，截取前 500 字）
   */
  readExperienceSummary(): string | null {
    const full = this.readExperience();
    if (!full) return null;
    // 跳过标题和说明，提取实际经验内容
    const lines = full.split("\n");
    const contentLines = lines.filter(l => l.startsWith("- ") || l.startsWith("### "));
    if (contentLines.length === 0) return null;
    const summary = contentLines.join("\n");
    return summary.length > 500 ? summary.slice(0, 500) + "..." : summary;
  }

  /**
   * 追加经验条目
   */
  appendExperience(section: "关键决策" | "协作教训" | "有效模式", entry: string): void {
    let content = this.readExperience() || "";
    const sectionHeader = `## ${section}`;
    const idx = content.indexOf(sectionHeader);
    if (idx >= 0) {
      // 在该 section 的第一个空行后插入
      const afterHeader = idx + sectionHeader.length;
      const nextSection = content.indexOf("\n## ", afterHeader);
      const insertPoint = nextSection >= 0 ? nextSection : content.length;
      const timestamp = new Date().toISOString().slice(0, 10);
      const line = `\n- [${timestamp}] ${entry}`;
      content = content.slice(0, insertPoint) + line + content.slice(insertPoint);
    }
    writeFileSync(this.paths.experience, content, "utf-8");
  }
```

- [ ] **Step 3: 在 initialize() 中创建 EXPERIENCE.md**

在 `initialize()` 方法中，找到 `if (!existsSync(this.paths.plan))` 那行之后添加：

```typescript
    if (!existsSync(this.paths.experience)) this.writeExperience();
```

- [ ] **Step 4: 在 getSummary() 中添加 experience**

在 `getSummary()` 方法的返回对象中添加：

```typescript
      experience: this.readExperience(),
```

同时更新返回类型，添加 `experience: string | null`。

- [ ] **Step 5: 运行 TypeScript 编译确认**

Run: `cd D:/agent-codes/cobeing && npx tsc --noEmit -p packages/core/tsconfig.json 2>&1 | head -20`
Expected: 无错误

- [ ] **Step 6: Commit**

```bash
cd D:/agent-codes/cobeing
git add packages/core/src/group/workspace.ts
git commit -m "feat(workspace): add EXPERIENCE.md for group-level knowledge sharing"
```

---

### Task 5: WakeSystem 注入协作上下文

**Files:**
- Modify: `packages/core/src/group/wake-system.ts`
- Modify: `packages/core/src/group/group.ts`

- [ ] **Step 1: WakeSystem 增加依赖注入**

在 `WakeSystemConfig` 接口中添加：

```typescript
  /** 获取群组引用（用于构建协作上下文） */
  getGroup?: () => import("./group.js").Group | undefined;
```

在 `WakeSystem` 构造函数的 `deps` 参数中添加：

```typescript
  getGroup?: () => import("./group.js").Group | undefined;
```

在构造函数体中保存：

```typescript
  private getGroup: (() => import("./group.js").Group | undefined) | null;
```

初始化：

```typescript
    this.getGroup = deps?.getGroup ?? null;
```

- [ ] **Step 2: 在 executeWake() 中注入协作上下文**

在 `executeWake()` 方法中，找到 `// 5. 唤醒 Agent` 注释之前，添加协作上下文注入：

```typescript
      // 4.5 构建并设置群组协作上下文
      if (this.getGroup) {
        const group = this.getGroup();
        if (group) {
          const { buildGroupCollaborationContext } = await import("../conversation/prompt-builder.js");
          const members = group.getMemberProfiles();
          const workspace = group.workspace.getSummary();
          const experienceSummary = group.workspace.readExperienceSummary();

          // 获取群组 TODO 列表
          let todos: import("../conversation/prompt-builder.js").GroupTodoSummary[] = [];
          const groupManager = (globalThis as any).__cobeingGroupManager;
          if (groupManager) {
            const scanner = groupManager.getScanner?.(this.ctx.groupId);
            if (scanner) {
              const store = scanner.getStore();
              const pendingTodos = store.list("pending");
              todos = pendingTodos.map((t: any) => ({
                id: t.id,
                title: t.title,
                status: t.status,
                assignee: t.targetAgentId,
              }));
            }
          }

          const collabContext = buildGroupCollaborationContext(
            entry.targetAgentId,
            members,
            {
              task: workspace.task,
              plan: workspace.plan,
              progress: workspace.progress,
              experienceSummary,
            },
            todos,
          );
          agent.setGroupContext(collabContext);
        }
      }
```

- [ ] **Step 3: 在 agent.run() 之后清理 groupContext**

在 `const response = await agent.run(enrichedContext);` 之后添加：

```typescript
      agent.clearGroupContext();
```

- [ ] **Step 4: GroupManager 创建 WakeSystem 时注入 getGroup**

在 `GroupManager` 创建 Group 的地方（`addFromConfig` 或类似方法），修改 WakeSystem 的 deps：

找到创建 Group 的代码，在 Group 构造之后，确保 WakeSystem 能获取 group 引用。由于 Group 在构造函数中创建 WakeSystem，需要在 Group 构造函数中传入 getGroup 回调。

修改 `Group` 构造函数中创建 WakeSystem 的 deps：

```typescript
        getGroup: () => this,
```

- [ ] **Step 5: GroupManager 暴露 getScanner 方法**

在 `GroupManager` 类中添加：

```typescript
  /** 获取群组 TODO 扫描器 */
  getScanner(groupId: string): GroupTodoScanner | undefined {
    return this.groupScanners.get(groupId);
  }
```

- [ ] **Step 6: 运行 TypeScript 编译确认**

Run: `cd D:/agent-codes/cobeing && npx tsc --noEmit -p packages/core/tsconfig.json 2>&1 | head -20`
Expected: 无错误

- [ ] **Step 7: Commit**

```bash
cd D:/agent-codes/cobeing
git add packages/core/src/group/wake-system.ts packages/core/src/group/group.ts packages/core/src/group/manager.ts
git commit -m "feat(wake-system): inject collaboration context before waking agents"
```

---

### Task 6: AGENTS.md 模板更新

**Files:**
- Modify: `config/templates/AGENTS.md`

- [ ] **Step 1: 在「群组行为」章节后新增「协作接力」章节**

找到 `## 群组行为` 章节的末尾（`## 红线` 之前），插入：

```markdown
## 协作接力

你被 @mention 激活后，在回复中判断是否需要引入其他队友。

### 何时 @mention 其他队友
- 讨论涉及另一个队友的 JOB 领域 → @mention 他们，请他们补充专业意见
- 你完成了一部分工作，下一步需要另一个队友接力 → @mention 他们并说明你做了什么
- 你遇到了超出自己 JOB 范围的问题 → @mention 擅长该领域的队友求助
- 你需要确认某个技术决策 → @mention 相关队友征求意见

### 何时直接回复（不 @mention）
- 问题完全在你的 JOB 范围内，你能独立回答
- 只是信息确认或简单回复
- 别人已经回答了

### 如何 @mention
- 在消息中写 @agent-id 即可，WakeSystem 会自动唤醒他们
- @all 提及所有人（谨慎使用）
- 说明你为什么 @mention 他们，给他们上下文

### 认领任务
- 看到与你 JOB 匹配的待分配 TODO → @mention 群主表示认领
- 群主确认后会通过 TODO 系统分配给你

### 协作边界
- 不要对每条消息都回复，只在你能提供真正价值时才发言
- 与队友观点分歧 2 轮仍无共识 → @mention 群主请求仲裁
- 群主做出决策后，执行决策，不要继续争论

```

- [ ] **Step 2: Commit**

```bash
cd D:/agent-codes/cobeing
git add config/templates/AGENTS.md
git commit -m "docs(templates): add collaboration relay and task claiming sections to AGENTS.md"
```

---

### Task 7: TODO 完成时自动 @mention

**Files:**
- Modify: `packages/core/src/group/manager.ts`
- Modify: `packages/core/src/todo/tools.ts`

- [ ] **Step 1: GroupManager 的 GroupTodoScanner 增加 onCompleteAction 回调**

在 `GroupManager` 中创建 `GroupTodoScanner` 的两处代码（`addFromConfig` 和 `restoreGroups`），在 `onTrigger` 回调之后添加：

```typescript
      onCompleteAction: async (groupId, todo) => {
        const g = this.groups.get(groupId);
        if (g && todo.onComplete?.mentionAgentId) {
          const mentionId = todo.onComplete.mentionAgentId;
          const message = todo.onComplete.message || `@${mentionId} ${todo.title} 已完成，请开始你的部分。`;
          g.postMessage("system", message);
        }
      },
```

- [ ] **Step 2: 修改 makeTodoCompleteTool 使用 groupScanner.complete()**

修改 `makeTodoCompleteTool` 函数签名，增加 `groupScannerGetter` 参数：

```typescript
export function makeTodoCompleteTool(
  agentDataRoot: string,
  groupStoreGetter?: (groupId: string) => TodoStore | undefined,
  groupScannerGetter?: (groupId: string) => import("./group-scanner.js").GroupTodoScanner | undefined,
): Tool {
```

在 execute 函数中，当 scope 为 "group" 时，使用 groupScanner.complete() 替代 store.complete()：

```typescript
    async execute(params, context: ToolContext): Promise<ToolResult> {
      const scope = params.scope as TodoScope;
      const groupId = params.groupId as string;

      // 群组级 TODO 优先使用 groupScanner.complete() 以触发 onComplete
      if (scope === "group" && groupId && groupScannerGetter) {
        const scanner = groupScannerGetter(groupId);
        if (scanner) {
          const item = await scanner.complete(params.todoId as string);
          if (!item) return { toolCallId: "", content: `未找到 TODO: ${params.todoId}`, isError: true };
          log.info("TODO completed via scanner: %s (%s)", item.id, item.title);
          return { toolCallId: "", content: `已完成 TODO "${item.title}"` };
        }
      }

      // fallback: 直接操作 store
      const store = resolveStore(scope, groupId, agentDataRoot, context, groupStoreGetter);
      if (!store) return { toolCallId: "", content: "无法确定 TODO 存储", isError: true };

      const item = store.complete(params.todoId as string);
      if (!item) return { toolCallId: "", content: `未找到 TODO: ${params.todoId}`, isError: true };

      log.info("TODO completed: %s (%s)", item.id, item.title);
      return { toolCallId: "", content: `已完成 TODO "${item.title}"` };
    },
```

- [ ] **Step 3: Agent 构造函数中传入 groupScannerGetter**

在 `agent.ts` 中注册 TODO 工具的地方（约 line 134-138），修改 `makeTodoCompleteTool` 调用：

```typescript
    this.toolRegistry.register(makeTodoCompleteTool(
      todoDataRoot,
      undefined,
      (groupId) => {
        const groupManager = (globalThis as any).__cobeingGroupManager;
        return groupManager?.getScanner?.(groupId);
      },
    ));
```

- [ ] **Step 4: 运行 TypeScript 编译确认**

Run: `cd D:/agent-codes/cobeing && npx tsc --noEmit -p packages/core/tsconfig.json 2>&1 | head -20`
Expected: 无错误

- [ ] **Step 5: Commit**

```bash
cd D:/agent-codes/cobeing
git add packages/core/src/group/manager.ts packages/core/src/todo/tools.ts packages/core/src/agent/agent.ts
git commit -m "feat(todo): auto @mention next agent on TODO completion"
```

---

### Task 8: 协作上下文注入 TODO 列表

**Files:**
- 已在 Task 2 的 `buildGroupCollaborationContext` 中实现（todos 参数）
- 已在 Task 5 的 WakeSystem 中获取 TODO 列表

- [ ] **Step 1: 验证 TODO 列表正确注入**

此步骤为集成验证。在 Task 5 和 Task 7 完成后，手动检查：
1. 创建一个群组，添加 2 个 Agent
2. 用 host-decompose-task 创建子任务（带 onComplete.mentionAgentId）
3. 触发一个 Agent，检查 system prompt 中是否包含 TODO 列表
4. 完成一个 TODO，检查是否自动 @mention 下一个 Agent

- [ ] **Step 2: 如果发现问题，修复并 Commit**

---

### Task 9: Screener 冲突检测增强

**Files:**
- Modify: `packages/core/src/group/screener.ts`

- [ ] **Step 1: 增强 Screener prompt 以输出结构化冲突摘要**

修改 `SCREENER_PROMPT`，在输出格式中增加冲突摘要字段：

```typescript
const SCREENER_PROMPT = `你是群组协作的初筛器。你的任务是判断群主是否需要介入当前协作。

请根据以下规则判断：

**需要介入的情况：**
- 协作偏离目标（2+ 轮无关内容）
- 成员间冲突升级（互相否定 3+ 轮）
- 长时间无实质进展（连续 5+ 条消息无新观点）
- 任务阻塞报告
- 成员请求帮助或指导

**不需要介入的情况：**
- 成员正在有效协作
- 工作正常推进
- 只是信息分享或状态更新
- 你没有比成员更好的见解

请严格按以下格式输出：

是否需要唤醒主模型：是/否
原因：一句话说明
建议：如果需要唤醒，给出建议群主做什么（不需要则填"无"）
冲突摘要：如果存在观点分歧，列出各方观点（没有则填"无"）

请分析以下最近消息：`;
```

- [ ] **Step 2: 更新 ScreenerResult 接口和解析逻辑**

修改 `ScreenerResult` 接口：

```typescript
export interface ScreenerResult {
  shouldWake: boolean;
  reason: string;
  suggestion: string;
  conflictSummary?: string; // 结构化冲突摘要
}
```

修改 `parseResult` 方法，提取冲突摘要：

```typescript
  private parseResult(raw: string): ScreenerResult {
    const shouldWake = raw.includes("是") && !raw.includes("是否需要唤醒主模型：否");

    const reasonMatch = raw.match(/原因[：:]\s*(.+)/);
    const suggestionMatch = raw.match(/建议[：:]\s*(.+)/);
    const conflictMatch = raw.match(/冲突摘要[：:]\s*(.+)/);

    const conflictRaw = conflictMatch?.[1]?.trim() ?? "";
    const hasConflict = conflictRaw && conflictRaw !== "无";

    return {
      shouldWake,
      reason: reasonMatch?.[1]?.trim() ?? "",
      suggestion: suggestionMatch?.[1]?.trim() ?? "无",
      conflictSummary: hasConflict ? conflictRaw : undefined,
    };
  }
```

- [ ] **Step 3: 运行 TypeScript 编译确认**

Run: `cd D:/agent-codes/cobeing && npx tsc --noEmit -p packages/core/tsconfig.json 2>&1 | head -20`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
cd D:/agent-codes/cobeing
git add packages/core/src/group/screener.ts
git commit -m "feat(screener): add structured conflict summary to screening results"
```

---

### Task 10: 群组 EXPERIENCE.md 集成到协作上下文

**Files:**
- 已在 Task 4 中实现了 `readExperienceSummary()` 和 `appendExperience()`
- 已在 Task 2 的 `buildGroupCollaborationContext` 中使用了 `experienceSummary`
- 已在 Task 5 的 WakeSystem 中获取了 `experienceSummary`

- [ ] **Step 1: 验证群组经验正确注入**

集成验证：
1. 手动在群组 `data/groups/{id}/EXPERIENCE.md` 中写入一些经验条目
2. 触发一个 Agent，检查 system prompt 中是否包含群组经验摘要
3. 验证 `appendExperience()` 能正确追加条目

- [ ] **Step 2: 如果发现问题，修复并 Commit**

---

### Task 11: 集成测试 — 端到端协作流程

**Files:**
- 无新文件，纯验证

- [ ] **Step 1: 运行所有现有测试确认无回归**

Run: `cd D:/agent-codes/cobeing && npx vitest run --reporter=verbose 2>&1 | tail -20`
Expected: 所有测试通过

- [ ] **Step 2: 验证协作上下文注入链路**

检查点：
1. Group.getMemberProfiles() 返回正确的成员画像
2. GroupWorkspace.readExperienceSummary() 返回摘要
3. buildGroupCollaborationContext() 生成正确的上下文文本
4. agent.setGroupContext() / clearGroupContext() 正常工作
5. promptBuilder 闭包在有 groupContext 时追加到 system prompt

- [ ] **Step 3: 验证 TODO 完成通知链路**

检查点：
1. GroupTodoScanner.complete() 触发 onCompleteAction
2. onCompleteAction 向群组 postMessage @mention 下一个 Agent
3. WakeSystem 检测到 @mention 并唤醒目标 Agent

- [ ] **Step 4: 验证 AGENTS.md 模板更新**

检查点：
1. 新 Agent 创建后 AGENTS.md 包含「协作接力」章节
2. 协作行为指引在 system prompt 中正确拼接

- [ ] **Step 5: Final Commit**

```bash
cd D:/agent-codes/cobeing
git add -A
git commit -m "feat: agent collaboration capabilities — context injection, relay behavior, task delegation, conflict detection, knowledge sharing"
```
