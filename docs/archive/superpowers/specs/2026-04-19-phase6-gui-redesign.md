# Phase 6: GUI 重构设计 — 从 egui 迁移到 React + Tauri

> 日期: 2026-04-19
> 状态: 已批准
> 前置: Phase 0-8 后端全部完成

---

## 1. 概述

### 1.1 目标

将当前 Rust egui 原生 GUI (~1,065 行) 完全迁移到 **React + Tauri 2.0** 桌面应用。主界面采用微信风格聊天体验，设置页保留 Mission Control 工程控制台风格。

### 1.2 技术栈

| 层 | 技术 | 说明 |
|----|------|------|
| 桌面壳 | **Tauri 2.0** | Rust 后端壳 + WebView 前端 |
| 前端框架 | **React 19** | 函数组件 + Hooks |
| UI 组件 | **shadcn/ui** | 基于 Radix UI + Tailwind CSS |
| 样式 | **Tailwind CSS 4** | 原子化 CSS |
| 状态管理 | **Zustand** | 轻量状态管理 |
| Markdown | **react-markdown** + **rehype-highlight** | 消息内容渲染 |
| 通信 | **WebSocket** (端口 18765) | 保持现有协议 + 扩展 |
| 构建 | **Vite** | 快速开发 + HMR |

### 1.3 项目结构

```
gui/                          ← 替换现有 gui/src/*.rs
├── src-tauri/               ← Tauri Rust 壳
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── src/
│       └── main.rs
├── src/                     ← React 前端
│   ├── main.tsx
│   ├── App.tsx
│   ├── components/          ← UI 组件
│   │   ├── ui/              ← shadcn/ui 基础组件
│   │   ├── chat/            ← 聊天相关
│   │   ├── agent/           ← Agent 管理
│   │   ├── group/           ← 群组管理
│   │   ├── skill/           ← 技能管理
│   │   ├── settings/        ← 设置页面
│   │   └── shared/          ← 通用组件
│   ├── hooks/               ← 自定义 Hooks
│   │   ├── useWebSocket.ts
│   │   ├── useAgents.ts
│   │   └── useGroups.ts
│   ├── stores/              ← Zustand 状态
│   │   ├── chat.ts
│   │   ├── agents.ts
│   │   ├── groups.ts
│   │   ├── skills.ts
│   │   └── settings.ts
│   ├── lib/                 ← 工具函数
│   │   ├── ws-client.ts
│   │   └── utils.ts
│   └── styles/
│       └── globals.css
├── package.json
├── tailwind.config.ts
├── tsconfig.json
└── vite.config.ts
```

---

## 2. 视觉系统 — "Aurora" 极光主题

### 2.1 色彩 Token

```css
:root {
  /* 背景 */
  --bg-base:       #0C0E14;
  --bg-surface:    #12151E;
  --bg-elevated:   #1A1E2C;
  --bg-hover:      #242938;
  --bg-input:      #0F1118;

  /* 强调 */
  --accent:        #6EE7B7;    /* 翡翠绿 — 主强调 */
  --accent-warm:   #F0A080;    /* 琥珀玫瑰 — 群组/警告 */
  --accent-dim:    #2D4A3E;    /* 翡翠绿暗色 */

  /* 消息气泡 */
  --msg-user:      #1C2A3A;    /* 蓝灰 — 用户消息 */
  --msg-assistant: #141E1A;    /* 暗绿 — AI 消息 */
  --msg-system:    #1E1A14;    /* 暗琥珀 — 系统消息 */
  --msg-tool:      #1A1828;    /* 暗紫 — 工具调用 */

  /* 文本 */
  --text:          #E8ECF4;
  --text-sub:      #9BA4B8;
  --text-muted:    #5A6278;

  /* 边框 */
  --border:        #252B3B;
  --border-focus:  #3A4258;

  /* 语义 */
  --success:       #6EE7B7;
  --warning:       #FBBF24;
  --danger:        #F87171;
  --purple:        #C4B5FD;
}
```

### 2.2 字体

| 用途 | 字体 | 回退 |
|------|------|------|
| 标题/品牌 | `Space Grotesk` | sans-serif |
| 正文/UI | `Noto Sans SC` | system-ui |
| 代码/日志 | `JetBrains Mono` | monospace |

