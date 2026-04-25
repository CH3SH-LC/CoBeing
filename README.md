# CoBeing

> Multi-Agent Collaboration Framework with Multi-LLM, Multi-Channel, Sandbox, MCP, Skills and Native GUI

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-22+-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7+-blue.svg)](https://www.typescriptlang.org/)

CoBeing 是一个多智能体协作框架，支持多个 AI Agent 在群组中协作完成任务。

## 特性

- 🤖 **多智能体协作**：支持创建多个 AI Agent，在群组中协作完成复杂任务
- 🔌 **多 LLM 支持**：支持 DeepSeek、OpenAI、Gemini、通义千问、智谱等 10+ 种 AI 服务
- 📱 **多渠道接入**：支持 QQBot、Discord、企业微信、飞书等渠道
- 🐳 **Docker 沙箱**：安全的代码执行环境
- 🔧 **MCP 服务器**：支持 Model Context Protocol 扩展
- 🎯 **技能系统**：可复用的工作流方法论
- 🖥️ **原生 GUI**：基于 Tauri 的桌面应用

## 快速开始

### 环境要求

- Node.js >= 22
- pnpm >= 10
- Docker（可选，用于沙箱功能）

### 安装

```bash
# 克隆仓库
git clone https://github.com/yourusername/cobeing.git
cd cobeing

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

### 启动 GUI

```bash
# 构建 GUI
cd gui-v2
npm install
npm run build
npx tauri build

# 启动 GUI
./src-tauri/target/release/cobeing.exe
```

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
├── scripts/             # 开发脚本
├── docs/                # 文档
└── tests/               # 测试
```

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
- QQBot、Discord、企业微信、飞书等
- 支持消息路由和绑定
- 可以绑定到 Agent 或 Group

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

### 代码规范

```bash
# 检查代码规范
pnpm lint

# 自动修复
pnpm lint:fix
```

## API

### WebSocket API

CoBeing 提供 WebSocket API 用于 GUI 和第三方集成：

```javascript
const ws = new WebSocket('ws://localhost:18765');

// 获取技能列表
ws.send(JSON.stringify({ type: 'get_skills' }));

// 获取技能文档
ws.send(JSON.stringify({ type: 'get_skill_doc', payload: { name: 'code-review' } }));

// 执行技能
ws.send(JSON.stringify({
  type: 'execute_skill',
  payload: {
    name: 'code-review',
    task: '审查这段代码的质量',
    params: {}
  }
}));
```

### 事件类型

| 事件 | 说明 |
|------|------|
| `skill_list` | 技能列表响应 |
| `skill_doc` | 技能文档响应 |
| `skill_result` | 技能执行结果 |
| `channel_message` | 渠道消息 |
| `agent_status` | Agent 状态变更 |

## 配置

### 环境变量

```bash
# LLM Provider Keys
DEEPSEEK_API_KEY=your_key
OPENAI_API_KEY=your_key
GEMINI_API_KEY=your_key

# 渠道配置
QQ_ONEBOT_WS_URL=ws://localhost:3001
QQ_BOT_QQ=your_bot_qq

# 核心配置
LOG_LEVEL=info
DATA_DIR=./data
```

### 配置文件

- `config/default.json`：主配置文件
- `config/templates/`：Agent 模板
- `data/agents/*/config.json`：Agent 自治配置

## 部署

### Docker 部署

```bash
# 构建镜像
docker build -t cobeing .

# 运行容器
docker run -d \
  -p 18765:18765 \
  -v ./data:/app/data \
  -v ./.env:/app/.env \
  cobeing
```

### 系统服务

```bash
# 创建 systemd 服务
sudo nano /etc/systemd/system/cobeing.service

# 启动服务
sudo systemctl start cobeing
sudo systemctl enable cobeing
```

## 贡献

欢迎贡献代码！请遵循以下步骤：

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 创建 Pull Request

### 开发规范

- 使用 TypeScript 编写代码
- 遵循 ESLint 规范
- 编写单元测试
- 更新文档

## 许可证

本项目基于 MIT 许可证发布 - 详见 [LICENSE](LICENSE) 文件

## 致谢

感谢以下开源项目：

- [Anthropic Claude](https://www.anthropic.com/) - AI 模型
- [Tauri](https://tauri.app/) - 桌面应用框架
- [OpenAI](https://openai.com/) - AI 模型
- [Docker](https://www.docker.com/) - 容器化平台

## 联系方式

- 问题反馈：[GitHub Issues](https://github.com/yourusername/cobeing/issues)
- 讨论交流：[GitHub Discussions](https://github.com/yourusername/cobeing/discussions)

---

**CoBeing** - 让多个 AI 一起帮你干活 🚀
