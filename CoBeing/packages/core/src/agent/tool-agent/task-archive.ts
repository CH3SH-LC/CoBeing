/**
 * TaskArchive ToolAgent — 任务归档判断
 */
import type { LLMProvider } from "@cobeing/providers";
import type { AgentTaskInboxItem, AgentCapabilityCard, AgentReflectionRecord } from "@cobeing/shared";
import { runToolAgent, loadToolAgentData } from "./base.js";
import { ToolRegistry } from "../../tools/registry.js";

export interface TaskArchiveInput {
  task: AgentTaskInboxItem;
  capability?: AgentCapabilityCard | null;
  recentReflections?: AgentReflectionRecord[];
}

export interface TaskArchiveOutput {
  action: "keep" | "archive";
  reason: string;
  summaryEntry?: string;
}

const FALLBACK_PROMPT = `你是任务归档判断器。判断已完成任务应该保留还是归档。
返回 JSON: { "action": "keep"|"archive", "reason": "...", "summaryEntry": "..." }`;

export async function runTaskArchive(
  provider: LLMProvider,
  model: string,
  input: TaskArchiveInput,
  workingDir: string,
): Promise<TaskArchiveOutput> {
  const { config, prompt } = loadToolAgentData("task-archive");
  const systemPrompt = prompt || FALLBACK_PROMPT;

  const userPrompt = `## 已完成任务
- **标题**: ${input.task.title}
- **目标**: ${input.task.goal}
- **结果状态**: ${input.task.status}
- **来源**: ${input.task.sourceType}/${input.task.sourceId}
- **失败原因**: ${input.task.failureSummary || "N/A"}
- **交付物**: ${input.task.artifacts?.map(a => a.name).join(", ") || "无"}

请判断此任务应该保留还是归档。`;

  const registry = new ToolRegistry();
  const result = await runToolAgent(
    {
      id: `archive-${input.task.id}`,
      type: "task-archive",
      parentAgentId: "system",
      model: (config?.model as string) ?? model,
      maxIterations: (config?.maxIterations as number) ?? 2,
      tools: [],
      systemPrompt,
      userPrompt,
      workingDir,
    },
    provider,
    registry,
    workingDir,
  );

  if (!result.success) {
    return { action: "archive", reason: "归档判断失败，默认归档" };
  }

  try {
    const jsonMatch = result.output.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        action: parsed.action === "keep" ? "keep" : "archive",
        reason: parsed.reason || "",
        summaryEntry: parsed.summaryEntry,
      };
    }
  } catch { /* fallback */ }

  return { action: "archive", reason: "无法解析判断结果，默认归档" };
}
