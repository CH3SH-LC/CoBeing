/**
 * Clone Tool Agent — 母体 Agent 的分身，并行工作
 */
import type { LLMProvider } from "@cobeing/providers";
import { ToolRegistry } from "../../tools/registry.js";
import { runToolAgent, loadToolAgentData } from "./base.js";
import type { CloneTask, ToolAgentResult } from "./types.js";
import { bashTool } from "../../tools/bash.js";
import { readFileTool } from "../../tools/read-file.js";
import { writeFileTool } from "../../tools/write-file.js";
import { editFileTool } from "../../tools/edit-file.js";
import { globTool } from "../../tools/glob.js";
import { grepTool } from "../../tools/grep.js";
import { webFetchTool } from "../../tools/web-fetch.js";

const FALLBACK_SYSTEM_PROMPT = `你是 Agent "{parentName}" (ID: {parentId}) 的克隆体{groupContext}，执行并行子任务。

你的任务：
{task}

重要规则：
1. 你没有母体的 MEMORY.md 和 EXPERIENCE.md 访问权限。只使用提供的上下文文件。
2. 你可以读取、写入、编辑工作区中的文件。
3. 你可以在工作区中执行 bash 命令。
4. 你不能向群组发送消息。你的唯一输出是返回给母体的结果摘要。
5. 你不能创建新的克隆体（禁止递归克隆）。
6. 完成后，总结：做了什么、发现了什么、产生了什么文件。
7. 如果遇到无法解决的错误，清晰报告并停止。

提供的上下文文件：{fileList}

在 {maxIterations} 轮内完成并返回结果摘要。`;

function getClonePrompt(): string {
  const { prompt } = loadToolAgentData("clone");
  return prompt || FALLBACK_SYSTEM_PROMPT;
}

const CLONE_TOOLS: Record<string, import("@cobeing/shared").Tool> = {
  "bash": bashTool,
  "read-file": readFileTool,
  "write-file": writeFileTool,
  "edit-file": editFileTool,
  "glob": globTool,
  "grep": grepTool,
  "web-fetch": webFetchTool,
};

export async function runCloneAgent(
  task: CloneTask,
  parentName: string,
  parentId: string,
  groupName: string | undefined,
  effectiveWorkspace: string,
  provider: LLMProvider,
  model: string,
  maxIterations: number,
  abortSignal?: AbortSignal,
): Promise<ToolAgentResult> {
  const cloneToolRegistry = new ToolRegistry();
  for (const [name, tool] of Object.entries(CLONE_TOOLS)) {
    cloneToolRegistry.register(tool);
  }

  const groupContext = groupName ? `，在群组 "${groupName}" 中` : "";
  const fileList = task.contextFiles && task.contextFiles.length > 0
    ? task.contextFiles.join(", ")
    : "（无额外上下文文件）";

  const systemPrompt = getClonePrompt()
    .replace("{parentName}", parentName)
    .replace("{parentId}", parentId)
    .replace("{groupContext}", groupContext)
    .replace("{task}", task.description)
    .replace("{fileList}", fileList)
    .replace("{maxIterations}", String(maxIterations));

  return runToolAgent(
    {
      id: `tool-clone-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: "clone",
      parentAgentId: parentId,
      model,
      maxIterations,
      tools: Object.keys(CLONE_TOOLS),
      systemPrompt,
      userPrompt: `开始执行任务。完成后用一段话总结你的工作。`,
      workingDir: effectiveWorkspace,
      abortSignal,
    },
    provider,
    cloneToolRegistry,
    effectiveWorkspace,
  );
}
