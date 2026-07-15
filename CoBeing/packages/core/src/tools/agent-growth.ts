/**
 * Agent Growth 工具 — 经验反思和成长建议
 */
import type { Tool, ToolContext, ToolResult, AgentGrowthProposal, AgentGrowthRisk, AgentGrowthTarget } from "@cobeing/shared";
import type { LLMProvider } from "@cobeing/providers";
import type { AgentFiles } from "../agent/paths.js";
import { runGrowthReviewer } from "../agent/tool-agent/growth-reviewer.js";

export function makeAgentReflectExperienceTool(files: AgentFiles): Tool {
  return {
    name: "agent-reflect-experience",
    description: "对当前完成的任务进行结构化反思，自动写入 EXPERIENCE.md 和 reflection.json。",
    parameters: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "关联的任务 ID" },
        outcome: { type: "string", enum: ["success", "partial", "failed"] },
        whatWorked: { type: "array", items: { type: "string" }, description: "哪些方法有效" },
        whatFailed: { type: "array", items: { type: "string" }, description: "哪些方法失败或无效" },
        userPreferences: { type: "array", items: { type: "string" }, description: "观察到的用户偏好" },
        toolLessons: { type: "array", items: { type: "string" }, description: "关于工具使用的经验" },
        lesson: { type: "string", description: "总体教训：下次怎么做更好" },
      },
      required: ["taskId", "outcome"],
    },
    async execute(params, context: ToolContext): Promise<ToolResult> {
      const record = {
        id: `ref_${Date.now()}`,
        agentId: context.agentId ?? "",
        taskId: params.taskId as string,
        outcome: params.outcome as "success" | "partial" | "failed",
        whatWorked: params.whatWorked as string[] ?? [],
        whatFailed: params.whatFailed as string[] ?? [],
        userPreferences: params.userPreferences as string[] ?? [],
        toolLessons: params.toolLessons as string[] ?? [],
        suggestedJobUpdates: [],
        suggestedCharacterUpdates: [],
        createdAt: new Date().toISOString(),
      };
      files.addReflection(record as any);

      const lesson = params.lesson as string | undefined;
      if (lesson && lesson.length >= 10) {
        files.appendExperience({
          task: `反思: ${params.taskId}`,
          problem: record.whatFailed.join("; ") || "无",
          solution: record.whatWorked.join("; ") || "见反思记录",
        });
      }

      return { toolCallId: "", content: `✅ 反思记录已保存 (${record.id})` };
    },
  };
}

function makeProposeUpdateTool(
  files: AgentFiles,
  targetFile: AgentGrowthTarget,
  provider: LLMProvider,
  model: string,
): Tool {
  const toolNames: Record<string, string> = {
    "JOB.md": "agent-propose-job-update",
    "CHARACTER.md": "agent-propose-character-update",
    "config.json": "agent-propose-config-update",
  };

  const descriptions: Record<string, string> = {
    "JOB.md": "生成 JOB.md 的修改建议。适合在多次任务反复出现同一经验后调用。",
    "CHARACTER.md": "生成 CHARACTER.md 的修改建议。⚠️ 人格修改必须经过 GrowthReviewer 和用户确认。",
    "config.json": "生成 config.json 的修改建议。⚠️ 涉及权限和工具的变更必须经过审批。",
  };

  return {
    name: toolNames[targetFile],
    description: descriptions[targetFile],
    parameters: {
      type: "object",
      properties: {
        reason: { type: "string", description: "修改原因" },
        proposedPatch: { type: "string", description: `建议的 ${targetFile} 修改内容` },
        risk: { type: "string", enum: ["low", "medium", "high"], description: "自评风险等级" },
      },
      required: ["reason", "proposedPatch"],
    },
    async execute(params, context: ToolContext): Promise<ToolResult> {
      const proposal: AgentGrowthProposal = {
        id: `prop_${Date.now()}`,
        agentId: context.agentId ?? "",
        targetFile,
        reason: params.reason as string,
        proposedPatch: params.proposedPatch as string,
        risk: (params.risk as AgentGrowthRisk) ?? "medium",
        status: "pending",
        createdAt: new Date().toISOString(),
      };

      files.writeProposal(proposal as any);

      const workingDir = process.cwd();
      try {
        const reviewResult = await runGrowthReviewer(provider, model, {
          proposal: proposal as any,
          characterMd: files.readCharacter(),
          jobMd: files.readJob(),
          configJson: JSON.stringify(files.readConfig()),
        }, workingDir);

        proposal.status = reviewResult.approved ? "approved" : "rejected";
        proposal.reviewedBy = "growth-reviewer";
        proposal.reviewedAt = new Date().toISOString();
        proposal.reviewNote = reviewResult.reason;
        if (reviewResult.riskOverride) proposal.risk = reviewResult.riskOverride;

        files.writeProposal(proposal as any);

        if (reviewResult.approved) {
          const needsExtra = targetFile === "CHARACTER.md" || targetFile === "config.json"
            ? "\n⚠️ 此类型修改还需用户/管家最终确认后才能应用。"
            : "";
          return { toolCallId: "", content: `✅ 成长建议已批准: ${proposal.id}\n\n审查意见: ${reviewResult.reason}${needsExtra}` };
        } else {
          return { toolCallId: "", content: `❌ 成长建议被拒绝: ${proposal.id}\n\n审查意见: ${reviewResult.reason}` };
        }
      } catch {
        return { toolCallId: "", content: `⚠️ 成长建议已提交 (${proposal.id})，但自动审批暂时不可用，等待人工审查。` };
      }
    },
  };
}

export function makeAgentProposeJobUpdateTool(files: AgentFiles, provider: LLMProvider, model: string): Tool {
  return makeProposeUpdateTool(files, "JOB.md", provider, model);
}

export function makeAgentProposeCharacterUpdateTool(files: AgentFiles, provider: LLMProvider, model: string): Tool {
  return makeProposeUpdateTool(files, "CHARACTER.md", provider, model);
}

export function makeAgentProposeConfigUpdateTool(files: AgentFiles, provider: LLMProvider, model: string): Tool {
  return makeProposeUpdateTool(files, "config.json", provider, model);
}
