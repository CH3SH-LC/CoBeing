# CoBeing

> 多智能体协作框架 — 让 AI Agents 组队干活

CoBeing 是一个原生多 Agent 协作平台。每个 Agent 都是独立个体，拥有自己的记忆、经验和人格。多个 Agent 可以组队协作处理复杂项目，内置智能管家帮你管理一切。

<p align="center">
  <img src="cobeing-poster.png" alt="CoBeing Poster" width="100%">
</p>

## 为什么选择 CoBeing

| 特色 | 一句话 |
|------|--------|
| **零学习成本** | Agent 与群组双驱动，用户通过自然语言与管家对话即可搭建自己的工作框架，无需学习任何配置语法 |
| **长效记忆与自主学习** | 用户信息和偏好被持久记录在本地，Agent 越用越了解你的个性需求，不会每次对话都从零开始 |
| **场景化自主协作** | 组内 Agent 自主分工、沟通、审核，完成的是复杂场景的端到端任务而非短期专项问答 |
| **高智能自动化（TODOboard）** | 任务自动分解、分配、追踪、验收，支持定时/条件/依赖链三种触发模式，真正实现"说一句话，坐等交付" |

---

## 核心特性

### 智能体与群组双驱动

每个 Agent 是独立自治的 AI 个体，拥有完整的文件系统作为"数字大脑"——SOUL.md 定义性格、CHARACTER.md 塑造人格、JOB.md 标定专业领域、MEMORY.md 持久化记忆。Agent 与 Agent 之间、Agent 与群组之间的关系由注册表统一编排，支持创建、克隆、销毁的完整生命周期。

群组是项目级协作单元，而非聊天群。群主（Host）自动拆分任务、追踪进度、协调仲裁。Agent 在群组中自主发现队友能力、主动沟通协作、沉淀共享经验。

### 并发执行引擎

Agent 采用 per-session 并发模型——同一 Agent 可同时在多个群组和独立对话中并行工作，不同 session 之间完全隔离互不阻塞。WakeSystem 为每个群组维护独立调度队列，跨群组并发唤醒，配合 5 分钟兜底超时保护，确保系统在任何负载下稳定运行。

### 记忆与自主学习

四目标分层记忆架构（memory / experience / user / tools），SQLite FTS5 全文搜索引擎驱动。多策略检索评分管道——FTS5 粗筛 → Jaccard 语义匹配 → 时间衰减加权 → 信任反馈动态调参——让 Agent 精确找到与当前上下文最相关的历史信息。EXPERIENCE.md 经验积累机制配合 MemoryAgent 自动提取工作经验，Agent 越用越聪明。

### 插件架构

`@cobeing/plugin-sdk` 提供标准化插件接口。支持四种插件类型（ModelProvider / Channel / Tool / MemoryBackend），自动扫描 `plugins/` 目录发现新插件并写入配置。7 家 LLM 厂商 + 1 个 QQ Bot 渠道均以内置插件形式提供，即插即用。

### ToolAgent 临时智能体

4 种任务驱动型临时 Agent——Review（审核）、Judgment（唤醒判断）、Clone（并行分身）、Memory（经验提取）——需要时创建、独立 LLM 循环执行、任务完成后自动销毁。轻量化、零持久化、不污染 Agent 注册表。

### 分层安全模型

5 级权限体系（ReadOnly → WorkspaceReadWrite → WorkspaceAccess → BasicAccess → FullAccess），bash 命令动态分级器按危险等级自动匹配权限要求。提示注入防御覆盖英文、中文及混合语言威胁，配合围栏函数在记忆注入环节隔离不可信内容。API Key 经 AES-256-GCM + PBKDF2（100K 迭代 SHA-512）加密，WebSocket 仅绑定 localhost 且内置频率限制。

### 桌面体验

React 19 + Tauri 2.0 原生桌面应用，6 套主题系统（樱花薄荷 / 晨曦琥珀 / 薰衣草雨 / 墨夜翡翠 / 子夜紫晶 / 熔岩暗金），所有颜色经 CSS 变量驱动随主题切换。Agent/群组列表按最近活跃度排序，长消息自动截断展开，TODO 支持列表/看板双视图与批量操作。

---

## 快速开始

### 环境要求

| 工具 | 版本 | 用途 |
|------|------|------|
| Node.js | >= 22.0.0 | 运行时 |
| pnpm | >= 10.0.0 | 包管理与脚本运行 |
| Rust (可选) | 最新稳定版 | 打包桌面应用 |
| Docker (可选) | 任意版本 | 沙箱隔离执行 |

### 方式一：使用 Release 压缩包（推荐）

