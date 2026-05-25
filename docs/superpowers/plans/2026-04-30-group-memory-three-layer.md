# 群组三层记忆架构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current group memory system (current.md full-text accumulation) with a three-layer architecture (raw DB + abstract files + per-agent compressed history) so agents receive bounded context on wake-up.

**Architecture:** Main SQLite DB stores all messages with visibility rules. Per-agent DBs sync filtered messages from main. Compressed history stored as per-agent Markdown files. Context = abstract layer + compressed history + recent uncompressed messages + trigger. ConversationLoop clears history after each wake instead of accumulating.

**Tech Stack:** better-sqlite3, TypeScript, Node.js fs

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `packages/core/src/group/group-db.ts` | Main DB: messages, visibility, compression_marks tables |
| `packages/core/src/group/compressed-history.ts` | Per-agent compressed history file management |
| `packages/core/src/tools/summarize-phase.ts` | summarize-phase tool for agents |

### Modified Files
| File | Change |
|------|--------|
| `packages/core/src/group/group.ts` | Integrate GroupDB, wire up message writes |
| `packages/core/src/group/manager.ts` | Write messages to main DB on appendContextMessage |
| `packages/core/src/group/agent-memory.ts` | Sync from main DB instead of independent writes |
| `packages/core/src/group/wake-system.ts` | Rewrite context building (compressed + uncompressed) |
| `packages/core/src/conversation/conversation-loop.ts` | Support clearing history after each run |
| `packages/core/src/conversation/prompt-builder.ts` | Accept compressed history in system prompt |
| `packages/core/src/agent/agent.ts` | Clear group loop history after each wake, register summarize-phase tool |

### Unchanged Files
- `packages/core/src/group/group-context-v2.ts` — kept for real-time processing
- `packages/core/src/group/current-md.ts` — kept, downgraded to GUI-only (200 messages)
- `packages/core/src/group/workspace.ts` — kept for abstract layer files

---

### Task 1: Create GroupDB (Main Database)

**Files:**
- Create: `packages/core/src/group/group-db.ts`

- [ ] **Step 1: Create GroupDB class with messages + visibility + compression_marks tables**

