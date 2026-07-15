/**
 * CapabilityUpdater ToolAgent — 维护 Agent Capability Card
 */
import type { LLMProvider } from "@cobeing/providers";
import type { AgentCapabilityCard, AgentReflectionRecord } from "@cobeing/shared";
import { runToolAgent, loadToolAgentData } from "./base.js";
import { ToolRegistry } from "../../tools/registry.js";

export interface CapabilityUpdateInput {
  currentCard: AgentCapabilityCard;
  updateIntent: string;
  recentReflections?: AgentReflectionRecord[];
}

const FALLBACK_PROMPT = `你是能力卡维护器。根据更新意图和反思记录，生成更新后的完整 CapabilityCard JSON。
只修改明确要求修改的字段。输出完整 JSON。`;

export async function runCapabilityUpdater(
  provider: LLMProvider,
  model: string,
  input: CapabilityUpdateInput,
  workingDir: string,
): Promise<AgentCapabilityCard | null> {
  const { config, prompt } = loadToolAgentData("capability-updater");
  const systemPrompt = prompt || FALLBACK_PROMPT;

  const reflectionsText = input.recentReflections?.length
    ? input.recentReflections.slice(-5).map(r => `- [${r.outcome}] ${r.whatWorked.join("; ")}`).join("\n")
    : "无";

  const userPrompt = `## 当前能力卡
\`\`\`json
${JSON.stringify(input.currentCard, null, 2)}
\`\`\`

## 更新意图
${input.updateIntent}

## 最近反思
${reflectionsText}

请输出更新后的完整 CapabilityCard JSON。`;

  const registry = new ToolRegistry();
  const result = await runToolAgent(
    {
      id: `cap-update-${input.currentCard.agentId}`,
      type: "capability-updater",
      parentAgentId: input.currentCard.agentId,
      model: (config?.model as string) ?? model,
      maxIterations: (config?.maxIterations as number) ?? 3,
      tools: [],
      systemPrompt,
      userPrompt,
      workingDir,
    },
    provider,
    registry,
    workingDir,
  );

  if (!result.success) return null;

  try {
    const jsonMatch = result.output.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.agentId) return parsed as AgentCapabilityCard;
    }
  } catch { /* fallback */ }

  return null;
}
