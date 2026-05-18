# CoBeing 项目结构

> 最后更新：2026-05-18 | Phase 0-9 完成 + 三层记忆架构 + 审核管道 | 281 测试用例（全部通过）

---

## 实时更新规则

**每次新增、删除、重命名项目内文件/目录时，必须同步更新本文件。** 保持文档与实际文件系统一致。

---

## 技术栈

- **后端**: TypeScript (pnpm monorepo, Node.js >=22)
- **前端**: React 19 + Tauri 2.0 + shadcn/ui + Vite
- **代码规模**: ~90 个 TS 源文件 (~13K LOC) + ~55 个 TSX 文件 (~9K LOC)

---

## 顶层目录

```
CoBeing/
├── packages/          # pnpm monorepo — 后端核心代码 (6 个子包)
├── gui-v2/            # 前端 GUI — React 19 + Tauri 2.0
├── config/            # 项目配置 + Agent 模板
├── data/              # 运行时数据 (agents, groups, butler, host, models)
├── skills/            # 全局技能仓库 (SKILL.md 格式)
├── prompts/           # Prompt 模板文件
├── scripts/           # 开发/测试脚本
├── sandbox/           # 沙箱 Docker 镜像
│   ├── Dockerfile.base       #   基础镜像 (Node.js + 工具)
│   ├── Dockerfile.python     #   Python 镜像 (base + Python)
│   └── Dockerfile.full       #   完整镜像 (python + Go + Ruby)
├── cobeing/           # Cobeing 品牌资源
│   └── sandbox/
│       └── Dockerfile        #   主沙箱 Dockerfile
├── docs/              # 项目文档
├── temporary/         # 临时文件目录
├── CLAUDE.md          # Claude Code 项目指令
├── STRUCTURE.md       # 本文件 — 项目结构文档
├── PROGRESS.md        # 开发进度记录
├── GOAL.md            # 项目愿景与设计目标
├── README.md          # 项目说明
├── PACKAGE-GUIDE.md   # 打包指南
├── package.json       # 根 monorepo 配置
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── tsconfig.base.json
├── vitest.config.ts
├── .env               # 环境变量 (gitignored)
├── .env.example       # 环境变量模板
├── .gitignore
├── start.bat          # 启动后端
├── start-gui.bat      # 启动前端
├── build-gui.bat      # 构建前端
└── main-icon.png      # 应用图标
```

---

## packages/ — 后端核心 (pnpm monorepo)