```typescript
// packages/core/src/group/group-db.ts
import Database, { type Database as BetterSqlite3Database } from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { createLogger } from "@cobeing/shared";

const log = createLogger("group-db");

export interface StoredMessage {
  id: number;
  msg_id: string;
  tag: string;
  from_agent_id: string;
  content: string;
  timestamp: number;
}

export class GroupDB {
  readonly groupId: string;
  private db: BetterSqlite3Database;

  constructor(groupId: string, memoryDir: string) {
    this.groupId = groupId;
    fs.mkdirSync(memoryDir, { recursive: true });
    const dbPath = path.join(memoryDir, "group.db");
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.initTables();
  }

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        msg_id TEXT UNIQUE NOT NULL,
        tag TEXT NOT NULL,
        from_agent_id TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
      CREATE INDEX IF NOT EXISTS idx_messages_tag ON messages(tag);
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS visibility (
        msg_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        PRIMARY KEY (msg_id, agent_id),
        FOREIGN KEY (msg_id) REFERENCES messages(msg_id)
      );
      CREATE INDEX IF NOT EXISTS idx_visibility_agent ON visibility(agent_id);
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS compression_marks (
        agent_id TEXT PRIMARY KEY,
        compressed_until INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  }

  /** Insert a message with visibility rules */
  insertMessage(
    msgId: string,
    tag: string,
    fromAgentId: string,
    content: string,
    timestamp: number,
    visibleTo: string[],
  ): void {
    this.db.transaction(() => {
      this.db.prepare(
        "INSERT OR IGNORE INTO messages (msg_id, tag, from_agent_id, content, timestamp) VALUES (?, ?, ?, ?, ?)"
      ).run(msgId, tag, fromAgentId, content, timestamp);

      const insertVis = this.db.prepare(
        "INSERT OR IGNORE INTO visibility (msg_id, agent_id) VALUES (?, ?)"
      );
      for (const agentId of visibleTo) {
        insertVis.run(msgId, agentId);
      }
    })();
  }

  /** Get messages visible to an agent, optionally after a timestamp */
  getMessagesForAgent(
    agentId: string,
    options?: { after?: number; limit?: number },
  ): StoredMessage[] {
    const after = options?.after ?? 0;
    const limit = options?.limit ?? 200;
    return this.db.prepare(
      `SELECT m.* FROM messages m
       JOIN visibility v ON m.msg_id = v.msg_id
       WHERE v.agent_id = ? AND m.timestamp > ?
       ORDER BY m.timestamp ASC
       LIMIT ?`
    ).all(agentId, after, limit) as StoredMessage[];
  }

  /** Get compression mark for an agent */
  getCompressionMark(agentId: string): number {
    const row = this.db.prepare(
      "SELECT compressed_until FROM compression_marks WHERE agent_id = ?"
    ).get(agentId) as { compressed_until: number } | undefined;
    return row?.compressed_until ?? 0;
  }

  /** Set compression mark for an agent */
  setCompressionMark(agentId: string, compressedUntil: number): void {
    this.db.prepare(
      `INSERT INTO compression_marks (agent_id, compressed_until, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(agent_id) DO UPDATE SET compressed_until = ?, updated_at = ?`
    ).run(agentId, compressedUntil, Date.now(), compressedUntil, Date.now());
  }

  /** Get total message count */
  getMessageCount(): number {
    const row = this.db.prepare("SELECT COUNT(*) as cnt FROM messages").get() as { cnt: number };
    return row.cnt;
  }

  close(): void {
    try { this.db.close(); } catch { /* ignore */ }
  }
}
```

- [ ] **Step 2: Build and verify compilation**

Run: `pnpm --filter @cobeing/core run build`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/group/group-db.ts
git commit -m "feat(group): add GroupDB main database with messages, visibility, compression_marks"
```

---

### Task 2: Integrate GroupDB into Group and Manager

**Files:**
- Modify: `packages/core/src/group/group.ts`
- Modify: `packages/core/src/group/manager.ts`

- [ ] **Step 1: Add GroupDB to Group class**

In `group.ts`, add import and field:

```typescript
import { GroupDB } from "./group-db.js";
```

Add field after `agentMemories`:
```typescript
readonly groupDb: GroupDB;
```

In constructor, after creating `currentMd`:
```typescript
this.groupDb = new GroupDB(config.id, memoryDir);
```

Add method to compute visibility for a message:
```typescript
/** Compute which agents can see a message */
private computeVisibility(tag: string): string[] {
  if (tag === "main" || tag === "system") {
    return [...this.config.members];
  }
  // talk message — only talk members visible
  const talk = this.ctxV2.getTalk(tag);
  return talk ? talk.members : [];
}
```

Modify `postMessage` to use shared helper:
```typescript
postMessage(fromAgentId: string, content: string): GroupMessageV2 {
  const msg = this.ctxV2.append(fromAgentId, content, "main");
  this.persistMessage(msg, "main");
  this.writeToGroupDb(msg, "main");
  return msg;
}
```

Modify `postToTalk` similarly:
```typescript
postToTalk(talkId: string, fromAgentId: string, content: string): GroupMessageV2 {
  const msg = this.ctxV2.append(fromAgentId, content, talkId);
  this.persistMessage(msg, talkId);
  this.writeToGroupDb(msg, talkId);
  return msg;
}
```

Modify `postTalkSummary` similarly:
```typescript
postTalkSummary(fromAgentId: string, talkId: string, summary: string): GroupMessageV2 {
  const msg = this.ctxV2.appendTalkSummary(fromAgentId, talkId, summary);
  this.persistMessage(msg, talkId);
  this.writeToGroupDb(msg, "main");
  return msg;
}
```

Extract shared helper:
```typescript
private writeToGroupDb(msg: GroupMessageV2, tag: string): void {
  this.groupDb.insertMessage(
    msg.id, tag, msg.fromAgentId, msg.content, msg.timestamp,
    this.computeVisibility(tag),
  );
  this.syncToAgentDbs(msg, tag);
}
```

Add sync method:
```typescript
/** Sync a message to all visible agent DBs */
private syncToAgentDbs(msg: GroupMessageV2, tag: string): void {
  const visibleTo = this.computeVisibility(tag);
  for (const agentId of visibleTo) {
    const mem = this.getAgentMemory(agentId);
    mem.syncMessages([{
      msgId: msg.id,
      tag: msg.tag,
      fromAgentId: msg.fromAgentId,
      content: msg.content,
      timestamp: msg.timestamp,
    }]);
  }
}
```

- [ ] **Step 2: Build and verify**

Run: `pnpm --filter @cobeing/core run build`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/group/group.ts
git commit -m "feat(group): integrate GroupDB into Group, write messages with visibility"
```

---

### Task 3: Add CompressedHistory Module

**Files:**
- Create: `packages/core/src/group/compressed-history.ts`

- [ ] **Step 1: Create CompressedHistory class**

```typescript
// packages/core/src/group/compressed-history.ts
import fs from "node:fs";
import path from "node:path";
import { createLogger } from "@cobeing/shared";

const log = createLogger("compressed-history");

export interface CompressedPhase {
  title: string;
  startDate: string;
  endDate: string;
  summary: string;
}

export class CompressedHistory {
  readonly agentId: string;
  private filePath: string;

  constructor(agentId: string, memoryDir: string) {
    this.agentId = agentId;
    this.filePath = path.join(memoryDir, `${agentId}-compressed.md`);
  }

  /** Read the full compressed history file */
  read(): string {
    try {
      return fs.readFileSync(this.filePath, "utf-8");
    } catch {
      return "";
    }
  }

  /** Append a new phase summary */
  appendPhase(phase: CompressedPhase, compressedUntilTimestamp: number): void {
    const dateStr = new Date(compressedUntilTimestamp).toISOString();
    let content = this.read();

    if (!content) {
      content = `# 压缩历史\n\n> 截至 ${dateStr} 的历史已总结\n`;
    }

    // Update the "截至" line
    content = content.replace(
      /截至 .+ 的历史已总结/,
      `截至 ${dateStr} 的历史已总结`,
    );

    // Append new phase
    content += `\n## ${phase.title}（${phase.startDate} ~ ${phase.endDate}）\n${phase.summary}\n`;

    fs.writeFileSync(this.filePath, content, "utf-8");
    log.info("[%s] Compressed phase appended: %s", this.agentId, phase.title);
  }

  /** Check if compressed history exists */
  exists(): boolean {
    return fs.existsSync(this.filePath);
  }
}
```

- [ ] **Step 2: Build and verify**

Run: `pnpm --filter @cobeing/core run build`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/group/compressed-history.ts
git commit -m "feat(group): add CompressedHistory per-agent compressed history management"
```

