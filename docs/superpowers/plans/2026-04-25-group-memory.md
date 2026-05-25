# 群组记忆系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为群组引入 per-agent SQLite 持久化、current.md 热上下文滚动、实时 system prompt 重建和历史搜索工具。

**Architecture:** WakeSystem 在每次唤醒 Agent 前滚动 current.md 并同步消息到 per-agent SQLite。Agent 的 system prompt 通过 promptBuilder 回调每次 run() 时实时从文件构建。Agent 通过 group-memory-search 工具搜索自己的群组历史。

**Tech Stack:** TypeScript, better-sqlite3, FTS5, Intl.Segmenter (CJK)

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `packages/core/src/config/schema.ts` | 修改 | 新增 `groupMemory` 配置项 |
| `packages/core/src/group/group-context-v2.ts` | 修改 | 新增 `getVisibleMessages(agentId)` |
| `packages/core/src/group/agent-memory.ts` | **新建** | Per-Agent SQLite 管理 |
| `packages/core/src/group/current-md.ts` | **新建** | current.md 读写 + 滚动 |
| `packages/core/src/conversation/conversation-loop.ts` | 修改 | 新增 `promptBuilder` 回调 |
| `packages/core/src/agent/agent.ts` | 修改 | `createLoop()` 传入 promptBuilder |
| `packages/core/src/tools/group-memory-search.ts` | **新建** | 历史搜索工具 |
| `packages/core/src/group/wake-system.ts` | 修改 | 集成 current.md + SQLite 同步 |
| `packages/core/src/group/group.ts` | 修改 | 创建 memory/ 目录，传入配置 |
| `packages/core/src/group/manager.ts` | 修改 | restoreGroups() 初始化 memory/ |

---

### Task 1: Config schema — 新增 groupMemory 配置

**Files:**
- Modify: `packages/core/src/config/schema.ts`

- [ ] **Step 1: 在 AppConfig.core 中新增 groupMemory**

在 `core` 接口的 `maxToolRounds` 后面添加：

```typescript
/** 群组记忆系统配置 */
groupMemory?: {
  /** current.md 最大消息条数，默认 100 */
  maxCurrentMessages?: number;
};
```

- [ ] **Step 2: 验证类型编译通过**

