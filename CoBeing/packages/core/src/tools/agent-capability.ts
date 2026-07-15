/**
 * Agent Capability 工具 — 能力卡读写
 */
import type { Tool, ToolContext, ToolResult } from "@cobeing/shared";
import type { LLMProvider } from "@cobeing/providers";
import { createDefaultCapabilityCard, type AgentFiles } from "../agent/paths.js";
import { runCapabilityUpdater } from "../agent/tool-agent/capability-updater.js";

export function makeAgentGetCapabilityTool(files: AgentFiles): Tool {
  return {
    name: "agent-get-capability",
    description: "读取本 Agent 的能力画像 (CapabilityCard)，包含擅长领域、任务类型、可靠性指标等。",
    parameters: { type: "object", properties: {}, required: [] },
    async execute(_params, _context: ToolContext): Promise<ToolResult> {
      const card = files.readCapability();
      if (!card) {
        return { toolCallId: "", content: "暂无能力画像，请联系管家创建。" };
      }
      return { toolCallId: "", content: JSON.stringify(card, null, 2) };
    },
  };
}

export function makeAgentUpdateCapabilityTool(
  files: AgentFiles,
  provider: LLMProvider,
  model: string,
): Tool {
  return {
    name: "agent-update-capability",
    description: "更新本 Agent 的能力画像。传入要修改的内容描述，由 CapabilityUpdater ToolAgent 生成更新后的完整卡片。",
    parameters: {
      type: "object",
      properties: {
        updateIntent: { type: "string", description: "描述你想更新能力画像的哪些方面及原因。" },
      },
      required: ["updateIntent"],
    },
    async execute(params, context: ToolContext): Promise<ToolResult> {
      let currentCard = files.readCapability();
      if (!currentCard) {
        const config = files.readConfig();
        currentCard = createDefaultCapabilityCard({
          agentId: context.agentId ?? (config.id as string | undefined) ?? "agent",
          displayName: (context as any).agentName ?? (config.name as string | undefined) ?? context.agentId ?? "Agent",
          role: (config.role as string | undefined) ?? "",
          tools: config.tools as string[] | undefined,
          skills: config.skills as string[] | undefined,
        });
        files.writeCapability(currentCard);
      }

      const reflections = files.readReflections();
      const workingDir = process.cwd();

      const updated = await runCapabilityUpdater(
        provider,
        model,
        {
          currentCard,
          updateIntent: params.updateIntent as string,
          recentReflections: reflections.slice(-10),
        },
        workingDir,
      );

      if (!updated) {
        return { toolCallId: "", content: "能力画像更新失败，请稍后重试。", isError: true };
      }

      files.writeCapability(updated);
      return { toolCallId: "", content: `能力画像已更新。\n\`\`\`json\n${JSON.stringify(updated, null, 2)}\n\`\`\`` };
    },
  };
}