1. 前往 [Releases](https://github.com/CH3SH-LC/CoBeing/releases) 下载最新压缩包
2. 解压到任意目录
3. 双击 `start.bat`，选择启动模式

### 方式二：从源码运行

```bash
git clone https://github.com/CH3SH-LC/CoBeing.git
cd CoBeing

# 安装依赖
pnpm install

# 构建
pnpm build

# 启动（选择 CLI / GUI / Both）
pnpm dev
```

### 配置 LLM API Key

程序不强制要求预先配置。启动后可通过 GUI 设置页面配置，也可在 `.env` 中填写：

```env
DEEPSEEK_API_KEY=sk-xxx
ZHIPU_API_KEY=xxx
QWEN_API_KEY=sk-xxx
MINIMAX_API_KEY=xxx
VOLCENGINE_API_KEY=xxx
MOONSHOT_API_KEY=sk-xxx
MIMO_API_KEY=xxx
```

---

## 项目结构

```
CoBeing/
├── packages/              # 后端核心 (pnpm monorepo)
│   ├── core/              #   Agent/群组/工具/记忆/MCP/WebSocket
│   ├── providers/         #   LLM Provider 适配器
│   ├── channels/          #   外部通信渠道
│   ├── shared/            #   共享类型、工具、常量
│   ├── plugin-sdk/        #   插件 SDK（类型定义 + 加载器）
│   └── mcp-servers/       #   MCP 服务器（QQ Bot / Office）
├── gui-v2/                # 前端 GUI (React 19 + Tauri 2.0)
├── plugins/               # 内置插件（7 provider + 1 channel）
├── config/                # 配置文件 + 模板
│   ├── default.json       #   主配置
│   └── templates/         #   Agent/群组创建模板
├── skills/                # 全局技能仓库
├── data/                  # 运行时数据（自动生成）
├── scripts/               # 开发/启动脚本
└── docs/                  # 项目文档
```

---

## 核心概念

### Agent

每个 Agent 是独立个体，拥有自己的文件系统：

| 文件 | 用途 |
|------|------|
| SOUL.md | 性格特质 — 怎么说、怎么做、边界在哪 |
| CHARACTER.md | 人物描写 — 姓名、背景、个性 |
| JOB.md | 工作职责 — 擅长什么、怎么工作 |
| MEMORY.md | 记忆存储（SQLite FTS5 全文搜索） |
| EXPERIENCE.md | 经验积累 — 从工作中学习 |
| TOOLS.md | 工具策略 — 什么时候用什么工具 |
| USER.md | 用户偏好记录 |

Agent 支持外部工作区绑定（`bind` 到任意项目目录），每个 Agent 可独立配置 LLM Provider 和 Model。

### Group

群组是"项目工作组"而非"聊天群"：

- **生命周期管理** — active → completed（自动检测）→ archived（zip 打包）
- **任务分解** — 群主分解任务，支持父子层级和依赖链（dependsOn）
- **审核管道** — 消息发送前自动审核，最多 3 轮迭代修正
- **投票与共识** — vote-create / cast / result，过半通过，群主仲裁
- **经验沉淀** — group-experience-add / summarize，跨 Agent 知识共享
- **群组工作区** — 共享 TASK.md / PLAN.md / PROGRESS.md / INTERFACE.md
- **Screener** — 可选双模型初筛，轻量 LLM 判断是否唤醒主模型

### ToolAgent

4 种临时、非持久化的工具智能体：

| 类型 | 用途 |
|------|------|
| Review | 群组消息审核，审查通过后销毁 |
| Judgment | @mention 判断，避免无效唤醒（15s 超时） |
| Clone | 母体创建分身并行工作（最多 5 个） |
| Memory | 自动提取工作经验（个人/群组双模式） |

### Skill

可复用的工作流方法论文档，存储在 `skills/` 目录：

- 每个技能是 `SKILL.md` 文件，支持 frontmatter 元数据
- Agent 级技能白名单（config.json skills 字段）
- **元技能体系** — cognitive-toolkit / collaboration-mindset / learning-loop

---

## 常用命令

```bash
pnpm dev          # 启动开发服务器
pnpm build        # 构建所有包
pnpm test         # 运行测试（417 tests, 43 files）
pnpm test:watch   # 测试监听模式
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

## 支持的 LLM 厂商

| Provider | 模型系列 | 获取 API Key |
|----------|----------|-------------|
| DeepSeek | V4 Flash, V4 Pro | [platform.deepseek.com](https://platform.deepseek.com) |
| 智谱 GLM | GLM-5.1, GLM-4.7, GLM-Z1 | [open.bigmodel.cn](https://open.bigmodel.cn) |
| 通义千问 | Qwen-Max, Plus, Turbo, QwQ | [dashscope.aliyun.com](https://dashscope.aliyun.com) |
| MiniMax | M2.7, M2.5, abab6.5s | [platform.minimaxi.com](https://platform.minimaxi.com) |
| 火山引擎 | Seed 2.0, Doubao Pro/Lite | [console.volcengine.com](https://console.volcengine.com) |
| Moonshot | Kimi K2.6, K2.5, K2 | [platform.moonshot.cn](https://platform.moonshot.cn) |
| 小米 MiMo | V2.5 Pro, V2 Pro, V2 Flash | [platform.xiaomimimo.com](https://platform.xiaomimimo.com) |

---

## 数据与隐私

- 所有数据存储在本地 `data/` 目录
- API Key AES-256-GCM 加密存储（PBKDF2 100K 迭代 SHA-512）
- WebSocket 仅绑定 127.0.0.1，不暴露到网络
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

**Agent 无响应**
1. 确认 `.env` 中至少配置了一个有效的 API Key
2. 在设置页面检查 Provider 配置是否正确

**杀毒软件误报**
将 CoBeing 目录添加到杀毒软件白名单。`start.bat` 中 PowerShell 进程管理可能触发启发式检测。

---

## 更新日志

### v1.3.1 (2026-05-26)

**韧性修复：**
- **预启动残留清理机制** — 三层防护彻底解决 Windows 删除文件残留：`start.bat` PowerShell 预清理 → 构造函数第一行 SQLite 连接前清理 → `cleanupOrphanDirectories` 防御纵深
- **Agent 执行超时保护** — 5 分钟兜底超时，防止 LLM 挂起阻塞 WakeSystem
- **WS 离线窗口冻结修复** — 5s 离线宽限期 + pong 超时检测 + 心跳不排队 + 重连加速
- **`_abortController` per-session 隔离** — 修复多 session 并发 abort 竞态
- **`getStatus()` 恢复 "error" 状态返回** — 修复 agent 卡在 "idle" 无法检测的 bug

**架构改进：**
- **Agent 并发架构重构** — 全局互斥锁替换为 `_activeSessions: Set<string>`，支持多群组 + 独立对话并发
- **WakeSystem 跨群组并发** — 忙碌检查仅限同群组 session，不同群组的同一 Agent 互不阻塞
- **WebView2 后台节流抑制** — 禁止 Windows 后台 timer throttling 和窗口遮挡检测
- **仪表盘 Agent 来源修复** — 正确区分群组活跃 vs 独立任务活跃

**安全与稳定性：**
- **WS 连接稳定性** — 应用层心跳 + visibility API + 窗口焦点恢复重连 + 指数退避
- **群组回复失败修复** — Agent 忙碌时自动重新入队（上限 10 次防死循环）
- **群组创建用户决策制** — 4 步用户对接指引 + "用户为上"规则强化
- **butler.ts 删除路径补齐** — 新增 config.json rename 兜底防幽灵复活

### v1.3.0 (2026-05-25)

**新功能：**
- **插件系统** — `@cobeing/plugin-sdk` 包，PluginLoader 自动发现，7 provider + 1 channel 内置插件
- **HRR 多策略记忆检索** — FTS5 + Jaccard + 时间衰减 + 信任反馈四阶段评分管道
- **5 级权限体系** — ReadOnly→FullAccess，bash 命令动态分级器，Agent 多工作区绑定
- **4 种 ToolAgent** — 审查/判断/复制/记忆，独立 LLM 循环
- **工具增强** — bash 16KB 输出截断 + grep 完整重写（output_mode/head_limit/上下文/multiline）
- **提示注入防御** — 13EN+18CN+混合检测 + 围栏函数
- **GUIDE.md + EXPERIENCE.md 分离** — 概要机制 + 群组自动注入
- **分层 System Prompt** — STATIC / AGENT / VOLATILE 五层结构，缓存友好
- **共享常量文件** — DEFAULT_PROVIDER / MAX_* 等集中管理

**安全加固：** CSP 启用、WS 频率限制+消息体积限制、密钥 KDF 升级至 PBKDF2（100K 迭代 SHA-512）、bash 命令注入防御、路径逃逸检测、输入校验

**韧性改进：** WakeSystem dispose()、LLM 熔断器（3次失败→60s断路）、原子写入、集合修剪、ToolAgent 120s 超时、进程级 unhandledRejection/uncaughtException 处理器

---

## 致谢

- **刘诚** — 开发者
- **范红娇、马珠淇、崔熙童** — 项目测试与反馈
- **上海交通大学人工智能学院极客中心** — Token 支持
- **大伟哥** — 项目灵感

### 项目灵感

- [OpenClaw](https://github.com/openclaw) — 开源 AI Agent 框架
- [Claude Code](https://claude.ai/code) — AI 编程助手

---

## 许可证

MIT License — 详见 [LICENSE](LICENSE)

---

**CoBeing** — 让多个 AI 一起帮你干活
