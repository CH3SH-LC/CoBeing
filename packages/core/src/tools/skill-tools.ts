/**
 * Skill 统一工具 — Phase 8.2
 *
 * 替代旧的按名注册 skill-xxx 工具。
 * 所有 Agent 注册三个统一工具：
 * - skill-execute: 执行指定技能（受 config.json 的 skills 白名单限制）
 * - skill-list: 列出当前 Agent 可用的技能
 * - skill-create: 在仓库中创建新技能
 */
import type { Tool, ToolContext, ToolResult } from "@cobeing/shared";
import type { SkillRepository } from "../skills/repository.js";
import type { LLMProvider } from "@cobeing/providers";
import { createLogger } from "@cobeing/shared";

const log = createLogger("skill-tools");

/**
 * 创建 skill-execute 工具
 * 执行指定技能，受 skills 白名单限制
 */
export function makeSkillExecuteTool(
  repo: SkillRepository,
  providerGetter: () => LLMProvider,
  allowedSkills?: string[],
): Tool {
  return {
    name: "skill-execute",
    description: "执行指定技能。可用技能请先用 skill-list 查看。",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "技能名称（如 code-review、project-planning）" },
        task: { type: "string", description: "要执行的任务描述" },
        params: {
          type: "object",
          description: "传递给技能的额外参数（可选）",
        },
      },
      required: ["name", "task"],
    },
    async execute(params: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
      const name = params.name as string;
      const task = params.task as string;
      const extraParams = (params.params as Record<string, unknown>) ?? {};

      // 白名单检查：如果 allowedSkills 是 undefined，则允许所有技能；如果是数组（包括空数组），则进行过滤
      if (Array.isArray(allowedSkills) && !allowedSkills.includes(name)) {
        return {
          toolCallId: "",
          content: `技能 "${name}" 不在可用列表中。可用技能: ${allowedSkills.join(", ")}`,
          isError: true,
        };
      }

      // 检查技能是否存在
      if (!repo.get(name)) {
        const available = repo.list().map(s => s.name).join(", ");
        return {
          toolCallId: "",
          content: `未找到技能 "${name}"。可用技能: ${available || "(无)"}`,
          isError: true,
        };
      }

      try {
        const result = await repo.execute(name, task, extraParams, providerGetter);
        return { toolCallId: "", content: result };
      } catch (err: any) {
        return { toolCallId: "", content: `技能执行失败: ${err.message}`, isError: true };
      }
    },
  };
}

/**
 * 创建 skill-list 工具
 * 列出当前 Agent 可用的技能（白名单过滤后）
 */
export function makeSkillListTool(
  repo: SkillRepository,
  allowedSkills?: string[],
): Tool {
  return {
    name: "skill-list",
    description: "列出当前可用的技能",
    parameters: { type: "object", properties: {} },
    async execute(_params: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
      let skills = repo.list();

      // 白名单过滤：如果 allowedSkills 是 undefined，则显示所有技能；如果是数组（包括空数组），则进行过滤
      if (Array.isArray(allowedSkills)) {
        skills = skills.filter(s => allowedSkills.includes(s.name));
      }

      if (skills.length === 0) {
        return { toolCallId: "", content: "当前没有可用技能。" };
      }

      const lines = skills.map(s => `- **${s.name}**: ${s.description}`);
      return { toolCallId: "", content: `可用技能:\n${lines.join("\n")}` };
    },
  };
}

/**
 * 创建 skill-create 工具
 * 在仓库中创建新技能（创建后不会自动获得使用权）
 */
export function makeSkillCreateTool(repo: SkillRepository): Tool {
  return {
    name: "skill-create",
    description: "在技能仓库中创建新技能。创建后不会自动获得使用权，需要在配置中添加。",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "技能名称" },
        description: { type: "string", description: "技能描述" },
        prompt: { type: "string", description: "技能的完整 prompt（Markdown 格式）" },
      },
      required: ["name", "description", "prompt"],
    },
    async execute(params: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
      const name = params.name as string;
      const description = params.description as string;
      const prompt = params.prompt as string;

      // 检查是否已存在
      if (repo.get(name)) {
        return {
          toolCallId: "",
          content: `技能 "${name}" 已存在。请使用不同名称或先删除现有技能。`,
          isError: true,
        };
      }

      try {
        const info = repo.create(name, description, prompt);
        return { toolCallId: "", content: `已创建技能 "${info.name}"（目录: ${info.dirPath}）` };
      } catch (err: any) {
        return { toolCallId: "", content: `创建技能失败: ${err.message}`, isError: true };
      }
    },
  };
}
