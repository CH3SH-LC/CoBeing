# TODOboard 全局与群组协作 - 设计文档

> 日期：2026-06-08 | 状态：方向收敛

## 背景

CoBeing 已经具备 Agent TODO 和 Group TODO 的代码基础。当前 TODO 可以按时间、0time 或条件触发，群组 TODO 也已经支持负责人、依赖、交付物和完成后的动作链。但产品层面的全局 TODOboard 仍不够清楚：它容易被误解成用户自己管理的大看板，也容易把状态设计得过重。

本设计把 TODOboard 收敛为三层任务账本：

- **Global TODO**：Butler 的跨群组编排账本。
- **Group TODO**：群组内部执行拆解账本。
- **Agent TODO**：单个 Agent 的个人执行账本。

其中 Global TODO 必须是 Butler-centric。它不是给普通用户手动维护的项目管理看板，而是 Butler 用来管理多个群组、多个 Agent 和长期任务流的内部编排层。用户看到的是 Butler 的摘要、问题、进度和结果，不需要直接面对完整账本。

## 已确认方向

| 维度 | 决策 |
| --- | --- |
| 全局 TODO 定位 | 只服务 Butler，用于跨群组、跨 Agent 的任务编排 |
| 用户视角 | 用户不需要直接维护全局看板，主要通过 Butler 对话感知任务 |
| 状态集合 | 全局层只保留最小状态：`pending` / `running` / `waiting_user` / `completed` / `cancelled` |
| blocked 处理 | 不作为全局主状态暴露，作为 `running` 或 `waiting_user` 下的内部原因 |
| 智能性来源 | 不靠堆状态，而靠自动派发、自动监控、自动升级、自动回收、自动续作 |
| 自动续作 | 必须成为核心能力：任务完成或阶段结束后，由承担该任务的智能体判断并生成/申请后续 TODO |
| 三层关系 | Global 管编排，Group 管协作拆解，Agent 管个人执行 |
| 实现策略 | 先基于现有 Agent/Group TODO 承接，后续补全 Global TODO 存储和调度 |

## 目标

1. 明确全局 TODOboard 是 Butler 的编排层，而不是用户项目管理工具。
2. 明确 Global TODO、Group TODO、Agent TODO 的边界和协作方式。
3. 把 TODO 从静态列表升级为自动任务流。
4. 强调并定义“自动续作 / 生成后续任务”的产品和技术语义。
5. 明确哪些动作由账本负责，哪些判断由承担任务的 Agent 负责，哪些只是 Butler/群主的路由和审批责任。
6. 给出与当前代码事实的衔接方式和后续实现风险。

## 非目标

1. 不把 CoBeing 变成企业项目管理软件。
2. 不要求普通用户学习看板、泳道、甘特图或复杂流程状态。
3. 不把全局 TODO 暴露成所有人都能随意编辑的大型表格。
4. 不用更多状态代替智能判断。
5. 不在本设计中直接改代码，只形成后续实现依据。

## 核心定义

TODOboard 是系统的任务账本和触发器，不是智能责任主体。

它负责记录：

- 当前目标是什么。
- 谁负责下一步。
- 什么时候检查。
- 依赖什么。
- 当前是否等待用户。
- 已经发生过哪些关键事件。
- 下一步应该唤醒谁或检查什么。

它不负责独立判断：

- 任务是否值得继续。
- 该不该扩大范围。
- 用户该选择哪个方案。
- 是否应该安装资源。
- 最终成果是否符合用户偏好。

这些判断应由对应责任主体根据 prompt、上下文、工具结果和用户偏好完成：用户审批由 Butler 或群主上浮，资源安装由 Butler 请求授权，执行续作由承担任务的 Agent 判断。

其中“自动续作 / 生成后续任务”的判断尤其要单独划清：

> 谁承担当前 TODO，谁判断是否需要续作。

Butler 和群主可以派发任务、维护边界、检查停滞、承接用户审批和跨空间路由，但它们不应替承担任务的 Agent 判断后续任务是否自然成立。即便一个 Global TODO 派给了 Group，续作判断也应落在群组里当前负责交付的 Agent 身上，而不是落在“群组”这个容器或群主这个协调者身上。

## 三层 TODOboard

### Global TODO

Global TODO 是 Butler 的任务编排层。它记录用户交给系统的跨空间目标，以及 Butler 对这些目标的调度和跟踪。

适合进入 Global TODO 的任务：

