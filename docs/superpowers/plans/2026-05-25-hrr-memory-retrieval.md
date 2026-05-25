# HRR 多策略记忆检索 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 增强记忆检索从单一 FTS5 排名升级为 FTS5 + Jaccard + 信任分数 + 时间衰减的多策略融合评分，预留 HRR 相位向量接口

**Architecture:** 四层改动 — sqlite-adapter（Schema + 评分管线）、memory-store（配置 + 反馈 API）、memory-tool（新工具）、hrr.ts（Phase 2 桩）。评分在 JS 层完成（非 SQL），FTS5 负责粗筛，JS 负责精细评分和排序。

**Tech Stack:** TypeScript, better-sqlite3, Vitest, Intl.Segmenter

---

### Task 1: Schema 迁移 + EntryRow 类型扩展

**Files:**
- Modify: `packages/core/src/memory/sqlite-adapter.ts`

- [ ] **Step 1: 新增列迁移方法**

在 `SqliteAdapter` 类中新增 `migrateSchema()` 私有方法，在 `initTables()` 末尾调用。

```typescript
// sqlite-adapter.ts — 在 initTables() 末尾（return fts5 之前）添加:
this.migrateSchema();

// 新增私有方法:
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
```

- [ ] **Step 2: 扩展 EntryRow 接口**

```typescript
// 在 sqlite-adapter.ts 中更新 EntryRow interface:
export interface EntryRow {
  id: number;
  target: string;
  content: string;
  created_at: number;
  updated_at: number;
  // 新增
  trust: number;
  half_life_days: number;
  helpful_count: number;
  unhelpful_count: number;
  last_accessed_at: number | null;
  hrr_vector: Buffer | null;
  // 搜索结果
  snippet?: string;
  // 评分详情（仅 searchEntries 填充）
  fts_score?: number;
  jaccard_sim?: number;
  temporal_decay?: number;
  final_score?: number;
}
```

- [ ] **Step 3: 更新 insertEntry 以写入默认 trust 值**

```typescript
// 修改 insertEntry 方法的 SQL:
insertEntry: this.db.prepare(
  "INSERT INTO entries (target, content, created_at, updated_at, trust, half_life_days) VALUES (?, ?, ?, ?, 0.5, 30)"
),
```

- [ ] **Step 4: 更新预编译语句中的 SELECT 以包含新列**

```typescript
// 修改 getEntries 预编译语句:
getEntries: this.db.prepare(
  "SELECT id, target, content, created_at, updated_at, trust, half_life_days, helpful_count, unhelpful_count, last_accessed_at, hrr_vector FROM entries WHERE target = ? ORDER BY created_at ASC"
),
```

- [ ] **Step 5: 运行已有测试确认 schema 迁移不破坏现有功能**

```bash
pnpm --filter @cobeing/core exec vitest run src/memory/sqlite-adapter.test.ts
```

Expected: all existing tests pass

- [ ] **Step 6: 运行全量测试**

```bash
pnpm test
```

Expected: no regressions

---

### Task 2: Jaccard 相似度 + 评分工具函数

**Files:**
- Modify: `packages/core/src/memory/sqlite-adapter.ts`

- [ ] **Step 1: 新增 tokenize 工具函数**

```typescript
// 在 sqlite-adapter.ts 文件顶部 segmenter 定义之后新增:

function tokenizeSet(text: string): Set<string> {
  if (!text) return new Set();
  return new Set(
    [...segmenter.segment(text)]
      .filter(s => s.isWordLike)
      .map(s => s.segment)
  );
}
```

- [ ] **Step 2: 新增 Jaccard 相似度函数**

```typescript
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
```

- [ ] **Step 3: 新增时间衰减函数**

```typescript
function computeTemporalDecay(createdAt: number, halfLifeDays: number): number {
  const ageMs = Date.now() - createdAt;
  const ageDays = ageMs / 86400000;
  return Math.pow(0.5, ageDays / (halfLifeDays || 30));
}
```

- [ ] **Step 4: 新增 FTS5 归一化函数**

```typescript
function normalizeFtsRank(rank: number): number {
  return 1 / (1 + rank);
}
```

- [ ] **Step 5: 新增相关性融合函数**

```typescript
function computeRelevance(ftsScore: number, jaccardSim: number): number {
  return 0.5 * ftsScore + 0.5 * jaccardSim;
}
```

- [ ] **Step 6: 编译验证**

```bash
pnpm build
```

Expected: compiles clean

---