### 2.3 圆角

| 组件 | 圆角 |
|------|------|
| 按钮/输入框 | 8px |
| 卡片/气泡 | 12px |
| 弹窗/对话框 | 16px |
| 导航图标 | 12px |

---

## 3. 整体布局

三层结构，类似微信桌面版：

```
┌──────────┬──────────────┬──────────────────────────────────────┐
│  导航栏   │   会话列表    │              主内容区                 │
│  (64px)  │   (240px)    │                                      │
│          │              │  ┌────────────────────┬─────────────┐ │
│  💬 聊天  │   最近对话    │  │                    │             │ │
│  👤 联系人 │   列表...     │  │   对话区 / 内容区   │  详情面板    │ │
│  👥 群组  │              │  │                    │  (可折叠)    │ │
│  ⚡ 技能  │              │  │                    │             │ │
│  ⚙️ 设置  │              │  ├────────────────────┤             │ │
│          │              │  │   输入区             │             │ │
│          │              │  └────────────────────┴─────────────┘ │
└──────────┴──────────────┴──────────────────────────────────────┘
```

### 3.1 导航栏 (64px)

| 图标 | 视图 | 说明 |
|------|------|------|
| 💬 | 聊天 | 最近对话列表 → 对话消息流 |
| 👤 | 联系人 | Agent 列表 → Agent 对话/详情 |
| 👥 | 群组 | 群组列表 → 群组讨论/工作区 |
| ⚡ | 技能 | 技能列表 → 技能详情/执行 |
| ⚙️ | 设置 | Mission Control 风格配置面板 |

### 3.2 会话列表 (240px)

所有视图共用会话列表区域，内容根据当前导航切换：

| 视图 | 列表内容 |
|------|---------|
| 聊天 | 最近对话（按时间排序） |
| 联系人 | Agent 列表（按状态排序：running > idle > error） |
| 群组 | 群组列表（按活跃度排序） |
| 技能 | 技能列表（按名称排序） |
| 设置 | 设置分类菜单 |

### 3.3 主内容区

根据当前选中项动态渲染：
- 对话消息流 + 输入栏（聊天/联系人/群组视图）
- 技能详情 + 执行面板（技能视图）
- 配置面板（设置视图）
- 右侧可折叠详情面板（Agent/群组详情抽屉，400px）

---

## 4. 聊天视图

### 4.1 对话消息流

**布局规则（中国用户习惯）**：
- **用户消息：右对齐**，蓝灰底 (`--msg-user`)，翡翠绿标签 "你"
- **AI 消息：左对齐**，暗绿底 (`--msg-assistant`)，Agent 名称 + 身份色条
- **系统消息：居中**，窄条，琥珀色
- **工具调用：左对齐**，暗紫底 (`--msg-tool`)，工具图标 + 参数摘要，可展开/折叠

**消息气泡内容**：
- 头部：发送者名称 + 时间戳
- 正文：Markdown 渲染（代码块语法高亮、列表、表格、粗体/斜体）
- 工具调用消息：工具名 + 参数摘要（折叠式），点击展开查看完整参数和结果
- 悬停操作：复制按钮

### 4.2 群组讨论视图

复用对话消息流，每条消息增加：
- 左侧身份色条（不同 Agent 不同颜色）
- 发言人名称标签（替代 "Assistant"）
- @mention 彩色高亮（`@agent-id` → 彩色标签）
- Screener 消息：特殊紫色条样式

群组头部额外显示：
- 群组名称 + 成员数
- "启动协作" 按钮 + "详情" 按钮

### 4.3 输入区

```
┌──────────────────────────────────────────────┐
│  ┌────────────────────────────────────┐  ⬆  │
│  │  输入消息...                        │      │
│  │                                    │ 发送 │
│  └────────────────────────────────────┘      │
│  [📎] [🔧] [⚡] [@]      Enter 发送          │
└──────────────────────────────────────────────┘
```

