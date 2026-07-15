# 通用智能体能力与增强 — 设计文档

> 日期：2026-06-08 | 状态：已确认方向

## 背景

CoBeing 的通用智能体不是一次性工具，也不是系统入口。它更像用户长期拥有的 AI 联系人：有角色、有职责、有记忆、有经验，可以被管家调度，也可以在群组里承担专业任务。

当前项目已经有 Agent 五文件体系、工具注册、记忆、经验、TODO、技能、MCP、群组工具和 Provider fallback。下一步要解决的是：通用智能体自身如何拥有更清晰的能力边界、任务状态、成长机制和可调度能力。

本设计只研究“通用智能体自身”这一维度，不实现管家入口、群组协议、完整 TODOboard、Market 审核或工具智能体标准化。相关维度会分别探索后再统一进入实现计划。

## 已确认设计决策

| 维度 | 决策 |
| --- | --- |
| 通用智能体定位 | 长期存在、可定制、可被调度的专业 AI 联系人 |
| 与管家的关系 | 管家负责入口与派发，通用智能体负责具体工作 |
| 与工具智能体的关系 | 通用智能体保留角色和长期上下文，窄能力交给工具智能体 |
| 成长策略 | `EXPERIENCE.md` 可自动写，`JOB.md` 可提出修改建议，`CHARACTER.md` 必须用户或管家确认后再改 |
| 能力描述 | 需要机器可读的 Capability Card，供管家和群组调度 |
| 任务承接 | 需要 Agent Task Inbox，并与全局 TODOboard / Agent TODO 关联 |
| 增强方向 | Profile + Capability Card + Task Inbox + Skills + Memory/Experience + Reflection Loop |

## 目标

1. 明确通用智能体应该具备哪些核心能力。
2. 让管家能可靠判断哪个 Agent 适合接某类任务。
3. 让 Agent 能接收、执行、汇报、阻塞、完成任务，而不是只聊天。
4. 让 Agent 的长期经验持续积累，但不失控修改人格。
5. 让 Agent 可以通过技能、工具智能体和 Market 资源增强自己。
6. 让 Agent 在独立工作和群组协作中都能保持边界清晰。
7. 让 Agent 的成长可以被审查、回滚和复用。

## 非目标

1. 不把通用智能体变成管家。
2. 不让每个 Agent 无限膨胀成万能助手。
3. 不让 Agent 自己静默安装 Market 资源。
4. 不让 Agent 自动随意修改 `CHARACTER.md`。
5. 不在本设计中完成工具智能体标准协议。
6. 不在本设计中实现完整全局 TODOboard 看板。

## 通用智能体需要的能力

### 1. 身份能力

Agent 必须知道自己是谁、怎么说话、服务什么场景。当前由 `CHARACTER.md` 承载。

身份能力包含：

- 名字。
- 角色。
- 背景。
- 语言风格。
- 典型表达。
- 不说什么。
- 与用户的关系感。

身份不是装饰。它影响用户是否愿意长期使用这个 Agent，也影响 Agent 在群组中的表达方式。

### 2. 专业方法能力

Agent 必须有自己的工作方法。当前由 `JOB.md` 承载。

专业方法能力包含：

- 专注领域。
- 思考方式。
- 标准工作流程。
- 决策原则。
- 输出规范。
- 验收标准。
- 遇到不确定性时的处理方式。

越强的 Agent 越不应该只靠模型临场发挥，而应该有稳定方法论。

### 3. 能力画像能力

Agent 需要一张机器可读的 Capability Card，用于调度和自我边界判断。

Capability Card 应描述：

- 擅长任务。
- 不擅长任务。
- 输入要求。
- 输出格式。
- 常用工具。
- 常用技能。
- 需要协作的场景。
- 需要用户确认的场景。
- 可靠性和历史表现。

这张卡不是给用户看的简历，而是给 Butler、Host、Group 和运行时看的调度接口。

### 4. 工具执行能力

Agent 应有与职责匹配的工具集合：

- 文件读取/写入/编辑。
- 搜索。
- bash。
- web-fetch。
- memory。
- TODO。
- group-send。
- MCP 工具。
- 领域插件工具。

原则：工具不是越多越好。工具白名单应来自角色职责、权限边界和任务需要。

