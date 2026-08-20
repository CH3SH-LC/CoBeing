# CoBeing 项目结构

> 最后更新：2026-08-12  
> 本文件记录当前工作区和 CoBeing 代码结构。新增、删除、重命名项目文件或目录时必须同步更新。

---

## 工作区顶层结构

```text
D:\agent-codes\
├── CLAUDE.md                 # 工作区入口指令
├── GOAL.md                   # CoBeing 产品愿景
├── README.md                 # CoBeing 项目说明
├── STRUCTURE.md              # 本文件
├── PROGRESS.md               # 详细开发进度（2026-06 起；更早条目已归档）
├── PROGRESS-LITE.md          # 精简开发进度（2026-06 起；更早条目已归档）
├── PROGRESS-VERSION.md       # 版本发布记录
├── .claude/                  # Claude 配置与本地 skills
├── .superpowers/             # Superpowers 相关配置
├── CoBeing/                  # 主项目代码目录
├── docs/                     # 项目文档
├── node_modules/             # 工作区依赖
├── projects/                 # 其他独立项目
├── releases/                 # 发布产物归档
├── resourses/                # 资源目录
├── roadshow/                 # 路演材料
└── 备份/                     # 历史备份
```

---

## CoBeing 主代码目录

```text
CoBeing/
├── CLAUDE.md                 # 项目级指令
├── package.json              # pnpm monorepo 根配置，当前版本 1.4.0
├── pnpm-workspace.yaml       # packages/* 与 packages/mcp-servers/* workspace
├── pnpm-lock.yaml
├── tsconfig.base.json
├── vitest.config.ts
├── start.bat                 # Windows 启动脚本
├── build-gui.bat             # GUI 构建脚本
├── main-icon.png
├── config/
│   └── default.json          # 默认配置：deepseek、butler、host、GUI wsPort 18765
├── packages/                 # 后端 monorepo 包
├── gui-v2/                   # React 19 + Tauri 2 前端
├── data/                     # 运行时数据
├── scripts/                  # 开发脚本（dev.ts、start-core.ts、clear-pvz-test-data.ts、smoke-butler.ts、smoke-market.ts、real-test-pvz.ts、real-test-chenmo.ts、verify-path-guard.ts、verify-extensions.ts、build-sandbox.sh、kill-cobeing-port.ps1 等）
└── sandbox/                  # Docker 沙箱镜像
```

---

## 后端包结构

```text
CoBeing/packages/
├── core/                     # @cobeing/core：运行时主体
│   └── src/
│       ├── runtime.ts        # CoBeingRuntime 顶层编排器
│       ├── runtime/          # runtime 辅助模块（ensureSandboxConfig 等纯函数）
│       ├── agent/            # Agent、Butler、AgentRegistry、ToolAgent
│       ├── api/              # WebSocket server 与 GUI 命令
│       ├── butler/           # ButlerTaskStore、GroupButlerBindingStore
│       ├── channels/         # Channel 运行时桥接
│       ├── conversation/     # ConversationLoop、PromptBuilder
│       ├── group/            # Group、GroupManager、WakeSystem、上下文与记忆
│       ├── memory/           # MemoryStore、SQLite/FTS5、安全扫描
│       ├── market/           # Market 分级机制：catalog/installer/tools/bundled 内置资源
│       ├── mcp/              # MCP client、manager、transport、bridge tool
│       ├── observability/    # 活动、指标、仪表盘数据
│       ├── plugins/          # 插件运行时接入
│       ├── review/           # 审查相关逻辑
│       ├── skills/           # SkillRepository 与 SKILL.md 加载
│       ├── todo/             # Agent/Group TODO 与扫描器
│       ├── tools/            # ToolRegistry、ToolExecutor、权限、沙箱、内置工具
│       └── workflow/         # 工作流引擎
├── shared/                   # @cobeing/shared：类型、事件、日志、registry
├── providers/                # @cobeing/providers：Provider 接口、OpenAI-compatible、DeepSeek catalog
├── channels/                 # @cobeing/channels：Channel 接口、QQ Bot channel
├── plugin-sdk/               # @cobeing/plugin-sdk：manifest、loader、hook、prompt layer、UI extension
└── mcp-servers/
    ├── qqbot/                # QQ Bot MCP server（2026-08-12 接入 runtime：access_token 鉴权修复）
    ├── office/               # Office MCP server
    ├── claude-code/          # Claude Code MCP server — 编码任务委托（2026-08-11）
    └── browser/              # Browser MCP server — Playwright 浏览器自动化（2026-08-12 新增）
```

