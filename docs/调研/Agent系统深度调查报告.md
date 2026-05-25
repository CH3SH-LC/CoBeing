# Agent 系统深度调查报告

> 调查日期: 2026-05-07

## 1. 架构总览

### 核心类层次

```
Agent (agent.ts)                    ← 所有 Agent 的基类
  └── ButlerAgent (butler.ts)       ← 管家，拥有创建/管理 Agent 和群组的特权工具
```

### 支撑组件

| 组件 | 文件 | 职责 |
|------|------|------|
| AgentRegistry | `agent/registry.ts` | 全局 Agent 注册表（`Map<id, Agent>`），register/unregister/get/list |
| AgentEventBus | `agent/event-bus.ts` | Agent 间 @mention/私信 事件路由，支持 @all 广播 |
| SubAgentSpawner | `agent/spawner.ts` | 父 Agent 动态创建临时子 Agent，含 spawnForJSON 模式 |
| AgentPaths | `agent/paths.ts` | 管理 Agent 独立目录下的所有文件路径 |
| AgentFiles | `agent/paths.ts` | 类型化文件读写（读写 CHARACTER/JOB/SOUL 等 11 个核心文件） |

---

## 2. Agent 创建链路（5 条路径）

| 路径 | 代码位置 | 说明 |
|------|---------|------|
| **ButlerAgent** | `runtime.ts:107-124` | 硬编码，始终创建 |
| **butler-create-agent 工具** | `butler.ts:29-280` | Butler 通过 LLM 调用创建 |
| **WS create_agent** | `ws-server.ts` | GUI 前端创建 |
| **restoreAgents()** | `runtime.ts:207-264` | 启动时从 ButlerRegistry 恢复 |
| **registerPrebuiltAgents()** | `runtime.ts:614-681` | 启动时从 config.agents 恢复（host 等） |
| **SubAgentSpawner** | `spawner.ts` | 父 Agent 动态创建临时子 Agent |

### 创建流程细节（butler-create-agent）

1. 检查名称冲突 → 检查 Docker 可用性 → 构建 AgentConfig
2. 写入 `config.json` → 区分已传入/缺失的核心文件
3. 缺失文件由 SubAgentSpawner (spawnForJSON) 自动生成
4. 合并后写入磁盘 → 从 `config/templates/` 复制模板文件
5. 在 AgentRegistry 和 ButlerRegistry 中注册

---

## 3. 工具注册层次

### 3.1 工具总数：53 个已注册工具

#### 基础层（Agent 构造函数注册，共 17 个）

**受白名单控制（8 个 BUILTIN_TOOLS）：**
`bash`, `read-file`, `write-file`, `edit-file`, `glob`, `grep`, `web-fetch`, `agent-message`

> 只有写入 `config.json` 的 `tools` 数组中的才会被注册。

**无条件注册（Agent 构造函数中始终注册，9 个）：**
`memory` (MemoryStore 统一工具), `experience-reflect`, `todo-add`, `todo-list`, `todo-complete`, `todo-remove`, `current-time`, `group-memory-search`, `summarize-phase`

#### 注入层（构造后通过 `injectXxx()` 注入，7 个）

| 注入方法 | 注册的工具 | 调用时机 |
|----------|-----------|---------|
| `injectSkillRepository()` | `skill-execute`, `skill-list`, `skill-create` | 构造后立即调用 |
| `injectGroupTools()` | `group-members`, `talk-create`, `talk-send`, `talk-read` | 构造后 + 加入群组时 |

#### 特权层

**ButlerAgent 专属（15 个，覆盖基础层）：**
`butler-create-agent`, `butler-destroy-agent`, `butler-create-group`, `butler-destroy-group`, `butler-list`, `butler-run-group`, `butler-add-to-group`, `butler-read-registry`, `butler-update-registry`, `butler-analyze-task`, `channel-bind`, `channel-unbind`, `workflow-analyze`, `workflow-plan` + 群组工具 + TODO 工具（带群组 TodoStore）

**Host/群主专属（10 个）：**
`group-plan`, `group-invite-talk`, `group-summarize`, `group-assign-task`, `host-guide-discussion`, `host-decompose-task`, `host-summarize-progress`, `host-record-decision`, `host-manage-todo`, `host-review-todo`

### 3.2 工具注入点（共 6 处）

| 注入点 | 代码位置 | 注入内容 |
|--------|---------|---------|
| ButlerAgent 构造 | `butler.ts:735-741` | 群组通信工具 |
| butler-create-group | `butler.ts:328-333` | 为初始成员注入群组工具 |
| butler-add-to-group | `butler.ts:437-439` | 为新成员注入群组工具 |
| runtime.restoreAgents | `runtime.ts:256` | Skill 工具（**缺少群组工具注入**） |
| runtime.registerPrebuiltAgents | `runtime.ts:660-662` | Skill 工具 + 群组工具 |
| WS create_agent | `ws-server.ts:571-574` | Skill 工具 + 群组工具 |
| WS create_group | `ws-server.ts:626` | 为初始成员注入群组工具 |
| WS add_group_member | `ws-server.ts:887` | 为新成员注入群组工具 |

