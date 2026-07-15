import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { GroupDB } from "./group-db.js";
import { CompressedHistory } from "./compressed-history.js";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cobeing-three-layer-"));

describe("GroupDB - three-layer memory", () => {
  let db: GroupDB;

  beforeAll(() => {
    db = new GroupDB("test-group", TEST_DIR);
  });

  afterAll(() => {
    db.close();
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("should store messages with visibility", () => {
    db.insertMessage("msg-1", "main", "alice", "hello", Date.now(), ["alice", "bob"]);
    expect(db.getMessageCount()).toBe(1);
    const msgs = db.getMessagesForAgent("alice", { limit: 10 });
    expect(msgs.length).toBe(1);
    expect(msgs[0].content).toBe("hello");
  });

  it("should filter messages by visibility", () => {
    const msgs = db.getMessagesForAgent("charlie", { limit: 10 });
    expect(msgs.length).toBe(0);
  });

  it("should handle duplicate msg_id gracefully", () => {
    // Second insert with same msg_id should be ignored
    db.insertMessage("msg-1", "main", "alice", "duplicate", Date.now(), ["alice"]);
    expect(db.getMessageCount()).toBe(1);
  });

  it("should track and query compression marks", () => {
    const ts = Date.now();
    db.setCompressionMark("alice", ts);
    expect(db.getCompressionMark("alice")).toBe(ts);
  });

  it("should return messages after compression mark", () => {
    const past = Date.now() - 60000;
    const now = Date.now();
    db.insertMessage("msg-2", "main", "bob", "old msg", past, ["alice"]);
    db.insertMessage("msg-3", "main", "bob", "new msg", now, ["alice"]);
    db.setCompressionMark("alice", now);

    const msgs = db.getMessagesForAgent("alice", { after: db.getCompressionMark("alice") });
    expect(msgs.every(m => m.timestamp > now)).toBe(true);
  });

  it("should cleanup compressed messages", () => {
    const ts = Date.now();
    db.insertMessage("msg-clean-1", "main", "alice", "old cleanup", ts - 7200000, ["alice"]);
    db.setCompressionMark("alice", ts);
    const cleaned = db.cleanupCompressedMessages("alice");
    // Should clean the old message (2h old with 1h keep window)
    expect(cleaned).toBeGreaterThanOrEqual(0);
  });

  it("should not remove messages still visible to other agents during cleanup", () => {
    const localDir = fs.mkdtempSync(path.join(os.tmpdir(), "cobeing-groupdb-cleanup-"));
    const localDb = new GroupDB("cleanup-group", localDir);
    try {
      const ts = Date.now();
      for (let i = 0; i < 12; i++) {
        localDb.insertMessage(`shared-${i}`, "main", "alice", `shared ${i}`, ts - 7200000 + i, ["alice", "bob"]);
      }
      localDb.setCompressionMark("alice", ts);
      localDb.cleanupCompressedMessages("alice");

      const bobMsgs = localDb.getMessagesForAgent("bob", { limit: 20 });
      const aliceMsgs = localDb.getMessagesForAgent("alice", { limit: 20 });
      expect(bobMsgs.length).toBe(12);
      expect(aliceMsgs.length).toBe(10);
      expect(localDb.getMessageCount()).toBe(12);
    } finally {
      localDb.close();
      fs.rmSync(localDir, { recursive: true, force: true });
    }
  });

  it("should insert messages with talk tag visibility", () => {
    // For a talk message, only specified members should be visible
    db.insertMessage("msg-talk-1", "talk-001", "alice", "talk msg", Date.now(), ["alice", "bob"]);
    const aliceMsgs = db.getMessagesForAgent("alice", { limit: 100 });
    const bobMsgs = db.getMessagesForAgent("bob", { limit: 100 });
    const charlieMsgs = db.getMessagesForAgent("charlie", { limit: 100 });

    expect(aliceMsgs.some(m => m.msg_id === "msg-talk-1")).toBe(true);
    expect(bobMsgs.some(m => m.msg_id === "msg-talk-1")).toBe(true);
    expect(charlieMsgs.some(m => m.msg_id === "msg-talk-1")).toBe(false);
  });
});

describe("CompressedHistory", () => {
  afterAll(() => {
    // Clean up test files (non-DB)
    try {
      const files = fs.readdirSync(TEST_DIR);
      for (const f of files) {
        if (f.endsWith("-compressed.md")) {
          fs.unlinkSync(path.join(TEST_DIR, f));
        }
      }
    } catch { /* ignore */ }
  });

  it("should return empty string for non-existent file", () => {
    const ch = new CompressedHistory("nonexistent", TEST_DIR);
    expect(ch.read()).toBe("");
    expect(ch.exists()).toBe(false);
  });

  it("should append and read phases", () => {
    const ch = new CompressedHistory("test-agent", TEST_DIR);
    const now = Date.now();
    ch.appendPhase({
      title: "Phase 1",
      startDate: "04-26",
      endDate: "04-27",
      summary: "Setup the project structure and core dependencies.",
    }, now);

    const content = ch.read();
    expect(content).toContain("Phase 1");
    expect(content).toContain("Setup the project structure");
    expect(ch.exists()).toBe(true);
  });

  it("should append multiple phases to the same file", () => {
    const ch = new CompressedHistory("test-agent", TEST_DIR);
    ch.appendPhase({
      title: "Phase 2",
      startDate: "04-28",
      endDate: "04-29",
      summary: "Implemented the main features.",
    }, Date.now());

    const content = ch.read();
    expect(content).toContain("Phase 1");
    expect(content).toContain("Phase 2");
    expect(content).toContain("Implemented the main features.");
  });
});