```bash
cd D:/agent-codes/cobeing && npx tsc --noEmit -p packages/core/tsconfig.json
```

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/config/schema.ts
git commit -m "feat: add groupMemory config to AppConfig schema"
```

---

### Task 2: GroupContextV2 — 新增 getVisibleMessages

**Files:**
- Modify: `packages/core/src/group/group-context-v2.ts`
- Test: `packages/core/src/group/context.test.ts`

- [ ] **Step 1: 写测试**

在 `context.test.ts` 末尾添加新的 describe 块：

```typescript
describe("getVisibleMessages", () => {
  it("returns all main messages for any agent", () => {
    const ctx = new GroupContextV2("test-group");
    ctx.append("agent-1", "hello", "main");
    ctx.append("agent-2", "world", "main");

    const visible = ctx.getVisibleMessages("agent-3");
    expect(visible).toHaveLength(2);
    expect(visible[0].content).toBe("hello");
  });

  it("includes talk messages only for members", () => {
    const ctx = new GroupContextV2("test-group");
    ctx.append("agent-1", "main msg", "main");
    const talkId = ctx.createTalk(["agent-1", "agent-2"], "topic");
    ctx.append("agent-1", "talk msg", talkId);

    // agent-3 不在 talk 中，只能看到 main
    const visible3 = ctx.getVisibleMessages("agent-3");
    expect(visible3).toHaveLength(1);
    expect(visible3[0].tag).toBe("main");

    // agent-1 在 talk 中，能看到两条
    const visible1 = ctx.getVisibleMessages("agent-1");
    expect(visible1).toHaveLength(2);
  });

  it("supports sinceIndex for incremental sync", () => {
    const ctx = new GroupContextV2("test-group");
    ctx.append("agent-1", "msg1", "main");
    ctx.append("agent-1", "msg2", "main");
    ctx.append("agent-1", "msg3", "main");

    const visible = ctx.getVisibleMessages("agent-2", 1);
    expect(visible).toHaveLength(2);
    expect(visible[0].content).toBe("msg2");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd D:/agent-codes/cobeing && npx vitest run packages/core/src/group/context.test.ts
```

- [ ] **Step 3: 实现 getVisibleMessages**

在 `GroupContextV2` 类中添加方法（在 `getPendingMentions` 之后）：

```typescript
/** 获取指定 Agent 可见的消息（main + 参与的 talk） */
getVisibleMessages(agentId: string, sinceIndex: number = 0): GroupMessageV2[] {
  const agentTalks = new Set(this.getAgentTalks(agentId));
  return this.messages.slice(sinceIndex).filter(msg => {
    if (msg.tag === "main") return true;
    return agentTalks.has(msg.tag);
  });
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd D:/agent-codes/cobeing && npx vitest run packages/core/src/group/context.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/group/group-context-v2.ts packages/core/src/group/context.test.ts
git commit -m "feat: add getVisibleMessages to GroupContextV2"
```

---

### Task 3: GroupAgentMemory — Per-Agent SQLite 管理

**Files:**
- Create: `packages/core/src/group/agent-memory.ts`
- Create: `packages/core/src/group/agent-memory.test.ts`

- [ ] **Step 1: 写测试**

```typescript
// packages/core/src/group/agent-memory.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { GroupAgentMemory } from "./agent-memory.js";

describe("GroupAgentMemory", () => {
  let tmpDir: string;
  let mem: GroupAgentMemory;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-mem-test-"));
    mem = new GroupAgentMemory("agent-1", tmpDir);
  });

  afterEach(() => {
    mem.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("syncs messages incrementally", () => {
    mem.syncMessages([
      { msgId: "msg-0001", tag: "main", fromAgentId: "owner", content: "hello", timestamp: 1000 },
      { msgId: "msg-0002", tag: "main", fromAgentId: "agent-2", content: "world", timestamp: 2001 },
    ]);
    expect(mem.getMessageCount()).toBe(2);

    // 再次同步，应该跳过已有的
    mem.syncMessages([
      { msgId: "msg-0001", tag: "main", fromAgentId: "owner", content: "hello", timestamp: 1000 },
      { msgId: "msg-0002", tag: "main", fromAgentId: "agent-2", content: "world", timestamp: 2001 },
      { msgId: "msg-0003", tag: "main", fromAgentId: "owner", content: "new", timestamp: 3000 },
    ]);
    expect(mem.getMessageCount()).toBe(3);
  });

  it("searches messages with FTS5", () => {
    mem.syncMessages([
      { msgId: "msg-0001", tag: "main", fromAgentId: "owner", content: "使用 SQLite 存储方案", timestamp: 1000 },
      { msgId: "msg-0002", tag: "main", fromAgentId: "agent-2", content: "React 组件设计", timestamp: 2001 },
    ]);

    const results = mem.search("SQLite");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].content).toContain("SQLite");
  });

  it("adds and searches fragments", () => {
    mem.addFragment("关键决策：使用 better-sqlite3", "架构决策", "msg-0001");
    const results = mem.searchFragments("better-sqlite3");
    expect(results).toHaveLength(1);
    expect(results[0].reason).toBe("架构决策");
  });

  it("gets recent messages", () => {
    for (let i = 0; i < 10; i++) {
      mem.syncMessages([{ msgId: `msg-${i}`, tag: "main", fromAgentId: "a", content: `msg ${i}`, timestamp: i }]);
    }
    const recent = mem.getRecentMessages(3);
    expect(recent).toHaveLength(3);
    expect(recent[0].content).toBe("msg 7");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd D:/agent-codes/cobeing && npx vitest run packages/core/src/group/agent-memory.test.ts
```

- [ ] **Step 3: 实现 GroupAgentMemory**

```typescript
// packages/core/src/group/agent-memory.ts
/**
 * GroupAgentMemory — 群组内单个 Agent 的 SQLite 持久化
 *
 * 存储该 Agent 可见的全量消息 + 重要片段，支持 FTS5 搜索。
 * 由 WakeSystem 自动同步，不经过 LLM。
 */
import Database, { type Database as BetterSqlite3Database } from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { createLogger } from "@cobeing/shared";

const log = createLogger("group-agent-memory");

// ─── CJK 分词（复用 sqlite-adapter 方案） ───
const segmenter = new Intl.Segmenter("zh-CN", { granularity: "word" });

function tokenizeFTS(text: string): string {
  if (!text) return text;
  return [...segmenter.segment(text)]
    .filter(s => s.isWordLike)
    .map(s => s.segment)
    .join(" ");
}

function buildMatchExpr(query: string): string {
  return tokenizeFTS(query)
    .split(/\s+/)
    .filter(t => t.length > 0)
    .map(t => `"${t.replace(/"/g, '""')}"`)
    .join(" ");
}

export interface AgentMessage {
  msgId: string;
  tag: string;
  fromAgentId: string;
  content: string;
  timestamp: number;
}

export interface AgentFragment {
  id: number;
  sourceMsgId: string | null;
  content: string;
  reason: string | null;
  timestamp: number;
}

export class GroupAgentMemory {
  readonly agentId: string;
  private db: BetterSqlite3Database;
  private hasFts5: boolean;

  constructor(agentId: string, memoryDir: string) {
    this.agentId = agentId;
    fs.mkdirSync(memoryDir, { recursive: true });

    const dbPath = path.join(memoryDir, `${agentId}.db`);
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.hasFts5 = this.initTables();
  }

  private initTables(): boolean {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        msg_id TEXT NOT NULL UNIQUE,
        tag TEXT NOT NULL,
        from_agent_id TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      );
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS important_fragments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_msg_id TEXT,
        content TEXT NOT NULL,
        reason TEXT,
        timestamp INTEGER NOT NULL
      );
    `);

    let fts5 = false;
    try {
      this.db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(content);`);
      this.db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS fragments_fts USING fts5(content);`);
      fts5 = true;
    } catch {
      log.warn("FTS5 not available for agent %s, falling back to LIKE", this.agentId);
    }
    return fts5;
  }

  /** 增量同步消息（跳过已有的 msg_id） */
  syncMessages(messages: AgentMessage[]): void {
    const insert = this.db.prepare(
      "INSERT OR IGNORE INTO messages (msg_id, tag, from_agent_id, content, timestamp) VALUES (?, ?, ?, ?, ?)"
    );
    const insertFts = this.hasFts5
      ? this.db.prepare("INSERT INTO messages_fts(rowid, content) VALUES (?, ?)")
      : null;

    this.db.transaction(() => {
      for (const msg of messages) {
        const info = insert.run(msg.msgId, msg.tag, msg.fromAgentId, msg.content, msg.timestamp);
        if (insertFts && info.changes > 0) {
          insertFts.run(Number(info.lastInsertRowid), tokenizeFTS(msg.content));
        }
      }
    })();
  }

  /** FTS5 搜索消息 */
  search(query: string, limit = 10): AgentMessage[] {
    if (this.hasFts5) {
      try {
        const matchExpr = buildMatchExpr(query);
        return this.db.prepare(
          `SELECT m.* FROM messages m
           JOIN messages_fts fts ON m.id = fts.rowid
           WHERE messages_fts MATCH ?
           ORDER BY rank LIMIT ?`
        ).all(matchExpr, limit) as AgentMessage[];
      } catch { /* 降级 */ }
    }
    return this.db.prepare(
      "SELECT * FROM messages WHERE content LIKE ? ORDER BY timestamp DESC LIMIT ?"
    ).all(`%${query}%`, limit) as AgentMessage[];
  }

  /** 添加重要片段 */
  addFragment(content: string, reason?: string, sourceMsgId?: string): void {
    const info = this.db.prepare(
      "INSERT INTO important_fragments (source_msg_id, content, reason, timestamp) VALUES (?, ?, ?, ?)"
    ).run(sourceMsgId ?? null, content, reason ?? null, Date.now());

    if (this.hasFts5) {
      this.db.prepare("INSERT INTO fragments_fts(rowid, content) VALUES (?, ?)").run(
        Number(info.lastInsertRowid), tokenizeFTS(content)
      );
    }
  }

  /** FTS5 搜索重要片段 */
  searchFragments(query: string, limit = 10): AgentFragment[] {
    if (this.hasFts5) {
      try {
        const matchExpr = buildMatchExpr(query);
        return this.db.prepare(
          `SELECT f.* FROM important_fragments f
           JOIN fragments_fts fts ON f.id = fts.rowid
           WHERE fragments_fts MATCH ?
           ORDER BY rank LIMIT ?`
        ).all(matchExpr, limit) as AgentFragment[];
      } catch { /* 降级 */ }
    }
    return this.db.prepare(
      "SELECT * FROM important_fragments WHERE content LIKE ? ORDER BY timestamp DESC LIMIT ?"
    ).all(`%${query}%`, limit) as AgentFragment[];
  }

  /** 获取最近 N 条消息 */
  getRecentMessages(limit = 20): AgentMessage[] {
    return this.db.prepare(
      "SELECT * FROM messages ORDER BY timestamp DESC LIMIT ?"
    ).all(limit) as AgentMessage[];
  }

  /** 消息总数 */
  getMessageCount(): number {
    const row = this.db.prepare("SELECT COUNT(*) as cnt FROM messages").get() as { cnt: number };
    return row.cnt;
  }

  /** 关闭数据库 */
  close(): void {
    try { this.db.close(); } catch { /* ignore */ }
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd D:/agent-codes/cobeing && npx vitest run packages/core/src/group/agent-memory.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/group/agent-memory.ts packages/core/src/group/agent-memory.test.ts
git commit -m "feat: add GroupAgentMemory for per-agent SQLite in groups"
```

---

### Task 4: CurrentMd — current.md 读写 + 滚动

**Files:**
- Create: `packages/core/src/group/current-md.ts`
- Create: `packages/core/src/group/current-md.test.ts`

- [ ] **Step 1: 写测试**

```typescript
// packages/core/src/group/current-md.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { CurrentMd } from "./current-md.js";

describe("CurrentMd", () => {
  let tmpDir: string;
  let current: CurrentMd;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "current-md-test-"));
    current = new CurrentMd(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("appends and reads messages", () => {
    current.append({ id: "msg-1", tag: "main", fromAgentId: "a", content: "hello", timestamp: 1000 });
    current.append({ id: "msg-2", tag: "main", fromAgentId: "b", content: "world", timestamp: 2001 });

    const lines = current.read();
    expect(lines).toHaveLength(2);
    expect(lines[0].content).toBe("hello");
  });

  it("rolls to keep last N messages", () => {
    for (let i = 0; i < 10; i++) {
      current.append({ id: `msg-${i}`, tag: "main", fromAgentId: "a", content: `msg ${i}`, timestamp: i });
    }
    current.roll(3);

    const lines = current.read();
    expect(lines).toHaveLength(3);
    expect(lines[0].content).toBe("msg 7");
    expect(lines[2].content).toBe("msg 9");
  });

  it("formats as context text", () => {
    current.append({ id: "msg-1", tag: "main", fromAgentId: "owner", content: "任务开始", timestamp: 1000 });
    current.append({ id: "msg-2", tag: "talk-001", fromAgentId: "dev", content: "我来处理", timestamp: 2001 });

    const text = current.readAsContext();
    expect(text).toContain("[owner]: 任务开始");
    expect(text).toContain("[Talk: talk-001] [dev]: 我来处理");
  });

  it("creates file on first append", () => {
    const filePath = path.join(tmpDir, "current.md");
    expect(fs.existsSync(filePath)).toBe(false);
    current.append({ id: "msg-1", tag: "main", fromAgentId: "a", content: "hi", timestamp: 1000 });
    expect(fs.existsSync(filePath)).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd D:/agent-codes/cobeing && npx vitest run packages/core/src/group/current-md.test.ts
```

- [ ] **Step 3: 实现 CurrentMd**

```typescript
// packages/core/src/group/current-md.ts
/**
 * CurrentMd — 群组热上下文管理
 *
 * 维护 current.md（JSONL 格式），存储最近 N 条消息。
 * WakeSystem 在每次唤醒前调用 roll() 裁剪。
 */
import fs from "node:fs";
import path from "node:path";
import { createLogger } from "@cobeing/shared";

const log = createLogger("current-md");

export interface CurrentMessage {
  id: string;
  tag: string;
  fromAgentId: string;
  content: string;
  timestamp: number;
}

export class CurrentMd {
  private filePath: string;

  constructor(memoryDir: string) {
    fs.mkdirSync(memoryDir, { recursive: true });
    this.filePath = path.join(memoryDir, "current.md");
  }

  /** 追加一条消息 */
  append(msg: CurrentMessage): void {
    const line = JSON.stringify(msg) + "\n";
    fs.appendFileSync(this.filePath, line, "utf-8");
  }

  /** 裁剪到最近 maxMessages 条 */
  roll(maxMessages: number): void {
    if (!fs.existsSync(this.filePath)) return;

    const raw = fs.readFileSync(this.filePath, "utf-8");
    const lines = raw.trim().split("\n").filter(Boolean);

    if (lines.length <= maxMessages) return;

    const kept = lines.slice(-maxMessages);
    fs.writeFileSync(this.filePath, kept.join("\n") + "\n", "utf-8");
    log.debug("Rolled current.md: %d → %d messages", lines.length, kept.length);
  }

  /** 读取所有消息（解析 JSONL） */
  read(): CurrentMessage[] {
    if (!fs.existsSync(this.filePath)) return [];
    const raw = fs.readFileSync(this.filePath, "utf-8");
    return raw.trim().split("\n").filter(Boolean).map(line => {
      try { return JSON.parse(line) as CurrentMessage; } catch { return null; }
    }).filter((m): m is CurrentMessage => m !== null);
  }

  /** 格式化为 Agent 可读的上下文文本 */
  readAsContext(): string {
    const messages = this.read();
    if (messages.length === 0) return "";

    return messages.map(msg => {
      const speaker = msg.fromAgentId;
      if (msg.tag === "main") {
        return `[${speaker}]: ${msg.content}`;
      }
      return `[Talk: ${msg.tag}] [${speaker}]: ${msg.content}`;
    }).join("\n\n");
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd D:/agent-codes/cobeing && npx vitest run packages/core/src/group/current-md.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/group/current-md.ts packages/core/src/group/current-md.test.ts
git commit -m "feat: add CurrentMd for group hot context management"
```

---

### Task 5: ConversationLoop — promptBuilder 回调

**Files:**
- Modify: `packages/core/src/conversation/conversation-loop.ts`

- [ ] **Step 1: 在 ConversationLoopConfig 中新增 promptBuilder**

在 `ConversationLoopConfig` 接口中添加：

```typescript
/** 每次 run() 时调用，实时构建 system prompt（优先于 buildSystemPrompt） */
promptBuilder?: () => string;
```

- [ ] **Step 2: 修改 run() 使用 promptBuilder**

将 `ConversationLoop.run()` 中的：

```typescript
const systemPrompt = buildSystemPrompt({
  id: "",
  name: this.config.agentConfig.name,
  role: this.config.agentConfig.role,
  systemPrompt: this.config.agentConfig.systemPrompt,
  provider: "",
  model: "",
});
```

改为：

```typescript
const systemPrompt = this.config.promptBuilder
  ? this.config.promptBuilder()
  : buildSystemPrompt({
      id: "",
      name: this.config.agentConfig.name,
      role: this.config.agentConfig.role,
      systemPrompt: this.config.agentConfig.systemPrompt,
      provider: "",
      model: "",
    });
```

- [ ] **Step 3: 验证编译通过**

```bash
cd D:/agent-codes/cobeing && npx tsc --noEmit -p packages/core/tsconfig.json
```

- [ ] **Step 4: 跑现有测试确认无回归**

```bash
cd D:/agent-codes/cobeing && npx vitest run packages/core/src/conversation/
```

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/conversation/conversation-loop.ts
git commit -m "feat: add promptBuilder callback to ConversationLoop"
```

---

### Task 6: Agent — wire promptBuilder into createLoop

**Files:**
- Modify: `packages/core/src/agent/agent.ts`

- [ ] **Step 1: 修改 createLoop 传入 promptBuilder**

将 `createLoop` 方法改为：

```typescript
private createLoop(
  toolExecutor: ToolExecutor,
  sessionId?: string,
  systemPrompt?: string,
  model?: string,
): ConversationLoop {
  return new ConversationLoop({
    agentConfig: {
      name: this.name,
      role: this.config.role,
      systemPrompt: systemPrompt ?? this.config.systemPrompt,
      model: model ?? this.config.model,
    },
    provider: this.provider,
    tools: this.toolRegistry.listDefinitions(),
    toolExecutor,
    agentId: this.id,
    sessionId: sessionId ?? "default",
    workingDir: this.paths.workspaceDir,
    maxToolRounds: this.config.maxToolRounds,
    promptBuilder: systemPrompt
      ? undefined  // 固定 prompt 的场景（如 butler），不用回调
      : () => buildSystemPromptFromFiles(
          this.files,
          { name: this.name, role: this.config.role, systemPrompt: this.config.systemPrompt },
          undefined,  // 不传 memoryStore，走文件读取路径，实现实时更新
        ),
  });
}
```

- [ ] **Step 2: 删除构造函数中的冻结 prompt 构建**

在 Agent 构造函数中，删除或注释掉原来的冻结 prompt 构建代码（`enhancedPrompt` 相关），因为现在由 promptBuilder 回调处理：

```typescript
// 删除这段：
// const enhancedPrompt = buildSystemPromptFromFiles(this.files, {
//   name: this.name,
//   role: config.role,
//   systemPrompt: config.systemPrompt || "",
// }, this.memoryStore.readyState ? this.memoryStore : undefined);

// 改为：
this.conversationLoop = this.createLoop(toolExecutor);
```

注意：确保 `injectSkillRepository()` 中的 `this.conversationLoop = this.createLoop(executor)` 也走新路径（它调用 createLoop 不传 systemPrompt，所以会自动用 promptBuilder）。

- [ ] **Step 3: 验证编译通过**

```bash
cd D:/agent-codes/cobeing && npx tsc --noEmit -p packages/core/tsconfig.json
```

- [ ] **Step 4: 跑现有测试确认无回归**

```bash
cd D:/agent-codes/cobeing && npx vitest run packages/core/src/agent/
```

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/agent/agent.ts
git commit -m "feat: wire promptBuilder into Agent.createLoop for real-time prompt rebuild"
```

---

### Task 7: group-memory-search 工具

**Files:**
- Create: `packages/core/src/tools/group-memory-search.ts`

- [ ] **Step 1: 实现工具**

```typescript
// packages/core/src/tools/group-memory-search.ts
/**
 * group-memory-search — 搜索 Agent 在群组中的历史消息和重要片段
 */
import type { Tool, ToolContext, ToolResult } from "@cobeing/shared";
import type { GroupAgentMemory } from "../group/agent-memory.js";

type MemoryGetter = (groupId: string, agentId: string) => GroupAgentMemory | undefined;

export function makeGroupMemorySearchTool(getMemory: MemoryGetter): Tool {
  return {
    name: "group-memory-search",
    description: "搜索你在本群组中的历史消息和重要片段。用于回忆之前的讨论内容、查找关键决策、检索技术细节。",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "搜索关键词" },
        type: {
          type: "string",
          enum: ["messages", "fragments", "all"],
          description: "搜索范围：messages=消息, fragments=重要片段, all=全部（默认）",
        },
        limit: { type: "number", description: "返回条数，默认 10" },
      },
      required: ["query"],
    },
    async execute(params, context: ToolContext): Promise<ToolResult> {
      const query = params.query as string;
      const type = (params.type as string) || "all";
      const limit = (params.limit as number) || 10;

      // 从 context 中获取 groupId（需要在 ToolContext 中扩展）
      const groupId = (context as any).groupId as string | undefined;
      if (!groupId) {
        return { toolCallId: "", content: "此工具只能在群组上下文中使用。", isError: true };
      }

      const memory = getMemory(groupId, context.agentId);
      if (!memory) {
        return { toolCallId: "", content: `未找到群组 ${groupId} 的记忆存储。`, isError: true };
      }

      const results: string[] = [];

      if (type === "messages" || type === "all") {
        const messages = memory.search(query, limit);
        if (messages.length > 0) {
          results.push("=== 匹配的消息 ===");
          for (const msg of messages) {
            const time = new Date(msg.timestamp).toLocaleString("zh-CN");
            results.push(`[${time}] [${msg.fromAgentId}] (${msg.tag}): ${msg.content}`);
          }
        }
      }

      if (type === "fragments" || type === "all") {
        const fragments = memory.searchFragments(query, limit);
        if (fragments.length > 0) {
          results.push("=== 匹配的重要片段 ===");
          for (const frag of fragments) {
            const time = new Date(frag.timestamp).toLocaleString("zh-CN");
            results.push(`[${time}] ${frag.content}${frag.reason ? ` (${frag.reason})` : ""}`);
          }
        }
      }

      if (results.length === 0) {
        return { toolCallId: "", content: `未找到包含 "${query}" 的记录。` };
      }

      return { toolCallId: "", content: results.join("\n") };
    },
  };
}
```

- [ ] **Step 2: 验证编译通过**

```bash
cd D:/agent-codes/cobeing && npx tsc --noEmit -p packages/core/tsconfig.json
```

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/tools/group-memory-search.ts
git commit -m "feat: add group-memory-search tool for agent history search"
```

---

### Task 8: WakeSystem — 集成 current.md + SQLite 同步

**Files:**
- Modify: `packages/core/src/group/wake-system.ts`

- [ ] **Step 1: 新增依赖注入**

修改 WakeSystem 构造函数，新增 `currentMd`、`getAgentMemory`、`maxCurrentMessages` 参数：

```typescript
import type { CurrentMd } from "./current-md.js";
import type { GroupAgentMemory } from "./agent-memory.js";

export interface WakeSystemConfig {
  wakeDelayMs?: number;
}

export class WakeSystem {
  private ctx: GroupContextV2;
  private getAgent: (id: string) => Agent | undefined;
  private config: Required<WakeSystemConfig>;
  private currentMd: CurrentMd | null;
  private getAgentMemory: ((agentId: string) => GroupAgentMemory | null) | null;
  private maxCurrentMessages: number;
  private processing = false;
  private wakeQueue: WakeEntry[] = [];
  private processedMsgIds = new Set<string>();

  constructor(
    ctx: GroupContextV2,
    getAgent: (id: string) => Agent | undefined,
    config?: WakeSystemConfig,
    deps?: {
      currentMd?: CurrentMd;
      getAgentMemory?: (agentId: string) => GroupAgentMemory | null;
      maxCurrentMessages?: number;
    },
  ) {
    this.ctx = ctx;
    this.getAgent = getAgent;
    this.config = {
      wakeDelayMs: config?.wakeDelayMs ?? 5000,
    };
    this.currentMd = deps?.currentMd ?? null;
    this.getAgentMemory = deps?.getAgentMemory ?? null;
    this.maxCurrentMessages = deps?.maxCurrentMessages ?? 100;

    ctx.onMessage((msg) => this.handleNewMessage(msg));
  }

  // ...existing handleNewMessage, wakeAgent...
```

- [ ] **Step 2: 修改 handleNewMessage 同步到 current.md**

在 `handleNewMessage` 末尾（`this.processQueue()` 之前），添加 current.md 同步：

```typescript
private handleNewMessage(msg: GroupMessageV2): void {
  if (this.processedMsgIds.has(msg.id)) return;

  // 同步到 current.md
  if (this.currentMd) {
    this.currentMd.append({
      id: msg.id,
      tag: msg.tag,
      fromAgentId: msg.fromAgentId,
      content: msg.content,
      timestamp: msg.timestamp,
    });
  }

  // ...existing mention scanning...
```

- [ ] **Step 3: 修改 executeWake 使用 current.md + SQLite**

```typescript
private async executeWake(entry: WakeEntry): Promise<void> {
  const agent = this.getAgent(entry.targetAgentId);
  if (!agent) return;

  log.info("[%s] Waking agent: %s (tag: %s)", this.ctx.groupId, entry.targetAgentId, entry.triggerTag);

  try {
    // 1. 滚动 current.md
    if (this.currentMd) {
      this.currentMd.roll(this.maxCurrentMessages);
    }

    // 2. 同步消息到目标 Agent 的 SQLite
    if (this.getAgentMemory) {
      const memory = this.getAgentMemory(entry.targetAgentId);
      if (memory) {
        const visible = this.ctx.getVisibleMessages(entry.targetAgentId);
        memory.syncMessages(visible.map(m => ({
          msgId: m.id,
          tag: m.tag,
          fromAgentId: m.fromAgentId,
          content: m.content,
          timestamp: m.timestamp,
        })));
      }
    }

    // 3. 读取 current.md 作为上下文（替代 buildContextFor）
    const context = this.currentMd
      ? this.currentMd.readAsContext()
      : this.ctx.buildContextFor(entry.targetAgentId);

    if (!context) {
      log.debug("[%s] No context for %s, skipping", this.ctx.groupId, entry.targetAgentId);
      return;
    }

    // 4. 唤醒 Agent
    const response = await agent.run(context);

    // 5. 回复写回 GroupContextV2
    const replyMsg = this.ctx.append(entry.targetAgentId, response.content, entry.triggerTag);
    this.processedMsgIds.add(replyMsg.id);

    // 6. 同步回复到 current.md
    if (this.currentMd) {
      this.currentMd.append({
        id: replyMsg.id,
        tag: replyMsg.tag,
        fromAgentId: replyMsg.fromAgentId,
        content: replyMsg.content,
        timestamp: replyMsg.timestamp,
      });
    }

    // 7. 同步回复到所有可见 Agent 的 SQLite
    if (this.getAgentMemory) {
      this.syncReplyToAll(replyMsg);
    }

    log.info("[%s] Agent %s responded (%d chars)", this.ctx.groupId, entry.targetAgentId, response.content.length);
    await this.delay(this.config.wakeDelayMs);
  } catch (err) {
    log.error("[%s] Wake failed for %s: %s", this.ctx.groupId, entry.targetAgentId, err);
  }
}

/** 将回复同步到所有可见 Agent 的 SQLite */
private syncReplyToAll(msg: GroupMessageV2): void {
  if (!this.getAgentMemory) return;
  // 获取群组所有成员（从 config 或 registry）
  // 简单方案：遍历所有已知 agent，检查可见性
  // 这里需要 Group 的成员列表，通过构造时注入
  // 暂时同步到触发 Agent 的 SQLite（已在 executeWake 中处理）
  // 完整实现需要 Group 提供成员列表迭代器
}
```

- [ ] **Step 4: 验证编译通过**

```bash
cd D:/agent-codes/cobeing && npx tsc --noEmit -p packages/core/tsconfig.json
```

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/group/wake-system.ts
git commit -m "feat: integrate current.md rolling and SQLite sync into WakeSystem"
```

---

### Task 9: Group — 创建 memory/ 目录，注入依赖

**Files:**
- Modify: `packages/core/src/group/group.ts`

- [ ] **Step 1: 在 Group 构造函数中创建 memory/ 目录和相关实例**

在 Group 构造函数中，创建 `memory/` 目录，初始化 `CurrentMd` 和 `GroupAgentMemory` 管理器：

```typescript
import { CurrentMd } from "./current-md.js";
import { GroupAgentMemory } from "./agent-memory.js";

// 在 Group 类中新增属性：
readonly currentMd: CurrentMd;
private agentMemories = new Map<string, GroupAgentMemory>();
private maxCurrentMessages: number;

// 构造函数中（在 wakeSystem 创建之后）：
const memoryDir = path.join(dataRoot, "groups", config.id, "memory");
this.currentMd = new CurrentMd(memoryDir);
this.maxCurrentMessages = (globalThis as any).__cobeingConfig?.core?.groupMemory?.maxCurrentMessages ?? 100;

// 注入依赖到 WakeSystem
this.wakeSystem = new WakeSystem(
  this.ctxV2,
  (id) => this.registry.get(id),
  undefined,
  {
    currentMd: this.currentMd,
    getAgentMemory: (agentId) => this.getAgentMemory(agentId),
    maxCurrentMessages: this.maxCurrentMessages,
  },
);
```

- [ ] **Step 2: 添加 getAgentMemory 方法**

```typescript
/** 获取或创建 Agent 在本群组的 SQLite 记忆 */
getAgentMemory(agentId: string): GroupAgentMemory {
  let mem = this.agentMemories.get(agentId);
  if (!mem) {
    const memoryDir = path.join(this._dataRoot, "groups", this.id, "memory");
    mem = new GroupAgentMemory(agentId, memoryDir);
    this.agentMemories.set(agentId, mem);
  }
  return mem;
}
```

- [ ] **Step 3: 验证编译通过**

```bash
cd D:/agent-codes/cobeing && npx tsc --noEmit -p packages/core/tsconfig.json
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/group/group.ts
git commit -m "feat: wire Group with CurrentMd and GroupAgentMemory"
```

---

### Task 10: GroupManager — restoreGroups 初始化 + tool 注册

**Files:**
- Modify: `packages/core/src/group/manager.ts`
- Modify: `packages/core/src/agent/agent.ts`（注册 group-memory-search tool）

- [ ] **Step 1: 在 GroupManager.restoreGroups() 中恢复 current.md**

在 `restoreGroups()` 的消息恢复循环之后，重建 current.md：

```typescript
// 在 "for (const msg of history) { group.ctxV2.append(...) }" 之后：
// 重建 current.md（取最近 N 条）
const memoryDir = path.join(this.groupsDir, config.id, "memory");
fs.mkdirSync(memoryDir, { recursive: true });
for (const msg of history.slice(-100)) {  // 默认 100
  group.currentMd.append({
    id: msg.tag + "-" + msg.timestamp,  // 恢复时生成近似 ID
    tag: msg.tag,
    fromAgentId: msg.fromAgentId,
    content: msg.content,
    timestamp: msg.timestamp,
  });
}
```

- [ ] **Step 2: 在 Agent 中注册 group-memory-search 工具**

在 Agent 构造函数的工具注册部分，添加：

```typescript
// 需要一个获取 GroupAgentMemory 的方式
// 方案：通过全局 getter 注入
this.toolRegistry.register(makeGroupMemorySearchTool(
  (groupId, agentId) => {
    // 通过全局 GroupManager 获取
    const groupManager = (globalThis as any).__cobeingGroupManager;
    return groupManager?.get(groupId)?.getAgentMemory(agentId);
  }
));
```

注意：这是一个简化方案。更好的方式是通过 ToolContext 传递 groupId，或在 Agent 加入群组时动态注册。但为了最小改动，先用全局引用。

- [ ] **Step 3: 验证编译通过**

```bash
cd D:/agent-codes/cobeing && npx tsc --noEmit -p packages/core/tsconfig.json
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/group/manager.ts packages/core/src/agent/agent.ts
git commit -m "feat: wire group-memory-search tool and restoreGroups current.md rebuild"
```

---

### Task 11: 跑全量测试确认无回归

- [ ] **Step 1: 跑所有 core 测试**

```bash
cd D:/agent-codes/cobeing && npx vitest run packages/core/
```

- [ ] **Step 2: 修复任何失败的测试**

- [ ] **Step 3: 验证 TypeScript 编译**

```bash
cd D:/agent-codes/cobeing && npx tsc --noEmit -p packages/core/tsconfig.json
```

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete group memory system - per-agent SQLite, current.md, real-time prompt, history search"
```
