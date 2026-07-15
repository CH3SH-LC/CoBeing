# 通用智能体能力与增强 — 实现规格

> 日期：2026-06-10 | 状态：已确认 | 基于：`docs/GOALS/general-agent-capability-design.md`

## 概述

实现通用智能体 14 项核心能力，分 5 个实施层次：

1. **能力层** — AgentCapabilityCard 和读写接口
2. **任务层** — AgentTaskInbox，与全局 TODOboard / Agent TODO 关联
3. **成长层** — Reflection Loop、Experience 自动写入、GrowthProposal + GrowthReviewer ToolAgent
4. **资源层** — Agent 请求 Skill/Plugin/Market 资源，由 Butler 授权
5. **前端层** — Agent 能力卡、任务收件箱、成长建议审查面板

---

## 第一节：文件结构与持久化

采用方案 A（渐进式 Agent 扩展），新数据文件与现有五文件体系统一存放于 Agent 目录下。

```text
data/agents/<agent-id>/
├── CHARACTER.md          # 已有 — 人格、声音、关系感
├── JOB.md                # 已有 — 专业方法论、工作流程
├── AGENTS.md             # 已有 — 行为准则与自我描述
├── MEMORY.md             # 已有 — 独立会话事件记录索引
├── EXPERIENCE.md         # 已有 — 长期经验、用户偏好、工具心得
├── config.json           # 已有 — 模型/工具/权限/沙箱/技能配置
├── capability.json       # 新增 — AgentCapabilityCard
├── inbox.json            # 新增 — AgentTaskInboxItem[]
├── reflection.json       # 新增 — AgentReflectionRecord[]
├── proposals/            # 新增 — AgentGrowthProposal 目录
│   └── <proposal-id>.json
├── memory/
├── workspace/
├── skills/
└── memory.db
```

### 文件职责与访问控制

| 文件 | 读权限 | 写权限 | 自动写入方 | 手动写入方 |
|------|--------|--------|-----------|-----------|
| `capability.json` | Agent/Butler/Host/前端 | Agent | CapabilityUpdater ToolAgent | Agent 工具 `agent-update-capability` |
| `inbox.json` | Agent/Butler/前端 | Agent | — | Agent 工具 `agent-task-*` |
| `reflection.json` | Agent/前端 | MemoryAgent | `agent-reflect-experience` 工具 | — |
| `proposals/*.json` | Agent/GrowthReviewer/前端 | Agent | — | Agent 工具 `agent-propose-*` |

### 自动修改策略（来自设计文档）

| 文件 | 策略 |
|------|------|
| `EXPERIENCE.md` | 可自动追加 |
| `JOB.md` | 可提出修改建议，经 GrowthReviewer 确认后应用 |
| `CHARACTER.md` | 必须 GrowthReviewer 审批 + 用户/管家确认后才能修改 |
| `config.json` | 涉及权限/模型/工具/技能，必须确认或走管家授权 |

---

## 第二节：数据结构（shared/types.ts 新增类型）

### AgentCapabilityCard

```ts
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
    lastUpdated: string;           // ISO date
  };
}
```

### AgentTaskInboxItem 与状态映射

```ts
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
  globalTodoId?: string;          // 关联全局 TODOboard
  agentTodoId?: string;           // 关联 Agent 个人 TODO
  sourceType: "user" | "butler" | "group" | "system";
  sourceId: string;               // 来源者 ID（butler/host/agent/user）
  title: string;
  goal: string;
  acceptance?: string;
  constraints?: string[];
  status: AgentTaskStatus;
  blockerReason?: string;
  dependencyRefs?: Array<{
    agentId: string;
    todoId?: string;
    reason: string;
  }>;
  failureSummary?: string;
  /** 用于全局 TODOboard 映射时的补充说明 */
  globalMappingNote?: string;
  artifacts?: Array<{
    name: string;
    path?: string;
    description?: string;
  }>;
  createdAt: string;
  updatedAt: string;
}
```

**全局 TODO 状态映射规则**（纯函数）：

