# Phase 6: GUI 开发计划 (Updated 2026-04-20)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成 MyAgents GUI 剩余功能开发，使前端与 Phase 9 后端架构（无协议、ID-based 配置、直接 WS 创建）完全对齐。

**Architecture:** 三层布局（导航栏64px + 会话列表240px + 主内容区），Zustand 按会话隔离消息，WebSocket 直接创建/销毁命令。

**Tech Stack:** React 19, Tauri 2.0, shadcn/ui, Tailwind CSS 4, Zustand, Vite

**Spec:** `docs/superpowers/specs/2026-04-19-phase6-gui-redesign.md`

---

## 当前已完成 vs 待开发

### 已完成 ✅
| Task | 描述 |
|------|------|
| 项目脚手架 | Tauri 2.0 + React 19 + shadcn/ui |
| Aurora 主题 | CSS Token + Tailwind + 主题切换 |
| 三层布局 | NavBar + Sidebar + MainContent |
| WS 客户端 | ws-client.ts + useWebSocket hook |
| 状态管理 | chat/agents/groups/settings/config/theme/tray |
| 聊天视图 | ChatView + MessageBubble + Markdown + 流式 |
| Agent/Group 列表 | Sidebar 内的列表 + 选择切换 |
| 创建对话框 | CreateAgentDialog + CreateGroupDialog |
| 详情面板 | AgentDetailPanel + GroupDetailPanel |
| 设置页 | Providers/Channels/MCP/Logs 子页面 |
| 系统托盘 | Tauri tray + 窗口管理 |
| Chat bug 修复 | 按会话隔离消息、去重、历史保持 |

### 待开发 🔄

| 优先级 | 功能 | 说明 |
|--------|------|------|
| ~~**P1**~~ | ~~Agent 配置编辑~~ | ✅ Task 16 完成 |
| ~~**P1**~~ | ~~Agent 文件浏览器~~ | ✅ Task 17 完成 |
| ~~**P1**~~ | ~~群组成员管理~~ | ✅ Task 18 完成 |
| ~~**P1**~~ | ~~群组协作视图~~ | ✅ Task 19 完成 |
| ~~**P1**~~ | ~~技能视图~~ | ✅ Task 20 完成 |
| ~~**P2**~~ | ~~工具调用展示~~ | ✅ Task 21 完成 |
| ~~**P2**~~ | ~~输入区增强~~ | ✅ Task 23 完成 |
| ~~**P2**~~ | ~~Agent 创建升级版~~ | ✅ Task 22 完成 |
| ~~**P3**~~ | ~~群组工作区编辑~~ | ✅ Task 24 完成 |
| ~~**P3**~~ | ~~键盘快捷键~~ | ✅ Task 25 完成 |
| ~~**P3**~~ | ~~未读角标 + 通知~~ | ✅ Task 26 完成 |

---

## Phase G: P1 — Agent 管理 + 配置

### Task 16: Agent 配置保存功能

**Files:**
- Modify: `gui-v2/src/components/agent/AgentConfigTab.tsx`
- Modify: `gui-v2/src/hooks/useWebSocket.ts`
- Modify: `gui-v2/src/lib/ws-client.ts`

**背景**: 当前 AgentConfigTab 只有 Provider/Model/权限的 UI，但没有保存到后端的能力。需要新增 `update_agent` WS 命令。

**后端需先添加**:
- `packages/core/src/api/ws-server.ts` 新增 `update_agent` 命令处理

- [x] **Step 1: 后端添加 `update_agent` WS 命令**

在 `ws-server.ts` 的 `handleMessage` switch 中添加:

```typescript
case "update_agent": {
  const { agentId, config } = msg.payload as {
    agentId: string;
    config: Partial<{ name: string; role: string; provider: string; model: string; systemPrompt: string; permissions: any; sandbox: any; tools: string[]; skills: string[] }>;
  };
  if (!agentId) {
    this.sendToClient(ws, { type: "error", payload: { message: "agentId is required" } });
    break;
  }
  const agent = this.agentRegistry?.get(agentId);
  if (!agent) {
    this.sendToClient(ws, { type: "error", payload: { message: `Agent not found: ${agentId}` } });
    break;
  }
  // Update agent config.json
  const agentPaths = AgentPaths.forAgent(agentId, this.dataRoot);
  const files = new AgentFiles(agentPaths);
  const currentConfig = files.readConfig();
  const merged = { ...currentConfig, ...config };
  files.writeConfig(merged);
  this.sendToClient(ws, { type: "agent_updated", payload: { agentId } });
  this.broadcastState();
  break;
}
```

- [x] **Step 2: 前端 AgentConfigTab 接入 `update_agent` 命令**

修改 `AgentConfigTab` 的保存逻辑，将各字段通过 WS 发送到后端。

- [x] **Step 3: 验证配置保存和恢复**

1. 打开 Agent 详情 → 修改 Provider → 保存
2. 重启后端 → 确认配置保留

- [x] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: update_agent WS command + frontend config save"
```

---

### Task 17: Agent 文件浏览器

**Files:**
- Modify: `gui-v2/src/components/agent/AgentFilesTab.tsx`
- Modify: `gui-v2/src/api/ws-server.ts` (后端)
- Modify: `gui-v2/src/hooks/useWebSocket.ts`

**后端需先添加**: `get_agent_files`, `read_agent_file`, `write_agent_file` 命令。

- [x] **Step 1: 后端添加文件操作 WS 命令**

```typescript
case "get_agent_files": {
  const { agentId } = msg.payload as { agentId: string };
  const agentPaths = AgentPaths.forAgent(agentId, this.dataRoot);
  const dir = agentPaths.baseDir;
  if (!fs.existsSync(dir)) { ... }
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".md") || f.endsWith(".json"))
    .map(name => ({ name, size: fs.statSync(path.join(dir, name)).size, modified: fs.statSync(path.join(dir, name)).mtime.toISOString() }));
  this.sendToClient(ws, { type: "agent_files", payload: { agentId, files } });
  break;
}

case "read_agent_file": {
  const { agentId, filename } = msg.payload as { agentId: string; filename: string };
  // Security: ensure filename doesn't escape the agent directory
  if (filename.includes("..") || path.isAbsolute(filename)) { ... }
  const filePath = path.join(AgentPaths.forAgent(agentId, this.dataRoot).baseDir, filename);
  if (!fs.existsSync(filePath)) { ... }
  const content = fs.readFileSync(filePath, "utf-8");
  this.sendToClient(ws, { type: "agent_file_content", payload: { agentId, filename, content } });
  break;
}

case "write_agent_file": {
  const { agentId, filename, content } = msg.payload as { agentId: string; filename: string; content: string };
  if (filename.includes("..") || path.isAbsolute(filename)) { ... }
  const filePath = path.join(AgentPaths.forAgent(agentId, this.dataRoot).baseDir, filename);
  fs.writeFileSync(filePath, content, "utf-8");
  this.sendToClient(ws, { type: "file_saved", payload: { agentId, filename } });
  break;
}
```

- [x] **Step 2: 前端 AgentFilesTab 实现文件列表 + 查看/编辑**

显示文件列表（CHARACTER.md, JOB.md, SOUL.md, USER.md, EXPERIENCE.md, MEMORY.md, TOOLS.md, config.json），点击打开内联编辑器，保存时调用 `write_agent_file`。

- [x] **Step 3: WS handler 添加 agent_files / agent_file_content / file_saved 处理**

- [x] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: agent file browser — list/read/write via WS"
```

---

## Phase H: P1 — 群组协作

### Task 18: 群组成员管理 UI

**Files:**
- Modify: `gui-v2/src/components/group/GroupMembersTab.tsx`
- Modify: `gui-v2/src/api/ws-server.ts` (后端)

**后端需先添加**: `add_group_member`, `remove_group_member` 命令。

- [x] **Step 1: 后端添加成员管理命令**