### core/src/todo 子目录

```text
CoBeing/packages/core/src/todo/
├── continuation-judgment.ts   # 自动续作判断核心 — 任务承担 Agent 判断是否生成后续
├── continuation-judgment.test.ts # 自动续作应用测试
├── global-store.ts            # GlobalTodoStore — 用户级全局 TODO 总账（JSON 持久化）
├── global-store.test.ts       # GlobalTodoStore 单元测试（23 tests）
├── global-tools.ts            # Butler 编排工具（5 个：add/list/update/link/continue）
├── group-scanner.ts          # Group TODO 扫描、触发、完成、副作用链
├── scanner.ts                # Agent TODO 扫描
├── scanner.test.ts           # Agent/Group TODO scanner 与 TodoStore 测试
├── store.ts                  # TODO.json 存储与状态操作
├── time-tool.ts              # 当前时间工具
├── tools.ts                  # todo-add/list/complete/review/batch 工具
├── tools.test.ts             # TODO 工具群组完成路径测试
└── types.ts                  # TODO 类型、状态与扫描常量
```

### core/src/butler 子目录

```text
CoBeing/packages/core/src/butler/
├── dispatch.ts                # Butler tracked dispatch：Global TODO + ButlerTask + Agent/Group 执行引用
├── butler-task-store.ts       # ButlerTaskStore — 管家任务编排账本（JSON 持久化 + 状态机）
└── butler-binding-store.ts    # GroupButlerBindingStore — 群组管家绑定（JSON 持久化）
```

### core/src/tools 中的 Agent 增强工具

```text
CoBeing/packages/core/src/tools/
├── agent-capability.ts        # Agent 能力卡读取/更新，缺失时可创建默认能力卡
├── agent-task.ts              # Agent 任务收件箱，和 Global TODO / ButlerTask 同步状态
├── agent-task.test.ts         # Agent task 与 Butler/Global TODO 同步测试
├── agent-growth.ts            # Agent 成长建议工具
├── agent-resource.ts          # Agent 资源请求工具（广播 butler_resource_request + 写管家收件箱 RESOURCE_REQUESTS.md）
├── file-version.ts            # 并发写防护 CAS：文件版本（mtimeMs:size），read-file 附版本行，write/edit-file baseVersion 校验
├── file-version.test.ts       # 并发写防护单测（过期 baseVersion 拒绝/正确版本通过/新文件放行）
├── safety-classifier.ts       # 安全分类器（决策 #10）：reasoning-blind LLM 裁决 allow/deny/ask，fail-closed + 熔断 + allow 缓存
├── safety-classifier.test.ts  # 安全分类器单测（裁决/缓存/熔断/无 provider fail-closed）
├── path-guard.ts              # 路径误用防护：拦截 data/、coreagents/ 等数据目录段前缀路径（含 .bak 备份段），read/write/edit/glob/grep 5 工具接入
└── path-guard.test.ts         # detectDataPathMisuse 单测（合法/绝对/逃逸/双重拼接/模拟目录/备份目录）
```

### core/src/observability 子目录

```text
CoBeing/packages/core/src/observability/
├── observability-db.ts       # ObservabilityDB：LLM/Tool 调用指标、Dashboard 聚合，SQLite 优先并支持 JSON fallback
└── observability-db.test.ts  # SQLite native binding 不可用时的观测数据降级回归测试
```

### core/src/agent/tool-agent 子目录

```text
CoBeing/packages/core/src/agent/tool-agent/
├── base.ts                    # ToolAgent 独立 LLM 工具循环与 data/toolagents 读取
├── spec.ts                    # ToolAgentSpec 统一配置卡 loader（触发/可见性/写入/失败策略）
├── registry.ts                # 轻量 ToolAgentRegistry：统一注册/发现入口（loadAll + registerPluginAgent 复活插件死注册）
├── registry.test.ts           # ToolAgentRegistry 单测（loadAll 8 spec/插件注册/creator 配置卡权威）
├── creator.ts                 # Creator ToolAgent：Agent 核心文件与 Group 创建草案（prompt 配置卡权威）
├── memory.ts                  # Memory ToolAgent：经验条目（含 ttl/provenance 归一化）与 MEMORY.md 修改建议
├── review.ts                  # Review ToolAgent：群组消息发送前审查
├── judgment.ts                # Judgment ToolAgent：群主唤醒判断
├── clone.ts                   # Clone ToolAgent：临时并行子任务
├── capability-updater.ts      # 能力卡更新助手
├── growth-reviewer.ts         # 成长建议审查助手
├── task-archive.ts            # 任务归档助手
├── tool-agent.test.ts         # ToolAgent 单元测试
└── types.ts                   # ToolAgent 类型、Spec、Memory 更新建议类型（MemoryEntry 含 ttl/provenance）
```

