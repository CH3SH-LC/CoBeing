# 管家入口产品化研究

> 日期：2026-08-04 | 状态：**已完成实施**（阶段 A/B/C/D 全部落地，2026-08-04 同日下午）
> 方法：主线程一手核实 + 两路只读探索子智能体（后端管家能力 / 前端首次使用体验）交叉验证
> 定位：`当前待办.md` P1「管家入口产品化」的专项研究文档；产出缺口分析与分阶段实施方案，供下一轮开发使用。
> 实施记录：见 `PROGRESS.md` 2026-08-04「管家入口产品化四阶段全部实施」；验证 63 files / 565 tests + 管家冒烟 19/19。

---

## 1. 背景

产品战略（`docs/项目信息/产品战略.md`）与项目愿景（`GOAL.md`）把 CoBeing 收敛为「普通人的私人 AI Agent Team」：**管家是第一联系人**，Agent 是 AI 联系人，Group 是 AI 群聊，Market 是可信能力供应链。普通用户应该只面对管家，把 Agent/Group/Skill/Plugin 等复杂结构藏在自然语言入口之后。

管家职责被明确收窄为三件事：和用户对话、管理智能体、管理群组。可变的只是管家人格，不可变的是职责边界。

## 2. 战略要求（本轮研究的对照清单）

`当前待办.md` P1「管家入口产品化」列出五项增强，本研究报告逐项对照：

| # | 需求 | 战略原文要点 |
|---|------|-------------|
| 1 | 首次使用问卷 | 询问用户兴趣、生活需求、工作习惯、偏好风格；按结果创建少量初始 Agent；官方资源明显匹配才轻量推荐 |
| 2 | 管家模板 | 亲密朋友、专业秘书、学习陪伴、家庭助理等；用户有较高权限修改管家风格 |
| 3 | 管家自我风格优化 | 用户授权范围内调整语气、称呼、主动性、工作习惯 |
| 4 | 任务转接体验 | 用户清楚知道「管家何时自己答、何时转给 Agent、何时创建 Group」 |
| 5 | 低打扰提示 | 只有官方认证资源明显优于本地创建时才提示安装（Market 推荐已具备工具基础） |

## 3. 历史设计轨迹（2026-06，已确认方向但需核对落地度）

| 日期 | 设计文档 | 核心内容 | 落地状态（本报告 §4 核实） |
|------|---------|---------|--------------------------|
| 06-08 | `2026-06-08-butler-entry-bridge-design.md` | 管家入口与群组事件桥接：只收关键事件、事件桥接型、管家分身、全局 TODOboard 登记 | 方向已确认；事件桥接（escalationPolicy）**存而未用** |
| 06-09 | `2026-06-09-butler-entry-round1-data-layer-design.md` | 数据层：GlobalTodoStore / ButlerTaskStore / GroupButlerBindingStore + butler/host 前端过滤 | 已实施（2026-06-10 起代码可见） |
| 06-09 | `2026-06-09-butler-entry-round2-frontend-ui-design.md` | 前端管家入口 UI 第二轮：TaskReceiptCard / ChatInputActions / ButlerSidebar | 大部分已落地（卡片/快捷菜单已接入）；ButlerSidebar 未建（由 GlobalTodoPanel 承担）；卡片无数据流（见 §4.0） |
| 06-09 | `2026-06-09-frontend-butler-entry-polish-design.md` | 管家页侧栏/回执卡片/输入快捷动作/质感优化 | 部分实施（GlobalTodoPanel 真实数据流已上） |
| 06-10 | `2026-06-10-*`（PROGRESS 记录的 Butler 托管闭环第一轮） | dispatchButlerTask 全链路：Global TODO + ButlerTask + Agent inbox / Group TODO + 状态同步 | 已实施，且广播 `butler_task_updated`（前端未消费） |
| 06-11 | 项目现状记录 | 前端任务回执真实数据流仍按 Butler 待办边界推进 | 2026-08-04 核实：**仍未打通**（§4.0 断链分析） |

## 4. 现状盘点（代码事实）

> 三路证据：主线程一手核实（2026-08-04）+ 两路只读探索子智能体（后端管家能力 / 前端首次使用体验，报告返回后交叉验证）。

