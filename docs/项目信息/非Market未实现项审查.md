# CoBeing 大版本更新非 Market 未实现项审查

审查日期：2026-06-10  
审查范围：`D:\agent-codes\docs\GOALS` 中除 `market-architecture-design.md` 以外的设计文档，对照 `D:\agent-codes\PROGRESS.md` 声明与 `D:\agent-codes\CoBeing` 当前真实代码。  
结论口径：只整理未实现、半实现、实现质量不足、理解偏差项；Market 相关内容按用户要求不纳入。

## 总体判断

这次更新不是完全空壳：群组 prompt 规则、GlobalTodoStore、Global TODO 工具和前端 GlobalTodoPanel、Agent 增强工具文件、若干 ToolAgent 配置确实存在。

但从真实运行链路看，最关键的“管家作为用户入口和任务托管中心”没有闭环。大量实现停在类型、Store、手动工具、前端展示组件或 prompt 文案层，缺少 Runtime 接入、任务账本关联、事件桥、自动派发、自动监控、状态同步和用户决策回传。

## 2026-06-10 实施回填记录

本审查提出后，已完成一轮后端闭环修复：

- P0-1：`Runtime` 已初始化 `ButlerTaskStore` 与 `GroupButlerBindingStore`，和 `GlobalTodoStore` 一起进入运行链路；Group 创建/恢复/删除会同步 Butler binding。
- P0-2 / P0-4：新增 `dispatchButlerTask()`，Butler 派发 Agent/Group 会创建 Global TODO、ButlerTask、executionRefs，并在目标侧创建 Agent inbox item 或 Group TODO；旧 `butler-dispatch-task` 保留为兼容入口。
- P0-5：`agent-task-accept/report/complete` 会同步 Global TODO、ButlerTask、lastEvent、internalBlocker 与 WS 更新；完成路径接入续作判断。
- P0-6：Butler/GUI 创建 Agent 时会写默认 `capability.json`，`agent-update-capability` 也能在缺失能力卡时先生成默认卡。
- P1-8：WS `find_agent` 已扫描 capability.json 做本地匹配，`dispatch_task` 已调用真实 tracked dispatch。
- P1-10：群组 prompt 构建时不再加载 Agent 私有 memory/experience。
- P1-11：Group TODO 完成回传会按 executionRefs.todoIds 精确更新对应 Global TODO，并在全部关联 TODO 完成时同步 ButlerTask completed。

仍未完成或仅部分完成：

- P0-3：Group -> Butler 的结构化 Host 事件工具和用户决策回流仍需实现。
- P1-7：前端 Butler 回执卡片、等待用户决策卡、快捷派发仍需接真实 ButlerTask/Global TODO 数据流。
- P1-9：资源请求仍未进入 Butler 审批/授权队列。
- P2-12/13 后续：ToolAgent GUI 可见性、统一评估和 prompt 可治理化仍需继续收敛。

追加修复：

- 2026-06-11 追加修复：Memory/Group/Observability 的 SQLite 入口已具备 native binding 缺失时的降级路径；`ObservabilityDB` 不再因 `better-sqlite3` binding 缺失导致 Runtime 启动崩溃。
- 2026-06-11 追加修复：`better-sqlite3` 已升级到 `12.10.0` 并在 Node 24.13.0 下成功加载原生 binding；SQLite/FTS5 已恢复为默认路径，fallback 仅保留为兜底。

## P0 缺口

### 1. ButlerTaskStore 与 GroupButlerBindingStore 只是数据类，没有进入运行链路

设计期待：
- `butler-entry-bridge-design.md` 要求采用 `Global TODOboard + ButlerTask + GroupButlerBinding + ButlerEscalationEvent` 四层结构，并在创建 Group 时自动建立管家分身绑定。
- 验收要求包括 Butler 派发任务创建 ButlerTask、创建 Group 自动生成 GroupButlerBinding、Host 关键事件能推动 ButlerTask 与 Global TODO 状态变化。

