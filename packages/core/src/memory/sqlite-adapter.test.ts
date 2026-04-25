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
