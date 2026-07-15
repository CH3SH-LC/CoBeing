# CoBeing 统一产品、技术与前端设计总文档

**日期**: 2026-06-09  
**状态**: 统一交接稿  
**适用范围**: Butler 入口、通用 Agent、Group 协作、TODOboard、Market、ToolAgent、插件发现与 GUI 前端体验  

---

## 1. 文档目标

本文件把 2026-06-08 至 2026-06-09 的产品、技术、前端规格整合成一份可以直接交给队友实施的总设计文档。

它不是新的大方向探索，而是把已经收敛的规格统一为一个可执行口径：

- 普通用户主要面对管家，不需要理解全部系统结构。
- 管家是用户入口、任务托管者和资源授权解释器，不是万能执行者。
- Agent 是长期存在的专业联系人。
- Group 是长期存在的场景协作空间，不是一次性任务容器。
- TODOboard 是任务账本和触发器，不是用户手动维护的大看板。
- Market 是可信能力供应链，不是普通用户优先打开的商店首页。
- ToolAgent 是后台临时窄能力单元，不是普通 Agent。
- 前端保留聊天中心体验，轻量提升管家入口和整体质感，不做任务大屏化首页。

本文件作为后续拆分实施计划、代码实现、验收和代码审查的首要依据。若本文件与历史分散 spec 存在表达差异，以本文件的统一口径为准。

---

## 2. 整合来源

本设计整合并吸收以下规格：

| 日期 | 文件 | 纳入内容 |
| --- | --- | --- |
| 2026-06-08 | `2026-06-08-butler-entry-bridge-design.md` | Butler 入口、Group 事件桥接、ButlerTask、GroupButlerBinding、关键事件回传 |
| 2026-06-08 | `2026-06-08-general-agent-capability-design.md` | 通用 Agent 能力卡、任务收件箱、经验沉淀、成长建议 |
| 2026-06-08 | `2026-06-08-group-organization-prompt-driven-design.md` | 长期 Group、群主职责、纯 prompt 驱动、非阻塞 `group-send` |
| 2026-06-08 | `2026-06-08-market-architecture-design.md` | Market 资源包、信任分级、依赖树、安装计划、本地 fork |
| 2026-06-08 | `2026-06-08-todoboard-global-group-design.md` | Global / Group / Agent 三层 TODOboard、最小全局状态、自动续作 |
| 2026-06-08 | `2026-06-08-tool-agent-standardization-design.md` | ToolAgent 生命周期、Memory / Creator / Review / Judgment 标准化 |
| 2026-06-02 | `2026-06-02-plugin-frontend-discovery-design.md` | 插件到前端动态发现管道、`list_plugins`、Provider / Channel 动态配置 |
| 2026-06-03 | `2026-06-03-frontend-extensions-redesign-design.md` | 扩展页、仪表盘与设置页分工、插件配置 schema |
| 2026-06-09 | `2026-06-09-frontend-butler-entry-polish-design.md` | 管家页轻量侧栏、任务回执、输入动作、`butler` / `host` 过滤、视觉规则 |

---

## 3. 一句话架构

CoBeing 是一个面向个人用户的 AI Agent Team 系统：用户把事情交给 Butler，Butler 根据任务复杂度派发给 Agent 或 Group，并通过 Global TODOboard 托管任务状态；Agent 和 Group 在自己的执行空间推进工作，关键节点通过结构化事件回到 Butler；Market 为系统提供可信资源供应，ToolAgent 为后台提供短命窄能力；前端以聊天为中心，只用轻量摘要和回执让用户知道系统正在跟进什么。

---

## 4. 设计原则

### 4.1 产品原则

1. **管家优先**：普通用户的主要入口是 Butler 对话，不是 Market、设置页或 TODOboard。
2. **聊天中心**：首屏和主操作区保持对话体验，不做密集任务大屏。
3. **轻量暴露**：任务信息通过摘要、回执小卡、待确认提示和右侧抽屉按需展开。
4. **长期角色**：Agent 和 Group 都是长期资源，可以持续沉淀经验和偏好。
5. **明确授权**：社区资源、高风险插件、MCP、外部账号、文件/网络权限必须用户确认。
6. **边界清晰**：Butler、Host、Agent、ToolAgent、TODOboard 不互相抢责任。

### 4.2 技术原则

1. **账本不承担智能责任**：TODOboard 负责记录和触发，判断由 Butler、Host 或承担任务的 Agent 完成。
2. **事件桥接，不旁听**：Group 只把关键事件回传 Butler，不把所有内部消息推到 Butler。
3. **三层任务引用**：Global TODO 引用 Group TODO / Agent TODO，不把所有子任务混成一张表。
4. **本地 fork**：Market 安装资源后复制到本地数据目录，远程模板不能静默覆盖用户个性化内容。
5. **动态发现**：Provider、Channel、Plugin、UI extension 等能力由插件管道动态暴露，前端不硬编码能力列表。
6. **渐进接入**：前端可以先使用空摘要或派生摘要，不阻塞后端 ButlerTask / Global TODO 的真实实现。

### 4.3 前端原则

1. **保留现有骨架**：沿用 `NavBar + Context Sidebar + Main Chat + Right Sheet`。
2. **管家页同构但轻量**：管家页补左侧轻量摘要侧栏，右侧保留设置抽屉。
3. **不嵌套卡片**：页面区域是分层布局，卡片只用于具体条目、消息内回执和弹层内容。
4. **视觉高级但克制**：渐变基底、半透明 surface、柔和边框、充足留白、清晰字号。
5. **核心角色不混入普通 Agent**：`butler` 和 `host` 不在普通 Agent 列表、普通成员选择器或普通 @mention 中出现。

---

## 5. 非目标

本轮统一设计明确不做以下事情：

1. 不把 CoBeing 改成企业项目管理后台。
2. 不做完整 Global TODOboard 大看板。
3. 不把 Market、Agent、Group、TODO 全部塞进管家首页。
4. 不让 Butler 旁听所有群组消息。
5. 不让 ToolAgent 出现在用户的普通 Agent 列表。
6. 不让 Agent、Host 或 Butler 静默安装社区未认证资源。
7. 不让 Group 成为一次性任务容器。
8. 不要求群组协作先落成重协议状态机；群组协作仍以轻结构加 prompt 规则驱动。
9. 不从 store 或后端删除 `butler` / `host` 数据；只改变普通用户界面的展示边界。
10. 不强制一次性重构所有大组件；只在接入新能力时拆出必要边界。

---

## 6. 角色与责任边界

### 6.1 Butler / 管家

Butler 是用户入口、任务托管者、跨空间调度者和授权解释器。

Butler 负责：

- 接住用户自然语言需求。
- 判断自己能否直接简单回答。
- 将复杂任务登记为 Global TODO，并创建 ButlerTask。
- 选择或创建目标 Agent / Group。
- 从 Group / Agent 接收关键事件。
- 把技术性阻塞压缩成用户能回答的问题。
- 把完成结果整理成用户可理解的交付。
- 请求用户授权安装 Market 资源或启用高风险能力。

