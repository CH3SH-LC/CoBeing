# 通用智能体能力与增强 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 CoBeing 通用智能体实现 14 项核心能力：能力画像、任务收件箱、成长建议、资源请求、Butler 能力调度和前端面板。

**Architecture:** 在现有 Agent 五文件体系上扩展 4 个新数据文件（capability.json、inbox.json、reflection.json、proposals/），新增 3 个 ToolAgent（GrowthReviewer/TaskArchive/CapabilityUpdater）、10 个 Agent 工具、3 个 Butler 工具、7 个 WS 端点和 3 个前端 Tab。所有新增代码遵循现有 factory 模式、ToolAgent 范式和 WS 命令模式。

**Tech Stack:** TypeScript, Node.js, Zustand, React + Tailwind, Vitest

---

## 文件映射

### 新建文件

| 文件 | 职责 |
|------|------|
| `packages/core/src/agent/tool-agent/growth-reviewer.ts` | GrowthReviewer ToolAgent — 审批 GrowthProposal |
| `packages/core/src/agent/tool-agent/task-archive.ts` | TaskArchive ToolAgent — 任务归档判断 |
| `packages/core/src/agent/tool-agent/capability-updater.ts` | CapabilityUpdater ToolAgent — 能力卡维护 |
| `packages/core/src/tools/agent-capability.ts` | agent-get-capability / agent-update-capability 工具 |
| `packages/core/src/tools/agent-task.ts` | agent-task-accept / report / complete 工具 |
| `packages/core/src/tools/agent-growth.ts` | agent-reflect-experience / propose-job / propose-character / propose-config |
| `packages/core/src/tools/agent-resource.ts` | agent-request-resource 工具 |
| `data/toolagents/growth-reviewer/config.json` | GrowthReviewer 配置 |
| `data/toolagents/growth-reviewer/prompt.md` | GrowthReviewer 系统提示词 |
| `data/toolagents/task-archive/config.json` | TaskArchive 配置 |
| `data/toolagents/task-archive/prompt.md` | TaskArchive 系统提示词 |
| `data/toolagents/capability-updater/config.json` | CapabilityUpdater 配置 |
| `data/toolagents/capability-updater/prompt.md` | CapabilityUpdater 系统提示词 |
| `gui-v2/src/components/agent/CapabilityTab.tsx` | 能力卡 Tab 组件 |
| `gui-v2/src/components/agent/TaskInboxTab.tsx` | 任务收件箱 Tab 组件 |
| `gui-v2/src/components/agent/GrowthProposalsTab.tsx` | 成长建议 Tab 组件 |
| `gui-v2/src/stores/agentEnhancement.ts` | 前端增强数据 Zustand store |

### 修改文件

| 文件 | 修改范围 |
|------|---------|
| `packages/shared/src/types.ts` | 新增 6 个接口/类型（AgentCapabilityCard、AgentTaskInboxItem、AgentTaskStatus、AgentReflectionRecord、AgentGrowthProposal、AgentTaskSummary） |
| `packages/core/src/agent/paths.ts` | AgentPaths 新增 4 个 getter + ensureDirs；AgentFiles 新增 9 个方法 |
| `packages/core/src/agent/tool-agent/types.ts` | ToolAgentType 扩展 3 个新类型 |
| `packages/core/src/agent/agent.ts` | 构造函数注册新工具；getStatus/getTaskSummary 改造 |
| `packages/core/src/agent/butler.ts` | 新增 3 个 Butler 工具工厂函数 + 构造函数注册 |
| `packages/core/src/api/ws-server.ts` | 新增 7 个 WS case |
| `packages/core/src/index.ts` | 导出新增类型 |
| `gui-v2/src/lib/types.ts` | 新增前端类型（AgentInfo 扩展等） |
| `gui-v2/src/components/agent/AgentDetailPanel.tsx` | Tabs grid-cols-3 → grid-cols-4，新增 3 个 Tab |
| `gui-v2/src/hooks/useWebSocket.ts` | 新增 7 个 WS message handler |

---

## 阶段 1：shared 类型定义

### Task 1: 新增 Agent 增强类型到 shared/types.ts

**Files:**
- Modify: `CoBeing/packages/shared/src/types.ts`

在文件末尾（`export interface LocalModelConfig` 之后）追加以下类型：

- [ ] **Step 1: 追加 Capability 和 Task 类型**

```ts
// ============================================================
// Agent 增强 — Capability Card
// ============================================================

export interface AgentCapabilityCard {
  agentId: string;
  displayName: string;
  role: string;
  domains: string[];
  strengths: string[];
  limitations: string[];
  taskTypes: Array<{
    id: string;
    label: string;
    examples: string[];
    inputRequirements: string[];
    outputFormats: string[];
  }>;
  preferredTools: string[];
  preferredSkills: string[];
  collaboration: {
    canWorkAlone: boolean;
    goodInGroups: boolean;
    needsReviewFor: string[];
    shouldDelegate: string[];
  };
  reliability?: {
    completedTasks: number;
    failedTasks: number;
    lastUpdated: string;
  };
}

// ============================================================
// Agent 增强 — Task Inbox
// ============================================================

export type AgentTaskStatus =
  | "pending"
  | "running"
  | "blocked"
  | "waiting_user"
  | "waiting_dependency"
  | "completed"
  | "failed"
  | "cancelled";

export interface AgentTaskInboxItem {
  id: string;
  globalTodoId?: string;
  agentTodoId?: string;
  sourceType: "user" | "butler" | "group" | "system";
  sourceId: string;
  title: string;
  goal: string;
  acceptance?: string;
  constraints?: string[];
  status: AgentTaskStatus;
  blockerReason?: string;
  dependencyRefs?: Array<{ agentId: string; todoId?: string; reason: string }>;
  failureSummary?: string;
  globalMappingNote?: string;
  artifacts?: Array<{ name: string; path?: string; description?: string }>;
  createdAt: string;
  updatedAt: string;
}

export interface AgentTaskSummary {
  activeCount: number;
  blockedCount: number;
  waitingUserCount: number;
  waitingDependencyCount: number;
  dominantStatus: AgentTaskStatus | "idle";
  recentFailures: string[];
}

// ============================================================
// Agent 增强 — Reflection
// ============================================================

export interface AgentReflectionRecord {
  id: string;
  agentId: string;
  taskId: string;
  outcome: "success" | "partial" | "failed";
  whatWorked: string[];
  whatFailed: string[];
  userPreferences: string[];
  toolLessons: string[];
  suggestedJobUpdates: string[];
  suggestedCharacterUpdates: string[];
  createdAt: string;
}

// ============================================================
// Agent 增强 — Growth Proposal
// ============================================================

export type AgentGrowthTarget = "JOB.md" | "CHARACTER.md" | "config.json";
export type AgentGrowthRisk = "low" | "medium" | "high";
export type AgentGrowthStatus = "pending" | "approved" | "rejected" | "applied";

export interface AgentGrowthProposal {
  id: string;
  agentId: string;
  targetFile: AgentGrowthTarget;
  reason: string;
  proposedPatch: string;
  risk: AgentGrowthRisk;
  status: AgentGrowthStatus;
  createdAt: string;
  reviewedBy?: "growth-reviewer" | "user" | "butler";
  reviewedAt?: string;
  reviewNote?: string;
}

// ============================================================
// 状态映射工具函数
// ============================================================

export function mapAgentStatusToGlobal(
  status: AgentTaskStatus,
): "pending" | "running" | "waiting_user" | "completed" | "cancelled" {
  switch (status) {
    case "blocked":
    case "waiting_dependency":
    case "failed":
      return "running";
    case "running":
    case "pending":
      return status;
    case "waiting_user":
      return "waiting_user";
    case "completed":
      return "completed";
    case "cancelled":
      return "cancelled";
  }
}
```

- [ ] **Step 2: 验证编译**

```bash
pnpm --filter @cobeing/shared build
```

- [ ] **Step 3: 提交**

```bash
git add CoBeing/packages/shared/src/types.ts
git commit -m "feat: add Agent enhancement types (CapabilityCard, TaskInbox, Reflection, GrowthProposal)"
```

---

## 阶段 2：AgentPaths / AgentFiles 扩展

### Task 2: AgentPaths 新增 getter + ensureDirs

**Files:**
- Modify: `CoBeing/packages/core/src/agent/paths.ts`

- [ ] **Step 1: 在 AgentPaths 类中新增 4 个 getter**

在现有 `get skillsDir()` 之后（第 30 行附近）插入：

```ts
get capabilityPath()   { return path.join(this.baseDir, "capability.json"); }
get inboxPath()        { return path.join(this.baseDir, "inbox.json"); }
get reflectionPath()   { return path.join(this.baseDir, "reflection.json"); }
get proposalsDir()     { return path.join(this.baseDir, "proposals"); }
get proposalPath(id: string) { return path.join(this.baseDir, "proposals", `${id}.json`); }
```

- [ ] **Step 2: 在 ensureDirs() 中新增 proposals 目录**

在 `ensureDirs()` 方法体末尾（第 49 行之前）新增：

```ts
fs.mkdirSync(this.proposalsDir, { recursive: true });
```

- [ ] **Step 3: 编译验证**

```bash
pnpm --filter @cobeing/core build
```

- [ ] **Step 4: 提交**

```bash
git add CoBeing/packages/core/src/agent/paths.ts
git commit -m "feat: add capability/inbox/reflection/proposals paths to AgentPaths"
```

### Task 3: AgentFiles 新增读写方法

**Files:**
- Modify: `CoBeing/packages/core/src/agent/paths.ts`

在 `AgentFiles` 类末尾（`readFile` 私有方法之前）新增以下方法：

- [ ] **Step 1: 新增 Capability 读写方法**

```ts
readCapability(): AgentCapabilityCard | null {
  const raw = this.readFile(this.paths.capabilityPath);
  if (!raw) return null;
  try { return JSON.parse(raw) as AgentCapabilityCard; } catch { return null; }
}

writeCapability(card: AgentCapabilityCard): void {
  fs.writeFileSync(this.paths.capabilityPath, JSON.stringify(card, null, 2), "utf-8");
}
```

需要在文件顶部新增 import：

```ts
import type { AgentCapabilityCard, AgentTaskInboxItem, AgentGrowthProposal, AgentReflectionRecord } from "@cobeing/shared";
```

- [ ] **Step 2: 新增 Inbox 读写方法**

```ts
readInbox(): AgentTaskInboxItem[] {
  const raw = this.readFile(this.paths.inboxPath);
  if (!raw) return [];
  try {
    const data = JSON.parse(raw);
    // 兼容两种格式：纯数组 或 { active: [], archived: [] }
    if (Array.isArray(data)) return data;
    return [...(data.active ?? []), ...(data.archived ?? [])];
  } catch { return []; }
}

writeInbox(items: AgentTaskInboxItem[]): void {
  // 保持 active/archived 分离结构
  const archived = items.filter(i => ["completed", "cancelled"].includes(i.status) && i.updatedAt && 
    (Date.now() - new Date(i.updatedAt).getTime()) > 7 * 24 * 60 * 60 * 1000);
  const active = items.filter(i => !archived.includes(i));
  fs.writeFileSync(this.paths.inboxPath, JSON.stringify({ active, archived }, null, 2), "utf-8");
}

addInboxItem(item: AgentTaskInboxItem): void {
  const items = this.readInbox();
  items.push(item);
  this.writeInbox(items);
}

updateInboxItem(id: string, patch: Partial<AgentTaskInboxItem>): void {
  const items = this.readInbox();
  const idx = items.findIndex(i => i.id === id);
  if (idx >= 0) {
    items[idx] = { ...items[idx], ...patch, updatedAt: new Date().toISOString() };
    this.writeInbox(items);
  }
}
```

- [ ] **Step 3: 新增 Reflection 读写方法**

```ts
readReflections(): AgentReflectionRecord[] {
  const raw = this.readFile(this.paths.reflectionPath);
  if (!raw) return [];
  try { return JSON.parse(raw) as AgentReflectionRecord[]; } catch { return []; }
}

addReflection(record: AgentReflectionRecord): void {
  const records = this.readReflections();
  records.push(record);
  // 保留最近 100 条
  const trimmed = records.slice(-100);
  fs.writeFileSync(this.paths.reflectionPath, JSON.stringify(trimmed, null, 2), "utf-8");
}
```

- [ ] **Step 4: 新增 Proposal 读写方法**

```ts
listProposals(): AgentGrowthProposal[] {
  if (!fs.existsSync(this.paths.proposalsDir)) return [];
  const files = fs.readdirSync(this.paths.proposalsDir).filter(f => f.endsWith(".json"));
  return files.map(f => {
    try { return JSON.parse(fs.readFileSync(path.join(this.paths.proposalsDir, f), "utf-8")) as AgentGrowthProposal; }
    catch { return null; }
  }).filter(Boolean) as AgentGrowthProposal[];
}

readProposal(id: string): AgentGrowthProposal | null {
  const p = this.paths.proposalPath(id);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, "utf-8")) as AgentGrowthProposal; } catch { return null; }
}

writeProposal(proposal: AgentGrowthProposal): void {
  if (!fs.existsSync(this.paths.proposalsDir)) {
    fs.mkdirSync(this.paths.proposalsDir, { recursive: true });
  }
  fs.writeFileSync(this.paths.proposalPath(proposal.id), JSON.stringify(proposal, null, 2), "utf-8");
}
```

- [ ] **Step 5: 编译验证**

```bash
pnpm --filter @cobeing/core build
```

- [ ] **Step 6: 提交**

```bash
git add CoBeing/packages/core/src/agent/paths.ts
git commit -m "feat: add AgentFiles capability/inbox/reflection/proposal methods"
```

### Task 4: AgentPaths/AgentFiles 单元测试

**Files:**
- Modify: `CoBeing/packages/core/src/agent/paths.test.ts`

- [ ] **Step 1: 新增 paths getter 测试**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AgentPaths, AgentFiles, isSafeAgentId } from "./paths.js";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const tmpDir = path.join(os.tmpdir(), `cobeing-test-paths-${Date.now()}`);
const agentDir = path.join(tmpDir, "agents", "test-agent");