```
packages/
├── shared/                    # @cobeing/shared — 全局共享
│   └── src/
│       ├── types.ts           #   全局类型定义
│       ├── events.ts          #   事件总线
│       ├── fs-utils.ts        #   文件系统工具
│       ├── logger.ts          #   日志工具
│       └── index.ts
│
├── providers/                 # @cobeing/providers — LLM Provider
│   └── src/
│       ├── base/provider-interface.ts   #   Provider 接口定义
│       ├── anthropic/anthropic-provider.ts  #   Anthropic (Claude)
│       ├── gemini/                      #   Google Gemini (专用 fetch)
│       │   ├── gemini-provider.ts
│       │   └── gemini-models.ts
│       ├── openai-compat/openai-provider.ts  #   OpenAI 兼容基类
│       ├── catalogs/                    #   各厂商目录配置
│       │   ├── deepseek.ts
│       │   ├── qwen.ts
│       │   ├── zhipu.ts
│       │   ├── minimax.ts
│       │   ├── volcengine.ts
│       │   ├── grok.ts
│       │   ├── moonshot.ts
│       │   ├── siliconflow.ts
│       │   ├── openai.ts
│       │   └── index.ts
│       └── index.ts
│
├── channels/                  # @cobeing/channels — 通信渠道
│   └── src/
│       ├── base/channel-interface.ts    #   Channel 适配器接口
│       ├── discord/                     #   Discord (Gateway + REST)
│       │   ├── discord-channel.ts
│       │   └── discord-client.ts
│       ├── feishu/                      #   飞书 (HTTP Events + API)
│       │   ├── feishu-channel.ts
│       │   └── feishu-client.ts
│       ├── qq/                          #   QQ (OneBot v11 / QQBot)
│       │   ├── qq-channel.ts
│       │   ├── onebot-client.ts
│       │   ├── qqbot-channel.ts
│       │   └── qqbot-gateway-client.ts
│       ├── wecom/                       #   企业微信 (HTTP 回调)
│       │   ├── wecom-channel.ts
│       │   └── wecom-client.ts
│       └── index.ts
│
└── core/                      # @cobeing/core — 核心运行时
    └── src/
        ├── runtime.ts                   #   CoBeingRuntime 顶层编排器
        ├── index.ts                     #   模块导出

├── mcp-servers/                   # MCP 服务器
│   ├── qqbot/                     # @cobeing/qqbot-mcp-server — QQ Bot 操作 (22 tools)
│   └── office/                    # @cobeing/office-mcp-server — 办公三件套 (11 tools)
│       └── src/
│           ├── index.ts           #   入口（环境变量+沙箱模式）
│           ├── mcp-server.ts      #   JSON-RPC 2.0 MCP 协议实现
│           ├── qq-client.ts       #   QQ Bot HTTP/WS API 客户端
│           └── tools.ts           #   18 个 MCP 工具
        │
        ├── agent/                       #   Agent 系统
        │   ├── agent.ts                 #     Agent 基类 (生命周期/会话/消息处理)
        │   ├── butler.ts                #     ButlerAgent 管家 (14 个专属管理工具)
        │   ├── registry.ts              #     AgentRegistry 全局注册中心
        │   ├── spawner.ts               #     SubAgentSpawner 临时子 Agent
        │   ├── paths.ts                 #     AgentPaths 自治文件系统路径
        │   ├── event-bus.ts             #     EventBus 事件总线
        │   ├── wake-session.ts          #     WakeSession 唤醒轨迹记录
        │   └── communication-test.ts    #     Agent 通信测试工具
        │
        ├── conversation/                #   对话系统
        │   ├── conversation-loop.ts     #     ConversationLoop 对话循环
        │   ├── context-window.ts        #     ContextWindow 上下文窗口管理
        │   ├── message.ts               #     消息类型定义
        │   └── prompt-builder.ts        #     System Prompt 构建链
        │
        ├── group/                       #   群组与协作
        │   ├── group.ts                 #     Group 项目工作组
        │   ├── group-context-v2.ts      #     GroupContextV2 tag-based 消息管理
        │   ├── group-db.ts              #     GroupDB 主库 (messages/visibility/compression_marks)
        │   ├── compressed-history.ts    #     CompressedHistory 每 Agent 压缩历史
        │   ├── manager.ts               #     GroupManager 群组生命周期
        │   ├── owner.ts                 #     群主 Agent
        │   ├── context.ts               #     GroupContext 协作上下文
        │   ├── wake-system.ts           #     WakeSystem 事件驱动唤醒
        │   ├── screener.ts              #     Screener 群主双模型初筛
        │   ├── router.ts                #     ChannelRouter 消息路由
        │   ├── roles.ts                 #     角色权限管理
        │   ├── workspace.ts             #     GroupWorkspace 项目文档管理
        │   ├── local-filter.ts          #     LocalFilterEngine 本地模型过滤
        │   ├── filter-prompt.ts         #     过滤层 prompt 模板
        │   ├── host-tools.ts            #     群主专属工具（6 个 host-* 工具）
        │   ├── agent-memory.ts          #     AgentMemory 群组内 Agent 记忆管理
        │   ├── current-md.ts            #     CurrentMD 对话快照持久化
        │   └── review-pipeline.ts       #     ReviewPipeline 审核管道核心逻辑
        │
        ├── tools/                       #   工具系统
        │   ├── registry.ts              #     ToolRegistry 工具注册
        │   ├── executor.ts              #     ToolExecutor 工具执行 + 权限检查
        │   ├── permission.ts            #     PermissionEnforcer 4 级权限
        │   ├── sandbox/                   #     沙箱系统
        │   │   ├── index.ts              #       Barrel 导出
        │   │   ├── docker-sandbox.ts     #       DockerSandbox 主类
        │   │   ├── container-pool.ts     #       ContainerPool 容器池
        │   │   ├── runtime-detector.ts   #       多运行时检测
        │   │   ├── network-whitelist.ts  #       网络白名单管理
        │   │   └── security.ts           #       安全加固配置
        │   ├── bash.ts                  #     bash — Shell 命令执行
        │   ├── read-file.ts             #     read-file — 文件读取
        │   ├── write-file.ts            #     write-file — 文件写入
        │   ├── edit-file.ts             #     edit-file — 字符串替换编辑
        │   ├── glob.ts                  #     glob — Pattern 文件搜索
        │   ├── grep.ts                  #     grep — Regex 内容搜索
        │   ├── web-fetch.ts             #     web-fetch — HTTP 请求
        │   ├── agent-message.ts         #     agent-message — Agent 间通信
        │   ├── experience-reflect.ts    #     experience-reflect — 经验反思
        │   ├── group-tools.ts           #     群组通信工具 (group-members/talk-*)
        │   ├── group-memory-search.ts   #     group-memory-search — 群组记忆搜索
        │   ├── summarize-phase.ts       #     summarize-phase — 阶段总结压缩
        │   ├── skill-tools.ts           #     技能统一工具 (skill-execute/list/create)
│   └── mcp-tools.ts             #     mcp-discover / mcp-register 按需注册
        │
        ├── skills/                      #   技能系统
        │   ├── repository.ts            #     SkillRepository 统一技能仓库
        │   ├── md-loader.ts             #     SKILL.md 格式加载器
        │   ├── loader.ts                #     YAML/JSON 加载器 (旧版兼容)
        │   └── openclaw-style.ts        #     OpenClaw 风格加载器
        │
        ├── memory/                      #   记忆与经验
        │   ├── memory-store.ts          #     MemoryStore 统一存储引擎（四目标+双写+快照）
        │   ├── memory-tool.ts           #     memory 工具定义（add/replace/remove/read）
        │   ├── security-scan.ts         #     安全扫描（注入/泄露/隐形字符检测）
        │   ├── sqlite-adapter.ts        #     SQLite FTS5 封装（基于 sql.js/WASM）
        │   ├── writer.ts                #     MemoryWriter 每日对话记录（兼容）
        │   ├── reader.ts                #     MemoryReader 关键词检索（兼容）
        │   ├── indexer.ts               #     MemoryIndexer LLM 总结索引（兼容）
        │   └── experience.ts            #     Experience 经验反思 + 搜索（兼容）
        │
        ├── mcp/                         #   MCP 集成
        │   ├── client.ts                #     MCPClient 标准协议客户端
        │   ├── manager.ts               #     MCPManager 多服务器管理
        │   └── transport.ts             #     Stdio/HTTP 传输层
        │
        ├── config/                      #   配置系统
        │   ├── schema.ts                #     配置 Schema 定义
        │   ├── config-loader.ts         #     配置加载 + 环境变量覆盖
        │   └── secret-store.ts          #     SecretStore 敏感配置加密存储
        │
        ├── gateway/                     #   LLM 网关
        │   └── llm-gateway.ts           #     LLMGateway 并发控制 + 限流 + 重试
        │
        ├── observability/               #   可观测性
        │   └── observability-db.ts      #     ObservabilityDB LLM 调用日志 + 工具审计
        │
        ├── butler/                      #   管家持久化
        │   └── registry.ts              #     ButlerRegistry 注册表
        │
        ├── workflow/                    #   工作流引擎
        │   └── engine.ts                #     WorkflowEngine 任务分析 + 计划生成
        │
        ├── todo/                        #   TODO 驱动自动化
        │   ├── types.ts                 #     TodoItem 类型 + 常量
        │   ├── store.ts                 #     TodoStore 读写 TODO.json
        │   ├── scanner.ts               #     AgentTodoScanner 全局扫描器
        │   ├── group-scanner.ts         #     GroupTodoScanner 群组扫描器
        │   ├── tools.ts                 #     todo-add/list/complete/remove 工具
        │   ├── time-tool.ts             #     current-time 工具
        │   └── scanner.test.ts          #     测试
        │
        ├── vote/                        #   投票系统（#16）
        │   ├── types.ts                 #     VoteTopic/VoteOption 类型
        │   ├── store.ts                 #     VoteStore 持久化到 data/host/VOTES.json
        │   └── tools.ts                 #     vote-create/cast/result 工具
        │
        └── api/                         #   WebSocket API
            └── ws-server.ts             #     CoreWSServer (端口 18765)
```