### 4.0 主线程已核实的关键事实

**管家数据与注册表**
- `data/coreagents/butler/`：AGENTS_REGISTRY.md / GROUPS_REGISTRY.md / TASK_LOG.md / butler-tasks.json / global-todos.json / butler-bindings.json / memory(SQLite) / proposals / skills(空) / workspace(空)——管家账本齐全且有真实使用数据（如 global-todos.json 含真实任务）
- `data/butler/` 是 ButlerRegistry 的文本账本（Agent/Group 注册表 + 任务日志），**不是管家模板目录**
- 管家模板（亲密朋友/专业秘书/学习陪伴/家庭助理）在代码与数据中**零痕迹**（grep 无命中）
- 管家风格机制仅有通用 `CHARACTER.md` 人格层（prompt-builder 按 persona 说话），无管家专属风格/称呼/主动性配置

**前端管家入口**
- `TaskReceiptCard.tsx`（状态机：运行中/待确认/已完成/失败/已取消 + 展开详情）与 `ChatInputActions.tsx`（派发/创建快捷菜单）**已落地**并接入 MessageBubble / ChatInput（view="butler"）
- ⚠️ **任务回执断链**：后端确实广播 `butler_task_updated` / `global_todo_updated`（dispatch.ts:47、dispatch-tools.ts:233/285、agent-task.ts:109、ws-server.ts:383-385），但前端只消费 `global_todo_updated`（GlobalTodoPanel 有真实数据流），**`butler_task_updated` 前端零 handler**；消息 metadata 的 `taskReceipt` 字段后端从不写入 → **TaskReceiptCard 实际永不渲染**（"看起来完整、实际空转"的典型）
- ⚠️ `stores/butlerTasks.ts`（ButlerTaskSummary + 状态汇总）**无任何组件引用**——僵尸 store；ButlerTask 状态事件前端零消费
- `ChatInputActions` 的派发/创建菜单只向输入框插入文本（onInsertText），不直接触发 WS 派发命令
- 新手教程 `TutorialOverlay.tsx` 已存在（isFirstLaunch + localStorage 标记，多步告知型引导），但**不是问卷型 onboarding**：不收集兴趣/需求/偏好，不创建初始 Agent

### 4.2 首次使用体验明细（前端探索子智能体盘点，2026-08-04）

**首次启动链路（完整但冷启动体验单薄）**
- 挂载顺序：useWebSocket → useChatPersistence → useTray → useKeyboardShortcuts → ThemeProvider（主题加载阻塞渲染）→ TutorialController → AppLayout
- 教程：6 步告知型浮层（欢迎/和管家对话/创建 Agent/群组协作/设置/开始探索），localStorage `cobeing_tutorial_done` 控制，可跳过/重开（设置→关于）
- WS 依赖：连 `ws://127.0.0.1:18765`，`state` 空自动重试 5 次×2s；离线宽限 5s、心跳 10s、离线排队 100 条
- 默认视图即管家（activeView: "butler" + 强制 activeConv "butler"）
- ⚠️ 空数据态：聊天区仅一行灰字「开始新的对话」（无建议问题/引导卡片）；后端未就绪时 ChatHeader 副标题渲染 `undefined / undefined · undefined` 且无「等待后端」提示；首启聊天区无管家欢迎消息
- ⚠️ 无 Provider 时发消息：用户消息挂「发送中...」直到 agent_error 标红或 60s 超时，错误只截 30 字符小字显示

**管家页三件套（完整，快捷入口实用）**
- ChatHeader：首字头像 + 状态点 + 名称 + provider/model + 新对话 + 设置齿轮 + 连接灯
- ChatInput：斜杠命令（/new /clear /bind /unbind /skills）+ ⚡技能插入 `{{skill:name}}` + @mention（仅群组）
- ChatInputActions（仅管家视图）：「派发」插入 `@agentId`/`@groupId` 文本、「创建」插入 `/new`、`/new-group`、「摘要」插入固定 prompt——全部是文本插入，无结构化转接
- GlobalTodoPanel：标题「全局任务」+ 状态计数徽章（待派发/执行中/等待你/已完成/已取消）+ 任务行（标题/状态/指派），数据经 `get_global_todos` + `ws-global-todos` 事件——**真实数据流**

