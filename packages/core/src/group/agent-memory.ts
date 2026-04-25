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
