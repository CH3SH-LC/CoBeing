# CoBeing

> 本地优先的个人 AI Agent Team 系统。

CoBeing 是一个多智能体协作系统。它让用户可以通过一个可个性化的管家管理 Agent 和群组，把生活、学习、创作、研究、事务处理中的一部分杂事交给 AI 团队完成。

当前项目是工程原型与产品化探索并行阶段：Agent、Butler、Group、GUI、工具、记忆、TODO、插件和 MCP 基础设施已经存在；Market 分级、普通用户引导、部分高级协作能力仍在建设中。

---

## 核心入口

- **管家 Butler**：用户的第一联系人，负责对话、管理 Agent、管理群组。
- **智能体 Agent**：有独立角色、职责、工具、模型、记忆和经验的工作个体。
- **群组 Group**：多个 Agent 的长期协作空间，用于复杂任务分工。
- **扩展 Extensions**：Skills、Plugins、MCPs 的管理入口，更适合进阶用户。
- **桌面 GUI**：React 19 + Tauri 2 前端，通过本地 WebSocket 连接后端。

---

## 当前已实现能力

- Agent 生命周期管理：创建、配置、运行、销毁、恢复。
- Butler 管理工具：创建 Agent、创建 Group、修改 Agent 文件、管理 TODO、发送群组消息。
- Group 协作：群组成员、@mention 唤醒、群组上下文、群组工作区、群组 TODO。
- 工具系统：bash、文件读写、编辑、glob、grep、web-fetch、memory、TODO、skill、group、MCP 等工具基础。
- 权限与沙箱：多级权限、bash 风险分级、可选 Docker 沙箱。
- 记忆与经验：Markdown + SQLite/FTS5、冻结快照、安全扫描、经验沉淀。
- 插件基础设施：plugin-sdk、Provider/Channel/UI extension、HookBus、PromptLayer 基础结构。
- MCP 基础设施：client、manager、stdio/http transport、bridge tool，以及 QQBot/Office MCP server 包。
- GUI 六入口：管家、智能体、群组、仪表盘、扩展、设置。

更详细的事实说明见：

- `docs/项目信息/项目现状.md`
- `docs/项目信息/架构说明.md`
- `docs/项目信息/使用说明.md`
- `docs/项目信息/当前待办.md`
- `docs/项目信息/产品战略.md`

---

## 需要谨慎理解的能力

- 默认配置只启用 DeepSeek；其他 Provider 主要通过 `data/plugins/providers/` 的数据插件扩展，不应理解为全部原生默认可用。
- MCP 基础设施存在，但默认 `mcpServers` 为空，需要用户配置并验证连接。
- 投票、仲裁、复杂依赖协作等能力有底层结构或工具残留，但不是完整 GUI 闭环。
- 插件 hook、prompt layer、MCP discover/register 等链路仍需要端到端验证。
- Market 官方认证、社区分级、管家自动挑选扩展是产品战略方向，尚未完整落地。

---

## 快速开始

### 环境要求

| 工具 | 版本 |
| --- | --- |
| Node.js | >= 22.0.0 |
| pnpm | >= 10.0.0 |
| Rust | 桌面 Tauri 模式需要 |
| Docker | 沙箱功能需要 |

### 安装依赖

```bash
cd CoBeing
pnpm install
```

### 配置 API Key

```bash
cp .env.example .env
```

至少配置：

```env
DEEPSEEK_API_KEY=your_key_here
```

### 启动

Windows 可以直接运行：

```bash
start.bat
```

或在 `CoBeing/` 目录执行：

```bash
pnpm dev
```

浏览器模式通常打开：

```text
http://localhost:1420
```

后端 GUI WebSocket 默认监听：

```text
ws://127.0.0.1:18765
```

---

## Agent 文件体系

当前 Agent 使用五个核心 Markdown 文件加配置文件：

| 文件 | 作用 |
| --- | --- |
| `AGENTS.md` | 运行规则、工具规则、协作规则、行为边界 |
| `CHARACTER.md` | 人物形象、语言风格、称呼习惯、表达方式 |
| `JOB.md` | 工作职责、思考方式、工作流程、输出标准 |
| `MEMORY.md` | 独立会话中的事件记忆入口 |
| `EXPERIENCE.md` | 长期经验、用户偏好、工具心得、教训沉淀 |
| `config.json` | 模型、权限、工具、沙箱、技能白名单 |

如果要改 Agent “像谁、怎么说话”，优先修改 `CHARACTER.md`。如果要改 Agent “怎么做事、怎么判断质量”，优先修改 `JOB.md`。

---

## 项目结构

```text
D:\agent-codes\
├── CoBeing/                 # 主代码目录
│   ├── packages/            # pnpm monorepo 后端包
│   ├── gui-v2/              # React 19 + Tauri 2 GUI
│   ├── config/              # 默认配置
│   ├── data/                # 运行时数据、Agent、Group、plugins、skills
│   ├── sandbox/             # Docker 沙箱镜像
│   └── scripts/             # 开发脚本
├── docs/项目信息/           # 当前核心项目文档
├── PROGRESS.md              # 详细进度
├── PROGRESS-LITE.md         # 精简进度
├── GOAL.md                  # 产品愿景
└── STRUCTURE.md             # 结构索引
```

完整结构见 `STRUCTURE.md`。

---

## 开发命令

在 `CoBeing/` 目录执行：

```bash
pnpm dev
pnpm build
pnpm test
pnpm lint
```

项目规则：修改 `.ts` 源码后必须运行 `pnpm build`，因为开发脚本会从 `packages/core/dist/` 导入编译产物。