```ts
function mapAgentStatusToGlobal(status: AgentTaskStatus): GlobalTodoStatus {
  switch (status) {
    case "blocked":
    case "waiting_dependency":
    case "failed":
      return "running";              // 仍活跃，通过 blockerReason/failureSummary 解释
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

### AgentReflectionRecord

```ts
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
```

### AgentGrowthProposal

```ts
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
```

### AgentConfig 扩展

```ts
export interface AgentConfig {
  // ... 现有字段不变
  capabilities?: AgentCapabilityCard;  // 新增
}
```

### 前端 AgentInfo 扩展

```ts
export interface AgentInfo {
  // ... 现有字段不变
  capabilities?: AgentCapabilityCard;
  taskInboxCount?: number;
  growthProposalCount?: number;
}
```

### AgentTaskSummary（运行时查询）

```ts
export interface AgentTaskSummary {
  activeCount: number;
  blockedCount: number;
  waitingUserCount: number;
  waitingDependencyCount: number;
  dominantStatus: AgentTaskStatus | "idle";
  recentFailures: string[];
}
```

---

## 第三节：AgentPaths / AgentFiles 扩展

### AgentPaths 新增 getter

```ts
get capabilityPath()   { return path.join(this.baseDir, "capability.json"); }
get inboxPath()        { return path.join(this.baseDir, "inbox.json"); }
get reflectionPath()   { return path.join(this.baseDir, "reflection.json"); }
get proposalsDir()     { return path.join(this.baseDir, "proposals"); }
get proposalPath(id: string) { return path.join(this.baseDir, "proposals", `${id}.json`); }
```

`ensureDirs()` 中新增 `fs.mkdirSync(this.proposalsDir, { recursive: true })`。

### AgentFiles 新增方法

```ts
// Capability
readCapability(): AgentCapabilityCard | null
writeCapability(card: AgentCapabilityCard): void

// Inbox
readInbox(): AgentTaskInboxItem[]
writeInbox(items: AgentTaskInboxItem[]): void
addInboxItem(item: AgentTaskInboxItem): void
updateInboxItem(id: string, patch: Partial<AgentTaskInboxItem>): void

// Reflection
readReflections(): AgentReflectionRecord[]
addReflection(record: AgentReflectionRecord): void

// Proposals
listProposals(): AgentGrowthProposal[]
readProposal(id: string): AgentGrowthProposal | null
writeProposal(proposal: AgentGrowthProposal): void
```

### Agent 状态模型改造

**`getStatus()` 保持兼容** — 返回 `AgentStatus`（idle/running/error/stopped），内部从 TaskInbox 推导：

```ts
getStatus(): AgentStatus {
  if (this._disposed) return "stopped";
  if (this._errorFlag) return "error";
  const inbox = this.files.readInbox();
  if (inbox.some(t => t.status === "running")) return "running";
  return "idle";
}
```

**新增 `getTaskSummary()`** — 供 Butler/Host/前端查询：

```ts
getTaskSummary(): AgentTaskSummary {
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
}
```

---

## 第四节：新增 ToolAgent（3 个）

所有新增 ToolAgent 遵循现有范式：无状态、纯函数、独立 LLM 循环（`runToolAgent()`）、按事件触发、用完即毁。配置和提示词存放在 `data/toolagents/<type>/`（`config.json` + `prompt.md`）。

### ToolAgentType 扩展

```ts
export type ToolAgentType = "review" | "judgment" | "clone" | "memory"
  | "growth-reviewer" | "task-archive" | "capability-updater";
```

### 1. GrowthReviewer

| 属性 | 值 |
|------|-----|
| 类型 | `"growth-reviewer"` |
| 触发时机 | Agent 生成 GrowthProposal 后自动触发 |
| 输入 | Proposal JSON + Agent 的 CHARACTER.md / JOB.md / EXPERIENCE.md 全文 |
| 输出 | `{ approved: boolean, reason: string, riskOverride?: AgentGrowthRisk }` |
| 超时 | 60s |
| 审批策略 | JOB 侧重方法合理性；CHARACTER 侧重人格一致性；config 侧重权限安全 |
| 数据目录 | `data/toolagents/growth-reviewer/` |

### 2. TaskArchive

| 属性 | 值 |
|------|-----|
| 类型 | `"task-archive"` |
| 触发时机 | AgentTaskInboxItem 进入 completed/failed/cancelled 后触发 |
| 输入 | 已完成任务条目 + Capability Card + 最近 reflection |
| 输出 | `{ action: "archive" \| "keep", reason: string, summaryEntry?: string }` |
| 超时 | 30s |
| 数据目录 | `data/toolagents/task-archive/` |
| 策略 | 低价值单步任务直接 archive；里程碑/教训类任务保留在 inbox 并写入摘要 |

**TaskArchive 归档语义**：`inbox.json` 维护两个数组 — `active`（当前活跃/最近完成的任务）和 `archived`（历史归档条目）。TaskArchive 决定 "archive" 时，将条目从 `active` 移至 `archived`，保留完整数据用于 Capability Card 可靠性计算。决定 "keep" 时，条目留在 `active`，同时写入摘要行。

### 3. CapabilityUpdater

| 属性 | 值 |
|------|-----|
| 类型 | `"capability-updater"` |
| 触发时机 | Agent 通过 `agent-update-capability` 工具手动调用 |
| 输入 | 当前 Capability Card + 更新意图描述 + 相关 Reflection 记录 |
| 输出 | 更新后的完整 CapabilityCard JSON |
| 超时 | 60s |
| 数据目录 | `data/toolagents/capability-updater/` |
| 约束 | 只改 Agent 指定的字段；domains/limitations 修改需高风险标记；底层写盘仍由 Agent 工具执行 |

### ToolAgent 调用链（嵌入 Agent 生命周期）

```
Agent 完成任务
  → MemoryAgent 提取经验 → 写 EXPERIENCE + reflection.json
  → Agent 判断续作 → 若低风险后续 → 写入 personal TODO
  → Agent 生成 GrowthProposal（如有）→ GrowthReviewer 审批
  → TaskArchive 判断历史条目去留
  → 若跨层/扩权 → 请求 Butler/Host
