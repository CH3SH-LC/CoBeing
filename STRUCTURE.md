# CoBeing 项目结构

> 最后更新：2026-04-25 | Phase 0-9 完成 | TODO 驱动自动化 | ~210 测试通过

---

## 技术栈

- **后端**: TypeScript (pnpm monorepo, Node.js >=22)
- **前端**: React 19 + Tauri 2.0 + shadcn/ui + Vite
- **代码规模**: ~90 个 TS 源文件 (~13K LOC) + ~55 个 TSX 文件 (~9K LOC)

---

## 顶层目录

```
cobeing/
├── packages/          # pnpm monorepo — 后端核心代码 (4 个子包)
├── gui-v2/            # 前端 GUI — React 19 + Tauri 2.0
├── config/            # 项目配置 + Agent 模板
├── data/              # 运行时数据 (agents, groups, butler)
├── skills/            # 全局技能仓库 (SKILL.md 格式)
├── prompts/           # Prompt 模板文件
├── scripts/           # 开发/测试脚本
├── docs/              # 项目文档
├── CLAUDE.md          # Claude Code 项目指令
├── STRUCTURE.md       # 本文件 — 项目结构文档
├── package.json       # 根 monorepo 配置
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── vitest.config.ts
├── .env.example       # 环境变量模板
├── .gitignore
├── start.bat          # 启动后端
├── start-gui.bat      # 启动前端
└── build-gui.bat      # 构建前端
```

---

## packages/ — 后端核心 (pnpm monorepo)

```
packages/
├── shared/                    # @cobeing/shared — 全局共享
│   └── src/
│       ├── types.ts           #   全局类型定义
│       ├── events.ts          #   事件总线
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
│       ├── qq/                          #   QQ (OneBot v11 WebSocket)
│       │   ├── qq-channel.ts
│       │   └── onebot-client.ts
│       ├── wecom/                       #   企业微信 (HTTP 回调)
│       │   ├── wecom-channel.ts
│       │   └── wecom-client.ts
│       └── index.ts
│
└── core/                      # @cobeing/core — 核心运行时
    └── src/
        ├── runtime.ts                   #   CoBeingRuntime 顶层编排器
        ├── index.ts                     #   模块导出
        │
        ├── agent/                       #   Agent 系统
        │   ├── agent.ts                 #     Agent 基类 (生命周期/会话/消息处理)
        │   ├── butler.ts                #     ButlerAgent 管家 (20+ 管理工具)
        │   ├── registry.ts              #     AgentRegistry 全局注册中心
        │   ├── spawner.ts               #     SubAgentSpawner 临时子 Agent
        │   ├── paths.ts                 #     AgentPaths 自治文件系统路径
        │   ├── event-bus.ts             #     EventBus 事件总线
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
        │   ├── manager.ts               #     GroupManager 群组生命周期
        │   ├── owner.ts                 #     群主 Agent
        │   ├── context.ts               #     GroupContext 协作上下文
        │   ├── wake-system.ts           #     WakeSystem 事件驱动唤醒
        │   ├── screener.ts              #     Screener 群主双模型初筛
        │   ├── router.ts                #     ChannelRouter 消息路由
        │   ├── roles.ts                 #     角色权限管理
        │   └── workspace.ts             #     GroupWorkspace 项目文档管理
        │
        ├── tools/                       #   工具系统
        │   ├── registry.ts              #     ToolRegistry 工具注册
        │   ├── executor.ts              #     ToolExecutor 工具执行 + 权限检查
        │   ├── permission.ts            #     PermissionEnforcer 4 级权限
        │   ├── sandbox/                   #     沙箱系统
        │   │   ├── index.ts              #       Barrel 导出
        │   │   ├── docker-sandbox.ts     #       DockerSandbox 主类
        │   │   ├── container-pool.ts     #       ContainerPool 容器池
        │   │   └── runtime-detector.ts   #       多运行时检测
        │   ├── bash.ts                  #     bash — Shell 命令执行
        │   ├── read-file.ts             #     read-file — 文件读取
        │   ├── write-file.ts            #     write-file — 文件写入
        │   ├── edit-file.ts             #     edit-file — 字符串替换编辑
        │   ├── glob.ts                  #     glob — Pattern 文件搜索
        │   ├── grep.ts                  #     grep — Regex 内容搜索
        │   ├── web-fetch.ts             #     web-fetch — HTTP 请求
        │   ├── agent-message.ts         #     agent-message — Agent 间通信
        │   ├── experience-reflect.ts    #     experience-reflect — 经验反思
        │   ├── group-tools.ts           #     群组通信工具 (group-speak/talk-*)
        │   └── skill-tools.ts           #     技能统一工具 (skill-execute/list/create)
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
        │   └── config-loader.ts         #     配置加载 + 环境变量覆盖
        │
        ├── gateway/                     #   LLM 网关
        │   └── llm-gateway.ts           #     LLMGateway 并发控制 + 限流 + 重试
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
        │   ├── tools.ts                 #     todo-add/list/complete/cancel 工具
        │   ├── time-tool.ts             #     current-time 工具
        │   └── scanner.test.ts          #     测试
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
│   │   │   └── Sidebar.tsx     #     侧边栏 (Agent/Group 列表)
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
│   │   │   └── LogsSection.tsx         #   日志配置
│   │   │
│   │   ├── skill/              #   技能中心
│   │   │   └── SkillCenter.tsx         #   技能浏览/管理
│   │   │
│   │   ├── todo/               #   TODO 管理组件
│   │   │   ├── TodoPanel.tsx          #     主面板
│   │   │   ├── TodoList.tsx           #     TODO 列表
│   │   │   ├── TodoItem.tsx           #     单条 TODO 卡片
│   │   │   ├── TodoForm.tsx           #     创建表单
│   │   │   └── TodoStatusBadge.tsx    #     状态标签
│   │   │
│   │   ├── shared/             #   共享组件
│   │   │   ├── MarkdownContent.tsx     #   Markdown 渲染
│   │   │   ├── CodeBlock.tsx           #   代码高亮块
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
│   │   ├── agents.ts           #     Agent 状态
│   │   ├── chat.ts             #     聊天状态
│   │   ├── groups.ts           #     群组状态
│   │   ├── config.ts           #     配置状态
│   │   ├── settings.ts         #     设置状态
│   │   ├── skills.ts           #     技能状态
│   │   ├── todo.ts             #     TODO 状态
│   │   ├── theme.ts            #     主题状态
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
│   ├── tauri.svg
│   └── vite.svg
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
│                               #   core: logLevel, dataDir, skillsDir, promptsDir
│                               #   agents: 预置 Agent 列表 [butler, host]
│                               #   providers: 9 家 LLM Provider 配置
│                               #   channels: Channel 配置
│                               #   gui: enabled, wsPort
│                               #   groups: 群组配置
│
└── templates/                  # Agent 创建模板
    ├── CHARACTER.md            #   性格特征模板 (替代旧 IDENTITY.md)
    ├── JOB.md                  #   工作职责模板 (替代旧 IDENTITY.md)
    ├── SOUL.md                 #   灵魂/人格描述模板
    ├── USER.md                 #   用户偏好模板
    ├── BOOTSTRAP.md            #   启动引导模板 (一次性)
    └── AGENTS.md               #   工作空间指南模板
```

