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
  it("writes and reads CHARACTER.md", () => {
    const f = new AgentFiles(new AgentPaths(tmpDir));
    f.writeCharacter("# CHARACTER.md\n- Name: TestBot");
    expect(f.readCharacter()).toBe("# CHARACTER.md\n- Name: TestBot");
  });

  it("returns empty string for missing CHARACTER.md", () => {
    const f = new AgentFiles(new AgentPaths(tmpDir));
    expect(f.readCharacter()).toBe("");
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

  it("writes and reads USER.md", () => {
    const f = new AgentFiles(new AgentPaths(tmpDir));
    f.writeUser("用户偏好：简洁回答，使用中文。");
    expect(f.readUser()).toBe("用户偏好：简洁回答，使用中文。");
  });

  it("returns empty string for missing USER.md", () => {
    const f = new AgentFiles(new AgentPaths(tmpDir));
    expect(f.readUser()).toBe("");
  });

  it("writes and reads BOOTSTRAP.md", () => {
    const f = new AgentFiles(new AgentPaths(tmpDir));
    f.writeBootstrap("首次启动时请完成以下任务：...");
    expect(f.readBootstrap()).toBe("首次启动时请完成以下任务：...");
  });

  it("returns empty string for missing BOOTSTRAP.md", () => {
    const f = new AgentFiles(new AgentPaths(tmpDir));
    expect(f.readBootstrap()).toBe("");
  });

  it("writes and reads TOOLS.md", () => {
    const f = new AgentFiles(new AgentPaths(tmpDir));
    f.writeTools("## bash\n默认 shell: zsh");
    expect(f.readTools()).toBe("## bash\n默认 shell: zsh");
  });

  it("consumeBootstrap returns content without deleting", () => {
    const f = new AgentFiles(new AgentPaths(tmpDir));
    f.writeBootstrap("一次性引导内容");
    const content = f.consumeBootstrap();
    expect(content).toBe("一次性引导内容");
    // BOOTSTRAP 不再删除 — 在创建后和加入群组时都需要重新激发
    expect(f.readBootstrap()).toBe("一次性引导内容");
  });

  it("returns empty for consumeBootstrap when no file", () => {
    const f = new AgentFiles(new AgentPaths(tmpDir));
    expect(f.consumeBootstrap()).toBe("");
  });
});
