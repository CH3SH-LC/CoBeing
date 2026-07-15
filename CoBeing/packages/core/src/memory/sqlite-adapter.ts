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
let fallbackWarningShown = false;

interface FallbackSqliteStore {
  entries: EntryRow[];
  history: HistoryRow[];
  syncState: Record<string, number>;
  nextEntryId: number;
  nextHistoryId: number;
}

export interface EntryRow {
  id: number;
  target: string;
  content: string;
  created_at: number;
  updated_at: number;
  trust: number;
  half_life_days: number;
  helpful_count: number;
  unhelpful_count: number;
  last_accessed_at: number | null;
  hrr_vector: Buffer | null;
  snippet?: string;
  // Scoring fields (only populated by searchEntries)
  fts_score?: number;
  jaccard_sim?: number;
  temporal_decay?: number;
  final_score?: number;
}

export interface HistoryRow {
  id: number;
  session: string;
  role: string;
  content: string;
  tool_name: string | null;
  timestamp: number;
  /** 搜索结果截断预览（可选，仅 search 时填充） */
  snippet?: string;
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

// ─── Scoring utilities ───

/** Tokenize text into a Set for Jaccard computation */
function tokenizeSet(text: string): Set<string> {
  if (!text) return new Set();
  return new Set(
    [...segmenter.segment(text)]
      .filter(s => s.isWordLike)
      .map(s => s.segment)
  );
}

/** Jaccard similarity between query and entry content */
function computeJaccard(query: string, content: string): number {
  const qTokens = tokenizeSet(query);
  const cTokens = tokenizeSet(content);
  if (qTokens.size === 0 && cTokens.size === 0) return 1;
  let intersection = 0;
  for (const t of qTokens) {
    if (cTokens.has(t)) intersection++;
  }
  const union = qTokens.size + cTokens.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Temporal decay: 0.5^(age_days / half_life_days)，halfLifeDays=0 时返回 1 */
function computeTemporalDecay(createdAt: number, halfLifeDays: number): number {
  const ageMs = Date.now() - createdAt;
  const ageDays = ageMs / 86400000;
  const effectiveHalfLife = halfLifeDays > 0 ? halfLifeDays : 30;
  return Math.pow(0.5, ageDays / effectiveHalfLife);
}

/** Normalize FTS5 rank: lower rank = better match → higher score */
function normalizeFtsRank(rank: number): number {
  return 1 / (1 + rank);
}

/** Combine FTS5 and Jaccard into relevance score */
function computeRelevance(ftsScore: number, jaccardSim: number): number {
  return 0.5 * ftsScore + 0.5 * jaccardSim;
}

// ─── SqliteAdapter ───

export class SqliteAdapter {
  private db!: BetterSqlite3Database;
  private dbPath: string;
  private fallback: FallbackSqliteStore | null = null;
  private fallbackPath: string;
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
  private hasFts5 = false;

  private constructor(dbPath: string) {
    this.dbPath = dbPath;
    this.fallbackPath = `${dbPath}.fallback.json`;
    // 确保目录存在
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });

    try {
      this.db = new Database(dbPath);
    // WAL 模式提升并发读写性能
    this.db.pragma("journal_mode = WAL");

    this.hasFts5 = this.initTables();
    this.initStatements();
    } catch (error) {
      this.hasFts5 = false;
      this.fallback = this.loadFallbackStore();
      const reason = (error instanceof Error ? error.message : String(error))
        .split("\n")[0]
        .replace(/\s*Tried:\s*$/, "");
      if (!fallbackWarningShown) {
        fallbackWarningShown = true;
        log.warn("SQLite memory index unavailable, using file-backed fallback: %s", reason);
      } else {
        log.debug("SQLite memory index unavailable for %s, using file-backed fallback", this.dbPath);
      }
    }
  }

  /** 同步工厂方法 */
  static create(dbPath: string): SqliteAdapter {
    return new SqliteAdapter(dbPath);
  }

