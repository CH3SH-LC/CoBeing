import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { AgentPaths, AgentFiles } from "../agent/paths.js";
import { buildSystemPromptFromFiles, buildCacheablePrompt, buildStaticLayer, GROUP_MECHANICS_NOTICE, extractExperienceSummary, maintainExperienceSummarySync } from "./prompt-builder.js";

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

  it("STATIC layer comes first, then AGENTS.md", () => {
    const paths = new AgentPaths(tmpDir);
    const files = new AgentFiles(paths);
    files.writeAgents("工作空间指南");
    const result = buildSystemPromptFromFiles(files, {
      name: "助手",
      role: "通用助手",
      systemPrompt: "你是助手。",
    });
    const staticIdx = result.indexOf("# Identity");
    const agentsIdx = result.indexOf("工作空间指南");
    expect(staticIdx).toBeLessThan(agentsIdx);
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

  it("full chain order is correct (AGENTS first, then MEMORY)", () => {
    const paths = new AgentPaths(tmpDir);
    const files = new AgentFiles(paths);
    files.writeAgents("AAA_AGENTS");
    files.writeMemoryIndex("GGG_MEMORY");

    const result = buildSystemPromptFromFiles(files, {
      name: "助手",
      role: "通用助手",
      systemPrompt: "DDD_PROMPT",
    });

    const staticIdx = result.indexOf("# Identity");
    const agentsIdx = result.indexOf("AAA_AGENTS");
    expect(staticIdx).toBeLessThan(agentsIdx);
    const promptIdx = result.indexOf("DDD_PROMPT");
    const memIdx = result.indexOf("GGG_MEMORY");

    // Order: STATIC → AGENTS → systemPrompt → MEMORY
    expect(agentsIdx).toBeLessThan(promptIdx);
    expect(promptIdx).toBeLessThan(memIdx);
  });
});

describe("buildStaticLayer", () => {
  it("returns string containing all 5 sections", () => {
    const result = buildStaticLayer();
    expect(result).toContain("# Identity");
    expect(result).toContain("# System");
    expect(result).toContain("# Doing tasks");
    expect(result).toContain("# Executing actions with care");
    expect(result).toContain("# Speaking style");
  });

  it("does not contain group environment mechanics", () => {
    const result = buildStaticLayer();
    expect(result).not.toContain("群组协作环境");
    expect(result).not.toContain("group-send");
  });

  it("returns identical results on every call", () => {
    const r1 = buildStaticLayer();
    const r2 = buildStaticLayer();
    expect(r1).toBe(r2);
  });

  it("contains behavior rules from claw-code", () => {
    const result = buildStaticLayer();
    expect(result).toContain("Three similar lines beats a premature abstraction");
    expect(result).toContain("Prefer editing existing files over creating new ones");
    expect(result).toContain("Default to no comments");
    expect(result).toContain("Do not narrate what you are about to do");
  });

  it("contains execution safety rules", () => {
    const result = buildStaticLayer();
    expect(result).toContain("Carefully consider reversibility and blast radius");
    expect(result).toContain("High-blast-radius actions");
  });

  it("contains speaking style rules", () => {
    const result = buildStaticLayer();
    expect(result).toContain("When executing tasks: be direct and efficient");
    expect(result).toContain("follow the expression rules in your files");
    expect(result).toContain("like a colleague, not a customer service bot");
  });
});

describe("GROUP_MECHANICS_NOTICE", () => {
  it("is a non-empty string", () => {
    expect(typeof GROUP_MECHANICS_NOTICE).toBe("string");
    expect(GROUP_MECHANICS_NOTICE.length).toBeGreaterThan(50);
  });

  it("contains group collaboration keywords", () => {
    expect(GROUP_MECHANICS_NOTICE).toContain("群组协作环境");
    expect(GROUP_MECHANICS_NOTICE).toContain("group-send");
    expect(GROUP_MECHANICS_NOTICE).toContain("@mention");
  });
});