**管家对话数据流（健壮）**
- 发送 `send_message{agentId}` → stream_token 流式 → agent_response/agent_completed 收尾（60s 安全超时 + finalizeStream 兜底 + 去重）
- ⚠️ TaskReceiptCard 渲染条件 `msg.metadata.taskReceipt` 存在——前端无任何写入方，完全依赖后端往消息 metadata 塞（后端也不发）
- ⚠️ `stores/butlerTasks.ts` 全项目零消费者（死代码）

**设置与偏好**
- 设置分组：个人资料/常规/主题/连接（Providers/Channels）/运维（沙箱监控）/数据/关于；默认停在「主题」
- ⚠️ 通知开关（enabled/sound）只存 zustand 内存，不持久化；**声音开关无任何 `new Audio`/播放代码（假开关）**；Tauri `sendNotification` 定义了但全项目无调用点；托盘未读计数 `incrementUnread` 从未被调用（恒 0）
- 管家设置入口（ButlerConfigPanel Sheet）只有工程配置：Provider/Model/权限/沙箱/工具白名单——**无管家称呼/头像/语气/风格/欢迎语**
- 未读徽章链路真实（NavBar 总数 + Sidebar 单项，切换会话清除）
- 孤儿组件：WakeQueueSection 定义后未在任何视图渲染

**首次使用总评（探索子智能体结论）**：最顺——6 步教程概念清楚、管家页信息架构清晰、流式回复/状态徽章/工具调用展示完整；最卡——空态单薄无示例问题、通知声音/系统通知/托盘未读是假开关或断链、管家零个性化设置、首启无管家问候、任务转接无卡片化视觉。

### 4.1 后端管家能力明细（后端探索子智能体盘点，2026-08-04）

**管家工具面（构造时无条件注册，40+ 个）**
- Agent 生命周期：butler-create/destroy/modify/find-agent（find 按 capability.json 用 LLM 打分匹配最佳人选）
- 群组生命周期：butler-create/destroy-group、add-to-group、run-group、check-group
- 派发与状态：butler-dispatch-to-agent/group、get-work-status、cancel-work、reply-to-group、dispatch-task（旧别名）
- 工作区/注册表/频道/工作流/成长审查：bind-workspace、list、read/update-registry、channel-bind/unbind、workflow-analyze/plan、review-proposals
- TODO：todo-* 五件 + global-todo-* 五件；Market：market-recommend / market-install（2026-08-03）
- 群组通信：group-members、talk-create/send/read、group-send

**systemPrompt（关键事实）**
- ⚠️ `data/coreagents/butler/config.json` **不存在**——实际生效的是 runtime.ts:320 硬编码默认 systemPrompt
- 内容：身份（"像朋友一样聊天"）+ 创建群组 5 规则（复用优先）+ 多步推理标准流程（list→判断→create→run，"直接调用工具"）+ 主动建议补充角色
- ⚠️ **没有"简单问题自己答 / 复杂任务转 Agent / 建 Group"的分级判断规则**——转接决策全靠 LLM 临场发挥
- ⚠️ **管家走固定 prompt 路径**（butler.ts:149-163 不传 promptBuilder），`buildSystemPromptFromFiles` 三层文件架构对管家不生效——**管家的 EXPERIENCE.md / memory 内容不进 prompt**（agent.ts:424-425 注释明说）；管家也没有 JOB.md/AGENTS.md/CHARACTER.md/MEMORY.md 文件（对比 host 有 config.json+JOB.md+EXPERIENCE.md+MEMORY.md）

**任务链（最成型的子系统）**
- dispatchButlerTask 全流程：校验 → GlobalTodo.add(running) → ButlerTask.create → Agent inbox 条目 + 系统消息 / Group condition TODO(0time) + @responsibleAgentId → 回填 butlerTaskId/executionRefs → 广播 `global_todo_updated` + `butler_task_updated`
- ButlerTask 状态机：routing→dispatched→running→{waiting_user/completed/failed/cancelled}，completed 可返工回 running；字段含 latestSummary/pendingQuestion/acceptance/constraints/userPreferences
- 回传闭环：Agent 用 agent-task-report/agent-task-complete → 更新 GlobalTodo(status/blocker/lastEvent) + ButlerTask + 广播
- GlobalTodoStore API 含 getStalled/getWaitingUser/setBlocker（被 butler 工具消费，非死代码）
- 真实数据已跑通：butler-tasks.json / global-todos.json 有真实记录

