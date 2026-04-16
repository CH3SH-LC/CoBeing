# MyAgents 开发进度

> 最后更新：2026-04-15

## 当前状态

**阶段：** Phase 0-4 全部完成 ✅

**代码统计：** 60+ TS 文件（~7000 行） + 3 个 Rust 文件（~660 行）

**构建状态：**
- TypeScript 4 包全部编译通过 ✅
- Rust GUI 编译通过 ✅
- 测试 113/113 通过 ✅
- 端到端流程验证通过 ✅

---

## 已完成

### Phase 0：项目骨架 ✅
- [x] pnpm monorepo 初始化
- [x] TypeScript / Vitest / ESLint 配置
- [x] 4 个子包骨架（shared / core / providers / channels）
- [x] 共享类型定义（Message、Agent、Permission、Sandbox、Group 等）
- [x] 事件总线（EventEmitter）
- [x] 日志系统（Logger + createLogger）
- [x] 默认配置文件（config/default.yaml）

### Phase 1：MVP 核心模块 ✅
- [x] `LLMProvider` 统一接口（Anthropic + OpenAI 兼容）
- [x] `ChannelAdapter` 统一接口 + QQ OneBot v11
- [x] `Agent` 类 + `ConversationLoop` + `ContextWindow`
- [x] `CoreWSServer` + Rust egui GUI（流式推送）

### Phase 2：工具系统 + 权限 + 沙箱 ✅

#### 核心框架
- [x] `Tool` / `ToolContext` / `ToolsConfig` 类型（shared/types.ts）
- [x] `ToolRegistry` — 工具注册表（register/get/listDefinitions）
- [x] `PermissionEnforcer` — 配置驱动权限检查（4 种模式）
- [x] `ToolExecutor` — 统一执行入口（查找→权限→执行→事件）
- [x] `DockerSandbox` — Docker 容器沙箱执行

#### 内置工具（8 个）
- [x] `bash` — 执行 shell 命令（支持沙箱模式）
- [x] `read-file` — 读取文件（带行号、offset/limit）
- [x] `write-file` — 写入文件（自动创建目录）
- [x] `edit-file` — 字符串替换编辑（唯一匹配检查）
- [x] `glob` — 按模式搜索文件（支持 ** 递归）
- [x] `grep` — 正则搜索文件内容
- [x] `web-fetch` — HTTP 请求（网络权限检查）
- [x] `agent-message` — Agent 间通信（stub，待 Phase 4）

#### 集成
- [x] ConversationLoop 自动工具调用循环（tool_calls → execute → continue）
- [x] Agent 自动初始化 ToolRegistry + PermissionEnforcer + ToolExecutor
- [x] 配置文件支持 tools/toolsConfig/permissions 扩展
- [x] tool:call / tool:result / tool:denied 事件

### Phase 3：MCP + Skills + SubAgents ✅

#### MCP 系统
- [x] `MCPTransport` 接口 + `StdioTransport`（子进程 stdin/stdout JSON-RPC）
- [x] `HTTPTransport`（Streamable HTTP：POST + SSE）
- [x] `MCPClient`（JSON-RPC 2.0 客户端，initialize 握手，tools/list/call，resources）
- [x] `MCPManager`（多服务器管理，MCP 工具桥接为 Tool 接口）
- [x] 配置支持 `mcpServers` 字段，dev.ts 自动连接

#### 技能系统
- [x] `SkillLoader` — 从 skills/ 目录扫描 YAML/JSON 技能定义
- [x] 技能自动注册为 Tool（`skill:{name}`），execute 时注入 prompt 调用 LLM
- [x] 示例技能：`skills/code-review.yaml`

#### SubAgent
- [x] `SubAgentSpawner` — 从父 Agent 动态创建临时子 Agent
- [x] 子 Agent 继承父 Agent 的 provider/工具/权限配置
- [x] 任务完成后自动清理

---

## 待实现

### Phase 4：Multi-Agent + 群组 + 管家 ✅
- [x] AgentRegistry（注册/查找/列表，唯一 ID 校验）
- [x] GroupProtocol 策略模式（round-robin / free-form / moderated）
- [x] Group 类（群组对话主循环，成员管理）
- [x] GroupManager（群组生命周期管理）
- [x] agent-message 工具激活（AgentRegistry 查找 + 循环检测 + 超时）
- [x] ButlerAgent + 6 个管理工具（create/destroy agent/group, list, run-group）
- [x] MyAgentsRuntime（顶层运行时组装）
- [x] 配置迁移（多 Agent 支持 + groups 配置）

### Phase 5：多 Provider + 多 Channel + Channel-Group 绑定 ✅

#### 多 Provider（9 家）
- [x] Anthropic（原生 SDK）
- [x] OpenAI（原生 openai-compat）
- [x] Gemini（原生 fetch）
- [x] DeepSeek / 智谱 / 通义 / MiniMax / 豆包 / Grok（openai-compat + 模型目录）

#### 多 Channel（4 家）
- [x] QQ (OneBot v11 WebSocket)
- [x] Discord (Gateway + REST)
- [x] 企业微信 (HTTP 回调 + API)
- [x] 飞书 (HTTP 事件 + API)

#### Channel-Group 绑定
- [x] GroupRole 角色模型（user / owner / member）
- [x] GroupConfig 新增 owner 字段
- [x] ChannelRouter 消息路由（user/owner 两种绑定模式）
- [x] GroupContext 订阅回调（onMainMessage）
- [x] Group.run() 输出到 GroupContext
- [x] Config bindTo 静态绑定 + Butler 动态绑定工具
- [x] Runtime 集成 ChannelRouter

### Phase 6：GUI 完善
- [ ] Agent 管理面板
- [ ] 群组可视化视图
- [ ] 配置编辑界面
- [ ] Tauri 集成

---

## 文件结构概览

```
myagents/
├── packages/
│   ├── shared/src/          # 全局类型、事件总线、日志
│   ├── providers/src/       # LLM Provider（Anthropic + OpenAI 兼容）
│   ├── channels/src/        # 渠道适配器（QQ OneBot v11）
│   └── core/src/
│       ├── agent/           # Agent 类
│       ├── conversation/    # 对话循环、上下文管理
│       ├── config/          # 配置加载
│       ├── api/             # WS 服务
│       └── tools/           # 工具系统
│           ├── registry.ts      # ToolRegistry
│           ├── executor.ts      # ToolExecutor
│           ├── permission.ts    # PermissionEnforcer
│           ├── sandbox.ts       # DockerSandbox
│           ├── bash.ts          # Bash 工具
│           ├── read-file.ts     # 读文件
│           ├── write-file.ts    # 写文件
│           ├── edit-file.ts     # 编辑文件
│           ├── glob.ts          # 文件搜索
│           ├── grep.ts          # 内容搜索
│           ├── web-fetch.ts     # HTTP 请求
│           └── agent-message.ts # Agent 间通信
├── gui/src/                 # eframe/egui 原生 GUI
├── config/default.yaml      # 默认配置
└── docs/                    # 文档 + 设计规格
```