- 用户对 Butler 提出的长期或多步骤任务。
- 需要派发给某个群组的任务。
- 涉及多个群组或多个 Agent 的任务。
- 需要等待用户确认后继续的任务。
- 需要在未来时间点继续检查或续作的任务。
- 群组完成后需要 Butler 汇总、回访或触发下一阶段的任务。

Global TODO 不应记录：

- 单个 Agent 内部的一次普通工具调用。
- 群组内每个细碎执行子任务。
- 无需跟踪的普通聊天问答。
- 已经完全闭环且没有后续价值的临时动作。

### Group TODO

Group TODO 是群组内部执行账本。它负责承接 Butler 派来的目标，或用户直接在群组中提出的任务，并把它拆成群组成员可执行的子任务。

群组 TODO 的重点是：

- 子任务拆解。
- 负责人分配。
- Agent 间依赖。
- 交付物与验收条件。
- 停滞恢复。
- 群主收束。

群主对 Group TODO 负主要责任。普通 Agent 可以完成、更新和补充自己负责的 TODO，但不应随意重排整个群组任务。

### Agent TODO

Agent TODO 是单个 Agent 的个人执行层。它适合记录：

- 某个 Agent 需要定时继续的个人任务。
- 某个 Agent 自己承诺的后续检查。
- 不需要进入群组协作账本的局部工作。

Agent TODO 不应承担跨群组编排，也不应替代群主或 Butler 的协调责任。

## 全局 TODO 状态

Global TODO 只使用最小状态：

| 状态 | 含义 |
| --- | --- |
| `pending` | 已创建，尚未派发或尚未到触发条件 |
| `running` | Butler 已派发给 Agent 或 Group，正在推进 |
| `waiting_user` | 下一步需要用户确认、授权、选择、补充信息或验收 |
| `completed` | 已完成并收束，不需要继续跟踪 |
| `cancelled` | 用户或 Butler 明确取消，不再继续 |

`blocked` 不作为全局主状态暴露。阻塞原因可以记录在字段中：

```ts
internalBlocker?: {
  type: "missing_info" | "dependency" | "resource" | "tool_error" | "agent_stalled";
  summary: string;
  since: string;
}
```

当阻塞需要用户处理时，状态是 `waiting_user`。当阻塞仍可由 Butler、群主或 Agent 自行恢复时，状态仍是 `running`。

## Global TODO 建议字段

Global TODO 不应靠大量状态表达复杂性，而应靠字段表达编排语义：

```ts
interface GlobalTodoItem {
  id: string;
  goal: string;
  status: "pending" | "running" | "waiting_user" | "completed" | "cancelled";

  assigneeType: "butler" | "agent" | "group";
  assigneeId?: string;
  /** 当前负责执行和判断续作的 Agent。assigneeType=group 时也应尽量明确。 */
  responsibleAgentId?: string;

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
    id: string;
    todoIds?: string[];
    messageIds?: string[];
  }>;

  progressSummary: string;
  nextAction: string;
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

  createdAt: string;
  updatedAt: string;
}
```

`continuationPolicy` 是本设计的关键新增语义。它让任务承担者在任务结束时不只是“标记完成”，而是先判断是否应该继续生成下一步。

如果 `responsibleAgentId` 为空，Global TODO 不应自动续作。Butler 或群主应先把任务路由给明确的承担 Agent，再允许该 Agent 做续作判断。

## 自动任务流

TODOboard 的智能性来自自动任务流：

```text
创建
  ↓
自动派发
  ↓
自动监控
  ↓
自动升级
  ↓
自动回收
  ↓
任务承担者自动续作 / 生成后续任务
```

### 1. 创建

Global TODO 主要由 Butler 创建：

- 用户直接向 Butler 提出一个需要持续跟踪的目标。
- Butler 判断某次对话已经形成可跟踪任务。
- 群主把群组内的重要任务同步给 Butler。
- 已完成任务触发后续任务生成。

创建时，Butler 应写清：

- 用户真实目标。
- 为什么需要跟踪。
- 初始指派对象。
- 是否允许自动派发、自动监控和自动续作。
- 什么时候需要用户确认。

### 2. 自动派发

Butler 根据目标和资源判断派发对象：

- 简单个人任务：派给 Agent。
- 需要多人协作：派给 Group。
- 需要 Butler 自己追问或整理：保留给 Butler。
- 缺少资源：生成等待用户或资源申请流程。

派发不是简单设置 `assigneeId`。它还应在目标 Group 或 Agent 层生成对应 TODO，并把生成出的执行引用写回 `executionRefs`。

### 3. 自动监控

