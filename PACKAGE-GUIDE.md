# CoBeing v1.1 打包指南

## 最终产物

`CoBeing-v1.1/` 文件夹，用户双击 `start.bat` 即可运行。

---

## 打包步骤

### 1. 创建目录结构

```bash
mkdir CoBeing-v1.1
cd CoBeing-v1.1
mkdir -p gui
mkdir -p data/agents/butler
mkdir -p data/agents/host
mkdir -p data/agents/butler/memory
mkdir -p data/agents/host/memory
mkdir -p data/agents/butler/skills
mkdir -p data/agents/host/skills
mkdir -p data/agents/butler/workspace
mkdir -p data/agents/host/workspace
mkdir -p data/butler
mkdir -p data/groups
mkdir -p data/host
```

### 2. 复制 Core 后端源码

```bash
cp -r packages/     CoBeing-v1.1/
cp -r config/       CoBeing-v1.1/
cp -r scripts/      CoBeing-v1.1/
mkdir -p CoBeing-v1.1/skills
cp -r skills/agent-creation    CoBeing-v1.1/skills/
cp -r skills/group-coordination CoBeing-v1.1/skills/
cp -r prompts/      CoBeing-v1.1/
cp -r sandbox/      CoBeing-v1.1/
cp -r cobeing/      CoBeing-v1.1/
cp package.json     CoBeing-v1.1/
cp pnpm-lock.yaml   CoBeing-v1.1/
cp pnpm-workspace.yaml CoBeing-v1.1/
cp tsconfig.base.json  CoBeing-v1.1/
```

### 3. 复制 GUI 可执行文件

从 Tauri 构建产物复制：

```bash
cp gui-v2/src-tauri/target/release/cobeing.exe CoBeing-v1.1/gui/CoBeing.exe
```

### 4. 复制 Agent 核心文件

每个 Agent 需要以下文件（从 `data/agents/{id}/` 复制）：

**管家（butler）：**
- AGENTS.md, CHARACTER.md, EXPERIENCE.md, JOB.md, MEMORY.md, SOUL.md, TOOLS.md, USER.md
- config.json

**群主（host）：**
- AGENTS.md, BOOTSTRAP.md, CHARACTER.md, EXPERIENCE.md, JOB.md, MEMORY.md, SOUL.md, TOOLS.md, USER.md
- config.json

**群主 config.json 标准内容：**
```json
{
  "name": "群主",
  "role": "项目协调者和讨论引导者",
  "systemPrompt": "你是群主，群组的主持人和协调者。阅读你的核心文件了解完整的角色定义。",
  "provider": "deepseek",
  "model": "deepseek-v4-flash",
  "permissions": { "mode": "full-access" },
  "sandbox": { "enabled": true, "filesystem": "isolated", "network": { "enabled": true, "mode": "all" } },
  "tools": [
    "bash", "read-file", "write-file", "glob", "grep", "web-fetch",
    "group-members", "talk-create", "talk-send", "talk-read",
    "group-plan", "group-invite-talk", "group-summarize", "group-assign-task",
    "host-guide-discussion", "host-decompose-task", "host-summarize-progress",
    "host-record-decision", "host-manage-todo", "host-review-todo",
    "todo-add", "todo-list", "todo-complete", "todo-remove"
  ],
  "skills": ["group-coordination"]
}
```

### 5. 复制 Butler 注册表

```bash
cp data/butler/AGENTS_REGISTRY.md  CoBeing-v1.1/data/butler/
cp data/butler/GROUPS_REGISTRY.md  CoBeing-v1.1/data/butler/
```

**注意：** 注册表文件应该清空，只保留标题。用户运行时会自动创建新的注册信息。

### 6. 复制群主全局数据

```bash
cp data/host/config.json       CoBeing-v1.1/data/host/
cp data/host/DECISIONS.md      CoBeing-v1.1/data/host/
cp data/host/GROUPS_REGISTRY.md CoBeing-v1.1/data/host/
```

**注意：** DECISIONS.md 和 GROUPS_REGISTRY.md 文件应该清空，只保留标题。

### 7. 复制环境变量模板

```bash
cp .env.example CoBeing-v1.1/
```

**注意：** 不要复制 `.env`（含 API 密钥）。

### 8. 创建启动脚本

创建 `start.bat`（见下方完整内容）。

---

## 不应包含的文件

| 文件/目录 | 原因 |
|-----------|------|
| `.env` | 含 API 密钥 |
| `node_modules/` | `pnpm install` 自动安装 |
| `*/dist/` | `pnpm build` 自动构建 |
| `*.db` / `*.db-shm` / `*.db-wal` | 运行时 SQLite 数据库 |
| `memory/*.md` | 运行时对话记录 |
| `gui-v2/` | GUI 已编译为 exe |
| `docs/` | 开发文档 |
| `.claude/` | AI 工具配置 |
| `vitest.config.ts` | 测试配置 |
| `STRUCTURE.md` | 开发文档 |
| `CLAUDE.md` | AI 工具指令 |
| `README.md` | 开发文档 |

---

## 清理检查清单

打包前必须清理以下个人数据：

### 配置文件清理
- [ ] `config/default.json` 中的 `channels` 字段必须为空对象 `{}`
- [ ] 不包含任何 QQBot、Discord 等 channel 配置