### Task 3: 多策略 searchEntries 重写

**Files:**
- Modify: `packages/core/src/memory/sqlite-adapter.ts`

- [ ] **Step 1: 重写 searchEntries 方法**

将当前的 `searchEntries` 方法替换为多策略版本：

```typescript
searchEntries(query: string, target?: string, limit = 10): EntryRow[] {
  const CANDIDATE_LIMIT = 50;

  // Phase 1: FTS5/LIKE 粗筛
  let candidates: EntryRow[] = [];
  const hasRank = this.hasFts5;

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
      // FTS5 语法错误，降级 LIKE
    }
  }

  if (candidates.length === 0) {
    let sql = "SELECT * FROM entries WHERE content LIKE ?";
    const params: unknown[] = [`%${query}%`];
    if (target) { sql += " AND target = ?"; params.push(target); }
    sql += " ORDER BY created_at DESC LIMIT ?";
    params.push(CANDIDATE_LIMIT);
    const rows = this.db.prepare(sql).all(...params) as EntryRow[];
    // LIKE 路径: 估算 fts_score
    candidates = rows.map(r => ({
      ...r,
      fts_score: Math.min(query.length / Math.max(r.content.length, 1), 1),
    }));
  }

  if (candidates.length === 0) return [];

  // Phase 2: 逐条精算评分
  const scored = candidates.map(entry => {
    const jaccardSim = computeJaccard(query, entry.content);
    const temporalDecay = computeTemporalDecay(entry.created_at, entry.half_life_days);
    const relevance = computeRelevance(entry.fts_score!, jaccardSim);
    const finalScore = relevance * entry.trust * temporalDecay;

    // 更新 last_accessed_at（异步不阻塞，失败忽略）
    try {
      this.db.prepare("UPDATE entries SET last_accessed_at = ? WHERE id = ?")
        .run(Date.now(), entry.id);
    } catch { /* ignore */ }

    return {
      ...entry,
      jaccard_sim: Math.round(jaccardSim * 1000) / 1000,
      temporal_decay: Math.round(temporalDecay * 1000) / 1000,
      final_score: Math.round(finalScore * 1000) / 1000,
    };
  });

  // Phase 3: 排序 + 截断 + snippet
  scored.sort((a, b) => b.final_score! - a.final_score!);
  const top = scored.slice(0, limit);

  for (const row of top) {
    row.snippet = this.snippetAroundMatch(row.content, query);
  }

  return top;
}
```

- [ ] **Step 2: 同样重写 searchHistory 保持一致性**

searchHistory 当前不参与多策略评分（历史记录无 trust 字段），保持 FTS5 rank / LIKE 降级逻辑不变。仅确认编译通过。

- [ ] **Step 3: 编译验证**

```bash
pnpm build
```

- [ ] **Step 4: 运行已有测试确认不破坏**

```bash
pnpm --filter @cobeing/core exec vitest run src/memory/sqlite-adapter.test.ts
```

---

### Task 4: 信任反馈方法 + MemoryStore 集成

**Files:**
- Modify: `packages/core/src/memory/sqlite-adapter.ts`
- Modify: `packages/core/src/memory/memory-store.ts`

- [ ] **Step 1: sqlite-adapter.ts 新增 adjustTrust**

```typescript
// SqliteAdapter 类新增方法:
adjustTrust(id: number, delta: number, min = 0, max = 1): number {
  const row = this.db.prepare(
    "SELECT trust FROM entries WHERE id = ?"
  ).get(id) as { trust: number } | undefined;
  if (!row) return 0;

  const newTrust = Math.max(min, Math.min(max, row.trust + delta));
  this.db.prepare("UPDATE entries SET trust = ? WHERE id = ?").run(newTrust, id);
  return newTrust;
}

markHelpful(id: number): number {
  this.db.prepare(
    "UPDATE entries SET helpful_count = helpful_count + 1 WHERE id = ?"
  ).run(id);
  return this.adjustTrust(id, 0.1);
}

markUnhelpful(id: number): number {
  this.db.prepare(
    "UPDATE entries SET unhelpful_count = unhelpful_count + 1 WHERE id = ?"
  ).run(id);
  return this.adjustTrust(id, -0.15);
}
```

- [ ] **Step 2: memory-store.ts 扩展 MemoryStoreConfig**