Butler 周期性或事件驱动地检查：

- Group TODO 是否有未完成项。
- Agent TODO 是否过期。
- 群组是否长期无消息。
- 是否有任务进入 `review` 或等待验收。
- 是否出现工具错误、资源缺口或 Agent 停滞。

监控结果写入 `progressSummary`、`lastEvent` 和 `nextAction`。如果仍能自动恢复，不切到 `waiting_user`。

### 4. 自动升级

当任务无法继续自动推进时，Butler 或群主升级处理：

- 需要用户选择：进入 `waiting_user`。
- 需要用户授权安装资源：进入 `waiting_user`。
- 需要更多 Agent/Skill/Plugin：由群主或 Butler 申请资源。
- 群组停滞：唤醒群主恢复。
- Agent 多次失败：换人、请求审查或改派群组。

升级不是失败，而是把系统无法替用户做的判断上浮。

### 5. 自动回收

任务完成后，Butler 不应无限保留运行态。回收包括：

- 收集群组或 Agent 的结果。
- 生成用户可读摘要。
- 标记 Global TODO 为 `completed` 或等待用户验收。
- 清理无效或过期的内部 TODO。
- 将关键经验交给 Memory ToolAgent 或群主沉淀。
- 触发或接收任务承担 Agent 的续作判断结果。

### 6. 自动续作 / 生成后续任务

这是 TODOboard 必须强调的核心能力。

一个 TODO 完成后，不代表目标一定结束。完成事件发生时，**承担这个 TODO 的智能体**应进入“续作判断”：

```text
TODO 完成
  ↓
任务承担 Agent 收集自己的交付物和上下文
  ↓
任务承担 Agent 判断是否仍有后续价值
  ↓
不需要继续 → 收束并归档
需要用户确认 → 进入 waiting_user
可以自动继续 → 由任务承担 Agent 创建后续 TODO
需要其他空间继续 → 由任务承担 Agent 向 Butler / 群主提出跨层后续任务请求
```

这里的关键点是：续作判断权属于任务承担者，而不是 Butler 或群主。Butler 和群主可以提供边界、权限、用户审批和跨空间路由，但不应替正在做事的 Agent 判断“这件事还有没有下一步”。承担任务的 Agent 最清楚自己完成了什么、缺什么、下一步是否自然成立。

自动续作的典型场景：

- 周期性任务：提醒、复盘、追踪、检查。
- 阶段性任务：调研完成后生成方案任务，方案完成后生成执行任务。
- 验收后任务：用户确认设计方向后生成细化任务。
- 依赖任务：上游 Agent 完成后自动唤醒下游 Agent。
- 跨群组任务：旅行规划 Agent 完成行程后，判断还需要预算、预订、行李或提醒任务，并向 Butler/群主提出跨层后续任务请求。
- 失败恢复：任务失败后生成补救、替代方案或资源申请任务。
- 经验沉淀：任务完成后生成记忆提取或复盘任务。

自动续作必须受边界约束：

- 不能静默扩大用户目标。
- 不能绕过用户做主观或高风险决策。
- 不能静默安装 Skill、Plugin 或 Market 资源。
- 不能无限递归生成任务。
- 不能让用户被大量后续 TODO 刷屏。

建议使用 `continuationPolicy.maxDepth`、`stopWhen` 和 `nextCheckHint` 控制续作边界。默认策略应保守：低风险、明确承诺、强依赖的后续任务可以由任务承担 Agent 自动生成；主观选择、授权、付款、隐私、范围扩大必须进入 `waiting_user` 或上浮给 Butler/群主处理。

## 三层续作分工

| 层级 | 续作职责 |
| --- | --- |
| Global TODO | 承担全局任务的 Agent 判断是否有下一阶段；需要跨群组/跨 Agent 时向 Butler 提出后续任务请求 |
| Group TODO | 被指派的任务 Agent 判断是否需要下游任务、复查任务、验收任务或资源申请；需要群组路由时交给群主 |
| Agent TODO | Agent 为自己创建低风险的个人后续提醒或执行任务 |

示例：

```text
用户：帮我规划七月去日本旅行。

Global TODO:
- 目标：规划日本旅行
- assigneeType: group
- assigneeId: travel-group

Group TODO:
- 调研目的地
- 设计 7 天游玩路线
- 估算预算
- 汇总给用户选择

完成后自动续作：
- 行程规划 Agent 判断用户需要选择路线：请求 Global TODO 进入 waiting_user
- 预算 Agent 判断预算超出偏好：创建或请求创建“优化低预算方案”Group TODO
- 规划 Agent 判断行程已确认且有明确后续：生成“出发前一周行李提醒”Agent 或 Global TODO
- 如果需要预订但涉及付款/账号授权：承担任务的 Agent 上浮给 Butler 请求用户确认
```

