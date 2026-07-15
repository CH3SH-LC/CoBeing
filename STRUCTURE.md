# CoBeing 项目结构

> 最后更新：2026-07-15  
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
├── scripts/                  # 开发脚本
└── sandbox/                  # Docker 沙箱镜像
```

---

## 后端包结构

```text
CoBeing/packages/
├── core/                     # @cobeing/core：运行时主体
│   └── src/
│       ├── runtime.ts        # CoBeingRuntime 顶层编排器
│       ├── agent/            # Agent、Butler、AgentRegistry、ToolAgent
│       ├── api/              # WebSocket server 与 GUI 命令
│       ├── butler/           # ButlerTaskStore、GroupButlerBindingStore
│       ├── channels/         # Channel 运行时桥接
│       ├── conversation/     # ConversationLoop、PromptBuilder
│       ├── group/            # Group、GroupManager、WakeSystem、上下文与记忆
│       ├── memory/           # MemoryStore、SQLite/FTS5、安全扫描
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
    ├── qqbot/                # QQ Bot MCP server
    └── office/               # Office MCP server
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
└── agent-resource.ts          # Agent 资源请求工具（审批闭环仍待补齐）
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
├── creator.ts                 # Creator ToolAgent：Agent 核心文件与 Group 创建草案
├── memory.ts                  # Memory ToolAgent：经验条目与 MEMORY.md 修改建议
├── review.ts                  # Review ToolAgent：群组消息发送前审查
├── judgment.ts                # Judgment ToolAgent：群主唤醒判断
├── clone.ts                   # Clone ToolAgent：临时并行子任务
├── capability-updater.ts      # 能力卡更新助手
├── growth-reviewer.ts         # 成长建议审查助手
├── task-archive.ts            # 任务归档助手
├── tool-agent.test.ts         # ToolAgent 单元测试
└── types.ts                   # ToolAgent 类型、Spec、Memory 更新建议类型
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
│   │   └── settings/         # 设置页、主题选择、个人资料设置
│   ├── hooks/                # WebSocket、状态、业务 hook
│   ├── lib/                   # 前端工具函数（coreAgents.ts、userProfile.ts 等）
│   ├── stores/               # Zustand 状态（含 theme.ts、userProfile.ts、butlerTasks.ts）
│   ├── types/                # 前端类型
│   └── utils/                # 前端工具函数
├── src-tauri/                # Tauri 2 桌面壳
└── public/
    └── themes/               # 内置主题；sakura-mint 默认，executive-workbench 工作台主题
```

当前 GUI 主入口为：管家、智能体、群组、仪表盘、扩展、设置。

---

## data 运行时目录

```text
CoBeing/data/
├── agents/                   # 用户创建的 Agent
│   └── <agent-id>/
│       ├── AGENTS.md
│       ├── CHARACTER.md
│       ├── JOB.md
│       ├── MEMORY.md
│       ├── EXPERIENCE.md
│       ├── capability.json    # AgentCapabilityCard，供 Butler/Host/Group 调度匹配
│       ├── inbox.json         # AgentTaskInboxItem，支持 Butler tracked task 关联
│       ├── reflection.json    # Agent 任务反思记录
│       ├── proposals/         # Agent 成长建议
│       └── config.json
├── coreagents/               # butler、host 等核心 Agent
├── groups/                   # 群组数据与工作区
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
│   └── 非Market未实现项审查.md # 大版本更新非 Market 未实现项代码审查
├── 调研/                     # 竞品调研与技术调查
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