describe("buildCacheablePrompt", () => {
  it("sharedPrefix is identical for different agents", () => {
    const paths1 = new AgentPaths(fs.mkdtempSync(path.join(os.tmpdir(), "agent1-")));
    const paths2 = new AgentPaths(fs.mkdtempSync(path.join(os.tmpdir(), "agent2-")));
    const files1 = new AgentFiles(paths1);
    const files2 = new AgentFiles(paths2);

    const result1 = buildCacheablePrompt(files1, { name: "A1", role: "角色1", systemPrompt: "prompt1" });
    const result2 = buildCacheablePrompt(files2, { name: "A2", role: "角色2", systemPrompt: "prompt2" });

    // 共享前缀必须完全一致
    expect(result1.sharedPrefix).toBe(result2.sharedPrefix);
    // Agent 前缀必须不同
    expect(result1.agentPrefix).not.toBe(result2.agentPrefix);

    fs.rmSync(paths1.directory, { recursive: true, force: true });
    fs.rmSync(paths2.directory, { recursive: true, force: true });
  });

  it("sharedPrefix (static layer + AGENTS.md) comes before agent content in full prompt", () => {
    const paths = new AgentPaths(fs.mkdtempSync(path.join(os.tmpdir(), "cache-")));
    const files = new AgentFiles(paths);
    files.writeAgents("共享的工作空间指南");
    files.writeJob("我的工作");

    const { sharedPrefix, agentPrefix } = buildCacheablePrompt(files, {
      name: "测试", role: "测试角色", systemPrompt: "测试prompt",
    });

    // 共享前缀包含 STATIC 层和 AGENTS.md 的内容
    expect(sharedPrefix).toContain("# Identity");
    expect(sharedPrefix).toContain("共享的工作空间指南");

    // Agent 前缀包含角色特有内容
    expect(agentPrefix).toContain("我的工作");

    // 完整拼接时共享前缀在最前面
    const full = [sharedPrefix, agentPrefix].join("\n\n");
    const sharedIdx = full.indexOf("共享的工作空间指南");
    const jobIdx = full.indexOf("我的工作");
    expect(sharedIdx).toBeLessThan(jobIdx);

    fs.rmSync(paths.directory, { recursive: true, force: true });
  });

  it("volatile contains memory and group context", () => {
    const paths = new AgentPaths(fs.mkdtempSync(path.join(os.tmpdir(), "volatile-")));
    const files = new AgentFiles(paths);
    const { volatile } = buildCacheablePrompt(files, {
      name: "测试", role: "测试角色", systemPrompt: "prompt",
    }, undefined, "# 群组上下文\n队友信息...");

    expect(volatile).toContain("群组上下文");

    fs.rmSync(paths.directory, { recursive: true, force: true });
  });

  it("omits private memory and experience when building group volatile context", () => {
    const paths = new AgentPaths(fs.mkdtempSync(path.join(os.tmpdir(), "group-volatile-")));
    const files = new AgentFiles(paths);
    files.writeMemoryIndex("PRIVATE_MEMORY_TOKEN");
    files.writeExperience("PRIVATE_EXPERIENCE_TOKEN ".repeat(4));

    const { volatile } = buildCacheablePrompt(files, {
      name: "Group Member", role: "member", systemPrompt: "prompt",
    }, undefined, "GROUP_CONTEXT_TOKEN");

    expect(volatile).toContain("GROUP_CONTEXT_TOKEN");
    expect(volatile).not.toContain("PRIVATE_MEMORY_TOKEN");
    expect(volatile).not.toContain("PRIVATE_EXPERIENCE_TOKEN");

    fs.rmSync(paths.directory, { recursive: true, force: true });
  });
});

describe("extractExperienceSummary", () => {
  it("returns content between summary markers", () => {
    const content = `# EXPERIENCE\n<!-- EXPERIENCE_SUMMARY_START -->\n## 概要\n- [2026-05-25] 测试经验\n<!-- EXPERIENCE_SUMMARY_END -->\n\n## 正文\n详细内容`;
    const result = extractExperienceSummary(content);
    expect(result).toContain("## 概要");
    expect(result).toContain("测试经验");
    expect(result).not.toContain("详细内容");
  });

  it("returns full content when no markers present (backward compat)", () => {
    const content = "# 旧格式 EXPERIENCE\n\n- 没有标记的经验";
    const result = extractExperienceSummary(content);
    expect(result).toContain("旧格式");
  });

  it("returns empty string for empty input", () => {
    expect(extractExperienceSummary("")).toBe("");
  });

  it("truncates from end when over maxChars (keeps newest)", () => {
    const lines: string[] = [];
    for (let i = 1; i <= 50; i++) {
      lines.push(`- [2026-01-${String(i).padStart(2, "0")}] 经验条目 ${i}`);
    }
    const content = `<!-- EXPERIENCE_SUMMARY_START -->\n## 经验概要\n${lines.join("\n")}\n<!-- EXPERIENCE_SUMMARY_END -->`;
    const result = extractExperienceSummary(content, 300);
    expect(result).toContain("经验条目 50");
    expect(result).not.toContain("经验条目 1");
    expect(result.length).toBeLessThanOrEqual(400);
  });
});

describe("maintainExperienceSummarySync", () => {
  it("inserts summary line into file with existing markers", () => {
    const content = `# EXPERIENCE\n<!-- EXPERIENCE_SUMMARY_START -->\n## 经验概要\n- [2026-05-24] 旧经验\n<!-- EXPERIENCE_SUMMARY_END -->\n\n## 详细\n正文`;
    const result = maintainExperienceSummarySync(content, "- [2026-05-25] 新经验");
    expect(result).toContain("新经验");
    expect(result).toContain("旧经验");
    expect(result).toContain("正文");
  });

  it("creates markers when file has no markers", () => {
    const content = "# 没有标记的旧文件\n\n## 正文\n内容";
    const result = maintainExperienceSummarySync(content, "- [2026-05-25] 第一条");
    expect(result).toContain("<!-- EXPERIENCE_SUMMARY_START -->");
    expect(result).toContain("第一条");
    expect(result).toContain("没有标记的旧文件");
  });
});
