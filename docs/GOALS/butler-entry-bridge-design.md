# 管家入口与群组事件桥接 — 设计文档

> 日期：2026-06-08 | 状态：已确认方向

## 背景

CoBeing 的产品定位要求普通用户可以只面对管家，把 Agent、Group、Skill、Plugin 等复杂结构藏在自然语言入口之后。现有代码中 Butler 已经能创建 Agent、创建 Group、运行 Group、添加成员、检查群组和操作 TODO，但 Butler 与 Group 之间更像“工具调用关系”，而不是稳定的“任务托管关系”。

当前主要缺口是：用户把需求交给管家后，群组可以在内部推进，但管家不会天然成为任务状态中枢；群组卡住、需要用户决策、任务完成时，也缺少结构化通道把关键事件回到管家入口。

本设计只解决“管家入口”这一维度，不进入 Agent 细节、TODOboard 完整看板、群组 GUI 工作台或 Market 评分体系。后续维度探索完后，再统一进入实现计划。

## 已确认设计决策

| 维度 | 决策 |
| --- | --- |
| 管家默认接收范围 | 只收关键事件，按需拉取摘要 |
| 群组协作桥接方案 | 事件桥接型 |
| 管家分身形态 | 群组内虚拟身份/绑定关系，不复制真实 Butler LLM 实例 |
| 群组回传触发 | 卡住、需要用户决策、完成、失败、范围变化 |
| 普通过程消息 | 默认留在群组内部，不推送到管家 |
| 用户体验目标 | 用户可以一直在管家入口交互，由管家委派、追踪、回传和收尾 |
| 派发任务登记 | 进入全局 TODOboard，任务接受者可以是 Agent 或 Group |
| 管家工作边界 | 管家只负责对话和简单工作，稍复杂任务必须派发 |
| Market 能力 | 管家可以从 Market 检索、拉取或安装资源，但受来源、权限和用户授权约束 |

## 目标

1. 让 Butler 从“能操作 Agent/Group 的工具 Agent”升级为“用户入口与任务托管中心”。
2. 让用户可以直接在 Butler 对话里提出需求，由 Butler 选择 Agent 或 Group 执行。
3. 让 Group 可以在不打扰用户的前提下独立工作。
4. 让 Group 在关键节点把结构化事件回传给 Butler。
5. 让 Butler 能把群组事件翻译成用户能理解的问题、决策项或完成结果。
6. 让用户的回复能通过 Butler 回到对应 Group，继续推动工作。
7. 保持 Butler 人格一致，不让每个群组产生一个分裂的真实管家。
8. 让 Butler 派发的任务统一进入全局 TODOboard，形成用户级任务总账。
9. 让 Butler 可以按规则从 Market 获取 Agent、Group、Skill、Plugin 等资源。

## 非目标

1. 不让 Butler 旁听所有群组消息。
2. 不把 Butler 变成每个群组里的常驻参与成员。
3. 不让任意 Agent 直接频繁打扰用户。
4. 不在本设计中实现完整 TODOboard 看板，只定义 Butler 如何接入全局 TODOboard。
5. 不在本设计中实现 Market 评分和审核体系，只定义 Butler 需要具备的拉取资源能力与安全边界。
6. 不重写现有 Group/WakeSystem，只在其上增加桥接协议。

## 管家需要具备的能力

### 1. 用户入口能力

Butler 要能接住用户的自然语言需求，并判断下一步路径：

- 自己直接回答。
- 转给某个已有 Agent。
- 转给某个已有 Group。
- 创建新的 Agent。
- 创建新的 Group。
- 先向用户追问缺失信息。
- 拒绝或要求授权高风险动作。

这里的关键不是工具数量，而是 Butler 必须知道“什么时候不自己做”。管家主要做理解、调度、解释、决策中继和收尾。

管家的直接工作边界必须收窄：

- 可以做：寒暄、解释系统状态、短文本润色、简单问答、列出资源、查询任务状态、把用户回复转交给 Agent/Group。
- 不应做：多步骤研究、复杂规划、长文创作、代码修改、需要多个工具的任务、需要长期跟踪的任务、需要成员协作的任务。
- 一旦任务超过“单轮或短上下文即可完成”的范围，Butler 应默认派发，而不是自己硬做。