```

---

## 第五节：新增 Agent 工具

### 工具清单（10 个）

#### 能力管理（2 个）

| 工具名 | 动作 | 调用方 | 说明 |
|--------|------|--------|------|
| `agent-get-capability` | 读 | Agent/Butler/Host | 读取 capability.json 返回完整卡片 |
| `agent-update-capability` | 写 | Agent | 调用 CapabilityUpdater ToolAgent → 写盘 |

#### 任务管理（3 个）

| 工具名 | 动作 | 调用方 | 说明 |
|--------|------|--------|------|
| `agent-task-accept` | 创建 | Agent | 接收任务 → 创建 inbox 条目 + 可选关联 globalTodo |
| `agent-task-report` | 更新 | Agent | 汇报进度/阻塞原因/依赖引用 |
| `agent-task-complete` | 完成 | Agent | 标记 completed + 写 artifacts + 触发 MemoryAgent + TaskArchive |

#### 成长管理（4 个）

| 工具名 | 动作 | 调用方 | 说明 |
|--------|------|--------|------|
| `agent-reflect-experience` | 写 | Agent/MemoryAgent | 结构化反思 → 写 EXPERIENCE.md + reflection.json |
| `agent-propose-job-update` | 提案 | Agent | 生成 JOB.md 修改建议 → 写 proposals/ + 触发 GrowthReviewer |
| `agent-propose-character-update` | 提案 | Agent | 生成 CHARACTER.md 修改建议 → 写 proposals/ + 触发 GrowthReviewer |
| `agent-propose-config-update` | 提案 | Agent | 生成 config.json 修改建议 → 写 proposals/ + 触发 GrowthReviewer |

#### 资源管理（1 个）

| 工具名 | 动作 | 调用方 | 说明 |
|--------|------|--------|------|
| `agent-request-resource` | 请求 | Agent | 向 Butler 说明缺少的技能/插件/模板 → Butler 检索 Market 后授权 |

### Agent 类注册

在 `agent.ts` 构造函数中注册，所有工具默认对所有 Agent 可用（agent-task-* / agent-propose-* 属于 Agent 自身能力的内部控制，不涉及外部系统写入）。

### 权限

- `agent-request-resource` 发往 Butler，由 Butler 权限策略判断
- `agent-propose-config-update` 涉及权限/工具变更，必须由 GrowthReviewer 审批

---

## 第六节：Butler 集成 — 基于能力的调度

### 新增 Butler 工具（3 个）

| 工具名 | 动作 | 说明 |
|--------|------|------|
| `butler-find-agent` | 查询 | 根据任务描述匹配最合适的 Agent（读各 Agent 的 capability.json 做 LLM 匹配） |
| `butler-dispatch-task` | 派发 | 选好 Agent 后，创建全局 TODO → 通知 Agent → Agent 调用 agent-task-accept |
| `butler-review-proposals` | 审查 | 扫描所有 proposals/，列出 GrowthReviewer 已批准的提案供用户最终确认 |

### 能力匹配流程（butler-find-agent）

```
1. Butler 扫描 data/agents/*/capability.json + data/coreagents/*/capability.json
2. 将 [任务描述 + 所有能力卡摘要] 输入 LLM
3. LLM 返回 { bestAgentId, confidence, reasoning, alternatives[] }
4. Butler 选择 bestAgent 或根据 confidence 降级到 alternatives
```

### 派发流程（butler-dispatch-task）

```
Butler 选好 Agent
  → 创建全局 TODOboard 条目（如有必要）
  → 向目标 Agent 发送任务通知（系统消息 + 任务上下文）
  → Agent wake 后调用 agent-task-accept 创建 inbox 条目
  → Agent 判断是否能独立完成
    → 能 → 执行 + agent-task-report 汇报进度
    → 不能 → agent-task-report(status=blocked, blockerReason=...) 请求 Butler 改派
  → 完成后 agent-task-complete → MemoryAgent → TaskArchive → 续作判断