### core/src/agent/butler/tools 子目录

```text
CoBeing/packages/core/src/agent/butler/tools/
├── agent-tools.ts            # Agent 生命周期工具：butler-create/destroy/modify/find-agent
├── group-tools.ts            # 群组生命周期工具：butler-create/destroy/add-to-group/run-group/check-group
├── dispatch-tools.ts         # Butler 可追踪派发：butler-dispatch-to-agent/group、get-work-status、cancel-work、reply-to-group、dispatch-task、getButlerDispatchDeps、formatDispatchReceipt
├── workspace-tools.ts        # 工作区工具：butler-bind-workspace、butler-list
├── channel-tools.ts          # Channel 绑定工具：channel-bind、channel-unbind
├── registry-tools.ts         # 注册表工具：butler-read-registry、butler-update-registry
├── workflow-tools.ts         # 工作流工具：workflow-analyze、workflow-plan
├── review-tools.ts           # 成长建议审查：butler-review-proposals
└── persona-tools.ts          # 管家 persona 工具：butler-list-personas/set-persona/update-style（对话式首启用）
```

同目录 `agent/butler/persona-utils.ts`：管家人格文件操作（list/apply persona、apply user style），WS 命令与管家工具共用。
```

### core/src/api 子目录（B1 ws-server 拆分）

```text
CoBeing/packages/core/src/api/
├── ws-server.ts              # CoreWSServer 主类：连接生命周期 + 命令注册表分发（3111→571 行）
├── ws-server.test.ts         # 纯函数测试（buildTodoMutationPayload/buildGroupCreatorDraftNote）
├── security.ts               # 安全/脱敏工具：maskApiKey/cloneForClient/isSafeId/resolveWithin/isSafeConfigPath 等
├── types.ts                  # WSMessage/TodoMutationAction/TodoMutationContext/buildTodoMutationPayload/buildGroupCreatorDraftNote
├── capability.ts             # loadCapabilityCards/scoreCapability 能力卡扫描评分
├── parsing.ts                # extractMentions/parseCurrentMd
└── handlers/                 # 78 个 WS 命令按域分组
    ├── types.ts              # WsCommandHandler/HandlerRegistrar
    ├── system.ts             # _ping/get_state/get_log/get_config/update_config/subscribe_log
    ├── agent.ts              # create/destroy/stop/update_agent、agent_files、chat_current、find_agent、dispatch_task（支持 agent/group 目标）
    ├── butler-persona.ts     # butler_get_personas/set_persona/update_style（管家人格模板与风格，复用 persona-utils）
    ├── onboarding.ts         # onboarding_apply/get（保留；首启已改为管家对话式，前端不再调用）
    ├── group.ts              # create/destroy_group、group_member、group_workspace、group_history、group_health
    ├── market.ts             # market_list/get/install/uninstall/installed（Market 分级 5 命令）
    ├── plugin.ts             # list_ui_extensions/list_plugins/plugin_instance/toggle_plugin/update_plugin_config
    ├── binding.ts            # add/remove/list_bindings、bind/unbind_channel
    ├── message.ts            # get_wake_queue/send_message
    ├── todo.ts               # get/add/complete/remove/update_todo、batch_*、get_global_todos
    ├── observability.ts      # get_dashboard/llm_stats/tool_stats/screener_stats/agent_timeline/search_conversation/export_data
    ├── sandbox.ts            # get_sandbox_status/sandbox_action
    ├── skill.ts              # get_skills/skill_doc/execute_skill/skill_create
    └── enhancement.ts        # get_agent_capability/inbox/proposals、approve/reject_proposal