这条边界很重要：Butler 的价值不是自己变成万能 Agent，而是降低用户使用 Agent Team 的门槛。

### 2. 资源理解能力

Butler 需要维护或查询一份轻量资源地图：

- Agent 列表、能力、状态、最近用途。
- Group 列表、目标、成员、状态、未完成任务。
- 每个 Group 是否绑定了管家分身。
- 每个正在运行的 ButlerTask 属于哪个 Agent/Group。
- 哪些任务正在等待用户决策。
- 全局 TODOboard 上有哪些由 Butler 派发的任务。
- Market 中有哪些可用资源可以补足当前需求。

现有 `butler-list` 和 `butler-check-group` 是基础，但还不够。未来应形成结构化的 `ButlerTask` 账本，而不是每次只靠 LLM 读文本判断。

### 3. 路由与委派能力

Butler 要能把用户一句话转成可执行任务上下文：

- 任务目标。
- 期望结果。
- 验收标准。
- 用户偏好。
- 限制条件。
- 是否允许创建新资源。
- 是否需要阶段性询问用户。
- 目标 Agent/Group。
- 对应的全局 TODOboard 条目。
- 是否需要从 Market 拉取资源。

委派不是简单发一句话，而是创建一个可追踪任务。这个任务应先进入全局 TODOboard，再被分配给 Agent 或 Group。

### 4. 托管与追踪能力

用户把任务交出去后，Butler 应保留一个任务状态：

- `routing`：正在判断交给谁。
- `dispatched`：已派发。
- `running`：目标 Agent/Group 正在处理。
- `waiting_user`：等待用户决策。
- `completed`：完成。
- `failed`：失败。
- `cancelled`：用户取消。

这里描述的是 ButlerTask 的生命周期，不是全局 TODOboard 的主状态。全局 TODOboard 只使用后续 TODOboard 设计中定义的最小状态集合：`pending` / `running` / `waiting_user` / `completed` / `cancelled`。如果 ButlerTask 失败或阻塞，全局条目应通过 `lastEvent`、`blockerReason`、`nextAction` 等字段解释原因，而不是新增 `failed` 或 `blocked` 主状态。

Butler 对用户的回答应能引用这些任务，而不需要用户记住群组 ID。

### 5. 全局 TODOboard 接入能力

Butler 派发任务时，应把任务登记到全局 TODOboard。全局 TODOboard 是用户级任务总账，记录“用户交给系统的事”；Agent TODO 和 Group TODO 是执行空间内部的任务拆解。

推荐关系：

```text
Global TODOboard Item
  ├── assigneeType: agent | group
  ├── assigneeId: Agent ID 或 Group ID
  ├── responsibleAgentId: 当前负责执行和判断续作的 Agent
  ├── butlerTaskId: ButlerTask ID
  └── executionTodos: Agent TODO 或 Group TODO 的子任务引用
```

全局 TODOboard 不替代群组 TODO。它负责给用户和 Butler 一个稳定入口：这件事现在交给谁、状态是什么、是否等待我、结果在哪里。

### 6. Market 资源拉取能力

Butler 需要具备从 Market 拉取资源的能力，但必须遵循“先本地，后官方，社区需授权”的顺序：

1. 优先复用已有 Agent/Group/Skill/Plugin。
2. 本地没有合适资源时，检索官方认证资源。
3. 官方资源明显匹配时，向用户轻量说明并请求确认。
4. 只有社区资源匹配时，必须展示来源、权限、依赖、风险和替代方案，由用户主动授权。
5. 安装 Group 时展示依赖的 Agents、Skills、Plugins。
6. 安装 Agent 时展示依赖的 Skills、Plugins。

Market 能力不应让 Butler 把大量搜索结果丢给用户。Butler 要做筛选和解释，只在有明确价值差异时提出少量候选。

### 7. 关键事件回传能力

群组应只在关键节点回传 Butler：

- `needs_user_decision`：需要用户做选择。
- `blocked`：缺资料、缺权限、缺外部输入，无法继续。
- `completed`：任务完成，返回结果。
- `failed`：任务失败，说明原因和备选方案。
- `scope_change`：任务变大或目标变化，需要用户确认。
- `status_digest`：管家按需查询时返回摘要。

这些是 Group 回传 Butler 的事件类型，不等同于全局 TODOboard 主状态。`blocked` / `failed` 事件到达后，应由 Bridge 映射为全局条目的 `running` 或 `waiting_user`，并把阻塞、失败、备选方案写入事件摘要和下一步字段。

