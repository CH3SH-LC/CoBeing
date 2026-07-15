/**
 * Skill Loader — 从 skills/ 目录加载技能定义，注册为 Tool
 */
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import type { Tool, ToolContext, ToolResult } from "@cobeing/shared";
import type { LLMProvider } from "@cobeing/providers";
import { createLogger } from "@cobeing/shared";

const log = createLogger("skill-loader");

export interface SkillDefinition {
  name: string;
  description: string;
  trigger?: string;
  tools?: string[];
  prompt: string;
  parameters?: Array<{
    name: string;
    description?: string;
    type?: string;
    default?: string;
  }>;
}

/**
 * 将技能定义转为 Tool 接口
 */
function skillToTool(skill: SkillDefinition, providerGetter: () => LLMProvider): Tool {
  // 构建 JSON Schema
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  if (skill.parameters) {
    for (const p of skill.parameters) {
      properties[p.name] = {
        type: p.type ?? "string",
        description: p.description ?? "",
      };
      if (p.default === undefined) required.push(p.name);
    }
  }

  // 技能总是接受一个 task 参数
  if (!properties["task"]) {
    properties["task"] = { type: "string", description: "要执行的任务" };
    required.push("task");
  }

  return {
    name: `skill-${skill.name}`,
    description: skill.description,
    parameters: { type: "object", properties, required },
    async execute(params: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
      const provider = providerGetter();
      if (!provider) {
        return { toolCallId: "", content: "No LLM provider available", isError: true };
      }

      // 组装 prompt
      let prompt = skill.prompt;
      for (const [key, val] of Object.entries(params)) {
        prompt = prompt.replace(`{{${key}}}`, String(val));
      }

      try {
        let result = "";
        for await (const chunk of provider.chat({
          model: "",  // 由 provider 默认决定
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

export class SkillLoader {
  private skills: SkillDefinition[] = [];
  private tools: Tool[] = [];

  /**
   * 扫描目录加载技能
   * @param skillsDir 技能目录路径
   * @param providerGetter 获取当前 LLM provider 的函数
   */
  load(skillsDir: string, providerGetter: () => LLMProvider): void {
    this.skills = [];
    this.tools = [];

    if (!fs.existsSync(skillsDir)) {
      log.info("Skills directory not found: %s", skillsDir);
      return;
    }

    const files = fs.readdirSync(skillsDir).filter(f => f.endsWith(".yaml") || f.endsWith(".yml") || f.endsWith(".json"));

    for (const file of files) {
      const filePath = path.join(skillsDir, file);
      try {
        const raw = fs.readFileSync(filePath, "utf-8");
        const def = file.endsWith(".json")
          ? JSON.parse(raw) as SkillDefinition
          : yaml.load(raw) as SkillDefinition;

        if (!def.name || !def.description || !def.prompt) {
          log.warn("Invalid skill definition: %s (missing name/description/prompt)", file);
          continue;
        }

        this.skills.push(def);
        this.tools.push(skillToTool(def, providerGetter));
        log.info("Loaded skill: %s", def.name);
      } catch (err) {
        log.warn("Failed to load skill %s: %s", file, err);
      }
    }

    log.info("Loaded %d skills from %s", this.skills.length, skillsDir);
  }

  getTools(): Tool[] {
    return [...this.tools];
  }

  getSkills(): SkillDefinition[] {
    return [...this.skills];
  }
}
