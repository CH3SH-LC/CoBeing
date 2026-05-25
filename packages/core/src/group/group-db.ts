import Database, { type Database as BetterSqlite3Database } from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { createLogger, cleanupSQLiteAuxFiles } from "@cobeing/shared";

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
  private dbPath: string;

  constructor(groupId: string, memoryDir: string) {
    this.groupId = groupId;
    fs.mkdirSync(memoryDir, { recursive: true });
    this.dbPath = path.join(memoryDir, "group.db");
    this.db = new Database(this.dbPath);
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

  insertMessage(
    msgId: string,
    tag: string,
    fromAgentId: string,
    content: string,
    timestamp: number,
    visibleTo: string[],
  ): void {
    this.db.transaction(() => {
      const info = this.db.prepare(
        "INSERT OR IGNORE INTO messages (msg_id, tag, from_agent_id, content, timestamp) VALUES (?, ?, ?, ?, ?)"
      ).run(msgId, tag, fromAgentId, content, timestamp);

      // Log if insert was ignored (duplicate)
      if (info.changes === 0) {
        log.debug("[%s] Duplicate msg_id ignored: %s", this.groupId, msgId);
        return;
      }

      const insertVis = this.db.prepare(
        "INSERT OR IGNORE INTO visibility (msg_id, agent_id) VALUES (?, ?)"
      );
      for (const agentId of visibleTo) {
        insertVis.run(msgId, agentId);
      }
    })();
  }

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

  getCompressionMark(agentId: string): number {
    const row = this.db.prepare(
      "SELECT compressed_until FROM compression_marks WHERE agent_id = ?"
    ).get(agentId) as { compressed_until: number } | undefined;
    return row?.compressed_until ?? 0;
  }

  setCompressionMark(agentId: string, compressedUntil: number): void {
    this.db.prepare(
      `INSERT INTO compression_marks (agent_id, compressed_until, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(agent_id) DO UPDATE SET compressed_until = ?, updated_at = ?`
    ).run(agentId, compressedUntil, Date.now(), compressedUntil, Date.now());
  }

  /** Delete old messages for an agent after compression (physical cleanup) */
  cleanupCompressedMessages(agentId: string, keepAfterMs: number = 3600000): number {
    const compressedUntil = this.getCompressionMark(agentId);
    if (compressedUntil === 0) return 0;

    const cutoff = compressedUntil - keepAfterMs;
    const result = this.db.prepare(`
      DELETE FROM messages WHERE msg_id IN (
        SELECT m.msg_id FROM messages m
        JOIN visibility v ON m.msg_id = v.msg_id
        WHERE v.agent_id = ? AND m.timestamp <= ?
        ORDER BY m.timestamp DESC
        LIMIT -1 OFFSET 10
      )
    `).run(agentId, cutoff);

    return result.changes;
  }

  getMessageCount(): number {
    const row = this.db.prepare("SELECT COUNT(*) as cnt FROM messages").get() as { cnt: number };
    return row.cnt;
  }

  /** Get all messages in group, newest first, with cursor-based pagination */
  getAllMessages(options?: { before?: number; limit?: number }): StoredMessage[] {
    const limit = Math.min(options?.limit ?? 50, 100);
    let sql = "SELECT * FROM messages WHERE 1=1";
    const params: number[] = [];
    if (options?.before) {
      sql += " AND timestamp < ?";
      params.push(options.before);
    }
    sql += " ORDER BY timestamp DESC LIMIT ?";
    params.push(limit + 1); // +1 to detect hasMore

    const rows = this.db.prepare(sql).all(...params) as StoredMessage[];
    return rows.reverse(); // oldest first
  }

  close(): void {
    try {
      this.db.pragma("wal_checkpoint(TRUNCATE)");
    } catch { /* ignore */ }
    try {
      this.db.pragma("journal_mode = DELETE");
    } catch { /* ignore */ }
    try { this.db.close(); } catch { /* ignore */ }
    // Safety net: explicitly delete any lingering -wal/-shm/-journal files
    cleanupSQLiteAuxFiles(this.dbPath);
  }
}