---

### Task 4: Create summarize-phase Tool

**Files:**
- Create: `packages/core/src/tools/summarize-phase.ts`
- Modify: `packages/core/src/agent/agent.ts` (register tool)

- [ ] **Step 1: Create the tool definition**

```typescript
// packages/core/src/tools/summarize-phase.ts
import type { Tool } from "@cobeing/shared";
import type { GroupManager } from "../group/manager.js";
import type { CompressedHistory } from "../group/compressed-history.js";

export function makeSummarizePhaseTool(
  getGroupManager: () => GroupManager | undefined,
  getAgentId: () => string,
): Tool {
  return {
    name: "summarize-phase",
    description: "总结当前阶段的工作，压缩群组对话历史。完成一个阶段性任务后调用此工具，将近期对话压缩为摘要。",
    parameters: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "阶段摘要，2-5 句话概括这一阶段做了什么、遇到了什么问题、怎么解决的",
        },
        phaseTitle: {
          type: "string",
          description: "阶段标题，如'基础架构搭建'、'核心玩法实现'",
        },
        groupId: {
          type: "string",
          description: "群组 ID（在群组上下文中调用时必填）",
        },
      },
      required: ["summary", "phaseTitle", "groupId"],
    },
    execute: async (params: Record<string, unknown>) => {
      const summary = params.summary as string;
      const phaseTitle = params.phaseTitle as string;
      const groupId = params.groupId as string;
      const agentId = getAgentId();

      const gm = getGroupManager();
      if (!gm) return { success: false, error: "GroupManager 不可用" };

      const group = gm.get(groupId);
      if (!group) return { success: false, error: `群组 ${groupId} 不存在` };

      const now = Date.now();
      const startDate = new Date(now - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
      const endDate = new Date(now).toISOString().slice(0, 10);

      // Get compressed history instance
      const memoryDir = path.join(group.workspace.paths.root, "memory");
      const compressedHistory = new CompressedHistory(agentId, memoryDir);

      // Append phase to compressed history
      compressedHistory.appendPhase(
        { title: phaseTitle, startDate, endDate, summary },
        now,
      );

      // Update compression mark in main DB
      group.groupDb.setCompressionMark(agentId, now);

      log.info("[%s] Agent %s compressed phase: %s (until %s)",
        groupId, agentId, phaseTitle, new Date(now).toISOString());

      return {
        success: true,
        content: `已压缩阶段 "${phaseTitle}" 的历史。截至 ${endDate} 的对话已总结为摘要。`,
      };
    },
  };
}
```