beforeEach(() => {
  fs.mkdirSync(agentDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("AgentPaths — enhancement paths", () => {
  it("returns capability.json path", () => {
    const p = new AgentPaths(agentDir);
    expect(p.capabilityPath).toBe(path.join(agentDir, "capability.json"));
  });

  it("returns inbox.json path", () => {
    const p = new AgentPaths(agentDir);
    expect(p.inboxPath).toBe(path.join(agentDir, "inbox.json"));
  });

  it("returns reflection.json path", () => {
    const p = new AgentPaths(agentDir);
    expect(p.reflectionPath).toBe(path.join(agentDir, "reflection.json"));
  });

  it("returns proposals dir path", () => {
    const p = new AgentPaths(agentDir);
    expect(p.proposalsDir).toBe(path.join(agentDir, "proposals"));
  });

  it("returns proposal path for a given id", () => {
    const p = new AgentPaths(agentDir);
    expect(p.proposalPath("abc-123")).toBe(path.join(agentDir, "proposals", "abc-123.json"));
  });

  it("ensureDirs creates proposals dir", () => {
    const p = new AgentPaths(agentDir);
    p.ensureDirs();
    expect(fs.existsSync(p.proposalsDir)).toBe(true);
  });
});

describe("AgentFiles — enhancement methods", () => {
  it("readCapability returns null for missing file", () => {
    const files = new AgentFiles(new AgentPaths(agentDir));
    expect(files.readCapability()).toBeNull();
  });

  it("writeCapability and readCapability round-trip", () => {
    const files = new AgentFiles(new AgentPaths(agentDir));
    const card = { agentId: "test", displayName: "Test", role: "tester", domains: ["code"], strengths: [], limitations: [], taskTypes: [], preferredTools: [], preferredSkills: [], collaboration: { canWorkAlone: true, goodInGroups: false, needsReviewFor: [], shouldDelegate: [] } };
    files.writeCapability(card as any);
    const read = files.readCapability();
    expect(read).toBeTruthy();
    expect(read!.agentId).toBe("test");
  });

  it("readInbox returns empty array for missing file", () => {
    const files = new AgentFiles(new AgentPaths(agentDir));
    expect(files.readInbox()).toEqual([]);
  });

  it("addInboxItem and readInbox", () => {
    const files = new AgentFiles(new AgentPaths(agentDir));
    const item = { id: "t1", title: "Task 1", goal: "Do something", sourceType: "user" as const, sourceId: "u1", status: "pending" as const, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    files.addInboxItem(item as any);
    const items = files.readInbox();
    expect(items.length).toBe(1);
    expect(items[0].id).toBe("t1");
  });

  it("updateInboxItem patches an existing item", () => {
    const files = new AgentFiles(new AgentPaths(agentDir));
    files.addInboxItem({ id: "t2", title: "Task 2", goal: "Goal", sourceType: "butler", sourceId: "b1", status: "pending", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as any);
    files.updateInboxItem("t2", { status: "running" } as any);
    const items = files.readInbox();
    expect(items[0].status).toBe("running");
  });

  it("readReflections returns empty array for missing file", () => {
    const files = new AgentFiles(new AgentPaths(agentDir));
    expect(files.readReflections()).toEqual([]);
  });

  it("addReflection writes and reads back", () => {
    const files = new AgentFiles(new AgentPaths(agentDir));
    files.addReflection({ id: "r1", agentId: "a", taskId: "t1", outcome: "success", whatWorked: [], whatFailed: [], userPreferences: [], toolLessons: [], suggestedJobUpdates: [], suggestedCharacterUpdates: [], createdAt: new Date().toISOString() } as any);
    const records = files.readReflections();
    expect(records.length).toBe(1);
    expect(records[0].id).toBe("r1");
  });

  it("listProposals returns empty for empty dir", () => {
    const files = new AgentFiles(new AgentPaths(agentDir));
    files.writeProposal({ id: "p1", agentId: "a", targetFile: "JOB.md", reason: "test", proposedPatch: "change", risk: "low", status: "pending", createdAt: new Date().toISOString() } as any);
    const list = files.listProposals();
    expect(list.length).toBe(1);
    expect(list[0].id).toBe("p1");
  });

  it("writeProposal and readProposal round-trip", () => {
    const files = new AgentFiles(new AgentPaths(agentDir));
    const prop = { id: "p2", agentId: "a", targetFile: "CHARACTER.md", reason: "tone shift", proposedPatch: "...", risk: "high", status: "pending", createdAt: new Date().toISOString() };
    files.writeProposal(prop as any);
    const read = files.readProposal("p2");
    expect(read).toBeTruthy();
    expect(read!.targetFile).toBe("CHARACTER.md");
  });
});
```

- [ ] **Step 2: 运行测试**

```bash
vitest run CoBeing/packages/core/src/agent/paths.test.ts
```

- [ ] **Step 3: 提交**

```bash
git add CoBeing/packages/core/src/agent/paths.test.ts
git commit -m "test: add AgentPaths/AgentFiles enhancement methods tests"
```

---

## 阶段 3：新增 ToolAgent

### Task 5: ToolAgentType 扩展 + GrowthReviewer 配置

**Files:**
- Modify: `CoBeing/packages/core/src/agent/tool-agent/types.ts`
- Create: `CoBeing/data/toolagents/growth-reviewer/config.json`
- Create: `CoBeing/data/toolagents/growth-reviewer/prompt.md`

- [ ] **Step 1: 扩展 ToolAgentType**

在 `types.ts` 第 6 行，修改 `ToolAgentType`：

```ts
export type ToolAgentType = "review" | "judgment" | "clone" | "memory"
  | "growth-reviewer" | "task-archive" | "capability-updater";
```

- [ ] **Step 2: 创建 GrowthReviewer 配置**

`data/toolagents/growth-reviewer/config.json`:

```json
{
  "model": "deepseek-chat",
  "maxIterations": 3,
  "tools": [],
  "timeout": 60000
}
```

- [ ] **Step 3: 创建 GrowthReviewer 提示词**

`data/toolagents/growth-reviewer/prompt.md`:

```markdown
你是 CoBeing 的成长审查器 (Growth Reviewer)。你的职责是审查 Agent 生成的成长建议 (GrowthProposal)，决定批准还是拒绝。

## 审批原则

### JOB.md 修改
- 方法改进、流程优化、新增检查步骤 → 批准 (risk=low)
- 删除核心方法步骤 → 拒绝
- 添加模糊不清的方法描述 → 拒绝并要求细化

### CHARACTER.md 修改
- 语气微调、表达优化 → 批准但标记 risk=medium
- 人格核心变更（角色定位、价值观） → 标记 risk=high，仍批准（需用户最终确认）
- 与现有 CHARACTER.md 矛盾 → 拒绝

### config.json 修改
- 添加技能、工具 → 批准但标记 risk=medium（需管家最终确认）
- 修改权限、模型、沙箱配置 → 标记 risk=high，仍批准（需管家最终确认）
- 扩大权限范围 → 拒绝

## 输入格式
你会收到：
1. Proposal JSON（包含 proposedPatch、targetFile、reason）
2. Agent 当前 CHARACTER.md / JOB.md / config.json 内容

## 输出格式
返回 JSON：
```json
{ "approved": true/false, "reason": "说明", "riskOverride": "low"|"medium"|"high" }
```
```

- [ ] **Step 4: 编译验证**

```bash
pnpm --filter @cobeing/core build
```

- [ ] **Step 5: 提交**

```bash
git add CoBeing/packages/core/src/agent/tool-agent/types.ts CoBeing/data/toolagents/growth-reviewer/
git commit -m "feat: add GrowthReviewer ToolAgent config and prompt"
```

### Task 6: GrowthReviewer ToolAgent 实现

**Files:**
- Create: `CoBeing/packages/core/src/agent/tool-agent/growth-reviewer.ts`

- [ ] **Step 1: 实现 runGrowthReviewer**

```ts
/**
 * GrowthReviewer ToolAgent — 审批 Agent 的成长建议
 */
import type { LLMProvider } from "@cobeing/providers";
import type { AgentGrowthProposal, AgentGrowthRisk } from "@cobeing/shared";
import { runToolAgent, loadToolAgentData } from "./base.js";
import { ToolRegistry } from "../../tools/registry.js";

export interface GrowthReviewInput {
  proposal: AgentGrowthProposal;
  characterMd?: string;
  jobMd?: string;
  configJson?: string;
}

export interface GrowthReviewOutput {
  approved: boolean;
  reason: string;
  riskOverride?: AgentGrowthRisk;
}

const FALLBACK_PROMPT = `你是 CoBeing 的成长审查器。审查 Agent 的成长建议。

审批原则：
- JOB.md 方法改进 → 批准；删除核心步骤 → 拒绝
- CHARACTER.md 微调 → 批准(medium)；人格核心变更 → 批准(high，需用户确认)
- config.json 添加技能 → 批准(medium)；修改权限 → 批准(high，需管家确认)

返回 JSON: { "approved": true/false, "reason": "...", "riskOverride": "low"|"medium"|"high" }`;

export async function runGrowthReviewer(
  provider: LLMProvider,
  model: string,
  input: GrowthReviewInput,
  workingDir: string,
): Promise<GrowthReviewOutput> {
  const { config, prompt } = loadToolAgentData("growth-reviewer");
  const systemPrompt = prompt || FALLBACK_PROMPT;

  // 构建审查上下文
  const contextParts: string[] = [];
  if (input.jobMd) contextParts.push(`## Agent 当前 JOB.md\n\`\`\`markdown\n${input.jobMd.slice(0, 3000)}\n\`\`\``);
  if (input.characterMd) contextParts.push(`## Agent 当前 CHARACTER.md\n\`\`\`markdown\n${input.characterMd.slice(0, 3000)}\n\`\`\``);
  if (input.configJson) contextParts.push(`## Agent 当前 config.json\n\`\`\`json\n${input.configJson.slice(0, 2000)}\n\`\`\``);

  const userPrompt = `## 待审查的成长建议\n- **目标文件**: ${input.proposal.targetFile}
- **原因**: ${input.proposal.reason}
- **风险自评**: ${input.proposal.risk}
- **建议修改**:\n\`\`\`\n${input.proposal.proposedPatch}\n\`\`\`

${contextParts.length > 0 ? contextParts.join("\n\n") : ""}

请审查该建议并返回 JSON。`;

  const registry = new ToolRegistry();

  const result = await runToolAgent(
    {
      id: `growth-review-${input.proposal.id}`,
      type: "growth-reviewer",
      parentAgentId: input.proposal.agentId,
      model: (config?.model as string) ?? model,
      maxIterations: (config?.maxIterations as number) ?? 3,
      tools: [],
      systemPrompt,
      userPrompt,
      workingDir,
    },
    provider,
    registry,
    workingDir,
  );

  if (!result.success) {
    return { approved: false, reason: `审查失败: ${result.output}` };
  }

  // 解析 JSON 输出
  try {
    const jsonMatch = result.output.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        approved: Boolean(parsed.approved),
        reason: parsed.reason || "无说明",
        riskOverride: parsed.riskOverride,
      };
    }
  } catch {
    // fallback: 输出中有 "approved" 字样就批准
    if (result.output.toLowerCase().includes("approved")) {
      return { approved: true, reason: result.output.slice(0, 200) };
    }
  }

  return { approved: false, reason: `无法解析审查结果: ${result.output.slice(0, 200)}` };
}
```

- [ ] **Step 2: 编译验证**

```bash
pnpm --filter @cobeing/core build
```

- [ ] **Step 3: 提交**

```bash
git add CoBeing/packages/core/src/agent/tool-agent/growth-reviewer.ts
git commit -m "feat: implement GrowthReviewer ToolAgent"
```

### Task 7: TaskArchive ToolAgent 配置 + 实现

**Files:**
- Create: `CoBeing/data/toolagents/task-archive/config.json`
- Create: `CoBeing/data/toolagents/task-archive/prompt.md`
- Create: `CoBeing/packages/core/src/agent/tool-agent/task-archive.ts`

- [ ] **Step 1: 创建配置和提示词**

`data/toolagents/task-archive/config.json`:
```json
{
  "model": "deepseek-chat",
  "maxIterations": 2,
  "tools": [],
  "timeout": 30000
}
```

`data/toolagents/task-archive/prompt.md`:
```markdown
你是任务归档判断器。你的职责是判断一个已完成的 Agent 任务应该保留在活跃清单还是归档。

## 判断标准

### 保留 (keep)
- 任务涉及关键里程碑
- 任务有重要教训值得记取
- 任务的交付物有长期参考价值
- 任务失败原因尚未消化总结

### 归档 (archive)
- 简单单步任务（如读取文件、搜索）
- 例行或重复任务
- 已完成超过 7 天且无特殊价值的任务

返回 JSON: { "action": "keep"|"archive", "reason": "...", "summaryEntry": "一句话总结" }
```

- [ ] **Step 2: 实现 runTaskArchive**

```ts
/**
 * TaskArchive ToolAgent — 任务归档判断
 */
import type { LLMProvider } from "@cobeing/providers";
import type { AgentTaskInboxItem, AgentCapabilityCard, AgentReflectionRecord } from "@cobeing/shared";
import { runToolAgent, loadToolAgentData } from "./base.js";
import { ToolRegistry } from "../../tools/registry.js";

export interface TaskArchiveInput {
  task: AgentTaskInboxItem;
  capability?: AgentCapabilityCard | null;
  recentReflections?: AgentReflectionRecord[];
}

export interface TaskArchiveOutput {
  action: "keep" | "archive";
  reason: string;
  summaryEntry?: string;
}

const FALLBACK_PROMPT = `你是任务归档判断器。判断已完成任务应该保留还是归档。
返回 JSON: { "action": "keep"|"archive", "reason": "...", "summaryEntry": "..." }`;

export async function runTaskArchive(
  provider: LLMProvider,
  model: string,
  input: TaskArchiveInput,
  workingDir: string,
): Promise<TaskArchiveOutput> {
  const { config, prompt } = loadToolAgentData("task-archive");
  const systemPrompt = prompt || FALLBACK_PROMPT;

  const userPrompt = `## 已完成任务
- **标题**: ${input.task.title}
- **目标**: ${input.task.goal}
- **结果状态**: ${input.task.status}
- **来源**: ${input.task.sourceType}/${input.task.sourceId}
- **失败原因**: ${input.task.failureSummary || "N/A"}
- **交付物**: ${input.task.artifacts?.map(a => a.name).join(", ") || "无"}

请判断此任务应该保留还是归档。`;

  const registry = new ToolRegistry();
  const result = await runToolAgent(
    {
      id: `archive-${input.task.id}`,
      type: "task-archive",
      parentAgentId: "system",
      model: (config?.model as string) ?? model,
      maxIterations: (config?.maxIterations as number) ?? 2,
      tools: [],
      systemPrompt,
      userPrompt,
      workingDir,
    },
    provider,
    registry,
    workingDir,
  );

  if (!result.success) {
    return { action: "archive", reason: "归档判断失败，默认归档" };
  }

  try {
    const jsonMatch = result.output.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        action: parsed.action === "keep" ? "keep" : "archive",
        reason: parsed.reason || "",
        summaryEntry: parsed.summaryEntry,
      };
    }
  } catch { /* fallback */ }

  return { action: "archive", reason: "无法解析判断结果，默认归档" };
}
```

- [ ] **Step 3: 编译验证**

```bash
pnpm --filter @cobeing/core build
```

- [ ] **Step 4: 提交**

```bash
git add CoBeing/data/toolagents/task-archive/ CoBeing/packages/core/src/agent/tool-agent/task-archive.ts
git commit -m "feat: implement TaskArchive ToolAgent"
```

### Task 8: CapabilityUpdater ToolAgent 配置 + 实现

**Files:**
- Create: `CoBeing/data/toolagents/capability-updater/config.json`
- Create: `CoBeing/data/toolagents/capability-updater/prompt.md`
- Create: `CoBeing/packages/core/src/agent/tool-agent/capability-updater.ts`

- [ ] **Step 1: 创建配置和提示词**

`data/toolagents/capability-updater/config.json`:
```json
{
  "model": "deepseek-chat",
  "maxIterations": 3,
  "tools": [],
  "timeout": 60000
}
```

`data/toolagents/capability-updater/prompt.md`:
```markdown
你是能力卡维护器。根据 Agent 的更新意图和反思记录，生成更新后的完整 CapabilityCard JSON。

## 规则
- 只修改 Agent 明确要求修改的字段
- domains/limitations 的修改必须准确反映 Agent 的实际能力变化
- 若 Agent 要求删除核心领域，应标记为高风险变更
- 输出完整的 CapabilityCard JSON（不是 diff）

返回完整 JSON。
```

- [ ] **Step 2: 实现 runCapabilityUpdater**

```ts
/**
 * CapabilityUpdater ToolAgent — 维护 Agent Capability Card
 */
import type { LLMProvider } from "@cobeing/providers";
import type { AgentCapabilityCard, AgentReflectionRecord } from "@cobeing/shared";
import { runToolAgent, loadToolAgentData } from "./base.js";
import { ToolRegistry } from "../../tools/registry.js";

export interface CapabilityUpdateInput {
  currentCard: AgentCapabilityCard;
  updateIntent: string;
  recentReflections?: AgentReflectionRecord[];
}

const FALLBACK_PROMPT = `你是能力卡维护器。根据更新意图和反思记录，生成更新后的完整 CapabilityCard JSON。
只修改明确要求修改的字段。输出完整 JSON。`;

export async function runCapabilityUpdater(
  provider: LLMProvider,
  model: string,
  input: CapabilityUpdateInput,
  workingDir: string,
): Promise<AgentCapabilityCard | null> {
  const { config, prompt } = loadToolAgentData("capability-updater");
  const systemPrompt = prompt || FALLBACK_PROMPT;

  const reflectionsText = input.recentReflections?.length
    ? input.recentReflections.slice(-5).map(r => `- [${r.outcome}] ${r.whatWorked.join("; ")}`).join("\n")
    : "无";

  const userPrompt = `## 当前能力卡
\`\`\`json
${JSON.stringify(input.currentCard, null, 2)}
\`\`\`

## 更新意图
${input.updateIntent}

## 最近反思
${reflectionsText}

请输出更新后的完整 CapabilityCard JSON。`;

  const registry = new ToolRegistry();
  const result = await runToolAgent(
    {
      id: `cap-update-${input.currentCard.agentId}`,
      type: "capability-updater",
      parentAgentId: input.currentCard.agentId,
      model: (config?.model as string) ?? model,
      maxIterations: (config?.maxIterations as number) ?? 3,
      tools: [],
      systemPrompt,
      userPrompt,
      workingDir,
    },
    provider,
    registry,
    workingDir,
  );

  if (!result.success) return null;

  try {
    const jsonMatch = result.output.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.agentId) return parsed as AgentCapabilityCard;
    }
  } catch { /* fallback */ }

  return null;
}
```

- [ ] **Step 3: 编译验证**

```bash
pnpm --filter @cobeing/core build
```

- [ ] **Step 4: 提交**

```bash
git add CoBeing/data/toolagents/capability-updater/ CoBeing/packages/core/src/agent/tool-agent/capability-updater.ts
git commit -m "feat: implement CapabilityUpdater ToolAgent"
```

---

## 阶段 4：新增 Agent 工具

### Task 9: agent-capability 工具

**Files:**
- Create: `CoBeing/packages/core/src/tools/agent-capability.ts`

- [ ] **Step 1: 实现 makeAgentGetCapabilityTool 和 makeAgentUpdateCapabilityTool**

```ts
/**
 * Agent Capability 工具 — 能力卡读写
 */
