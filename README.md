<p align="center">
  <img src="main-icon.png" alt="CoBeing Logo" width="128" height="128">
</p>

<h1 align="center">CoBeing</h1>

<p align="center">
  <strong>原生多智能体协作框架</strong>
</p>

<p align="center">
  <a href="README_EN.md">English</a>
</p>

<p align="center">
  <img src="cobeing-poster.png" alt="CoBeing Poster" width="100%">
</p>

---

## 为什么选择 CoBeing？

市面上的 AI 助手大多是**单体架构**——一个 AI 包办一切。这导致：
- **专业性不足**：一个 AI 很难同时精通代码、设计、写作、数据分析
- **上下文混乱**：所有任务混在一个对话里，容易丢失重点
- **无法协作**：复杂任务需要多个角色配合，单体 AI 做不到

CoBeing 采用**原生多智能体架构**，从根本上解决这些问题。

---

## 核心特性

### 原生多智能体架构

**问题：** 单个 AI 的能力有天花板，复杂任务需要多个专业角色协作。

**我们的方案：** CoBeing 不是在单个 AI 上套壳，而是**从零设计的多智能体协作系统**。每个 Agent 都是独立的个体，拥有自己的记忆、经验和人格。

**为什么好：**
- **专业分工**：每个 Agent 专注一个领域，比"全能 AI"更专业
- **并行处理**：多个 Agent 可以同时工作，效率倍增
- **可复用**：同一个 Agent 可以在不同项目、不同群组中复用
- **可扩展**：需要新能力时，创建新 Agent 即可，不影响现有系统

### 管家智能体与群主智能体

**问题：** 用户不知道该创建什么样的 Agent，也不知道如何组织多个 Agent 协作。

**我们的方案：**
- **管家（Butler）**：用户的第一接触点，像一个经验丰富的项目经理
  - 理解用户需求，判断需要什么样的 Agent
  - 自动创建和配置 Agent
  - 组织群组，分配角色
- **群主（Host）**：群组的主持人和协调者，像一个会议主持人
  - 引导讨论方向，避免跑题
  - 分配任务，确保每个 Agent 都有事做
  - 推动决策，避免无休止的讨论

**为什么好：**
- **降低门槛**：用户只需要告诉管家"我要做什么"，管家会搞定一切
- **提高效率**：群主确保讨论不跑题、任务有人做、决策能落地
- **角色清晰**：管家负责"找对人"，群主负责"做对事"

### 原生智能体间通讯

**问题：** 传统方案中，Agent 之间的通讯需要经过人类中转，效率低、容易失真。

**我们的方案：** Agent 之间可以**直接对话**，不需要人类中转。

**支持的通讯方式：**
- **群组讨论**：多 Agent 在同一群组中协作，像真实团队一样讨论
- **定向消息**：Agent 可以 @mention 其他 Agent，直接点对点沟通
- **任务接力**：Agent 发现任务超出自己能力时，可以转交给更合适的 Agent

**为什么好：**
- **高效**：Agent 直接对话，不需要人类翻译
- **准确**：Agent 之间的沟通是结构化的，不会丢失信息
- **灵活**：支持一对多、多对多、接力等多种通讯模式

### TODOboard

**问题：** 多 Agent 协作时，任务容易遗漏、进度难以跟踪、责任不清晰。

**我们的方案：** 内置的**任务管理系统**，让群组协作有迹可循。

**核心功能：**
- **群组级 TODO**：群主可以创建、分配、跟踪任务
- **定时触发**：TODO 可以设置到期时间，自动提醒相关 Agent
- **状态管理**：pending → completed 的完整生命周期
- **责任到人**：每个 TODO 都有明确的负责人

**为什么好：**
- **可追踪**：所有任务都有记录，不会遗忘
- **可量化**：进度一目了然，知道完成了多少
- **可问责**：每个任务都有负责人，避免推诿

### 自主学习

**问题：** AI 每次对话都是从零开始，不会从过去的工作中学习。

**我们的方案：** Agent 具备**自我进化能力**，会从工作中积累经验。

**学习机制：**
- **EXPERIENCE.md**：记录工作中积累的经验（"我学会了什么"）
- **MEMORY.md**：存储重要的事件和决策（"我经历了什么"）
- **经验反思**：Agent 可以主动回顾和总结经验（"我能改进什么"）