Note: Need to add `import path from "node:path"` and `import { createLogger } from "@cobeing/shared"` at top.

- [ ] **Step 2: Register the tool in Agent constructor**

In `agent.ts`, after the existing tool registrations in the constructor, add:

```typescript
import { makeSummarizePhaseTool } from "../tools/summarize-phase.js";
```

After `injectSkillRepository` call or in constructor, register for group context:
```typescript
// Register summarize-phase tool (group context aware)
this.toolRegistry.register(makeSummarizePhaseTool(
  () => (globalThis as any).__cobeingGroupManager,
  () => this.id,
));
```

- [ ] **Step 3: Build and verify**

Run: `pnpm --filter @cobeing/core run build`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/tools/summarize-phase.ts packages/core/src/agent/agent.ts
git commit -m "feat(tools): add summarize-phase tool for agent-triggered history compression"
```

---

### Task 5: Rewrite WakeSystem Context Building

**Files:**
- Modify: `packages/core/src/group/wake-system.ts`

- [ ] **Step 1: Rewrite the context building in executeWake**

Replace the current context building (steps 3-4 in `executeWake`) with the new three-layer approach:

```typescript
// In executeWake(), replace the context building section:

      // 3. Build three-layer context
      // Layer 1: Abstract (group workspace files)
      let abstractContext = "";
      if (this.getGroup) {
        const group = this.getGroup();
        if (group) {
          const { buildGroupCollaborationContext } = await import("../conversation/prompt-builder.js");
          const members = group.getMemberProfiles();
          const workspace = group.workspace.getSummary();
          const experienceSummary = group.workspace.readExperienceSummary();

          let todos: import("../conversation/prompt-builder.js").GroupTodoSummary[] = [];
          const groupManager = (globalThis as any).__cobeingGroupManager;
          if (groupManager) {
            const scanner = groupManager.getScanner?.(this.ctx.groupId);
            if (scanner) {
              const store = scanner.getStore();
              const pendingTodos = store.list("pending");
              todos = pendingTodos.map((t: any) => ({
                id: t.id,
                title: t.title,
                status: t.status,
                assignee: t.targetAgentId,
              }));
            }
          }

          abstractContext = buildGroupCollaborationContext(
            entry.targetAgentId,
            members,
            {
              task: workspace.task,
              plan: workspace.plan,
              progress: workspace.progress,
              experienceSummary,
            },
            todos,
            this.ownerId,
            this.ctx.groupId,
          );
        }
      }

      // Layer 2: Compressed history
      let compressedContext = "";
      if (this.getGroup) {
        const group = this.getGroup();
        if (group) {
          const memoryDir = path.join(group.workspace.paths.root, "memory");
          const { CompressedHistory } = await import("./compressed-history.js");
          const ch = new CompressedHistory(entry.targetAgentId, memoryDir);
          compressedContext = ch.read();
        }
      }

      // Layer 3: Uncompressed recent messages from per-agent DB
      let recentContext = "";
      if (this.getGroup) {
        const group = this.getGroup();
        if (group) {
          const compressedUntil = group.groupDb.getCompressionMark(entry.targetAgentId);
          const recentMessages = group.groupDb.getMessagesForAgent(
            entry.targetAgentId,
            { after: compressedUntil, limit: 200 },
          );
          if (recentMessages.length > 0) {
            recentContext = recentMessages.map(msg => {
              const speaker = msg.from_agent_id;
              if (msg.tag === "main") {
                return `[${speaker}]: ${msg.content}`;
              }
              const talk = this.ctx.getTalk(msg.tag);
              const memberStr = talk ? talk.members.join(", ") : "?";
              return `[Talk: ${msg.tag} 成员: ${memberStr}] [${speaker}]: ${msg.content}`;
            }).join("\n\n");
          }
        }
      }

      // Combine: abstract + compressed + recent + trigger
      const parts: string[] = [];
      if (abstractContext) parts.push(`# 群组协作上下文\n\n${abstractContext}`);
      if (compressedContext) parts.push(`# 历史摘要\n\n${compressedContext}`);
      if (recentContext) parts.push(`# 近期对话\n\n${recentContext}`);

      let enrichedContext = parts.join("\n\n---\n\n");

      // Append trigger messages
      if (entry.triggerContents.length > 0) {
        const triggerContext = entry.triggerContents
          .map((content, i) => `\n\n[触发消息 ${i + 1}]:\n${content}`)
          .join("");
        enrichedContext = `${enrichedContext}${triggerContext}`;
      }

      // Owner filter context
      if (entry.targetAgentId === this.ownerId && this.lastFilterContext) {
        enrichedContext = `${enrichedContext}\n\n${this.lastFilterContext}`;
        this.lastFilterContext = undefined;
      }