代码事实：
- `GlobalTodoStore` 在 Runtime 中有实例字段与初始化：`D:\agent-codes\CoBeing\packages\core\src\runtime.ts:61`、`D:\agent-codes\CoBeing\packages\core\src\runtime.ts:128`。
- `ButlerTaskStore` / `GroupButlerBindingStore` 只在 `index.ts` 导出：`D:\agent-codes\CoBeing\packages\core\src\index.ts:54`、`D:\agent-codes\CoBeing\packages\core\src\index.ts:55`。
- 全仓搜索只看到这两个 Store 的类和测试，没有 Runtime 实例、Butler 工具使用、Group 创建时创建绑定、WS 查询或事件桥调用。

影响：
- 管家没有真实任务托管账本。
- 群组没有真实“管家分身”事件端点。
- 后续所有“从 Butler 派发、追踪、等待用户、完成回传”的能力都无法形成稳定链路。

归类：PROGRESS 声称了数据层和管家入口基础，但实际只完成了 Store 类，不是运行时功能。

### 2. Butler 派发任务不是设计里的“可追踪托管任务”

设计期待：
- Butler 派发到 Agent 或 Group 前应创建或关联 Global TODO。
- ButlerTask 应记录目标、验收标准、状态、待用户问题。
- Butler 侧应有 `butler-dispatch-to-group`、`butler-dispatch-to-agent`、`butler-get-work-status`、`butler-reply-to-group`、`butler-cancel-work` 等能力。

代码事实：
- 当前新增的 `butler-dispatch-task` 只支持指定 Agent：`D:\agent-codes\CoBeing\packages\core\src\agent\butler.ts:965`。
- 该工具只是构造一段文本并调用 `agent.handleIncomingMessage(...)`：`D:\agent-codes\CoBeing\packages\core\src\agent\butler.ts:992`、`D:\agent-codes\CoBeing\packages\core\src\agent\butler.ts:995`。
- 代码中没有创建 ButlerTask，没有创建 Global TODO，没有建立 executionRefs，也没有支持派发到 Group：`D:\agent-codes\CoBeing\packages\core\src\agent\butler.ts:1005`。
- 全仓未找到 `butler-reply-to-group`、`butler-cancel-work`、`butler-get-work-status`、`butler-dispatch-to-group` 等真实工具实现。

影响：
- 用户在管家入口交给系统的任务不能形成可查询、可取消、可恢复的托管任务。
- 任务是否被 Agent 接收依赖模型是否听话调用 `agent-task-accept`，不是系统保证。
- Group 任务派发闭环缺失。

归类：理解偏差。实现把“派发任务”做成了“发一条系统消息”，没有做到设计中的任务托管。

### 3. Group -> Butler 结构化事件桥没有实现

设计期待：
- Group 只在关键节点回传 Butler，例如 `needs_user_decision`、`blocked`、`completed`、`failed`、`scope_change`、`status_digest`。
- Host/Group 侧应有结构化工具，如 `host-escalate-to-butler`、`host-return-result-to-butler`、`host-request-butler-summary`。
- 用户在 Butler 入口的回复应能回到原 Group。

代码事实：
- 结构化事件类型存在：`D:\agent-codes\CoBeing\packages\shared\src\butler-bridge.ts:29`。
- GroupButlerBinding 类型存在：`D:\agent-codes\CoBeing\packages\shared\src\butler-bridge.ts:154`。
- 但全仓没有 Host 回传 Butler 的工具实现；搜索 `host-escalate-to-butler`、`host-return-result-to-butler`、`needs_user_decision`、`status_digest` 没有落到可调用链路。
- 群组 prompt 确实提醒“关键节点回传管家”：`D:\agent-codes\CoBeing\packages\core\src\conversation\prompt-builder.ts:563`，但这是文案，不是事件桥。

影响：
- Group 卡住、完成、需要用户审批时，没有稳定的结构化事件回传 Butler。
- Butler 无法把用户决策路由回原 Group。
- “普通群组过程不刷屏 Butler，但关键节点回传”这一产品体验没有实现。

归类：核心功能未实现。当前只有类型和 prompt 约束。

### 4. Global TODO 有 Store 和手动工具，但没有自动任务流

设计期待：
- Global TODO 是 Butler 编排层，应自动派发、自动监控、自动升级、自动回收、自动续作。
- 派发时应在目标 Agent/Group 层生成对应 TODO，并把执行引用写回 `executionRefs`。
- 完成后应由承担任务的 Agent 判断续作，而不是 Butler 或账本自己拍脑袋。