## 账本与智能体的责任边界

| 动作 | 责任主体 |
| --- | --- |
| 持久化 TODO | TODOboard / Store |
| 到期扫描和条件触发 | Scanner |
| 写入状态和执行引用 | TODOboard / 调用方 |
| 判断是否派发给群组 | Butler |
| 判断群组内谁该执行 | 群主 |
| 判断个人任务是否已完成 | Agent |
| 判断是否需要用户审批 | Butler / 群主 / Agent |
| 判断是否自动续作 | 承担该 TODO 的 Agent |
| 生成后续 TODO | 承担任务的 Agent 通过工具写入；跨层或越权时向 Butler/群主提出请求 |
| 安装资源或扩权 | 用户授权后由 Butler 执行 |
| 最终向用户解释结果 | Butler 或直接交互场景下的群主 |

TODOboard 只能触发和记录。它不应该“自己想”。但它必须给 Butler、群主和 Agent 提供足够字段，让它们能持续推进而不是每次从零开始。

## 与群主设计的关系

群主负责维护 Group TODO 的秩序，但续作判断应由承担任务的 Agent 发起。群主在这些场景中承接路由、审批和协调：

- 任务拆解后，确认每个 TODO 有明确承担 Agent。
- 上游 Agent 完成并提出下游请求后，为下游创建或唤醒 TODO。
- 成员卡住并提出资源缺口时，创建恢复任务或资源申请任务。
- 阶段承担 Agent 判断需要验收时，创建验收任务或请求用户确认。
- 用户确认后，把下一阶段任务路由给合适 Agent。
- 群组完成后，向 Butler 回传结果和由承担 Agent 提出的续作项。

群主不替成员判断是否续作。它负责把承担 Agent 的续作判断变成群组内可执行的任务，或在跨群组时回传 Butler。

## 与工具智能体设计的关系

自动续作可以使用 ToolAgent 辅助判断，但 ToolAgent 不拥有任务责任。

建议用法：

- Memory ToolAgent：在任务完成后提取经验和长期记忆建议。
- Judgment ToolAgent：为任务承担 Agent 辅助判断是否需要唤醒群主或升级。
- Creator ToolAgent：当续作需要创建新 Agent 或 Group 时生成草案。
- Review ToolAgent：审查任务承担 Agent 自动生成的后续任务是否越界或空泛。

ToolAgent 的输出应返回给调用方。用于续作时，默认调用方应是任务承担 Agent；只有跨层路由、资源安装、权限升级或用户审批时，才由 Butler 或群主决定如何承接。

## 与现有实现的衔接

当前代码事实：

- `TodoItem.status` 当前是 `pending / in-progress / review / completed / expired`。
- `TodoScope` 当前只有 `agent / group`。
- 触发模式已有 `time / 0time / condition`。
- Group TODO 已支持 `parentId`、`dependsOn`、`deliverable`、`onComplete.createTodo`。
- `GroupTodoScanner` 到期后通过回调触发目标任务，并在完成时处理 onComplete、依赖和群组记忆。
- 群组 TODO 触发消息里已经提示 Agent “如需续期，先创建新 TODO，再完成当前 TODO”。
- GUI 和 WS 当前只认识 Agent/Group TODO，不认识 Global TODO scope。

因此后续实现不需要推翻现有 Agent/Group TODO。推荐路线：

1. 保留现有 Agent/Group TODO 状态和触发机制。
2. 新增 Global TODO 类型，不强行复用当前 `TodoItem`。
3. Global TODO 引用 Agent/Group TODO，而不是把所有子任务塞进一张表。
4. 将旧的 `recurrenceHint` 从“提示 Agent 手动续期”升级为任务承担 Agent 可读取和遵守的 `continuationPolicy`。
5. 复用 Group TODO 的 `onComplete.createTodo` 和依赖机制承接群组内部续作。
6. 在 Agent 完成 TODO 的路径中加入续作判断：承担任务的 Agent 判断是否生成 Global/Group/Agent 后续 TODO；跨层写入时由 Butler/群主承接请求。
7. 前端先不暴露完整 Global TODO 大看板，只在 Butler 视角提供任务摘要、等待用户的问题和关键进度。

## 已知实现风险