```typescript
case "add_group_member": {
  const { groupId, agentId } = msg.payload as { groupId: string; agentId: string };
  const group = this.groupManager?.get(groupId);
  if (!group) { ... }
  group.addMember(agentId);
  this.groupManager!.saveGroup(groupId);
  // Update ButlerRegistry
  const butlerReg = new ButlerRegistry(this.dataRoot);
  const gEntry = butlerReg.parseGroupsRegistry().find(g => g.id === groupId);
  if (gEntry) butlerReg.registerGroup({ ...gEntry, members: [...gEntry.members, agentId] });
  this.sendToClient(ws, { type: "member_added", payload: { groupId, agentId } });
  this.broadcastState();
  break;
}

case "remove_group_member": {
  // Similar to add, but group.removeMember() + saveGroup()
}
```

- [x] **Step 2: 前端 GroupMembersTab 接入添加/移除操作**

成员列表 + [+ 添加成员] 按钮（从 agents 列表选择）+ [移除] 按钮。

- [x] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: group member add/remove via WS"
```

---

### Task 19: 群组协作视图（多发言人消息流）

**Files:**
- Create: `gui-v2/src/components/chat/GroupChatView.tsx`
- Create: `gui-v2/src/components/chat/GroupMessageBubble.tsx`
- Modify: `gui-v2/src/components/layout/MainContent.tsx`

**背景**: 当 activeConversation 是一个 groupId 时，需要显示群组协作消息流。与普通 1:1 聊天不同，群组消息显示多个发言人。

- [x] **Step 1: 实现 GroupMessageBubble**

- 左侧身份色条（按 agentId 哈希分配颜色）
- 发言人名称标签（替代 "Assistant"）
- @mention 高亮（`@agent-id` → 彩色标签）

- [x] **Step 2: 实现 GroupChatView**

- Header: 群组名称 + 成员数 + 群组色标
- 复用 MessageList 滚动逻辑
- 使用 groupMessages store 数据源

- [x] **Step 3: MainContent 路由逻辑更新**

根据 activeConversation 匹配 agents vs groups，渲染 ChatView vs GroupChatView。

- [x] **Step 4: 后端 `group_message` WS 推送**

在 GroupManager.appendContextMessage 中同时通过 WS 广播 `group_message` 事件给前端，使前端实时显示群组协作消息。

- [x] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: group collaboration view — multi-speaker message flow"
```

---

## Phase I: P1 — 技能视图

### Task 20: 技能列表 + 详情 + 执行

**Files:**
- Create: `gui-v2/src/components/skill/SkillList.tsx`
- Create: `gui-v2/src/components/skill/SkillCard.tsx`
- Create: `gui-v2/src/components/skill/SkillDetailPanel.tsx`
- Modify: `gui-v2/src/stores/skills.ts`
- Modify: `gui-v2/src/api/ws-server.ts` (后端)

**后端需先添加**: `get_skills`, `execute_skill`, `skill-create` WS 命令。

- [x] **Step 1: 后端添加技能相关 WS 命令**

- `get_skills` → 从 SkillRepository.list() 获取
- `execute_skill` → 调用 SkillRepository.get(name) 执行
- `skill_create` → SkillRepository.create()

- [x] **Step 2: 前端 skills store 接入**

fetchSkills() → get_skills, executeSkill() → execute_skill

- [x] **Step 3: 实现 SkillList + SkillCard**

- [x] **Step 4: 实现 SkillDetailPanel** (概览/Prompt/执行 3 Tab)

- [x] **Step 5: 接入导航栏技能视图 + Sidebar**