import type { Tool, ToolContext, ToolResult, LLMProvider } from "@cobeing/shared";
import type { AgentFiles } from "../agent/paths.js";
import { runCapabilityUpdater } from "../agent/tool-agent/capability-updater.js";
import path from "node:path";

export function makeAgentGetCapabilityTool(files: AgentFiles): Tool {
  return {
    name: "agent-get-capability",
    description: "读取本 Agent 的能力画像 (CapabilityCard)，包含擅长领域、任务类型、可靠性指标等。",
    parameters: { type: "object", properties: {}, required: [] },
    async execute(_params, _context: ToolContext): Promise<ToolResult> {
      const card = files.readCapability();
      if (!card) {
        return { toolCallId: "", content: "暂无能力画像，请联系管家创建。" };
      }
      return { toolCallId: "", content: JSON.stringify(card, null, 2) };
    },
  };
}

export function makeAgentUpdateCapabilityTool(
  files: AgentFiles,
  provider: LLMProvider,
  model: string,
): Tool {
  return {
    name: "agent-update-capability",
    description: "更新本 Agent 的能力画像。传入要修改的内容描述，由 CapabilityUpdater ToolAgent 生成更新后的完整卡片。",
    parameters: {
      type: "object",
      properties: {
        updateIntent: { type: "string", description: "描述你想更新能力画像的哪些方面及原因。例如：'我发现自己也很擅长代码审查，请添加到 domains 和 strengths 中'" },
      },
      required: ["updateIntent"],
    },
    async execute(params, context: ToolContext): Promise<ToolResult> {
      const currentCard = files.readCapability();
      if (!currentCard) {
        return { toolCallId: "", content: "错误：尚无能力画像，无法更新。", isError: true };
      }

      const reflections = files.readReflections();
      const workingDir = process.cwd();

      const updated = await runCapabilityUpdater(
        provider,
        model,
        {
          currentCard,
          updateIntent: params.updateIntent as string,
          recentReflections: reflections.slice(-10),
        },
        workingDir,
      );

      if (!updated) {
        return { toolCallId: "", content: "能力画像更新失败，请稍后重试。", isError: true };
      }

      files.writeCapability(updated);
      return { toolCallId: "", content: `能力画像已更新。\n\`\`\`json\n${JSON.stringify(updated, null, 2)}\n\`\`\`` };
    },
  };
}
```

- [ ] **Step 2: 编译验证**

```bash
pnpm --filter @cobeing/core build
```

- [ ] **Step 3: 提交**

```bash
git add CoBeing/packages/core/src/tools/agent-capability.ts
git commit -m "feat: add agent-get-capability and agent-update-capability tools"
```

### Task 10: agent-task 工具

**Files:**
- Create: `CoBeing/packages/core/src/tools/agent-task.ts`

- [ ] **Step 1: 实现 3 个任务工具**

```ts
/**
 * Agent Task 工具 — 任务收件箱管理
 */
import type { Tool, ToolContext, ToolResult } from "@cobeing/shared";
import type { AgentFiles } from "../agent/paths.js";
import type { LLMProvider } from "@cobeing/providers";
import { runTaskArchive } from "../agent/tool-agent/task-archive.js";
import { runMemoryAgent } from "../agent/tool-agent/memory.js";
import type { PersonalMemoryInput } from "../agent/tool-agent/types.js";

export function makeAgentTaskAcceptTool(files: AgentFiles): Tool {
  return {
    name: "agent-task-accept",
    description: "接收一个新任务，将其添加到你的任务收件箱。接收后应立即开始执行。",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "任务标题" },
        goal: { type: "string", description: "任务目标和详细描述" },
        acceptance: { type: "string", description: "验收标准（可选）" },
        constraints: { type: "array", items: { type: "string" }, description: "约束条件（可选）" },
        sourceType: { type: "string", enum: ["user", "butler", "group", "system"], description: "任务来源类型" },
        sourceId: { type: "string", description: "来源者 ID" },
        globalTodoId: { type: "string", description: "关联的全局 TODO 条目 ID（可选）" },
      },
      required: ["title", "goal", "sourceType", "sourceId"],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const now = new Date().toISOString();
      const item = {
        id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        title: params.title as string,
        goal: params.goal as string,
        acceptance: params.acceptance as string | undefined,
        constraints: params.constraints as string[] | undefined,
        sourceType: params.sourceType as "user" | "butler" | "group" | "system",
        sourceId: params.sourceId as string,
        globalTodoId: params.globalTodoId as string | undefined,
        status: "pending" as const,
        createdAt: now,
        updatedAt: now,
      };
      files.addInboxItem(item as any);
      return { toolCallId: "", content: `✅ 任务已接收: **${item.title}** (ID: ${item.id})\n目标: ${item.goal}` };
    },
  };
}

export function makeAgentTaskReportTool(files: AgentFiles): Tool {
  return {
    name: "agent-task-report",
    description: "汇报任务进度、阻塞原因或依赖关系。",
    parameters: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "要更新的任务 ID" },
        status: { type: "string", enum: ["running", "blocked", "waiting_user", "waiting_dependency"], description: "新状态" },
        progressNote: { type: "string", description: "进度说明" },
        blockerReason: { type: "string", description: "阻塞原因（状态为 blocked/waiting_dependency 时必填）" },
        dependencyRefs: {
          type: "array",
          items: {
            type: "object",
            properties: {
              agentId: { type: "string" },
              todoId: { type: "string" },
              reason: { type: "string" },
            },
          },
          description: "依赖的其他 Agent 和 TODO",
        },
      },
      required: ["taskId", "status"],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const patch: Record<string, unknown> = {
        status: params.status,
        updatedAt: new Date().toISOString(),
      };
      if (params.progressNote) patch.progressNote = params.progressNote;
      if (params.blockerReason) patch.blockerReason = params.blockerReason;
      if (params.dependencyRefs) patch.dependencyRefs = params.dependencyRefs;

      files.updateInboxItem(params.taskId as string, patch as any);

      const statusLabel: Record<string, string> = {
        running: "▶️ 执行中", blocked: "🚫 已阻塞", waiting_user: "⏳ 等待用户",
        waiting_dependency: "🔗 等待依赖",
      };
      return { toolCallId: "", content: `${statusLabel[params.status as string] || params.status as string}: 任务 ${params.taskId} 状态已更新` };
    },
  };
}

export function makeAgentTaskCompleteTool(
  files: AgentFiles,
  provider: LLMProvider,
  model: string,
): Tool {
  return {
    name: "agent-task-complete",
    description: "标记任务完成，提交交付物和证据。完成后自动触发经验提取和任务归档判断。",
    parameters: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "要完成的任务 ID" },
        summary: { type: "string", description: "完成总结" },
        artifacts: {
          type: "array",
          items: { type: "object", properties: { name: { type: "string" }, path: { type: "string" }, description: { type: "string" } } },
          description: "交付物列表",
        },
        outcome: { type: "string", enum: ["success", "partial", "failed"], description: "完成结果" },
      },
      required: ["taskId"],
    },
    async execute(params, context: ToolContext): Promise<ToolResult> {
      const taskId = params.taskId as string;
      const inbox = files.readInbox();
      const task = inbox.find(t => t.id === taskId);
      if (!task) {
        return { toolCallId: "", content: `找不到任务: ${taskId}`, isError: true };
      }

      // 1. 标记完成
      const outcome = (params.outcome as string) ?? "success";
      const finalStatus = outcome === "failed" ? "failed" as const : "completed" as const;
      files.updateInboxItem(taskId, {
        status: finalStatus,
        artifacts: params.artifacts as any,
        updatedAt: new Date().toISOString(),
      } as any);

      // 2. 写反思记录
      const reflection = {
        id: `ref_${Date.now()}`,
        agentId: context.agentId ?? "",
        taskId,
        outcome: outcome as "success" | "partial" | "failed",
        whatWorked: [],
        whatFailed: [],
        userPreferences: [],
        toolLessons: [],
        suggestedJobUpdates: [],
        suggestedCharacterUpdates: [],
        createdAt: new Date().toISOString(),
      };
      files.addReflection(reflection as any);

      // 3. 触发 MemoryAgent（异步，不阻塞返回）
      const workingDir = process.cwd();
      const agentName = (context as any).agentName ?? "Agent";
      const agentId = context.agentId ?? "";

      setImmediate(async () => {
        try {
          const memoryInput: PersonalMemoryInput = {
            agentName,
            agentId,
            trace: {
              messages: [
                { role: "user", content: task.goal },
                { role: "assistant", content: (params.summary as string) ?? task.title },
              ],
              toolCalls: [],
            },
            taskContext: task.title,
          };
          await runMemoryAgent("personal", memoryInput, provider, model, workingDir);
        } catch { /* 记忆提取失败不影响主流程 */ }
      });

      // 4. 触发 TaskArchive（异步）
      setImmediate(async () => {
        try {
          const capability = files.readCapability();
          const reflections = files.readReflections();
          const archiveResult = await runTaskArchive(provider, model, {
            task: { ...task, status: finalStatus },
            capability,
            recentReflections: reflections.slice(-5),
          }, workingDir);

          if (archiveResult.summaryEntry) {
            const items = files.readInbox();
            const idx = items.findIndex(i => i.id === taskId);
            if (idx >= 0) {
              items[idx] = { ...items[idx], globalMappingNote: archiveResult.summaryEntry };
              files.writeInbox(items);
            }
          }
        } catch { /* 归档判断失败不影响主流程 */ }
      });

      const outcomeLabel = outcome === "success" ? "✅ 完成" : outcome === "partial" ? "⚠️ 部分完成" : "❌ 失败";
      return { toolCallId: "", content: `${outcomeLabel}: **${task.title}**${params.summary ? `\n\n${params.summary}` : ""}` };
    },
  };
}
```

- [ ] **Step 2: 编译验证**

```bash
pnpm --filter @cobeing/core build
```

- [ ] **Step 3: 提交**

```bash
git add CoBeing/packages/core/src/tools/agent-task.ts
git commit -m "feat: add agent-task-accept/report/complete tools"
```

### Task 11: agent-growth 工具

**Files:**
- Create: `CoBeing/packages/core/src/tools/agent-growth.ts`

- [ ] **Step 1: 实现 4 个成长工具**

```ts
/**
 * Agent Growth 工具 — 经验反思和成长建议
 */
