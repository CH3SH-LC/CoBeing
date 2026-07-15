# 群组记忆系统设计

**日期**: 2026-04-25
**状态**: 已批准

## Context

当前群组上下文处理存在几个核心问题：
1. GroupContextV2 的消息无限增长，每次唤醒传给 LLM 的全量文本越来越长
2. 没有摘要/压缩机制，早期关键信息被淹没
3. 群组没有共享记忆，讨论结论无处沉淀
4. Agent 的 system prompt 在构造时冻结，文件更新不会实时生效
5. Agent 无法搜索群组历史

本设计通过引入 per-agent SQLite、current.md 滚动、实时 prompt 重建和历史搜索工具来解决这些问题。

## 目录结构

```
data/groups/{groupId}/
├── config.json              # 群组配置（已有）
├── context.jsonl            # 全量消息持久化（已有）
├── memory/
│   ├── current.md           # JSONL，最近 N 条可见消息（热上下文）
│   ├── {agentId-1}.db       # Agent 1 的 SQLite
│   ├── {agentId-2}.db       # Agent 2 的 SQLite
│   └── ...
├── TASK.md / PLAN.md / PROGRESS.md / STRUCTURE.md / MEMBERS.md
└── TODO.json
```

## 数据流

```
用户/群主 postMessage
  → GroupContextV2.append()              # 内存
  → GroupManager.appendContextMessage()  # context.jsonl 持久化
  → WakeSystem.handleNewMessage()
    → 检测 @mentions → 加入唤醒队列
    → processQueue()
      → 滚动 current.md（裁剪到最近 N 条）
      → 同步消息到被唤醒 Agent 的 SQLite
      → 读取 current.md 作为上下文
      → agent.run(context)
      → Agent 回复写回 GroupContextV2
      → 同步回复到所有可见 Agent 的 SQLite
```

## 1. Per-Agent SQLite

### 为什么每个 Agent 独立数据库

Talk 机制导致不同 Agent 看到的消息子集不同（main 全可见，talk 仅参与者可见）。每个 Agent 的 SQLite 存储的是该 Agent **可见的全量上下文**，在存储层保证 talk 隐私隔离。

### Schema

```sql
-- 该 Agent 可见的所有消息
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  msg_id TEXT NOT NULL UNIQUE,   -- GroupMessageV2.id
  tag TEXT NOT NULL,             -- "main" 或 "talk-001"
  from_agent_id TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp INTEGER NOT NULL
);

-- FTS5 全文搜索（CJK 分词预处理，复用 Intl.Segmenter 方案）
CREATE VIRTUAL TABLE messages_fts USING fts5(
  content,
  content='messages',
  content_rowid='id',
  tokenize='unicode61'
);

-- 重要片段
CREATE TABLE important_fragments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_msg_id TEXT,
  content TEXT NOT NULL,
  reason TEXT,
  timestamp INTEGER NOT NULL
);

CREATE VIRTUAL TABLE fragments_fts USING fts5(
  content,
  content='important_fragments',
  content_rowid='id',
  tokenize='unicode61'
);
```

### 同步逻辑

由 WakeSystem 本地代码执行（不经过 LLM）：
1. 从 `GroupContextV2.getVisibleMessages(agentId)` 获取该 Agent 可见的消息
2. 对比 SQLite 中已有 `msg_id`，只插入增量
3. 写入前对 content 做 CJK 分词预处理

### 新增文件

- `packages/core/src/group/agent-memory.ts` — `GroupAgentMemory` 类
  - `syncMessages(messages)` — 增量同步
  - `search(query, options)` — FTS5 搜索
  - `addFragment(content, reason, sourceMsgId?)` — 添加重要片段
  - `getRecentMessages(limit)` — 获取最近消息

## 2. current.md 滚动

### 格式

JSONL，每行一条消息（和 context.jsonl 一致）：

```jsonl
{"id":"msg-0001","tag":"main","fromAgentId":"owner","content":"...","timestamp":1745571200000}
```

### 滚动规则

WakeSystem 在每次 `executeWake()` 前执行：
1. 读取 current.md 所有行
2. 保留最后 `MAX_CURRENT_MESSAGES` 条（默认 100）
3. 回写 current.md
4. 追加新消息

### 上下文构建变化

WakeSystem 不再调用 `ctxV2.buildContextFor()` 传全量文本，改为读取 current.md 内容作为 `agent.run()` 的输入。

### 配置

```json
{
  "core": {
    "groupMemory": {
      "maxCurrentMessages": 100
    }
  }
}
```

