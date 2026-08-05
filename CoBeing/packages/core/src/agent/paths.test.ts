import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { AgentPaths, AgentFiles } from "./paths.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cobeing-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("AgentPaths", () => {
  it("resolves paths from base dir", () => {
    const p = new AgentPaths(tmpDir);
    expect(p.characterPath).toBe(path.join(tmpDir, "CHARACTER.md"));
    expect(p.jobPath).toBe(path.join(tmpDir, "JOB.md"));
    expect(p.memoryDir).toBe(path.join(tmpDir, "memory"));
    expect(p.workspaceDir).toBe(path.join(tmpDir, "workspace"));
  });

  it("ensures dirs exist", () => {
    const p = new AgentPaths(tmpDir);
    p.ensureDirs();
    expect(fs.existsSync(p.memoryDir)).toBe(true);
    expect(fs.existsSync(p.workspaceDir)).toBe(true);
    expect(fs.existsSync(p.skillsDir)).toBe(true);
  });

  it("rejects unsafe agent ids", () => {
    expect(() => AgentPaths.forAgent("../escape", tmpDir)).toThrow(/Invalid agentId/);
    expect(() => AgentPaths.forAgent("nested/escape", tmpDir)).toThrow(/Invalid agentId/);
    expect(() => AgentPaths.forAgent("agent:bad", tmpDir)).toThrow(/Invalid agentId/);
  });

  it("allows existing Unicode agent ids", () => {
    const p = AgentPaths.forAgent("高三语文教师", tmpDir);
    expect(p.directory).toBe(path.join(tmpDir, "agents", "高三语文教师"));
  });
});

describe("AgentFiles", () => {
  it("writes and reads CHARACTER.md", () => {
    const f = new AgentFiles(new AgentPaths(tmpDir));
    f.writeCharacter("# CHARACTER.md\n- Name: TestBot");
    expect(f.readCharacter()).toBe("# CHARACTER.md\n- Name: TestBot");
  });

  it("returns empty string for missing CHARACTER.md", () => {
    const f = new AgentFiles(new AgentPaths(tmpDir));
    expect(f.readCharacter()).toBe("");
  });

  it("writes and reads EXPRESSION.md (人味表达规范)", () => {
    const f = new AgentFiles(new AgentPaths(tmpDir));
    f.writeExpression("# EXPRESSION.md\n- 群聊回复 ≤3 句");
    expect(f.readExpression()).toBe("# EXPRESSION.md\n- 群聊回复 ≤3 句");
  });

  it("returns empty string for missing EXPRESSION.md", () => {
    const f = new AgentFiles(new AgentPaths(tmpDir));
    expect(f.readExpression()).toBe("");
  });

  it("writes and reads JOB.md", () => {
    const f = new AgentFiles(new AgentPaths(tmpDir));
    f.writeJob("# JOB.md\n- 角色: 测试员");
    expect(f.readJob()).toBe("# JOB.md\n- 角色: 测试员");
  });

  it("returns empty string for missing JOB.md", () => {
    const f = new AgentFiles(new AgentPaths(tmpDir));
    expect(f.readJob()).toBe("");
  });

  it("writes and reads config.json", () => {
    const f = new AgentFiles(new AgentPaths(tmpDir));
    f.writeConfig({ tools: ["bash"], permissions: { mode: "full-access" } });
    const cfg = f.readConfig();
    expect(cfg.tools).toEqual(["bash"]);
  });

  it("returns empty config for missing file", () => {
    const f = new AgentFiles(new AgentPaths(tmpDir));
    expect(f.readConfig()).toEqual({});
  });

});