代码事实：
- `global-todo-add/list/update/link-execution/continue` 工具已注册给 Butler：`D:\agent-codes\CoBeing\packages\core\src\agent\butler.ts:1121` 至 `D:\agent-codes\CoBeing\packages\core\src\agent\butler.ts:1128`。
- 这些工具本质是 Butler 手动调用的 CRUD/续作工具，`global-todo-add` 默认只创建 `pending` 条目：`D:\agent-codes\CoBeing\packages\core\src\todo\global-tools.ts:48`。
- `global-todo-continue` 需要工具调用者手动传 `decision`：`D:\agent-codes\CoBeing\packages\core\src\todo\global-tools.ts:277`、`D:\agent-codes\CoBeing\packages\core\src\todo\global-tools.ts:291`。
- `runContinuationJudgment()` 虽存在，但失败默认 `complete`，不是保守上浮：`D:\agent-codes\CoBeing\packages\core\src\todo\continuation-judgment.ts:55`、`D:\agent-codes\CoBeing\packages\core\src\todo\continuation-judgment.ts:87`。
- 自动生成结果被解析成 `scope: "agent"`：`D:\agent-codes\CoBeing\packages\core\src\todo\continuation-judgment.ts:148`；但 `applyContinuationResult()` 只在 `scope === "group"` 时创建 Group TODO：`D:\agent-codes\CoBeing\packages\core\src\todo\continuation-judgment.ts:166`。
- `mapAgentStatusToGlobal()` 已实现但未被任何代码调用：`D:\agent-codes\CoBeing\packages\shared\src\types.ts:477`。

影响：
- Global TODO 目前不是“自动任务流”，更像一个 Butler 可手动维护的 JSON 清单。
- 自动派发和执行引用回写没有系统级保证。
- 自动续作代码路径存在明显断裂，默认失败还会把任务收束，容易吞掉后续责任。

归类：PROGRESS 声称“三层架构实现”，但自动编排能力主要未实现。

### 5. Agent Task Inbox 没有和 Global TODO / ButlerTask 同步

设计期待：
- Agent 接收 Butler 派发任务后，应创建 AgentTaskInboxItem，并关联 Global TODO / Agent TODO。
- Agent 汇报阻塞、等待用户、失败、完成时，应映射到 Global TODO 状态和事件字段。
- Agent 完成任务后应触发续作判断。

代码事实：
- `agent-task-accept` 支持 `globalTodoId` 参数，但只是写入本地 inbox：`D:\agent-codes\CoBeing\packages\core\src\tools\agent-task.ts:11` 至 `D:\agent-codes\CoBeing\packages\core\src\tools\agent-task.ts:44`。
- `agent-task-report` 只更新 inbox 条目：`D:\agent-codes\CoBeing\packages\core\src\tools\agent-task.ts:49` 至 `D:\agent-codes\CoBeing\packages\core\src\tools\agent-task.ts:90`。
- `agent-task-complete` 只更新 inbox、写 reflection、异步调用 MemoryAgent / TaskArchive：`D:\agent-codes\CoBeing\packages\core\src\tools\agent-task.ts:125` 至 `D:\agent-codes\CoBeing\packages\core\src\tools\agent-task.ts:194`。
- 没有调用 `GlobalTodoStore`，没有调用 `mapAgentStatusToGlobal()`，没有触发 `runContinuationJudgment()`。

影响：
- Agent 局部任务完成后，Butler 的全局视角不会自动变化。
- Agent 失败、阻塞、等待依赖不会自动反映到全局任务摘要。
- “谁承担 TODO，谁判断续作”的设计没有在 Agent 任务路径落地。

归类：半实现。Inbox 文件层存在，跨层状态同步未实现。

### 6. 新建 Agent 不自动生成能力卡，导致 Butler 能力匹配默认不可用

设计期待：
- 能力卡是 Butler / Host / Group 调度 Agent 的机器可读接口。
- Butler 可以基于 Capability Card 选择 Agent。

