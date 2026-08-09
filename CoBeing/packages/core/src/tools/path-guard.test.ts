import { describe, it, expect } from "vitest";
import path from "node:path";
import { detectDataPathMisuse } from "./path-guard.js";

const workingDir = path.join("D:", "agent-codes", "CoBeing", "data", "coreagents", "butler", "workspace");

describe("detectDataPathMisuse", () => {
  it("合法的工作目录内相对路径返回 null", () => {
    expect(detectDataPathMisuse(workingDir, "note.md")).toBeNull();
    expect(detectDataPathMisuse(workingDir, "docs/note.md")).toBeNull();
    expect(detectDataPathMisuse(workingDir, "./note.md")).toBeNull();
    expect(detectDataPathMisuse(workingDir, "sub/深目录/文件.md")).toBeNull();
  });

  it("空参数返回 null", () => {
    expect(detectDataPathMisuse(workingDir, "")).toBeNull();
    expect(detectDataPathMisuse(workingDir, undefined as unknown as string)).toBeNull();
  });

  it("绝对路径交给 containment 处理，helper 不拦截", () => {
    expect(detectDataPathMisuse(workingDir, path.join("D:", "x", "note.md"))).toBeNull();
    expect(detectDataPathMisuse(workingDir, "D:/x/note.md")).toBeNull();
  });

  it("逃逸路径交给 containment 处理，helper 不拦截", () => {
    expect(detectDataPathMisuse(workingDir, "../escape.md")).toBeNull();
  });

  it("双重拼接模式（工作目录完整路径作为相对路径）被拦截", () => {
    const misuse = detectDataPathMisuse(workingDir, "data/coreagents/butler/workspace/日程.md");
    expect(misuse).not.toBeNull();
    expect(misuse!).toContain("不要以 data/");
  });

  it("data/ 前缀的项目相对路径被拦截", () => {
    expect(detectDataPathMisuse(workingDir, "data/agents/张三/note.md")).not.toBeNull();
    expect(detectDataPathMisuse(workingDir, "data/groups/某群/workspace/x.md")).not.toBeNull();
    expect(detectDataPathMisuse(workingDir, "data/skills/foo.md")).not.toBeNull();
  });

  it("coreagents/agents/groups 段开头的路径被拦截", () => {
    expect(detectDataPathMisuse(workingDir, "coreagents/butler/JOB.md")).not.toBeNull();
    expect(detectDataPathMisuse(workingDir, "agents/xxx/note.md")).not.toBeNull();
    expect(detectDataPathMisuse(workingDir, "groups/yyy/note.md")).not.toBeNull();
  });

  it("反斜杠分隔的 data 前缀路径也被拦截（Windows）", () => {
    expect(detectDataPathMisuse(workingDir, "data\\coreagents\\butler\\workspace\\日程.md")).not.toBeNull();
  });

  it("模拟测试数据目录（data-sim-chenmo）被拦截", () => {
    expect(detectDataPathMisuse(workingDir, "data-sim-chenmo/agents/张三/note.md")).not.toBeNull();
    expect(detectDataPathMisuse(workingDir, "data-sim-chenmo/groups/某群/workspace/x.md")).not.toBeNull();
  });

  it("备份目录（.bak 后缀段）被拦截", () => {
    expect(detectDataPathMisuse(workingDir, "data-sim-chenmo.bak-20260808/agents/购物顾问/JOB.md")).not.toBeNull();
    expect(detectDataPathMisuse(workingDir, "data.bak/note.md")).not.toBeNull();
    expect(detectDataPathMisuse(workingDir, "foo.bak-2026/bar.md")).not.toBeNull();
  });

  it("正常文件名的 .bak 子串不受影响（仅段首）", () => {
    expect(detectDataPathMisuse(workingDir, "note.bak.md")).toBeNull();
  });
});