### 5. 任务承接能力

Agent 要能接收来自三种来源的任务：

- 用户直接对话。
- Butler 派发。
- Group/Host 分配。

接收任务时，Agent 应明确：

- 任务目标。
- 验收标准。
- 约束条件。
- 截止时间。
- 交付物。
- 是否属于全局 TODOboard。
- 是否有上游/下游依赖。

### 6. 状态表达能力

Agent 必须能表达自己的状态：

- `idle`：空闲。
- `running`：正在执行。
- `blocked`：阻塞。
- `waiting_user`：等待用户。
- `waiting_dependency`：等待其他 Agent。
- `completed`：完成。
- `failed`：失败。

这是 Agent 自己的任务收件箱状态，不是全局 TODOboard 的主状态。全局 TODOboard 只使用 `pending` / `running` / `waiting_user` / `completed` / `cancelled`；Agent 局部的 `blocked`、`waiting_dependency`、`failed` 应映射为全局条目的 `running` 或 `waiting_user`，并通过阻塞原因、依赖引用、失败摘要和下一步字段解释。

这不是前端展示而已。状态决定管家是否继续派发、群主是否需要介入、TODOboard 是否需要更新。

### 7. 记忆能力

Agent 需要分层记忆：

- `MEMORY.md`：独立会话事件记录。
- `memory/YYYY-MM-DD.md`：每日交互记录。
- `EXPERIENCE.md`：长期经验、用户偏好、工具心得、教训。
- 群组记忆：在群组场景中由群组系统管理，不能混入独立私有记忆。

记忆增强的关键不是写得多，而是写得准、可检索、不过度污染当前上下文。

### 8. 经验沉淀能力

Agent 完成复杂任务后，应自动反思并写入 `EXPERIENCE.md`。

经验应包含：

- 做了什么。
- 哪些方法有效。
- 哪些工具有效。
- 用户偏好。
- 失败或返工原因。
- 下次遇到类似任务怎么做。

`EXPERIENCE.md` 是 Agent 变强的主要自动写入点。

### 9. 自我改进建议能力

Agent 可以提出对自身的改造建议，但不同文件的权限不同：

| 文件 | 自动修改策略 |
| --- | --- |
| `EXPERIENCE.md` | 可自动追加 |
| `JOB.md` | 可提出修改建议，经管家或用户确认后应用 |
| `CHARACTER.md` | 必须用户或管家确认后才能修改 |
| `config.json` | 涉及权限、模型、工具、技能，必须确认或走管家授权 |

这保证 Agent 能成长，但不会人格漂移或权限失控。

### 10. 技能装载能力

Agent 可以通过 Skills 变强。Skills 是工作方法，不是人格，也不是领域知识。

示例：

- 资料调研技能。
- 代码审查技能。
- 旅行规划技能。
- 学习陪伴技能。
- 写作润色技能。
- 项目拆解技能。

Agent 可以建议需要某个技能，但安装和启用应由管家或用户确认。

### 11. 工具智能体协作能力

通用智能体不应把所有窄能力塞进自身 prompt。遇到窄任务时，可以调用或请求工具智能体：

- 记忆提取。
- 事实核查。
- 格式转换。
- 结果审查。
- 克隆/生成 Agent。
- 判断是否需要唤醒 Host。

通用智能体负责场景理解和任务推进，工具智能体负责可重复专业动作。

### 12. 群组协作能力

在 Group 中，Agent 要遵守协作规则：

- 被 @mention 时响应。
- 接到 TODO 时执行。
- 完成后汇报结果。
- 遇到阻塞时说明原因。
- 需要其他成员时 @mention。
- 不越权指挥其他 Agent。
- 不访问不属于自己的工作空间。
- 不把私有记忆泄露到群组。

群组中 Agent 的强弱，不只看单次回答质量，也看它是否能可靠推进协作。

### 13. 验证能力

Agent 完成任务前应尽量验证结果：

- 代码任务运行测试或构建。
- 文档任务检查结构和遗漏。
- 调研任务标注来源和不确定性。
- 文件任务确认文件存在和内容正确。
- 群组任务确认 TODO 状态和交付物。

强 Agent 的标志是“交付有证据”，不是“回答很自信”。

### 14. 边界能力

Agent 必须知道何时拒绝、转交或请求帮助：