---

## gui-v2/ — 前端 GUI (React + Tauri)

```
gui-v2/
├── src-tauri/                  # Tauri 2.0 后端 (Rust)
│   ├── src/
│   │   ├── main.rs             #   Rust 入口
│   │   └── lib.rs              #   Tauri 命令注册
│   ├── capabilities/default.json
│   ├── icons/                  #   应用图标 (多尺寸)
│   ├── tauri.conf.json         #   Tauri 配置
│   ├── Cargo.toml
│   └── build.rs
│
├── src/                        # React 19 前端
│   ├── main.tsx                #   应用入口
│   ├── App.tsx                 #   根组件
│   ├── styles/globals.css      #   全局样式
│   │
│   ├── components/
│   │   ├── layout/             #   布局组件
│   │   │   ├── AppLayout.tsx   #     应用布局框架
│   │   │   ├── MainContent.tsx #     主内容区
│   │   │   ├── NavBar.tsx      #     导航栏
│   │   │   ├── Sidebar.tsx     #     侧边栏 (Agent/Group 列表)
│   │   │   └── TitleBar.tsx    #     自定义标题栏 (Tauri)
│   │   │
│   │   ├── chat/               #   聊天组件
│   │   │   ├── ChatView.tsx    #     单 Agent 聊天视图
│   │   │   ├── GroupChatView.tsx       #   群组聊天视图
│   │   │   ├── GroupMessageBubble.tsx  #   群组消息气泡
│   │   │   └── ToolCallMessage.tsx     #   工具调用消息
│   │   │
│   │   ├── agent/              #   Agent 管理组件
│   │   │   ├── AgentDetailPanel.tsx    #   Agent 详情面板
│   │   │   ├── AgentConfigTab.tsx      #   Agent 配置标签页
│   │   │   ├── AgentFilesTab.tsx       #   Agent 文件标签页
│   │   │   ├── ButlerConfigPanel.tsx   #   管家配置面板
│   │   │   └── CreateAgentDialog.tsx   #   创建 Agent 对话框
│   │   │
│   │   ├── group/              #   群组管理组件
│   │   │   ├── GroupDetailPanel.tsx    #   群组详情面板
│   │   │   ├── GroupConfigTab.tsx      #   群组配置标签页
│   │   │   ├── GroupMembersTab.tsx     #   成员管理标签页
│   │   │   ├── GroupWorkspaceTab.tsx   #   工作空间标签页
│   │   │   └── CreateGroupDialog.tsx   #   创建群组对话框
│   │   │
│   │   ├── settings/           #   设置页组件
│   │   │   ├── SettingsView.tsx        #   设置主页
│   │   │   ├── ProvidersSection.tsx    #   Provider 配置
│   │   │   ├── ChannelsSection.tsx     #   Channel 配置
│   │   │   ├── McpSection.tsx          #   MCP 配置
│   │   │   ├── ThemeSelector.tsx       #   主题选择器
│   │   │   ├── UsageMonitor.tsx        #   用量监控
│   │   │   └── LogsSection.tsx         #   日志配置
│   │   │
│   │   ├── skill/              #   技能中心
│   │   │   └── SkillCenter.tsx         #   技能浏览/管理
│   │   │
│   │   ├── sandbox/            #   沙箱监控
│   │   │   └── SandboxMonitor.tsx      #   沙箱状态监控面板
│   │   │
│   │   ├── observability/      #   仪表盘组件
│   │   │   ├── DashboardView.tsx       #     仪表盘主页面
│   │   │   ├── TokenCard.tsx           #     Token 消耗卡片
│   │   │   ├── LatencyCard.tsx         #     响应时间卡片
│   │   │   ├── ToolRankCard.tsx        #     工具排行卡片
│   │   │   └── AgentActivityCard.tsx   #     Agent 活跃度卡片
│   │   │
│   │   ├── todo/               #   TODO 管理组件
│   │   │   ├── TodoPanel.tsx          #     主面板
│   │   │   ├── TodoList.tsx           #     TODO 列表
│   │   │   ├── TodoItem.tsx           #     单条 TODO 卡片
│   │   │   ├── TodoForm.tsx           #     创建表单
│   │   │   ├── TodoStatusBadge.tsx    #     状态标签
│   │   │   ├── Calendar.tsx           #     自定义日历网格
│   │   │   └── Clock.tsx              #     SVG 表盘时钟选择器
│   │   │
│   │   ├── shared/             #   共享组件
│   │   │   ├── MarkdownContent.tsx     #   Markdown 渲染
│   │   │   ├── CodeBlock.tsx           #   代码高亮块
│   │   │   ├── ConfirmDialog.tsx       #   确认对话框
│   │   │   └── ThemeProvider.tsx       #   主题提供者
│   │   │
│   │   └── ui/                 #   shadcn/ui 基础组件
│   │       ├── button.tsx
│   │       ├── dialog.tsx
│   │       ├── sheet.tsx
│   │       ├── switch.tsx
│   │       └── tabs.tsx
│   │
│   ├── hooks/                  #   自定义 Hooks
│   │   ├── useWebSocket.ts     #     WebSocket 连接管理
│   │   ├── useChatPersistence.ts       #   聊天持久化
│   │   ├── useKeyboardShortcuts.ts     #   键盘快捷键
│   │   └── useTray.ts          #     系统托盘
│   │
│   ├── stores/                 #   Zustand 状态管理
│   │   ├── activity.ts         #     活动日志状态
  │   ├── wakeQueue.ts        #     唤醒队列状态
│   │   ├── agents.ts           #     Agent 状态
│   │   ├── chat.ts             #     聊天状态
│   │   ├── groups.ts           #     群组状态
│   │   ├── config.ts           #     配置状态
│   │   ├── settings.ts         #     设置状态
│   │   ├── skills.ts           #     技能状态
│   │   ├── todo.ts             #     TODO 状态
│   │   ├── theme.ts            #     主题状态
│   │   ├── usage.ts            #     用量统计状态
│   │   ├── observability.ts    #     仪表盘数据状态
│   │   └── tray.ts             #     托盘状态
│   │
│   └── lib/                    #   工具库
│       ├── types.ts            #     类型定义
│       ├── utils.ts            #     工具函数
│       └── ws-client.ts        #     WebSocket 客户端封装
│
├── public/                     #   静态资源
│   ├── themes/                 #   主题配置（每个主题独立文件）
│   │   ├── manifest.json       #   内置主题 ID 列表
│   │   ├── aurora-light.json
│   │   ├── aurora-dark.json
│   │   ├── ocean-breeze.json
│   │   ├── sakura.json
│   │   └── midnight-steel.json
│   └── main-icon.png           #   应用图标
│
├── package.json
├── vite.config.ts
├── tsconfig.json
└── index.html
```