```typescript
// 在 MemoryStoreConfig interface 中新增字段:
export interface MemoryStoreConfig {
  charLimits?: Partial<Record<MemoryTarget, number>>;
  // 新增
  defaultHalfLifeDays?: number;
  trustHelpfulDelta?: number;
  trustUnhelpfulDelta?: number;
  trustDuplicatePenalty?: number;
  minTrust?: number;
  maxTrust?: number;
}

// 在 MemoryStore 类中新增私有配置字段:
private trustConfig: {
  helpfulDelta: number;
  unhelpfulDelta: number;
  duplicatePenalty: number;
  minTrust: number;
  maxTrust: number;
};

// 在构造函数中初始化:
this.trustConfig = {
  helpfulDelta: config?.trustHelpfulDelta ?? 0.1,
  unhelpfulDelta: config?.trustUnhelpfulDelta ?? -0.15,
  duplicatePenalty: config?.trustDuplicatePenalty ?? -0.05,
  minTrust: config?.minTrust ?? 0,
  maxTrust: config?.maxTrust ?? 1,
};
```

- [ ] **Step 3: memory-store.ts 新增反馈方法**

```typescript
// MemoryStore 类新增方法:
adjustTrust(id: number, delta: number): number {
  return this.sqlite.adjustTrust(id, delta, this.trustConfig.minTrust, this.trustConfig.maxTrust);
}

markHelpful(id: number): number {
  return this.sqlite.markHelpful(id);
}

markUnhelpful(id: number): number {
  return this.sqlite.markUnhelpful(id);
}

/** 搜索并反馈 — 用于 memory-feedback 工具 */
searchAndFeedback(query: string, target: MemoryTarget | undefined, action: "helpful" | "unhelpful"): ToolResult {
  const results = this.sqlite.searchEntries(query, target, 1);
  if (results.length === 0) {
    return { success: false, error: `未找到匹配 "${query}" 的记忆条目。` };
  }
  const entry = results[0];
  const newTrust = action === "helpful"
    ? this.markHelpful(entry.id)
    : this.markUnhelpful(entry.id);
  return {
    success: true,
    content: `已将条目 #${entry.id} 标记为 ${action === "helpful" ? "有用" : "无用"}（信任分数: ${entry.trust.toFixed(2)} → ${newTrust.toFixed(2)}）`,
  };
}
```

- [ ] **Step 4: add() 去重自动降分**

在 `add()` 方法的去重检查处，追加自动降分逻辑：

```typescript
// 在 add() 方法中，找到去重检查代码段:
const existing = this.sqlite.getEntries(target);
const dup = existing.find(e => e.content.trim() === content.trim());
if (dup) {
  // 自动降分: 说明该记忆未能阻止重复生成
  this.sqlite.adjustTrust(dup.id, this.trustConfig.duplicatePenalty, this.trustConfig.minTrust, this.trustConfig.maxTrust);
  return { success: false, error: "重复条目: 相同内容已存在。" };
}
```

- [ ] **Step 5: reflectFromHistory 自动加分**

在 `reflectFromHistory()` 末尾，成功后搜索相关条目并加分：

```typescript
// 在 reflectFromHistory() 中，this.add("experience", ...) 成功之后添加:
// 关联加分: 搜索相关经验条目
const related = this.sqlite.searchEntries(task.slice(0, 50), "experience", 3);
for (const entry of related) {
  this.sqlite.adjustTrust(entry.id, this.trustConfig.helpfulDelta, this.trustConfig.minTrust, this.trustConfig.maxTrust);
}
```

- [ ] **Step 6: 编译 + 测试**

```bash
pnpm build
pnpm --filter @cobeing/core exec vitest run src/memory/memory-store.test.ts
```

---

### Task 5: memory-feedback 工具

**Files:**
- Modify: `packages/core/src/memory/memory-tool.ts`

- [ ] **Step 1: 在 makeMemoryTool 的 actions 中新增 feedback**

在 `makeMemoryTool` 返回的 tool 定义中：
- `action` enum 增加 `"feedback"`
- description 增加 feedback 说明
- execute switch 新增 `case "feedback"`

```typescript
// 修改 action enum:
action: {
  type: "string",
  enum: ["add", "replace", "remove", "read", "feedback"],
  description: "操作类型。feedback: 标记记忆有用/无用（需 query 和 feedback_action 参数）",
},

// 新增 feedback 参数:
feedback_action: {
  type: "string",
  enum: ["helpful", "unhelpful"],
  description: "反馈类型（仅 feedback 操作需要）",
},
// （query 复用 content 参数）