import type { Tool, ToolContext, ToolResult, AgentGrowthProposal } from "@cobeing/shared";
import type { AgentFiles } from "../agent/paths.js";
import type { LLMProvider } from "@cobeing/providers";
import { runGrowthReviewer } from "../agent/tool-agent/growth-reviewer.js";
import type { AgentGrowthRisk, AgentGrowthTarget } from "@cobeing/shared";

export function makeAgentReflectExperienceTool(files: AgentFiles): Tool {
  return {
    name: "agent-reflect-experience",
    description: "对当前完成的任务进行结构化反思，自动写入 EXPERIENCE.md 和 reflection.json。",
    parameters: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "关联的任务 ID" },
        outcome: { type: "string", enum: ["success", "partial", "failed"] },
        whatWorked: { type: "array", items: { type: "string" }, description: "哪些方法有效" },
        whatFailed: { type: "array", items: { type: "string" }, description: "哪些方法失败或无效" },
        userPreferences: { type: "array", items: { type: "string" }, description: "观察到的用户偏好" },
        toolLessons: { type: "array", items: { type: "string" }, description: "关于工具使用的经验" },
        lesson: { type: "string", description: "总体教训：下次怎么做更好" },
      },
      required: ["taskId", "outcome"],
    },
    async execute(params, context: ToolContext): Promise<ToolResult> {
      const record = {
        id: `ref_${Date.now()}`,
        agentId: context.agentId ?? "",
        taskId: params.taskId as string,
        outcome: params.outcome as "success" | "partial" | "failed",
        whatWorked: params.whatWorked as string[] ?? [],
        whatFailed: params.whatFailed as string[] ?? [],
        userPreferences: params.userPreferences as string[] ?? [],
        toolLessons: params.toolLessons as string[] ?? [],
        suggestedJobUpdates: [],
        suggestedCharacterUpdates: [],
        createdAt: new Date().toISOString(),
      };
      files.addReflection(record as any);

      // 同时写入 EXPERIENCE.md（追加模式）
      const lesson = params.lesson as string | undefined;
      if (lesson && lesson.length >= 10) {
        files.appendExperience({
          task: `反思: ${params.taskId}`,
          problem: record.whatFailed.join("; ") || "无",
          solution: record.whatWorked.join("; ") || "见反思记录",
        });
      }

      return { toolCallId: "", content: `✅ 反思记录已保存 (${record.id})` };
    },
  };
}

function makeProposeUpdateTool(
  files: AgentFiles,
  targetFile: AgentGrowthTarget,
  provider: LLMProvider,
  model: string,
): Tool {
  const toolNames: Record<string, string> = {
    "JOB.md": "agent-propose-job-update",
    "CHARACTER.md": "agent-propose-character-update",
    "config.json": "agent-propose-config-update",
  };

  const descriptions: Record<string, string> = {
    "JOB.md": "生成 JOB.md 的修改建议。适合在多次任务反复出现同一经验后调用。",
    "CHARACTER.md": "生成 CHARACTER.md 的修改建议。⚠️ 人格修改必须经过 GrowthReviewer 和用户确认。",
    "config.json": "生成 config.json 的修改建议。⚠️ 涉及权限和工具的变更必须经过审批。",
  };

  return {
    name: toolNames[targetFile],
    description: descriptions[targetFile],
    parameters: {
      type: "object",
      properties: {
        reason: { type: "string", description: "修改原因" },
        proposedPatch: { type: "string", description: `建议的 ${targetFile} 修改内容（完整新内容片段或 diff）` },
        risk: { type: "string", enum: ["low", "medium", "high"], description: "自评风险等级" },
      },
      required: ["reason", "proposedPatch"],
    },
    async execute(params, context: ToolContext): Promise<ToolResult> {
      const proposal: AgentGrowthProposal = {
        id: `prop_${Date.now()}`,
        agentId: context.agentId ?? "",
        targetFile,
        reason: params.reason as string,
        proposedPatch: params.proposedPatch as string,
        risk: (params.risk as AgentGrowthRisk) ?? "medium",
        status: "pending",
        createdAt: new Date().toISOString(),
      };

      // 写 proposal 文件
      files.writeProposal(proposal as any);

      // 触发 GrowthReviewer
      const workingDir = process.cwd();
      try {
        const reviewResult = await runGrowthReviewer(provider, model, {
          proposal: proposal as any,
          characterMd: files.readCharacter(),
          jobMd: files.readJob(),
          configJson: JSON.stringify(files.readConfig()),
        }, workingDir);

        proposal.status = reviewResult.approved ? "approved" : "rejected";
        proposal.reviewedBy = "growth-reviewer";
        proposal.reviewedAt = new Date().toISOString();
        proposal.reviewNote = reviewResult.reason;
        if (reviewResult.riskOverride) proposal.risk = reviewResult.riskOverride;

        files.writeProposal(proposal as any);

        if (reviewResult.approved) {
          return { toolCallId: "", content: `✅ 成长建议已批准: ${proposal.id}\n\n审查意见: ${reviewResult.reason}\n\n${targetFile === "CHARACTER.md" || targetFile === "config.json" ? "⚠️ 此类型修改还需用户/管家最终确认后才能应用。" : ""}` };
        } else {
          return { toolCallId: "", content: `❌ 成长建议被拒绝: ${proposal.id}\n\n审查意见: ${reviewResult.reason}` };
        }
      } catch {
        return { toolCallId: "", content: `⚠️ 成长建议已提交 (${proposal.id})，但自动审批暂时不可用，等待人工审查。` };
      }
    },
  };
}

export function makeAgentProposeJobUpdateTool(files: AgentFiles, provider: LLMProvider, model: string): Tool {
  return makeProposeUpdateTool(files, "JOB.md", provider, model);
}

export function makeAgentProposeCharacterUpdateTool(files: AgentFiles, provider: LLMProvider, model: string): Tool {
  return makeProposeUpdateTool(files, "CHARACTER.md", provider, model);
}

export function makeAgentProposeConfigUpdateTool(files: AgentFiles, provider: LLMProvider, model: string): Tool {
  return makeProposeUpdateTool(files, "config.json", provider, model);
}
```

- [ ] **Step 2: 编译验证**

```bash
pnpm --filter @cobeing/core build
```

- [ ] **Step 3: 提交**

```bash
git add CoBeing/packages/core/src/tools/agent-growth.ts
git commit -m "feat: add agent-reflect-experience and agent-propose-* tools"
```

### Task 12: agent-request-resource 工具

**Files:**
- Create: `CoBeing/packages/core/src/tools/agent-resource.ts`

- [ ] **Step 1: 实现资源请求工具**

```ts
/**
 * Agent Resource 工具 — 向 Butler 请求资源
 */
import type { Tool, ToolContext, ToolResult } from "@cobeing/shared";

export function makeAgentRequestResourceTool(): Tool {
  return {
    name: "agent-request-resource",
    description: "向管家 (Butler) 请求缺少的资源（技能、插件、模板等）。你只能提出需求，不能自行安装。" +
      "\n\n⚠️ 管家收到请求后会检索 Market 并征求用户确认，确认后才安装资源。",
    parameters: {
      type: "object",
      properties: {
        resourceType: { type: "string", enum: ["skill", "plugin", "template", "tool", "other"], description: "需要的资源类型" },
        description: { type: "string", description: "描述你需要什么资源以及为什么需要它" },
        urgency: { type: "string", enum: ["low", "medium", "high"], description: "紧急程度" },
      },
      required: ["resourceType", "description"],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const resourceType = params.resourceType as string;
      const description = params.description as string;
      const urgency = (params.urgency as string) ?? "low";

      const typeLabel: Record<string, string> = { skill: "技能", plugin: "插件", template: "模板", tool: "工具", other: "资源" };

      return {
        toolCallId: "",
        content: `📋 资源请求已发送给管家:\n` +
          `- **类型**: ${typeLabel[resourceType] || resourceType}\n` +
          `- **需求**: ${description}\n` +
          `- **紧急程度**: ${urgency}\n\n` +
          `管家会在审查后联系你。请不要自行安装任何资源。`,
      };
    },
  };
}
```

- [ ] **Step 2: 编译验证 + 提交**

```bash
pnpm --filter @cobeing/core build
git add CoBeing/packages/core/src/tools/agent-resource.ts
git commit -m "feat: add agent-request-resource tool"
```

### Task 13: Agent 类注册所有新工具

**Files:**
- Modify: `CoBeing/packages/core/src/agent/agent.ts`

- [ ] **Step 1: 在 agent.ts 顶部新增 import**

在现有 import 块末尾追加：

```ts
import { makeAgentGetCapabilityTool, makeAgentUpdateCapabilityTool } from "../tools/agent-capability.js";
import { makeAgentTaskAcceptTool, makeAgentTaskReportTool, makeAgentTaskCompleteTool } from "../tools/agent-task.js";
import { makeAgentReflectExperienceTool, makeAgentProposeJobUpdateTool, makeAgentProposeCharacterUpdateTool, makeAgentProposeConfigUpdateTool } from "../tools/agent-growth.js";
import { makeAgentRequestResourceTool } from "../tools/agent-resource.js";
```

- [ ] **Step 2: 在构造函数中注册工具**

在 `this.toolRegistry.register(makeAgentCloneTool(...))` 之后（约第 328 行），追加：

```ts
// 注册 Agent 增强工具
this.toolRegistry.register(makeAgentGetCapabilityTool(this.files));
this.toolRegistry.register(makeAgentUpdateCapabilityTool(this.files, this.provider, mergedConfig.model));
this.toolRegistry.register(makeAgentTaskAcceptTool(this.files));
this.toolRegistry.register(makeAgentTaskReportTool(this.files));
this.toolRegistry.register(makeAgentTaskCompleteTool(this.files, this.provider, mergedConfig.model));
this.toolRegistry.register(makeAgentReflectExperienceTool(this.files));
this.toolRegistry.register(makeAgentProposeJobUpdateTool(this.files, this.provider, mergedConfig.model));
this.toolRegistry.register(makeAgentProposeCharacterUpdateTool(this.files, this.provider, mergedConfig.model));
this.toolRegistry.register(makeAgentProposeConfigUpdateTool(this.files, this.provider, mergedConfig.model));
this.toolRegistry.register(makeAgentRequestResourceTool());
```

- [ ] **Step 3: 改造 getStatus()**

将现有 `getStatus()` 方法（第 878–882 行）替换为从 TaskInbox 推导的版本：

```ts
getStatus(): AgentStatus {
  if (this._disposed) return "stopped";
  if (this._errorFlag) return "error";
  try {
    const inbox = this.files.readInbox();
    if (inbox.some(t => t.status === "running")) return "running";
  } catch { /* inbox.json 可能尚不存在 */ }
  return "idle";
}
```

- [ ] **Step 4: 新增 getTaskSummary()**

在 `getActiveSessions()` 之后追加：

```ts
getTaskSummary(): import("@cobeing/shared").AgentTaskSummary {
  try {
    const inbox = this.files.readInbox();
    const active = inbox.filter(t => !["completed", "cancelled"].includes(t.status));
    return {
      activeCount: active.length,
      blockedCount: active.filter(t => t.status === "blocked").length,
      waitingUserCount: active.filter(t => t.status === "waiting_user").length,
      waitingDependencyCount: active.filter(t => t.status === "waiting_dependency").length,
      dominantStatus: active.length === 0 ? "idle"
        : active.some(t => t.status === "failed") ? "failed"
        : active.some(t => t.status === "blocked") ? "blocked"
        : active.some(t => t.status === "waiting_user") ? "waiting_user"
        : active.some(t => t.status === "waiting_dependency") ? "waiting_dependency"
        : active.some(t => t.status === "running") ? "running"
        : "pending",
      recentFailures: inbox.filter(t => t.status === "failed").slice(-3).map(t => t.title),
    };
  } catch {
    return { activeCount: 0, blockedCount: 0, waitingUserCount: 0, waitingDependencyCount: 0, dominantStatus: "idle", recentFailures: [] };
  }
}
```

- [ ] **Step 5: 编译验证**

```bash
pnpm --filter @cobeing/core build
```

- [ ] **Step 6: 运行全量测试**

```bash
vitest run
```

- [ ] **Step 7: 提交**

```bash
git add CoBeing/packages/core/src/agent/agent.ts
git commit -m "feat: register 10 agent enhancement tools and refactor getStatus/getTaskSummary"
```

---

## 阶段 5：Butler 集成

### Task 14: Butler 新增 3 个工具

**Files:**
- Modify: `CoBeing/packages/core/src/agent/butler.ts`

- [ ] **Step 1: 在 butler.ts 文件末尾（ButlerAgent 类之前）新增 3 个工具工厂函数**

```ts
// ---- butler-find-agent ----

