# agent-codes 工作空间结构

> 三个 AI 项目的 monorepo 工作空间

```
agent-codes/
├── openclaw/          # 多渠道 AI 网关 / 个人 AI 助手平台
├── claw-code/         # Claude Code CLI 的 Rust 重写
├── myagents/          # 自研多 Agent 框架
├── docs/              # 工作空间文档
│   └── STRUCTURE.md   # 本文件
└── .claude/           # Claude Code 配置和持久化记忆
```

---

## 1. OpenClaw — 多渠道 AI 网关

```
openclaw/
├── src/                           # 主源码
│   ├── cli/                       # CLI 实现
│   ├── commands/                  # CLI 命令
│   ├── gateway/                   # 网关控制面
│   ├── agents/                    # Agent 实现
│   ├── channels/                  # 渠道路由
│   ├── plugins/                   # 插件发现与加载
│   └── infra/                     # 基础设施 (HTTP, Crypto)
├── extensions/                    # 100+ 插件扩展
│   ├── anthropic/ openai/ gemini/ ...    # AI Provider 扩展 (~60+)
│   ├── discord/ slack/ telegram/ ...     # 消息渠道扩展 (~40+)
│   ├── memory-core/ speech-core/ ...     # 核心能力扩展
│   └── qa-channel/ qa-lab/ diffs/        # 工具类扩展
├── packages/                      # 可复用包
│   ├── plugin-sdk/                # 插件开发 SDK
│   ├── plugin-package-contract/   # 插件包契约
│   └── memory-host-sdk/           # 记忆系统 SDK
├── skills/                        # 技能模块
│   ├── coding-agent/ canvas/ ...  # 生产力技能
│   ├── github/ discord/ ...       # 集成技能
│   └── spotify-player/ weather/   # 实用工具技能
├── apps/                          # 跨平台原生应用
│   ├── macos/                     # macOS (Swift)
│   ├── ios/                       # iOS (Swift)
│   ├── android/                   # Android (Kotlin)
│   └── shared/                    # 共享代码
├── ui/                            # Web 控制界面 (Vite + Lit)
├── Swabble/                       # 语音唤醒框架
├── docs/                          # 项目文档
├── scripts/                       # 构建部署脚本
├── test/                          # 测试文件
└── vendor/                        # 第三方代码
```

**技术栈**: TypeScript, Swift, Kotlin, Node.js 22+, pnpm, Vite, SQLite, LanceDB

### OpenClaw 核心功能

| 类别 | 功能 |
|------|------|
| **AI Provider** | 60+ 模型提供商 (OpenAI, Anthropic, Gemini, Bedrock, DeepSeek, 智谱, 通义, Ollama 等) |
| **消息渠道** | 40+ 平台 (Discord, Slack, Telegram, WhatsApp, Signal, iMessage, Teams, Matrix, 飞书, QQ 等) |
| **语音能力** | 唤醒词 (Swabble), TTS (ElevenLabs), STT (Deepgram), 实时转录 |
| **记忆系统** | 基于 LanceDB 的持久化记忆, 对话上下文管理 |
| **媒体生成** | 图片生成, 视频生成, 音乐生成 |
| **跨平台** | macOS/iOS/Android 原生应用, Web 控制台, Linux CLI |
| **扩展性** | 插件 SDK, 技能系统, Webhook, API 端点 |
| **Canvas** | 实时渲染交互界面 |

---

## 2. Claw Code — Rust CLI Agent 框架

```
claw-code/
├── rust/                               # Rust 主工作空间
│   ├── crates/
│   │   ├── rusty-claude-cli/           # 主 CLI 二进制 (claw/claw.exe)
│   │   ├── runtime/                    # 核心运行时 (会话, 权限, MCP, 系统提示)
│   │   ├── api/                        # Provider 客户端 (Anthropic, OpenAI 兼容)
│   │   ├── tools/                      # 内置工具 (文件/搜索/Web/Agent)
│   │   ├── commands/                   # 斜杠命令注册表 (40+ 命令)
│   │   ├── plugins/                    # 插件管理 (安装/启用/禁用)
│   │   ├── telemetry/                  # 会话追踪与分析
│   │   ├── compat-harness/             # TS manifest 兼容提取
│   │   └── mock-anthropic-service/     # 确定性测试 Mock
│   └── scripts/
├── src/                                # 参考 Python 实现 (已归档)
├── tests/                              # 测试
├── docs/                               # 项目文档
├── .github/                            # CI/CD 工作流
├── README.md / USAGE.md / PARITY.md / ROADMAP.md / PHILOSOPHY.md / STRUCTURE.md
└── assets/
```

**技术栈**: Rust (Edition 2021, forbid unsafe), ~48K LOC, 9 crates

### Claw Code 核心功能