**为什么好：**
- **越用越好**：Agent 会从过去的错误中学习，不再重复犯错
- **知识沉淀**：经验不会随对话结束而消失，会一直积累
- **持续进化**：Agent 可以主动发现自己的不足并改进

---

## 快速开始

### 环境要求

- Node.js >= 22
- pnpm >= 10
- Docker（可选，用于沙箱功能）

### 安装

```bash
# 克隆仓库
git clone https://github.com/CH3SH-LC/CoBeing.git
cd CoBeing

# 安装依赖
pnpm install

# 配置环境变量
cp .env.example .env
# 编辑 .env 文件，填入你的 API Key

# 构建项目
pnpm build

# 启动开发服务器
pnpm dev
```

### 配置

编辑 `config/default.json` 文件：

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
│   ├── shared/          # 共享类型和工具
│   ├── providers/       # LLM Provider 实现
│   ├── channels/        # Channel 适配器
│   └── core/            # 核心逻辑
├── gui-v2/              # Tauri 桌面应用
├── config/              # 配置文件
├── skills/              # 内置技能
├── prompts/             # Prompt 模板
├── sandbox/             # Docker 沙箱配置
└── scripts/             # 开发脚本
```

---

## 核心概念

### Agent

Agent 是 CoBeing 的核心单元，每个 Agent 有独立的：
- **SOUL.md**：性格特质和行为准则
- **CHARACTER.md**：人物描写和背景
- **JOB.md**：专注领域和工作方式
- **MEMORY.md**：记忆存储
- **EXPERIENCE.md**：经验积累

### Group

Group 是多个 Agent 协作的容器，支持：
- 多种协作协议（讨论、分工、接力等）
- 任务分配和进度跟踪
- 决策记录和知识共享

### Skill

Skill 是可复用的工作流方法论，存储在 `skills/` 目录：
- 每个技能是一个目录，包含 `SKILL.md`
- 支持 frontmatter 元数据
- 可以被 Agent 动态加载和执行

### Channel

Channel 是与用户交互的渠道：
- 目前支持 QQBot（通过 OneBot v11 协议）
- 更多渠道正在开发中（Discord、企业微信、飞书等）

---

## 支持的 LLM Provider

| Provider | 模型 | 状态 |
|----------|------|------|
| DeepSeek | deepseek-chat, deepseek-v4-flash | ✅ |
| OpenAI | GPT-4, GPT-4o | ✅ |
| Anthropic | Claude 4.5/4.6/4.7 | ✅ |
| Google | Gemini 2.5/3.0 | ✅ |
| 智谱 | GLM-4 | ✅ |
| 通义千问 | Qwen-3 | ✅ |
| MiniMax | MiniMax-M1 | ✅ |
| 火山引擎 | 豆包 | ✅ |
| Grok | Grok-3 | ✅ |
| Moonshot | Kimi | ✅ |
| SiliconFlow | 多模型 | ✅ |

---

## 开发

### 构建

```bash
# 构建所有包
pnpm build

# 构建单个包
pnpm --filter @cobeing/core build

# 监听模式
pnpm dev
```

### 测试

```bash
# 运行所有测试
pnpm test

# 运行单个包的测试
pnpm --filter @cobeing/core test

# 监听模式
pnpm test:watch
```

---

## 致谢

### 项目灵感

- [OpenClaw](https://github.com/openclaw) - 开源 AI Agent 框架
- [Hermes](https://github.com/hermes-agent) - 终端 Agent 框架
- [Claude Code](https://claude.ai/code) - AI 编程助手

### 模型支持

- [智谱清言](https://open.bigmodel.cn/) - GLM 系列模型
- [小米 MIMO](https://mimo.xiaomi.com/) - MIMO 系列模型

### 个人贡献

- **范红娇** - 项目测试与反馈
- **马珠淇** - 项目测试与反馈
- **崔熙童** - 项目测试与反馈

### 机构支持

- **上海交通大学人工智能学院极客中心** - 提供 token 支持

### 特别感谢

- **大伟哥** - 提供项目灵感

---

## 许可证

本项目基于 MIT 许可证发布 - 详见 [LICENSE](LICENSE) 文件

---

## 联系方式

- 问题反馈：[GitHub Issues](https://github.com/CH3SH-LC/CoBeing/issues)
- 讨论交流：[GitHub Discussions](https://github.com/CH3SH-LC/CoBeing/discussions)

---

**CoBeing** - 让多个 AI 一起帮你干活 🚀