// execute switch 新增 case:
case "feedback": {
  const feedbackQuery = (params.content as string) || (params.old_text as string);
  if (!feedbackQuery) return { toolCallId: "", content: "错误: feedback 操作需要 content 或 old_text 作为搜索词。" };
  const fbAction = (params.feedback_action as string) || "helpful";
  const result = store.searchAndFeedback(
    feedbackQuery,
    params.target as MemoryTarget | undefined,
    fbAction as "helpful" | "unhelpful",
  );
  return { toolCallId: "", content: result.success ? result.content! : `错误: ${result.error}` };
}
```

- [ ] **Step 2: 编译验证**

```bash
pnpm build
```

---

### Task 6: hrr.ts — Phase 2 接口 + 桩

**Files:**
- Create: `packages/core/src/memory/hrr.ts`

- [ ] **Step 1: 创建 hrr.ts**

```typescript
/**
 * HRR (Holographic Reduced Representations) 接口 + Phase 2 桩实现
 *
 * Phase 2 将用 SHA-256 确定性相位向量替换 StubHrrEncoder。
 * 所有调用方按 HrrEncoder 接口编程，届时只需替换实例。
 */

export type HrrVector = Float64Array;

export interface HrrEncoder {
  readonly dim: number;
  encodeAtom(word: string): HrrVector;
  bind(a: HrrVector, b: HrrVector): HrrVector;
  unbind(memory: HrrVector, key: HrrVector): HrrVector;
  bundle(...vectors: HrrVector[]): HrrVector;
  similarity(a: HrrVector, b: HrrVector): number;
}

export class StubHrrEncoder implements HrrEncoder {
  readonly dim = 1024;
  private readonly notImpl = () => { throw new Error("HRR Phase 2 not implemented"); };

  encodeAtom(_word: string): HrrVector { throw this.notImpl(); }
  bind(_a: HrrVector, _b: HrrVector): HrrVector { throw this.notImpl(); }
  unbind(_memory: HrrVector, _key: HrrVector): HrrVector { throw this.notImpl(); }
  bundle(..._vectors: HrrVector[]): HrrVector { throw this.notImpl(); }
  similarity(_a: HrrVector, _b: HrrVector): number { throw this.notImpl(); }
}

/**
 * Phase 2 规格（供 future implementer 参考）：
 *
 * 1. encodeAtom(word): SHA-256(word) → 展开为 1024 个 [0, 2π) 相位值
 * 2. bind(a, b) = (a + b) % (2 * Math.PI)
 * 3. unbind(mem, key) = (mem - key) % (2 * Math.PI)
 * 4. bundle(*vectors): 对每个分量做复数指数圆形均值
 *    bundle_i = atan2(mean(sin(vectors[*][i])), mean(cos(vectors[*][i])))
 * 5. similarity(a, b) = mean(cos(a[i] - b[i])) for i in 0..dim
 *
 * 实体提取正则:
 *   CAPITALIZED: /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g
 *   DOUBLE_QUOTE: /"([^"]+)"/g
 *   SINGLE_QUOTE: /'([^']+)'/g
 *   AKA: /(\w+(?:\s+\w+)*)\s+(?:aka|also known as)\s+(\w+(?:\s+\w+)*)/gi
 */
```

- [ ] **Step 2: 编译验证**

```bash
pnpm build
```

---

### Task 7: 测试 + 集成验证

**Files:**
- Modify: `packages/core/src/memory/sqlite-adapter.test.ts`
- Create: `packages/core/src/memory/hrr.test.ts`

- [ ] **Step 1: sqlite-adapter 新增评分测试**

在 `sqlite-adapter.test.ts` 中新增 describe 块：

```typescript
describe("SqliteAdapter — multi-strategy search", () => {
  it("returns results with scoring fields for matching query", () => {
    db.insertEntry("memory", "今天学习了 TypeScript 泛型编程");
    db.insertEntry("memory", "修复了数据库连接池泄漏的 bug");
    db.insertEntry("memory", "用户偏好使用中文回复");

    const results = db.searchEntries("数据库 连接", "memory", 3);

    expect(results.length).toBeGreaterThan(0);
    // 相关结果应该排在最前面
    expect(results[0].content).toContain("数据库");
    // 评分字段应存在
    expect(results[0].final_score).toBeDefined();
    expect(results[0].jaccard_sim).toBeDefined();
    expect(results[0].fts_score).toBeDefined();
    expect(results[0].temporal_decay).toBeDefined();
  });

  it("scores exact matches higher than unrelated entries", () => {
    db.insertEntry("memory", "TypeScript 类型系统详解");
    db.insertEntry("memory", "今天天气不错");

    const results = db.searchEntries("TypeScript 类型", "memory", 3);

    expect(results[0].content).toContain("TypeScript");
    expect(results[0].final_score!).toBeGreaterThan(results[1].final_score!);
  });

  it("applies temporal decay — entries have decay scores", () => {
    db.insertEntry("memory", "TypeScript 入门教程");
    db.insertEntry("memory", "TypeScript 高级类型");

    const results = db.searchEntries("TypeScript", "memory", 3);

    expect(results.length).toBeGreaterThanOrEqual(2);
    results.forEach(r => {
      expect(r.temporal_decay).toBeDefined();
      expect(r.temporal_decay!).toBeGreaterThan(0);
      expect(r.temporal_decay!).toBeLessThanOrEqual(1);
    });
  });
});