---

## data/ — 运行时数据

```
data/                           # 运行时数据目录 (gitignored)
├── agents/                     #   Agent 数据 (每个 Agent 一个目录)
│   ├── {agentId}/
│   │   ├── config.json         #     Agent 自治配置
│   │   ├── CHARACTER.md        #     性格特征
│   │   ├── JOB.md              #     工作职责
│   │   ├── SOUL.md             #     灵魂/人格
│   │   ├── USER.md             #     用户偏好
│   │   ├── AGENTS.md           #     工作空间指南
│   │   ├── EXPERIENCE.md       #     经验积累
│   │   ├── memory/             #     每日记忆
│   │   │   └── YYYY-MM-DD.md
│   │   ├── TODO.json           #     Agent 级 TODO 列表（按需创建）
│   │   └── (config.json skills 白名单控制可用技能)
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
└── butler/                     #   管家注册表
    ├── AGENTS_REGISTRY.md      #     Agent 注册表
    ├── GROUPS_REGISTRY.md      #     群组注册表
    └── TASK_LOG.md             #     任务日志
```

---

## skills/ — 全局技能仓库

```
skills/
├── code-review/SKILL.md        # 代码审查技能 (质量/安全/性能/最佳实践)
├── project-planning/SKILL.md   # 项目规划技能 (需求分析/任务分解/风险评估)
└── group-coordination/SKILL.md # 群组协调技能 (引导讨论/任务委托/冲突处理/进度监控)
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
└── test-tool.ts                # 工具测试脚本
```

---

## docs/ — 项目文档

```
docs/
├── 后端能力清单.md              # 后端技术能力完整清单 (Phase 0-9)
├── 前端设计清单.md              # 前端组件/设计/架构清单 (P0-P2)
├── 用户功能清单.md              # 用户视角的功能说明
├── 启动命令.md                  # 快速启动指南
├── 测试清单.md                  # 测试用例清单
├── 参考/                       # Agent 模板参考文档
│   ├── AGENTS.md
│   ├── BOOTSTRAP.md
│   ├── CHARACTER.md
│   ├── JOB.md
│   ├── SOUL.md
│   ├── TOOLS.md
│   └── USER.md
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
          → PromptBuilder (组装 system prompt: SOUL → CHARACTER/JOB → role → AGENTS → USER → EXPERIENCE)
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
| `create_agent` | GUI → Core | 直接创建 Agent |
| `create_group` | GUI → Core | 直接创建群组 |
| `destroy_agent` | GUI → Core | 直接销毁 Agent |
| `destroy_group` | GUI → Core | 直接销毁群组 |
| `get_todos` | GUI → Core | 获取 TODO 列表 |
| `add_todo` | GUI → Core | 创建 TODO |
| `complete_todo` | GUI → Core | 完成 TODO |
| `cancel_todo` | GUI → Core | 取消 TODO |
| `todo_updated` | Core → GUI | TODO 变更推送 |

---

## 测试

```
17 个测试文件, 147 个测试用例, 全部通过

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
```

运行: `pnpm test` 或 `vitest run`
