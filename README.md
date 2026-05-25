# CoBeing

> 多智能体协作框架 — 让 AI Agents 组队干活

CoBeing 是一个多 Agent 协作平台。你可以创建不同角色的 AI Agent，让它们单独完成任务，或者组队协作处理复杂项目。内置智能管家帮你管理一切。

## 特性

- **多 Agent 管理** — 创建、配置、销毁 Agent，每个 Agent 有独立的性格、职责和工具
- **群组协作** — 组建 Agent 团队，多角色协作完成复杂任务
- **智能管家** — 内置 Butler Agent，用自然语言管理整个系统
- **多 LLM 支持** — Anthropic / OpenAI / DeepSeek / Gemini / 智谱 / 千问 等 10+ 厂商
- **多渠道接入** — QQ / Discord / 飞书 / 企业微信（可选）
- **工具系统** — bash、文件读写、代码编辑、网页抓取等内置工具
- **技能系统** — 可扩展的 SKILL.md 技能文件
- **记忆与经验** — Agent 自动积累对话记忆和工作经验
- **本地优先** — 所有数据存储在本地，不上传云端
- **桌面 GUI** — React 19 + Tauri 2.0 原生桌面应用

---

## 快速开始

### 环境要求

| 工具 | 版本 |
|------|------|
| Node.js | >= 22.0.0 |
| pnpm | >= 10.0.0 |
| Rust (可选，桌面应用需要) | 最新稳定版 |
| Docker (可选，沙箱功能需要) | 任意版本 |

### 安装步骤

**1. 克隆项目**

```bash
git clone <repo-url> cobeing
cd cobeing
```

**2. 安装依赖**

```bash
pnpm install
```

**3. 配置 API Key**

复制环境变量模板并填入你的 API Key：

```bash
cp .env.example .env
```

编辑 `.env` 文件，至少填入一个 LLM Provider 的 Key：

```
# 推荐从 DeepSeek 开始（性价比高）
DEEPSEEK_API_KEY=your_key_here

# 或使用其他 Provider
ANTHROPIC_API_KEY=your_key_here
OPENAI_API_KEY=your_key_here
```

