/**
 * Butler workflow tools
 * (workflow-analyze, workflow-plan)
 */
import type { Tool, ToolContext, ToolResult } from "@cobeing/shared";
import { WorkflowEngine } from "../../../workflow/engine.js";

export function makeWorkflowAnalyzeTool(engine: WorkflowEngine): Tool {
  return {
    name: "workflow-analyze",
    description: "使用工作流引擎分析任务，确定需要的 Agent 和群组配置",
    parameters: {
      type: "object",
      properties: {
        task: { type: "string", description: "任务描述" },
      },
      required: ["task"],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const result = await engine.analyze(params.task as string);
      return { toolCallId: "", content: result };
    },
  };
}

export function makeWorkflowPlanTool(engine: WorkflowEngine): Tool {
  return {
    name: "workflow-plan",
    description: "基于任务分析生成执行计划",
    parameters: {
      type: "object",
      properties: {
        task: { type: "string", description: "任务描述" },
        analysis: { type: "string", description: "任务分析结果（来自 workflow-analyze）" },
      },
      required: ["task", "analysis"],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const steps = await engine.plan(params.task as string, params.analysis as string);
      return { toolCallId: "", content: `执行计划:\n${steps.join("\n")}` };
    },
  };
}