**交互层与 WS**
- ConversationLoop 无任何 butler 特判；管家在 WS 层就是普通 Agent（send_message 完全通用）
- 派发回执 `formatDispatchReceipt` 是文本（"✅ 已创建可追踪管家任务 + 三个 ID"）——**无转接/移交会话概念**，派完就结束回复
- WS 命令全部真实：find_agent（打分排序）、dispatch_task、get_global_todos、get_agent_inbox、get_agent_capability/proposals、approve/reject_proposal
- ⚠️ `butler-bindings.json` 已生成但 **escalationPolicy 无任何代码消费**——"存而未用"的机制

**模板/人格机制**
- 无管家模板目录（templates/ 只有 agent/group/host）；无称呼/语气/主动性配置面
- `data/butler/` 是历史遗留目录（内容为占位文本，最后更新 2026-07-09），当前代码指向 `data/coreagents/butler/`，无代码引用旧目录

**后端视角首次启动**
- 管家创建只读不写：config.json 不存在 → 默认配置；**无 ensureButlerDir**
- host 首次启动自动写 config.json（纯协调工具白名单 + 剥离执行工具）+ 同步 HOST_JOB.md
- **零问卷/零引导**（grep onboard/wizard/问卷/首次运行标志零命中）；首次对话就是用户说"你好"，靠硬编码 systemPrompt 自由发挥

### 4.3 已有但未接入清单（"最后一公里"机会点）

| 已有资产 | 未接入点 | 复活成本 |
|---------|---------|---------|
| TaskReceiptCard（状态机完整） | 后端不写消息 metadata.taskReceipt；前端无写入方 | 低：后端派发时附回执 payload + 前端 handler 写 metadata |
| stores/butlerTasks.ts（汇总 store） | 零组件引用；`butler_task_updated` 前端零 handler | 低：新增 handler + 一处 UI 消费 |
| 后端 `butler_task_updated` 广播（4 处） | 前端无人监听 | 低：todo-handlers 增加处理 |
| butler-bindings.json + escalationPolicy | 无消费方（Group→Butler 结构化事件未落地） | 中：需要 Group 侧事件桥 |
| ChatInputActions 派发/创建菜单 | 只插文本，不触发结构化派发 | 低：改为发 dispatch_task |
| EXPERIENCE.md（管家 4.4KB 真实经验） | 固定 prompt 路径下不进 prompt | 中：管家改走文件 prompt 或追加动态层 |
| WakeQueueSection | 无视图渲染 | 决策：接入群组详情或删除 |
| 通知声音/系统通知/托盘未读 | 假开关/死代码 | 低：持久化 + 真实播放/通知链路 |

## 5. 差距分析（五项需求 × 现状 → 缺口）

### 5.1 任务转接体验 —— 缺「真实数据流」，而非缺组件

| 现状 | 缺口 |
|------|------|
| 后端托管链路齐全：dispatchButlerTask → Global TODO + ButlerTask + Agent inbox/Group TODO + 状态同步（2026-06-10 闭环） | ButlerTask 状态变化**没有事件广播**到前端（无 task_receipt / butler_task 类 WS 事件） |
| 前端 TaskReceiptCard 已写好（状态机/摘要/下一步/产物） | 无任何写入方，**永不渲染** |
| 前端 stores/butlerTasks.ts 已写好（状态汇总） | 零消费者（死代码） |
| ChatInputActions 派发/创建菜单已接入 | 只插文本，不触发结构化派发；用户发完 `@agent` 后只能等自然语言回复 |

**缺口定性**：这是「最后一公里」问题——桥接后端事件（结构化 WS 事件 + 消息内联回执）即可让组件全部复活。优先级最高。

### 5.2 首次使用问卷 —— 完全缺失