```

### core/src/runtime 子目录

```text
CoBeing/packages/core/src/runtime/
├── sandbox-helper.ts         # ensureSandboxConfig 纯函数
├── plugin-loader.ts          # 插件加载域：loadAllPlugins/bootstrapRegistry（从 runtime.ts 拆分，2026-08-11）
├── providers.ts              # Provider 构建域：buildProviders/rebuildProvider/resolveProviderModels（2026-08-11）
├── market.ts                 # Market 服务域：initMarketServices/registerMarketAgent/createMarketGroup（2026-08-11）
├── channels.ts               # Channel 生命周期域：startChannels/setupChannelOnMessage/stopChannels（2026-08-11）
└── core-agents.ts            # 核心 Agent 创建域：ensureButlerDir/ensureHostDir/createButler/registerPrebuiltAgents/restoreAgents（2026-08-11）
```

### core/src/agent 子目录（辅助模块，2026-08-11 拆分）

```text
CoBeing/packages/core/src/agent/
├── agent-tools.ts            # registerAgentTools：构造时注册 memory/TODO/群组记忆/增强等内置工具（从 agent.ts 拆分）
├── review-prompt.ts          # buildReviewPrompt/parseReviewResult：群组消息审核 prompt（从 agent.ts 拆分）
└── wake-context.ts           # （位于 group/，见下）
```

### core/src/group 子目录（wake 上下文模块，2026-08-11 拆分）

```text
CoBeing/packages/core/src/group/
├── wake-context.ts           # buildWakeContext：群组唤醒三层上下文构建（从 wake-system.ts 拆分）
```

### core/src/templates/butler 子目录（管家模板体系，2026-08-04）

```text
CoBeing/packages/core/src/templates/butler/
├── base/                          # 管家基础文件模板（AGENTS.md 运行边界 / MEMORY.md / EXPERIENCE.md）
└── personas/                      # 4 人格模板 ×（CHARACTER.md 人设 + JOB.md 职责/分级转接规则/Market 推荐纪律/多步任务推进流程/首启对话范式）
    ├── 亲密朋友/
    ├── 专业秘书/
    ├── 学习陪伴/
    └── 家庭助理/
```

### core/src/market 子目录

```text
CoBeing/packages/core/src/market/
├── types.ts                  # MarketResource/Tier/RiskLevel/Dependency/DepNode/InstallResult/InstalledEntry
├── catalog.ts                # MarketCatalog（扫描 data/market/<tier>/<id>/market.json + installed.json 持久化）+ buildLocalResources
├── installer.ts              # MarketInstaller（防环依赖树/社区门禁/拓扑序三类落盘/卸载/路径穿越防护）
├── tools.ts                  # makeMarketRecommendTool / makeMarketInstallTool（Butler 工具）
├── bundled/                  # 内置资源打包源（启动时同步到 data/market/）
│   ├── official/travel-planning/    # 官方 skill「旅行规划」
│   ├── official/travel-planner/     # 官方 agent「旅行规划师」（依赖 skill）
│   ├── official/travel-team/        # 官方 group「旅行规划小队」（依赖 agent）
│   └── community/expense-assistant/ # 社区 agent「记账小助手」（演示门禁）
├── catalog.test.ts           # 9 测试：扫描/过滤/持久化/local 合成
└── installer.test.ts         # 16 测试：依赖树/门禁/落盘/卸载/穿越/幂等
```

### shared/src 关键文件

```text
CoBeing/packages/shared/src/
├── butler-bridge.ts           # Butler 桥接共享类型：ButlerTask, GlobalTodoItem, GroupButlerBinding,
│                              #   ButlerEscalationEvent, ButlerUserQuestion, 常量
├── types.ts                   # 核心类型：PermissionMode, WorkspaceBinding, AgentConfig
├── events.ts                  # 事件类型
├── constants.ts               # 共享常量
└── ...
```

---

## GUI 结构

```text
CoBeing/gui-v2/
├── package.json
├── src/
│   ├── App.tsx               # GUI 根组件
│   ├── main.tsx
│   ├── components/           # 视图、面板、对话框、共享组件
│   │   ├── chat/             # 单聊/群聊消息组件、头像、主题化气泡框
│   │   │   ├── ChatView.tsx          # 主入口（646→68 行）
│   │   │   ├── ChatHeader.tsx        # 标题栏
│   │   │   ├── MessageList.tsx       # 消息列表 + 自动滚动
│   │   │   ├── MessageBubble.tsx     # 单条消息气泡
│   │   │   ├── ToolCallsGroup.tsx    # 工具调用手风琴
│   │   │   ├── ThinkingBubble.tsx    # 流式思考指示
│   │   │   ├── ChatInput.tsx         # 输入框（斜杠命令/技能/@mention）
│   │   │   ├── TodoInline.tsx        # TODO 内联预览
│   │   │   ├── GroupChatView.tsx     # 群聊入口
│   │   │   └── ...
│   │   └── settings/         # 设置页、主题选择、个人资料设置
│   ├── hooks/                # WebSocket、状态、业务 hook
│   │   ├── useWebSocket.ts   # 主 hook（759→104 行），ctx + handler 表分发
│   │   └── ws-handlers/      # 76 种 WS 消息 handler 按域分组
│   │       ├── chat-handlers.ts / registry-handlers.ts / extension-handlers.ts / market-handlers.ts
│   │       ├── butler-task-handlers.ts / onboarding-handlers.ts
│   │       ├── todo-handlers.ts / system-handlers.ts / observability-handlers.ts
│   │       ├── mentions-user.test.ts  # @用户 唤醒识别测试（2026-08-05）
│   │       └── types.ts / helpers.ts  # helpers：extractMentions/mentionsUser（用户别名 @用户/@主人/@老板/@user）
│   ├── lib/                   # 前端工具函数（coreAgents.ts、userProfile.ts、chat-utils.ts、taskReceipt.ts、notify.ts 等）
│   ├── stores/               # Zustand 状态（含 theme.ts、userProfile.ts、butlerTasks.ts、market.ts、onboarding.ts）
│   ├── types/                # 前端类型
│   └── utils/                # 前端工具函数
├── src-tauri/                # Tauri 2 桌面壳
└── public/
    └── themes/               # 内置主题；sakura-mint 默认，executive-workbench 工作台主题