| 按钮 | 功能 | 弹出内容 |
|------|------|---------|
| 📎 附件 | 上传文件给 Agent 读取 | 文件选择器（Tauri dialog） |
| 🔧 工具 | 直接调用工具 | 工具列表下拉 + 参数输入 |
| ⚡ 技能 | 执行 Skill | 技能选择器 + task 输入 |
| @ 提及 | 群组中 @Agent | Agent 列表下拉 |

快捷键：Enter 发送，Shift+Enter 换行。

---

## 5. 联系人 (Agent) 视图

### 5.1 Agent 列表

列表顶部：搜索框 + "新建 Agent" 按钮。

Agent 卡片内容：
- 状态灯（🟢 idle / 🟡 running / 🔴 error）
- Agent 名称
- 角色 + 权限级别标签
- Provider / Model 信息

右键/长按菜单：打开对话、查看详情、编辑配置、删除。

### 5.2 Agent 详情面板（右侧抽屉，400px）

三个 Tab：

**配置 Tab**：
- Provider（下拉选择，联动 Model 列表）
- Model（下拉选择，根据 Provider 过滤）
- 权限模式（下拉：full-access / workspace-write / read-only / ask）
- 沙箱开关 + 文件系统路径 + 网络控制
- 工具白名单（勾选列表：bash, read-file, write-file, edit-file, glob, grep, web-fetch, agent-message）
- 技能白名单（勾选列表：从 SkillRepository.list() 获取）
- [保存修改] [重置]

**文件 Tab**：
- 列出 Agent 文件系统中的 .md 和 config.json 文件
- 每个文件有 [查看/编辑] 按钮
- 点击后内联显示 Markdown/JSON 编辑器
- 文件列表：IDENTITY.md, SOUL.md, USER.md, EXPERIENCE.md, MEMORY.md, TOOLS.md, config.json

**对话 Tab**：
- 切换到与该 Agent 的对话视图（等同于从聊天视图打开）

---

## 6. 群组视图

### 6.1 群组列表

列表顶部：搜索框 + "新建群组" 按钮。

群组卡片内容：
- 群组名称（紫色）
- 成员数 + 活跃状态
- 成员名称列表（逗号分隔）
- 讨论主题预览

### 6.2 群组详情面板（右侧抽屉，400px）

四个 Tab：

**成员 Tab**：
- 成员列表：名称 + 角色标签（主持人/成员）+ [移除] 按钮
- [+ 添加成员] 按钮

**工作区 Tab**：
- Workspace 5 文档：MEMBERS.md, STRUCTURE.md, TASK.md, PROGRESS.md, PLAN.md
- 每个文档 [查看/编辑] 按钮
- Talk 列表：显示已创建的私有讨论（参与者 + 主题），点击查看历史

**讨论 Tab**：
- 切换到群组讨论视图

**配置 Tab**：
- 协作目标（文本输入）
- [启动协作] [销毁群组]

---

## 7. 技能视图

### 7.1 技能列表

列表顶部：搜索框 + "新建技能" 按钮。

技能卡片内容：
- 技能名称
- 描述
- 使用的工具标签列表

### 7.2 技能详情面板（右侧抽屉，400px）

三个 Tab：

**概览 Tab**：
- 技能名称 + 描述
- 使用的工具列表
- 创建时间

**Prompt Tab**：
- SKILL.md 内容查看/编辑（代码编辑器，Markdown 模式）
- [保存] 按钮

**执行 Tab**：
- Task 输入（文本框）
- 参数输入（动态表单，根据技能模板变量 `{{参数}}` 生成）
- [执行] 按钮
- 执行结果显示区域

---

## 8. 设置视图 (Mission Control 风格)

设置页采用左侧菜单 + 右侧配置面板的双栏布局，信息密度高，工程控制台风格。

### 8.1 设置菜单

```
┌────────────┐
│  常规       │  ← 语言、日志级别、数据目录
│  主题       │  ← Aurora 暗色（后续可扩展亮色）
│  ── 连接 ── │
│  Providers  │  ← 9 家 LLM 配置
│  Channels   │  ← 4 个 Channel 配置
│  MCP 服务器  │  ← MCP 连接管理
│  ── 数据 ── │
│  日志       │  ← 实时日志流
│  ── 关于 ── │
│  版本信息    │
└────────────┘
```