> 你只需要配置一个 Provider 就能开始使用。更多 Provider 详见下方 [配置 LLM Provider](#配置-llm-provider) 章节。

**4. 启动**

最简单的方式 — 双击 `start.bat`（Windows），按提示选择模式。

或命令行启动：

```bash
# CLI 模式（终端交互）
pnpm dev

# GUI 模式（浏览器）
# 终端 1: 启动后端
pnpm dev
# 终端 2: 启动前端
cd gui-v2 && npm install && npm run dev
# 然后打开 http://localhost:1420
```

看到以下输出说明启动成功：

```
=== CoBeing v2 ===
Core WS Server started on port 18765
输入文字与管家对话，输入 /help 查看命令
```

---

## 新手教程

### 第一步：和管家打个招呼

启动后你会看到一个叫 **管家** 的 Agent。它是你的第一联系人，可以帮你做任何事。

在 CLI 或 GUI 中直接输入：

```
你好，帮我介绍一下你自己
```

管家会自然地回复你，就像和一个朋友聊天。

### 第二步：和管家聊天

管家不仅能聊天，还能帮你做事：

```
帮我用 Python 写一个快速排序
```

管家会直接帮你写代码，不需要创建额外的 Agent。

```
帮我搜索一下当前目录有哪些文件
```

管家有 bash、文件读写等工具，可以直接操作。

### 第三步：创建一个专属 Agent

当你需要一个长期存在的专业角色时，可以让管家帮你创建：

```
帮我创建一个 Python 数据分析专家
```

管家会：
1. 分析你的需求
2. 设计 Agent 的性格和能力
3. 创建并注册新 Agent

你也可以通过 GUI 的 "创建 Agent" 按钮手动创建。

### 第四步：组建团队

当任务需要多个角色协作时：

```
帮我创建一个开发团队，需要一个前端工程师和一个后端工程师，一起设计一个 Todo 应用
```

管家会创建一个群组，让多个 Agent 在里面讨论和协作。你可以在 GUI 中实时观看它们的讨论过程。

### 第五步：探索 Agent 的世界

每个 Agent 都有自己的文件目录，包含：

| 文件 | 内容 |
|------|------|
| SOUL.md | 性格特质 — 决定说话方式和行为风格 |
| CHARACTER.md | 人物描写 — 姓名、背景、个性 |
| JOB.md | 工作职责 — 擅长什么、怎么工作 |
| USER.md | 用户偏好 — 记录你的喜好 |
| EXPERIENCE.md | 工作经验 — 积累的经验和教训 |
| TOOLS.md | 工具策略 — 什么时候用什么工具 |

Agent 会在使用过程中自动学习和更新这些文件。你可以在 GUI 的 "文件" 标签页中查看和编辑。

---

## 配置 LLM Provider

CoBeing 支持 10+ 家 LLM 厂商。在 `.env` 中配置你想用的 Provider 的 API Key：

| Provider | 环境变量 | 获取地址 |
|----------|----------|----------|
| DeepSeek | `DEEPSEEK_API_KEY` | https://platform.deepseek.com |
| Anthropic | `ANTHROPIC_API_KEY` | https://console.anthropic.com |
| OpenAI | `OPENAI_API_KEY` | https://platform.openai.com |
| Google Gemini | `GEMINI_API_KEY` | https://aistudio.google.com |
| 智谱 GLM | `ZHIPU_API_KEY` | https://open.bigmodel.cn |
| 通义千问 | `QWEN_API_KEY` | https://dashscope.console.aliyun.com |
| MiniMax | `MINIMAX_API_KEY` | https://www.minimaxi.com |
| 豆包（字节） | `VOLCENGINE_API_KEY` | https://www.volcengine.com |
| Grok (xAI) | `XAI_API_KEY` | https://console.x.ai |
| Moonshot | `MOONSHOT_API_KEY` | https://platform.moonshot.cn |
| SiliconFlow | `SILICONFLOW_API_KEY` | https://siliconflow.cn |

默认使用 DeepSeek 的 `deepseek-chat` 模型。你可以在 `config/default.json` 中修改默认模型。

---

## 项目结构

```
cobeing/
├── packages/          # 后端核心 (pnpm monorepo)
│   ├── core/          #   Agent/群组/工具/记忆/MCP/WebSocket
│   ├── providers/     #   LLM Provider 适配器
│   ├── channels/      #   外部通信渠道 (QQ/Discord/飞书/企业微信)
│   └── shared/        #   共享类型和工具
├── gui-v2/            # 前端 GUI (React 19 + Tauri 2.0)
├── config/            # 配置文件 + Agent 模板
│   ├── default.json   #   主配置
│   └── templates/     #   Agent 创建模板
├── data/              # 运行时数据 (自动生成)
├── skills/            # 全局技能仓库
├── prompts/           # Prompt 模板
└── scripts/           # 开发脚本
```

---

## 常用命令

```bash
pnpm dev          # 启动开发服务器
pnpm build        # 构建所有包
pnpm test         # 运行测试
pnpm test:watch   # 测试监听模式
pnpm clean        # 清理构建产物
```

CLI 模式内置命令：

```
/agents    # 查看所有 Agent
/groups    # 查看所有群组
/registry  # 查看注册表
/gateway   # 查看 LLM 网关状态
/help      # 查看帮助
/quit      # 退出
```

---

## 桌面应用打包

需要安装 Rust 工具链（https://rustup.rs）：

```bash
# 双击 build-gui.bat 或手动执行：
cd gui-v2
npm install
npx tauri build
```

输出在 `gui-v2/src-tauri/target/release/bundle/`。

---

## 数据与隐私

- 所有数据存储在本地 `data/` 目录
- Agent 配置、对话历史、经验积累全部本地保存
- API Key 通过 `.env` 文件管理，不会上传
- 不收集任何遥测数据

---

## 故障排查

**启动报错 "Cannot find module"**
```bash
pnpm clean && pnpm build
```

**GUI 连接失败**
1. 确认后端已启动并显示 "WS Server started on port 18765"
2. 检查端口是否被占用

**Agent 创建失败**
1. 确认 `.env` 中至少配置了一个有效的 API Key
2. 检查网络连接

---

## License

MIT
