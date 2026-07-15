/**
 * Memory Tool Agent — 个人/群组经验提取
 */
import type { LLMProvider } from "@cobeing/providers";
import { ToolRegistry } from "../../tools/registry.js";
import { readFileTool } from "../../tools/read-file.js";
import { grepTool } from "../../tools/grep.js";
import { runToolAgent, loadToolAgentData } from "./base.js";
import type {
  MemoryMode, PersonalMemoryInput, GroupMemoryInput,
  MemoryEntry, MemoryToolAgentResult, ToolAgentResult,
} from "./types.js";

const MEMORY_TOOLS: Record<string, import("@cobeing/shared").Tool> = {
  "read-file": readFileTool,
  "grep": grepTool,
};

const FALLBACK_PERSONAL_PROMPT = "你是 Agent \"{agentName}\" 的记忆助手。审查本次工作轨迹，提取值得记住的经验。";
const FALLBACK_GROUP_PROMPT = "你是群组 \"{groupName}\" 的记忆助手。审查本阶段群组协作，提取群组级经验。";

function getMemoryPrompt(): string {
  const { prompt } = loadToolAgentData("memory");
  if (prompt) return prompt;
  // Fallback: return full prompt from old code
  return FALLBACK_PERSONAL_PROMPT + "\n\n---\n\n" + FALLBACK_GROUP_PROMPT;
}

const PERSONAL_SYSTEM_PROMPT = `你是 Agent "{agentName}" 的记忆助手。审查本次工作轨迹，提取值得记住的经验。

审查材料：思考和推理过程、调用的工具及结果、最终回复内容、任务上下文。

提取重点（个人层面）：
1. 学到了什么关于项目/工具/环境的知识？
2. 犯了什么错误，如何修复的？
3. 哪些策略特别有效？
4. 收到了什么用户偏好或反馈？
5. 发现了什么新的工作模式或最佳实践？

输出格式（JSON 对象）：
{
  "entries": [{"category":"类别","summary":"一行摘要（≤120字符）","detail":"详细描述（可选）"}],
  "memoryUpdates": [{"target":"MEMORY.md","operation":"append|replace|remove","reason":"修改原因","content":"建议写入或替换的内容","sensitivity":"low|medium|high"}],
  "warnings": ["不应静默写入的风险说明"]
}

类别包括：工具发现、用户偏好、架构决策、协作模式、错误教训、最佳实践

如果本次工作没有值得保存的经验，输出 {"entries": [], "memoryUpdates": [], "warnings": []}。`;

const GROUP_SYSTEM_PROMPT = `你是群组 "{groupName}" 的记忆助手。审查本阶段群组协作，提取群组级经验。

审查材料：本阶段 PROGRESS.md 工作日志、各成员发言和产出、当前 INTERFACE.md、PLAN.md 完成情况。

提取重点（群组层面）：
1. 群组建立了什么新的约定或决策？
2. 哪些协作模式有效/无效？
3. 发现了什么外部依赖或约束？
4. Agent 间的 INTERFACE.md 需要什么更新？
5. 阶段推进中有什么值得下次借鉴的？

输出格式（JSON 对象）：
{
  "entries": [{"category":"类别","summary":"一行摘要（≤120字符）","detail":"详细描述（可选）"}],
  "interfaceUpdates": [{"agentId":"agent id","section":"章节名","entry":"新接口条目"}],
  "memoryUpdates": [{"target":"MEMORY.md","operation":"append|replace|remove","reason":"修改原因","content":"建议写入或替换的内容","sensitivity":"low|medium|high"}],
  "warnings": ["不应静默写入的风险说明"]
}

如果本阶段没有值得保存的经验，输出 {"entries": [], "interfaceUpdates": [], "memoryUpdates": [], "warnings": []}。`;