普通讨论、成员进度、内部争论、工具日志不主动回传。

### 8. 决策中继能力

当 Group 需要用户决策时，Butler 要做三件事：

1. 把群组的技术性问题压缩成用户能回答的问题。
2. 给出少量选项和推荐方案。
3. 把用户选择带回原 Group，并恢复任务。

用户不应该看到“请进入某群组自己读上下文”。默认路径应该是“管家问，用户答，管家转回去”。

### 9. 结果交付能力

Group 完成后不应只在群里留一条消息。它要通过桥接事件交给 Butler：

- 完成摘要。
- 主要产物。
- 文件或工作区路径。
- 验收情况。
- 后续建议。
- 是否需要用户确认归档。

Butler 再把这些整理成面向用户的最终回复。

### 10. 噪音控制能力

系统必须防止 Group 把用户入口刷屏：

- 只有 Host 或系统桥接工具可以主动回传 Butler。
- 回传事件需要类型、原因和任务 ID。
- 同一任务的阻塞事件需要去重和冷却。
- 普通进度默认不推送，只进入群组历史和摘要。
- Butler 可以主动查询摘要，但摘要由 Group 生成，不是把全文塞给 Butler。

### 11. 人格一致能力

“管家分身”不能是每个群组复制一个真实 Butler Agent。否则会有多个问题：

- 管家人格分裂。
- 长期记忆分叉。
- 上下文成本增加。
- 群组内部讨论污染用户入口。
- 同一个用户偏好可能被不同分身解释不同。

因此推荐：管家分身是 `GroupButlerBinding`，即一个群组内可寻址的虚拟身份和事件端点。真实 Butler 仍只有一个。

### 12. 权限与安全能力

Butler 是用户代理，Group 是执行空间。两者之间需要边界：

- Group 不能静默扩大任务范围。
- Group 需要高风险权限时必须回传 Butler，由 Butler 请求用户授权。
- Group 不能绕过 Butler 直接向用户索要敏感信息，除非用户主动进入群组。
- Butler 可以取消、暂停、恢复由自己派发的任务。
- 回传给 Butler 的内容必须是摘要和决策项，而不是原始长日志。

## 推荐架构

采用 **Global TODOboard + ButlerTask + GroupButlerBinding + ButlerEscalationEvent** 四层结构。

```text
User
  ↓
Butler 主入口
  ↓ 创建/更新全局 TODOboard 条目与 ButlerTask
Dispatch Router
  ↓
Agent 或 Group
  ↓
Group 内部由 Host/WakeSystem/TODO 推进
  ↓ 仅关键节点
GroupButlerBridge
  ↓
Butler 收到 Escalation Event
  ↓
用户决策或最终结果
```

### ButlerTask

ButlerTask 是管家侧任务账本。它不替代全局 TODOboard，而是记录“管家如何托管这件事”。全局 TODOboard 是用户级任务总账，ButlerTask 是管家的编排记录。

建议字段：

```ts
interface ButlerTask {
  id: string;
  globalTodoId: string;
  userMessageId?: string;
  title: string;
  goal: string;
  targetType: "agent" | "group";
  targetId: string;
  status: "routing" | "dispatched" | "running" | "waiting_user" | "completed" | "failed" | "cancelled";
  acceptance?: string;
  constraints?: string[];
  userPreferences?: string[];
  marketResources?: Array<{
    id: string;
    kind: "agent" | "group" | "skill" | "plugin";
    source: "official" | "community" | "local";
    status: "suggested" | "approved" | "installed" | "rejected";
  }>;
  latestSummary?: string;
  pendingQuestion?: ButlerUserQuestion;
  createdAt: string;
  updatedAt: string;
}
```

### GlobalTodoItem

全局 TODOboard 条目用于面向用户展示和跨空间追踪。它可以把执行接受者设为 Group。

建议字段：

