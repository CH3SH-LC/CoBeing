import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { MemoryWriter } from "./writer.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cobeing-mem-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("MemoryWriter", () => {
  it("creates memory dir if missing", () => {
    const dir = path.join(tmpDir, "mem");
    new MemoryWriter(dir);
    expect(fs.existsSync(dir)).toBe(true);
  });

  it("appends user message to today file", () => {
    const w = new MemoryWriter(tmpDir);
    w.append({ session: "main", role: "user", content: "hello" });
    const today = new Date().toISOString().split("T")[0];
    const filePath = path.join(tmpDir, `${today}.md`);
    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, "utf-8");
    expect(content).toContain("**User:** hello");
    expect(content).toContain("[main]");
  });

  it("appends tool call with name", () => {
    const w = new MemoryWriter(tmpDir);
    w.append({ session: "main", role: "tool", content: "file1.ts\nfile2.ts", toolName: "glob" });
    const today = new Date().toISOString().split("T")[0];
    const content = fs.readFileSync(path.join(tmpDir, `${today}.md`), "utf-8");
    expect(content).toContain("**Tool: glob**");
  });

  it("creates file with header on first write", () => {
    const w = new MemoryWriter(tmpDir);
    w.append({ session: "main", role: "user", content: "test" });
    const today = new Date().toISOString().split("T")[0];
    const content = fs.readFileSync(path.join(tmpDir, `${today}.md`), "utf-8");
    expect(content.startsWith(`# ${today} 对话记录`)).toBe(true);
  });
});
