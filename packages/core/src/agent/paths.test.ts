import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { AgentPaths, AgentFiles } from "./paths.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "myagents-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("AgentPaths", () => {
  it("resolves paths from base dir", () => {
    const p = new AgentPaths(tmpDir);
    expect(p.identityPath).toBe(path.join(tmpDir, "IDENTITY.md"));
    expect(p.memoryDir).toBe(path.join(tmpDir, "memory"));
    expect(p.workspaceDir).toBe(path.join(tmpDir, "workspace"));
  });

  it("resolves new paths (user, bootstrap, tools)", () => {
    const p = new AgentPaths(tmpDir);
    expect(p.userPath).toBe(path.join(tmpDir, "USER.md"));
    expect(p.bootstrapPath).toBe(path.join(tmpDir, "BOOTSTRAP.md"));
    expect(p.toolsPath).toBe(path.join(tmpDir, "TOOLS.md"));
  });

  it("ensures dirs exist", () => {
    const p = new AgentPaths(tmpDir);
    p.ensureDirs();
    expect(fs.existsSync(p.memoryDir)).toBe(true);
    expect(fs.existsSync(p.workspaceDir)).toBe(true);
    expect(fs.existsSync(p.skillsDir)).toBe(true);
  });
});

describe("AgentFiles", () => {
  it("writes and reads IDENTITY.md", () => {
    const p = new AgentPaths(tmpDir);
    const f = new AgentFiles(p);
    f.writeIdentity({ name: "TestBot", emoji: "🤖", creature: "a test robot" });
    const id = f.readIdentity();
    expect(id.name).toBe("TestBot");
    expect(id.emoji).toBe("🤖");
    expect(id.creature).toBe("a test robot");
  });

  it("returns empty identity for missing file", () => {
    const f = new AgentFiles(new AgentPaths(tmpDir));
    const id = f.readIdentity();
    expect(id.name).toBeUndefined();
  });

  it("writes and reads SOUL.md", () => {
    const f = new AgentFiles(new AgentPaths(tmpDir));
    f.writeSoul("你是一个测试机器人。");
    expect(f.readSoul()).toBe("你是一个测试机器人。");
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