### 8.2 Providers 页

- 每个 Provider 一张卡片
- 卡片内容：名称 + 连通状态灯 + 当前模型
- 展开后：API Key 输入（密码模式）+ Base URL + [测试连接] 按钮 + 延迟显示
- Provider 列表：anthropic, openai, deepseek, zhipu, qwen, minimax, volcengine, gemini, grok

### 8.3 Channels 页

- 每个 Channel 一张状态卡片：名称 + 连接状态 + 绑定信息
- [配置] 按钮 → Channel 参数编辑弹窗
- 绑定关系列表：Channel → Group (user/owner 模式)
- 绑定操作：[添加绑定] / [解绑]

### 8.4 MCP 服务器页

- 服务器列表，每个条目：名称 + Transport 类型 + 连接状态 + 已注册工具数
- [+ 添加服务器] 按钮 → 弹窗：名称 + Transport (stdio/http) + Command/URL
- [编辑] [断开/重连] [删除] 操作按钮
- 展开查看已注册的工具列表

### 8.5 日志页

- 终端风格的实时日志流
- 按级别过滤：INFO / WARN / ERROR
- 自动滚动到底部
- 搜索过滤

---

## 9. 对话框设计

### 9.1 创建 Agent 对话框

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| 名称 | 单行输入 | 是 | - | Agent 显示名 |
| 角色 | 单行输入 | 是 | - | 功能角色 |
| Provider | 下拉选择 | 是 | deepseek | 联动 Model 列表 |
| Model | 下拉选择 | 是 | deepseek-chat | 根据 Provider 动态 |
| 高级配置 | 折叠面板 | 否 | - | 点击展开 |
| - 权限模式 | 下拉 | 否 | full-access | 4 个选项 |
| - 沙箱 | 开关 | 否 | 关闭 | Docker 沙箱 |
| - 网络访问 | 开关 | 否 | 开启 | |
| System Prompt | 多行编辑器 | 否 | - | 自定义提示词 |

### 9.2 创建群组对话框

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| 群组名称 | 单行输入 | 是 | - | |
| 协作目标 | 单行输入 | 否 | - | |
| 成员选择 | 复选列表 | 是 | - | 至少 1 人 |

### 9.3 创建技能对话框

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| 名称 | 单行输入 | 是 | 技能标识 |
| 描述 | 单行输入 | 是 | 功能描述 |
| Prompt | 多行编辑器 | 是 | SKILL.md 内容 |

---

## 10. WebSocket 协议扩展

### 10.1 现有协议（保留）

**Client → Server**:
```json
{ "type": "get_state" }
{ "type": "send_message", "payload": { "agentId": "...", "content": "..." } }
{ "type": "get_log" }
```

**Server → Client**:
```json
{ "type": "state", "payload": { "agents": [...], "groups": [...], "channels": [...], "timestamp": ... } }
{ "type": "stream_token", "payload": { "token": "..." } }
{ "type": "agent_response", "payload": { "content": "..." } }
{ "type": "message", "payload": { "direction": "in|out|system", "content": "...", "timestamp": ... } }
{ "type": "error", "payload": { "message": "..." } }
```

### 10.2 新增消息

> **实现状态**: ✅ 已实现 | 🔄 TODO

**Client → Server**:

| type | payload | 说明 | 状态 |
|------|---------|------|------|
| `create_agent` | `{ name, role, provider?, model?, systemPrompt?, skills? }` | 创建 Agent | ✅ |
| `destroy_agent` | `{ agentId }` | 销毁 Agent | ✅ |
| `create_group` | `{ name, members, topic? }` | 创建群组 | ✅ |
| `destroy_group` | `{ groupId }` | 销毁群组 | ✅ |
| `get_config` | `{}` | 获取全局配置 | ✅ |
| `update_config` | `{ path, value }` | 更新全局配置 | ✅ |
| `update_agent` | `{ agentId, config: {...} }` | 更新 Agent 配置 | 🔄 TODO |
| `update_group` | `{ groupId, config: {...} }` | 更新群组配置 | 🔄 TODO |
| `add_group_member` | `{ groupId, agentId }` | 添加成员 | 🔄 TODO |
| `remove_group_member` | `{ groupId, agentId }` | 移除成员 | 🔄 TODO |
| `start_collaboration` | `{ groupId, topic? }` | 启动群组协作 | 🔄 TODO |
| `execute_skill` | `{ name, task, params? }` | 执行技能 | 🔄 TODO |
| `get_skills` | `{}` | 获取技能列表 | 🔄 TODO |
| `get_agent_detail` | `{ agentId }` | 获取 Agent 完整详情 | 🔄 TODO |
| `get_group_detail` | `{ groupId }` | 获取群组完整详情 | 🔄 TODO |
| `get_agent_files` | `{ agentId }` | 获取 Agent 文件列表 | 🔄 TODO |
| `read_agent_file` | `{ agentId, filename }` | 读取 Agent 文件内容 | 🔄 TODO |
| `write_agent_file` | `{ agentId, filename, content }` | 写入 Agent 文件 | 🔄 TODO |
| `get_group_workspace` | `{ groupId }` | 获取群组 Workspace 文档 | 🔄 TODO |
| `get_group_talks` | `{ groupId }` | 获取群组 Talk 列表 | 🔄 TODO |
| `get_group_talk_history` | `{ groupId, talkId }` | 获取 Talk 历史 | 🔄 TODO |

**Server → Client**:

| type | payload | 说明 | 状态 |
|------|---------|------|------|
| `state` | `{ agents, groups, channels, timestamp }` | 系统状态 | ✅ |
| `stream_token` | `{ token }` | 流式 token | ✅ |
| `agent_response` | `{ content }` | Agent 完整回复 | ✅ |
| `message` | `{ direction, content, timestamp }` | 消息通知 | ✅ |
| `error` | `{ message }` | 错误 | ✅ |
| `agent_created` | `{ id, name }` | Agent 创建成功 | ✅ |
| `group_created` | `{ id, name }` | 群组创建成功 | ✅ |
| `config` | `{ core, providers, channels, gui, ... }` | 全局配置 | ✅ |
| `tool_event` | `{ agentId, toolName, params, result?, status }` | 工具调用事件 | 🔄 TODO |
| `group_message` | `{ groupId, fromAgentId, content, mentions, timestamp }` | 群组协作消息 | 🔄 TODO |
| `skill_list` | `{ skills: [{ name, description, tools }] }` | 技能列表响应 | 🔄 TODO |
| `agent_detail` | `{ id, name, role, config, files, status }` | Agent 详情 | 🔄 TODO |
| `group_detail` | `{ id, name, members, topic, workspace, talks }` | 群组详情 | 🔄 TODO |
| `agent_files` | `{ agentId, files: [{ name, size, modified }] }` | Agent 文件列表 | 🔄 TODO |
| `agent_file_content` | `{ agentId, filename, content }` | 文件内容 | 🔄 TODO |
| `group_workspace` | `{ groupId, docs: {...} }` | Workspace 文档 | 🔄 TODO |
| `group_talks` | `{ groupId, talks: [...] }` | Talk 列表 | 🔄 TODO |
| `group_talk_history` | `{ groupId, talkId, messages: [...] }` | Talk 历史 | 🔄 TODO |

---

## 11. Tauri 集成

### 11.1 插件使用

| 插件 | 用途 |
|------|------|
| `tauri-plugin-shell` | Agent 执行 bash 命令（可选） |
| `tauri-plugin-dialog` | 文件选择对话框 |
| `tauri-plugin-fs` | 本地文件读写 |
| `tauri-plugin-clipboard-manager` | 复制消息内容 |
| `tauri-plugin-autostart` | 开机自启（可选） |

### 11.2 系统托盘

- 后台运行：关闭窗口时最小化到托盘
- 托盘菜单：显示/隐藏、Agent 状态概览、退出
- 通知：新消息托盘通知

### 11.3 窗口配置

- 默认尺寸：1200x800
- 最小尺寸：900x600
- 标题：MyAgents
- 深色标题栏

---

## 12. 状态管理 (Zustand)

### 12.1 Store 结构

