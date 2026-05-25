# 群组三层记忆架构设计

> 日期: 2026-04-30
> 状态: 设计完成，待实现

## 问题背景

当前 WakeSystem 每次唤醒 Agent 时，将 current.md 全文（59KB+）作为上下文发送。Agent 的 ConversationLoop 跨调用累积这些上下文，导致：
1. 上下文溢出（100 条消息 × 59KB ≈ 5.9MB）
2. 历史不一致（失败调用留下孤立 user 消息）
3. 特定 Agent（被 @mention 最多的）最先崩溃

## 设计目标

将群组记忆分为三层，Agent 唤醒时发送**压缩历史 + 近期未压缩原文**，而非全量累积。

## 三层架构

### 第一层：原文层级（Raw）

**存储结构：**

```
data/groups/{groupId}/memory/
├── group.db              ← 主 DB（全量消息 + 可见性表）
├── {agentId}.db          ← Agent 从 DB（过滤后消息 + FTS5）
└── current.md            ← 前端可视化（200 条，不再作为 Agent 上下文来源）
```

**主 DB (`group.db`) Schema：**

```sql
CREATE TABLE messages (
  id INTEGER PRIMARY KEY,
  msg_id TEXT UNIQUE NOT NULL,
  tag TEXT NOT NULL,           -- "main" 或 "talk-001"
  from_agent_id TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp INTEGER NOT NULL
);

CREATE TABLE visibility (
  msg_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  PRIMARY KEY (msg_id, agent_id)
);

CREATE TABLE compression_marks (
  agent_id TEXT PRIMARY KEY,
  compressed_until INTEGER NOT NULL,  -- 时间戳：此时间之前的消息已被压缩
  updated_at INTEGER NOT NULL
);
```

**可见性规则（写入主 DB 时计算）：**
- `main` 消息：所有群组成员可见
- `talk-xxx` 消息：只有 talk 成员可见
- `system` 消息（如 BOOTSTRAP 注入）：所有成员可见

**Agent 从 DB (`{agentId}.db`)：**
- 保持现有结构（messages + FTS5 + important_fragments）
- 数据来源从"独立写入"改为"从主 DB 按 visibility 过滤同步"
- 同步时机：消息写入主 DB 后立即同步到可见的 Agent 从 DB
- 用于 Agent 的 FTS5 搜索功能

**current.md：**
- 降级为前端 GUI 可视化用途
- 保留最近 200 条消息
- 不再作为 Agent 上下文来源

### 第二层：抽象层级（Abstract）

**群组公共文件（群主维护）：**

| 文件 | 内容 | 维护者 |
|------|------|--------|
| PROGRESS.md | 进度、里程碑、阻塞问题 | 群主 |
| TASK.md | 当前任务描述 | 群主 |
| PLAN.md | 任务分工和计划 | 群主 |
| EXPERIENCE.md | 群组公共协作经验 | 群主/Agent |
| MEMBERS.md | 成员列表和职责 | 系统 |
| STRUCTURE.md | 项目结构 | 群主/Agent |

**Agent 个人文件：**

| 文件 | 内容 | 维护者 |
|------|------|--------|
| {agentId}/EXPERIENCE.md | 个人领域经验 | Agent |
| {agentId}/SOUL.md | 性格特质 | Agent |
| {agentId}/JOB.md | 专长领域 | Agent |

**成员画像（运行时构建）：**
- 从 MEMBERS.md + JOB.md + SOUL.md 构建
- 包含：姓名、角色、能力、性格风格

### 第三层：压缩层级（Compressed）

**存储结构：**

```
data/groups/{groupId}/memory/
└── {agentId}-compressed.md  ← Agent 独立的压缩历史
```

**文件格式：**

```markdown
# 压缩历史 — {agentName}

> 截至 2026-04-30T15:00:00 的历史已总结

## 阶段 1：项目启动（04-26 ~ 04-27）
群主分配任务，策划师出设计文档，前端和逻辑工程师确认分工。

## 阶段 2：基础架构（04-27 ~ 04-29）
前端搭建 Canvas 渲染框架，逻辑层实现游戏状态机和寻路系统。
```

**压缩触发：Agent 主动调用 `summarize-phase` 工具**

> **如何确保 Agent 知晓何时调用：** 在 Agent 的 system prompt 中加入一条指令——
> "完成一个阶段性任务（如实现一个完整功能、修复一个重要 bug）后，调用 summarize-phase 工具总结这一阶段的工作，压缩旧历史。" 此指令应放在 group 上下文的 system prompt 中，随 abstract layer 一起注入。

