import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { AgentPaths, AgentFiles } from "../agent/paths.js";
import { buildSystemPromptFromFiles, buildCacheablePrompt } from "./prompt-builder.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cobeing-prompt-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("buildSystemPromptFromFiles", () => {
  it("builds prompt from role when no files exist", () => {
    const paths = new AgentPaths(tmpDir);
    const files = new AgentFiles(paths);
    const result = buildSystemPromptFromFiles(files, {
      name: "助手",
      role: "通用助手",
      systemPrompt: "你是助手。",
    });
    expect(result).toContain("你是助手。");
  });

  it("AGENTS.md comes before SOUL.md (shared prefix first)", () => {
    const paths = new AgentPaths(tmpDir);
    const files = new AgentFiles(paths);
    files.writeAgents("工作空间指南");
    files.writeSoul("你是一个严谨的工程师。");
    const result = buildSystemPromptFromFiles(files, {
      name: "助手",
      role: "通用助手",
      systemPrompt: "你是助手。",
    });
    const agentsIdx = result.indexOf("工作空间指南");
    const soulIdx = result.indexOf("你是一个严谨的工程师");
    expect(agentsIdx).toBeLessThan(soulIdx);
  });

  it("includes BOOTSTRAP.md and keeps the file", () => {
    const paths = new AgentPaths(tmpDir);
    const files = new AgentFiles(paths);
    files.writeBootstrap("请先检查工作空间。");
    const result = buildSystemPromptFromFiles(files, {
      name: "助手",
      role: "通用助手",
      systemPrompt: "你是助手。",
    });
    expect(result).toContain("请先检查工作空间。");
    // BOOTSTRAP 不再删除 — 每次构建 prompt 时都会读取
    expect(fs.existsSync(paths.bootstrapPath)).toBe(true);
  });

  it("appends USER.md preferences", () => {
    const paths = new AgentPaths(tmpDir);
    const files = new AgentFiles(paths);
    files.writeUser("用户偏好：简洁回答。");
    const result = buildSystemPromptFromFiles(files, {
      name: "助手",
      role: "通用助手",
      systemPrompt: "你是助手。",
    });
    expect(result).toContain("用户偏好：简洁回答。");
  });

  it("appends AGENTS.md workspace guide", () => {
    const paths = new AgentPaths(tmpDir);
    const files = new AgentFiles(paths);
    files.writeAgents("## 工作指南\n先读后写。");
    const result = buildSystemPromptFromFiles(files, {
      name: "助手",
      role: "通用助手",
      systemPrompt: "你是助手。",
    });
    expect(result).toContain("先读后写。");
  });

  it("appends EXPERIENCE.md when non-trivial (>50 chars)", () => {
    const paths = new AgentPaths(tmpDir);
    const files = new AgentFiles(paths);
    const longExp = "# EXPERIENCE.md\n\n> 经验\n\n" + "## [2026-04-19] test\n- **问题**: foo\n- **解决**: bar\n".repeat(3);
    files.writeExperience(longExp);
    const result = buildSystemPromptFromFiles(files, {
      name: "助手",
      role: "通用助手",
      systemPrompt: "你是助手。",
    });
    expect(result).toContain("你积累的经验");
  });

  it("skips short EXPERIENCE.md (noise)", () => {
    const paths = new AgentPaths(tmpDir);
    const files = new AgentFiles(paths);
    files.writeExperience("short");
    const result = buildSystemPromptFromFiles(files, {
      name: "助手",
      role: "通用助手",
      systemPrompt: "你是助手。",
    });
    expect(result).not.toContain("你积累的经验");
  });

  it("appends MEMORY.md index", () => {
    const paths = new AgentPaths(tmpDir);
    const files = new AgentFiles(paths);
    files.writeMemoryIndex("# 记忆索引\n- 2026-04-19: 完成了某任务");
    const result = buildSystemPromptFromFiles(files, {
      name: "助手",
      role: "通用助手",
      systemPrompt: "你是助手。",
    });
    expect(result).toContain("历史记忆");
  });

  it("full chain order is correct (AGENTS first, BOOTSTRAP after JOB)", () => {
    const paths = new AgentPaths(tmpDir);
    const files = new AgentFiles(paths);
    files.writeAgents("AAA_AGENTS");
    files.writeSoul("BBB_SOUL");
    files.writeBootstrap("EEE_BOOTSTRAP");
    files.writeUser("FFF_USER");
    files.writeMemoryIndex("GGG_MEMORY");

    const result = buildSystemPromptFromFiles(files, {
      name: "助手",
      role: "通用助手",
      systemPrompt: "DDD_PROMPT",
    });

    const agentsIdx = result.indexOf("AAA_AGENTS");
    const soulIdx = result.indexOf("BBB_SOUL");
    const promptIdx = result.indexOf("DDD_PROMPT");
    const bootIdx = result.indexOf("EEE_BOOTSTRAP");
    const userIdx = result.indexOf("FFF_USER");
    const memIdx = result.indexOf("GGG_MEMORY");

    // 新顺序：AGENTS → SOUL → systemPrompt → BOOTSTRAP → USER → MEMORY
    expect(agentsIdx).toBeLessThan(soulIdx);
    expect(soulIdx).toBeLessThan(promptIdx);
    expect(promptIdx).toBeLessThan(bootIdx);
    expect(bootIdx).toBeLessThan(userIdx);
    expect(userIdx).toBeLessThan(memIdx);
  });
});