| 类别 | 功能 |
|------|------|
| **交互模式** | REPL 带补全 (命令/模型/会话), 一次性 Prompt 模式 |
| **AI Provider** | Anthropic (API Key + OAuth), OpenAI 兼容, 自定义代理端点 |
| **模型别名** | `opus` → claude-opus-4-6, `sonnet` → claude-sonnet-4-6, `haiku` → claude-haiku-4-5 |
| **内置工具** | bash, read/write/edit_file, glob, grep, web_search/fetch, agent, notebook_edit |
| **斜杠命令** | 40+ 命令: /help /status /resume /compact /commit /pr /review /doctor /mcp 等 |
| **权限系统** | 细粒度工具访问控制, 会话权限策略 |
| **MCP** | Model Context Protocol 服务器集成, 生命周期管理 |
| **插件系统** | 插件安装/启用/禁用, Hook 集成面 |
| **会话管理** | 持久化会话, 恢复会话, 使用量追踪, 成本监控 |
| **Git 集成** | 分支感知, /pr /issue /release-notes /diff /files |
| **分析工具** | /review /advisor /insights /security-review |
| **子 Agent** | 并行任务执行, /subagent /team |
| **终端渲染** | Markdown 渲染, JSON 输出模式 |

---

## 3. MyAgents — 自研多 Agent 框架

```
myagents/
├── packages/                       # pnpm monorepo
│   ├── core/src/                   # 核心功能
│   │   ├── agent/                  # Agent 类 (BaseAgent, ButlerAgent)
│   │   ├── conversation/           # 对话管理
│   │   ├── config/                 # 配置加载
│   │   ├── api/                    # WebSocket 服务器 (端口 18765)
│   │   ├── tools/                  # 工具系统 + Docker 沙箱
│   │   ├── mcp/                    # MCP 集成
│   │   ├── skills/                 # Skills 系统
│   │   ├── group/                  # 多 Agent 群组讨论
│   │   ├── butler/                 # Butler Agent (管理型)
│   │   ├── gateway/                # LLM 网关
│   │   └── runtime.ts              # 运行时入口
│   ├── providers/src/              # LLM Provider 实现
│   │   ├── anthropic/              # Anthropic SDK
│   │   ├── gemini/                 # Google Gemini
│   │   └── openai-compat/          # 7 个 OpenAI 兼容 Provider
│   ├── channels/src/               # 渠道适配器
│   │   ├── discord/                # Discord 集成
│   │   ├── feishu/                 # 飞书集成
│   │   ├── qq/                     # QQ OneBot v11
│   │   └── wecom/                  # 企业微信集成
│   └── shared/src/                 # 共享类型, 事件, 日志
├── gui/src/                        # Rust eframe/egui 原生 GUI
├── skills/                         # 技能定义
│   ├── code-review/
│   ├── group-coordination/
│   └── project-planning/
├── config/default.yaml             # 默认配置
├── scripts/dev.ts                  # 开发入口 (CLI 交互)
├── data/                           # 运行时数据
├── docs/                           # 文档
└── tests/                          # 113 个测试
```

**技术栈**: TypeScript (strict), Rust (eframe/egui), pnpm monorepo, Vitest

### MyAgents 核心功能

| 类别 | 功能 |
|------|------|
| **多 LLM 支持** | Anthropic, OpenAI 兼容 (DeepSeek, 智谱, 通义, MiniMax, 豆包, Grok), Gemini |
| **多渠道接入** | QQ (OneBot v11 WS), Discord (Gateway+REST), 企业微信 (HTTP 回调), 飞书 (HTTP 事件) |
| **Agent 系统** | BaseAgent, ButlerAgent (管理型), SubAgent (临时子 Agent) |
| **群组讨论** | 3 种协议: round-robin (轮流), free-form (自由), moderated (主持) |
| **工具系统** | 8 内置工具: bash, read/write/edit-file, glob, grep, web-fetch, agent-message |
| **Docker 沙箱** | 安全隔离的工具执行环境 |
| **MCP 集成** | 外部工具协议连接 |
| **Skills 框架** | YAML/JSON 定义的增强行为 |
| **WebSocket API** | 端口 18765, 供 GUI 实时通信 |
| **原生 GUI** | Rust eframe/egui, 暗色主题, 中文字体 |
| **事件驱动** | 全局事件总线, 清晰的模块解耦 |
| **配置化** | YAML 配置, 运行时动态加载 |

---

## 开发状态总览

| 项目 | 语言 | 规模 | 状态 |
|------|------|------|------|
| **OpenClaw** | TypeScript + Swift + Kotlin | 100+ 扩展插件 | 活跃开发 |
| **Claw Code** | Rust | 9 crates, ~48K LOC | 活跃开发, 对齐原始 TS 实现 |
| **MyAgents** | TypeScript + Rust GUI | 60+ TS 文件, 113 测试 | Phase 0-5 完成, Phase 6 GUI 进行中 |
