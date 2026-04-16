import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { SkillMdLoader } from "./md-loader.js";

describe("SkillMdLoader", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "md-skill-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // Helper: create mock provider getter
  const mockProviderGetter = () =>
    ({
      chat: async function* () {
        yield { type: "content", content: "mock response" };
        yield { type: "done" };
      },
    }) as any;

  it("loads a standalone SKILL.md file", () => {
    const skillDir = path.join(tmpDir, "translation");
    fs.mkdirSync(skillDir);
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), [
      "---",
      "name: translation",
      'description: "翻译文本到指定语言"',
      "metadata:",
      "  tools:",
      "    - read-file",
      "    - write-file",
      '  trigger: "当用户需要翻译时"',
      "---",
      "",
      "# Translation Skill",
      "",
      "将文本翻译为 {{target_language}}。",
      "",
      "## 步骤",
      "",
      "1. 读取源文件",
      "2. 逐段翻译",
    ].join("\n"), "utf-8");

    const loader = new SkillMdLoader();
    loader.load(tmpDir, mockProviderGetter);

    const skills = loader.getSkills();
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("translation");
    expect(skills[0].description).toBe("翻译文本到指定语言");
    expect(skills[0].trigger).toBe("当用户需要翻译时");
    expect(skills[0].prompt).toContain("Translation Skill");
  });

  it("loads skills from subdirectories", () => {
    const reviewDir = path.join(tmpDir, "code-review");
    fs.mkdirSync(reviewDir);
    fs.writeFileSync(path.join(reviewDir, "SKILL.md"), [
      "---",
      "name: code-review",
      "description: Code review skill",
      "---",
      "",
      "# Code Review",
      "Review code quality.",
    ].join("\n"), "utf-8");

    const loader = new SkillMdLoader();
    loader.load(tmpDir, mockProviderGetter);

    expect(loader.getSkills()).toHaveLength(1);
    expect(loader.getSkills()[0].name).toBe("code-review");
  });

  it("detects run.ts companion file", () => {
    const skillDir = path.join(tmpDir, "analyze");
    fs.mkdirSync(skillDir);
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), [
      "---",
      "name: analyze",
      "description: Analyze code",
      "---",
      "",
      "Analyze code.",
    ].join("\n"), "utf-8");
    fs.writeFileSync(path.join(skillDir, "run.ts"), 'console.log("run");', "utf-8");

    const loader = new SkillMdLoader();
    loader.load(tmpDir, mockProviderGetter);

    expect(loader.getSkills()).toHaveLength(1);
    // run.ts detection is logged but skill still loads as prompt type
  });

  it("registers tools with correct names", () => {
    const skillDir = path.join(tmpDir, "test-skill");
    fs.mkdirSync(skillDir);
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), [
      "---",
      "name: test-skill",
      "description: A test",
      "metadata:",
      "  parameters:",
      "    - name: input",
      "      description: test input",
      "      type: string",
      "---",
      "",
      "Test {{input}}.",
    ].join("\n"), "utf-8");

    const loader = new SkillMdLoader();
    loader.load(tmpDir, mockProviderGetter);

    const tools = loader.getTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("skill-test-skill");
    expect(tools[0].description).toBe("A test");
  });

  it("skips invalid SKILL.md without name", () => {
    const skillDir = path.join(tmpDir, "bad-skill");
    fs.mkdirSync(skillDir);
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), [
      "---",
      "description: Missing name",
      "---",
      "",
      "Bad skill.",
    ].join("\n"), "utf-8");

    const loader = new SkillMdLoader();
    loader.load(tmpDir, mockProviderGetter);

    expect(loader.getSkills()).toHaveLength(0);
  });

  it("handles non-existent directory gracefully", () => {
    const loader = new SkillMdLoader();
    loader.load("/nonexistent/path", mockProviderGetter);

    expect(loader.getSkills()).toHaveLength(0);
    expect(loader.getTools()).toHaveLength(0);
  });

  it("handles SKILL.md without frontmatter as plain prompt", () => {
    const skillDir = path.join(tmpDir, "plain");
    fs.mkdirSync(skillDir);
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), "Just some plain text without frontmatter", "utf-8");

    const loader = new SkillMdLoader();
    loader.load(tmpDir, mockProviderGetter);

    // Should skip since no name/description in frontmatter
    expect(loader.getSkills()).toHaveLength(0);
  });
});
