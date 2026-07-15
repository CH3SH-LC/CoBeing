/**
 * experience-reflect tool — Agent 主动反思与自我进化
 *
 * Agent 在完成复杂任务或收到用户反馈后可调用此工具，
 * 将经验写入 EXPERIENCE.md（技术技巧/工具心得/用户偏好/教训）。
 */
import type { Tool, ToolContext, ToolResult } from "@cobeing/shared";
import path from "node:path";
import fs from "node:fs";

export function makeExperienceReflectTool(
  experienceFilePath: string,
): Tool {
  return {
    name: "experience-reflect",
    description: "反思当前任务：记录经验教训到 EXPERIENCE.md。完成复杂任务或收到用户明确反馈后调用。",
    parameters: {
      type: "object",
      properties: {
        task: { type: "string", description: "任务描述" },
        problem: { type: "string", description: "遇到的核心问题或挑战" },
        solution: { type: "string", description: "最终的解决方案" },
        lesson: { type: "string", description: "学到了什么，下次怎么做更好" },
      },
      required: ["task"],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const task = params.task as string;
      const problem = params.problem as string | undefined;
      const solution = params.solution as string | undefined;
      const lesson = params.lesson as string | undefined;

      const results: string[] = [];
      const date = new Date().toISOString().split("T")[0];

      // 1. Problem-Solution → EXPERIENCE.md（技术技巧）
      if (problem && problem.length >= 10 && solution && solution.length >= 10) {
        const dir = path.dirname(experienceFilePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        if (!fs.existsSync(experienceFilePath)) {
          fs.writeFileSync(experienceFilePath, "# EXPERIENCE.md\n\n> Agent 工作过程中积累的经验\n\n## 技术技巧\n\n", "utf-8");
        }
        const block = `\n### [${date}] ${task.slice(0, 80)}\n- **问题**: ${problem}\n- **解决**: ${solution}\n`;
        fs.appendFileSync(experienceFilePath, block + "\n", "utf-8");
        results.push("技术技巧");
      }

      // 2. Lesson → EXPERIENCE.md（教训）
      if (lesson && lesson.length >= 10) {
        const dir = path.dirname(experienceFilePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        if (!fs.existsSync(experienceFilePath)) {
          fs.writeFileSync(experienceFilePath, "# EXPERIENCE.md\n\n> Agent 工作过程中积累的经验\n\n## 教训\n\n", "utf-8");
        }
        const block = `\n### [${date}] ${task.slice(0, 60)}\n- **学到了**: ${lesson}\n`;
        fs.appendFileSync(experienceFilePath, block + "\n", "utf-8");
        results.push("教训");
      }

      if (results.length === 0) {
        return { toolCallId: "", content: "未记录：请提供至少一个有效参数（problem+solution 或 lesson）", isError: true };
      }
      return { toolCallId: "", content: `已记录: ${results.join("、")}` };
    },
  };
}