---

## 4. Agent 生命周期

### 4.1 完整生命周期

```
构造 → injectSkillRepository → injectGroupTools → subscribeToBus
  → registry.register → [connectMCPServer] → run() / handleIncomingMessage()
  → [sandbox.destroy] → memoryStore.close → dispose()
```

### 4.2 启动时序 (`runtime.ts:start()`)

```
 1. 检查 Docker 可用性
 2. buildProviders() — 构建 LLM Provider
 3. 创建 ButlerAgent（构造函数中注入所有工具）
 4. butler.injectSkillRepository()
 5. wsServer.registerAgent(butler)
 6. restoreAgents() — 从 ButlerRegistry 恢复持久化 Agent
 7. registerPrebuiltAgents() — host + config.agents
 8. connectAllMCPServers() — 连接 MCP 到所有 Agent
 9. restoreGroups() — 恢复群组（WakeSystem 暂停中）
10. wsServer.start() — 启动 WebSocket
11. resumeAllWakeSystems() — 恢复群组唤醒
12. broadcastState() — 广播完整状态到 GUI
13. startChannels() — 启动外部 Channel
14. TODO Scanner 启动
```

---

## 5. 关键架构模式

### 5.1 Tool Injection + Loop Rebuild 模式

```typescript
injectXxx() {
  toolRegistry.register(tool1)
  toolRegistry.register(tool2)
  // 重建 ConversationLoop 以包含新工具定义
  conversationLoop = createLoop(newToolExecutor)
}
```

**问题**：6 个注入点各自独立调用，有些地方重复重建 ConversationLoop。

### 5.2 群组隔离 ConversationLoop

```typescript
// RunOptions 接口将群组上下文从 Agent 属性降级为运行时参数
run(input, { groupId, groupContext, events })

// 群组调用使用独立 key 的 ConversationLoop
sessionLoops.set(`group:${groupId}`, loop)

// 每次群组唤醒前清空历史（由 WakeSystem 完整重建上下文）
loop.clearHistory()
```

### 5.3 三层 Prompt 构建

```
sharedPrefix (跨 Agent 缓存) + agentPrefix (跨请求缓存) + volatile (动态群组上下文)
```

- **sharedPrefix**: 所有 Agent 完全相同的部分（工具列表等），确保跨 Agent 缓存命中
- **agentPrefix**: Agent 生命周期内冻结一次（角色/能力描述），确保跨请求前缀一致
- **volatile**: 每轮动态构建（SOUL.md, JOB.md, BOOTSTRAP.md, 群组上下文）

### 5.4 Agent 文件系统

```
data/agents/{agentId}/
├── config.json          ← 自治配置（provider, model, tools, sandbox...）
├── SOUL.md              ← AI 人格/行为准则
├── CHARACTER.md         ← 角色人物描写
├── JOB.md               ← 专注领域/能力
├── USER.md              ← 用户信息
├── AGENTS.md            ← 自我描述
├── TOOLS.md             ← 工具文档
├── MEMORY.md            ← 记忆索引
├── EXPERIENCE.md        ← 经验积累
├── BOOTSTRAP.md         ← 出生时已知的关键知识（不会被删除）
├── memory.db            ← SQLite 记忆库（MemoryStore）
├── memory/              ← 旧版记忆文件
├── workspace/           ← Agent 工作目录
└── skills/              ← Agent 专属技能
```

### 5.5 Agent 间通信

```
Agent A                     AgentEventBus                Agent B
   │                             │                          │
   ├─ agent-message tool ──→     │                          │
   │                             ├─ "agent-direct" ───────→ │
   │                             │  → agent.run(prompt)     │
   │                             │                          │
   │                             ├─ "group-message" ───────→ │ (群组 @mention)
   │                             │  → agent.run(prompt)     │
   │                             │                          │
   │                             ├─ "task-complete" ───────→ │ → 反思处理器
```

---

## 6. 发现的问题与潜在风险

### 6.1 [Bug] `restoreAgents` 默认工具缺失

**位置**: `runtime.ts:248`

```typescript
tools: selfConfig.tools || ["bash", "read-file", "write-file", "glob", "grep", "web-fetch"],
```

缺少 `edit-file` 和 `agent-message`，与 `butler.ts:156` 和 `ws-server.ts:538` 的默认列表不一致。

### 6.2 [Bug] `restoreAgents` 未注入群组通信工具

**位置**: `runtime.ts:207-264`