| 现状 | 缺口 |
|------|------|
| 6 步告知型教程浮层（讲概念） | 不是问卷：不收集兴趣/生活需求/工作习惯/偏好风格 |
| Creator ToolAgent 已能生成 Agent 核心文件（2026-06-10 起） | 问卷→初始 Agent 创建链路不存在 |
| Market 官方内置资源已就绪（2026-08-03） | 问卷结果 → 轻量推荐官方资源的规则不存在 |
| 空数据态只有一行「开始新的对话」 | 无引导性问题/欢迎消息 |

**缺口定性**：从零开始的新功能，但底层能力（Creator ToolAgent、Market catalog、butler 工具）全部可复用。战略倾向「管家主动询问的可跳过对话」而非强制流程（决策点 1）。

### 5.3 管家模板 —— 完全缺失

| 现状 | 缺口 |
|------|------|
| 管家人格仅有通用 CHARACTER.md 机制（所有 Agent 共用） | 无管家专属模板库（亲密朋友/专业秘书/学习陪伴/家庭助理…） |
| data/coreagents/butler/ 有 config.json + 文件体系 | 无模板 manifest/复制/切换机制 |
| ButlerConfigPanel 只有工程配置 | 无「管家形象」设置入口（称呼/语气/欢迎语） |

**缺口定性**：从零开始。模板本质是「人格文件包」——复用 Agent 五文件体系即可，主要工作在模板内容与切换/复制机制。

### 5.4 管家自我风格优化 —— 完全缺失

| 现状 | 缺口 |
|------|------|
| Memory ToolAgent 已能输出 MEMORY.md 修改建议（需调用方应用） | 无管家专属「风格观察 → 建议 → 用户确认 → 应用」链路 |
| 管家 EXPERIENCE.md/记忆可写入 | 无授权边界定义（哪些可自动应用、哪些必须确认） |
| prompt-builder 按 CHARACTER.md 说话 | 无称呼/语气/主动性的结构化配置或运行时调整 |

**缺口定性**：从零开始，但可复用 Memory ToolAgent 的「建议 + 调用方应用」模式。建议列为阶段 C（依赖模板机制先落地）。

### 5.5 低打扰提示 —— 工具已就绪，缺策略

| 现状 | 缺口 |
|------|------|
| butler-market-recommend / butler-market-install 已注册（2026-08-03） | 无推荐时机规则（何时提示、何时闭嘴） |
| Market 四层分级 + 风险等级已在资源模型里 | 无「明显优于本地创建」的判定阈值/评分 |
| 社区资源门禁双层已生效 | 社区资源提示话术/确认话术未产品化 |

**缺口定性**：最小工作量——主要是 Butler 系统 prompt 的推荐纪律 + 可选的低成本评分函数。

## 6. 分阶段实施方案

> 排序原则：先复活已有资产（低投入高回报），再建新能力（中高投入）；每阶段独立可交付、可验证。

### 阶段 A：转接体验真实化（复活已有资产，预计 1 轮开发）

**目标**：让 TaskReceiptCard / butlerTasks store / ChatInputActions 从"空壳"变为真实数据流。

1. **后端**：派发时在消息 metadata 附回执 payload（`formatDispatchReceipt` 从文本升级为结构化 TaskReceipt：title/assigneeType/assigneeName/status/summary/nextAction/artifacts），`dispatchButlerTask` 广播时携带完整 ButlerTask 视图。
2. **前端**：新增 `butler_task_updated` handler → 写入消息 metadata（点亮 TaskReceiptCard）+ 更新 butlerTasks store（复活死代码）。
3. **前端**：ChatInputActions 派发菜单从"插文本"升级为"直接发 `dispatch_task`"（用户选 Agent/Group → 结构化派发 → 聊天内出现回执卡片）。
4. **prompt 纪律**：管家 systemPrompt 增加「自己答 vs 派发」分级规则（简单问答/寒暄/短润色自己答；多步研究/长文/协作任务默认派发；不确定时先问用户），落实 butler-entry-bridge 设计的"管家工作边界"。
5. **验证**：真实派发 → 聊天内回执卡片出现 → Agent 完成后卡片状态流转（running→completed）；`butler_task_updated` 前端收到事件。

### 阶段 B：首次使用问卷 + 初始 Agent 生成

**目标**：新用户第一次打开不是空白聊天，而是"管家主动问需求 → 生成初始 Agent/推荐官方资源"。

