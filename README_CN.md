<p align="center">
  <img src="main-icon.png" alt="CoBeing Logo" width="128" height="128">
</p>

<h1 align="center">CoBeing</h1>

<p align="center">
  <strong>原生多智能体协作框架 — 让 AI Agents 组队干活</strong>
</p>

<p align="center">
  <a href="README.md">English</a>
</p>

<p align="center">
  <img src="cobeing-poster.png" alt="CoBeing Poster" width="100%">
</p>

---

## 为什么选择 CoBeing

| 特色 | 一句话 |
|------|--------|
| **零学习成本** | Agent 与群组双驱动，对话即搭建 —— 告诉管家你的需求，自动创建 Agent、组建团队，无需学习任何配置语法 |
| **长效记忆与自主学习** | 你的信息、偏好、习惯被持久记录在本地，Agent 越用越懂你。记忆跨越对话不丢失，经验持续积累不退化 |
| **场景化自主协作** | 组内 Agent 自主分工、主动沟通、相互审核，协作完成端到端的复杂场景任务，而不是"一问一答"的短期问答 |
| **高智能自动化（TODOboard）** | 任务自动分解→分配→追踪→验收。支持定时触发、条件触发、依赖链触发三种模式。说一句话，坐等成果交付 |

---

## 核心特性

### 智能体与群组双驱动

每个 Agent 是独立自治的 AI 个体，拥有完整的文件系统作为"数字大脑"——**SOUL.md** 定义性格特质、**CHARACTER.md** 塑造人格背景、**JOB.md** 标定专业领域、**MEMORY.md** 持久化长时记忆。Agent 之间通过事件总线通信，注册表统一编排生命周期。Agent 可 `bind` 到任意外部项目目录，工具自动指向目标工作区。

群组是项目级协作单元，不是聊天群。群主（Host）自动拆分任务、追踪进度、协调仲裁。Agent 在群组中自主感知队友能力、主动发起沟通、沉淀共享经验。模块化并行工作流支持阶段驱动 PLAN.md，TODO 支持定时/自动扫描/条件触发三种模式，依赖链完成后自动通知下游。

**管家（Butler）** 是用户的第一接触点。用户通过自然语言告诉管家需求，管家自动创建 Agent、组建团队、分配角色——零学习成本，对话即搭建。

### 并发执行引擎

Agent 采用 per-session 并发模型。同一 Agent 可同时在多个群组和独立对话中并行工作，不同 session 之间完全隔离互不阻塞。WakeSystem 为每个群组维护独立调度队列，跨群组并发唤醒。配合 5 分钟兜底超时保护，防止 LLM 挂起永久阻塞系统。WebView2 层面禁用后台节流，确保窗口失焦时连接不掉线。

### 记忆与自主学习

四目标分层记忆架构（memory / experience / user / tools），以 SQLite FTS5 全文搜索引擎为底层，构建多策略检索评分管道：

1. **FTS5 粗筛** — 全文检索候选集（上限 50）
2. **Jaccard 语义匹配** — 词汇级相似度评分
3. **时间衰减加权** — 越新越相关，半衰期可配置
4. **信任反馈调参** — helpful / unhelpful 动态调整条目权重

`final_score = (0.5 × fts + 0.5 × jaccard) × trust × temporal_decay`

EXPERIENCE.md 经验积累配合 MemoryAgent 自动提取工作经验。用户的偏好、习惯被持久记录在本地，Agent 越用越懂你，记忆跨越对话不丢失。

### 插件架构

`@cobeing/plugin-sdk` 标准化插件接口，支持 ModelProvider / Channel / Tool / MemoryBackend 四种插件类型。系统自动扫描 `plugins/` 目录发现新插件并写入配置——即插即用。7 家 LLM 厂商 + 1 个 QQ Bot 渠道均以内置插件提供。

### ToolAgent 临时智能体

4 种任务驱动型临时 Agent，需要时创建、独立 LLM 循环执行、任务完成后自动销毁——轻量化、零持久化、不污染注册表：

| 类型 | 用途 | 特点 |
|------|------|------|
| Review | 群组消息审核 | 审核管道拦截，最多 3 轮迭代修正 |
| Judgment | @mention 唤醒判断 | 15s 超时默认唤醒，避免无效等待 |
| Clone | 并行子任务执行 | 最多 5 个分身，禁止递归克隆 |
| Memory | 工作经验自动提取 | 个人/群组双模式，异步触发 |

### 分层安全模型