```

### 4 大操作流程

**流程 1：Agent 接收管家派发任务**
1. Butler 根据 Capability Card 选择 Agent。
2. Butler 创建或关联全局 TODOboard 条目。
3. Butler 将任务派发给 Agent。
4. Agent 创建 AgentTaskInboxItem。
5. Agent 判断是否能独立完成。
6. 能完成则执行；不能完成则请求 Butler 改派、组建群组或补充资源。
7. Agent 完成后提交结果、证据、产物。
8. Agent 作为当前任务承担者判断是否需要续作。
9. Agent 自动写入 EXPERIENCE。
10. 如需更新 JOB 或 CHARACTER，生成 GrowthProposal。

**流程 2：Agent 独立工作变强**
1. Agent 完成复杂任务。
2. Reflection Loop 提取经验。
3. 可自动写入 `EXPERIENCE.md`。
4. 若经验反复出现，生成 `JOB.md` 修改建议。
5. 若涉及人格、语气、关系感，生成 `CHARACTER.md` 修改建议。
6. GrowthReviewer 审批后应用（CHARACTER 还需用户/管家确认）。

**流程 3：Agent 在群组中工作**
1. Host 或其他成员 @mention Agent。
2. Agent 读取群组裁剪上下文。
3. Agent 判断自己负责什么。
4. Agent 执行任务。
5. 完成后用 group-send 汇报。
6. 遇到阻塞时说明原因并 @mention 需要协助的人。
7. 重要经验可写入个人 EXPERIENCE，也可通过群组经验工具写入群组经验。

**流程 4：Agent 请求 Market 增强**
1. Agent 发现自己缺少某个技能、插件、工具或模板。
2. Agent 不直接安装。
3. Agent 向 Butler 提出资源需求（agent-request-resource）。
4. Butler 搜索 Market。
5. 用户确认后安装或创建资源。
6. Agent 的 config 或 Capability Card 更新。

---

## 第七节：前端设计

### Agent 详情页新增 3 个 Tab

| Tab | 组件 | 内容 | 数据来源 |
|-----|------|------|---------|
| **能力** | `CapabilityTab` | CapabilityCard 展示 | WS `get_agent_capability` |
| **任务** | `TaskInboxTab` | TaskInbox 列表（筛选/展开） | WS `get_agent_inbox` |
| **成长** | `GrowthProposalsTab` | Proposal 时间线 + 审批操作 | WS `get_agent_proposals` |

### 能力卡 UI
- 卡片布局：Agent 角色 + 可靠性指标
- 擅长/不擅长标签云
- 任务类型列表（可展开）
- 协作属性：独立工作/群组适配/需审查场景

### 任务收件箱 UI
- 表格：标题 / 来源 / 状态 / 时间
- 状态标签：pending(灰) → running(蓝) → completed(绿) / blocked(橙) / failed(红) / waiting_user(黄)
- 行展开：验收标准 / 阻塞原因 / 依赖引用 / 交付物
- 筛选器：全部 / 活跃 / 已完成 / 阻塞
- 关联标签：🔗 全局 TODO / 🔗 Agent TODO

### 成长建议 UI
- 时间线布局：targetFile / risk / reason / status
- 用户可对 CHARACTER/config 类 Proposal 手动批准/拒绝
- JOB 类由 GrowthReviewer 自动审批后仅展示结果

### 新增 WS 命令

```ts
// ws-server.ts 新增 case
"get_agent_capability"  → 返回 capability.json 内容
"get_agent_inbox"       → 返回 inbox.json 内容
"get_agent_proposals"   → 返回 proposals/ 列表
"approve_proposal"      → 用户批准 GrowthProposal（CHARACTER/config 类）
"reject_proposal"       → 用户拒绝 GrowthProposal
"find_agent"            → Butler 按能力匹配 Agent
"dispatch_task"         → Butler 派发任务给 Agent
```

### 新增 Zustand Store

```ts
// gui-v2/src/stores/agentEnhancement.ts
interface AgentEnhancementState {
  capabilities: Record<string, AgentCapabilityCard>;
  inboxes: Record<string, AgentTaskInboxItem[]>;
  proposals: Record<string, AgentGrowthProposal[]>;
  fetchCapability: (agentId: string) => void;
  fetchInbox: (agentId: string) => void;
  fetchProposals: (agentId: string) => void;
  approveProposal: (agentId: string, proposalId: string) => void;
  rejectProposal: (agentId: string, proposalId: string) => void;
}
```

### 新增前端文件

| 文件 | 类型 |
|------|------|
| `gui-v2/src/components/agent/CapabilityTab.tsx` | 新建 |
| `gui-v2/src/components/agent/TaskInboxTab.tsx` | 新建 |
| `gui-v2/src/components/agent/GrowthProposalsTab.tsx` | 新建 |
| `gui-v2/src/stores/agentEnhancement.ts` | 新建 |

### 修改前端文件

| 文件 | 修改内容 |
|------|---------|
| `gui-v2/src/components/agent/AgentDetail.tsx` | 新增 3 个 Tab |
| `gui-v2/src/lib/types.ts` | 新增前端类型（AgentInfo 扩展、CapabilityCard、TaskInboxItem 等） |
| `gui-v2/src/hooks/useWebSocket.ts` | 新增 7 个 WS 消息 handler |

---

## 第八节：测试与验收方向

### 后端测试

1. AgentPaths/AgentFiles 新增 getter 和方法可正常读写 capability.json、inbox.json、reflection.json、proposals/
2. `Agent.getStatus()` 从 TaskInbox 正确推导状态
3. `Agent.getTaskSummary()` 正确聚合活跃/阻塞/等待/失败计数
4. `mapAgentStatusToGlobal()` 映射规则正确
5. 新增 3 个 ToolAgent 可独立运行（growth-reviewer/task-archive/capability-updater）
6. 10 个新工具注册正确，工具 schema 有效
7. `agent-task-accept` → `agent-task-report` → `agent-task-complete` 完整链路
8. `agent-propose-job-update` → GrowthReviewer 审批 → 写盘链路
9. `agent-propose-character-update` → GrowthReviewer 审批 → 需用户确认链路
10. `agent-propose-config-update` → GrowthReviewer 审批 → 需用户/管家确认链路
11. `agent-request-resource` 不会直接安装资源
12. `butler-find-agent` 基于 Capability Card 匹配 Agent
13. `butler-dispatch-task` → Agent 接收 → 执行 → 完成 完整链路
14. TaskArchive 在任务完成后正确判断归档/保留

### 前端测试

15. CapabilityTab 正确渲染能力卡
16. TaskInboxTab 正确渲染任务列表 + 筛选 + 展开
17. GrowthProposalsTab 正确渲染时间线 + 审批按钮
18. agentEnhancement store 的 fetch 和 approve/reject actions 正确

### 集成验证

19. `pnpm build` 全部 workspace 包编译零错误
20. `pnpm test` 全部测试通过
21. `gui-v2 npx tsc --noEmit` 前端零类型错误

---

## 实施分层顺序

1. **shared 类型** — 新增所有类型定义 (`packages/shared/src/types.ts`)
2. **AgentPaths/AgentFiles** — 扩展 5 个 getter + 8 个方法 (`packages/core/src/agent/paths.ts`)
3. **ToolAgent** — 3 个新 ToolAgent + data 配置 (`packages/core/src/agent/tool-agent/`)
4. **Agent 工具** — 10 个新工具 + 类型 (`packages/core/src/agent/agent.ts`)
5. **Butler 工具** — 3 个新 Butler 工具 (`packages/core/src/agent/butler.ts`)
6. **WS Server** — 7 个新端点 (`packages/core/src/api/ws-server.ts`)
7. **前端** — Store + 3 个 Tab 组件 + 类型 + WS 适配

## 非目标

- 不在本规格中实现 Agent auto-creation
- 不在本规格中完成 Market 检索具体实现（仅提供 agent-request-resource 发送端）
- 不在本规格中修改群组审核管道（非本次范围）
- 不在本规格中实现完整全局 TODOboard 看板