```

Also remove the old `collabContext` building code (the `if (this.getGroup)` block that built `collabContext` separately) since it's now part of `abstractContext`.

Update the `agent.run()` call to not pass `groupContext` separately:
```typescript
      // 5. Wake Agent (no separate groupContext, it's in the enriched context)
      const response = await agent.run(enrichedContext, {
        groupId: this.ctx.groupId,
      });
```

- [ ] **Step 2: Add `import path from "node:path"` at top of wake-system.ts if not present**

- [ ] **Step 3: Build and verify**

Run: `pnpm --filter @cobeing/core run build`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/group/wake-system.ts
git commit -m "feat(wake-system): rewrite context building with three-layer architecture"
```

---

### Task 6: ConversationLoop — Clear History After Each Group Wake

**Files:**
- Modify: `packages/core/src/conversation/conversation-loop.ts`
- Modify: `packages/core/src/agent/agent.ts`

- [ ] **Step 1: Add `clearAndSetSystemContext` method to ConversationLoop**

In `conversation-loop.ts`, add method:

```typescript
  /** Clear history and set a new base context (for group wake-ups) */
  clearAndSetContext(contextMessages: Array<{ role: "user" | "assistant"; content: string }>): void {
    this.history = [...contextMessages];
  }
```

- [ ] **Step 2: Modify Agent.run() to clear group loop history before each call**

In `agent.ts`, in the `run()` method, before calling `loop.run()`:

```typescript
    // For group calls, clear accumulated history and rebuild from context
    if (isGroup && options.groupContext === undefined) {
      // New three-layer mode: context is fully built by WakeSystem
      // Clear old history, the enriched context IS the full context
      loop.clearAndSetContext([]);
    }
```

Actually, since the new architecture sends the full context each time, we should clear the group loop history before each run. Modify the group loop path:

```typescript
    const response = await loop.run(input, options.events);
```

The simplest approach: in `getGroupLoop`, always clear history before returning:

```typescript
  private getGroupLoop(groupId: string, groupContext?: string): ConversationLoop {
    const key = `group:${groupId}`;
    const snapshot = this._groupContextSnapshots.get(key) || { context: undefined };
    snapshot.context = groupContext;
    this._groupContextSnapshots.set(key, snapshot);

    let loop = this.sessionLoops.get(key);
    if (!loop) {
      // ... create loop ...
      this.sessionLoops.set(key, loop);
    }
    // Always clear history for group calls — context is rebuilt each time
    loop.clearHistory();
    return loop;
  }
```

- [ ] **Step 3: Build and verify**

Run: `pnpm --filter @cobeing/core run build`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/conversation/conversation-loop.ts packages/core/src/agent/agent.ts
git commit -m "feat(agent): clear group loop history on each wake, no cross-call accumulation"
```

---

### Task 7: Wire Up Message Write Pipeline (End-to-End)

**Files:**
- Modify: `packages/core/src/group/group.ts` (finalize postMessage/postToTalk/postTalkSummary)
- Modify: `packages/core/src/group/manager.ts` (restoreGroups writes to GroupDB)

- [ ] **Step 1: Complete the message write pipeline in Group**

Ensure all message entry points write to GroupDB + sync to agent DBs:
- `postMessage` → main DB + agent DBs
- `postToTalk` → main DB + agent DBs (only talk members)
- `postTalkSummary` → main DB + agent DBs (all members)
- `addMember` → recompute visibility for existing messages
- `injectMessage` → main DB + agent DBs

- [ ] **Step 2: RestoreGroups — write historical messages to GroupDB**

In `manager.ts`, in `restoreGroups()`, after loading context history, write each message to GroupDB:

```typescript
// After restoring context history into GroupContextV2
// Use a simple hash of content to avoid duplicate msg_id on re-restore
function simpleHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}
for (const msg of history) {
  const visibleTo = group.computeVisibility(msg.tag);
  group.groupDb.insertMessage(
    `restored-${msg.timestamp}-${msg.fromAgentId}-${simpleHash(msg.content).slice(0, 8)}`,
    msg.tag,
    msg.fromAgentId,
    msg.content,
    msg.timestamp,
    visibleTo,
  );
}
```

- [ ] **Step 3: Build and verify**

Run: `pnpm --filter @cobeing/core run build`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/group/group.ts packages/core/src/group/manager.ts
git commit -m "feat(group): complete message write pipeline with GroupDB and agent DB sync"
```