describe("SqliteAdapter — trust feedback", () => {
  it("adjusts trust score up for helpful", () => {
    const id = db.insertEntry("memory", "有用的提示");
    const newTrust = db.markHelpful(id);
    expect(newTrust).toBeGreaterThan(0.5);
  });

  it("adjusts trust score down for unhelpful", () => {
    const id = db.insertEntry("memory", "过时的信息");
    const newTrust = db.markUnhelpful(id);
    expect(newTrust).toBeLessThan(0.5);
  });

  it("clamps trust to [0, 1]", () => {
    const id = db.insertEntry("memory", "测试条目");
    // 多次降分不应低于 0
    for (let i = 0; i < 10; i++) db.markUnhelpful(id);
    const newTrust = db.markUnhelpful(id);
    expect(newTrust).toBe(0);
  });

  it("increments helpful/unhelpful counters", () => {
    const id = db.insertEntry("memory", "计数器测试");
    db.markHelpful(id);
    db.markHelpful(id);
    db.markUnhelpful(id);

    // 通过 searchEntries 验证计数器（搜索结果包含这些字段）
    const results = db.searchEntries("计数器测试", "memory", 1);
    expect(results[0].helpful_count).toBe(2);
    expect(results[0].unhelpful_count).toBe(1);
  });
});
```

- [ ] **Step 2: hrr.test.ts — 接口验证**

```typescript
import { describe, it, expect } from "vitest";
import { StubHrrEncoder } from "./hrr.js";

describe("StubHrrEncoder", () => {
  it("has 1024 dimensions", () => {
    const encoder = new StubHrrEncoder();
    expect(encoder.dim).toBe(1024);
  });

  it("all methods throw 'not implemented'", () => {
    const encoder = new StubHrrEncoder();
    const v = new Float64Array(1024);
    expect(() => encoder.encodeAtom("test")).toThrow("not implemented");
    expect(() => encoder.bind(v, v)).toThrow("not implemented");
    expect(() => encoder.unbind(v, v)).toThrow("not implemented");
    expect(() => encoder.bundle(v, v)).toThrow("not implemented");
    expect(() => encoder.similarity(v, v)).toThrow("not implemented");
  });
});
```

- [ ] **Step 3: 运行全量测试**

```bash
pnpm test
```

Expected: all tests pass (360 + 新增)

- [ ] **Step 4: 编译**

```bash
pnpm build
```

---

### Task 8: 文档同步

**Files:**
- Modify: `PROGRESS.md`
- Modify: `PROGRESS-LITE.md`
- Modify: `STRUCTURE.md`
- Modify: `PLAN-STATUS.md`
- Modify: `docs/项目信息/后端能力清单.md`

- [ ] **Step 1: STRUCTURE.md — 新增 hrr.ts 条目**

在 `packages/core/src/memory/` 区块追加:
```
- `hrr.ts` — HRR 相位向量接口 + Phase 2 桩
```

- [ ] **Step 2: PROGRESS.md + PROGRESS-LITE.md — 追加变更记录**

```bash
# PROGRESS.md 顶部追加详细记录
# PROGRESS-LITE.md 顶部追加: [New Feature] 方案 8: HRR 多策略记忆检索 — FTS5+Jaccard+信任衰减评分管线 + Phase 2 预留
```

- [ ] **Step 3: 后端能力清单 — 记忆检索条目更新**

搜索方式从 "FTS5 + LIKE" 更新为 "FTS5 + Jaccard + 信任衰减多策略融合评分"

- [ ] **Step 4: 最终全量验证**

```bash
pnpm test
pnpm build
```