  private loadFallbackStore(): FallbackSqliteStore {
    try {
      if (fs.existsSync(this.fallbackPath)) {
        const parsed = JSON.parse(fs.readFileSync(this.fallbackPath, "utf-8")) as Partial<FallbackSqliteStore>;
        return {
          entries: parsed.entries ?? [],
          history: parsed.history ?? [],
          syncState: parsed.syncState ?? {},
          nextEntryId: parsed.nextEntryId ?? ((parsed.entries?.reduce((max, row) => Math.max(max, row.id), 0) ?? 0) + 1),
          nextHistoryId: parsed.nextHistoryId ?? ((parsed.history?.reduce((max, row) => Math.max(max, row.id), 0) ?? 0) + 1),
        };
      }
    } catch (error) {
      log.warn("Failed to load fallback memory index %s: %s", this.fallbackPath, error);
    }
    return { entries: [], history: [], syncState: {}, nextEntryId: 1, nextHistoryId: 1 };
  }

  private saveFallbackStore(): void {
    if (!this.fallback) return;
    fs.writeFileSync(this.fallbackPath, JSON.stringify(this.fallback, null, 2) + "\n", "utf-8");
  }

  private createFallbackEntry(target: string, content: string, createdAt: number, updatedAt: number): EntryRow {
    const store = this.fallback!;
    return {
      id: store.nextEntryId++,
      target,
      content,
      created_at: createdAt,
      updated_at: updatedAt,
      trust: 0.5,
      half_life_days: 30,
      helpful_count: 0,
      unhelpful_count: 0,
      last_accessed_at: null,
      hrr_vector: null,
    };
  }

  private queryMatches(content: string, query: string): boolean {
    const trimmed = query.trim();
    if (!trimmed) return false;
    const lowerContent = content.toLowerCase();
    const lowerQuery = trimmed.toLowerCase();
    if (lowerContent.includes(lowerQuery)) return true;
    const tokens = tokenizeFTS(trimmed)
      .split(/\s+/)
      .filter(token => token.length > 0)
      .map(token => token.toLowerCase());
    if (tokens.length === 0) return false;
    return tokens.every(token => lowerContent.includes(token));
  }

  private scoreFallbackEntries(entries: EntryRow[], query: string, limit: number): EntryRow[] {
    const scored = entries.map(entry => {
      const jaccardSim = computeJaccard(query, entry.content);
      const exactBoost = entry.content.toLowerCase().includes(query.toLowerCase()) ? 1 : 0;
      const ftsScore = Math.max(exactBoost, jaccardSim);
      const temporalDecay = computeTemporalDecay(entry.created_at, entry.half_life_days);
      const relevance = computeRelevance(ftsScore, jaccardSim);
      const ageFactor = 0.3 + 0.7 * temporalDecay;
      const finalScore = relevance * (entry.trust ?? 0.5) * ageFactor;
      return {
        ...entry,
        fts_score: Math.round(ftsScore * 1000) / 1000,
        jaccard_sim: Math.round(jaccardSim * 1000) / 1000,
        temporal_decay: Math.round(temporalDecay * 1000) / 1000,
        final_score: Math.round(finalScore * 1000) / 1000,
        snippet: this.snippetAroundMatch(entry.content, query),
      };
    });

    scored.sort((a, b) => b.final_score! - a.final_score! || a.created_at - b.created_at);
    const top = scored.slice(0, limit);
    const now = Date.now();
    for (const result of top) {
      const source = this.fallback?.entries.find(entry => entry.id === result.id);
      if (source) source.last_accessed_at = now;
    }
    if (top.length > 0) this.saveFallbackStore();
    return top;
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

    this.migrateSchema();
    return fts5;
  }

  private migrateSchema(): void {
    const columns: Array<[string, string]> = [
      ["trust", "REAL DEFAULT 0.5"],
      ["half_life_days", "INTEGER DEFAULT 30"],
      ["helpful_count", "INTEGER DEFAULT 0"],
      ["unhelpful_count", "INTEGER DEFAULT 0"],
      ["last_accessed_at", "INTEGER"],
      ["hrr_vector", "BLOB"],
    ];

    const existing = this.db.prepare("PRAGMA table_info(entries)").all() as Array<{ name: string }>;
    const existingNames = new Set(existing.map(c => c.name));

    for (const [name, def] of columns) {
      if (!existingNames.has(name)) {
        try {
          this.db.exec(`ALTER TABLE entries ADD COLUMN ${name} ${def}`);
        } catch (err) {
          log.warn("Failed to add column %s: %s", name, err);
        }
      }
    }
  }