`restoreAgents()` 创建 Agent 后调用了 `agent.injectSkillRepository()` 但**没有调用** `agent.injectGroupTools()`。对比 `registerPrebuiltAgents` 第 662 行有正确调用。

**影响**：从 ButlerRegistry 恢复的 Agent（通过 butler GUI 创建的）在重启后缺少 `group-members`/`talk-create`/`talk-send`/`talk-read` 四个群组通信工具，无法参与群组协作。

### 6.3 [性能] ConversationLoop 重建开销

每次 `injectXxx()` 都重建完整的 ConversationLoop（PermissionEnforcer + ToolExecutor + ConversationLoop），6 个注入点产生大量冗余对象分配。可优化为延迟重建或批量注入后统一重建。

### 6.4 [设计] SubAgentSpawner 子 Agent 能力受限

`spawnForJSON()` 创建的子 Agent（用于生成 Agent 核心文件）工具列表为 `[]`、未注册到 Registry、未注入 Skill/群组工具。这目前符合临时用途，但如果未来需要子 Agent 具备能力则需要改造。

### 6.5 [设计] Agent-message 全局单例注册表

`agent-message.ts` 使用模块级 `_registry` 变量（通过 `setAgentRegistry()` 设置），如果未来有多个 Runtime 实例会冲突。

### 6.6 [冗余] ButlerAgent 的 TODO 工具重复注册

`ButlerAgent` 构造函数重新注册了 TODO 工具（`butler.ts:748-754`），这些工具已在父类 `Agent` 构造函数中注册（`agent.ts:174-182`）。两者功能相同（都指向同一个 GroupManager），产生不必要的覆盖。

---

## 7. Agent 能力矩阵

| 能力 | Butler | Host | 普通 Agent | 子 Agent |
|------|--------|------|-----------|---------|
| 文件操作 (bash/read/write/edit/glob/grep) | ✅ | ✅ | ✅ (白名单) | ✅ (继承) |
| Web 访问 (web-fetch) | ✅ | ✅ | ✅ (白名单) | ✅ (继承) |
| Agent 间通信 (agent-message) | ✅ | ✅ | ✅ (白名单) | ❌ |
| 记忆系统 (memory) | ✅ | ✅ | ✅ | ❌ |
| 经验反思 (experience-reflect) | ✅ | ✅ | ✅ | ❌ |
| TODO 管理 | ✅ | ✅ | ✅ | ❌ |
| 群组通信 (group-members/talk-*) | ✅ | ✅ | ✅ (注入后) | ❌ |
| 技能执行 (skill-execute/list/create) | ✅ | ✅ | ✅ (注入后) | ❌ |
| 群组记忆搜索 | ✅ | ✅ | ✅ | ❌ |
| 阶段总结 (summarize-phase) | ✅ | ✅ | ✅ | ❌ |
| 创建/销毁 Agent | ✅ | ❌ | ❌ | ❌ |
| 创建/销毁群组 | ✅ | ❌ | ❌ | ❌ |
| 管理 Agent 注册表 | ✅ | ❌ | ❌ | ❌ |
| 任务分析 (butler-analyze-task) | ✅ | ❌ | ❌ | ❌ |
| 工作流 (workflow-analyze/plan) | ✅ | ❌ | ❌ | ❌ |
| Channel 绑定 | ✅ | ❌ | ❌ | ❌ |
| 群主协调 (group-plan/summarize/assign) | ❌ | ✅ | ❌ | ❌ |
| 群主增强 (host-guide/decompose/record) | ❌ | ✅ | ❌ | ❌ |
| MCP 连接 | ✅ | ✅ | ✅ | ❌ |
| Docker 沙箱 | ✅ | ✅ | ✅ (config) | ❌ |

---

## 8. 总结

### 当前状态

- **53 个工具**，分 3 层（基础 17 / 注入 7 / 特权 29）
- **5 条创建路径**，覆盖硬编码/LLM/GUI/恢复/子Agent
- **Group-aware ConversationLoop** 隔离机制
- **三层 Prompt 缓存**架构
- **11 个核心文件** + 4 个子目录的 Agent 文件系统

### 需要关注的问题

| 优先级 | 问题 | 影响范围 |
|--------|------|---------|
| **P0** | `restoreAgents()` 缺少 `injectGroupTools()` 调用 | 从注册恢复的 Agent 无法参与群组通信 |
| **P0** | `restoreAgents()` 默认工具列表缺少 `edit-file` 和 `agent-message` | 恢复的 Agent 缺少编辑和通信能力 |
| P1 | ConversationLoop 重复重建 | 6 个注入点冗余创建对象 |
| P2 | ButlerAgent TODO 工具重复注册 | 不必要的覆盖 |
| P2 | Agent-message 全局单例 | 多 Runtime 冲突风险 |
| P3 | SubAgentSpawner 能力受限 | 子 Agent 无工具 |