```

当前 GUI 主入口为：管家、智能体、群组、仪表盘、扩展、设置。扩展页含四个 tab：技能、MCP、插件、Market（Market 为分级资源浏览/安装入口，2026-08-03 新增）。

---

## data 运行时目录

```text
CoBeing/data/
├── agents/                   # 用户创建的 Agent
│   └── <agent-id>/
│       ├── AGENTS.md
│       ├── EXPRESSION.md          # 人味表达规范（2026-08-05 起取代 CHARACTER.md；旧 Agent 的 CHARACTER.md 兼容）
│       ├── JOB.md
│       ├── MEMORY.md
│       ├── EXPERIENCE.md
│       ├── capability.json    # AgentCapabilityCard，供 Butler/Host/Group 调度匹配
│       ├── inbox.json         # AgentTaskInboxItem，支持 Butler tracked task 关联
│       ├── reflection.json    # Agent 任务反思记录
│       ├── proposals/         # Agent 成长建议
│       └── config.json
├── coreagents/               # butler、host 等核心 Agent
│   └── butler/               #   管家文件体系（config.json + AGENTS/CHARACTER/JOB/MEMORY/EXPERIENCE.md，首启 ensureButlerDir 创建）
├── groups/                   # 群组数据与工作区（归档：data/archives/ 下 <group>.zip）
├── archives/                 # 归档数据（2026-08-05 起）：群组 zip + 保留产物（如 plants-vs-zombies.html）
├── market/                   # Market 资源目录（installer 管理）
│   ├── official/             #   官方内置资源（首次启动从 bundled/ 同步）
│   ├── certified/            #   官方认证资源
│   ├── community/            #   社区资源
│   └── installed.json        #   已安装记录（id → InstalledEntry）
├── plugins/                  # Provider、Channel、Tool、Extension 插件数据
├── skills/                   # SKILL.md 技能目录
├── prompts/                  # ToolAgent/经验提取等 prompt 数据
├── toolagents/               # review、judgment、clone、memory、creator 等 ToolAgent 配置
│   ├── creator/              # Creator ToolAgent 配置与 prompt
│   ├── memory/               # Memory ToolAgent 配置与 prompt
│   ├── review/               # Review ToolAgent 配置与 prompt
│   ├── judgment/             # Judgment ToolAgent 配置与 prompt
│   ├── clone/                # Clone ToolAgent 配置与 prompt
│   ├── capability-updater/   # 能力卡更新 ToolAgent 配置与 prompt
│   ├── growth-reviewer/      # 成长建议审查 ToolAgent 配置与 prompt
│   └── task-archive/         # 任务归档 ToolAgent 配置与 prompt
└── registry.json             # master registry
```

当前 Agent 文件体系只包含上列核心文件与配置文件，不再包含旧版冗余文件。

---

## docs 文档目录

```text
docs/
├── 项目信息/
│   ├── 产品战略.md           # 产品定位、管家入口、Market 分层与战略共识
│   ├── 核心技术.md           # 三层智能体、TODOboard、群组驱动协作技术主张
│   ├── 项目现状.md           # 按代码事实描述当前实现与边界
│   ├── 架构说明.md           # 后端、前端、Agent、Group、扩展架构
│   ├── 使用说明.md           # 当前用户/进阶用户使用路径
│   ├── 当前待办.md           # 当前仍有效的待办
│   ├── 非Market未实现项审查.md # 大版本更新非 Market 未实现项代码审查
│   └── 最新版总览.md         # v1.4.0 全项目最新版盘点（2026-08-12）
├── 开发库/                    # CoBeing 独立开发追踪库（2026-08-12）
│   ├── README.md             # 库索引与更新约定
│   ├── 功能清单.md           # 哪些功能做了（核心）
│   ├── 计划.md               # 开发计划
│   └── 想法.md               # 想法点子
├── information/               # 调研报告（2026-08-08-research-cobeing-first-principles.md 第一性原理分析）
├── 调研/                     # 竞品调研与技术调查（含 真人说话模拟调研.md：人味表达规范 26 条草案，2026-08-05；deepseek-harness-极简模式学习笔记.md、dsh编码能力工程诊断-CoBeing差距.md、架构方向决策-CoBeing底座吸收dsh工程机制.md，2026-08-18）
├── superpowers/              # 实现计划、规格、审计计划
│   ├── plans/                # 分阶段实施计划
│   └── specs/                # 设计规格与方案文档
├── GOALS/                    # 项目目标文档
├── log/                      # 日志目录
├── roadmap/                  # 路线图文档
└── archive/                  # 历史归档（含 progress-archive-202605.md）
```

旧版能力清单式文档已删除，不再作为当前事实来源。

---

## 当前核心事实

- 默认 Provider 配置只有 `deepseek`。
- 其他 Provider 主要通过 `data/plugins/providers/` 的数据插件扩展。
- 默认核心 Agent 是 `butler` 和 `host`。
- 默认 GUI WebSocket 端口是 `18765`。
- 默认 GUI 主题是 `sakura-mint`；`executive-workbench` 保留为 B 方案工作台主题。
- 聊天气泡颜色由主题 `chat.msg-user`、`chat.msg-assistant`、`chat.msg-system`、`chat.msg-tool` token 控制。
- 用户资料在前端 `localStorage` 保存；真实单聊/群聊用户气泡显示昵称和右侧头像，智能体头像在左侧。
- 默认 MCP server 配置为空。
- 测试文件和测试数量以 `pnpm test` 实时输出为准，不在结构文档中写死。
- 修改 `.ts` 源码后必须在 `CoBeing/` 目录运行 `pnpm build`。
---

## 2026-06-12 GUI Surface Contract Update

```text
CoBeing/.claude/skills/frontend-design/
├── user-ui-preferences.md                 # General frontend preference source
├── co-being-ui-terms.md                   # CoBeing-specific UI glossary: background, card background, title card, chat card, settings overlay
└── co-being-ui-design-preferences.md      # Current CoBeing visual preference: candy Sakura Mint, three-layer body, spacing, ratio, typography