1. **前端**：首启检测（localStorage 标记，区分于现有教程标记）→ 管家聊天区注入欢迎消息 + 引导性问题（可选选择器：生活/学习/旅行/购物/创作/家庭事务/工作杂事——Bilibili 兴趣选择式）。
2. **后端**：新增 `onboarding_apply` WS 命令或复用现有 butler 工具链：问卷答案 → Creator ToolAgent 生成 1-2 个初始 Agent（复用 2026-06-10 创建链路，不静默批量创建）。
3. **Market 轻量推荐**：问卷结果 → market-recommend 官方资源做 1 次轻量推荐（≤2 条，用户可一键跳过）。
4. **空态打磨**：后端未就绪时头部不渲染 undefined（占位文案）；首启欢迎消息进入聊天流。
5. **验证**：全新 data 目录启动 → 完成问卷 → 出现 1-2 个真实可用 Agent；跳过路径不产生任何 Agent。

### 阶段 C：管家模板 + 风格优化

**目标**：管家有可选人格（亲密朋友/专业秘书/学习陪伴/家庭助理…），且能在授权范围内自我优化。

1. **模板机制**：新增 `templates/butler/<persona>/`（CHARACTER.md 人设 + 系统 prompt 变体 + 称呼/主动性参数），复制到 `data/coreagents/butler/`；GUI 管家设置增加「管家形象」区（选模板/称呼/欢迎语）。
2. **⚠️ 前置修复**：管家从固定 prompt 改为文件 prompt 路径（或至少追加动态层），否则模板文件与 EXPERIENCE.md 内容不生效——这是模板与风格优化的地基。
3. **风格优化链路**：复用 Memory ToolAgent 模式——管家定期输出「风格建议」（称呼/语气/主动性调整），写入管家 EXPERIENCE.md，**低风险项（称呼/口头禅）经用户确认后应用**，高风险项（职责边界）永不自动改。
4. **验证**：切换模板后对话语气变化可感知；风格建议流程在授权范围内闭环。

### 阶段 D：低打扰提示策略（可与 A 并行）

1. **推荐纪律 prompt**：管家 systemPrompt 增加 Market 推荐规则——官方内置/认证且明显优于本地才轻量提示（1 次/会话上限），社区资源必须走确认流程，本地已具备能力时闭嘴。
2. **轻量评分**（可选）：复用 scoreCapability 思路对市场资源做"需求匹配分"，≥ 阈值才提示。
3. **验证**：向管家提出"旅行规划"需求 → 至多 1 次轻量推荐；提出已有 Agent 覆盖的需求 → 无推荐打扰。

### 依赖关系

- 阶段 B 依赖：阶段 A 的转接体验（问卷产生的 Agent 需要回执闭环展示）；Market 资源就绪（已就绪）
- 阶段 C 依赖：无前置（但建议 A 完成，避免同时动 prompt 路径）
- 阶段 D 依赖：无（Market 2026-08-03 已就绪）

## 7. 风险与决策点

- 决策点 1：问卷形态——「首次启动引导流程」vs「管家主动询问的可跳过对话」？研究报告倾向后者（战略原文"管家询问用户生活需求"），但需确认是否增加独立首启弹层。
- 决策点 2：管家模板实现——「文件模板包（templates/butler/<persona>/）」vs「数据配置 + LLM 生成」？倾向前者（与 host/agent 模板体系一致、可审查）。
- 决策点 3：风格优化写入边界——低风险项（称呼/语气）自动应用需不需要用户逐条确认？参考 Memory ToolAgent 现有"建议 + 调用方应用"约定，倾向「建议批量展示 + 用户一键应用」。
- 决策点 4：转接体验前端形态——聊天内回执卡片 vs 全局任务面板（GlobalTodoPanel 已承担后者）；结论：**卡片承担单次转接反馈，面板承担全局账本**，两者分工明确，无需合并。
- 风险 1：管家改走文件 prompt 路径可能影响现有对话行为（需回归验证管家工具调用不退化）。
- 风险 2：问卷生成的初始 Agent 若质量差会反向伤害首次体验——只生成 1-2 个、可一键删除、失败不阻塞。