function getPersonalPrompt(): string {
  const dataPrompt = loadToolAgentData("memory").prompt;
  if (dataPrompt) {
    // Extract personal section from combined prompt.md
    const personalMatch = dataPrompt.match(/## 个人模式\n\n([\s\S]*?)(?=\n---\n## 群组模式|$)/);
    if (personalMatch) return personalMatch[1].trim();
  }
  return PERSONAL_SYSTEM_PROMPT;
}

function getGroupPrompt(): string {
  const dataPrompt = loadToolAgentData("memory").prompt;
  if (dataPrompt) {
    const groupMatch = dataPrompt.match(/## 群组模式\n\n([\s\S]*?)$/);
    if (groupMatch) return groupMatch[1].trim();
  }
  return GROUP_SYSTEM_PROMPT;
}

function buildPersonalPrompt(input: PersonalMemoryInput): string {
  return `## Agent: ${input.agentName} (${input.agentId})

## 思考过程
${input.trace.thinking.join('\n')}

## 工具调用
${input.trace.toolCalls.map(tc =>
  `[${tc.tool}] ${JSON.stringify(tc.args)} → ${tc.result.slice(0, 500)}`
).join('\n')}

## 最终回复
${input.trace.finalMessage.slice(0, 1000)}

## 任务上下文
${input.taskContext.slice(0, 1000)}

请审查以上内容，提取值得保存的经验和 MEMORY.md 修改建议。输出 JSON 对象。`;
}

function buildGroupPrompt(input: GroupMemoryInput): string {
  return `## 群组: ${input.groupName} (${input.groupId})

## 本阶段 PLAN.md
${input.phasePlan.slice(0, 2000)}

## 本阶段 PROGRESS.md
${input.progressMd.slice(0, 2000)}

## INTERFACE.md
${input.interfaceMd.slice(0, 2000)}

## 成员贡献
${input.memberContributions.join('\n')}

请审查以上内容，提取群组级经验、接口更新和 MEMORY.md 修改建议。输出 JSON 对象。`;
}

export async function runMemoryAgent(
  mode: MemoryMode,
  input: PersonalMemoryInput | GroupMemoryInput,
  provider: LLMProvider,
  model: string,
  workingDir: string,
): Promise<MemoryToolAgentResult> {
  const toolRegistry = new ToolRegistry();
  for (const [name, tool] of Object.entries(MEMORY_TOOLS)) {
    toolRegistry.register(tool);
  }

  const systemPrompt = mode === "personal"
    ? getPersonalPrompt().replace("{agentName}", (input as PersonalMemoryInput).agentName)
    : getGroupPrompt().replace("{groupName}", (input as GroupMemoryInput).groupName);

  const userPrompt = mode === "personal"
    ? buildPersonalPrompt(input as PersonalMemoryInput)
    : buildGroupPrompt(input as GroupMemoryInput);

  const parentAgentId = mode === "personal"
    ? (input as PersonalMemoryInput).agentId
    : (input as GroupMemoryInput).groupId;

  const result = await runToolAgent(
    {
      id: `tool-memory-${mode}-${Date.now()}`,
      type: "memory",
      parentAgentId,
      model,
      maxIterations: 3,
      tools: Object.keys(MEMORY_TOOLS),
      systemPrompt,
      userPrompt,
      workingDir,
    },
    provider,
    toolRegistry,
    workingDir,
  );

  return parseMemoryOutput(result, mode);
}

function parseMemoryOutput(result: ToolAgentResult, mode: MemoryMode): MemoryToolAgentResult {
  try {
    const output = result.output.trim();
    if (!output || output === "[]" || output === "Nothing to save." || output === "Nothing to save") {
      return { entries: [] };
    }

    const objectMatch = output.match(/\{[\s\S]*\}/);
    const arrayMatch = output.match(/\[[\s\S]*\]/);
    const jsonMatch = output.startsWith("[") ? arrayMatch ?? objectMatch : objectMatch ?? arrayMatch;
    if (!jsonMatch) return { entries: [] };

    const parsed = JSON.parse(jsonMatch[0]);

    if (Array.isArray(parsed)) {
      return { entries: parsed };
    }

    const memoryUpdates = Array.isArray(parsed.memoryUpdates)
      ? parsed.memoryUpdates
        .filter((item: unknown): item is Record<string, unknown> => item !== null && typeof item === "object" && !Array.isArray(item))
        .map((item) => ({
          target: "MEMORY.md" as const,
          operation: item.operation === "replace" || item.operation === "remove" ? item.operation : "append",
          reason: typeof item.reason === "string" ? item.reason : "",
          content: typeof item.content === "string" ? item.content : "",
          sensitivity: item.sensitivity === "medium" || item.sensitivity === "high" ? item.sensitivity : "low" as const,
        }))
        .filter((item) => item.reason.trim().length > 0 && item.content.trim().length > 0)
      : undefined;

    const warnings = Array.isArray(parsed.warnings)
      ? parsed.warnings.filter((item: unknown): item is string => typeof item === "string" && item.trim().length > 0).map((item: string) => item.trim())
      : undefined;

    return {
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
      interfaceUpdates: mode === "group" && Array.isArray(parsed.interfaceUpdates) ? parsed.interfaceUpdates : undefined,
      memoryUpdates,
      warnings,
    };
  } catch {
    return { entries: [] };
  }
}