---

## config/ — 项目配置

```
config/
├── default.json                # 主配置文件 (JSON 格式)
│                               #   core: logLevel, dataDir, skillsDir, promptsDir, localModel
│                               #   agents: 预置 Agent 列表 [butler, host]
│                               #   providers: 9 家 LLM Provider 配置
│                               #   channels: Channel 配置
│                               #   gui: enabled, wsPort
│                               #   groups: 群组配置
│
└── templates/                  # Agent 创建模板 (9 个核心文件)
    ├── SOUL.md                 #   性格特质模板
    ├── CHARACTER.md            #   人物描写模板
    ├── JOB.md                  #   专注领域模板
    ├── USER.md                 #   用户偏好模板
    ├── AGENTS.md               #   工作空间指南模板
    ├── TOOLS.md                #   工具调用策略模板
    ├── MEMORY.md               #   事件记录模板
    ├── EXPERIENCE.md           #   工作经验模板
    └── BOOTSTRAP.md            #   创建时知识模板（不删除）
```

---

## data/ — 运行时数据

```
data/                           # 运行时数据目录 (gitignored)
├── agents/                     #   Agent 数据 (每个 Agent 一个目录)
│   ├── {agentId}/
│   │   ├── config.json         #     Agent 自治配置
│   │   ├── SOUL.md             #     性格特质
│   │   ├── CHARACTER.md        #     人物描写
│   │   ├── JOB.md              #     专注领域
│   │   ├── USER.md             #     用户偏好
│   │   ├── AGENTS.md           #     工作空间指南
│   │   ├── TOOLS.md            #     工具调用策略
│   │   ├── MEMORY.md           #     事件记录
│   │   ├── EXPERIENCE.md       #     工作经验
│   │   ├── BOOTSTRAP.md        #     创建时知识（不删除，加入群组时激发）
│   │   ├── memory/             #     每日记忆
│   │   │   └── YYYY-MM-DD.md
│   │   ├── memory.db           #     SQLite FTS5 记忆数据库
│   │   ├── TODO.json           #     Agent 级 TODO 列表（按需创建）
│   │   ├── workspace/          #     Agent 工作区文件
│   │   └── skills/             #     Agent 技能目录
│   │
│   ├── butler/                 #   管家 Agent
│   ├── host/                   #   群主 Agent (预置基本智能体)
│   └── ...                     #   用户创建的 Agent
│
├── groups/                     #   群组数据 (每个群组一个目录)
│   ├── {groupId}/
│   │   ├── config.json         #     群组配置 (成员/owner/状态)
│   │   ├── MEMBERS.md          #     成员列表和职责
│   │   ├── STRUCTURE.md        #     项目结构
│   │   ├── TASK.md             #     任务描述和验收标准
│   │   ├── PROGRESS.md         #     当前进度
│   │   ├── PLAN.md             #     任务分工和执行计划
│   │   └── TODO.json           #     群组级 TODO 列表（按需创建）
│   └── ...
│
├── butler/                     #   管家注册表
│   ├── AGENTS_REGISTRY.md      #     Agent 注册表
│   ├── GROUPS_REGISTRY.md      #     群组注册表
│   └── TASK_LOG.md             #     任务日志
│
├── host/                       #   群主专属目录
│   ├── config.json             #     群主自治配置
│   ├── DECISIONS.md            #     决策记录（跨群组）
│   └── GROUPS_REGISTRY.md      #     管理的群组注册表
│
└── models/                     #   本地模型文件
    └── qwen3.5-2b/             #     Qwen 3.5 2B GGUF 模型
        ├── model.gguf          #       GGUF 格式权重
        └── ...
```

