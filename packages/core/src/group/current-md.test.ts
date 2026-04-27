import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { CurrentMd } from "./current-md.js";

describe("CurrentMd", () => {
  let tmpDir: string;
  let current: CurrentMd;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "current-md-test-"));
    current = new CurrentMd(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("appends messages to in-memory state", () => {
    current.append({ id: "msg-1", tag: "main", fromAgentId: "a", content: "hello", timestamp: 1000 });
    current.append({ id: "msg-2", tag: "main", fromAgentId: "b", content: "world", timestamp: 2001 });

    const text = current.readAsContext();
    expect(text).toContain("[a]: hello");
    expect(text).toContain("[b]: world");
  });

  it("rolls to keep last N messages in memory", () => {
    for (let i = 0; i < 10; i++) {
      current.append({ id: `msg-${i}`, tag: "main", fromAgentId: "a", content: `msg ${i}`, timestamp: i });
    }
    current.roll(3);

    const text = current.readAsContext();
    expect(text).toContain("[a]: msg 7");
    expect(text).toContain("[a]: msg 8");
    expect(text).toContain("[a]: msg 9");
    expect(text).not.toContain("msg 6");
  });

  it("formats as context text", () => {
    current.append({ id: "msg-1", tag: "main", fromAgentId: "owner", content: "任务开始", timestamp: 1000 });
    current.append({ id: "msg-2", tag: "talk-001", fromAgentId: "dev", content: "我来处理", timestamp: 2001 });

    const text = current.readAsContext();
    expect(text).toContain("[owner]: 任务开始");
    expect(text).toContain("[Talk: talk-001] [dev]: 我来处理");
  });

  it("does not write to file on append", () => {
    const filePath = path.join(tmpDir, "current.md");
    current.append({ id: "msg-1", tag: "main", fromAgentId: "a", content: "hi", timestamp: 1000 });
    // File should not be created — persistence is handled by save_chat_current
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it("returns empty string for readAsContext when no messages", () => {
    expect(current.readAsContext()).toBe("");
  });

  it("roll is no-op when in-memory is empty", () => {
    const freshDir = fs.mkdtempSync(path.join(os.tmpdir(), "fresh-"));
    const fresh = new CurrentMd(freshDir);
    fresh.roll(10); // should not throw
    fs.rmSync(freshDir, { recursive: true, force: true });
  });
});
