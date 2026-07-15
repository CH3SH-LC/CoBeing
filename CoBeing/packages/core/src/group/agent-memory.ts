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
let fallbackWarningShown = false;

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

interface FallbackAgentMemoryStore {
  messages: AgentMessage[];
  fragments: AgentFragment[];
  nextFragmentId: number;
}

export class GroupAgentMemory {
  readonly agentId: string;
  private db: BetterSqlite3Database | null = null;
  private fallback: FallbackAgentMemoryStore | null = null;
  private dbPath: string;
  private hasFts5 = false;

  constructor(agentId: string, memoryDir: string) {
    this.agentId = agentId;
    fs.mkdirSync(memoryDir, { recursive: true });

    this.dbPath = path.join(memoryDir, `${agentId}.db`);
    try {
      this.db = new Database(this.dbPath);
      this.db.pragma("journal_mode = WAL");
      this.hasFts5 = this.initTables();
    } catch (error) {
      this.db = null;
      this.fallback = { messages: [], fragments: [], nextFragmentId: 1 };
      const reason = (error instanceof Error ? error.message : String(error))
        .split("\n")[0]
        .replace(/\s*Tried:\s*$/, "");
      if (!fallbackWarningShown) {
        fallbackWarningShown = true;
        log.warn("[%s] SQLite agent memory unavailable, using in-memory fallback: %s", agentId, reason);
      } else {
        log.debug("[%s] SQLite agent memory unavailable, using in-memory fallback", agentId);
      }
    }
  }

  private initTables(): boolean {
    if (!this.db) return false;
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
    if (this.fallback) {
      for (const msg of messages) {
        if (this.fallback.messages.some(existing => existing.msgId === msg.msgId)) continue;
        this.fallback.messages.push({ ...msg });
      }
      return;
    }
    if (!this.db) return;
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
    if (this.fallback) {
      return this.fallback.messages
        .filter(message => message.content.includes(query))
        .sort((left, right) => right.timestamp - left.timestamp)
        .slice(0, limit);
    }
    if (!this.db) return [];
    if (this.hasFts5) {
      try {
        const matchExpr = buildMatchExpr(query);
        return this.db.prepare(
          `SELECT
             m.msg_id AS msgId,
             m.tag AS tag,
             m.from_agent_id AS fromAgentId,
             m.content AS content,
             m.timestamp AS timestamp
           FROM messages m
           JOIN messages_fts fts ON m.id = fts.rowid
           WHERE messages_fts MATCH ?
           ORDER BY rank LIMIT ?`
        ).all(matchExpr, limit) as AgentMessage[];
      } catch { /* 降级 */ }
    }
    return this.db.prepare(
      `SELECT
         msg_id AS msgId,
         tag AS tag,
         from_agent_id AS fromAgentId,
         content AS content,
         timestamp AS timestamp
       FROM messages
       WHERE content LIKE ?
       ORDER BY timestamp DESC LIMIT ?`
    ).all(`%${query}%`, limit) as AgentMessage[];
  }

  /** 添加重要片段 */
  addFragment(content: string, reason?: string, sourceMsgId?: string): void {
    if (this.fallback) {
      this.fallback.fragments.push({
        id: this.fallback.nextFragmentId++,
        sourceMsgId: sourceMsgId ?? null,
        content,
        reason: reason ?? null,
        timestamp: Date.now(),
      });
      return;
    }
    if (!this.db) return;
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
    if (this.fallback) {
      return this.fallback.fragments
        .filter(fragment => fragment.content.includes(query))
        .sort((left, right) => right.timestamp - left.timestamp)
        .slice(0, limit);
    }
    if (!this.db) return [];
    if (this.hasFts5) {
      try {
        const matchExpr = buildMatchExpr(query);
        return this.db.prepare(
          `SELECT
             f.id AS id,
             f.source_msg_id AS sourceMsgId,
             f.content AS content,
             f.reason AS reason,
             f.timestamp AS timestamp
           FROM important_fragments f
           JOIN fragments_fts fts ON f.id = fts.rowid
           WHERE fragments_fts MATCH ?
           ORDER BY rank LIMIT ?`
        ).all(matchExpr, limit) as AgentFragment[];
      } catch { /* 降级 */ }
    }
    return this.db.prepare(
      `SELECT
         id AS id,
         source_msg_id AS sourceMsgId,
         content AS content,
         reason AS reason,
         timestamp AS timestamp
       FROM important_fragments
       WHERE content LIKE ?
       ORDER BY timestamp DESC LIMIT ?`
    ).all(`%${query}%`, limit) as AgentFragment[];
  }

  /** 获取最近 N 条消息 */
  getRecentMessages(limit = 20): AgentMessage[] {
    if (this.fallback) {
      return [...this.fallback.messages]
        .sort((left, right) => right.timestamp - left.timestamp)
        .slice(0, limit);
    }
    if (!this.db) return [];
    return this.db.prepare(
      `SELECT
         msg_id AS msgId,
         tag AS tag,
         from_agent_id AS fromAgentId,
         content AS content,
         timestamp AS timestamp
       FROM messages
       ORDER BY timestamp DESC LIMIT ?`
    ).all(limit) as AgentMessage[];
  }

  /** 消息总数 */
  getMessageCount(): number {
    if (this.fallback) {
      return this.fallback.messages.length;
    }
    if (!this.db) return 0;
    const row = this.db.prepare("SELECT COUNT(*) as cnt FROM messages").get() as { cnt: number };
    return row.cnt;
  }

  /** 关闭数据库并清理 WAL 辅助文件 */
  close(): void {
    if (!this.db) return;
    try { this.db.pragma("wal_checkpoint(TRUNCATE)"); } catch { /* ignore */ }
    try { this.db.pragma("journal_mode = DELETE"); } catch { /* ignore */ }
    try { this.db.close(); } catch { /* ignore */ }
    // Note: aux file cleanup deferred to caller (directory rename) to avoid
    // Windows native crashes from Better-SQLite3 memory-mapped files.
  }
}