```typescript
// stores/chat.ts
interface ChatStore {
  conversations: Map<string, Conversation>;  // agentId → 对话
  activeConversation: string | null;          // 当前打开的对话 ID
  messages: Message[];                         // 当前对话的消息列表
  streamBuffer: string;                        // 流式缓冲
  waitingForResponse: boolean;

  sendMessage: (agentId: string, content: string) => void;
  selectConversation: (id: string) => void;
  clearMessages: () => void;
}

// stores/agents.ts
interface AgentsStore {
  agents: AgentInfo[];
  selectedAgent: string | null;
  agentDetail: AgentDetail | null;            // 右侧面板详情

  fetchAgents: () => void;
  selectAgent: (id: string) => void;
  createAgent: (config: CreateAgentParams) => void;
  updateAgent: (id: string, config: Partial<AgentConfig>) => void;
  deleteAgent: (id: string) => void;
  fetchAgentDetail: (id: string) => void;
}

// stores/groups.ts
interface GroupsStore {
  groups: GroupInfo[];
  selectedGroup: string | null;
  groupDetail: GroupDetail | null;
  groupMessages: GroupMessage[];

  fetchGroups: () => void;
  selectGroup: (id: string) => void;
  createGroup: (config: CreateGroupParams) => void;
  updateGroup: (id: string, config: Partial<GroupConfig>) => void;
  deleteGroup: (id: string) => void;
  startDiscussion: (groupId: string, topic?: string) => void;
  addMember: (groupId: string, agentId: string) => void;
  removeMember: (groupId: string, agentId: string) => void;
}

// stores/skills.ts
interface SkillsStore {
  skills: SkillInfo[];
  selectedSkill: string | null;
  skillDetail: SkillDetail | null;

  fetchSkills: () => void;
  executeSkill: (name: string, task: string, params?: object) => void;
  createSkill: (name: string, description: string, prompt: string) => void;
}

// stores/settings.ts
interface SettingsStore {
  config: AppConfig | null;
  connected: boolean;
  activeView: 'chat' | 'agents' | 'groups' | 'skills' | 'settings';
  detailPanelOpen: boolean;

  fetchConfig: () => void;
  updateConfig: (config: Partial<AppConfig>) => void;
  setActiveView: (view: string) => void;
  toggleDetailPanel: () => void;
}
```

---

## 13. 实施优先级

### P0 — 核心骨架

1. Tauri 2.0 + React + shadcn/ui 项目脚手架
2. Aurora 主题 CSS Token + Tailwind 配置
3. 三层布局（导航栏 + 会话列表 + 主内容区）
4. WebSocket 客户端 Hook
5. 聊天视图：消息流 + 输入栏 + 流式显示
6. 会话列表 + Agent/Group 列表切换

### P1 — 管理能力

7. Agent 详情面板（配置/文件/对话 Tab）
8. Group 详情面板（成员/工作区/配置/讨论 Tab）
9. 创建 Agent/Group 对话框（升级版，含下拉选择）
10. 删除 Agent/Group 操作
11. 群组讨论视图（多发言人 + @mention）
12. 工具调用消息展示（折叠式）

### P2 — 扩展功能

13. 技能视图（列表 + 详情 + 执行）
14. 设置视图（Providers / Channels / MCP / 日志）
15. Markdown 渲染 + 代码高亮
16. Agent 文件浏览器 + 内联编辑器
17. 消息操作（复制、清空历史）
18. 系统托盘

### P3 — 打磨

19. 动画与过渡效果
20. 响应式布局适配
21. 键盘快捷键
22. 未读消息角标 + 通知

---

## 14. 迁移策略

1. **保留现有 egui 代码**：不删除 `gui/` 中的 Rust 代码，新建 `gui-v2/` 目录
2. **渐进迁移**：先实现 P0 核心骨架，验证 Tauri + WS 通信可用
3. **WS 协议兼容**：前端同时支持新旧协议，后端增量添加新消息类型
4. **并行运行**：开发期间 egui GUI 和 Tauri GUI 可同时连接后端
5. **完成后替换**：验证所有功能后，`gui-v2/` → `gui/`，删除旧 egui 代码
