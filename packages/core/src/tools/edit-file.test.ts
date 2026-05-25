import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { editFileTool } from "./edit-file.js";

const workingDir = path.join(os.tmpdir(), "cobeing-test-edit-" + Date.now());

beforeEach(() => {
  fs.mkdirSync(workingDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(workingDir, { recursive: true, force: true });
});

function ctx() {
  return {
    agentId: "test-agent",
    sessionId: "s1",
    workingDir,
    sandbox: {
      enabled: false,
      filesystem: "isolated" as const,
      network: { enabled: false, mode: "all" as const },
    },
    permissions: { mode: "full-access" as const },
  };
}

describe("editFileTool", () => {
  it("replaces a single occurrence of old_string", async () => {
    fs.writeFileSync(path.join(workingDir, "test.txt"), "hello world");
    const result = await editFileTool.execute(
      { path: "test.txt", old_string: "hello", new_string: "hi" },
      ctx(),
    );
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain("Edit applied to test.txt");
    expect(result.content).toContain("- occurrences: 1");
    const updated = fs.readFileSync(path.join(workingDir, "test.txt"), "utf-8");
    expect(updated).toBe("hi world");
  });

  it("replace_all replaces all occurrences", async () => {
    fs.writeFileSync(path.join(workingDir, "test.txt"), "aa bb aa cc aa");
    const result = await editFileTool.execute(
      { path: "test.txt", old_string: "aa", new_string: "xx", replace_all: true },
      ctx(),
    );
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain("- occurrences: 3");
    const updated = fs.readFileSync(path.join(workingDir, "test.txt"), "utf-8");
    expect(updated).toBe("xx bb xx cc xx");
  });

  it("rejects when old_string equals new_string", async () => {
    fs.writeFileSync(path.join(workingDir, "test.txt"), "hello");
    const result = await editFileTool.execute(
      { path: "test.txt", old_string: "hello", new_string: "hello" },
      ctx(),
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain("must be different");
  });

  it("returns error when old_string not found", async () => {
    fs.writeFileSync(path.join(workingDir, "test.txt"), "hello world");
    const result = await editFileTool.execute(
      { path: "test.txt", old_string: "goodbye", new_string: "hi" },
      ctx(),
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain("not found in file");
    expect(result.content).toContain("read the file first");
  });

  it("rejects when old_string appears multiple times without replace_all", async () => {
    fs.writeFileSync(path.join(workingDir, "test.txt"), "dup at start. some text. dup at end.");
    const result = await editFileTool.execute(
      { path: "test.txt", old_string: "dup", new_string: "xxx" },
      ctx(),
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain("不唯一");
  });

  it("includes old/new preview in output", async () => {
    fs.writeFileSync(path.join(workingDir, "test.txt"), "alpha beta gamma");
    const result = await editFileTool.execute(
      { path: "test.txt", old_string: "beta", new_string: "delta" },
      ctx(),
    );
    expect(result.content).toContain("- old: beta");
    expect(result.content).toContain("- new: delta");
  });

  it("truncates old/new preview at 80 characters", async () => {
    const longStr = "a".repeat(100);
    const shortStr = "b";
    fs.writeFileSync(path.join(workingDir, "test.txt"), longStr);
    const result = await editFileTool.execute(
      { path: "test.txt", old_string: longStr, new_string: shortStr },
      ctx(),
    );
    expect(result.content).toContain("- old: " + "a".repeat(80) + "...");
    expect(result.content).toContain("- new: b");
  });

  it("returns error when file does not exist", async () => {
    const result = await editFileTool.execute(
      { path: "nonexistent.txt", old_string: "x", new_string: "y" },
      ctx(),
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain("编辑文件失败");
  });
});