```ts
interface GlobalTodoItem {
  id: string;
  title: string;
  description: string;
  status: "pending" | "running" | "waiting_user" | "completed" | "cancelled";
  assigneeType: "butler" | "agent" | "group";
  assigneeId: string;
  /** 当前负责执行和判断续作的 Agent。assigneeType=group 时也应尽量明确。 */
  responsibleAgentId?: string;
  butlerTaskId?: string;
  executionRefs?: Array<{
    scope: "agent" | "group";
    ownerId: string;
    todoId: string;
  }>;
  lastEvent?: ButlerEscalationEvent;
  blockerReason?: string;
  nextAction?: string;
  createdBy: "user" | "butler";
  createdAt: string;
  updatedAt: string;
}
```

全局条目不使用 `blocked` / `failed` 作为主状态。需要用户处理的阻塞映射为 `waiting_user`；仍可由 Butler、群主或 Agent 自行恢复的异常保持 `running` 并记录原因。自动续作的判断权属于 `responsibleAgentId` 指向的任务承担 Agent；如果该字段为空，Bridge 不应自动生成后续 TODO，而应先让 Butler 或群主明确当前承担者。

### GroupButlerBinding

GroupButlerBinding 是每个群组注册时创建的管家分身绑定。它让群组可以“把关键事件交给管家”，但不复制真实 Butler。

建议字段：

```ts
interface GroupButlerBinding {
  groupId: string;
  butlerId: "butler";
  alias: string; // 例如 "@butler" 或 "@管家"
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

### ButlerEscalationEvent

ButlerEscalationEvent 是 Group 回传 Butler 的结构化事件。

建议字段：

```ts
type ButlerEscalationType =
  | "needs_user_decision"
  | "blocked"
  | "completed"
  | "failed"
  | "scope_change"
  | "status_digest";