1. **`get_group_health` TODO 路径风险**
   - 当前 `ws-server.ts` 中 `get_group_health` 仍读取 `(g2 as any).groupTodoStore`。
   - 真实群组 TODO store 应来自 `GroupManager.getGroupTodoStore(groupId)`。
   - 后续做 TODOboard 健康监控前必须修复，否则群组进度统计可能不准。

2. **GUI scope 只有 `agent / group`**
   - 当前前端类型和 WS 命令只支持两类 TODO。
   - Global TODO 应先作为 Butler 内部能力，不急于直接塞进现有 TODO 面板。
   - 如果后续展示，应设计 Butler 任务摘要视图，而不是复用群组 TODO 看板。

3. **状态命名不统一**
   - 旧设计文档曾使用 `triggered / cancelled`，当前代码使用 `in-progress / review / expired`。
   - Global TODO 应独立采用最小状态集合，不要求立刻改 Agent/Group TODO 状态。

4. **动态工具注册刷新风险**
   - 已知 `Agent.registerTool()` 不自动 `rebuildLoop()`。
   - 如果后续给 Butler 或群主动态注入 Global TODO 工具，必须确保模型工具列表刷新。

5. **自动续作可能失控**
   - 必须限制续作深度、权限、用户审批点和重复任务生成。
   - 需要日志和可解释摘要，让用户知道系统为什么继续。

## 后续实施方向

建议分阶段实现：

1. **Global TODO 数据模型**
   - 新增 GlobalTodoStore。
   - 不直接复用 Agent/Group `TodoItem`。
   - 支持最小状态、执行引用、自动策略和续作策略。

2. **Butler 编排工具**
   - `global-todo-add`
   - `global-todo-list`
   - `global-todo-update`
   - `global-todo-link-execution`
   - `global-todo-continue`

3. **完成事件回传**
   - Group TODO 完成时可向 Butler 发送阶段完成事件。
   - Agent TODO 完成时可按需回传 Butler。
   - Butler 更新 Global TODO 的 `lastEvent` 和 `progressSummary`。

4. **自动续作判断**
   - 承担任务的 Agent 在任务完成、等待用户解除、依赖满足、停滞恢复后运行续作判断。
   - 群组内部任务完成后，被指派的 Agent 判断是否需要组内后续任务；群主只负责路由和协调。
   - 低风险明确后续任务由承担 Agent 自动生成；高风险任务进入 `waiting_user` 或上浮给 Butler/群主。

5. **用户体验**
   - Butler 对用户展示“我正在跟进什么”“现在等你什么”“已经完成什么”。
   - 不做复杂全局看板。
   - 只在用户需要时显示详细任务链。

## 验收方向

后续实现时至少验证：

1. 用户向 Butler 提出长期任务后，Butler 创建 Global TODO。
2. Butler 能把 Global TODO 派发给 Group，并记录对应 Group TODO 引用。
3. Group TODO 完成后，Butler 能更新 Global TODO 进度。
4. 如果承担任务的 Agent 判断下一步需要用户选择，Global TODO 进入 `waiting_user`。
5. 如果下一步低风险且明确，承担任务的 Agent 自动生成后续 TODO。
6. 群组内被指派的 Agent 能根据依赖和交付物提出或生成下游 Group TODO。
7. Agent 能为自己创建个人续作 TODO；跨群组或越权任务必须请求 Butler/群主承接。
8. 自动续作有最大深度或停止条件，不会无限生成任务。
9. `get_group_health` 使用真实 `GroupManager.getGroupTodoStore()` 后，群组健康统计可信。
10. 前端不会把 Global TODO 暴露成复杂用户看板，而是通过 Butler 摘要呈现。

## 最终口径

TODOboard 不是用户手动维护的大看板，而是 CoBeing 的自动任务账本。

全局 TODO 只服务 Butler。它帮助 Butler 管理多个群组、多个 Agent 和长期任务流，让用户通过对话就能把事情交给系统跟进。

群组 TODO 服务群组协作，但每个 TODO 的续作判断属于承担该任务的 Agent。Agent TODO 服务单个 Agent 的个人执行。三层之间通过执行引用、完成事件和续作请求连接，而不是混成一张大表。

TODOboard 的智能性不来自更多状态，而来自自动任务流：自动派发、自动监控、自动升级、自动回收，以及最关键的 **自动续作 / 生成后续任务**。

一个任务完成后，承担它的 Agent 应该判断是收束、等待用户，还是继续生成下一步。这才是 TODOboard 从“提醒列表”升级为“个人 AI 团队任务编排器”的关键。