  /** 预编译常用语句 */
  private initStatements(): void {
    this.stmts = {
      insertEntry: this.db.prepare(
        "INSERT INTO entries (target, content, created_at, updated_at, trust, half_life_days) VALUES (?, ?, ?, ?, 0.5, 30)"
      ),
      updateEntry: this.db.prepare(
        "UPDATE entries SET content = ?, updated_at = ? WHERE id = ?"
      ),
      deleteEntry: this.db.prepare("DELETE FROM entries WHERE id = ?"),
      getEntries: this.db.prepare(
        "SELECT id, target, content, created_at, updated_at, trust, half_life_days, helpful_count, unhelpful_count, last_accessed_at, hrr_vector FROM entries WHERE target = ? ORDER BY created_at ASC"
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
    if (this.fallback) {
      const now = Date.now();
      this.fallback.entries = this.fallback.entries.filter(entry => entry.target !== target);
      for (const entry of entries) {
        this.fallback.entries.push(this.createFallbackEntry(target, entry.content, entry.created_at, now));
      }
      this.saveFallbackStore();
      return;
    }
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
    if (this.fallback) {
      const now = Date.now();
      const entry = this.createFallbackEntry(target, content, now, now);
      this.fallback.entries.push(entry);
      this.saveFallbackStore();
      return entry.id;
    }
    const now = Date.now();
    const info = this.stmts.insertEntry.run(target, content, now, now);
    const id = Number(info.lastInsertRowid);
    if (this.hasFts5) this.ftsInsertEntry(id, content, target);
    return id;
  }

  /** 更新一条条目（按 id） */
  updateEntry(id: number, content: string): void {
    if (this.fallback) {
      const entry = this.fallback.entries.find(row => row.id === id);
      if (!entry) return;
      entry.content = content;
      entry.updated_at = Date.now();
      this.saveFallbackStore();
      return;
    }
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
    if (this.fallback) {
      this.fallback.entries = this.fallback.entries.filter(entry => entry.id !== id);
      this.saveFallbackStore();
      return;
    }
    if (this.hasFts5) this.ftsDeleteEntry(id);
    this.stmts.deleteEntry.run(id);
  }

  /** 读取某个 target 的所有条目 */
  getEntries(target: string): EntryRow[] {
    if (this.fallback) {
      return this.fallback.entries
        .filter(entry => entry.target === target)
        .sort((left, right) => left.created_at - right.created_at || left.id - right.id)
        .map(entry => ({ ...entry }));
    }
    return this.stmts.getEntries.all(target) as EntryRow[];
  }

  /** 读取所有 target 的条目 */
  getAllEntries(): EntryRow[] {
    if (this.fallback) {
      return [...this.fallback.entries]
        .sort((left, right) => left.target.localeCompare(right.target) || left.created_at - right.created_at)
        .map(entry => ({ ...entry }));
    }
    return this.db.prepare("SELECT * FROM entries ORDER BY target, created_at ASC").all() as EntryRow[];
  }

  /** 按 target + 子串定位条目 */
  findEntryBySubstring(target: string, substring: string): EntryRow | undefined {
    if (this.fallback) {
      const entry = this.fallback.entries.find(row => row.target === target && row.content.includes(substring));
      return entry ? { ...entry } : undefined;
    }
    return this.stmts.findEntryBySubstring.get(target, `%${substring}%`) as EntryRow | undefined;
  }

  /** 计算某个 target 的总字符数 */
  getCharCount(target: string): number {
    if (this.fallback) {
      return this.fallback.entries
        .filter(entry => entry.target === target)
        .reduce((total, entry) => total + entry.content.length, 0);
    }
    const row = this.stmts.getCharCount.get(target) as { total: number } | undefined;
    return row?.total ?? 0;
  }

  // ─── Trust 反馈 ───

  /** 调整条目的信任分数，返回新值 */
  adjustTrust(id: number, delta: number, min = 0, max = 1): number {
    if (this.fallback) {
      const entry = this.fallback.entries.find(row => row.id === id);
      if (!entry) return 0;
      entry.trust = Math.max(min, Math.min(max, entry.trust + delta));
      this.saveFallbackStore();
      return entry.trust;
    }
    const row = this.db.prepare(
      "SELECT trust FROM entries WHERE id = ?"
    ).get(id) as { trust: number } | undefined;
    if (!row) return 0;

    const newTrust = Math.max(min, Math.min(max, row.trust + delta));
    this.db.prepare("UPDATE entries SET trust = ? WHERE id = ?").run(newTrust, id);
    return newTrust;
  }

  /** 标记条目为有用，trust +0.1（默认） */
  markHelpful(id: number): number {
    if (this.fallback) {
      const entry = this.fallback.entries.find(row => row.id === id);
      if (!entry) return 0;
      entry.helpful_count += 1;
      return this.adjustTrust(id, 0.1);
    }
    this.db.prepare(
      "UPDATE entries SET helpful_count = helpful_count + 1 WHERE id = ?"
    ).run(id);
    return this.adjustTrust(id, 0.1);
  }

  /** 标记条目为无用，trust -0.15（默认） */
  markUnhelpful(id: number): number {
    if (this.fallback) {
      const entry = this.fallback.entries.find(row => row.id === id);
      if (!entry) return 0;
      entry.unhelpful_count += 1;
      return this.adjustTrust(id, -0.15);
    }
    this.db.prepare(
      "UPDATE entries SET unhelpful_count = unhelpful_count + 1 WHERE id = ?"
    ).run(id);
    return this.adjustTrust(id, -0.15);
  }

  // ─── 搜索 ───

  /** 以匹配位置为中心截断内容，返回上下文窗口 */
  private snippetAroundMatch(content: string, query: string, window = 80): string | undefined {
    const idx = content.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) {
      // 搜不到精确位置，退化为前缀截断
      if (content.length <= window * 2) return undefined;
      return content.slice(0, window * 2) + "...";
    }
    const start = Math.max(0, idx - window);
    const end = Math.min(content.length, idx + query.length + window);
    let snippet = "";
    if (start > 0) snippet += "...";
    snippet += content.slice(start, end);
    if (end < content.length) snippet += "...";
    return snippet;
  }

  /** 搜索记忆条目（多策略：FTS5 + Jaccard + temporal decay + trust） */
  searchEntries(query: string, target?: string, limit = 10): EntryRow[] {
    if (!query || query.trim().length === 0) return [];
    if (this.fallback) {
      const candidates = this.fallback.entries.filter(entry =>
        (!target || entry.target === target) &&
        this.queryMatches(entry.content, query)
      );
      return this.scoreFallbackEntries(candidates, query, limit);
    }

    const CANDIDATE_LIMIT = 50;

    // Phase 1: FTS5/LIKE coarse filter
    let candidates: EntryRow[] = [];

    if (this.hasFts5) {
      try {
        const matchExpr = buildMatchExpr(query);
        let sql = `SELECT e.*, fts.rank FROM entries e
          JOIN entries_fts fts ON e.id = fts.rowid
          WHERE entries_fts MATCH ?`;
        const params: unknown[] = [matchExpr];
        if (target) { sql += " AND e.target = ?"; params.push(target); }
        sql += " ORDER BY rank LIMIT ?";
        params.push(CANDIDATE_LIMIT);

        const rows = this.db.prepare(sql).all(...params) as Array<EntryRow & { rank: number }>;
        candidates = rows.map(r => ({ ...r, fts_score: normalizeFtsRank(r.rank) }));
      } catch {
        // FTS5 syntax error, fall back to LIKE
      }
    }

    if (candidates.length === 0) {
      let sql = "SELECT * FROM entries WHERE content LIKE ?";
      const params: unknown[] = [`%${query}%`];
      if (target) { sql += " AND target = ?"; params.push(target); }
      sql += " ORDER BY created_at DESC LIMIT ?";
      params.push(CANDIDATE_LIMIT);
      const rows = this.db.prepare(sql).all(...params) as EntryRow[];
      candidates = rows.map(r => ({
        ...r,
        // LIKE 回退：使用 Jaccard 相似度代替无意义的 query/content 长度比
        fts_score: computeJaccard(query, r.content),
      }));
    }

    if (candidates.length === 0) return [];

    // Phase 2: Per-entry scoring
    // temporal decay 作为衰减因子而非乘数：即使很旧的记忆也保留 30% 基础分
    const scored = candidates.map(entry => {
      const jaccardSim = computeJaccard(query, entry.content);
      const temporalDecay = computeTemporalDecay(entry.created_at, entry.half_life_days);
      const relevance = computeRelevance(entry.fts_score!, jaccardSim);
      const ageFactor = 0.3 + 0.7 * temporalDecay;
      const finalScore = relevance * (entry.trust ?? 0.5) * ageFactor;

      return {
        ...entry,
        jaccard_sim: Math.round(jaccardSim * 1000) / 1000,
        temporal_decay: Math.round(temporalDecay * 1000) / 1000,
        final_score: Math.round(finalScore * 1000) / 1000,
      };
    });

    // Phase 3: Sort + truncate + snippet
    scored.sort((a, b) => b.final_score! - a.final_score!);
    const top = scored.slice(0, limit);

    // Batch update last_accessed_at for top results
    if (top.length > 0) {
      try {
        const ids = top.map(r => r.id);
        const placeholders = ids.map(() => "?").join(",");
        this.db.prepare(
          `UPDATE entries SET last_accessed_at = ? WHERE id IN (${placeholders})`
        ).run(Date.now(), ...ids);
      } catch { /* ignore */ }
    }

    for (const row of top) {
      row.snippet = this.snippetAroundMatch(row.content, query);
    }

    return top;
  }

  /** 搜索对话历史（FTS5 with CJK tokenization，降级 LIKE） */
  searchHistory(query: string, session?: string, limit = 10): HistoryRow[] {
    if (this.fallback) {
      return this.fallback.history
        .filter(row =>
          (!session || row.session === session) &&
          this.queryMatches(row.content, query)
        )
        .sort((left, right) => right.timestamp - left.timestamp || right.id - left.id)
        .slice(0, limit)
        .map(row => ({ ...row, snippet: this.snippetAroundMatch(row.content, query) }));
    }

    let results: HistoryRow[] = [];

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

        results = this.db.prepare(sql).all(...params) as HistoryRow[];
      } catch {
        // FTS5 降级为 LIKE
      }
    }

