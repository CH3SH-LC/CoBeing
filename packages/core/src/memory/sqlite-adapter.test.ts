import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { SqliteAdapter } from "./sqlite-adapter.js";

let tmpDir: string;
let db: SqliteAdapter;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cobeing-sqlite-"));
  db = SqliteAdapter.create(path.join(tmpDir, "test.db"));
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("SqliteAdapter — entries", () => {
  it("inserts and reads entries", () => {
    db.insertEntry("memory", "first memory");
    db.insertEntry("memory", "second memory");
    const entries = db.getEntries("memory");
    expect(entries).toHaveLength(2);
    expect(entries[0].content).toBe("first memory");
    expect(entries[1].content).toBe("second memory");
  });

  it("replaces all entries for a target", () => {
    db.insertEntry("experience", "old entry");
    db.replaceEntries("experience", [
      { content: "new entry 1", created_at: Date.now() },
      { content: "new entry 2", created_at: Date.now() },
    ]);
    const entries = db.getEntries("experience");
    expect(entries).toHaveLength(2);
    expect(entries[0].content).toBe("new entry 1");
  });

  it("updates an entry by id", () => {
    const id = db.insertEntry("user", "original");
    db.updateEntry(id, "updated");
    const entries = db.getEntries("user");
    expect(entries).toHaveLength(1);
    expect(entries[0].content).toBe("updated");
  });

  it("deletes an entry by id", () => {
    const id = db.insertEntry("tools", "to delete");
    db.deleteEntry(id);
    expect(db.getEntries("tools")).toHaveLength(0);
  });

  it("finds entry by substring", () => {
    db.insertEntry("memory", "the quick brown fox jumps");
    const found = db.findEntryBySubstring("memory", "brown fox");
    expect(found).toBeDefined();
    expect(found!.content).toContain("brown fox");
  });

  it("counts chars for a target", () => {
    db.insertEntry("memory", "hello");
    db.insertEntry("memory", "world");
    expect(db.getCharCount("memory")).toBe(10);
    expect(db.getCharCount("user")).toBe(0);
  });

  it("persists data to disk", () => {
    db.insertEntry("memory", "persistent data");
    db.close();

    const db2 = SqliteAdapter.create(path.join(tmpDir, "test.db"));
    const entries = db2.getEntries("memory");
    expect(entries).toHaveLength(1);
    expect(entries[0].content).toBe("persistent data");
    db2.close();
  });
});

describe("SqliteAdapter — search", () => {
  beforeEach(() => {
    db.insertEntry("memory", "完成了 TypeScript 类型重构");
    db.insertEntry("memory", "优化了 React 渲染性能");
    db.insertEntry("experience", "学会使用 Docker 部署");
  });

  it("searches entries across targets", () => {
    const results = db.searchEntries("TypeScript");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].content).toContain("TypeScript");
  });

  it("filters search by target", () => {
    const results = db.searchEntries("TypeScript", "experience");
    expect(results).toHaveLength(0);
  });

  it("returns empty for no match", () => {
    const results = db.searchEntries("Python");
    expect(results).toHaveLength(0);
  });
});

describe("SqliteAdapter — history", () => {
  it("inserts and searches history", () => {
    db.insertHistory({
      session: "main",
      role: "user",
      content: "帮我重构代码",
      timestamp: Date.now(),
    });
    db.insertHistory({
      session: "main",
      role: "assistant",
      content: "好的，我来帮你重构",
      timestamp: Date.now(),
    });

    const results = db.searchHistory("重构");
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it("filters history by session", () => {
    db.insertHistory({ session: "main", role: "user", content: "main session msg", timestamp: Date.now() });
    db.insertHistory({ session: "group:x:main", role: "user", content: "group session msg", timestamp: Date.now() });

    const results = db.searchHistory("msg", "main");
    expect(results).toHaveLength(1);
    expect(results[0].session).toBe("main");
  });
});

describe("SqliteAdapter — sync state", () => {
  it("stores and retrieves sync mtime", () => {
    expect(db.getSyncMtime("memory")).toBe(0);
    db.setSyncMtime("memory", 12345);
    expect(db.getSyncMtime("memory")).toBe(12345);
  });
});

describe("SqliteAdapter — multi-strategy search", () => {
  it("returns results with scoring fields for matching query", () => {
    db.insertEntry("memory", "今天学习了 TypeScript 泛型编程");
    db.insertEntry("memory", "修复了数据库连接池泄漏的 bug");
    db.insertEntry("memory", "用户偏好使用中文回复");

    const results = db.searchEntries("数据库 连接", "memory", 3);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].content).toContain("数据库");
    expect(results[0].final_score).toBeDefined();
    expect(results[0].jaccard_sim).toBeDefined();
    expect(results[0].fts_score).toBeDefined();
    expect(results[0].temporal_decay).toBeDefined();
  });

  it("scores exact matches higher than unrelated entries", () => {
    db.insertEntry("memory", "TypeScript 类型系统详解");
    db.insertEntry("memory", "今天天气不错 TypeScript 类型无关");

    const results = db.searchEntries("TypeScript 类型", "memory", 3);

    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results[0].content).toContain("TypeScript");
    expect(results[0].final_score!).toBeGreaterThan(results[1].final_score!);
  });

  it("has temporal_decay scores in valid range", () => {
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

  it("returns empty array for no matches", () => {
    db.insertEntry("memory", "some content");
    const results = db.searchEntries("xyzNOTFOUNDxyz", "memory", 3);
    expect(results).toHaveLength(0);
  });

  it("respects limit parameter", () => {
    for (let i = 0; i < 10; i++) {
      db.insertEntry("memory", `测试内容 ${i} TypeScript`);
    }
    const results = db.searchEntries("TypeScript", "memory", 3);
    expect(results.length).toBeLessThanOrEqual(3);
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

  it("clamps trust to 0 at minimum", () => {
    const id = db.insertEntry("memory", "测试条目");
    for (let i = 0; i < 10; i++) db.markUnhelpful(id);
    const newTrust = db.markUnhelpful(id);
    expect(newTrust).toBe(0);
  });

  it("increments helpful/unhelpful counters", () => {
    const id = db.insertEntry("memory", "计数器测试");
    db.markHelpful(id);
    db.markHelpful(id);
    db.markUnhelpful(id);

    const results = db.searchEntries("计数器测试", "memory", 1);
    expect(results[0].helpful_count).toBe(2);
    expect(results[0].unhelpful_count).toBe(1);
  });
});