Butler 不负责：

- 长时间自己执行复杂任务。
- 成为每个群组里的普通成员。
- 旁听所有群组过程。
- 替用户做主观、高风险或扩权决策。
- 把大量 Market 搜索结果直接丢给普通用户。

### 6.2 Host / 群主

Host 是 Group 内部的责任协调者。它属于群组协作语境，不是普通 Agent。

Host 负责：

- 启动具体工作回合。
- 判断唤醒哪些成员，避免默认 @all。
- 维护 Group TODO 的秩序。
- 恢复停滞任务。
- 整合成员结果。
- 把内部问题转成用户或 Butler 能处理的少量选项。
- 维护群组公共记忆和协作经验。
- 合并成员资源请求并上浮给 Butler 或用户。

Host 不负责：

- 成为用户唯一入口。
- 管理所有群组。
- 替每个承担任务的 Agent 判断是否需要自然续作。
- 静默安装资源或扩大任务范围。

### 6.3 普通 Agent

普通 Agent 是长期存在、可定制、可被调度的专业联系人。

Agent 负责：

- 承接来自用户、Butler 或 Group 的具体任务。
- 根据 `CHARACTER.md` 保持身份和表达风格。
- 根据 `JOB.md` 使用稳定工作方法。
- 通过 Capability Card 被 Butler / Host 调度。
- 维护自己的 Task Inbox。
- 完成任务后提交结果、证据和产物。
- 判断自己承担的 TODO 是否需要续作。
- 写入低风险经验，并提出可审查的成长建议。

Agent 不负责：

- 成为万能助手。
- 静默安装 Skill / Plugin / MCP / Market 资源。
- 自动修改 `CHARACTER.md` 或权限配置。
- 在群组里泄露私有记忆。
- 越权替用户审批方案、预算、风格或授权。

### 6.4 Group / 群组

Group 是长期存在的场景协作空间。

Group 负责：

- 承载长期场景，例如旅行、学习、家庭事务、产品创作。
- 组织多个 Agent 在同一场景下协作。
- 维护 Group TODO、公共记忆、群组规则和工作区。
- 接收 Butler 派发或用户直接在群组提出的任务。
- 在关键节点把事件回传 Butler。

Group 不是：

- 一次性任务容器。
- 企业部门。
- 无边界自由讨论区。
- 让用户必须阅读所有内部过程的工作台。

### 6.5 ToolAgent / 工具智能体

ToolAgent 是临时工作单元。它只做窄任务，完成后返回结果。

ToolAgent 适合：

- Review：审查群组消息质量。
- Judgment：判断是否唤醒 Host。
- Clone：临时并行子任务。
- Memory：提取经验和记忆修改建议。
- Creator：生成 Agent / Group 初始文件、能力建议和确认项。

ToolAgent 不应：

- 注册到普通 Agent 列表。
- 拥有长期人格和长期记忆。
- 主动向用户发消息。
- 静默写入高风险长期文件。
- 替用户授权或审批。

### 6.6 TODOboard

TODOboard 是任务账本和触发器，不是智能责任主体。

它负责：

- 记录任务目标、负责人、状态、依赖、关键事件和下一步。
- 触发到期检查、条件扫描和完成副作用。
- 给 Butler、Host 和 Agent 提供可恢复上下文。

它不负责：

- 判断是否值得继续。
- 判断用户应该选择哪个方案。
- 自动安装资源。
- 自己扩大任务范围。

### 6.7 Market

Market 是可信能力供应链。

Market 负责：

- 描述可安装资源。
- 给出信任、审核、版本和风险信息。
- 解析依赖树。
- 生成安装计划。
- 支持本地 fork。
- 让 Butler、Host、Agent 和进阶用户在需要扩展能力时可审查地安装资源。

Market 不是：

- 普通用户每天打开的首页。
- 简单插件列表。
- 社区资源静默安装通道。

---

## 7. 用户信息架构

### 7.1 全局入口

GUI 保持六个主入口：

```text
管家
智能体
群组
仪表盘
扩展
设置
```

入口分工：

| 入口 | 面向用户的职责 |
| --- | --- |
| 管家 | 默认入口、对话、任务托管、待确认摘要、结果回执 |
| 智能体 | 管理普通 Agent、对单个 Agent 聊天、配置能力和文件 |
| 群组 | 进入长期场景空间、查看群聊、成员、工作区和 Group TODO |
| 仪表盘 | 运维监控、用量、响应、错误、活跃 Agent |
| 扩展 | 进阶管理 Skills、MCPs、Plugins 和已安装能力 |
| 设置 | 常规配置、主题、Providers、Channels、沙箱、日志、搜索、导出、关于 |

### 7.2 管家入口体验

管家页采用同构布局：

```text
NavBar
  ├── ButlerSidebar：轻量任务摘要
  ├── ChatView：主聊天体验
  └── ButlerConfigPanel：右侧设置抽屉
```

ButlerSidebar 只展示：

- 今日托管数量。
- 待我确认的最多 3 条任务。
- 最近回执最多 3 条。
- 快捷入口：查看摘要、打开设置、同步状态。

不展示：

- 完整任务表。
- 群组内部消息。
- 原始工具日志。
- Market 资源列表。

### 7.3 Agent 页面体验

Agent 页面只展示普通 Agent。

过滤规则：

- `butler` 不显示。
- `host` 不显示。
- 自动选择不选中核心 Agent。
- Agent 详情面板不能打开核心 Agent。
- 创建群组、添加成员、普通 Agent 选择器不提供核心 Agent。

### 7.4 Group 页面体验

Group 页面展示长期群组和群聊。

规则：

- Host 可以作为群组内系统协调者展示，但不作为普通 Agent 进入列表。
- 用户可以直接在群组里提出需求。
- 通过 Butler 派来的任务在群组内由 Host 启动工作回合。
- 群组过程默认留在群组，关键节点回传 Butler。

### 7.5 扩展与 Market 的关系

扩展页负责已安装和进阶配置：

- Skills。
- MCPs。
- Plugins。
- 插件 settings-panel。
- Provider / Channel 实例配置。

Market 负责资源发现、信任、依赖、安装计划和本地 fork。普通用户主要通过 Butler 间接使用 Market；进阶用户未来可以进入 Market 浏览，但必须看到信任、依赖和风险。

---

## 8. 核心用户流程

### 8.1 用户向管家交代复杂任务

1. 用户在 Butler 聊天输入需求。
2. Butler 判断任务超过简单问答边界。
3. Butler 创建 Global TODO。
4. Butler 创建 ButlerTask。
5. Butler 根据能力卡选择已有 Agent / Group；若缺资源，优先本地创建，再考虑官方认证 Market 资源。
6. Butler 派发任务到目标执行空间。
7. Butler 在聊天中返回任务回执卡。
8. ButlerSidebar 的最近回执出现摘要。
9. 目标 Agent / Group 开始执行。

### 8.2 群组需要用户决策

