/**
 * experience-reflect tool — Agent 主动总结经验
 *
 * Agent 在完成复杂任务后可主动调用此工具，将经验写入 EXPERIENCE.md。
 * 替代原先的自动反思机制，改为 Agent 自主决定何时总结。
 */
import type { Tool, ToolContext, ToolResult } from "@cobeing/shared";

export function makeExperienceReflectTool(
  experienceFilePath: string,
  providerGetter: () => import("@cobeing/providers").LLMProvider | undefined,
): Tool {
  return {
    name: "experience-reflect",
    description: "总结当前任务的经验并写入 EXPERIENCE.md。在完成复杂任务、解决非平凡问题后调用。",
    parameters: {
      type: "object",
      properties: {
        task: { type: "string", description: "任务描述" },
        problem: { type: "string", description: "遇到的核心问题或挑战" },
        solution: { type: "string", description: "最终的解决方案" },
      },
      required: ["task", "problem", "solution"],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const task = params.task as string;
      const problem = params.problem as string;
      const solution = params.solution as string;

      // 质量过滤
      if (!problem || problem.length < 10 || !solution || solution.length < 10) {
        return { toolCallId: "", content: "经验过短，未写入。" };
      }

      const fs = await import("node:fs");
      const path = await import("node:path");

      // Ensure file exists
      const dir = path.dirname(experienceFilePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      if (!fs.existsSync(experienceFilePath)) {
        fs.writeFileSync(experienceFilePath, "# EXPERIENCE.md\n\n> Agent 在工程过程中积累的经验\n", "utf-8");
      }

      const date = new Date().toISOString().split("T")[0];
      const block = [
        "",
        `## [${date}] ${task.slice(0, 80)}`,
        `- **问题**: ${problem}`,
        `- **解决**: ${solution}`,
        "",
      ].join("\n");

      fs.appendFileSync(experienceFilePath, block + "\n", "utf-8");

      return { toolCallId: "", content: `已记录经验: ${task.slice(0, 40)}` };
    },
  };
}