### 新增文件

- `packages/core/src/group/current-md.ts` — `CurrentMd` 类
  - `append(message)` — 追加一条消息
  - `roll(maxMessages)` — 裁剪到最近 N 条
  - `read()` — 读取全部内容
  - `readAsContext()` — 格式化为 Agent 可读的上下文文本

## 3. 实时 System Prompt 重建

### 机制

ConversationLoopConfig 新增可选 `promptBuilder` 回调：

```typescript
interface ConversationLoopConfig {
  // ...existing...
  promptBuilder?: () => string;
}
```

ConversationLoop.run() 每次调用时：

```typescript
const systemPrompt = this.config.promptBuilder
  ? this.config.promptBuilder()
  : buildSystemPrompt(this.config.agentConfig);
```

### Agent 侧

Agent.createLoop() 统一传入 promptBuilder：

```typescript
private createLoop(toolExecutor, sessionId?, systemPrompt?, model?): ConversationLoop {
  return new ConversationLoop({
    // ...existing...
    promptBuilder: systemPrompt
      ? undefined  // 固定 prompt 的场景（如 butler）
      : () => buildSystemPromptFromFiles(
          this.files,
          { name: this.name, role: this.config.role, systemPrompt: this.config.systemPrompt },
          undefined,  // 不传 memoryStore，走文件读取路径，实现实时更新
        ),
  });
}
```

### 全局生效

Agent 的 promptBuilder 回调引用同一个 `this.files` 和 `this.memoryStore`，所以无论在 main 还是哪个群组，所有会话都使用最新文件内容。`handleIncomingMessage()` 中创建 sessionLoop 时也不传固定 systemPrompt，自动走 promptBuilder。

### 效果

- Agent 更新 EXPERIENCE.md 后，下一次 run() 立即使用新内容
- promptBuilder 不传 memoryStore，走 `buildSystemPromptFromFiles` 的文件读取路径，每次实时从磁盘读取
- 向后兼容：不传 promptBuilder 时行为不变

## 4. History Search Tool

### 工具定义

```typescript
{
  name: "group-memory-search",
  description: "搜索你在本群组中的历史消息和重要片段",
  parameters: {
    query: string,                   // 搜索关键词
    type?: "messages" | "fragments" | "all",  // 默认 "all"
    limit?: number,                  // 默认 10
  }
}
```

### 实现

- 读取 Agent 在该群组的 SQLite（`memory/{agentId}.db`）
- 使用 FTS5 全文搜索（CJK 预分词）
- 返回匹配的消息/片段，带时间戳和来源

### 注册时机

Agent 构造时注册，无群组上下文时返回提示信息。

### 新增文件

- `packages/core/src/tools/group-memory-search.ts` — 工具实现

## 5. 经验的跨群组复用

Agent 在群组中总结的经验写入**自己的文件夹**（`data/agents/{agentId}/EXPERIENCE.md`），而非群组目录。这样：
- 在群组 A 中获得的经验，群组 B 中也能用
- 通过实时 prompt 重建，更新后立即在所有会话中生效
- 群组的 per-agent SQLite 存原始上下文（可搜索），Agent 自己的 EXPERIENCE.md 存提炼后的经验（跨群组）

## 涉及修改的文件

| 文件 | 改动 |
|------|------|
| `group/wake-system.ts` | 新增 current.md 滚动 + SQLite 同步 |
| `group/group.ts` | 构造时创建 memory/ 目录，传入配置 |
| `group/group-context-v2.ts` | 新增 `getVisibleMessages(agentId)` |
| `group/manager.ts` | restoreGroups() 时初始化 memory/ |
| `conversation/conversation-loop.ts` | 新增 promptBuilder 回调 |
| `agent/agent.ts` | createLoop() 统一传入 promptBuilder |
| `config/schema.ts` | 新增 groupMemory 配置项 |
| **新建** `group/agent-memory.ts` | Per-Agent SQLite 管理 |
| **新建** `group/current-md.ts` | current.md 读写 + 滚动 |
| **新建** `tools/group-memory-search.ts` | 历史搜索工具 |

## 验证方式

1. 创建一个群组，添加 2+ Agent，发送消息验证 current.md 生成和滚动
2. 创建 talk，验证 per-agent SQLite 只包含可见消息
3. Agent 更新 EXPERIENCE.md，验证下一次 run() 的 system prompt 包含新内容
4. 使用 group-memory-search 工具搜索历史，验证 FTS5 中文搜索
5. 运行现有测试确保无回归