---

## skills/ — 全局技能仓库

```
skills/
├── agent-creation/SKILL.md       # 智能体创建技能（管家创建 Agent 时使用）
├── code-review/SKILL.md          # 代码审查技能 (质量/安全/性能/最佳实践)
├── project-planning/SKILL.md     # 项目规划技能 (需求分析/任务分解/风险评估)
├── group-coordination/SKILL.md   # 群组协调技能 (引导讨论/任务委托/冲突处理/进度监控)
├── math-analysis-learning/SKILL.md        # 数学分析学习技能
├── math-analysis-learning-plan/SKILL.md   # 数学分析学习计划
└── examples/                     # 技能示例
```

---

## prompts/ — Prompt 模板

```
prompts/
└── experience-reflect.md       # 经验反思 Prompt (LLM 自动提取经验)
```

---

## scripts/ — 开发脚本

```
scripts/
├── dev.ts                      # 开发启动入口 (tsx scripts/dev.ts)
├── test-tool.ts                # 工具测试脚本
├── build-sandbox.sh            # 沙箱 Docker 镜像构建脚本
└── convert-to-gguf.sh          # GGUF 模型格式转换脚本
```

---

## docs/ — 项目文档

```
docs/
├── Agent系统深度调查报告.md     # Agent 系统架构/工具/生命周期/能力矩阵
├── 后端能力清单.md              # 后端技术能力完整清单 (Phase 0-9)
├── 前端设计清单.md              # 前端组件/设计/架构清单 (P0-P2)
├── 用户功能清单.md              # 用户视角的功能说明
├── 用户指南.md                  # 用户使用指南
├── 启动命令.md                  # 快速启动指南
├── 测试清单.md                  # 测试用例清单
├── 待办.md                      # 待办事项（旧版）
├── 待办新.md                    # 待办事项（新版，完整版）
├── 参考/                       # Agent 模板参考文档
│   ├── AGENTS.md
│   ├── BOOTSTRAP.md
│   ├── CHARACTER.md
│   ├── JOB.md
│   ├── SOUL.md
│   ├── TOOLS.md
│   └── USER.md
├── superpowers/                # 实现计划与设计规格 (Phase 10+)
│   ├── plans/
│   │   ├── 2026-04-21-theme-rendering-redesign.md
│   │   ├── 2026-04-23-group-creation-host-agent.md
│   │   ├── 2026-04-24-memory-system-redesign.md
│   │   ├── 2026-04-24-todo-automation.md
│   │   ├── 2026-04-25-agent-collaboration.md
│   │   ├── 2026-04-25-group-memory.md
│   │   ├── 2026-04-25-host-enhancement.md
│   │   ├── 2026-04-25-mcp-presets.md
│   │   ├── 2026-04-25-sandbox-core-redesign.md
│   │   ├── 2026-04-25-sandbox-phase2.md
│   │   ├── 2026-04-30-group-memory-three-layer.md
│   └── specs/
│       ├── 2026-04-21-theme-rendering-redesign.md
│       ├── 2026-04-23-group-creation-host-agent-design.md
│       ├── 2026-04-24-memory-system-redesign.md
│       ├── 2026-04-24-todo-automation-design.md
│       ├── 2026-04-25-agent-collaboration-design.md
│       ├── 2026-04-25-group-memory-design.md
│       ├── 2026-04-25-host-enhancement-design.md
│       ├── 2026-04-25-mcp-presets-design.md
│       ├── 2026-04-25-sandbox-core-redesign.md
│       ├── 2026-04-25-sandbox-phase2-design.md
│       ├── 2026-04-30-group-memory-three-layer-design.md
│       ├── 2026-04-30-activity-log-design.md
└── archive/                    # 历史归档
    └── superpowers/            #   实现计划与设计规格 (Phase 2-9)
        ├── plans/              #   9 个实现计划
        └── specs/              #   10 个设计规格
```

