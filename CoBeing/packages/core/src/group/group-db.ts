import Database, { type Database as BetterSqlite3Database } from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { createLogger } from "@cobeing/shared";

const log = createLogger("group-db");
let fallbackWarningShown = false;

export interface StoredMessage {
  id: number;
  msg_id: string;
  tag: string;
  from_agent_id: string;
  content: string;
  timestamp: number;
}

interface FallbackGroupStore {
  messages: StoredMessage[];
  visibility: Map<string, Set<string>>;
  compressionMarks: Map<string, number>;
  nextId: number;
}

export class GroupDB {
  readonly groupId: string;
  private db: BetterSqlite3Database | null = null;
  private fallback: FallbackGroupStore | null = null;
  private dbPath: string;

  get databasePath(): string { return this.dbPath; }

  constructor(groupId: string, memoryDir: string) {
    this.groupId = groupId;
    fs.mkdirSync(memoryDir, { recursive: true });
    this.dbPath = path.join(memoryDir, "group.db");
    try {
      this.db = new Database(this.dbPath);
      this.db.pragma("journal_mode = WAL");
      this.initTables();
    } catch (error) {
      this.db = null;
      this.fallback = {
        messages: [],
        visibility: new Map(),
        compressionMarks: new Map(),
        nextId: 1,
      };
      const reason = (error instanceof Error ? error.message : String(error))
        .split("\n")[0]
        .replace(/\s*Tried:\s*$/, "");
      if (!fallbackWarningShown) {
        fallbackWarningShown = true;
        log.warn("[%s] SQLite group database unavailable, using in-memory fallback: %s", groupId, reason);
      } else {
        log.debug("[%s] SQLite group database unavailable, using in-memory fallback", groupId);
      }
    }
  }

  private initTables(): void {
    if (!this.db) return;
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
    if (this.fallback) {
      if (this.fallback.messages.some(message => message.msg_id === msgId)) {
        log.debug("[%s] Duplicate msg_id ignored: %s", this.groupId, msgId);
        return;
      }
      this.fallback.messages.push({
        id: this.fallback.nextId++,
        msg_id: msgId,
        tag,
        from_agent_id: fromAgentId,
        content,
        timestamp,
      });
      this.fallback.visibility.set(msgId, new Set(visibleTo));
      return;
    }
    if (!this.db) return;
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
    if (this.fallback) {
      return this.fallback.messages
        .filter(message =>
          message.timestamp > after &&
          this.fallback?.visibility.get(message.msg_id)?.has(agentId)
        )
        .sort((left, right) => left.timestamp - right.timestamp || left.id - right.id)
        .slice(0, limit);
    }
    if (!this.db) return [];
    return this.db.prepare(
      `SELECT m.* FROM messages m
       JOIN visibility v ON m.msg_id = v.msg_id
       WHERE v.agent_id = ? AND m.timestamp > ?
       ORDER BY m.timestamp ASC
       LIMIT ?`
    ).all(agentId, after, limit) as StoredMessage[];
  }

  getCompressionMark(agentId: string): number {
    if (this.fallback) {
      return this.fallback.compressionMarks.get(agentId) ?? 0;
    }
    if (!this.db) return 0;
    const row = this.db.prepare(
      "SELECT compressed_until FROM compression_marks WHERE agent_id = ?"
    ).get(agentId) as { compressed_until: number } | undefined;
    return row?.compressed_until ?? 0;
  }

  setCompressionMark(agentId: string, compressedUntil: number): void {
    if (this.fallback) {
      this.fallback.compressionMarks.set(agentId, compressedUntil);
      return;
    }
    if (!this.db) return;
    this.db.prepare(
      `INSERT INTO compression_marks (agent_id, compressed_until, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(agent_id) DO UPDATE SET compressed_until = ?, updated_at = ?`
    ).run(agentId, compressedUntil, Date.now(), compressedUntil, Date.now());
  }

  /** Remove this agent's old visibility after compression; physically delete only orphan messages. */
  cleanupCompressedMessages(agentId: string, keepAfterMs: number = 3600000): number {
    const compressedUntil = this.getCompressionMark(agentId);
    if (compressedUntil === 0) return 0;

    const cutoff = compressedUntil - keepAfterMs;
    if (this.fallback) {
      const targetIds = this.fallback.messages
        .filter(message =>
          message.timestamp <= cutoff &&
          this.fallback?.visibility.get(message.msg_id)?.has(agentId)
        )
        .sort((left, right) => right.timestamp - left.timestamp || right.id - left.id)
        .slice(10)
        .map(message => message.msg_id);

      let orphaned = 0;
      for (const msgId of targetIds) {
        const visibleAgents = this.fallback.visibility.get(msgId);
        visibleAgents?.delete(agentId);
        if (!visibleAgents || visibleAgents.size > 0) continue;
        this.fallback.visibility.delete(msgId);
        const before = this.fallback.messages.length;
        this.fallback.messages = this.fallback.messages.filter(message => message.msg_id !== msgId);
        orphaned += before - this.fallback.messages.length;
      }
      return orphaned;
    }
    if (!this.db) return 0;
    return this.db.transaction(() => {
      const targetIds = this.db.prepare(`
        SELECT m.msg_id FROM messages m
        JOIN visibility v ON m.msg_id = v.msg_id
        WHERE v.agent_id = ? AND m.timestamp <= ?
        ORDER BY m.timestamp DESC
        LIMIT -1 OFFSET 10
      `).all(agentId, cutoff) as Array<{ msg_id: string }>;

      if (targetIds.length === 0) return 0;

      const deleteVisibility = this.db.prepare(
        "DELETE FROM visibility WHERE agent_id = ? AND msg_id = ?",
      );
      for (const row of targetIds) {
        deleteVisibility.run(agentId, row.msg_id);
      }

      const orphanDelete = this.db.prepare(`
        DELETE FROM messages
        WHERE msg_id = ?
          AND NOT EXISTS (SELECT 1 FROM visibility WHERE visibility.msg_id = messages.msg_id)
      `);
      let orphaned = 0;
      for (const row of targetIds) {
        orphaned += orphanDelete.run(row.msg_id).changes;
      }
      return orphaned;
    })();
  }

  getMessageCount(): number {
    if (this.fallback) {
      return this.fallback.messages.length;
    }
    if (!this.db) return 0;
    const row = this.db.prepare("SELECT COUNT(*) as cnt FROM messages").get() as { cnt: number };
    return row.cnt;
  }

  /** Get all messages in group, newest first, with cursor-based pagination */
  getAllMessages(options?: { before?: number; limit?: number }): StoredMessage[] {
    const limit = Math.min(options?.limit ?? 50, 100);
    if (this.fallback) {
      return this.fallback.messages
        .filter(message => !options?.before || message.timestamp < options.before)
        .sort((left, right) => right.timestamp - left.timestamp || right.id - left.id)
        .slice(0, limit + 1)
        .reverse();
    }
    if (!this.db) return [];
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
    if (!this.db) return;
    try {
      this.db.pragma("wal_checkpoint(TRUNCATE)");
    } catch { /* ignore */ }
    try {
      this.db.pragma("journal_mode = DELETE");
    } catch { /* ignore */ }
    try { this.db.close(); } catch { /* ignore */ }
    // Note: do NOT touch aux files (-wal/-shm) here — on Windows they may
    // still be memory-mapped by Better-SQLite3, causing native crashes.
    // File cleanup is handled by the caller via directory rename.
  }
}