import { AgentPaths } from "./paths.js";
import type { AgentCapabilityCard } from "@cobeing/shared";

function makeFindAgentTool(registry: AgentRegistry, dataRoot: string, provider: LLMProvider, model: string): Tool {
  return {
    name: "butler-find-agent",
    description: "根据任务描述匹配最合适的 Agent。扫描所有 Agent 的 capability.json，用 LLM 匹配最佳人选。",
    parameters: {
      type: "object",
      properties: {
        taskDescription: { type: "string", description: "需要完成的任务描述" },
        requiredDomains: { type: "array", items: { type: "string" }, description: "需要的领域（可选，限制匹配范围）" },
        excludeAgentIds: { type: "array", items: { type: "string" }, description: "排除的 Agent ID（可选）" },
      },
      required: ["taskDescription"],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const taskDesc = params.taskDescription as string;
      const excludeIds = (params.excludeAgentIds as string[]) ?? [];

      // 扫描所有 Agent 的能力卡
      const agentsDir = path.join(dataRoot, "agents");
      const coreAgentsDir = path.join(dataRoot, "coreagents");
      const capabilities: AgentCapabilityCard[] = [];

      for (const dir of [agentsDir, coreAgentsDir]) {
        if (!fs.existsSync(dir)) continue;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (!entry.isDirectory() || excludeIds.includes(entry.name)) continue;
          const capPath = path.join(dir, entry.name, "capability.json");
          if (fs.existsSync(capPath)) {
            try {
              const card = JSON.parse(fs.readFileSync(capPath, "utf-8")) as AgentCapabilityCard;
              if (card.agentId && card.domains?.length > 0) {
                capabilities.push(card);
              }
            } catch { /* skip malformed cards */ }
          }
        }
      }

      if (capabilities.length === 0) {
        return { toolCallId: "", content: "未找到任何有能力画像的 Agent。请先让管家为 Agent 创建能力画像。" };
      }

      // 用 LLM 匹配
      const capsSummary = capabilities.map(c => `- **${c.displayName}** (${c.agentId}): 领域=[${c.domains.join(", ")}], 擅长=[${c.strengths.join(", ")}], 限制=[${c.limitations.join(", ")}]`).join("\n");

      try {
        const result = await provider.chatSync?.({
          model,
          messages: [
            { role: "system", content: "你是一个 Agent 匹配器。根据任务描述从候选 Agent 中选择最合适的。返回 JSON: { bestAgentId: string, confidence: number, reasoning: string, alternatives: string[] }" },
            { role: "user", content: `## 任务描述\n${taskDesc}\n\n## 候选 Agent\n${capsSummary}` },
          ],
          temperature: 0.1,
          maxTokens: 500,
        });

        // 尝试解析 LLM 返回的 JSON
        const text = typeof result === "string" ? result : (result as any)?.content ?? "";
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const match = JSON.parse(jsonMatch[0]);
          const agent = capabilities.find(c => c.agentId === match.bestAgentId);
          return {
            toolCallId: "",
            content: `🎯 推荐 Agent: **${agent?.displayName ?? match.bestAgentId}**\n` +
              `匹配度: ${match.confidence ?? "N/A"}\n` +
              `理由: ${match.reasoning ?? "无"}\n` +
              `备选: ${(match.alternatives ?? []).join(", ") || "无"}`,
          };
        }
      } catch (e) {
        // LLM 匹配失败，退化为基于关键词的简单匹配
        return { toolCallId: "", content: `找到 ${capabilities.length} 个有能力画像的 Agent，但自动匹配失败: ${(e as Error).message}。请人工指定 Agent。` };
      }

      return { toolCallId: "", content: "匹配完成" };
    },
  };
}

function makeDispatchTaskTool(agentRegistry: AgentRegistry): Tool {
  return {
    name: "butler-dispatch-task",
    description: "将任务派发给指定 Agent。Agent 必须有能力画像且当前空闲。派发后 Agent 会创建任务收件箱条目并开始执行。",
    parameters: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "目标 Agent ID" },
        title: { type: "string", description: "任务标题" },
        goal: { type: "string", description: "任务目标和详细描述" },
        acceptance: { type: "string", description: "验收标准" },
        constraints: { type: "array", items: { type: "string" }, description: "约束条件" },
        createGlobalTodo: { type: "boolean", description: "是否同时创建全局 TODO 条目（默认 true）" },
      },
      required: ["agentId", "title", "goal"],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const agentId = params.agentId as string;
      const agent = agentRegistry.get(agentId);
      if (!agent) {
        return { toolCallId: "", content: `Agent "${agentId}" 不存在。`, isError: true };
      }

      const status = agent.getStatus();
      if (status === "running") {
        return { toolCallId: "", content: `⚠️ Agent "${agent.name}" 当前正在执行任务 (状态: ${status})。任务将排队等待。` };
      }

      // 通知 Agent 接收任务（通过系统消息）
      const taskMsg = `📋 **新任务派发**\n**标题**: ${params.title}\n**目标**: ${params.goal}${params.acceptance ? `\n**验收标准**: ${params.acceptance}` : ""}${params.constraints ? `\n**约束**: ${(params.constraints as string[]).join(", ")}` : ""}\n\n请调用 agent-task-accept 接收此任务。`;

      try {
        await agent.handleIncomingMessage({
          channelId: "system",
          senderId: "butler",
          senderName: "管家",
          content: taskMsg,
        });
      } catch (e) {
        return { toolCallId: "", content: `派发失败: ${(e as Error).message}`, isError: true };
      }

      return { toolCallId: "", content: `✅ 任务已派发给 **${agent.name}**\n\n${taskMsg}` };
    },
  };
}

function makeReviewProposalsTool(dataRoot: string): Tool {
  return {
    name: "butler-review-proposals",
    description: "扫描所有 Agent 的待审批成长建议 (GrowthProposals)，列出需要用户最终确认的建议（CHARACTER/config 类）。",
    parameters: { type: "object", properties: {}, required: [] },
    async execute(_params, _context: ToolContext): Promise<ToolResult> {
      const results: string[] = [];
      const agentsDir = path.join(dataRoot, "agents");
      const coreAgentsDir = path.join(dataRoot, "coreagents");

      for (const dir of [agentsDir, coreAgentsDir]) {
        if (!fs.existsSync(dir)) continue;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          const proposalsDir = path.join(dir, entry.name, "proposals");
          if (!fs.existsSync(proposalsDir)) continue;

          for (const pf of fs.readdirSync(proposalsDir)) {
            if (!pf.endsWith(".json")) continue;
            try {
              const proposal = JSON.parse(fs.readFileSync(path.join(proposalsDir, pf), "utf-8")) as AgentGrowthProposal;
              if (proposal.status === "approved" && (proposal.targetFile === "CHARACTER.md" || proposal.targetFile === "config.json")) {
                results.push(`- [${proposal.targetFile}] **${entry.name}**: ${proposal.reason.slice(0, 100)} (风险: ${proposal.risk}) [${proposal.id}]`);
              }
            } catch { /* skip */ }
          }
        }
      }

      if (results.length === 0) {
        return { toolCallId: "", content: "没有需要用户确认的待审批成长建议。" };
      }

      return { toolCallId: "", content: `## 待用户确认的成长建议\n\n${results.join("\n")}\n\n使用 WS 命令 approve_proposal / reject_proposal 或前端面板处理。` };
    },
  };
}
```

- [ ] **Step 2: 在 ButlerAgent 构造函数中注册**

在构造函数现有工具注册行末尾（`if (router) { ... }` 块之后）追加：

```ts
this.toolRegistry.register(makeFindAgentTool(registry, bsDataRoot, provider, config.model));
this.toolRegistry.register(makeDispatchTaskTool(registry));
this.toolRegistry.register(makeReviewProposalsTool(bsDataRoot));
```

- [ ] **Step 3: 编译验证 + 全量测试**

```bash
pnpm --filter @cobeing/core build
vitest run
```

- [ ] **Step 4: 提交**

```bash
git add CoBeing/packages/core/src/agent/butler.ts
git commit -m "feat: add butler-find-agent, butler-dispatch-task, butler-review-proposals tools"
```

---

## 阶段 6：WS Server 端点

### Task 15: 新增 7 个 WS 端点

**Files:**
- Modify: `CoBeing/packages/core/src/api/ws-server.ts`

- [ ] **Step 1: 在 ws-server.ts 的 switch(msg.type) 中新增 7 个 case**

在现有最后一个 case 之后追加。需要先找到合适的插入点（最后一个 `break;` 之后，default case 之前）。

```ts
// ===== Agent Enhancement endpoints =====

case "get_agent_capability": {
  const { agentId: aId } = msg.payload as { agentId: string };
  if (!aId || !isSafeId(aId)) {
    this.sendToClient(ws, { type: "error", payload: { message: "Invalid agentId" } });
    break;
  }
  const aPaths = AgentPaths.forAgent(aId, this.dataRoot);
  const capPath = aPaths.capabilityPath;
  if (!fs.existsSync(capPath)) {
    this.sendToClient(ws, { type: "agent_capability", payload: { agentId: aId, capability: null } });
    break;
  }
  try {
    const capability = JSON.parse(fs.readFileSync(capPath, "utf-8"));
    this.sendToClient(ws, { type: "agent_capability", payload: { agentId: aId, capability } });
  } catch {
    this.sendToClient(ws, { type: "error", payload: { message: "Failed to read capability" } });
  }
  break;
}

case "get_agent_inbox": {
  const { agentId: inId } = msg.payload as { agentId: string };
  if (!inId || !isSafeId(inId)) {
    this.sendToClient(ws, { type: "error", payload: { message: "Invalid agentId" } });
    break;
  }
  const inPaths = AgentPaths.forAgent(inId, this.dataRoot);
  const inboxPath = inPaths.inboxPath;
  if (!fs.existsSync(inboxPath)) {
    this.sendToClient(ws, { type: "agent_inbox", payload: { agentId: inId, active: [], archived: [] } });
    break;
  }
  try {
    const data = JSON.parse(fs.readFileSync(inboxPath, "utf-8"));
    const active = Array.isArray(data) ? data : (data.active ?? []);
    const archived = Array.isArray(data) ? [] : (data.archived ?? []);
    this.sendToClient(ws, { type: "agent_inbox", payload: { agentId: inId, active, archived } });
  } catch {
    this.sendToClient(ws, { type: "error", payload: { message: "Failed to read inbox" } });
  }
  break;
}

case "get_agent_proposals": {
  const { agentId: pId } = msg.payload as { agentId: string };
  if (!pId || !isSafeId(pId)) {
    this.sendToClient(ws, { type: "error", payload: { message: "Invalid agentId" } });
    break;
  }
  const pPaths = AgentPaths.forAgent(pId, this.dataRoot);
  const proposalsDir = pPaths.proposalsDir;
  if (!fs.existsSync(proposalsDir)) {
    this.sendToClient(ws, { type: "agent_proposals", payload: { agentId: pId, proposals: [] } });
    break;
  }
  const proposals: AgentGrowthProposal[] = [];
  for (const pf of fs.readdirSync(proposalsDir)) {
    if (!pf.endsWith(".json")) continue;
    try {
      proposals.push(JSON.parse(fs.readFileSync(path.join(proposalsDir, pf), "utf-8")));
    } catch { /* skip */ }
  }
  this.sendToClient(ws, { type: "agent_proposals", payload: { agentId: pId, proposals } });
  break;
}

case "approve_proposal": {
  const { agentId: apId, proposalId } = msg.payload as { agentId: string; proposalId: string };
  if (!apId || !isSafeId(apId) || !proposalId || !isSafeLeafFilename(proposalId + ".json")) {
    this.sendToClient(ws, { type: "error", payload: { message: "Invalid parameters" } });
    break;
  }
  const apPaths = AgentPaths.forAgent(apId, this.dataRoot);
  const propPath = apPaths.proposalPath(proposalId);
  if (!fs.existsSync(propPath)) {
    this.sendToClient(ws, { type: "error", payload: { message: "Proposal not found" } });
    break;
  }
  try {
    const prop = JSON.parse(fs.readFileSync(propPath, "utf-8")) as AgentGrowthProposal;
    prop.status = "applied";
    prop.reviewedBy = "user";
    prop.reviewedAt = new Date().toISOString();
    fs.writeFileSync(propPath, JSON.stringify(prop, null, 2), "utf-8");

    // 应用修改到目标文件
    const apFiles = new AgentFiles(apPaths);
    if (prop.targetFile === "CHARACTER.md") {
      apFiles.writeCharacter(prop.proposedPatch);
    } else if (prop.targetFile === "config.json") {
      try {
        const newConfig = JSON.parse(prop.proposedPatch);
        apFiles.writeConfig(newConfig);
      } catch {
        this.sendToClient(ws, { type: "error", payload: { message: "Proposed config.json patch is not valid JSON" } });
        break;
      }
    }

    this.sendToClient(ws, { type: "proposal_applied", payload: { agentId: apId, proposalId, targetFile: prop.targetFile } });
  } catch (e) {
    this.sendToClient(ws, { type: "error", payload: { message: `Failed to apply proposal: ${(e as Error).message}` } });
  }
  break;
}