---

## 关键数据流

```
用户消息
  → Channel / GUI WebSocket
    → ChannelRouter (路由到 Agent 或 Group)
      → Agent.handleIncomingMessage()
        → ConversationLoop (对话循环)
          → PromptBuilder (组装 system prompt: SOUL → CHARACTER → BOOTSTRAP → role → JOB → AGENTS → USER → TOOLS → EXPERIENCE → MEMORY)
          → LLMGateway (并发控制 + 限流)
            → LLMProvider (9 家厂商)
          → ToolExecutor (权限检查 → 工具执行)
        → 回复 → 记忆/经验写入
```

---

## WS 命令 (端口 18765)

| 命令 | 方向 | 说明 |
|------|------|------|
| `get_state` | GUI → Core | 获取所有 Agent/Group 状态 |
| `send_message` | GUI → Core | 向 Agent/Group 发消息 |
| `get_log` | GUI → Core | 获取日志 |
| `get_config` | GUI → Core | 获取配置 |
| `update_config` | GUI → Core | 更新配置 |
| `subscribe_log` | GUI → Core | 订阅实时日志 |
| `create_agent` | GUI → Core | 创建 Agent（支持 sandbox 配置） |
| `update_agent` | GUI → Core | 更新 Agent 配置 |
| `destroy_agent` | GUI → Core | 销毁 Agent |
| `create_group` | GUI → Core | 创建群组 |
| `destroy_group` | GUI → Core | 销毁群组 |
| `add_group_member` | GUI → Core | 添加群组成员 |
| `remove_group_member` | GUI → Core | 移除群组成员 |
| `bind_channel` | GUI → Core | 绑定 Channel 到 Agent/Group |
| `unbind_channel` | GUI → Core | 解绑 Channel |
| `get_skills` | GUI → Core | 获取技能列表 |
| `get_skill_doc` | GUI → Core | 获取技能详细文档 |
| `execute_skill` | GUI → Core | 执行技能 |
| `skill_create` | GUI → Core | 创建新技能 |
| `get_wake_queue` | GUI → Core | 获取群组唤醒队列状态 |
| `get_agent_files` | GUI → Core | 获取 Agent 文件列表 |
| `read_agent_file` | GUI → Core | 读取 Agent 文件 |
| `write_agent_file` | GUI → Core | 写入 Agent 文件 |
| `get_group_workspace` | GUI → Core | 获取群组工作区文件列表 |
| `get_group_workspace_file` | GUI → Core | 读取群组工作区文件 |
| `save_group_workspace_file` | GUI → Core | 保存群组工作区文件 |
| `get_chat_current` | GUI → Core | 获取所有 Agent 当前对话 |
| `save_chat_current` | GUI → Core | 保存对话到 current.md |
| `clear_chat_current` | GUI → Core | 清空所有 Agent 对话 |
| `get_todos` | GUI → Core | 获取 TODO 列表 |
| `add_todo` | GUI → Core | 创建 TODO |
| `complete_todo` | GUI → Core | 完成 TODO |
| `remove_todo` | GUI → Core | 删除 TODO（彻底移除） |
| `get_sandbox_status` | GUI → Core | 获取所有 Agent 沙箱状态 |
| `sandbox_action` | GUI → Core | 沙箱操作（start/stop/restart/delete） |
| `todo_updated` | Core → GUI | TODO 变更推送 |
| `sandbox_status` | Core → GUI | 沙箱状态响应 |
| `sandbox_action_result` | Core → GUI | 沙箱操作结果 |
| `todo_added` | Core → GUI | TODO 创建响应 |
| `todo_completed` | Core → GUI | TODO 完成响应 |
| `todo_removed` | Core → GUI | TODO 删除响应 |
| `get_dashboard` | GUI → Core | 获取仪表盘聚合指标 |
| `get_llm_stats` | GUI → Core | 获取 LLM 调用历史 |
| `get_tool_stats` | GUI → Core | 获取工具调用历史 |
| `dashboard` | Core → GUI | 仪表盘数据响应 |

---

## 测试

```
36 个测试文件, 281 个测试用例（全部通过）

AgentRegistry       — 4 tests      ButlerRegistry   — 2 tests
GroupContext         — 16 tests     GroupRole         — 8 tests
GroupManager         — 3 tests      ChannelRouter     — 9 tests
ToolRegistry         — 4 tests      PermissionEnforcer — 6 tests
ToolExecutor         — 6 tests      PromptBuilder     — tests
ButlerAgent          — 2 tests      EventEmitter      — 3 tests
Experience           — tests        MemoryWriter      — tests
MemoryStore          — 18 tests     SecurityScan      — 9 tests
SqliteAdapter        — 13 tests
SkillMdLoader        — tests        Catalogs           — tests
WorkflowEngine       — tests        Integration        — 11 tests
SandboxSecurity      — 5 tests      RuntimeDetector    — 10 tests
NetworkWhitelist     — 6 tests      ContainerPool      — 4 tests
ThreeLayerMemory   — 10 tests
```

运行: `pnpm test` 或 `vitest run`