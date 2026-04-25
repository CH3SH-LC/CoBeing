/**
 * SkillRepository — 统一技能仓库（Phase 8.2）
 *
 * 从唯一的 skills/ 目录加载 SKILL.md 格式技能。
 * 替代旧版 SkillLoader（YAML/JSON）+ SkillMdLoader（私有目录）。
 *
 * 对外提供：
 * - list() — 列出所有可用技能
 * - get(name) — 获取指定技能
 * - create(name, description, prompt) — 创建新技能
 * - search(keyword) — 关键词搜索
 * - execute(name, task, params, provider) — 执行技能
 */
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import type { LLMProvider } from "@cobeing/providers";
import { createLogger } from "@cobeing/shared";

const log = createLogger("skill-repository");

export interface SkillInfo {
  name: string;
  description: string;
  dirPath: string;
}

interface ParsedSkill {
  name: string;
  description: string;
  body: string;
  dirPath: string;
  parameters?: Array<{
    name: string;
    description?: string;
    type?: string;
    default?: string;
  }>;
}

/**
 * 解析 SKILL.md 的 frontmatter 和 body
 */
function parseSkillMd(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith("---")) {
    return { frontmatter: {}, body: content };
  }
  const endMatch = trimmed.indexOf("\n---", 3);
  if (endMatch === -1) {
    return { frontmatter: {}, body: content };
  }
  const frontmatterStr = trimmed.slice(3, endMatch).trim();
  const body = trimmed.slice(endMatch + 4).trim();
  try {
    const frontmatter = yaml.load(frontmatterStr) as Record<string, unknown>;
    return { frontmatter, body };
  } catch {
    log.warn("Failed to parse frontmatter");
    return { frontmatter: {}, body: content };
  }
}

/**
 * 从目录加载一个 SKILL.md
 */
function loadSkillFromDir(dirPath: string): ParsedSkill | null {
  const mdPath = path.join(dirPath, "SKILL.md");
  if (!fs.existsSync(mdPath)) return null;

  const content = fs.readFileSync(mdPath, "utf-8");
  const { frontmatter, body } = parseSkillMd(content);

  const name = frontmatter.name as string | undefined;
  const description = frontmatter.description as string | undefined;
  if (!name || !description) {
    log.warn("SKILL.md missing name or description: %s", mdPath);
    return null;
  }

  const metadata = frontmatter.metadata as Record<string, unknown> | undefined;
  const parameters = metadata?.parameters as ParsedSkill["parameters"];

  return { name, description, body, dirPath, parameters };
}

export class SkillRepository {
  private skills = new Map<string, ParsedSkill>();

  constructor(private skillsDir: string) {
    this.loadAll();
  }

  /** 扫描 skills/ 目录加载所有 SKILL.md */
  private loadAll(): void {
    this.skills.clear();

    if (!fs.existsSync(this.skillsDir)) {
      log.info("Skills directory not found: %s", this.skillsDir);
      return;
    }

    const entries = fs.readdirSync(this.skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const fullPath = path.join(this.skillsDir, entry.name);
      try {
        const parsed = loadSkillFromDir(fullPath);
        if (parsed) {
          this.skills.set(parsed.name, parsed);
          log.info("Loaded skill: %s", parsed.name);
        }
      } catch (err) {
        log.warn("Failed to load skill from %s: %s", entry.name, err);
      }
    }

    log.info("SkillRepository: %d skills loaded from %s", this.skills.size, this.skillsDir);
  }

  /** 列出所有技能信息 */
  list(): SkillInfo[] {
    return [...this.skills.values()].map(s => ({
      name: s.name,
      description: s.description,
      dirPath: s.dirPath,
    }));
  }

  /** 获取指定技能（返回 body 用于执行） */
  get(name: string): ParsedSkill | undefined {
    return this.skills.get(name);
  }

  /** 关键词搜索 */
  search(keyword: string): SkillInfo[] {
    const lower = keyword.toLowerCase();
    return this.list().filter(s =>
      s.name.toLowerCase().includes(lower) ||
      s.description.toLowerCase().includes(lower),
    );
  }

  /** 创建新技能到仓库 */
  create(name: string, description: string, prompt: string): SkillInfo {
    const dirName = name.toLowerCase().replace(/\s+/g, "-");
    const dirPath = path.join(this.skillsDir, dirName);
    fs.mkdirSync(dirPath, { recursive: true });

    const content = [
      "---",
      `name: ${name}`,
      `description: ${description}`,
      "userInvocable: true",
      "---",
      "",
      prompt,
      "",
    ].join("\n");

    fs.writeFileSync(path.join(dirPath, "SKILL.md"), content, "utf-8");

    const parsed: ParsedSkill = { name, description, body: prompt, dirPath };
    this.skills.set(name, parsed);

    log.info("Created skill: %s at %s", name, dirPath);
    return { name, description, dirPath };
  }

  /** 执行技能 — 用 provider 调用 LLM */
  async execute(
    name: string,
    task: string,
    params: Record<string, unknown>,
    providerGetter: () => LLMProvider,
  ): Promise<string> {
    const skill = this.skills.get(name);
    if (!skill) {
      throw new Error(`Skill not found: ${name}`);
    }

    const provider = providerGetter();
    if (!provider) {
      throw new Error("No LLM provider available");
    }

    // 模板替换
    let prompt = skill.body;
    for (const [key, val] of Object.entries(params)) {
      if (key !== "task") {
        prompt = prompt.replaceAll(`{{${key}}}`, String(val));
      }
    }

    let result = "";
    for await (const chunk of provider.chat({
      model: "",
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: task },
      ],
    })) {
      if (chunk.type === "content" && chunk.content) {
        result += chunk.content;
      }
    }
    return result || "(no output)";
  }

  /** 技能数量 */
  get size(): number {
    return this.skills.size;
  }
}