interface ButlerEscalationEvent {
  id: string;
  type: ButlerEscalationType;
  butlerTaskId: string;
  groupId: string;
  fromAgentId: string; // 通常是 host
  severity: "info" | "warning" | "critical";
  summary: string;
  question?: ButlerUserQuestion;
  options?: Array<{ id: string; label: string; tradeoff?: string; recommended?: boolean }>;
  artifacts?: Array<{ name: string; path?: string; url?: string; description?: string }>;
  suggestedNextStep?: string;
  createdAt: string;
}
```

### ButlerUserQuestion

用户决策项应结构化，避免让 Butler 再从一大段文本里猜。

```ts
interface ButlerUserQuestion {
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

## 核心流程

### 流程 1：用户从管家派发任务到群组

1. 用户在 Butler 入口提出需求。
2. Butler 判断该任务超过简单工作边界，需要派发。
3. Butler 创建全局 TODOboard 条目。
4. Butler 判断应该交给 Group。
5. Butler 查找可复用 Group；若没有合适的，再创建 Group 或从 Market 拉取群组模板。
6. Butler 创建 `ButlerTask`，并关联全局 TODOboard 条目。
7. Butler 将任务上下文派发给目标 Group。
8. Group 内部写入一条系统消息或 Host 消息，唤醒 Host。
9. Host 拆解任务、创建 Group TODO、组织成员。
10. Butler 回复用户：任务已交给哪个群组、当前会如何推进。

### 流程 2：群组卡住，需要用户决策

1. Group 内部发现缺少用户输入。
2. Host 调用 `host-escalate-to-butler`。
3. Bridge 生成 `needs_user_decision` 或 `blocked` 事件。
4. ButlerTask 和全局 TODOboard 条目状态变为 `waiting_user`。
5. Butler 在用户入口提出问题，并给出推荐选项。
6. 用户回答。
7. Butler 调用 `butler-reply-to-group`。
8. Group 收到用户决策，继续推进。

### 流程 3：群组完成任务

1. Group 完成主要 TODO 或 Host 判断达到验收标准。
2. Host 调用 `host-return-result-to-butler`。
3. Bridge 生成 `completed` 事件。
4. ButlerTask 和全局 TODOboard 条目状态变为 `completed`。
5. Butler 汇总结果、产物和下一步建议。
6. 用户可以确认归档、要求修改或继续追加任务。

### 流程 4：用户主动询问进度

1. 用户问 Butler：“上次那个旅行规划怎么样了？”
2. Butler 根据 ButlerTask 找到目标 Group。
3. Butler 调用按需摘要能力。
4. Group 返回 `status_digest`。
5. Butler 用简洁语言告诉用户当前状态、卡点、下一步。

## 推荐工具与能力接口

### Butler 侧工具

#### butler-dispatch-to-group

将用户需求派发到指定 Group，并创建全局 TODOboard 条目与 ButlerTask。

输入：

- `groupId`
- `title`
- `goal`
- `acceptance`
- `constraints`
- `userPreferences`
- `globalTodoId`（可选；为空时由工具创建）

输出：

- `globalTodoId`
- `butlerTaskId`
- `groupId`
- `status`

#### butler-dispatch-to-agent

将任务派发给单个 Agent，并创建全局 TODOboard 条目与 ButlerTask。它与群组桥接共用任务账本。

#### butler-get-work-status

根据 ButlerTask 查询目标 Agent/Group 的状态摘要。

#### butler-reply-to-group

把用户对某个决策问题的回复带回 Group。

#### butler-cancel-work

取消或暂停由 Butler 派发的任务。

#### butler-search-market

按用户需求检索 Market 资源。返回少量候选，不直接安装。

输入：

- `query`
- `kind`: `agent | group | skill | plugin | any`
- `trustLevel`: `official_only | include_community`

输出：

- 候选资源摘要
- 来源
- 权限需求
- 依赖树
- 推荐理由

#### butler-preview-market-resource

展示单个 Market 资源的依赖、权限、风险和替代方案，用于用户授权前解释。

#### butler-install-market-resource

在用户明确授权后安装资源。社区资源必须经过显式确认，不能静默安装。

#### butler-create-from-market

基于 Market 中的 Agent 或 Group 模板创建本地资源，并把创建结果写入 ButlerTask 或全局 TODOboard 的资源记录。

### Host/Group 侧工具

#### host-escalate-to-butler

用于卡住、需要用户决策、范围变化等场景。

#### host-return-result-to-butler

用于任务完成后的正式结果回传。

#### host-request-butler-summary

用于生成给 Butler 的状态摘要。它不是主动推送，而是响应 Butler 查询。

## 管家分身规则

每个 Group 注册时自动建立管家分身绑定：

```text
groupId -> GroupButlerBinding -> butler
```

群组内部可以把 `@butler` 作为一个可识别对象，但它不是普通成员，不进入 WakeSystem 的常规 Agent 队列。推荐行为：

- `@butler` 不响应普通聊天。
- `@butler` 不参与群组内部辩论。
- `@butler` 不读取完整历史。
- `@butler` 只接收 Host 或 Bridge 发出的结构化事件。
- 用户主动进入群组时，可以看见该任务与管家的绑定关系。

这可以保留“每个群组有管家分身”的产品感觉，同时避免复制真实 Butler Agent。

## 群组回传策略

### 默认不回传

以下内容不主动回传 Butler：

- 成员普通讨论。
- 中间草稿。
- 工具调用日志。
- 非关键进度。
- Agent 之间的互相提醒。
- TODO 普通状态变化。

### 必须回传

以下内容必须回传 Butler：

- 用户决策缺失导致无法继续。
- 需要用户授权。
- 任务范围明显变化。
- 成本、时间、权限风险超出原任务。
- 任务完成。
- 任务失败或重试后仍失败。

### 可以按需查询

以下内容由 Butler 主动查询：

- 当前进度。
- 未完成 TODO。
- 最近关键决策。
- 当前阻塞点。
- 产物列表。

## 用户体验草案

用户默认只在 Butler 聊天入口看到：

```text
我已经把“制定三天杭州旅行计划”交给「旅行规划群组」处理。
他们会先整理路线、预算和餐饮选择。除非需要你做选择，我不会用中间讨论打扰你。
```

卡住时：

```text
旅行规划群组需要你做个选择：

他们可以按两种路线继续：
1. 轻松路线：每天 2-3 个地点，预算略高
2. 高效率路线：每天 4-5 个地点，行程更紧

我建议选轻松路线，因为你之前更偏好不赶路。你想选哪一个？
```

完成时：

```text
旅行规划群组已经完成了三天杭州计划。

结果包括：
- 每日路线
- 餐饮推荐
- 预算估算
- 备选雨天方案

我建议你先确认预算是否合适。如果你愿意，我可以让群组继续细化酒店和交通。
```

## 与现有实现的关系

现有能力可以复用：

- Butler 已有创建/运行/检查群组的工具。
- Group 已有 `postMessage()` 和 WakeSystem。
- Host 已有任务拆解、讨论引导、进度总结、TODO 管理工具。
- Group TODO 已支持依赖、onComplete 和扫描器。
- WebSocket 已能广播 group message 和 Agent 事件。

需要补齐的不是“能不能发消息”，而是：

- 全局 TODOboard 中的用户级任务条目。
- ButlerTask 任务账本。
- GroupButlerBinding 管家分身绑定。
- Group -> Butler 的结构化事件桥。
- Butler -> Group 的用户决策回传。
- Host 侧明确的回传工具。
- Butler 侧按需摘要和状态查询入口。
- Butler 侧 Market 检索、预览、授权安装和模板创建能力。
- 前端 Butler 入口里的任务状态展示。

## 边界情况

### 找不到合适 Agent 或 Group

Butler 先说明没有合适资源，再询问是否创建新 Agent/Group。默认不静默创建过多资源。

### 用户需求太模糊

Butler 先追问，不派发。派发任务必须有最小可执行目标。

### 用户要求管家直接做复杂任务

Butler 应说明自己会负责调度和回传，而不是在主入口里硬做复杂工作。随后将任务登记到全局 TODOboard，并派发给合适的 Agent 或 Group。

### 本地没有合适资源

Butler 先说明本地缺少合适 Agent/Group，再检索 Market。官方认证资源可轻量推荐；社区资源必须展示来源、权限、依赖和风险，等待用户确认。

### Group 长时间无回传

ButlerTask 可进入 `stale` 或保留 `running` 但提示“需要查询状态”。不应自动认定失败。

### Group 反复卡住

Bridge 应合并同类阻塞事件，避免每次都打扰用户。Butler 可以总结为一个决策问题。

### 用户直接进入群组回复

允许，但 ButlerTask 仍需同步状态。否则用户入口会失去任务感知。

### 用户取消任务

Butler 将 ButlerTask 标记为 `cancelled`，并向 Group 发送取消事件。Group 应停止新增唤醒和 TODO 推进，保留历史。

### Group 完成但用户要求返工

ButlerTask 从 `completed` 转回 `running` 或创建子任务，Group 收到返工说明。

## 测试与验收方向

后续实现时至少需要覆盖：

1. Butler 派发任务到已有 Group，并创建 ButlerTask。
2. Butler 派发任务时创建或关联全局 TODOboard 条目，接受者可以是 Group。
3. 创建 Group 时自动生成 GroupButlerBinding。
4. Host 触发 `needs_user_decision`，ButlerTask 和全局 TODOboard 条目进入 `waiting_user`。
5. 用户在 Butler 入口回复后，决策能回到原 Group。
6. Host 触发 `completed`，ButlerTask 和全局 TODOboard 条目进入 `completed`。
7. 普通群组消息不会主动推送到 Butler。
8. Butler 按需查询 Group 摘要，不读取完整群组历史。
9. 重复阻塞事件会去重或合并。
10. Butler 遇到稍复杂任务时会派发，不在主入口直接完成。
11. Butler 可以检索 Market 候选资源，但安装社区资源前必须获得用户授权。

## 推荐实施分层

后续统一进入实现时，建议分四层：

1. **数据层**：GlobalTodoStore、ButlerTaskStore、GroupButlerBindingStore、事件类型。
2. **桥接层**：GroupButlerBridge，负责事件传递、去重、状态更新。
3. **资源层**：MarketResourceResolver，负责检索、预览、授权安装和本地创建。
4. **工具层**：Butler 工具和 Host 工具。
5. **前端层**：Butler 聊天入口显示任务卡、用户决策卡、完成结果卡和 Market 授权卡。

## 最终口径

管家不是群组成员，也不是万能执行者。管家是用户入口、任务托管者和关键事件中继者。管家只能对话和完成简单工作，一旦任务稍微复杂，就应该登记到全局 TODOboard 并派发给 Agent 或 Group。

群组不是每一步都向管家汇报，而是在需要用户参与或完成交付时，把结构化事件交给管家。

每个群组注册一个管家分身，但这个分身是虚拟绑定和事件端点，不是复制出来的 Butler Agent。这样既满足产品上的“管家始终在场”，也保留工程上的上下文隔离和人格一致。

当本地资源不足时，管家可以从 Market 检索和拉取资源，但必须遵守来源可信度、权限透明和用户授权规则。Market 是管家的资源库，不是普通用户的日常入口。