代码事实：
- `butler-find-agent` 完全依赖扫描 `capability.json`：`D:\agent-codes\CoBeing\packages\core\src\agent\butler.ts:885`、`D:\agent-codes\CoBeing\packages\core\src\agent\butler.ts:907`。
- 找不到能力卡时直接返回“未找到任何有能力画像的 Agent”：`D:\agent-codes\CoBeing\packages\core\src\agent\butler.ts:919`。
- `create_agent` 路径只调用 AgentCreator 生成 `character` / `job`：`D:\agent-codes\CoBeing\packages\core\src\api\ws-server.ts:1168` 至 `D:\agent-codes\CoBeing\packages\core\src\api\ws-server.ts:1195`。
- `agent-update-capability` 要求已存在 `currentCard`，没有能力卡时直接失败：`D:\agent-codes\CoBeing\packages\core\src\tools\agent-capability.ts:40` 至 `D:\agent-codes\CoBeing\packages\core\src\tools\agent-capability.ts:43`。

影响：
- 新建 Agent 默认不能被 Butler 的能力匹配工具选中。
- 设计中的“管家可靠判断哪个 Agent 适合接任务”需要用户或开发者手工补 `capability.json`。

归类：关键入口半实现。能力卡读写工具存在，但创建和调度链路断开。

## P1 缺口

### 7. 前端管家入口的“派发/创建/回执”多为 UI 壳

设计期待：
- 管家聊天区应展示任务回执卡片、等待用户决策卡、完成结果卡。
- 输入区按钮应辅助真实派发、创建、摘要工作。
- Butler 侧栏应展示轻量任务摘要，而不是完整大看板。

代码事实：
- `TaskReceiptCard` 只在消息 metadata 有 `taskReceipt` 时渲染：`D:\agent-codes\CoBeing\gui-v2\src\components\chat\ChatView.tsx:232`。
- 全仓 `taskReceipt` 只出现在前端类型和组件中，后端没有生产该 metadata。
- `ChatInputActions` 的“派发”只向输入框插入 `@agentId` / `@groupId`：`D:\agent-codes\CoBeing\gui-v2\src\components\chat\ChatInputActions.tsx:51`、`D:\agent-codes\CoBeing\gui-v2\src\components\chat\ChatInputActions.tsx:58`。
- “创建”只插入 `/new` / `/new-group` 文本：`D:\agent-codes\CoBeing\gui-v2\src\components\chat\ChatInputActions.tsx:81`、`D:\agent-codes\CoBeing\gui-v2\src\components\chat\ChatInputActions.tsx:86`。
- `useButlerTasksStore` 初始为空，只有 setter 和汇总计算，没有任何数据接入：`D:\agent-codes\CoBeing\gui-v2\src\stores\butlerTasks.ts:19` 至 `D:\agent-codes\CoBeing\gui-v2\src\stores\butlerTasks.ts:51`。
- 设计里的 `ButlerSidebar` 未实现；`Sidebar` 在 Butler 视图直接返回 `GlobalTodoPanel`：`D:\agent-codes\CoBeing\gui-v2\src\components\layout\Sidebar.tsx:22` 至 `D:\agent-codes\CoBeing\gui-v2\src\components\layout\Sidebar.tsx:24`。

影响：
- 用户看到的管家入口没有真实任务回执数据。
- 快捷按钮不是动作，只是文本片段。
- 管家入口更像“带辅助按钮的聊天框 + Global TODO 列表”，没有达到任务托管入口体验。

归类：前端可视层半实现，真实数据流缺失。

### 8. WS 中部分新增端点是占位，不执行真实操作

设计期待：
- 前端和后端应有可操作的 Agent 能力、任务派发、管家任务查询接口。

代码事实：
- `get_agent_capability/get_agent_inbox/get_agent_proposals/approve_proposal/reject_proposal` 等确实读写文件：`D:\agent-codes\CoBeing\packages\core\src\api\ws-server.ts:2445` 至 `D:\agent-codes\CoBeing\packages\core\src\api\ws-server.ts:2574`。
- 但 `find_agent` 只返回“请查看管家对话”的提示，不真正调用匹配逻辑：`D:\agent-codes\CoBeing\packages\core\src\api\ws-server.ts:2576` 至 `D:\agent-codes\CoBeing\packages\core\src\api\ws-server.ts:2583`。
- `dispatch_task` 也只返回一条提示，不调用 `butler-dispatch-task` 或 Agent inbox：`D:\agent-codes\CoBeing\packages\core\src\api\ws-server.ts:2586` 至 `D:\agent-codes\CoBeing\packages\core\src\api\ws-server.ts:2595`。