    if (results.length === 0) {
      let sql = "SELECT * FROM history WHERE content LIKE ?";
      const params: unknown[] = [`%${query}%`];
      if (session) {
        sql += " AND session = ?";
        params.push(session);
      }
      sql += " ORDER BY timestamp DESC LIMIT ?";
      params.push(limit);
      results = this.db.prepare(sql).all(...params) as HistoryRow[];
    }

    // 为每条结果生成截断预览
    for (const row of results) {
      row.snippet = this.snippetAroundMatch(row.content, query);
    }
    return results;
  }

  // ─── History ───

  /** 追加对话历史 */
  insertHistory(entry: { session: string; role: string; content: string; tool_name?: string; timestamp: number }): void {
    if (this.fallback) {
      this.fallback.history.push({
        id: this.fallback.nextHistoryId++,
        session: entry.session,
        role: entry.role,
        content: entry.content,
        tool_name: entry.tool_name ?? null,
        timestamp: entry.timestamp,
      });
      this.saveFallbackStore();
      return;
    }
    const info = this.stmts.insertHistory.run(
      entry.session, entry.role, entry.content, entry.tool_name ?? null, entry.timestamp
    );
    if (this.hasFts5) {
      this.ftsInsertHistory(Number(info.lastInsertRowid), entry.content, entry.session);
    }
  }

  // ─── Sync State ───

  getSyncMtime(target: string): number {
    if (this.fallback) {
      return this.fallback.syncState[target] ?? 0;
    }
    const row = this.stmts.getSyncMtime.get(target) as { mtime: number } | undefined;
    return row?.mtime ?? 0;
  }

  setSyncMtime(target: string, mtime: number): void {
    if (this.fallback) {
      this.fallback.syncState[target] = mtime;
      this.saveFallbackStore();
      return;
    }
    this.stmts.setSyncMtime.run(target, mtime);
  }

  /** 关闭数据库并清理 WAL 辅助文件（Windows 兼容） */
  close(): void {
    if (this.fallback) {
      this.saveFallbackStore();
      return;
    }
    try {
      this.db.pragma("wal_checkpoint(TRUNCATE)");
    } catch { /* ignore */ }
    try {
      this.db.pragma("journal_mode = DELETE");
    } catch { /* ignore */ }
    try {
      this.db.close();
    } catch {
      // already closed
    }
    // File cleanup deferred to caller (directory rename) to avoid
    // Windows native crashes from Better-SQLite3 memory-mapped files.
  }
}