- [x] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: skill view — list/detail/execute via WS"
```

---

## Phase J: P2 — 增强

### Task 21: 工具调用展示

**Files:**
- Modify: `gui-v2/src/components/chat/ToolCallMessage.tsx`
- Modify: `gui-v2/src/hooks/useWebSocket.ts`

**后端**: 需要在 ToolExecutor 执行时通过 WS 广播 `tool_event`。

- [x] **Step 1: 后端 ToolExecutor 广播 tool_event**

在 `tools/executor.ts` 的 execute 方法中，通过回调广播 tool start/complete/error 事件。

- [x] **Step 2: 前端 WS handler 处理 tool_event**

- [x] **Step 3: ToolCallMessage 折叠式展示** (工具名 + 参数摘要，点击展开)

- [x] **Step 4: Commit**

---

### Task 22: 创建 Agent 升级版

**Files:**
- Modify: `gui-v2/src/components/agent/CreateAgentDialog.tsx`
- Modify: `gui-v2/src/hooks/useWebSocket.ts` (或新建 useProviders.ts)

**当前状态**: CreateAgentDialog 只有 name/role/systemPrompt 输入。
**目标**: 添加 Provider/Model 联动下拉、权限模式选择、工具白名单勾选。

- [x] **Step 1: 从 WS state 获取可用 Provider 列表**

- [x] **Step 2: Provider 下拉 → 联动 Model 列表**

- [x] **Step 3: 高级配置折叠面板** (权限 + 工具勾选)

- [x] **Step 4: 接入 `create_agent` WS 命令（已完成）**

- [x] **Step 5: Commit**

---

### Task 23: 输入区增强

**Files:**
- Modify: `gui-v2/src/components/chat/ChatView.tsx` (ChatInput 部分)

- [x] **Step 1: 添加 ⚡ 技能按钮** → 技能选择器下拉

- [x] **Step 2: 添加 @ 提及按钮** → Agent 列表下拉（群组时显示）

- [x] **Step 3: Commit**

---

## Phase K: P3 — 打磨

### Task 24: 群组工作区编辑

**Files:**
- Modify: `gui-v2/src/components/group/GroupWorkspaceTab.tsx`
- Modify: `gui-v2/src/api/ws-server.ts`

- [x] **Step 1: 后端 `get_group_workspace` 命令**

- [x] **Step 2: 前端显示 Workspace 5 文档** (MEMBERS/STRUCTURE/TASK/PROGRESS/PLAN)

- [x] **Step 3: 文档编辑 + `write_agent_file` 式保存**

- [x] **Step 4: Commit**

---

### Task 25: 键盘快捷键

- [x] **Step 1**: Ctrl+1~5 视图切换
- [x] **Step 2**: Ctrl+N 新建 Agent/Group
- [x] **Step 3**: Escape 关闭详情面板
- [x] **Step 4: Commit**

---

### Task 26: 未读角标 + 通知

- [x] **Step 1**: 未读消息计数显示在 Sidebar 对话项
- [x] **Step 2**: NavBar 图标上显示总未读数
- [x] **Step 3**: Tauri 系统通知（新消息）
- [x] **Step 4: Commit**

---

## Spec 覆盖对照

| Spec 章节 | 已完成 | 待开发 |
|-----------|--------|--------|
| 2. Aurora 主题 | ✅ Task 2 | — |
| 3. 整体布局 | ✅ Task 3 | — |
| 4.1 对话消息流 | ✅ Task 5,6 | — |
| 4.2 群组协作视图 | — | 🔄 Task 19 |
| 4.3 输入区增强 | 部分 | 🔄 Task 23 |
| 5. Agent 视图 | ✅ 列表+详情 | 🔄 Task 16,17 |
| 5.2 Agent 文件浏览器 | — | 🔄 Task 17 |
| 6. 群组视图 | ✅ 列表+详情 | 🔄 Task 18,19 |
| 6.2 群组工作区 | — | 🔄 Task 24 |
| 7. 技能视图 | — | 🔄 Task 20 |
| 8. 设置视图 | ✅ Task 14 | — |
| 9. 对话框 | ✅ Task 8 | 🔄 Task 22 |
| 10. WS 协议 | ✅ 基础命令 | 🔄 Task 16-20 |
| 11. Tauri 集成 | ✅ Task 15 | — |
| 12. 状态管理 | ✅ Task 4 | — |