影响：
- 前端如果调用这些端点，无法真正完成查找或派发。
- PROGRESS 中“新增 WS 端点”的说法容易让人误以为操作闭环已完成。

归类：占位端点冒充功能端点。

### 9. 资源请求只返回文本，没有进入 Butler 审批或资源安装流程

设计期待：
- Agent 可请求 Skill/Plugin/工具资源，但不能静默安装；应由 Butler 承接、解释、授权。

代码事实：
- `agent-request-resource` 的描述声称“管家收到请求后会检索 Market 并征求用户确认”：`D:\agent-codes\CoBeing\packages\core\src\tools\agent-resource.ts:8` 至 `D:\agent-codes\CoBeing\packages\core\src\tools\agent-resource.ts:10`。
- 实际 execute 只返回一段文字，没有写入 Store、没有发事件、没有通知 Butler、没有待审批队列：`D:\agent-codes\CoBeing\packages\core\src\tools\agent-resource.ts:27` 至 `D:\agent-codes\CoBeing\packages\core\src\tools\agent-resource.ts:34`。

影响：
- Agent 发出的资源缺口不会被系统追踪。
- Butler 不会收到结构化请求，也不会出现在用户待确认项中。

归类：文案实现，链路未实现。

### 10. Agent 群组上下文仍可能加载私有记忆

设计期待：
- `general-agent-capability-design.md` 验收要求 Agent 群组上下文不加载私有 MEMORY，避免把个人长期记忆泄露到群组。

代码事实：
- `buildCacheablePrompt()` 不区分群组模式，先把 `memoryStore.snapshotForSystemPrompt()` 放入 volatile，再追加 `groupContext`：`D:\agent-codes\CoBeing\packages\core\src\conversation\prompt-builder.ts:303` 至 `D:\agent-codes\CoBeing\packages\core\src\conversation\prompt-builder.ts:317`。
- Agent 群组 run 会走 group loop：`D:\agent-codes\CoBeing\packages\core\src\agent\agent.ts:777`。

影响：
- 群组唤醒中仍可能带入 Agent 私有记忆。
- 这和“群组上下文只加载群组裁剪上下文，不泄露私有 MEMORY”的边界不一致。

归类：安全边界未实现或至少未显式隔离。

### 11. Group TODO 完成回传 Global TODO 过于粗糙

设计期待：
- Group TODO 完成后应根据 executionRefs/todoIds 精确更新对应 Global TODO，状态、进度、等待用户、完成结果都应同步。

代码事实：
- `GroupTodoScanner.complete()` 只按 `getByExecutionRef("group", this.groupId)` 找所有引用该 Group 的 Global TODO：`D:\agent-codes\CoBeing\packages\core\src\todo\group-scanner.ts:206` 至 `D:\agent-codes\CoBeing\packages\core\src\todo\group-scanner.ts:211`。
- 更新内容只有 `lastEvent` 和 `progressSummary`：`D:\agent-codes\CoBeing\packages\core\src\todo\group-scanner.ts:212` 至 `D:\agent-codes\CoBeing\packages\core\src\todo\group-scanner.ts:224`。
- 没有按具体 `todoIds` 匹配，没有设置 `completed` / `waiting_user` / blocker，也没有看到广播 Global TODO 更新。

影响：
- 同一个 Group 上多个 Global TODO 会被误更新。
- 完成事件不会自动推动 Global TODO 生命周期。

归类：回传有雏形，但质量不足。

## P2 缺口

### 12. ToolAgent 标准化已补第一步，但前端/日志可见性和评估机制仍未闭环

设计期待：
- 每个 ToolAgent 应有统一配置卡、触发说明、失败策略、可见性策略。
- `creator` 应属于 ToolAgent 家族，并能帮助创建 Agent 和 Group。
- Memory ToolAgent 应返回 `EXPERIENCE.md` 与 `MEMORY.md` 修改建议，由调用方应用。
- 前端和日志应区分普通 Agent 工作与 ToolAgent 后台辅助工作。