```typescript
{
  name: "summarize-phase",
  description: "总结当前阶段的工作，压缩历史。完成一个阶段性任务后调用。",
  parameters: {
    summary: string,        // 阶段摘要（2-5 句话）
    phaseTitle: string,     // 阶段标题
    untilTimestamp: number  // 压缩截止时间戳
  }
}
```

**压缩流程：**
1. Agent 调用 `summarize-phase(summary, phaseTitle, untilTimestamp)`
2. 系统追加摘要到 `{agentId}-compressed.md`
3. 更新主 DB `compression_marks` 表
4. 物理清理 Agent 从 DB 中已压缩的旧消息（`DELETE FROM messages WHERE timestamp <= compressed_until - KEEP_AFTER_MS`），保留最近 10 条消息不被清理

**物理清理策略：**
- 清理时机：每次 `summarize-phase` 调用后触发
- 清理范围：`timestamp <= compressed_until - KEEP_AFTER_MS`（`KEEP_AFTER_MS = 3600000`，即保留压缩时间点前 1 小时内的消息作为缓冲）
- 保留最近 10 条消息（无论时间戳），防止边界情况
- 从 Agent 从 DB 中删除，主 DB 始终保留全量数据

**防误压缩：**
- `untilTimestamp` 必须 <= 最新消息的时间戳
- 压缩后保留最近 10 条消息不被清理

## 上下文构建流程

**Agent 被唤醒时，WakeSystem 构建上下文：**

```
上下文 = 抽象层 + 压缩历史 + 未压缩原文 + 触发消息

1. 抽象层（固定，每次相同）
   ├── PROGRESS.md, TASK.md, PLAN.md
   ├── 成员画像
   ├── 公共经验 + 个人经验
   └── TODO 列表

2. 压缩历史（从 {agentId}-compressed.md 读取）

3. 未压缩原文（从 Agent 从 DB 查询）
   └── SELECT * FROM messages WHERE timestamp > compressed_until
       ORDER BY timestamp DESC LIMIT 200

4. 触发消息（本次 @mention 的原始内容）
```

**ConversationLoop 改造：**
- 不再跨调用累积历史
- 每次唤醒重新构建完整上下文
- Agent 回复后清空 history
- system prompt 包含抽象层 + 压缩历史
- 未压缩原文 + 触发消息作为 user message

## 消息写入流程

```
用户/Agent 发消息
  → GroupContextV2.append()              ← 内存（实时处理）
  → GroupManager.appendContextMessage()  ← context.jsonl（持久化备份）
  → 主 DB INSERT messages + visibility   ← 全量存储 + 可见性
  → Agent 从 DB syncMessages()           ← 过滤同步
  → currentMd.append()                   ← 前端可视化（200 条）
  → WakeSystem 触发 @mention 处理
```

## 数据生命周期

| 数据 | 写入时机 | 清理策略 | 用途 |
|------|----------|----------|------|
| GroupContextV2 内存 | 实时 | 启动时从 context.jsonl 恢复 | 实时处理 |
| context.jsonl | 实时 | 不清理 | 启动恢复 |
| 主 DB messages | 实时 | 不清理 | 统一数据源 |
| 主 DB visibility | 实时 | 随消息 | Agent 过滤 |
| Agent 从 DB | 同步 | 压缩后物理清理（保留 1h 缓冲 + 最近 10 条） | FTS5 搜索 |
| current.md | 实时 | roll 到 200 条 | GUI 显示 |
| {agent}-compressed.md | 压缩时 | 不清理 | 上下文构建 |
| 抽象层文件 | 更新时 | 不清理 | 上下文构建 |

## 文件变更清单

### 新增文件
- `packages/core/src/group/group-db.ts` — 主 DB 管理（messages + visibility + compression_marks）
- `packages/core/src/group/compressed-history.ts` — 压缩历史管理
- `packages/core/src/tools/summarize-phase.ts` — summarize-phase 工具

### 修改文件
- `packages/core/src/group/agent-memory.ts` — 改为从主 DB 同步
- `packages/core/src/group/wake-system.ts` — 重写上下文构建逻辑
- `packages/core/src/group/group.ts` — 集成 GroupDB
- `packages/core/src/group/manager.ts` — 消息写入主 DB
- `packages/core/src/agent/agent.ts` — ConversationLoop 改造
- `packages/core/src/conversation/conversation-loop.ts` — 支持每次清空 history
- `packages/core/src/conversation/prompt-builder.ts` — 上下文构建适配
- `gui-v2/src/hooks/useWebSocket.ts` — 前端适配（如需要）

### 保留不变
- `packages/core/src/group/group-context-v2.ts` — 保留（实时处理需要）
- `packages/core/src/group/current-md.ts` — 保留（降级为 GUI 用途）
- `packages/core/src/group/workspace.ts` — 保留（抽象层文件管理）