---

### Task 8: Update current.md to 200-Message Limit (GUI Only)

**Files:**
- Modify: `packages/core/src/group/group.ts`

- [ ] **Step 1: Change maxCurrentMessages default to 200**

In `group.ts` constructor:
```typescript
this.maxCurrentMessages = (globalThis as any).__cobeingConfig?.core?.groupMemory?.maxCurrentMessages ?? 200;
```

- [ ] **Step 2: Build and verify**

Run: `pnpm --filter @cobeing/core run build`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/group/group.ts
git commit -m "chore(group): change current.md limit to 200 (GUI-only use)"
```

---

### Task 9: Integration Test — Verify Three-Layer Context

**Files:**
- Test: `packages/core/src/group/__tests__/three-layer-memory.test.ts` (automated)
- Test: Manual verification

- [ ] **Step 1: Write automated integration test**

Create `packages/core/src/group/__tests__/three-layer-memory.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { GroupDB } from "../group-db.js";
import { CompressedHistory } from "../compressed-history.js";
import path from "node:path";
import fs from "node:fs";

const TEST_DIR = path.join(process.cwd(), "data/test-three-layer");

describe("three-layer memory", () => {
  let db: GroupDB;

  beforeAll(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
    db = new GroupDB("test-group", TEST_DIR);
  });

  afterAll(() => {
    db.close();
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("should store messages with visibility", () => {
    db.insertMessage("msg-1", "main", "alice", "hello", Date.now(), ["alice", "bob"]);
    expect(db.getMessageCount()).toBe(1);
    const msgs = db.getMessagesForAgent("alice", { limit: 10 });
    expect(msgs.length).toBe(1);
    expect(msgs[0].content).toBe("hello");
  });

  it("should filter by visibility", () => {
    const msgs = db.getMessagesForAgent("charlie", { limit: 10 });
    expect(msgs.length).toBe(0);  // charlie not visible to msg-1
  });

  it("should track and query compression marks", () => {
    const ts = Date.now();
    db.setCompressionMark("alice", ts);
    expect(db.getCompressionMark("alice")).toBe(ts);
  });

  it("should not return messages before compression mark", () => {
    const past = Date.now() - 60000;
    const now = Date.now();
    db.insertMessage("msg-2", "main", "bob", "old msg", past, ["alice"]);
    db.insertMessage("msg-3", "main", "bob", "new msg", now, ["alice"]);
    db.setCompressionMark("alice", now);
    const msgs = db.getMessagesForAgent("alice", { after: db.getCompressionMark("alice") });
    expect(msgs.every(m => m.timestamp > now)).toBe(true);
  });
});

describe("compressed history", () => {
  it("should append and read phases", () => {
    const ch = new CompressedHistory("test-agent", TEST_DIR);
    ch.appendPhase({ title: "Phase 1", startDate: "04-26", endDate: "04-27", summary: "Setup." }, Date.now());
    const content = ch.read();
    expect(content).toContain("Phase 1");
    expect(content).toContain("Setup.");
  });
});
```

Run: `pnpm --filter @cobeing/core run test -- --run src/group/__tests__/three-layer-memory.test.ts`
Expected: All tests pass

- [ ] **Step 1: Start the backend and verify no errors**

Run: `pnpm dev`
Expected: All agents restore, groups restore, no errors in logs

- [ ] **Step 2: Send a message in a group and verify GroupDB**

Check that `data/groups/{groupId}/memory/group.db` has messages and visibility entries.

- [ ] **Step 3: Trigger an agent via @mention and verify context**

Check logs for the new context building: should show abstract + compressed (empty initially) + recent messages.

- [ ] **Step 4: Call summarize-phase tool and verify compression**

Ask an agent to summarize its phase. Verify:
- `{agentId}-compressed.md` is created
- `compression_marks` table is updated
- Next wake-up shows compressed history + only post-compression messages

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix: integration test fixes for three-layer memory"
```