describe("buildCacheablePrompt", () => {
  it("sharedPrefix is identical for different agents", () => {
    const paths1 = new AgentPaths(fs.mkdtempSync(path.join(os.tmpdir(), "agent1-")));
    const paths2 = new AgentPaths(fs.mkdtempSync(path.join(os.tmpdir(), "agent2-")));
    const files1 = new AgentFiles(paths1);
    const files2 = new AgentFiles(paths2);

    files1.writeSoul("Agent 1 的性格");
    files2.writeSoul("Agent 2 的性格");

    const result1 = buildCacheablePrompt(files1, { name: "A1", role: "角色1", systemPrompt: "prompt1" });
    const result2 = buildCacheablePrompt(files2, { name: "A2", role: "角色2", systemPrompt: "prompt2" });

    // 共享前缀必须完全一致
    expect(result1.sharedPrefix).toBe(result2.sharedPrefix);
    // Agent 前缀必须不同
    expect(result1.agentPrefix).not.toBe(result2.agentPrefix);

    fs.rmSync(paths1.directory, { recursive: true, force: true });
    fs.rmSync(paths2.directory, { recursive: true, force: true });
  });

  it("sharedPrefix (AGENTS.md) comes before agent content in full prompt", () => {
    const paths = new AgentPaths(fs.mkdtempSync(path.join(os.tmpdir(), "cache-")));
    const files = new AgentFiles(paths);
    files.writeAgents("共享的工作空间指南");
    files.writeSoul("我的性格");
    files.writeJob("我的工作");

    const { sharedPrefix, agentPrefix } = buildCacheablePrompt(files, {
      name: "测试", role: "测试角色", systemPrompt: "测试prompt",
    });

    // 共享前缀就是 AGENTS.md 的内容
    expect(sharedPrefix).toContain("共享的工作空间指南");

    // Agent 前缀包含角色特有内容
    expect(agentPrefix).toContain("我的性格");
    expect(agentPrefix).toContain("我的工作");

    // 完整拼接时共享前缀在最前面
    const full = [sharedPrefix, agentPrefix].join("\n\n");
    const sharedIdx = full.indexOf("共享的工作空间指南");
    const soulIdx = full.indexOf("我的性格");
    expect(sharedIdx).toBeLessThan(soulIdx);

    fs.rmSync(paths.directory, { recursive: true, force: true });
  });

  it("volatile contains memory and group context", () => {
    const paths = new AgentPaths(fs.mkdtempSync(path.join(os.tmpdir(), "volatile-")));
    const files = new AgentFiles(paths);
    files.writeUser("用户偏好：简洁回答");

    const { volatile } = buildCacheablePrompt(files, {
      name: "测试", role: "测试角色", systemPrompt: "prompt",
    }, undefined, "# 群组上下文\n队友信息...");

    expect(volatile).toContain("用户偏好：简洁回答");
    expect(volatile).toContain("群组上下文");

    fs.rmSync(paths.directory, { recursive: true, force: true });
  });
});
