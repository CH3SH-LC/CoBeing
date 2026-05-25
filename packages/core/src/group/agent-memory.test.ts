import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { GroupAgentMemory } from "./agent-memory.js";

describe("GroupAgentMemory", () => {
  let tmpDir: string;
  let mem: GroupAgentMemory;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-mem-test-"));
    mem = new GroupAgentMemory("agent-1", tmpDir);
  });

  afterEach(() => {
    mem.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("syncs messages incrementally", () => {
    mem.syncMessages([
      { msgId: "msg-0001", tag: "main", fromAgentId: "owner", content: "hello", timestamp: 1000 },
      { msgId: "msg-0002", tag: "main", fromAgentId: "agent-2", content: "world", timestamp: 2001 },
    ]);
    expect(mem.getMessageCount()).toBe(2);

    // 再次同步，应该跳过已有的
    mem.syncMessages([
      { msgId: "msg-0001", tag: "main", fromAgentId: "owner", content: "hello", timestamp: 1000 },
      { msgId: "msg-0002", tag: "main", fromAgentId: "agent-2", content: "world", timestamp: 2001 },
      { msgId: "msg-0003", tag: "main", fromAgentId: "owner", content: "new", timestamp: 3000 },
    ]);
    expect(mem.getMessageCount()).toBe(3);
  });

  it("searches messages with FTS5", () => {
    mem.syncMessages([
      { msgId: "msg-0001", tag: "main", fromAgentId: "owner", content: "使用 SQLite 存储方案", timestamp: 1000 },
      { msgId: "msg-0002", tag: "main", fromAgentId: "agent-2", content: "React 组件设计", timestamp: 2001 },
    ]);

    const results = mem.search("SQLite");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].content).toContain("SQLite");
  });

  it("adds and searches fragments", () => {
    mem.addFragment("关键决策：使用 better-sqlite3", "架构决策", "msg-0001");
    const results = mem.searchFragments("better-sqlite3");
    expect(results).toHaveLength(1);
    expect(results[0].reason).toBe("架构决策");
  });

  it("gets recent messages", () => {
    for (let i = 0; i < 10; i++) {
      mem.syncMessages([{ msgId: `msg-${i}`, tag: "main", fromAgentId: "a", content: `msg ${i}`, timestamp: i }]);
    }
    const recent = mem.getRecentMessages(3);
    expect(recent).toHaveLength(3);
    expect(recent[0].content).toBe("msg 9");
  });

  it("handles CJK tokenization in search", () => {
    mem.syncMessages([
      { msgId: "msg-0001", tag: "main", fromAgentId: "owner", content: "完成了TypeScript重构工作", timestamp: 1000 },
    ]);

    const results = mem.search("重构");
    expect(results.length).toBeGreaterThanOrEqual(1);
  });
});