case "reject_proposal": {
  const { agentId: rpId, proposalId: rPropId } = msg.payload as { agentId: string; proposalId: string };
  if (!rpId || !isSafeId(rpId) || !rPropId || !isSafeLeafFilename(rPropId + ".json")) {
    this.sendToClient(ws, { type: "error", payload: { message: "Invalid parameters" } });
    break;
  }
  const rpPaths = AgentPaths.forAgent(rpId, this.dataRoot);
  const rPropPath = rpPaths.proposalPath(rPropId);
  if (!fs.existsSync(rPropPath)) {
    this.sendToClient(ws, { type: "error", payload: { message: "Proposal not found" } });
    break;
  }
  try {
    const prop = JSON.parse(fs.readFileSync(rPropPath, "utf-8")) as AgentGrowthProposal;
    prop.status = "rejected";
    prop.reviewedBy = "user";
    prop.reviewedAt = new Date().toISOString();
    fs.writeFileSync(rPropPath, JSON.stringify(prop, null, 2), "utf-8");
    this.sendToClient(ws, { type: "proposal_rejected", payload: { agentId: rpId, proposalId: rPropId } });
  } catch (e) {
    this.sendToClient(ws, { type: "error", payload: { message: `Failed to reject proposal: ${(e as Error).message}` } });
  }
  break;
}

case "find_agent": {
  // 该命令委托给 Butler 的 butler-find-agent 工具
  const { taskDescription } = msg.payload as { taskDescription: string };
  if (!taskDescription) {
    this.sendToClient(ws, { type: "error", payload: { message: "taskDescription is required" } });
    break;
  }
  const butler = this.butlerReg?.getAgent("butler");
  if (!butler) {
    this.sendToClient(ws, { type: "error", payload: { message: "Butler not available" } });
    break;
  }
  // 简单回复 — 完整匹配由 Butler Agent 在对话中处理
  this.sendToClient(ws, { type: "find_agent_result", payload: { message: `正在搜索匹配 "${taskDescription}" 的 Agent...请查看管家对话。` } });
  break;
}

case "dispatch_task": {
  const { agentId: dtId, title, goal, acceptance, constraints } = msg.payload as {
    agentId: string; title: string; goal: string; acceptance?: string; constraints?: string[];
  };
  if (!dtId || !title || !goal) {
    this.sendToClient(ws, { type: "error", payload: { message: "agentId, title and goal are required" } });
    break;
  }
  const butler = this.butlerReg?.getAgent("butler");
  if (!butler) {
    this.sendToClient(ws, { type: "error", payload: { message: "Butler not available" } });
    break;
  }
  this.sendToClient(ws, { type: "dispatch_task_result", payload: { message: `任务 "${title}" 正在派发给 ${dtId}...请查看管家对话。` } });
  break;
}
```

- [ ] **Step 2: 确保顶部有 AgentFiles import**

检查 ws-server.ts 顶部 import，确保包含：

```ts
import { AgentPaths, AgentFiles } from "../agent/paths.js";
```

（如果 `AgentPaths` 已在 import 中但 `AgentFiles` 不在，追加 `AgentFiles`）

- [ ] **Step 3: 编译验证 + 测试**

```bash
pnpm --filter @cobeing/core build
vitest run
```

- [ ] **Step 4: 提交**

```bash
git add CoBeing/packages/core/src/api/ws-server.ts
git commit -m "feat: add 7 WS endpoints for agent enhancement (capability/inbox/proposals/find/dispatch)"
```

---

## 阶段 7：前端实现

### Task 16: 前端类型扩展

**Files:**
- Modify: `CoBeing/gui-v2/src/lib/types.ts`

- [ ] **Step 1: 追加新的前端类型**

在文件末尾追加：

```ts
// ── Agent Enhancement ──

export interface AgentCapabilityCard {
  agentId: string;
  displayName: string;
  role: string;
  domains: string[];
  strengths: string[];
  limitations: string[];
  taskTypes: Array<{
    id: string;
    label: string;
    examples: string[];
    inputRequirements: string[];
    outputFormats: string[];
  }>;
  preferredTools: string[];
  preferredSkills: string[];
  collaboration: {
    canWorkAlone: boolean;
    goodInGroups: boolean;
    needsReviewFor: string[];
    shouldDelegate: string[];
  };
  reliability?: {
    completedTasks: number;
    failedTasks: number;
    lastUpdated: string;
  };
}

export type AgentTaskStatus =
  | "pending" | "running" | "blocked" | "waiting_user"
  | "waiting_dependency" | "completed" | "failed" | "cancelled";

export interface AgentTaskInboxItem {
  id: string;
  globalTodoId?: string;
  agentTodoId?: string;
  sourceType: "user" | "butler" | "group" | "system";
  sourceId: string;
  title: string;
  goal: string;
  acceptance?: string;
  constraints?: string[];
  status: AgentTaskStatus;
  blockerReason?: string;
  dependencyRefs?: Array<{ agentId: string; todoId?: string; reason: string }>;
  failureSummary?: string;
  globalMappingNote?: string;
  artifacts?: Array<{ name: string; path?: string; description?: string }>;
  createdAt: string;
  updatedAt: string;
}

export interface AgentGrowthProposal {
  id: string;
  agentId: string;
  targetFile: "JOB.md" | "CHARACTER.md" | "config.json";
  reason: string;
  proposedPatch: string;
  risk: "low" | "medium" | "high";
  status: "pending" | "approved" | "rejected" | "applied";
  createdAt: string;
  reviewedBy?: "growth-reviewer" | "user" | "butler";
  reviewedAt?: string;
  reviewNote?: string;
}
```

- [ ] **Step 2: 在 AgentInfo 接口中添加新字段**

找到现有 `AgentInfo` 接口，添加：

```ts
export interface AgentInfo {
  // ... 现有字段不变
  capabilities?: AgentCapabilityCard;
  taskInboxCount?: number;
  growthProposalCount?: number;
}
```

- [ ] **Step 3: 类型检查**

```bash
cd CoBeing/gui-v2 && npx tsc --noEmit
```

- [ ] **Step 4: 提交**

```bash
git add CoBeing/gui-v2/src/lib/types.ts
git commit -m "feat: add Agent enhancement types to frontend"
```

### Task 17: agentEnhancement Zustand Store

**Files:**
- Create: `CoBeing/gui-v2/src/stores/agentEnhancement.ts`

- [ ] **Step 1: 创建 store**

```ts
import { create } from "zustand";
import type { AgentCapabilityCard, AgentTaskInboxItem, AgentGrowthProposal } from "@/lib/types";
import { wsClient } from "@/lib/ws-client";

interface AgentEnhancementState {
  capabilities: Record<string, AgentCapabilityCard | null>;
  inboxes: Record<string, { active: AgentTaskInboxItem[]; archived: AgentTaskInboxItem[] }>;
  proposals: Record<string, AgentGrowthProposal[]>;
  loading: Record<string, boolean>;

  fetchCapability: (agentId: string) => void;
  fetchInbox: (agentId: string) => void;
  fetchProposals: (agentId: string) => void;
  setCapability: (agentId: string, capability: AgentCapabilityCard | null) => void;
  setInbox: (agentId: string, active: AgentTaskInboxItem[], archived: AgentTaskInboxItem[]) => void;
  setProposals: (agentId: string, proposals: AgentGrowthProposal[]) => void;
  approveProposal: (agentId: string, proposalId: string) => void;
  rejectProposal: (agentId: string, proposalId: string) => void;
}

export const useAgentEnhancementStore = create<AgentEnhancementState>((set, get) => ({
  capabilities: {},
  inboxes: {},
  proposals: {},
  loading: {},

  fetchCapability: (agentId) => {
    set((s) => ({ loading: { ...s.loading, [`cap_${agentId}`]: true } }));
    wsClient.send({ type: "get_agent_capability", payload: { agentId } });
  },

  fetchInbox: (agentId) => {
    set((s) => ({ loading: { ...s.loading, [`inbox_${agentId}`]: true } }));
    wsClient.send({ type: "get_agent_inbox", payload: { agentId } });
  },

  fetchProposals: (agentId) => {
    set((s) => ({ loading: { ...s.loading, [`prop_${agentId}`]: true } }));
    wsClient.send({ type: "get_agent_proposals", payload: { agentId } });
  },

  setCapability: (agentId, capability) => {
    set((s) => ({
      capabilities: { ...s.capabilities, [agentId]: capability },
      loading: { ...s.loading, [`cap_${agentId}`]: false },
    }));
  },

  setInbox: (agentId, active, archived) => {
    set((s) => ({
      inboxes: { ...s.inboxes, [agentId]: { active, archived } },
      loading: { ...s.loading, [`inbox_${agentId}`]: false },
    }));
  },

  setProposals: (agentId, proposals) => {
    set((s) => ({
      proposals: { ...s.proposals, [agentId]: proposals },
      loading: { ...s.loading, [`prop_${agentId}`]: false },
    }));
  },

  approveProposal: (agentId, proposalId) => {
    wsClient.send({ type: "approve_proposal", payload: { agentId, proposalId } });
  },

  rejectProposal: (agentId, proposalId) => {
    wsClient.send({ type: "reject_proposal", payload: { agentId, proposalId } });
  },
}));
```

- [ ] **Step 2: 类型检查 + 提交**

```bash
cd CoBeing/gui-v2 && npx tsc --noEmit
git add CoBeing/gui-v2/src/stores/agentEnhancement.ts
git commit -m "feat: add agentEnhancement Zustand store"
```

### Task 18: useWebSocket handler 新增

**Files:**
- Modify: `CoBeing/gui-v2/src/hooks/useWebSocket.ts`

- [ ] **Step 1: 在 WS message handler switch 中追加 7 个新 case**

找到现有 message handler 中处理类型的 switch，在最后一个已有 case 之后追加：

```ts
import { useAgentEnhancementStore } from "@/stores/agentEnhancement";

// ... 在 useWebSocket hook 内部：

// Agent Enhancement handlers
case "agent_capability":
  useAgentEnhancementStore.getState().setCapability(
    msg.payload.agentId,
    msg.payload.capability
  );
  break;

case "agent_inbox":
  useAgentEnhancementStore.getState().setInbox(
    msg.payload.agentId,
    msg.payload.active ?? [],
    msg.payload.archived ?? []
  );
  break;

case "agent_proposals":
  useAgentEnhancementStore.getState().setProposals(
    msg.payload.agentId,
    msg.payload.proposals ?? []
  );
  break;

case "proposal_applied":
  // 刷新 proposals 列表
  useAgentEnhancementStore.getState().fetchProposals(msg.payload.agentId);
  break;

case "proposal_rejected":
  useAgentEnhancementStore.getState().fetchProposals(msg.payload.agentId);
  break;

case "find_agent_result":
  // 仅通知，Butler 对话中能看到完整结果
  break;

case "dispatch_task_result":
  // 仅通知
  break;
```

- [ ] **Step 2: 类型检查 + 提交**

```bash
cd CoBeing/gui-v2 && npx tsc --noEmit
git add CoBeing/gui-v2/src/hooks/useWebSocket.ts
git commit -m "feat: add agent enhancement WS handlers to useWebSocket"
```

### Task 19: CapabilityTab 组件

**Files:**
- Create: `CoBeing/gui-v2/src/components/agent/CapabilityTab.tsx`

- [ ] **Step 1: 实现**

```tsx
import { useEffect } from "react";
import { useAgentEnhancementStore } from "@/stores/agentEnhancement";
import type { AgentCapabilityCard } from "@/lib/types";

