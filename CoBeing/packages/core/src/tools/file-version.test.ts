import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { computeFileVersion, checkFileVersion, formatVersionLine } from "./file-version.js";
import { readFileTool } from "./read-file.js";
import { writeFileTool } from "./write-file.js";
import { editFileTool } from "./edit-file.js";

describe("file-version (并发写防护 CAS)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cobeing-version-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const ctx = (agentId: string) => ({ agentId, workingDir: tmpDir } as any);

  it("computeFileVersion returns mtime:size and undefined for missing file", () => {
    const file = path.join(tmpDir, "a.md");
    fs.writeFileSync(file, "hello", "utf-8");
    expect(computeFileVersion(file)).toMatch(/^\d+(\.\d+)?:\d+$/);
    expect(computeFileVersion(path.join(tmpDir, "missing.md"))).toBeUndefined();
  });

  it("checkFileVersion returns undefined when unchanged, current version when changed", () => {
    const file = path.join(tmpDir, "b.md");
    fs.writeFileSync(file, "v1", "utf-8");
    const v1 = computeFileVersion(file)!;
    expect(checkFileVersion(file, v1)).toBeUndefined();
    fs.writeFileSync(file, "v1 with more content", "utf-8");
    const current = checkFileVersion(file, v1);
    expect(current).toBeDefined();
    expect(current).not.toBe(v1);
  });

  it("read-file appends a version line", async () => {
    const file = path.join(tmpDir, "doc.md");
    fs.writeFileSync(file, "line1\nline2", "utf-8");
    const res = await readFileTool.execute({ path: "doc.md" }, ctx("agent-a"));
    expect(res.content).toContain("[file-version: ");
    // 内容行仍在
    expect(res.content).toContain("line1");
  });

  it("write-file rejects when baseVersion is stale (concurrent overwrite guard)", async () => {
    const file = path.join(tmpDir, "shared.md");
    fs.writeFileSync(file, "A wrote this", "utf-8");
    const vBeforeB = computeFileVersion(file)!;

    // Agent B 基于过期版本写入 → 拒绝
    const stale = await writeFileTool.execute(
      { path: "shared.md", content: "B overwrites", baseVersion: "999:1" },
      ctx("agent-b"),
    );
    expect(stale.isError).toBe(true);
    expect(stale.content).toContain("已被其他成员修改");

    // 文件未被覆写
    expect(fs.readFileSync(file, "utf-8")).toBe("A wrote this");

    // Agent B 重新读取（拿到最新版本）后写入 → 成功
    const ok = await writeFileTool.execute(
      { path: "shared.md", content: "B writes after re-read", baseVersion: vBeforeB },
      ctx("agent-b"),
    );
    expect(ok.isError).not.toBe(true);
    expect(fs.readFileSync(file, "utf-8")).toBe("B writes after re-read");
  });

  it("edit-file rejects stale baseVersion and applies on fresh one", async () => {
    const file = path.join(tmpDir, "plan.md");
    fs.writeFileSync(file, "plan: A version", "utf-8");
    const version = computeFileVersion(file)!;

    // 先让另一个 agent 修改文件
    await writeFileTool.execute({ path: "plan.md", content: "plan: A then B" }, ctx("agent-b"));
    const nowVersion = computeFileVersion(file)!;

    const stale = await editFileTool.execute(
      { path: "plan.md", old_string: "A version", new_string: "A then C", baseVersion: version },
      ctx("agent-c"),
    );
    expect(stale.isError).toBe(true);
    expect(stale.content).toContain("已被其他成员修改");

    const ok = await editFileTool.execute(
      { path: "plan.md", old_string: "A then B", new_string: "A then C", baseVersion: nowVersion },
      ctx("agent-c"),
    );
    expect(ok.isError).not.toBe(true);
    expect(fs.readFileSync(file, "utf-8")).toBe("plan: A then C");
  });

  it("first write without baseVersion still works (new file creation)", async () => {
    const res = await writeFileTool.execute(
      { path: "new.md", content: "brand new" },
      ctx("agent-a"),
    );
    expect(res.isError).not.toBe(true);
    expect(fs.readFileSync(path.join(tmpDir, "new.md"), "utf-8")).toBe("brand new");
  });

  it("formatVersionLine returns empty for missing file", () => {
    expect(formatVersionLine(path.join(tmpDir, "nope.md"))).toBe("");
  });
});
