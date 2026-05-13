/**
 * experience-reflect tool — Agent 主动反思与自我进化
 *
 * Agent 在完成复杂任务或收到用户反馈后可调用此工具，
 * 将经验写入 EXPERIENCE.md、调整 SOUL.md、积累 TOOLS.md 策略。
 */
import type { Tool, ToolContext, ToolResult } from "@cobeing/shared";
import path from "node:path";
import fs from "node:fs";

export function makeExperienceReflectTool(
  experienceFilePath: string,
  soulFilePath: string,
  toolsFilePath: string,
): Tool {
  return {
    name: "experience-reflect",
    description: "反思当前任务：记录经验教训、调整自身性格、积累工具使用策略。完成复杂任务或收到用户明确反馈后调用。",
    parameters: {
      type: "object",
      properties: {
        task: { type: "string", description: "任务描述" },
        problem: { type: "string", description: "遇到的核心问题或挑战" },
        solution: { type: "string", description: "最终的解决方案" },
        lesson: { type: "string", description: "学到了什么，下次怎么做更好" },
        soul_update: { type: "string", description: "对自身性格/风格的认知调整建议（追加到 SOUL.md）" },
        tool_usage: {
          type: "object",
          description: "工具使用策略总结",
          properties: {
            scenario: { type: "string", description: "使用场景" },
            tools: { type: "array", items: { type: "string" }, description: "使用的工具组合" },
            result: { type: "string", description: "效果（好/中/差）" },
          },
        },
      },
      required: ["task"],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const task = params.task as string;
      const problem = params.problem as string | undefined;
      const solution = params.solution as string | undefined;
      const lesson = params.lesson as string | undefined;
      const soulUpdate = params.soul_update as string | undefined;
      const toolUsage = params.tool_usage as { scenario: string; tools: string[]; result: string } | undefined;

      const results: string[] = [];
      const date = new Date().toISOString().split("T")[0];

      // 1. Problem-Solution → EXPERIENCE.md
      if (problem && problem.length >= 10 && solution && solution.length >= 10) {
        const dir = path.dirname(experienceFilePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        if (!fs.existsSync(experienceFilePath)) {
          fs.writeFileSync(experienceFilePath, "# EXPERIENCE.md\n\n> Agent 在工程过程中积累的经验\n", "utf-8");
        }
        const block = `\n## [${date}] ${task.slice(0, 80)}\n- **问题**: ${problem}\n- **解决**: ${solution}\n`;
        fs.appendFileSync(experienceFilePath, block + "\n", "utf-8");
        results.push("经验");
      }

      // 2. Lesson → EXPERIENCE.md
      if (lesson && lesson.length >= 10) {
        const dir = path.dirname(experienceFilePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        if (!fs.existsSync(experienceFilePath)) {
          fs.writeFileSync(experienceFilePath, "# EXPERIENCE.md\n", "utf-8");
        }
        const block = `\n## [${date}] 教训: ${task.slice(0, 60)}\n- **学到了**: ${lesson}\n`;
        fs.appendFileSync(experienceFilePath, block + "\n", "utf-8");
        results.push("教训");
      }

      // 3. Soul update → SOUL.md
      if (soulUpdate && soulUpdate.length >= 10) {
        const dir = path.dirname(soulFilePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        if (!fs.existsSync(soulFilePath)) {
          fs.writeFileSync(soulFilePath, "# SOUL.md\n", "utf-8");
        }
        const block = `\n## 自我进化 — ${date}\n\n${soulUpdate}\n`;
        fs.appendFileSync(soulFilePath, block + "\n", "utf-8");
        results.push("性格调整");
      }

      // 4. Tool strategy → TOOLS.md
      if (toolUsage && toolUsage.scenario && toolUsage.tools?.length > 0) {
        const dir = path.dirname(toolsFilePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        if (!fs.existsSync(toolsFilePath)) {
          fs.writeFileSync(toolsFilePath, "# TOOLS.md\n\n> 工具使用策略\n", "utf-8");
        }
        const block = `\n## [${date}] ${toolUsage.scenario.slice(0, 80)}\n- **工具**: ${toolUsage.tools.join(", ")}\n- **效果**: ${toolUsage.result || "未评估"}\n`;
        fs.appendFileSync(toolsFilePath, block + "\n", "utf-8");
        results.push("工具策略");
      }

      if (results.length === 0) {
        return { toolCallId: "", content: "未记录：请提供至少一个有效参数（problem+solution / lesson / soul_update / tool_usage）", isError: true };
      }
      return { toolCallId: "", content: `已记录: ${results.join("、")}` };
    },
  };
}