- 任务不属于自己领域。
- 权限不足。
- 需要用户隐私或外部授权。
- 任务范围过大。
- 需要多个角色协作。
- 存在安全风险。

越强的 Agent 越会保护边界。

## 推荐增强架构

采用：

```text
Agent Profile
  ├── CHARACTER.md
  ├── JOB.md
  ├── MEMORY.md
  ├── EXPERIENCE.md
  ├── config.json
  ├── Capability Card
  ├── Task Inbox
  ├── Skill Loadout
  └── Reflection Loop
```

### AgentCapabilityCard

机器可读能力卡，供 Butler/Host/Group 调度。

```ts
interface AgentCapabilityCard {
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

### AgentTaskInboxItem

Agent 自己的任务收件箱。它可以关联全局 TODOboard 和 Agent TODO。

```ts
interface AgentTaskInboxItem {
  id: string;
  globalTodoId?: string;
  agentTodoId?: string;
  sourceType: "user" | "butler" | "group" | "system";
  sourceId: string;
  title: string;
  goal: string;
  acceptance?: string;
  constraints?: string[];
  /** Agent 局部任务状态。映射到 Global TODO 时必须压缩为全局最小状态集合。 */
  status: "pending" | "running" | "blocked" | "waiting_user" | "waiting_dependency" | "completed" | "failed" | "cancelled";
  blockerReason?: string;
  dependencyRefs?: Array<{ agentId: string; todoId?: string; reason: string }>;
  failureSummary?: string;
  artifacts?: Array<{ name: string; path?: string; description?: string }>;
  createdAt: string;
  updatedAt: string;
}
```

### AgentReflectionRecord

任务结束后的反思记录。

```ts
interface AgentReflectionRecord {
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

需要确认后才能应用的成长建议。

```ts
interface AgentGrowthProposal {
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

## 核心流程

### 流程 1：Agent 接收管家派发任务

1. Butler 根据 Capability Card 选择 Agent。
2. Butler 创建或关联全局 TODOboard 条目。
3. Butler 将任务派发给 Agent。
4. Agent 创建 AgentTaskInboxItem。
5. Agent 判断是否能独立完成。
6. 能完成则执行；不能完成则请求 Butler 改派、组建群组或补充资源。
7. Agent 完成后提交结果、证据、产物。
8. Agent 作为当前任务承担者判断是否需要续作；低风险明确后续可生成个人或执行空间内 TODO，跨层、扩权或需要用户选择时请求 Butler/群主承接。
9. Agent 自动写入 EXPERIENCE。
10. 如需更新 JOB 或 CHARACTER，生成 GrowthProposal。

### 流程 2：Agent 独立工作变强

1. Agent 完成复杂任务。
2. Reflection Loop 提取经验。
3. 可自动写入 `EXPERIENCE.md`。
4. 若经验反复出现，生成 `JOB.md` 修改建议。
5. 若涉及人格、语气、关系感，生成 `CHARACTER.md` 修改建议。
6. 管家或用户审查后应用。

### 流程 3：Agent 在群组中工作

1. Host 或其他成员 @mention Agent。
2. Agent 读取群组裁剪上下文。
3. Agent 判断自己负责什么。
4. Agent 执行任务。
5. 完成后用 group-send 汇报。
6. 遇到阻塞时说明原因并 @mention 需要协助的人。
7. 重要经验可写入个人 EXPERIENCE，也可通过群组经验工具写入群组经验。

### 流程 4：Agent 请求 Market 增强

1. Agent 发现自己缺少某个技能、插件、工具或模板。
2. Agent 不直接安装。
3. Agent 向 Butler 提出资源需求。
4. Butler 搜索 Market。
5. 用户确认后安装或创建资源。
6. Agent 的 config 或 Capability Card 更新。

## 推荐工具与接口

### agent-get-capability

读取 AgentCapabilityCard，供 Butler、Host 或前端查看。

### agent-update-capability

更新 Capability Card。自动更新应仅限低风险字段；职责、限制和权限变更需要确认。

### agent-task-accept

Agent 接收任务并创建 AgentTaskInboxItem。

### agent-task-report

Agent 汇报进度、阻塞或完成结果。

### agent-task-complete

Agent 完成任务，提交交付物、证据和反思触发信号。

### agent-reflect-experience

任务完成后提取经验，自动写入 `EXPERIENCE.md`。

### agent-propose-job-update

生成 `JOB.md` 修改建议，等待 Butler 或用户确认。

### agent-propose-character-update

生成 `CHARACTER.md` 修改建议，必须确认后应用。

### agent-request-market-resource

Agent 向 Butler 说明缺少什么资源，由 Butler 负责 Market 检索和授权。

## 文件策略

### CHARACTER.md

用途：人格、声音、关系感。

策略：必须确认后修改。不能因为一次任务就自动改人格。

### JOB.md

用途：专业方法论、工作流程、判断标准。

策略：可以提出修改建议。适合在多次任务反复出现同一经验后更新。

### MEMORY.md

用途：独立会话事件记录。

策略：自动追加要简洁，不能写群组内部隐私。

### EXPERIENCE.md

用途：长期经验、用户偏好、工具心得、教训。

策略：可自动写，是 Agent 成长的主要自动沉淀点。

### config.json

用途：模型、工具、权限、沙箱、技能白名单。

策略：涉及权限和工具扩展必须确认。技能启用可由管家按资源策略辅助。

## 变强的判断标准

一个 Agent 变强，不是因为它说得更多，而是因为它：

1. 更清楚自己擅长什么。
2. 更少接错任务。
3. 更会使用正确工具。
4. 更能按验收标准交付。
5. 更会报告阻塞。
6. 更能从经验中改进流程。
7. 更少重复犯错。
8. 更能在群组中配合别人。
9. 更能保护用户隐私和权限边界。
10. 更容易被管家正确调度。

## 边界情况

### Agent 接到不适合自己的任务

Agent 应说明原因，并建议交给更合适的 Agent、Group 或工具智能体。

### Agent 需要新工具或技能

Agent 只能提出需求，不能静默安装。由 Butler 负责检索 Market 和请求用户授权。

### Agent 多次失败

记录失败原因，降低对应任务类型的可靠性评分，并生成 JOB 更新建议。

### Agent 在群组里泄露私有记忆风险

群组上下文默认不加载 `MEMORY.md`。如果需要用户偏好，应通过受控摘要注入。

### Agent 自动写入经验过多

Experience 写入应经过摘要和去重。重复经验合并到经验概要，不无限追加长日志。

### Agent 人格漂移

CHARACTER 修改必须确认。自动反思只能生成建议，不直接应用。

## 测试与验收方向

后续实现时至少覆盖：

1. Agent 可以读取 Capability Card。
2. Butler 可以基于 Capability Card 选择 Agent。
3. Agent 接收任务后创建 Task Inbox 记录。
4. Agent 完成自己承担的任务后会运行续作判断，而不是让 Butler 或群主代替判断。
5. Agent 完成任务后自动写入 EXPERIENCE。
6. Agent 只能生成 JOB 修改建议，不能静默改 JOB。
7. Agent 只能生成 CHARACTER 修改建议，必须确认后应用。
8. Agent 请求 Market 资源时不会直接安装。
9. Agent 群组上下文不加载私有 MEMORY。
10. Agent 任务失败会形成反思记录。
11. Agent 的可靠性指标能被更新。

## 推荐实施分层

后续统一进入实现时，建议分五层：

1. **能力层**：AgentCapabilityCard 和读取/更新接口。
2. **任务层**：AgentTaskInbox，与全局 TODOboard / Agent TODO 关联。
3. **成长层**：Reflection Loop、Experience 自动写入、GrowthProposal。
4. **资源层**：Agent 请求 Skill/Plugin/Market 资源，由 Butler 授权执行。
5. **前端层**：Agent 能力卡、任务收件箱、成长建议审查面板。

## 最终口径

通用智能体的强，不是“更像万能助手”，而是“更像可靠专业联系人”。

它应该有清晰角色、稳定方法、可调度能力、任务状态、经验沉淀和自我改进建议。

`EXPERIENCE.md` 是自动成长层，`JOB.md` 是可审查的方法升级层，`CHARACTER.md` 是必须确认的人格层。

通用智能体负责具体工作；管家负责入口和派发；工具智能体负责窄能力；群组负责多角色协作。边界越清楚，整个 Agent Team 越强。