代码事实（2026-06-10 修复后）：
- `ToolAgentSpec` 与 `loadToolAgentSpec()` 已实现：`D:\agent-codes\CoBeing\packages\core\src\agent\tool-agent\spec.ts`。
- `ToolAgentType` 已包含 `creator`，并新增可见性、写入策略、失败策略类型：`D:\agent-codes\CoBeing\packages\core\src\agent\tool-agent\types.ts`。
- `data/toolagents/creator/config.json` 与 `prompt.md` 已新增，Creator 进入 ToolAgent 数据目录。
- Creator 已扩展 `runGroupCreator()`，可返回 `guide`、`plan`、`memberSuggestions`、`initialTasks`、`userConfirmations`：`D:\agent-codes\CoBeing\packages\core\src\agent\tool-agent\creator.ts`。
- `create_group` 路径已在创建群组后调用 Creator 草案，写入 `GUIDE.md` / `PLAN.md`，并把建议交给 host 首条系统消息：`D:\agent-codes\CoBeing\packages\core\src\api\ws-server.ts`。
- Memory 结果已扩展 `memoryUpdates` 和 `warnings`，并同步更新 `data/toolagents/memory/prompt.md`。

影响：
- ToolAgent 的类型、数据配置和 Creator/Memory 关键职责已经补齐第一步。
- 仍缺统一注册/发现机制、调用结果评估机制，以及 GUI/日志中对 ToolAgent 后台工作的明确区分。

归类：已从“标准化半实现”推进到“协议层与 Creator/Memory 职责已补齐，观测与评估仍未闭环”。

### 13. 群组 prompt 驱动实现较完整，但“通过 Butler 派发的关键节点回传”没有落地

设计期待：
- 群组采用纯 prompt 驱动，但通过 Butler 派发时关键节点必须能回传 Butler。

代码事实：
- Prompt、GUIDE、HOST_JOB、group-send 说明均已明显升级：`D:\agent-codes\CoBeing\packages\core\src\templates\group\GUIDE.md:1`、`D:\agent-codes\CoBeing\packages\core\src\templates\host\HOST_JOB.md:1`、`D:\agent-codes\CoBeing\packages\core\src\tools\group-tools.ts:286`。
- 工作区初始化也确实改成只自动创建 `GUIDE.md` 和 `EXPERIENCE.md`：`D:\agent-codes\CoBeing\packages\core\src\group\workspace.ts:102` 至 `D:\agent-codes\CoBeing\packages\core\src\group\workspace.ts:108`。
- 但关键节点回传 Butler 仍缺少结构化工具与桥接 Store，见 P0-3。

影响：
- 群组内部协作规则改善了，但用户主入口仍拿不到结构化托管状态。

归类：群组 prompt 本身已落地；和管家桥接的设计目标未实现。

## 已落地但不能算闭环的部分

- GlobalTodoStore：有持久化和基础 CRUD，但目前不是自动编排器。
- GlobalTodoPanel：能展示 Global TODO，但缺少真实 ButlerTask/回执/决策数据。
- Agent 增强工具：能读写 capability/inbox/reflection/proposals，但跨层同步、默认能力卡生成、自动续作不足。
- 群组 prompt 驱动：模板、group-send 描述、最小工作区是真实改动，但回传 Butler 不存在。
- ToolAgent 数据目录：config/prompt 文件存在，Creator 已补配置，ToolAgentSpec、Creator Group 草案和 Memory 修改建议已落地；仍缺统一发现、评估和前端/日志可见性闭环。

## 修复优先级建议

1. 先把 ButlerTaskStore / GroupButlerBindingStore 实例化进 Runtime，并在 Group 创建、Butler 派发时写入。
2. 实现 `butler-dispatch-to-agent` / `butler-dispatch-to-group`，保证创建 Global TODO + ButlerTask + executionRefs，而不是只发消息。
3. 实现 Host/Group -> Butler 的结构化事件工具，以及 Butler -> Group 的用户回复工具。
4. 让 Agent task report/complete 同步 Global TODO，并接入承担 Agent 的续作判断。
5. 新建 Agent 时生成 `capability.json`，或提供 Butler 可调用的能力卡初始化工具。
6. 把前端 TaskReceiptCard 和 ChatInputActions 接到真实 WS/API，而不是只渲染 metadata 或插入文本。
7. 在已补 ToolAgentSpec、Creator Group 草案和 Memory 修改建议的基础上，继续补日志/前端可见性区分、统一发现和调用评估机制。