5 级权限体系（ReadOnly → WorkspaceReadWrite → WorkspaceAccess → BasicAccess → FullAccess），bash 命令动态分级器按危险等级自动匹配权限要求，危险命令自动拦截。提示注入防御覆盖 13 类英文 + 18 类中文威胁模式及混合语言攻击，配合围栏函数在记忆注入环节隔离不可信内容。文件操作路径经符号链接解析 + 相对路径遍历双重防御。API Key 以 AES-256-GCM + PBKDF2（100K 迭代 SHA-512）加密存储，WebSocket 仅绑定 127.0.0.1 并内置频率限制、消息体积限制和心跳超时检测。

### 桌面体验

React 19 + Tauri 2.0 原生桌面应用，6 套视觉鲜明主题（樱花薄荷 / 晨曦琥珀 / 薰衣草雨 / 墨夜翡翠 / 子夜紫晶 / 熔岩暗金），所有颜色经 CSS 变量驱动随主题切换，零硬编码。Agent/群组列表按最近活跃度排序，消息气泡自动截断展开，TODO 支持列表/看板双视图与批量操作。内置可观测性仪表盘——Token 消耗、延迟分布、工具调用排行、Agent 活跃度实时监控。

---

## 快速开始

### 方式一：使用 Release 压缩包（推荐）

