/**
 * agent-clone 工具 — 母体 Agent 创建克隆体并行工作
 */
import type { Tool, ToolResult } from "@cobeing/shared";
import type { LLMProvider } from "@cobeing/providers";
import { runCloneAgent } from "../agent/tool-agent/clone.js";
import { createLogger } from "@cobeing/shared";

const log = createLogger("agent-clone");

export function makeAgentCloneTool(
  getProvider: (providerId?: string) => LLMProvider | undefined,
  getModel: (agentId: string) => string,
  getParentName: (agentId: string) => string,
): Tool {
  return {
    name: "agent-clone",
    description: "创建临时克隆体并行执行子任务。每个克隆体独立工作，完成后返回结果。克隆体不能向群组发消息、不能创建新克隆体。",
    parameters: {
      type: "object",
      properties: {
        tasks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              description: { type: "string", description: "克隆体的任务描述" },
              contextFiles: {
                type: "array",
                items: { type: "string" },
                description: "上下文文件路径列表（可选）",
              },
            },
            required: ["description"],
          },
          description: "并行任务列表，最多 5 个",
        },
        maxIterations: {
          type: "number",
          description: "每个克隆体的最大 LLM 轮次，默认 5",
        },
      },
      required: ["tasks"],
    },
    async execute(params, context): Promise<ToolResult> {
      const tasks = params.tasks as Array<{ description: string; contextFiles?: string[] }>;
      const maxIterations = (params.maxIterations as number) ?? 5;

      if (!Array.isArray(tasks) || tasks.length === 0) {
        return { toolCallId: "", content: "错误: tasks 必须是非空数组", isError: true };
      }
      if (tasks.length > 5) {
        return { toolCallId: "", content: "错误: 最多同时创建 5 个克隆体", isError: true };
      }

      const provider = getProvider();
      if (!provider) {
        return { toolCallId: "", content: "错误: 无法获取 LLM Provider", isError: true };
      }

      const model = getModel(context.agentId);
      const parentName = getParentName(context.agentId);

      const results = await Promise.all(
        tasks.map(async (task, i) => {
          try {
            const result = await runCloneAgent(
              task,
              parentName,
              context.agentId,
              undefined,
              context.workingDir,
              provider,
              model,
              maxIterations,
            );
            return { cloneId: `clone-${i + 1}`, result: result.output };
          } catch (err: any) {
            return { cloneId: `clone-${i + 1}`, result: `错误: ${err.message}` };
          }
        }),
      );

      const summary = results.map(r =>
        `### ${r.cloneId}\n${r.result}`
      ).join("\n\n");

      return {
        toolCallId: "",
        content: `克隆体执行完成 (${results.length} 个):\n\n${summary}`,
      };
    },
  };
}