1. Group 内部由 Host 或承担任务的 Agent 发现需要用户选择。
2. Host 调用 Group -> Butler 桥接工具。
3. Bridge 生成 `needs_user_decision` 或 `blocked` 事件。
4. ButlerTask 进入 `waiting_user`。
5. Global TODO 进入 `waiting_user`。
6. Butler 在聊天中展示问题、选项和推荐。
7. ButlerSidebar 的待我确认出现摘要。
8. 用户在 Butler 回复。
9. Butler 把回复带回原 Group。
10. Group 继续执行。

### 8.3 群组完成任务

1. Group 完成主要交付。
2. Host 调用结果回传工具。
3. Bridge 生成 `completed` 事件，包含摘要、产物、验收情况和建议。
4. ButlerTask 和 Global TODO 更新为完成或待验收。
5. Butler 生成面向用户的最终回复。
6. 如承担任务的 Agent 判断有自然续作，低风险续作可生成后续 TODO；涉及用户选择、授权、付款、隐私或范围扩大时进入 `waiting_user`。

### 8.4 用户主动询问进度

1. 用户问 Butler 某件事进度。
2. Butler 根据 ButlerTask / Global TODO 找到对应 Agent 或 Group。
3. Butler 请求目标执行空间返回摘要。
4. Group 返回 `status_digest`，Agent 返回任务报告。
5. Butler 用简洁语言说明状态、卡点和下一步。

### 8.5 Agent 发现缺少资源

1. Agent 判断自己缺 Skill、Plugin、MCP、Agent 或 Group。
2. Agent 不直接安装，而是向 Butler 或 Host 提出资源缺口。
3. Host 合并群组资源请求，必要时上浮给 Butler。
4. Butler 调用 Market Resolver。
5. Resolver 输出少量候选和本地创建替代方案。
6. Butler 展示 Install Plan 摘要。
7. 用户授权后 Local Installer fork 到本地。

---

## 9. 后端领域模型

### 9.1 GlobalTodoItem

Global TODO 是 Butler 的跨空间编排账本。它不复用现有 Agent / Group TODO 类型，避免状态和语义混淆。

```ts
export type GlobalTodoStatus =
  | "pending"
  | "running"
  | "waiting_user"
  | "completed"
  | "cancelled";

export interface GlobalTodoItem {
  id: string;
  title: string;
  goal: string;
  status: GlobalTodoStatus;

  assigneeType: "butler" | "agent" | "group";
  assigneeId?: string;
  responsibleAgentId?: string;

  butlerTaskId?: string;

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
    ownerId: string;
    todoIds?: string[];
    messageIds?: string[];
  }>;

  progressSummary: string;
  nextAction?: string;

  lastEvent?: {
    type: string;
    summary: string;
    at: string;
  };

  internalBlocker?: {
    type: "missing_info" | "dependency" | "resource" | "tool_error" | "agent_stalled";
    summary: string;
    since: string;
  };

  createdBy: "user" | "butler" | "host" | "system";
  createdAt: string;
  updatedAt: string;
}
```

状态映射规则：

- Group / Agent 局部 `blocked` 如果需要用户处理，映射为 Global `waiting_user`。
- Group / Agent 局部 `blocked` 如果系统可自行恢复，Global 保持 `running`，写入 `internalBlocker`。
- Group / Agent 局部 `failed` 不作为 Global 主状态；写入 `lastEvent`、`progressSummary` 和 `nextAction`，由 Butler 判断改派、重试、请求用户或取消。
- Global 不新增 `blocked` / `failed` 主状态。

### 9.2 ButlerTask

ButlerTask 是 Butler 的任务托管账本。它记录 Butler 如何理解、派发、追踪和回收一个用户任务。

```ts
export interface ButlerTask {
  id: string;
  globalTodoId: string;
  userMessageId?: string;

  title: string;
  goal: string;
  acceptance?: string;
  constraints?: string[];
  userPreferences?: string[];

  targetType: "agent" | "group";
  targetId: string;

  status:
    | "routing"
    | "dispatched"
    | "running"
    | "waiting_user"
    | "completed"
    | "failed"
    | "cancelled";

  latestSummary?: string;
  pendingQuestion?: ButlerUserQuestion;

  marketResources?: Array<{
    id: string;
    kind: "agent" | "group" | "skill" | "plugin" | "mcp" | "butler-persona";
    source: "official" | "community" | "local";
    status: "suggested" | "approved" | "installed" | "rejected";
  }>;

  createdAt: string;
  updatedAt: string;
}
```

ButlerTask 可以有 `failed`，因为这是 Butler 编排层的失败视角；映射到 Global TODO 时仍使用最小状态集合。

### 9.3 GroupButlerBinding

GroupButlerBinding 是管家分身的工程实现。它是虚拟身份和事件端点，不复制真实 Butler LLM 实例。

```ts
export type ButlerEscalationType =
  | "needs_user_decision"
  | "blocked"
  | "completed"
  | "failed"
  | "scope_change"
  | "status_digest";

export interface GroupButlerBinding {
  groupId: string;
  butlerId: "butler";
  alias: "@butler" | "@管家" | string;
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
```

规则：

- `@butler` 不参与普通群聊。
- `@butler` 不进入 WakeSystem 普通成员队列。
- 只有 Host 或 Bridge 工具可以主动回传。
- 用户直接进入群组时，可以看见任务与 Butler 的绑定关系。

### 9.4 ButlerEscalationEvent

```ts
export interface ButlerEscalationEvent {
  id: string;
  type: ButlerEscalationType;
  butlerTaskId: string;
  globalTodoId?: string;
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
```

### 9.5 ButlerUserQuestion

```ts
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
```

### 9.6 AgentCapabilityCard

