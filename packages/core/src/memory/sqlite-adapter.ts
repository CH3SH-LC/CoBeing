/**
 * sqlite-adapter — SQLite FTS5 封装（基于 better-sqlite3）
 * 管理 entries（记忆条目）和 history（对话历史）两张表
 *
 * CJK 支持：在 JS 层对中日韩文字逐字分词，利用 FTS5 phrase query
 * 匹配连续汉字，兼顾索引速度和中文搜索精度。
 */
import Database, { type Database as BetterSqlite3Database, type Statement } from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { createLogger } from "@cobeing/shared";

const log = createLogger("sqlite-adapter");

export interface EntryRow {
  id: number;
  target: string;
  content: string;
  created_at: number;
  updated_at: number;
}

export interface HistoryRow {
  id: number;
  session: string;
  role: string;
  content: string;
  tool_name: string | null;
  timestamp: number;
}

// ─── CJK 分词 ───

/** Node.js 内置的 Intl 分词器，对中文做词级切分 */
const segmenter = new Intl.Segmenter("zh-CN", { granularity: "word" });

/**
 * 对文本做词级分词，用空格连接各词元。
 * 使用 Intl.Segmenter 做语言感知的切分，中文按词边界拆分，
 * 英文保持完整单词。
 *
 * 例: "完成了TypeScript重构" → "完成 了 TypeScript 重 构"
 */
function tokenizeFTS(text: string): string {
  if (!text) return text;
  return [...segmenter.segment(text)]
    .filter(s => s.isWordLike)
    .map(s => s.segment)
    .join(" ");
}

/**
 * 将搜索词分词后构建 FTS5 MATCH 表达式。
 * 每个词元用引号包裹做精确匹配，空格分隔表示 AND 逻辑。
 */
function buildMatchExpr(query: string): string {
  const tokenized = tokenizeFTS(query);
  return tokenized
    .split(/\s+/)
    .filter(t => t.length > 0)
    .map(t => `"${t.replace(/"/g, '""')}"`)
    .join(" ");
}

// ─── SqliteAdapter ───

export class SqliteAdapter {
  private db: BetterSqlite3Database;
  private stmts!: {
    insertEntry: Statement;
    updateEntry: Statement;
    deleteEntry: Statement;
    getEntries: Statement;
    getCharCount: Statement;
    findEntryBySubstring: Statement;
    insertHistory: Statement;
    getSyncMtime: Statement;
    setSyncMtime: Statement;
  };
  private hasFts5: boolean;