### 记忆数据清理
- [ ] 删除 `data/agents/butler/memory.db*` 文件
- [ ] 删除 `data/agents/host/memory.db*` 文件
- [ ] 清空 `data/agents/butler/memory/` 目录
- [ ] 清空 `data/agents/host/memory/` 目录

### 注册表清理
- [ ] 清空 `data/butler/AGENTS_REGISTRY.md`（只保留标题）
- [ ] 清空 `data/butler/GROUPS_REGISTRY.md`（只保留标题）
- [ ] 清空 `data/host/DECISIONS.md`（只保留标题）
- [ ] 清空 `data/host/GROUPS_REGISTRY.md`（只保留标题）

### 技能系统
- [ ] 确认 `packages/core/src/api/ws-server.ts` 包含 `get_skill_doc` 处理逻辑
- [ ] 确认技能界面可以正常加载 SKILL.md 文档

---

## 最终目录结构

```
CoBeing-v1.1/
├── start.bat                  # 一键启动
├── .env.example               # 环境变量模板
├── package.json               # pnpm 配置
├── pnpm-lock.yaml             # 依赖锁定
├── pnpm-workspace.yaml        # monorepo 配置
├── tsconfig.base.json         # TS 配置
│
├── gui/
│   └── CoBeing.exe            # 预编译桌面应用
│
├── packages/
│   ├── shared/                # 共享类型
│   ├── providers/             # LLM Provider
│   ├── channels/              # Channel 适配器
│   └── core/                  # 核心逻辑
│
├── config/
│   ├── default.json           # 根配置
│   └── templates/             # 9 个 Agent 模板
│
├── data/
│   ├── butler/
│   │   ├── AGENTS_REGISTRY.md # Agent 注册表（空）
│   │   └── GROUPS_REGISTRY.md # 群组注册表（空）
│   ├── agents/
│   │   ├── butler/            # 管家核心文件
│   │   └── host/              # 群主核心文件
│   ├── host/
│   │   ├── config.json        # 群主运行时配置
│   │   ├── DECISIONS.md       # 决策记录（空）
│   │   └── GROUPS_REGISTRY.md # 群组注册表（空）
│   └── groups/                # 群组数据（空）
│
├── scripts/                   # 开发脚本
├── skills/
│   ├── agent-creation/        # 管家创建智能体技能（必带）
│   └── group-coordination/    # 群组协调技能（必带）
├── prompts/                   # Prompt 模板
├── sandbox/                   # Docker 沙箱 Dockerfile
└── cobeing/sandbox/           # 沙箱 Dockerfile
```

---

## start.bat 完整内容

```bat
@echo off
cd /d "%~dp0"

echo.
echo  CoBeing v1.1
echo  Multi-Agent Collaboration Framework
echo.

:: Check Node.js
node -v >nul 2>&1
if ERRORLEVEL 1 (
    echo [ERROR] Node.js not found. Install from https://nodejs.org/
    pause
    exit /b 1
)

:: Check pnpm
where pnpm >nul 2>&1
if ERRORLEVEL 1 (
    echo [INFO] Installing pnpm...
    call npm install -g pnpm
)

:: Check .env
if not exist ".env" (
    if exist ".env.example" (
        copy .env.example .env >nul
        echo [INFO] Created .env - please add API keys, then restart.
        start notepad .env
    ) else (
        echo [ERROR] No .env found.
    )
    pause
    exit /b 1
)

:: Install deps
if not exist "node_modules" (
    echo [INFO] Installing dependencies...
    call pnpm install
    if ERRORLEVEL 1 call pnpm install --registry https://registry.npmmirror.com
)

:: Build
if not exist "packages\core\dist\index.js" (
    echo [INFO] Building core...
    call pnpm build
)

:: Start Core backend in hidden window
echo [INFO] Starting Core backend...
powershell -WindowStyle Hidden -Command "Start-Process -FilePath 'cmd' -ArgumentList '/c', 'title CoBeing Core && pnpm dev' -WindowStyle Hidden -WorkingDirectory '%~dp0'"

:: Wait for Core
timeout /t 3 /nobreak >nul

:: Launch GUI
echo [INFO] Launching CoBeing GUI...
start "" "%~dp0gui\CoBeing.exe"

:: Exit
exit /b 0
```

---

## GUI 构建（需要时）

如果需要重新构建 GUI exe：

```bash
cd gui-v2

# 安装依赖
npm install

# 构建前端
npm run build

# 构建 Tauri（需要 Rust）
npx tauri build --bundles nsis
```

产物：`gui-v2/src-tauri/target/release/cobeing.exe`

---

## 用户使用流程

1. 解压 `CoBeing-v1.1` 文件夹
2. 双击 `start.bat`
3. 首次运行：
   - 自动检查 Node.js（需要 >= 22）
   - 自动安装 pnpm（如果没有）
   - 自动创建 .env 并打开编辑器填入 API Key
   - 自动安装依赖
   - 自动构建 Core
   - 启动 Core 后端（隐藏窗口）+ GUI
4. 再次运行：直接启动（跳过安装/构建）

## 用户环境要求

- Node.js >= 22
- **不需要 Rust**（GUI 已预编译）
- **不需要 npm install gui**（exe 直接运行）
