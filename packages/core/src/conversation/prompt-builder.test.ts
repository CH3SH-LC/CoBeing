import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { AgentPaths, AgentFiles } from "../agent/paths.js";
import { buildSystemPromptFromFiles } from "./prompt-builder.js";

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

  it("prepends SOUL.md at the very top", () => {
    const paths = new AgentPaths(tmpDir);
    const files = new AgentFiles(paths);
    files.writeSoul("你是一个严谨的工程师。");
    const result = buildSystemPromptFromFiles(files, {
      name: "助手",
      role: "通用助手",
      systemPrompt: "你是助手。",
    });
    const soulIdx = result.indexOf("你是一个严谨的工程师");
    const promptIdx = result.indexOf("你是助手。");
    expect(soulIdx).toBeLessThan(promptIdx);
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

  it("full chain order is correct", () => {
    const paths = new AgentPaths(tmpDir);
    const files = new AgentFiles(paths);
    files.writeSoul("AAA_SOUL");
    files.writeBootstrap("BBB_BOOTSTRAP");
    files.writeAgents("DDD_AGENTS");
    files.writeUser("EEE_USER");
    files.writeMemoryIndex("GGG_MEMORY");

    const result = buildSystemPromptFromFiles(files, {
      name: "助手",
      role: "通用助手",
      systemPrompt: "CCC_PROMPT",
    });

    const soulIdx = result.indexOf("AAA_SOUL");
    const bootIdx = result.indexOf("BBB_BOOTSTRAP");
    const promptIdx = result.indexOf("CCC_PROMPT");
    const agentsIdx = result.indexOf("DDD_AGENTS");
    const userIdx = result.indexOf("EEE_USER");
    const memIdx = result.indexOf("GGG_MEMORY");

    expect(soulIdx).toBeLessThan(bootIdx);
    expect(bootIdx).toBeLessThan(promptIdx);
    expect(promptIdx).toBeLessThan(agentsIdx);
    expect(agentsIdx).toBeLessThan(userIdx);
    expect(userIdx).toBeLessThan(memIdx);
  });
});