  private constructor(dbPath: string) {
    // 确保目录存在
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });

    this.db = new Database(dbPath);
    // WAL 模式提升并发读写性能
    this.db.pragma("journal_mode = WAL");

    this.hasFts5 = this.initTables();
    this.initStatements();
  }

  /** 同步工厂方法 */
  static create(dbPath: string): SqliteAdapter {
    return new SqliteAdapter(dbPath);
  }

  private initTables(): boolean {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        target TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);

    // FTS5 独立存储（不用 content= 同步），由 JS 层双写 + CJK 分词
    let fts5 = false;
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
          content, target
        );
      `);
      fts5 = true;
    } catch {
      log.warn("FTS5 not available, falling back to LIKE search");
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        tool_name TEXT,
        timestamp INTEGER NOT NULL
      );
    `);

    if (fts5) {
      try {
        this.db.exec(`
          CREATE VIRTUAL TABLE IF NOT EXISTS history_fts USING fts5(
            content, session
          );
        `);
      } catch {
        log.warn("history_fts not available, falling back to LIKE search");
        fts5 = false;
      }
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sync_state (
        target TEXT PRIMARY KEY,
        mtime INTEGER NOT NULL
      );
    `);

    return fts5;
  }

  /** 预编译常用语句 */
  private initStatements(): void {
    this.stmts = {
      insertEntry: this.db.prepare(
        "INSERT INTO entries (target, content, created_at, updated_at) VALUES (?, ?, ?, ?)"
      ),
      updateEntry: this.db.prepare(
        "UPDATE entries SET content = ?, updated_at = ? WHERE id = ?"
      ),
      deleteEntry: this.db.prepare("DELETE FROM entries WHERE id = ?"),
      getEntries: this.db.prepare(
        "SELECT * FROM entries WHERE target = ? ORDER BY created_at ASC"
      ),
      getCharCount: this.db.prepare(
        "SELECT COALESCE(SUM(LENGTH(content)), 0) as total FROM entries WHERE target = ?"
      ),
      findEntryBySubstring: this.db.prepare(
        "SELECT * FROM entries WHERE target = ? AND content LIKE ? LIMIT 1"
      ),
      insertHistory: this.db.prepare(
        "INSERT INTO history (session, role, content, tool_name, timestamp) VALUES (?, ?, ?, ?, ?)"
      ),
      getSyncMtime: this.db.prepare("SELECT mtime FROM sync_state WHERE target = ?"),
      setSyncMtime: this.db.prepare(
        "INSERT OR REPLACE INTO sync_state (target, mtime) VALUES (?, ?)"
      ),
    };
  }

  // ─── FTS 索引维护 ───

  /** 向 FTS 索引插入（CJK 分词后） */
  private ftsInsertEntry(id: number, content: string, target: string): void {
    this.db.prepare(
      "INSERT INTO entries_fts(rowid, content, target) VALUES (?, ?, ?)"
    ).run(id, tokenizeFTS(content), target);
  }

  /** 从 FTS 索引删除 */
  private ftsDeleteEntry(id: number): void {
    this.db.prepare("DELETE FROM entries_fts WHERE rowid = ?").run(id);
  }

  /** 向 FTS 索引插入 history（CJK 分词后） */
  private ftsInsertHistory(id: number, content: string, session: string): void {
    this.db.prepare(
      "INSERT INTO history_fts(rowid, content, session) VALUES (?, ?, ?)"
    ).run(id, tokenizeFTS(content), session);
  }

  /** 从 FTS 索引删除 history */
  private ftsDeleteHistory(id: number): void {
    this.db.prepare("DELETE FROM history_fts WHERE rowid = ?").run(id);
  }

  // ─── Entries CRUD ───

  /** 替换某个 target 的所有条目 */
  replaceEntries(target: string, entries: Array<{ content: string; created_at: number }>): void {
    const now = Date.now();

    this.db.transaction(() => {
      // 先收集旧 id 用于清理 FTS
      if (this.hasFts5) {
        const oldIds = this.db.prepare("SELECT id FROM entries WHERE target = ?").all(target) as { id: number }[];
        for (const { id } of oldIds) this.ftsDeleteEntry(id);
      }
      this.db.prepare("DELETE FROM entries WHERE target = ?").run(target);

      for (const e of entries) {
        const info = this.stmts.insertEntry.run(target, e.content, e.created_at, now);
        if (this.hasFts5) this.ftsInsertEntry(Number(info.lastInsertRowid), e.content, target);
      }
    })();
  }

  /** 追加一条条目 */
  insertEntry(target: string, content: string): number {
    const now = Date.now();
    const info = this.stmts.insertEntry.run(target, content, now, now);
    const id = Number(info.lastInsertRowid);
    if (this.hasFts5) this.ftsInsertEntry(id, content, target);
    return id;
  }

  /** 更新一条条目（按 id） */
  updateEntry(id: number, content: string): void {
    const now = Date.now();
    this.stmts.updateEntry.run(content, now, id);
    if (this.hasFts5) {
      this.ftsDeleteEntry(id);
      // 读取 target 用于重建索引
      const row = this.db.prepare("SELECT target FROM entries WHERE id = ?").get(id) as { target: string } | undefined;
      if (row) this.ftsInsertEntry(id, content, row.target);
    }
  }

  /** 删除一条条目（按 id） */
  deleteEntry(id: number): void {
    if (this.hasFts5) this.ftsDeleteEntry(id);
    this.stmts.deleteEntry.run(id);
  }

  /** 读取某个 target 的所有条目 */
  getEntries(target: string): EntryRow[] {
    return this.stmts.getEntries.all(target) as EntryRow[];
  }

  /** 读取所有 target 的条目 */
  getAllEntries(): EntryRow[] {
    return this.db.prepare("SELECT * FROM entries ORDER BY target, created_at ASC").all() as EntryRow[];
  }

  /** 按 target + 子串定位条目 */
  findEntryBySubstring(target: string, substring: string): EntryRow | undefined {
    return this.stmts.findEntryBySubstring.get(target, `%${substring}%`) as EntryRow | undefined;
  }

  /** 计算某个 target 的总字符数 */
  getCharCount(target: string): number {
    const row = this.stmts.getCharCount.get(target) as { total: number } | undefined;
    return row?.total ?? 0;
  }

  // ─── 搜索 ───

  /** 搜索记忆条目（FTS5 with CJK tokenization，降级 LIKE） */
  searchEntries(query: string, target?: string, limit = 10): EntryRow[] {
    if (this.hasFts5) {
      try {
        const matchExpr = buildMatchExpr(query);
        let sql = `SELECT e.* FROM entries e
          JOIN entries_fts fts ON e.id = fts.rowid
          WHERE entries_fts MATCH ?`;
        const params: unknown[] = [matchExpr];

        if (target) {
          sql += ` AND e.target = ?`;
          params.push(target);
        }
        sql += ` ORDER BY rank LIMIT ?`;
        params.push(limit);

        return this.db.prepare(sql).all(...params) as EntryRow[];
      } catch {
        // FTS5 查询语法错误，降级为 LIKE
      }
    }

    let sql = "SELECT * FROM entries WHERE content LIKE ?";
    const params: unknown[] = [`%${query}%`];
    if (target) {
      sql += " AND target = ?";
      params.push(target);
    }
    sql += " ORDER BY created_at ASC LIMIT ?";
    params.push(limit);
    return this.db.prepare(sql).all(...params) as EntryRow[];
  }

  /** 搜索对话历史（FTS5 with CJK tokenization，降级 LIKE） */
  searchHistory(query: string, session?: string, limit = 10): HistoryRow[] {
    if (this.hasFts5) {
      try {
        const matchExpr = buildMatchExpr(query);
        let sql = `SELECT h.* FROM history h
          JOIN history_fts fts ON h.id = fts.rowid
          WHERE history_fts MATCH ?`;
        const params: unknown[] = [matchExpr];

        if (session) {
          sql += ` AND h.session = ?`;
          params.push(session);
        }
        sql += ` ORDER BY h.timestamp DESC LIMIT ?`;
        params.push(limit);

        return this.db.prepare(sql).all(...params) as HistoryRow[];
      } catch {
        // FTS5 降级为 LIKE
      }
    }

    let sql = "SELECT * FROM history WHERE content LIKE ?";
    const params: unknown[] = [`%${query}%`];
    if (session) {
      sql += " AND session = ?";
      params.push(session);
    }
    sql += " ORDER BY timestamp DESC LIMIT ?";
    params.push(limit);
    return this.db.prepare(sql).all(...params) as HistoryRow[];
  }

  // ─── History ───

  /** 追加对话历史 */
  insertHistory(entry: { session: string; role: string; content: string; tool_name?: string; timestamp: number }): void {
    const info = this.stmts.insertHistory.run(
      entry.session, entry.role, entry.content, entry.tool_name ?? null, entry.timestamp
    );
    if (this.hasFts5) {
      this.ftsInsertHistory(Number(info.lastInsertRowid), entry.content, entry.session);
    }
  }

  // ─── Sync State ───

  getSyncMtime(target: string): number {
    const row = this.stmts.getSyncMtime.get(target) as { mtime: number } | undefined;
    return row?.mtime ?? 0;
  }

  setSyncMtime(target: string, mtime: number): void {
    this.stmts.setSyncMtime.run(target, mtime);
  }

  /** 关闭数据库 */
  close(): void {
    try {
      this.db.close();
    } catch {
      // 已关闭或无操作
    }
  }
}