CoBeing/gui-v2/src/components/layout/
├── Surface.tsx                            # Shared SurfaceCard and WorkbenchLayout for layered app pages
├── AppLayout.tsx                          # Keeps top bar and far-left nav fixed
├── MainContent.tsx                        # Routes views into the shared workbench layout
└── Sidebar.tsx                            # Body-level left list card for agents/groups/global tasks

CoBeing/gui-v2/src/components/todo/
├── GlobalTodoPanel.tsx                    # Butler view left list card for Global TODO status and execution refs
└── GlobalTodoPanel.test.ts                # Display model regression coverage for Global TODO fields

CoBeing/gui-v2/src/components/layout/surface-style-audit.test.ts
  # Guards core UI files against legacy tiny font / old card token / oversized shadow patterns / literal JSX unicode escapes.

CoBeing/gui-v2/src/stores/theme.test.ts
  # Guards built-in theme order, chat bubble tokens, Sakura Mint layer contrast, no-cache loading, and built-in theme precedence.
```

Current GUI body convention:
- Top bar (`TitleBar`) and far-left navigation (`NavBar`) remain outside the body card system.
- The main body uses a darker candy background below three lighter cards: left list card, top title card, and main conversation/content card.
- Settings/detail surfaces use `Sheet`/`Dialog` frosted overlays above all body content.