1. 前往 [Releases](https://github.com/CH3SH-LC/CoBeing/releases) 下载最新压缩包
2. 解压到任意目录
3. 双击 `start.bat` 启动

> **注意：** 后台运行终端可能导致杀毒软件误判。如果遇到拦截，请将 CoBeing 目录添加到杀毒软件的白名单中。

### 方式二：从源码构建

**环境要求：**
- Node.js >= 22
- pnpm >= 10
- Docker（可选，用于沙箱功能）

```bash
# 克隆仓库
git clone https://github.com/CH3SH-LC/CoBeing.git
cd CoBeing

# 安装依赖
pnpm install

# 配置（可选 — 也可启动后通过 GUI 配置）
cp .env.example .env
# 编辑 .env 文件，填入你的 API Key

# 构建项目
pnpm build

# 启动开发服务器
pnpm dev
```

### 配置

编辑 `config/default.json` 或通过 GUI 设置页面：

```json
{
  "core": {
    "logLevel": "info",
    "dataDir": "./data",
    "skillsDir": "./skills"
  },
  "providers": {
    "deepseek": {
      "apiKeyEnv": "DEEPSEEK_API_KEY",
      "baseURL": "https://api.deepseek.com"
    }
  }
}
```

---

## 项目结构

```
CoBeing/
├── packages/
│   ├── shared/          # 共享类型、工具、常量
│   ├── providers/       # LLM Provider 实现（OpenAI-compatible）
│   ├── channels/        # QQBot Channel 适配器
│   ├── core/            # 核心逻辑（Agent/群组/工具/记忆/MCP/WS）
│   ├── plugin-sdk/      # 插件 SDK（类型定义 + 加载器）
│   └── mcp-servers/     # MCP 服务器（QQ Bot / Office）
├── gui-v2/              # React 19 + Tauri 2.0 桌面应用
├── plugins/             # 内置插件清单
├── config/              # 配置文件 + Agent/群组模板
├── skills/              # 内置技能（含元技能体系）
├── data/                # 运行时数据（自动生成）
├── scripts/             # 开发/启动/清理脚本
└── docs/                # 项目文档
```

---

## 核心概念

### Agent

Agent 是 CoBeing 的核心单元，每个 Agent 有独立的：
- **SOUL.md**：性格特质和行为准则
- **CHARACTER.md**：人物描写和背景
- **JOB.md**：专注领域和工作方式
- **MEMORY.md**：记忆存储（SQLite FTS5 全文搜索）
- **EXPERIENCE.md**：经验积累
- **TOOLS.md**：工具使用策略
- 每个 Agent 可独立配置 LLM Provider 和 Model
- 外部工作区绑定（`bind` 到任意项目目录）
- 5 级权限系统

### Group

Group 是多 Agent 协作的核心单元：
- **生命周期管理** — active → completed（自动检测 TODO 全完成 + 静默 >1h）→ archived（zip 打包归档）
- **任务分解** — 群主分解任务，支持父子层级和依赖链（dependsOn）
- **审核管道** — 消息发布前审查（最多 3 轮），不通过强制发布带 ⚠️ 标记
- **投票与共识** — vote-create / cast / result，过半通过，平局群主仲裁
- **经验沉淀** — group-experience-add / summarize，跨 Agent 知识共享
- **群组工作区** — 共享 TASK.md / PLAN.md / PROGRESS.md / MEMBERS.md / STRUCTURE.md / INTERFACE.md
- **Screener** — 可选双模型初筛，轻量 LLM 判断是否唤醒主模型

### Skill

Skill 是可复用的工作流方法论，存储在 `skills/` 目录：
- 每个技能是一个目录，包含 `SKILL.md`
- 支持 frontmatter 元数据
- 可以被 Agent 动态加载和执行
- **元技能体系** — cognitive-toolkit / collaboration-mindset / learning-loop
- Agent 级技能白名单（config.json skills 字段）

---

## 支持的 LLM 厂商

| Provider | 模型系列 | 状态 |
|----------|----------|------|
| DeepSeek | V4 Flash, V4 Pro | ✅ |
| 智谱 (GLM) | GLM-5.1, GLM-4.7, GLM-Z1, CodeGeeX 4 | ✅ |
| 通义千问 | Qwen-Max, Qwen-Plus, Qwen-Turbo, QwQ 32B | ✅ |
| MiniMax | MiniMax-M2.7, MiniMax-M2.5, abab6.5s | ✅ |
| 火山引擎 (豆包) | Seed 2.0, Doubao Pro, Doubao Lite | ✅ |
| Moonshot (Kimi) | Kimi K2.6, Kimi K2.5, Kimi K2 | ✅ |
| 小米 MiMo | MiMo V2.5 Pro, MiMo V2 Pro, MiMo V2 Flash | ✅ |

---

## 更新日志

### v1.3.1 (2026-05-26)

**韧性修复：**
- 预启动残留清理机制 — 三层防护彻底解决 Windows 删除文件残留（start.bat PowerShell → 构造函数第一行 → 防御纵深）
- Agent 执行超时保护 — 5 分钟兜底超时，防止 LLM 挂起阻塞 WakeSystem
- WS 离线窗口冻结修复 — 5s 宽限期 + pong 超时检测 + 重连加速
- `_abortController` per-session 隔离 — 修复多 session 并发 abort 竞态

**架构改进：**
- Agent 并发架构重构 — 全局互斥锁替换为 `_activeSessions`，多群组 + 独立对话并发
- WebView2 后台节流抑制 — 禁止 Windows timer throttling 和窗口遮挡检测
- 仪表盘 Agent 来源修复 — 正确区分群组活跃 vs 独立任务活跃

**安全与稳定性：**
- WS 连接稳定性全面加固 — 应用层心跳 + visibility API + 指数退避重连
- Agent 忙碌时自动重新入队 — 防死循环（上限 10 次）
- 群组创建强化用户决策制 — "用户为上"规则
- butler.ts 删除路径补齐 config.json rename 兜底

### v1.3.0 (2026-05-25)

**新功能：**
- 插件系统（`@cobeing/plugin-sdk`）
- HRR 多策略记忆检索（FTS5 + Jaccard + 时间衰减 + 信任反馈）
- 5 级权限体系 + bash 命令动态分级器
- 4 种 ToolAgent（审查/判断/复制/记忆）
- 工具增强（bash 截断保护 + grep 完整重写）
- 提示注入防御（13EN+18CN+混合检测+围栏函数）
- GUIDE.md + EXPERIENCE.md 分离 + 概要机制
- 分层 System Prompt（STATIC/AGENT/VOLATILE 五层结构）

**安全加固：** CSP 启用、WS 频率限制、密钥 KDF 升级至 PBKDF2、bash 命令注入防御、路径逃逸检测、输入校验

---

## 开发

```bash
# 构建所有包
pnpm build

# 运行测试（417 tests, 43 files）
pnpm test

# 监听模式
pnpm dev
```

---

## 致谢

### 项目灵感

- [OpenClaw](https://github.com/openclaw) - 开源 AI Agent 框架
- [Claude Code](https://claude.ai/code) - AI 编程助手

### 模型支持

- [智谱清言](https://open.bigmodel.cn/) - GLM 系列模型
- [小米 MIMO](https://mimo.xiaomi.com/) - MIMO 系列模型

### 个人贡献

- **刘诚** - 开发者
- **范红娇、马珠淇、崔熙童** - 项目测试与反馈

### 机构支持

- **上海交通大学人工智能学院极客中心** - 提供 token 支持

### 特别感谢

- **大伟哥** - 提供项目灵感

---

## 许可证

MIT License — 详见 [LICENSE](LICENSE)

---

## 联系方式

- 问题反馈：[GitHub Issues](https://github.com/CH3SH-LC/CoBeing/issues)
- 讨论交流：[GitHub Discussions](https://github.com/CH3SH-LC/CoBeing/discussions)

---

**CoBeing** - 让多个 AI 一起帮你干活 🚀