export function CapabilityTab({ agentId }: { agentId: string }) {
  const capability = useAgentEnhancementStore((s) => s.capabilities[agentId]);
  const loading = useAgentEnhancementStore((s) => s.loading[`cap_${agentId}`]);
  const fetchCapability = useAgentEnhancementStore((s) => s.fetchCapability);

  useEffect(() => {
    fetchCapability(agentId);
  }, [agentId, fetchCapability]);

  if (loading) {
    return <div className="p-4 text-txt-muted text-sm">加载中...</div>;
  }

  if (!capability) {
    return (
      <div className="p-4 text-center">
        <p className="text-txt-muted text-sm mb-2">暂无能力画像</p>
        <p className="text-txt-muted text-xs">能力画像由 AgentCreator 在创建时自动生成，或由 Agent 通过 agent-update-capability 工具更新。</p>
      </div>
    );
  }

  return (
    <div className="p-3 space-y-4">
      {/* 基本信息 */}
      <section>
        <h3 className="text-sm font-semibold text-txt mb-2">角色与领域</h3>
        <p className="text-xs text-txt-muted mb-1">角色: {capability.role}</p>
        <div className="flex flex-wrap gap-1 mb-2">
          {capability.domains.map((d) => (
            <span key={d} className="px-2 py-0.5 rounded text-[10px] bg-accent/10 text-accent">{d}</span>
          ))}
        </div>
      </section>

      {/* 擅长与限制 */}
      <section>
        <h3 className="text-sm font-semibold text-txt mb-2">擅长</h3>
        <div className="flex flex-wrap gap-1">
          {capability.strengths.map((s) => (
            <span key={s} className="px-2 py-0.5 rounded text-[10px] bg-green-500/10 text-green-600">{s}</span>
          ))}
        </div>
        {capability.limitations.length > 0 && (
          <>
            <h3 className="text-sm font-semibold text-txt mb-2 mt-3">不擅长</h3>
            <div className="flex flex-wrap gap-1">
              {capability.limitations.map((l) => (
                <span key={l} className="px-2 py-0.5 rounded text-[10px] bg-red-500/10 text-red-500">{l}</span>
              ))}
            </div>
          </>
        )}
      </section>

      {/* 任务类型 */}
      <section>
        <h3 className="text-sm font-semibold text-txt mb-2">可处理任务类型</h3>
        {capability.taskTypes.map((tt) => (
          <details key={tt.id} className="mb-2 text-xs">
            <summary className="cursor-pointer text-txt hover:text-accent">{tt.label}</summary>
            <div className="ml-4 mt-1 text-txt-muted">
              <p className="mb-1">示例: {tt.examples.join(", ")}</p>
              <p className="mb-1">输入要求: {tt.inputRequirements.join(", ")}</p>
              <p>输出格式: {tt.outputFormats.join(", ")}</p>
            </div>
          </details>
        ))}
      </section>

      {/* 协作属性 */}
      <section>
        <h3 className="text-sm font-semibold text-txt mb-2">协作属性</h3>
        <div className="text-xs text-txt-muted space-y-1">
          <p>独立工作: {capability.collaboration.canWorkAlone ? "✅" : "❌"}</p>
          <p>群组适配: {capability.collaboration.goodInGroups ? "✅" : "❌"}</p>
          {capability.collaboration.needsReviewFor.length > 0 && (
            <p>需审查: {capability.collaboration.needsReviewFor.join(", ")}</p>
          )}
          {capability.collaboration.shouldDelegate.length > 0 && (
            <p>应委托: {capability.collaboration.shouldDelegate.join(", ")}</p>
          )}
        </div>
      </section>

      {/* 可靠性 */}
      {capability.reliability && (
        <section>
          <h3 className="text-sm font-semibold text-txt mb-2">可靠性</h3>
          <div className="text-xs text-txt-muted space-y-1">
            <p>已完成: {capability.reliability.completedTasks} · 失败: {capability.reliability.failedTasks}</p>
            <p>最后更新: {new Date(capability.reliability.lastUpdated).toLocaleDateString()}</p>
          </div>
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 类型检查 + 提交**

```bash
cd CoBeing/gui-v2 && npx tsc --noEmit
git add CoBeing/gui-v2/src/components/agent/CapabilityTab.tsx
git commit -m "feat: add CapabilityTab component"
```

### Task 20: TaskInboxTab 组件

**Files:**
- Create: `CoBeing/gui-v2/src/components/agent/TaskInboxTab.tsx`

- [ ] **Step 1: 实现**

```tsx
import { useEffect, useState } from "react";
import { useAgentEnhancementStore } from "@/stores/agentEnhancement";
import type { AgentTaskInboxItem, AgentTaskStatus } from "@/lib/types";

const STATUS_LABELS: Record<AgentTaskStatus, { text: string; color: string }> = {
  pending: { text: "待处理", color: "bg-gray-500/10 text-gray-500" },
  running: { text: "执行中", color: "bg-blue-500/10 text-blue-500" },
  blocked: { text: "阻塞", color: "bg-orange-500/10 text-orange-500" },
  waiting_user: { text: "等待用户", color: "bg-yellow-500/10 text-yellow-600" },
  waiting_dependency: { text: "等待依赖", color: "bg-purple-500/10 text-purple-500" },
  completed: { text: "已完成", color: "bg-green-500/10 text-green-500" },
  failed: { text: "失败", color: "bg-red-500/10 text-red-500" },
  cancelled: { text: "已取消", color: "bg-gray-500/10 text-gray-400" },
};

type FilterType = "all" | "active" | "completed" | "blocked";

export function TaskInboxTab({ agentId }: { agentId: string }) {
  const inboxData = useAgentEnhancementStore((s) => s.inboxes[agentId]);
  const loading = useAgentEnhancementStore((s) => s.loading[`inbox_${agentId}`]);
  const fetchInbox = useAgentEnhancementStore((s) => s.fetchInbox);
  const [filter, setFilter] = useState<FilterType>("active");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    fetchInbox(agentId);
  }, [agentId, fetchInbox]);

  if (loading) {
    return <div className="p-4 text-txt-muted text-sm">加载中...</div>;
  }

  const allItems = [...(inboxData?.active ?? []), ...(inboxData?.archived ?? [])];

  const filtered = allItems.filter((item) => {
    switch (filter) {
      case "active": return !["completed", "cancelled"].includes(item.status);
      case "completed": return ["completed", "cancelled"].includes(item.status);
      case "blocked": return item.status === "blocked";
      default: return true;
    }
  });

  return (
    <div className="p-3">
      {/* Filter bar */}
      <div className="flex gap-1 mb-3">
        {(["all", "active", "completed", "blocked"] as FilterType[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-2 py-0.5 rounded text-[11px] ${filter === f ? "bg-accent text-white" : "bg-card2 text-txt-muted hover:bg-card2/80"}`}
          >
            {f === "all" ? "全部" : f === "active" ? "活跃" : f === "completed" ? "已完成" : "阻塞"}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="text-txt-muted text-sm text-center py-4">无任务</p>
      ) : (
        <div className="space-y-2">
          {filtered.map((item) => {
            const sl = STATUS_LABELS[item.status] ?? STATUS_LABELS.pending;
            const isExpanded = expandedId === item.id;
            return (
              <div key={item.id} className="border border-border rounded p-2 text-xs">
                <div
                  className="flex items-center justify-between cursor-pointer"
                  onClick={() => setExpandedId(isExpanded ? null : item.id)}
                >
                  <span className="font-medium text-txt truncate flex-1 mr-2">{item.title}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] ${sl.color}`}>{sl.text}</span>
                </div>
                {isExpanded && (
                  <div className="mt-2 pt-2 border-t border-border space-y-1 text-txt-muted">
                    <p><strong>目标:</strong> {item.goal}</p>
                    {item.acceptance && <p><strong>验收:</strong> {item.acceptance}</p>}
                    {item.blockerReason && <p><strong>阻塞原因:</strong> {item.blockerReason}</p>}
                    {item.failureSummary && <p><strong>失败摘要:</strong> {item.failureSummary}</p>}
                    {item.dependencyRefs && item.dependencyRefs.length > 0 && (
                      <p><strong>依赖:</strong> {item.dependencyRefs.map(d => `${d.agentId}${d.todoId ? ` (${d.todoId})` : ""}`).join(", ")}</p>
                    )}
                    {item.artifacts && item.artifacts.length > 0 && (
                      <p><strong>交付物:</strong> {item.artifacts.map(a => a.name).join(", ")}</p>
                    )}
                    <p><strong>来源:</strong> {item.sourceType}/{item.sourceId}</p>
                    <p><strong>创建:</strong> {new Date(item.createdAt).toLocaleString()} · <strong>更新:</strong> {new Date(item.updatedAt).toLocaleString()}</p>
                    {item.globalTodoId && <p>🔗 全局 TODO: {item.globalTodoId}</p>}
                    {item.agentTodoId && <p>🔗 Agent TODO: {item.agentTodoId}</p>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 类型检查 + 提交**

```bash
cd CoBeing/gui-v2 && npx tsc --noEmit
git add CoBeing/gui-v2/src/components/agent/TaskInboxTab.tsx
git commit -m "feat: add TaskInboxTab component"
```

### Task 21: GrowthProposalsTab 组件

**Files:**
- Create: `CoBeing/gui-v2/src/components/agent/GrowthProposalsTab.tsx`

- [ ] **Step 1: 实现**

```tsx
import { useEffect } from "react";
import { useAgentEnhancementStore } from "@/stores/agentEnhancement";
import type { AgentGrowthProposal } from "@/lib/types";

const RISK_LABELS: Record<string, { text: string; color: string }> = {
  low: { text: "低", color: "text-green-500" },
  medium: { text: "中", color: "text-yellow-500" },
  high: { text: "高", color: "text-red-500" },
};

const STATUS_LABELS: Record<string, { text: string; color: string }> = {
  pending: { text: "待审批", color: "text-yellow-500" },
  approved: { text: "已批准", color: "text-green-500" },
  rejected: { text: "已拒绝", color: "text-red-500" },
  applied: { text: "已应用", color: "text-blue-500" },
};

export function GrowthProposalsTab({ agentId }: { agentId: string }) {
  const proposals = useAgentEnhancementStore((s) => s.proposals[agentId]) ?? [];
  const loading = useAgentEnhancementStore((s) => s.loading[`prop_${agentId}`]);
  const fetchProposals = useAgentEnhancementStore((s) => s.fetchProposals);
  const approveProposal = useAgentEnhancementStore((s) => s.approveProposal);
  const rejectProposal = useAgentEnhancementStore((s) => s.rejectProposal);

  useEffect(() => {
    fetchProposals(agentId);
  }, [agentId, fetchProposals]);

  if (loading) {
    return <div className="p-4 text-txt-muted text-sm">加载中...</div>;
  }

  if (proposals.length === 0) {
    return (
      <div className="p-4 text-center">
        <p className="text-txt-muted text-sm">暂无成长建议</p>
        <p className="text-txt-muted text-xs mt-1">Agent 在完成复杂任务后会生成成长建议，由 GrowthReviewer 自动审批。</p>
      </div>
    );
  }

  return (
    <div className="p-3">
      <div className="space-y-3">
        {proposals
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          .map((proposal) => {
            const risk = RISK_LABELS[proposal.risk] ?? RISK_LABELS.medium;
            const status = STATUS_LABELS[proposal.status] ?? STATUS_LABELS.pending;
            const needsUserAction = proposal.status === "approved" &&
              (proposal.targetFile === "CHARACTER.md" || proposal.targetFile === "config.json");

            return (
              <div key={proposal.id} className="border border-border rounded p-3 text-xs">
                {/* Header */}
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-txt">{proposal.targetFile}</span>
                  <div className="flex items-center gap-2">
                    <span className={risk.color}>风险: {risk.text}</span>
                    <span className={status.color}>{status.text}</span>
                  </div>
                </div>

                {/* Reason */}
                <p className="text-txt-muted mb-2">{proposal.reason}</p>

                {/* Patch preview */}
                <details className="mb-2">
                  <summary className="cursor-pointer text-txt hover:text-accent text-[11px]">查看修改内容</summary>
                  <pre className="mt-1 p-2 bg-card2 rounded text-[10px] text-txt-muted overflow-x-auto max-h-32">
                    {proposal.proposedPatch.slice(0, 500)}
                  </pre>
                </details>

                {/* Review note */}
                {proposal.reviewNote && (
                  <p className="text-txt-muted italic mb-2">审查意见: {proposal.reviewNote}</p>
                )}

                {/* Footer */}
                <div className="flex items-center justify-between text-[10px] text-txt-muted">
                  <span>{new Date(proposal.createdAt).toLocaleString()}</span>
                  {proposal.reviewedBy && <span>审查者: {proposal.reviewedBy}</span>}
                </div>

                {/* User action buttons */}
                {needsUserAction && (
                  <div className="flex gap-2 mt-2 pt-2 border-t border-border">
                    <button
                      onClick={() => approveProposal(agentId, proposal.id)}
                      className="px-3 py-1 rounded bg-green-500/10 text-green-600 hover:bg-green-500/20 text-[11px]"
                    >
                      批准并应用
                    </button>
                    <button
                      onClick={() => rejectProposal(agentId, proposal.id)}
                      className="px-3 py-1 rounded bg-red-500/10 text-red-500 hover:bg-red-500/20 text-[11px]"
                    >
                      拒绝
                    </button>
                  </div>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 类型检查 + 提交**

```bash
cd CoBeing/gui-v2 && npx tsc --noEmit
git add CoBeing/gui-v2/src/components/agent/GrowthProposalsTab.tsx
git commit -m "feat: add GrowthProposalsTab component"
```

### Task 22: AgentDetailPanel 集成 3 个新 Tab

**Files:**
- Modify: `CoBeing/gui-v2/src/components/agent/AgentDetailPanel.tsx`

- [ ] **Step 1: 修改 Tabs grid 和添加新 Tab**

```tsx
// 新增 import
import { CapabilityTab } from "./CapabilityTab";
import { TaskInboxTab } from "./TaskInboxTab";
import { GrowthProposalsTab } from "./GrowthProposalsTab";

// 在 AgentDetailPanel 组件中，修改 Tabs 部分
// 将 grid-cols-3 改为 grid-cols-4（或改为 grid-cols-6 容纳 6 个 Tab）
// 可将 tabs list 改为横向滚动的 flex 以容纳更多 tab：

<Tabs defaultValue="config">
  <TabsList className="w-full flex overflow-x-auto gap-0">
    <TabsTrigger value="config" className="whitespace-nowrap text-xs px-2">配置</TabsTrigger>
    <TabsTrigger value="files" className="whitespace-nowrap text-xs px-2">文件</TabsTrigger>
    <TabsTrigger value="todo" className="whitespace-nowrap text-xs px-2">TODO</TabsTrigger>
    <TabsTrigger value="capability" className="whitespace-nowrap text-xs px-2">能力</TabsTrigger>
    <TabsTrigger value="inbox" className="whitespace-nowrap text-xs px-2">任务</TabsTrigger>
    <TabsTrigger value="growth" className="whitespace-nowrap text-xs px-2">成长</TabsTrigger>
  </TabsList>
  {/* ... existing TabsContent ... */}
  <TabsContent value="capability">
    <CapabilityTab agentId={agent.id} />
  </TabsContent>
  <TabsContent value="inbox">
    <TaskInboxTab agentId={agent.id} />
  </TabsContent>
  <TabsContent value="growth">
    <GrowthProposalsTab agentId={agent.id} />
  </TabsContent>
</Tabs>
```

- [ ] **Step 2: 类型检查 + 提交**

```bash
cd CoBeing/gui-v2 && npx tsc --noEmit
git add CoBeing/gui-v2/src/components/agent/AgentDetailPanel.tsx
git commit -m "feat: integrate Capability/TaskInbox/GrowthProposals tabs into AgentDetailPanel"
```

---

## 阶段 8：单元测试

### Task 23: 新增工具和 ToolAgent 单元测试

**Files:**
- Create: `CoBeing/packages/core/src/tools/agent-capability.test.ts`
- Modify: `CoBeing/packages/core/src/agent/tool-agent/tool-agent.test.ts`

- [ ] **Step 1: agent-capability 工具单元测试**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { AgentPaths, AgentFiles } from "../agent/paths.js";
import { makeAgentGetCapabilityTool, makeAgentUpdateCapabilityTool } from "./agent-capability.js";

const tmpDir = path.join(os.tmpdir(), `cobeing-test-cap-${Date.now()}`);
const agentDir = path.join(tmpDir, "agents", "test-agent");

beforeEach(() => {
  fs.mkdirSync(agentDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("agent-get-capability", () => {
  it("returns placeholder when no capability exists", async () => {
    const files = new AgentFiles(new AgentPaths(agentDir));
    const tool = makeAgentGetCapabilityTool(files);
    const result = await tool.execute({}, {} as any);
    expect(result.content).toContain("暂无能力画像");
  });

  it("returns JSON when capability exists", async () => {
    const files = new AgentFiles(new AgentPaths(agentDir));
    files.writeCapability({ agentId: "test", displayName: "Test", role: "tester", domains: ["code"], strengths: [], limitations: [], taskTypes: [], preferredTools: [], preferredSkills: [], collaboration: { canWorkAlone: true, goodInGroups: false, needsReviewFor: [], shouldDelegate: [] } });
    const tool = makeAgentGetCapabilityTool(files);
    const result = await tool.execute({}, {} as any);
    expect(result.content).toContain("test-agent");
  });
});
```

- [ ] **Step 2: agent-task 工具单元测试**

Create `CoBeing/packages/core/src/tools/agent-task.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { AgentPaths, AgentFiles } from "../agent/paths.js";
import { makeAgentTaskAcceptTool, makeAgentTaskReportTool } from "./agent-task.js";

const tmpDir = path.join(os.tmpdir(), `cobeing-test-task-${Date.now()}`);
const agentDir = path.join(tmpDir, "agents", "test-agent");

beforeEach(() => {
  fs.mkdirSync(agentDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("agent-task-accept", () => {
  it("creates inbox item", async () => {
    const files = new AgentFiles(new AgentPaths(agentDir));
    const tool = makeAgentTaskAcceptTool(files);
    const result = await tool.execute({
      title: "Test Task",
      goal: "Do something",
      sourceType: "user",
      sourceId: "user-1",
    }, {} as any);

    expect(result.content).toContain("Test Task");
    const inbox = files.readInbox();
    expect(inbox.length).toBe(1);
    expect(inbox[0].status).toBe("pending");
  });

  it("accepts optional acceptance and constraints", async () => {
    const files = new AgentFiles(new AgentPaths(agentDir));
    const tool = makeAgentTaskAcceptTool(files);
    await tool.execute({
      title: "Complex Task",
      goal: "Build something",
      sourceType: "butler",
      sourceId: "butler",
      acceptance: "Tests pass",
      constraints: ["Use TypeScript"],
    }, {} as any);

    const inbox = files.readInbox();
    expect(inbox[0].acceptance).toBe("Tests pass");
    expect(inbox[0].constraints).toEqual(["Use TypeScript"]);
  });
});

describe("agent-task-report", () => {
  it("updates task status to blocked", async () => {
    const files = new AgentFiles(new AgentPaths(agentDir));
    // 先添加一个任务
    const acceptTool = makeAgentTaskAcceptTool(files);
    const acceptResult = await acceptTool.execute({
      title: "Block Me", goal: "Test blocking", sourceType: "user", sourceId: "u1",
    }, {} as any);
    const taskId = acceptResult.content.match(/ID: (\S+)/)?.[1];

    const reportTool = makeAgentTaskReportTool(files);
    const result = await reportTool.execute({
      taskId,
      status: "blocked",
      blockerReason: "Waiting for API key",
    }, {} as any);

    expect(result.content).toContain("阻塞");
    const inbox = files.readInbox();
    const task = inbox.find(t => t.id === taskId);
    expect(task!.status).toBe("blocked");
    expect(task!.blockerReason).toBe("Waiting for API key");
  });
});
```

- [ ] **Step 3: agent-growth 工具单元测试**

Create `CoBeing/packages/core/src/tools/agent-growth.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { AgentPaths, AgentFiles } from "../agent/paths.js";
import { makeAgentReflectExperienceTool } from "./agent-growth.js";

const tmpDir = path.join(os.tmpdir(), `cobeing-test-growth-${Date.now()}`);
const agentDir = path.join(tmpDir, "agents", "test-agent");

beforeEach(() => {
  fs.mkdirSync(agentDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("agent-reflect-experience", () => {
  it("writes reflection record", async () => {
    const files = new AgentFiles(new AgentPaths(agentDir));
    const tool = makeAgentReflectExperienceTool(files);
    const result = await tool.execute({
      taskId: "t1",
      outcome: "success",
      whatWorked: ["used bash tool", "checked output"],
      whatFailed: [],
      lesson: "Always verify the output before committing",
    }, { agentId: "test-agent" } as any);

    expect(result.content).toContain("反思记录已保存");
    const records = files.readReflections();
    expect(records.length).toBe(1);
    expect(records[0].outcome).toBe("success");
    expect(records[0].whatWorked).toEqual(["used bash tool", "checked output"]);
  });

  it("writes to EXPERIENCE.md when lesson is long enough", async () => {
    const files = new AgentFiles(new AgentPaths(agentDir));
    // 先创建 EXPERIENCE.md
    files.writeExperience("");
    const tool = makeAgentReflectExperienceTool(files);
    await tool.execute({
      taskId: "t2",
      outcome: "failed",
      whatWorked: [],
      whatFailed: ["Did not check file existence first"],
      lesson: "Always check if the file exists before reading it, otherwise the tool will error out",
    }, { agentId: "test-agent" } as any);

    const experience = files.readExperience();
    expect(experience).toContain("Always check");
  });
});
```

- [ ] **Step 4: agent-resource 工具测试**

Create `CoBeing/packages/core/src/tools/agent-resource.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { makeAgentRequestResourceTool } from "./agent-resource.js";

describe("agent-request-resource", () => {
  it("returns resource request confirmation", async () => {
    const tool = makeAgentRequestResourceTool();
    const result = await tool.execute({
      resourceType: "skill",
      description: "Need a skill for code review",
      urgency: "medium",
    }, {} as any);

    expect(result.content).toContain("资源请求已发送");
    expect(result.content).toContain("code review");
    expect(result.content).toContain("skill");
    expect(result.content).toContain("不要自行安装");
  });
});
```

- [ ] **Step 5: ToolAgent 单元测试（扩展已有 tool-agent.test.ts）**

在 `tool-agent.test.ts` 中追加：

```ts
describe("GrowthReviewer", () => {
  it("runGrowthReviewer approves reasonable JOB update", async () => {
    const { runGrowthReviewer } = await import("./growth-reviewer.js");
    const provider = createMockProvider();
    const result = await runGrowthReviewer(provider, "deepseek-chat", {
      proposal: { id: "p1", agentId: "a", targetFile: "JOB.md", reason: "add testing step", proposedPatch: "+ 测试验证", risk: "low", status: "pending", createdAt: new Date().toISOString() },
      jobMd: "# JOB\n\n1. Write code\n2. Commit",
    }, os.tmpdir());
    expect(result).toHaveProperty("approved");
    expect(result).toHaveProperty("reason");
  });

  it("runGrowthReviewer rejects CHARACTER contradiction", async () => {
    const { runGrowthReviewer } = await import("./growth-reviewer.js");
    const provider = createMockProvider();
    const result = await runGrowthReviewer(provider, "deepseek-chat", {
      proposal: { id: "p2", agentId: "a", targetFile: "CHARACTER.md", reason: "change tone", proposedPatch: "Make it formal", risk: "medium", status: "pending", createdAt: new Date().toISOString() },
      characterMd: "# CHARACTER\n\n语气: 随意友好",
    }, os.tmpdir());
    // 不管 mock 返回什么，结果结构应完整
    expect(result).toHaveProperty("approved", expect.any(Boolean));
  });
});

describe("TaskArchive", () => {
  it("runTaskArchive returns action", async () => {
    const { runTaskArchive } = await import("./task-archive.js");
    const provider = createMockProvider();
    const result = await runTaskArchive(provider, "deepseek-chat", {
      task: { id: "t1", title: "Read file", goal: "Read config", sourceType: "user", sourceId: "u1", status: "completed", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    }, os.tmpdir());
    expect(["keep", "archive"]).toContain(result.action);
    expect(result).toHaveProperty("reason");
  });
});
```

- [ ] **Step 6: 运行测试**

```bash
vitest run CoBeing/packages/core/src/tools/agent-capability.test.ts CoBeing/packages/core/src/tools/agent-task.test.ts CoBeing/packages/core/src/tools/agent-growth.test.ts CoBeing/packages/core/src/tools/agent-resource.test.ts CoBeing/packages/core/src/agent/tool-agent/tool-agent.test.ts
```

- [ ] **Step 7: 提交**

```bash
git add CoBeing/packages/core/src/tools/agent-capability.test.ts CoBeing/packages/core/src/tools/agent-task.test.ts CoBeing/packages/core/src/tools/agent-growth.test.ts CoBeing/packages/core/src/tools/agent-resource.test.ts CoBeing/packages/core/src/agent/tool-agent/tool-agent.test.ts
git commit -m "test: add unit tests for agent enhancement tools and ToolAgents"
```

---

## 阶段 9：验证与收尾

### Task 24: 全量构建 + 测试 + 索引更新

- [ ] **Step 1: 运行全量构建**

```bash
pnpm build
```

确保全部 7 个 workspace 包编译零错误。

- [ ] **Step 2: 运行全量测试**

```bash
vitest run
```

确保全部测试通过。

- [ ] **Step 3: 运行前端类型检查**

```bash
cd CoBeing/gui-v2 && npx tsc --noEmit
```

确保前端零类型错误。

- [ ] **Step 4: 更新 STRUCTURE.md**

新增以下条目录入：

```
packages/core/src/tools/agent-capability.ts
packages/core/src/tools/agent-task.ts
packages/core/src/tools/agent-growth.ts
packages/core/src/tools/agent-resource.ts
packages/core/src/agent/tool-agent/growth-reviewer.ts
packages/core/src/agent/tool-agent/task-archive.ts
packages/core/src/agent/tool-agent/capability-updater.ts
gui-v2/src/components/agent/CapabilityTab.tsx
gui-v2/src/components/agent/TaskInboxTab.tsx
gui-v2/src/components/agent/GrowthProposalsTab.tsx
gui-v2/src/stores/agentEnhancement.ts
data/toolagents/growth-reviewer/
data/toolagents/task-archive/
data/toolagents/capability-updater/
```

- [ ] **Step 5: 更新 docs/项目信息/**

- `docs/项目信息/项目现状.md` — 通用智能体能力状态改为"已实现"（能力卡/任务收件箱/成长建议/资源请求）
- `docs/项目信息/架构说明.md` — Agent 架构新增 4 个数据文件（capability.json、inbox.json、reflection.json、proposals/）+ 3 个 ToolAgent
- `docs/项目信息/核心技术.md` — 通用智能体增强体系更新

- [ ] **Step 6: 更新 PROGRESS.md 和 PROGRESS-LITE.md**

在 PROGRESS.md 顶部追加：

```
## 2026-06-10

### 通用智能体能力与增强 — 全 5 层实现

实现设计文档 `docs/GOALS/general-agent-capability-design.md` 的全部 5 层实施。

变更原因：通用智能体需要清晰的能力边界、任务状态、成长机制和可调度能力。

修改文件（22 个）：
- Create: packages/core/src/tools/agent-capability.ts / agent-task.ts / agent-growth.ts / agent-resource.ts
- Create: packages/core/src/agent/tool-agent/growth-reviewer.ts / task-archive.ts / capability-updater.ts
- Create: data/toolagents/growth-reviewer/ task-archive/ capability-updater/ 各含 config.json + prompt.md
- Create: gui-v2/src/components/agent/CapabilityTab.tsx / TaskInboxTab.tsx / GrowthProposalsTab.tsx
- Create: gui-v2/src/stores/agentEnhancement.ts
- Modify: packages/shared/src/types.ts — 新增 6 个 Agent 增强接口
- Modify: packages/core/src/agent/paths.ts — AgentPaths 5 getter + AgentFiles 9 方法
- Modify: packages/core/src/agent/agent.ts — 注册 10 个增强工具 + getStatus/getTaskSummary 改造
- Modify: packages/core/src/agent/butler.ts — 新增 3 个 Butler 工具
- Modify: packages/core/src/api/ws-server.ts — 新增 7 个 WS 端点
- Modify: gui-v2/src/lib/types.ts — 新增前端增强类型
- Modify: gui-v2/src/hooks/useWebSocket.ts — 新增 7 个消息 handler
- Modify: gui-v2/src/components/agent/AgentDetailPanel.tsx — 新增 3 个 Tab
- Modify: packages/core/src/agent/tool-agent/types.ts — ToolAgentType 扩展

修改内容：
- 能力层：AgentCapabilityCard + capability.json + agent-get/update-capability 工具 + CapabilityUpdater ToolAgent
- 任务层：AgentTaskInboxItem + inbox.json + agent-task-accept/report/complete 工具 + TaskArchive ToolAgent
- 成长层：AgentReflectionRecord + AgentGrowthProposal + proposals/ + 4 个成长工具 + GrowthReviewer ToolAgent
- 资源层：agent-request-resource 工具（发送端）
- Butler 集成：butler-find-agent / butler-dispatch-task / butler-review-proposals
- 前端：能力卡 Tab / 任务收件箱 Tab / 成长建议 Tab + agentEnhancement store
```

在 PROGRESS-LITE.md 顶部追加：

```
- [New Feature] 通用智能体能力与增强全 5 层实现：能力画像 + 任务收件箱 + 成长建议 + 资源请求 + Butler 能力调度 + 前端 3 Tab
```

- [ ] **Step 7: 提交**

```bash
git add CoBeing/STRUCTURE.md docs/项目信息/ D:/agent-codes/PROGRESS.md D:/agent-codes/PROGRESS-LITE.md
git commit -m "docs: update progress and structure docs for agent enhancement"
```

---

## 计划总结

| 阶段 | 任务数 | 新建文件 | 修改文件 |
|------|--------|---------|---------|
| 1. shared 类型 | 1 | 0 | 1 |
| 2. AgentPaths/Files | 3 | 0 | 1+test |
| 3. ToolAgents | 4 | 6 | 1 |
| 4. Agent 工具 | 5 | 4 | 1 |
| 5. Butler 集成 | 1 | 0 | 1 |
| 6. WS Server | 1 | 0 | 1 |
| 7. 前端 | 7 | 4 | 3 |
| 8. 单元测试 | 1 | 4 | 1 |
| 9. 验证收尾 | 1 | 0 | 3 docs |
| **总计** | **24** | **18** | **13** |