Capability Card 是机器可读能力画像，供 Butler、Host、Group 和前端调度。

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
    lastUpdated: string;
  };
}
```

### 9.7 AgentTaskInboxItem

```ts
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
  status:
    | "pending"
    | "running"
    | "blocked"
    | "waiting_user"
    | "waiting_dependency"
    | "completed"
    | "failed"
    | "cancelled";
  blockerReason?: string;
  dependencyRefs?: Array<{
    agentId: string;
    todoId?: string;
    reason: string;
  }>;
  failureSummary?: string;
  artifacts?: Array<{
    name: string;
    path?: string;
    description?: string;
  }>;
  createdAt: string;
  updatedAt: string;
}
```

### 9.8 AgentGrowthProposal

```ts
export interface AgentGrowthProposal {
  id: string;
  agentId: string;
  targetFile: "JOB.md" | "CHARACTER.md" | "config.json";
  reason: string;
  proposedPatch: string;
  risk: "low" | "medium" | "high";
  status: "pending" | "approved" | "rejected" | "applied";
  createdAt: string;
  reviewedBy?: "user" | "butler";
}
```

文件写入策略：

| 文件 | 自动策略 |
| --- | --- |
| `EXPERIENCE.md` | 可自动追加，必须摘要、去重、安全扫描 |
| `MEMORY.md` | 谨慎追加事实、长期偏好和稳定约定 |
| `JOB.md` | 生成 GrowthProposal，经 Butler 或用户确认 |
| `CHARACTER.md` | 生成 GrowthProposal，必须确认 |
| `config.json` | 权限、工具、模型、Skill 变更必须确认 |

### 9.9 ToolAgentSpec

```ts
export interface ToolAgentSpec {
  type: string;
  name: string;
  purpose: string;
  trigger: string;
  model?: string;
  maxIterations: number;
  timeoutMs?: number;
  tools: string[];
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  visibility: "hidden" | "system_log" | "user_summary";
  writePolicy: "return_only" | "caller_applies" | "safe_auto_apply";
  failurePolicy: "ignore" | "fallback_allow" | "fallback_block" | "escalate";
}
```

默认规则：

- Review / Judgment 可作为门禁，但必须有超时和 fallback。
- Memory 返回经验和记忆建议，由调用方应用。
- Creator 返回初始文件和建议，由 Butler 或前端创建流程确认。
- Clone 不递归创建 Clone，不向群组发送消息。

### 9.10 Market Resource Manifest

Market 外层 manifest 文件名：

```text
cobeing.resource.json
```

最小结构：

```ts
export interface MarketResourceManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  type: "group" | "agent" | "skill" | "plugin" | "mcp" | "butler-persona";
  version: string;
  description: string;
  publisher: {
    id: string;
    name: string;
  };
  trust: {
    level:
      | "builtin"
      | "official-certified"
      | "community-reviewed"
      | "community-unverified"
      | "local-private";
    reviewStatus: "approved" | "pending" | "rejected" | "revoked" | "unknown";
    reviewedAt?: string;
  };
  compatibility: {
    cobeingVersion: string;
  };
  artifacts: Array<{
    type: string;
    path: string;
  }>;
  dependencies: Array<{
    id: string;
    type: "group" | "agent" | "skill" | "plugin" | "mcp" | "butler-persona";
    required: boolean;
    reason: string;
  }>;
  permissions: {
    riskLevel: "low" | "medium" | "high" | "critical" | "blocked";
    requiresNetwork: boolean;
    requiresFilesystem: boolean;
    requiresExternalAccount: boolean;
    requiresUserApproval: boolean;
  };
  install: {
    forkToLocal: boolean;
    defaultEnabled: boolean;
    requiresRestart: boolean;
  };
}
```

### 9.11 MarketInstallPlan

```ts
export interface MarketInstallPlan {
  resourceId: string;
  resourceType: "group" | "agent" | "skill" | "plugin" | "mcp" | "butler-persona";
  trustLevel: string;
  overallRisk: "low" | "medium" | "high" | "critical" | "blocked";
  summary: string;
  dependencies: Array<{
    id: string;
    type: string;
    required: boolean;
    status: "already-installed" | "to-install" | "conflict" | "blocked";
    riskLevel: string;
    reason: string;
  }>;
  permissions: Array<{
    capability: string;
    riskLevel: string;
    reason: string;
    requiresSeparateApproval: boolean;
  }>;
  userConfirmations: Array<{
    id: string;
    question: string;
    required: boolean;
  }>;
  localFork: {
    forkToLocal: boolean;
    targetPath: string;
    editableAfterInstall: boolean;
  };
  rollback: {
    canRollback: boolean;
    filesToCreate: string[];
    registryChanges: string[];
  };
}
```

---

## 10. 推荐代码结构

以下路径是后续实施的建议落点。实现时优先遵循现有代码风格和实际依赖关系；若已有相近模块，应复用并小步演进。

### 10.1 后端新增或扩展

| 模块 | 建议路径 | 职责 |
| --- | --- | --- |
| Global TODO 类型 | `CoBeing/packages/core/src/todo/global-types.ts` | GlobalTodoItem、状态、事件引用、续作策略类型 |
| Global TODO Store | `CoBeing/packages/core/src/todo/global-store.ts` | 持久化 Global TODO，不复用 Agent / Group TODO store |
| ButlerTask 类型与 Store | `CoBeing/packages/core/src/agent/butler-task-store.ts` | ButlerTask 创建、更新、查询、按用户消息或 Global TODO 查找 |
| GroupButlerBridge | `CoBeing/packages/core/src/agent/group-butler-bridge.ts` | 处理 Group -> Butler 事件、去重、状态映射、用户回复回传 |
| Butler Dispatch Tools | `CoBeing/packages/core/src/tools/butler-dispatch-tools.ts` | 派发到 Agent / Group、取消、状态查询、回复 Group |
| Global TODO Tools | `CoBeing/packages/core/src/tools/global-todo-tools.ts` | `global-todo-add/list/update/link/continue` |
| Agent Capability | `CoBeing/packages/core/src/agent/capability-card.ts` | 读取、生成、更新 Capability Card |
| Agent Task Inbox | `CoBeing/packages/core/src/agent/task-inbox.ts` | 接收任务、更新状态、提交报告 |
| Agent Growth | `CoBeing/packages/core/src/agent/growth-proposal.ts` | JOB / CHARACTER / config 修改建议 |
| Market 类型 | `CoBeing/packages/core/src/market/types.ts` | Resource Manifest、Trust、Risk、InstallPlan |
| Market Resolver | `CoBeing/packages/core/src/market/resolver.ts` | 扫描 Market、匹配候选、信任过滤、本地替代 |
| Install Planner | `CoBeing/packages/core/src/market/install-planner.ts` | 依赖树、风险、权限、确认项、rollback |
| Local Installer | `CoBeing/packages/core/src/market/local-installer.ts` | fork/copy 到本地 data，写 source 元数据和 registry |
| ToolAgent Spec Loader | `CoBeing/packages/core/src/agent/tool-agent/spec.ts` | 统一 ToolAgent 配置卡、失败策略和可见性 |
| Creator 扩展 | `CoBeing/packages/core/src/agent/tool-agent/creator.ts` | 扩展到 Group 创建草案 |
| WS API 扩展 | `CoBeing/packages/core/src/api/ws-server.ts` | 新增或扩展下面列出的 WS 命令 |

### 10.2 前端新增或扩展

| 模块 | 建议路径 | 职责 |
| --- | --- | --- |
| 核心 Agent helper | `CoBeing/gui-v2/src/lib/coreAgents.ts` | `CORE_AGENT_IDS`、`isCoreAgent`、`getVisibleUserAgents` |
| Butler 任务 UI store | `CoBeing/gui-v2/src/stores/butlerTasks.ts` | 管家侧栏摘要、回执索引，未来对接真实 API |
| ButlerSidebar | `CoBeing/gui-v2/src/components/layout/ButlerSidebar.tsx` | 管家轻量任务摘要侧栏 |
| TaskReceiptCard | `CoBeing/gui-v2/src/components/chat/TaskReceiptCard.tsx` | 聊天内任务回执小卡片 |
| ChatInputActions | `CoBeing/gui-v2/src/components/chat/ChatInputActions.tsx` | 输入区快捷动作按钮组 |
| Chat 拆分组件 | `CoBeing/gui-v2/src/components/chat/ChatHeader.tsx` 等 | 只为接入回执和输入动作做必要拆分 |
| Plugin Store 扩展 | `CoBeing/gui-v2/src/stores/plugins.ts` | 接收 `list_plugins`，提供 providers、channels、models、settings panels |
| Extensions UI 维护 | `CoBeing/gui-v2/src/components/extensions/*.tsx` | 保持 Skills / MCPs / Plugins 三 Tab 进阶配置入口 |
| 全局样式细化 | `CoBeing/gui-v2/src/styles/globals.css` | 保持 token 化、修复过小字号、优化 surface 和 divider |

---

## 11. WS / 工具接口设计

### 11.1 Butler 编排命令

```ts
// 用户需求派发给 Group
type ButlerDispatchToGroupRequest = {
  type: "butler_dispatch_to_group";
  payload: {
    groupId: string;
    title: string;
    goal: string;
    acceptance?: string;
    constraints?: string[];
    userPreferences?: string[];
    globalTodoId?: string;
  };
};

type ButlerDispatchToGroupResponse = {
  type: "butler_dispatch_result";
  payload: {
    globalTodoId: string;
    butlerTaskId: string;
    targetType: "group";
    targetId: string;
    status: "dispatched" | "running";
  };
};
```

同类命令：

- `butler_dispatch_to_agent`
- `butler_get_work_status`
- `butler_reply_to_group`
- `butler_cancel_work`
- `butler_list_tasks`
- `butler_get_task`

### 11.2 Global TODO 命令

建议命令：

- `global_todo_add`
- `global_todo_list`
- `global_todo_get`
- `global_todo_update`
- `global_todo_link_execution`
- `global_todo_continue`
- `global_todo_cancel`

前端首阶段不需要完整展示这些命令，只需 ButlerSidebar 和 TaskReceiptCard 能读取摘要。

### 11.3 Group -> Butler 桥接工具

Host / Group 侧工具：

- `host_escalate_to_butler`
- `host_return_result_to_butler`
- `host_request_butler_summary`

Butler 侧工具：

- `butler_reply_to_group`
- `butler_get_group_status_digest`

去重策略：

- 同一 `butlerTaskId + type + summary hash` 在冷却时间内合并。
- `critical` 事件不被静默吞掉，但可以合并为一条更清晰的问题。
- 普通进度不主动推送，只响应 Butler 查询。

### 11.4 Agent 能力与任务命令

建议命令：

- `agent_get_capability`
- `agent_update_capability`
- `agent_task_accept`
- `agent_task_report`
- `agent_task_complete`
- `agent_reflect_experience`
- `agent_propose_job_update`
- `agent_propose_character_update`
- `agent_request_market_resource`

规则：

- `agent_task_complete` 后触发续作判断。
- 跨层、扩权、需要用户选择的续作必须上浮。
- 低风险、明确承诺、强依赖的续作可由承担 Agent 自动生成。

### 11.5 Market 命令

建议命令：

- `market_search`
- `market_preview_resource`
- `market_create_install_plan`
- `market_install_resource`
- `market_list_local_sources`
- `market_check_updates`

Butler 工具对应：

- `butler_search_market`
- `butler_preview_market_resource`
- `butler_install_market_resource`
- `butler_create_from_market`

社区未认证资源必须要求用户主动确认，不能通过 Butler 或 Agent 静默安装。

### 11.6 插件动态发现命令

保留并扩展 2026-06-02 / 2026-06-03 的管道：

- `list_plugins`
- `toggle_plugin`
- `update_plugin_config`
- `add_plugin_instance`
- `remove_plugin_instance`
- `update_plugin_instance`

`PluginInfo` 至少包含：

```ts
export interface PluginInfo {
  id: string;
  name: string;
  kind: "model-provider" | "channel" | "tool" | "extension" | "memory-backend";
  version: string;
  enabled: boolean;
  models?: Array<{
    id: string;
    name: string;
    contextWindow?: number;
    maxOutputTokens?: number;
  }>;
  channelType?: string;
  toolDefs?: unknown[];
  extensions?: unknown[];
  config?: Record<string, unknown>;
  configSchema?: PluginConfigSchema;
}
```

前端规则：

- Provider / model 选择不再使用硬编码 catalog。
- Channel 类型从插件能力读取。
- 插件 settings-panel 可追加到 SettingsView。
- ExtensionsView 仍是进阶管理入口，不替代 Butler 的普通用户入口。

---

## 12. 自动续作设计

自动续作是 TODOboard 从提醒列表升级为任务编排器的关键能力。

核心规则：

> 谁承担当前 TODO，谁判断是否需要续作。

### 12.1 续作流程

```text
当前 TODO 完成
  ↓
承担任务的 Agent 收集交付物、上下文、限制和用户偏好
  ↓
判断是否还有自然后续
  ↓
无后续：收束并归档
低风险明确后续：创建后续 Agent / Group TODO
需要用户选择：上浮 Butler 或 Host，进入 waiting_user
需要资源或权限：请求 Butler 授权
跨群组或跨 Agent：请求 Butler / Host 路由
```

### 12.2 允许自动生成的低风险续作

- 明确承诺过的提醒。
- 强依赖的下游任务。
- 同一工作空间内的复查、整理、格式化。
- 不扩大原目标的下一步细化。
- 经验沉淀或记忆提取。

### 12.3 必须上浮的续作

- 主观方案选择。
- 预算、付款、账号、隐私。
- 新权限、网络访问、外部服务。
- 安装 Skill / Plugin / MCP / Market 资源。
- 任务范围扩大。
- 跨群组、跨长期 Agent 的资源调度。
- 递归深度超过 `continuationPolicy.maxDepth`。

### 12.4 防失控约束

- `continuationPolicy.maxDepth` 限制递归深度。
- `stopWhen` 描述终止条件。
- 相同标题和目标的后续任务去重。
- 自动续作必须写入 `lastEvent` 和 `nextAction`。
- 用户可在 Butler 入口取消或暂停。

---

## 13. Group 纯 Prompt 协作规则

Group 协作不先引入重协议状态机，而是把关键规则写入 prompt、GUIDE、Host JOB、Agent 群组上下文和工具说明。

### 13.1 群组 GUIDE 必须包含

- 群组长期场景。
- 用户审批点。
- 成员职责边界。
- 资源申请规则。
- 公共记忆写入规则。
- 群组 TODO 使用规则。
- `group-send` 非阻塞协作规则。

### 13.2 Host JOB 必须包含

- 如何启动工作回合。
- 如何选择唤醒成员。
- 如何恢复停滞任务。
- 如何整合结果。
- 如何向 Butler 回传关键事件。
- 如何申请资源。
- 如何维护公共记忆。

### 13.3 Agent 群组上下文必须包含

每次唤醒 Agent 时，应提醒它：

1. 只在职责相关时参与。
2. 能做的先做，不只宣布意图。
3. 需要协作时用 `group-send`。
4. `group-send` 默认是非阻塞旁路消息。
5. 需要用户判断时找 Host。
6. 缺资源时说明缺口，不静默安装。
7. 完成后说明产物、证据、限制和下一步建议。

### 13.4 `group-send` 模板

```text
@目标Agent
我正在做：...
我需要你：...
你的输出会用于：...
我会：继续推进 / 暂停等待 / 先完成我的部分
```

---

## 14. Market 设计

### 14.1 资源层级

| 资源 | 安装语义 |
| --- | --- |
| Group | 最大组合包，可能包含 Host、成员 Agent、Skills、Plugins、MCP、GUIDE、初始 TODO |
| Agent | 长期专业角色，安装后复制为本地 Agent |
| Skill | 工作方法，风险低于 Plugin，但需要声明工具依赖 |
| Plugin | 系统能力扩展，可能涉及 Provider、Channel、Tool、UI、Hook |
| MCP | 外部工具服务器，需要环境变量、账号、网络或文件权限说明 |
| Butler Persona | 管家人格和语气模板，不能覆盖安全边界 |

### 14.2 信任等级

| 等级 | 默认策略 |
| --- | --- |
| `builtin` | 可用于 onboarding，可默认推荐 |
| `official-certified` | Butler 可轻量推荐 |
| `community-reviewed` | 可搜索，不主动强推 |
| `community-unverified` | 必须用户主动审查后授权 |
| `local-private` | 本地创建，按本地配置边界执行 |

### 14.3 风险等级

| 风险 | 策略 |
| --- | --- |
| `low` | 可轻量确认 |
| `medium` | 展示依赖和本地 fork |
| `high` | 明确权限确认 |
| `critical` | 单独授权，不可批量默认同意 |
| `blocked` | 禁止安装 |

### 14.4 安装顺序

1. 扫描 Market index。
2. 读取 `cobeing.resource.json`。
3. 生成候选推荐。
4. 默认先给本地创建方案。
5. 对官方认证资源给少量候选。
6. 生成依赖树。
7. 生成 Install Plan。
8. Butler 或进阶 UI 展示摘要和确认项。
9. 用户授权。
10. Local Installer fork 到本地目录。
11. 写入 source 元数据和 rollback 记录。

### 14.5 建议目录

```text
CoBeing-market/
├── market.index.json
├── groups/
├── agents/
├── skills/
├── plugins/
├── mcps/
└── personas/
```

当前 `MCPs/` 可兼容，后续建议统一为小写 `mcps/`。

---

## 15. 前端页面级设计

### 15.1 AppLayout

保留现有结构：

- `TitleBar`
- `NavBar`
- `Sidebar`
- `MainContent`
- 右侧详情 Sheet

调整：

- `activeView === "butler"` 时显示 `ButlerSidebar`。
- `activeView === "agents"` 时显示普通 Agent 列表。
- `activeView === "groups"` 时显示 Group 列表。
- `dashboard`、`extensions`、`settings` 不强行显示上下文侧栏。

### 15.2 ButlerSidebar

组件职责：

- 从 `useButlerTasksStore` 读取摘要。
- 展示“今日托管”“待我确认”“最近回执”“快捷入口”。
- 每个区块最多 3 条。
- 空状态为轻量文案。
- 点击待确认项定位到聊天中的回执，或打开轻量详情。

建议数据：

```ts
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

阶段策略：

- 第一阶段：从聊天 metadata、activity、TODO 更新事件派生。
- 第二阶段：接入真实 ButlerTask / Global TODO API。

### 15.3 ChatView

保持主聊天体验。

新增能力：

- `TaskReceiptCard` 渲染消息 metadata。
- `ChatInputActions` 提供低权重快捷动作。
- ChatHeader 显示管家名称、连接状态和轻量托管 chip。
- 设置按钮继续打开 `ButlerConfigPanel`。

建议 metadata：

```ts
metadata?: {
  taskReceipt?: TaskReceipt;
  cards?: Array<{
    type: string;
    payload: unknown;
  }>;
}
```

第一阶段只实现 `taskReceipt`。

### 15.4 TaskReceiptCard

默认展示：

- 标题。
- 接受者。
- 状态。
- 下一步。

展开展示：

- 来源消息。
- assignee 类型和名称。
- 最近事件摘要。
- 操作：查看详情、继续追问、取消托管。

限制：

- 默认高度不超过普通消息气泡 1.5 倍。
- 默认最多 2 行说明。
- 不显示长 JSON 和原始工具参数。

### 15.5 ChatInputActions

管家视图按钮：

| 按钮 | 行为 |
| --- | --- |
| 派发 | 打开目标选择菜单：Agent / Group |
| 创建 | 创建 Agent / 创建 Group 快捷菜单 |
| 摘要 | 请求 Butler 总结托管状态 |
| 资源 | 未来接入 Market 推荐 |

按钮要求：

- 使用 `lucide-react` 图标。
- 低视觉权重。
- 支持 `title` 或 tooltip。
- 不占用大面积彩色块。

### 15.6 Agent 过滤

新增：

```ts
export const CORE_AGENT_IDS = new Set(["butler", "host"]);

export function isCoreAgent(id: string): boolean {
  return CORE_AGENT_IDS.has(id);
}

export function getVisibleUserAgents<T extends { id: string }>(agents: T[]): T[] {
  return agents.filter((agent) => !isCoreAgent(agent.id));
}
```

使用范围：

- `Sidebar.tsx` 的 AgentList。
- Agent 自动选择逻辑。
- `AgentDetailPanel.tsx` 防御性过滤。
- `CreateGroupDialog.tsx`。
- `GroupMembersTab.tsx`。
- `GroupChatView.tsx` 普通 mention / 成员选择。
- `ChannelsSection.tsx` 普通 Agent 绑定目标。

例外：

- ButlerConfigPanel 可以访问 Butler 配置。
- Group 内部可以用系统角色方式展示 Host。
- 后端 store 保留 `butler` / `host` 数据。

### 15.7 ExtensionsView

ExtensionsView 保持三 Tab：

- Skills。
- MCPs。
- Plugins。

它负责进阶管理已安装能力：

- 搜索。
- 启用 / 禁用。
- 配置。
- 查看插件声明。
- 自定义 Provider / Channel 实例。

它不负责普通用户的 Market 推荐主流程。

### 15.8 Dashboard

Dashboard 是监控入口，不是任务入口。

包含：

- 今日 Token。
- 响应时间。
- 错误率。
- 用量与费用。
- Agent 活跃度。
- 活跃 Agent / 队列状态。

不恢复密集趋势图作为当前重点。

### 15.9 Settings

Settings 只负责常规配置：

- 常规。
- 主题。
- Providers。
- Channels。
- 沙箱监控。
- 搜索对话。
- 日志。
- 导出数据。
- 关于。
- 插件 settings-panel。

MCPs 进入 ExtensionsView；用量进入 Dashboard。

---

## 16. 前端视觉规范

必须遵守项目 UI 偏好。

### 16.1 分层视觉

```text
渐变基底
  └── 实色导航栏
      └── 半透明侧栏 / 面板
          └── elevated 子区域 / 消息气泡 / 回执卡
```

规则：

- 基底使用渐变，不改纯色背景。
- 导航栏用 `bg-surface-solid` 和阴影。
- 侧栏、Sheet、面板使用半透明 `bg-surface`、`border-bdr/40`、`var(--shadow-surface)`。
- 消息列表容器不要加独立面板背景。
- 消息气泡和任务回执有自己的独立层。

### 16.2 间距

- 主容器 padding 20px 以上。
- 列表项 padding 约 `14px 20px`。
- 主组件 gap 16-24px。
- 消息间距约 24px。
- 避免紧凑后台感。

### 16.3 字号

- 正文、按钮、输入框、标签默认 `text-sm`。
- 标题 `text-lg` 到 `text-2xl`。
- `text-xs` 只用于 badge、状态标签、日志时间戳、代码路径。
- 禁止新增 `text-[9px]`、`text-[10px]`、`text-[11px]`。

### 16.4 颜色和边框

- 不硬编码业务色。
- 使用 CSS token 或 `color-mix()`。
- 列表分隔使用柔和 divider，不使用硬实线边框。
- 不使用选中 ring 作为列表高亮。

### 16.5 图标

- 新按钮优先使用 `lucide-react`。
- 逐步减少导航和关键按钮中的 emoji。
- 不熟悉图标提供 tooltip 或 `title`。

---

## 17. 插槽与扩展性

前端组件边界应预留以下插槽语义，即使第一阶段不做完整插件渲染：

| 插槽 | 用途 |
| --- | --- |
| `butler-sidebar-section` | 向管家侧栏追加摘要区块 |
| `chat-input-action` | 向输入区追加小动作 |
| `message-card` | 渲染特定消息卡片 |
| `detail-panel-tab` | 向 Butler / Agent / Group 详情抽屉追加 Tab |
| `settings-panel` | 插件设置面板 |
| `dashboard-card` | 仪表盘卡片 |

约束：

- 插槽内容必须有高度限制和折叠规则。
- 插槽不能破坏管家页低信息密度。
- 插件卡片必须走主题 token。
- 未知 card 类型按普通消息或兜底卡片渲染，不能导致 ChatView 崩溃。

---

## 18. 实施阶段建议

### Phase 0 - 统一常量与展示边界

目标：

- 明确 `butler` / `host` 是核心 Agent，不进入普通 Agent 界面。
- 不触碰后端数据结构。

工作：

- 新增 `coreAgents.ts`。
- Agent 侧栏过滤核心 Agent。
- 自动选择逻辑过滤核心 Agent。
- 群组成员选择和普通 mention 使用 helper。
- Agent 详情面板防御性过滤。

验收：

- Agent 页面不显示 `butler` / `host`。
- 没有普通 Agent 时显示空状态。
- Butler 入口仍能打开。
- Group 系统角色仍可正常工作。

### Phase 1 - 管家前端入口同构

目标：

- 管家页形成左侧栏 + 主聊天 + 右侧设置抽屉。
- 信息密度保持轻。

工作：

- 新增 `ButlerSidebar`。
- 新增 `butlerTasks` UI store。
- 接入 AppLayout。
- ButlerConfigPanel 视觉对齐 Sheet。

验收：

- 管家侧栏展示轻量摘要或空状态。
- 主聊天仍是视觉中心。
- 右侧管家设置可打开。
- 不出现完整任务大看板。

### Phase 2 - 聊天回执与输入动作

目标：

- 用消息内小卡片表达任务委派、等待用户、完成和失败摘要。

工作：

- 新增 `TaskReceiptCard`。
- 新增 `ChatInputActions`。
- ChatView 接入 metadata 渲染。
- 必要时拆出 ChatHeader、MessageList、ChatInput。

验收：

- metadata 缺失时普通消息正常渲染。
- 任务回执默认低高度、可展开。
- 输入按钮使用图标和低权重样式。

### Phase 3 - Global TODO 与 ButlerTask 后端

目标：

- 建立 Butler 编排账本，支撑真实任务摘要。

工作：

- 新增 GlobalTodoStore。
- 新增 ButlerTaskStore。
- 新增 Butler 编排工具。
- WS 暴露 Butler task summary。
- 前端 butlerTasks store 接入真实 API。

验收：

- Butler 派发任务时创建 Global TODO 和 ButlerTask。
- ButlerSidebar 使用真实摘要。
- Global TODO 只使用最小状态集合。

### Phase 4 - GroupButlerBridge

目标：

- Group 关键事件能回到 Butler，用户回复能回到 Group。

工作：

- 新增 GroupButlerBinding。
- 新增 GroupButlerBridge。
- Host 工具接入桥接。
- Butler 工具支持回复 Group。
- 事件去重和冷却。

验收：

- `needs_user_decision` 进入 `waiting_user`。
- `completed` 回传到 Butler。
- 普通群组消息不刷屏 Butler。
- 用户在 Butler 回复后 Group 能继续。

### Phase 5 - Agent 能力与任务收件箱

目标：

- Butler 和 Host 可基于能力卡调度 Agent。
- Agent 承接任务后有状态和成长闭环。

工作：

- AgentCapabilityCard。
- AgentTaskInbox。
- Agent 完成后续作判断。
- Experience 自动写入。
- GrowthProposal。

验收：

- Butler 可读取 Agent 能力。
- Agent 接收任务后创建 inbox item。
- Agent 完成后写经验。
- JOB / CHARACTER 只生成建议，不静默改。

### Phase 6 - Group prompt 与协作规则收敛

目标：

- 不重写群组引擎，通过 prompt 和 GUIDE 明确协作边界。

工作：

- 重写 Host JOB。
- 重写 Group GUIDE。
- 强化 Agent 群组上下文。
- 强化 `group-send` 工具说明。
- 弱化用户表层对大量工作区文档的感知。

验收：

- Host 不默认 @all。
- Agent 中途可 `group-send` 并继续工作。
- 设计、预算、授权等审批点会上浮。
- 缺资源时请求 Host / Butler。

### Phase 7 - Market 架构

目标：

- 先做资源包、Resolver、Install Plan 和本地 fork，不先做大页面。

工作：

- 定义 `cobeing.resource.json` schema。
- Market index 扫描。
- Resolver。
- Install Planner。
- Local Installer。
- Butler Market 工具。

验收：

- 一个资源包可扫描。
- 依赖树可生成。
- 高风险依赖会提升整体风险。
- 官方认证资源可被 Butler 推荐。
- 社区未认证资源不能静默安装。
- 安装后本地资源有 source 元数据。

### Phase 8 - 插件动态发现与扩展页维护

目标：

- 前端能力选择来自插件管道，不靠硬编码。

工作：

- `list_plugins` 返回完整 PluginInfo。
- pluginsStore 接收并提供 provider / channel / model。
- Provider / model 选择器移除硬编码 catalog。
- PluginsTab 动态渲染 configSchema。
- SettingsView 接入 settings-panel。

验收：

- GUI provider / channel 列表与 `list_plugins` 一致。
- 自定义 provider / channel 实例增删改后可见。
- 插件设置面板能出现。
- 旧配置向后兼容。

---

## 19. 测试策略

### 19.1 后端单元测试

必须覆盖：

- GlobalTodoStore 创建、更新、查询、取消。
- ButlerTaskStore 创建、状态映射、按 Global TODO 查找。
- GroupButlerBridge 事件去重、状态映射、用户回复回传。
- AgentCapabilityCard 读取和更新。
- AgentTaskInbox 接收、报告、完成。
- Market manifest 解析、依赖树、风险聚合、安装计划。
- ToolAgentSpec 解析和失败策略。

### 19.2 后端集成测试

必须覆盖：

- Butler 派发任务到已有 Group。
- Butler 派发任务到已有 Agent。
- Group 触发 `needs_user_decision` 后 Butler 和 Global TODO 进入 `waiting_user`。
- Group 完成后 Butler 收到结果。
- 普通 Group 消息不回传 Butler。
- Agent 完成任务后触发续作判断。
- 社区未认证 Market 资源不能静默安装。
- Plugin dynamic discovery 返回已启用插件和模型列表。

### 19.3 前端测试

必须覆盖：

- `getVisibleUserAgents` 过滤 `butler` / `host`。
- Agent 列表空状态。
- ButlerSidebar 空状态和摘要状态。
- TaskReceiptCard metadata 有无时的渲染。
- ChatInputActions 在 Butler / Agent / Group 视图按钮集合不同。
- Provider / model 选择器从 pluginsStore 读取。
- 插件 configSchema 动态表单兜底。

### 19.4 手动验收

必须走通：

1. 打开 Butler 页面，看到左侧轻量摘要、主聊天、右侧设置入口。
2. Agent 页面不显示 `butler` / `host`。
3. 创建群组和添加成员时不提供 `butler` / `host`。
4. Butler 派发任务后聊天出现回执。
5. Group 需要用户选择时 Butler 入口出现问题。
6. 用户回复后 Group 继续推进。
7. Extensions 页面能看到 Skills / MCPs / Plugins。
8. Provider / Channel 列表来自插件发现。
9. UI 没有新增过小字号和硬编码颜色。
10. `pnpm build` 通过；涉及核心逻辑时 `pnpm test` 通过。

---

## 20. 关键边界情况

### 后端尚未实现 ButlerTask API

前端 ButlerSidebar 显示空摘要或派生摘要。文案：

```text
暂无托管摘要
```

不得阻塞管家页布局优化。

### Agent 列表过滤后为空

显示：

```text
还没有普通智能体
```

提供新建 Agent 动作。不要回退显示 `butler` 或 `host`。

### Group 长时间无回传

Global TODO 保持 `running`，写入 `nextAction` 为“需要查询状态”或由 Butler 主动请求 `status_digest`。不要自动认定失败。

### Group 反复卡住

Bridge 合并同类事件，由 Butler 总结为一个决策问题。

### 用户直接进入群组回复

允许，但 ButlerTask / Global TODO 必须同步状态，否则 Butler 入口会失去任务感知。

### 任务完成后用户要求返工

可以创建后续任务，或把 ButlerTask 从 `completed` 转回 `running`。如果返工改变范围或偏好，先向用户确认。

### Market 资源被撤回

通知用户或建议禁用高风险本地资源，不静默删除用户本地 fork。

### ToolAgent 失败

按 failurePolicy 处理。除安全门禁外，ToolAgent 失败不应让主任务永久挂起。

---

## 21. 当前代码事实与注意事项

当前项目已经具备：

- `CoBeing/packages/core/src/runtime.ts` 顶层运行时。
- Butler、AgentRegistry、ToolAgent 基础。
- Group、GroupManager、WakeSystem、Group TODO。
- Agent / Group TODO store 和 scanner。
- SkillRepository、MCP manager、Plugin SDK、UI extension 基础。
- `list_plugins` 和 `pluginsStore` 的已有实现基础。
- GUI 六入口：管家、智能体、群组、仪表盘、扩展、设置。
- `ButlerConfigPanel`、`AgentDetailPanel`、`GroupDetailPanel`、`TodoPanel`。

已知风险：

1. `get_group_health` 若仍读取 `(g2 as any).groupTodoStore`，后续健康监控应改为 `GroupManager.getGroupTodoStore(groupId)`。
2. GUI 当前 TODO scope 主要是 `agent / group`，Global TODO 不应硬塞进现有 TODO 面板。
3. Agent / Group TODO 状态与 Global TODO 状态不同，不要强行统一旧状态。
4. 动态注册工具后要确认 Agent loop 工具列表刷新，避免 Butler 新工具不可见。
5. `ChatView.tsx` 和 `GroupChatView.tsx` 体量较大，拆分必须服务当前接入，不做无关大重构。
6. 修改 `.ts` 源码后必须在 `CoBeing/` 运行 `pnpm build`。

---

## 22. 交付验收清单

### 产品验收

- 用户可以一直在 Butler 入口提交复杂任务、查看问题、收到结果。
- Butler 只直接处理简单任务，复杂任务会派发。
- Group 过程不刷屏 Butler。
- Agent 页面只展示普通 Agent。
- Market 不成为普通用户的默认主入口。
- TODOboard 不呈现为用户手动维护的大看板。

### 技术验收

- Global TODO、ButlerTask、GroupButlerBinding、ButlerEscalationEvent 关系清晰。
- 局部 `blocked` / `failed` 正确映射到 Global 最小状态。
- 任务承担 Agent 拥有续作判断权。
- Host 承担群组路由和收束，不替成员做续作判断。
- Market 安装前有依赖树、风险、权限和确认项。
- ToolAgent 默认后台运行，并由调用方应用结果。

### 前端验收

- 管家页拥有轻量侧栏、主聊天、右侧设置抽屉。
- 任务回执卡可在聊天中展示。
- 输入区动作低视觉权重。
- `butler` / `host` 不出现在普通 Agent 界面。
- UI 遵守渐变基底、半透明面板、充足留白、字号底线和 token 色彩。
- 扩展页继续承担 Skills / MCPs / Plugins 进阶管理。
- Provider / Channel / Model 能力由插件动态发现。

---

## 23. 最终统一口径

CoBeing 的核心不是做一个更复杂的后台，而是给个人用户一个可以托付事务的 AI Team 入口。

Butler 是入口和托管层；Agent 是长期专业联系人；Group 是长期场景空间；Host 是群组责任协调者；TODOboard 是三层任务账本；Market 是可信能力供应链；ToolAgent 是后台临时窄能力。

前端必须服务这个结构：聊天是主体验，任务只轻量摘要，复杂详情按需展开。管家入口要更清晰，但不能大屏化。Agent 页面只给用户管理真正的普通 Agent，`butler` 和 `host` 都不混入。扩展能力要动态可发现，但普通用户不需要先学会插件、MCP 和 Market。

如果后续实现遇到取舍，优先保住三件事：

1. 普通用户低认知负担。
2. 角色责任边界清楚。
3. 系统能力可持续扩展且可审查。
