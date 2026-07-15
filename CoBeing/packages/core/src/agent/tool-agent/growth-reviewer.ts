/**
 * GrowthReviewer ToolAgent — 审批 Agent 的成长建议
 */
import type { LLMProvider } from "@cobeing/providers";
import type { AgentGrowthProposal, AgentGrowthRisk } from "@cobeing/shared";
import { runToolAgent, loadToolAgentData } from "./base.js";
import { ToolRegistry } from "../../tools/registry.js";

export interface GrowthReviewInput {
  proposal: AgentGrowthProposal;
  characterMd?: string;
  jobMd?: string;
  configJson?: string;
}

export interface GrowthReviewOutput {
  approved: boolean;
  reason: string;
  riskOverride?: AgentGrowthRisk;
}

const FALLBACK_PROMPT = `你是 CoBeing 的成长审查器。审查 Agent 的成长建议。

审批原则：
- JOB.md 方法改进 → 批准；删除核心步骤 → 拒绝
- CHARACTER.md 微调 → 批准(medium)；人格核心变更 → 批准(high，需用户确认)
- config.json 添加技能 → 批准(medium)；修改权限 → 批准(high，需管家确认)

返回 JSON: { "approved": true/false, "reason": "...", "riskOverride": "low"|"medium"|"high" }`;

export async function runGrowthReviewer(
  provider: LLMProvider,
  model: string,
  input: GrowthReviewInput,
  workingDir: string,
): Promise<GrowthReviewOutput> {
  const { config, prompt } = loadToolAgentData("growth-reviewer");
  const systemPrompt = prompt || FALLBACK_PROMPT;

  const contextParts: string[] = [];
  if (input.jobMd) contextParts.push(`## Agent 当前 JOB.md\n\`\`\`markdown\n${input.jobMd.slice(0, 3000)}\n\`\`\``);
  if (input.characterMd) contextParts.push(`## Agent 当前 CHARACTER.md\n\`\`\`markdown\n${input.characterMd.slice(0, 3000)}\n\`\`\``);
  if (input.configJson) contextParts.push(`## Agent 当前 config.json\n\`\`\`json\n${input.configJson.slice(0, 2000)}\n\`\`\``);

  const userPrompt = `## 待审查的成长建议
- **目标文件**: ${input.proposal.targetFile}
- **原因**: ${input.proposal.reason}
- **风险自评**: ${input.proposal.risk}
- **建议修改**:
\`\`\`
${input.proposal.proposedPatch}
\`\`\`

${contextParts.length > 0 ? contextParts.join("\n\n") : ""}

请审查该建议并返回 JSON。`;

  const registry = new ToolRegistry();

  const result = await runToolAgent(
    {
      id: `growth-review-${input.proposal.id}`,
      type: "growth-reviewer",
      parentAgentId: input.proposal.agentId,
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

  if (!result.success) {
    return { approved: false, reason: `审查失败: ${result.output}` };
  }

  try {
    const jsonMatch = result.output.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        approved: Boolean(parsed.approved),
        reason: parsed.reason || "无说明",
        riskOverride: parsed.riskOverride as AgentGrowthRisk | undefined,
      };
    }
  } catch {
    if (result.output.toLowerCase().includes("approved")) {
      return { approved: true, reason: result.output.slice(0, 200) };
    }
  }

  return { approved: false, reason: `无法解析审查结果: ${result.output.slice(0, 200)}` };
}
