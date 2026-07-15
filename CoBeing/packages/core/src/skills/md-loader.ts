/**
 * SkillMdLoader — 从 SKILL.md 文件加载技能定义
 * 支持 frontmatter (name, description, metadata) + markdown body 格式
 */
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import type { Tool, ToolContext, ToolResult } from "@cobeing/shared";
import type { LLMProvider } from "@cobeing/providers";
import type { SkillDefinition } from "./loader.js";
import { createLogger } from "@cobeing/shared";

const log = createLogger("md-skill-loader");

export interface SkillMdFrontmatter {
  name: string;
  description: string;
  metadata?: {
    tools?: string[];
    trigger?: string;
    parameters?: Array<{
      name: string;
      description?: string;
      type?: string;
      default?: string;
    }>;
  };
}

interface ParsedSkillMd {
  frontmatter: SkillMdFrontmatter;
  body: string;
  hasRunFile: boolean;
  dirPath: string;
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
 * 从目录或文件加载 SKILL.md
 */
function loadSkillMd(skillPath: string): ParsedSkillMd | null {
  let mdPath: string;
  let dirPath: string;

  if (fs.statSync(skillPath).isDirectory()) {
    mdPath = path.join(skillPath, "SKILL.md");
    dirPath = skillPath;
  } else {
    mdPath = skillPath;
    dirPath = path.dirname(skillPath);
  }

  if (!fs.existsSync(mdPath)) return null;

  const content = fs.readFileSync(mdPath, "utf-8");
  const { frontmatter, body } = parseSkillMd(content);

  if (!frontmatter.name || !frontmatter.description) {
    log.warn("SKILL.md missing name or description: %s", mdPath);
    return null;
  }

  const runPath = path.join(dirPath, "run.ts");
  const hasRunFile = fs.existsSync(runPath);

  return {
    frontmatter: frontmatter as unknown as SkillMdFrontmatter,
    body,
    hasRunFile,
    dirPath,
  };
}

/**
 * 将 SKILL.md 转为 Tool 接口（纯 prompt 类型）
 */
function skillMdToTool(
  parsed: ParsedSkillMd,
  providerGetter: () => LLMProvider,
): Tool {
  const fm = parsed.frontmatter;
  const params = fm.metadata?.parameters;

  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  if (params) {
    for (const p of params) {
      properties[p.name] = {
        type: p.type ?? "string",
        description: p.description ?? "",
      };
      if (p.default === undefined) required.push(p.name);
    }
  }

  // 总是接受 task 参数
  if (!properties["task"]) {
    properties["task"] = { type: "string", description: "要执行的任务" };
    required.push("task");
  }

  const skillName = fm.name;

  return {
    name: `skill-${skillName}`,
    description: fm.description,
    parameters: { type: "object", properties, required },
    async execute(params: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
      const provider = providerGetter();
      if (!provider) {
        return { toolCallId: "", content: "No LLM provider available", isError: true };
      }

      // 模板替换
      let prompt = parsed.body;
      for (const [key, val] of Object.entries(params)) {
        prompt = prompt.replaceAll(`{{${key}}}`, String(val));
      }

      try {
        let result = "";
        for await (const chunk of provider.chat({
          model: "",
          messages: [
            { role: "system", content: prompt },
            { role: "user", content: params.task as string },
          ],
        })) {
          if (chunk.type === "content" && chunk.content) {
            result += chunk.content;
          }
        }
        return { toolCallId: "", content: result || "(no output)" };
      } catch (err: any) {
        return { toolCallId: "", content: `Skill error: ${err.message}`, isError: true };
      }
    },
  };
}

export class SkillMdLoader {
  private skills: SkillDefinition[] = [];
  private tools: Tool[] = [];

  /**
   * 扫描目录加载 SKILL.md 技能
   */
  load(skillsDir: string, providerGetter: () => LLMProvider): void {
    this.skills = [];
    this.tools = [];

    if (!fs.existsSync(skillsDir)) {
      log.info("Skills directory not found: %s", skillsDir);
      return;
    }

    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(skillsDir, entry.name);

      try {
        let parsed: ParsedSkillMd | null = null;

        if (entry.isDirectory()) {
          parsed = loadSkillMd(fullPath);
        } else if (entry.name === "SKILL.md" || entry.name.endsWith(".skill.md")) {
          parsed = loadSkillMd(fullPath);
        }

        if (!parsed) continue;

        const fm = parsed.frontmatter;

        // 转为通用 SkillDefinition
        const skillDef: SkillDefinition = {
          name: fm.name,
          description: fm.description,
          trigger: fm.metadata?.trigger,
          tools: fm.metadata?.tools,
          prompt: parsed.body,
          parameters: fm.metadata?.parameters,
        };

        this.skills.push(skillDef);
        this.tools.push(skillMdToTool(parsed, providerGetter));
        log.info("Loaded MD skill: %s%s", fm.name, parsed.hasRunFile ? " (+run.ts)" : "");
      } catch (err) {
        log.warn("Failed to load skill from %s: %s", entry.name, err);
      }
    }

    log.info("Loaded %d MD skills from %s", this.skills.length, skillsDir);
  }

  getTools(): Tool[] {
    return [...this.tools];
  }

  getSkills(): SkillDefinition[] {
    return [...this.skills];
  }
}
