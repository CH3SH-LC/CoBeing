/**
 * Butler review tools
 * (butler-review-proposals)
 */
import type { Tool, ToolContext, ToolResult } from "@cobeing/shared";
import path from "node:path";
import fs from "node:fs";

export function makeReviewProposalsTool(dataRoot: string): Tool {
  return {
    name: "butler-review-proposals",
    description: "扫描所有 Agent 的待审批成长建议 (GrowthProposals)，列出需要用户最终确认的建议。",
    parameters: { type: "object", properties: {}, required: [] },
    async execute(_params, _context: ToolContext): Promise<ToolResult> {
      const results: string[] = [];
      const agentsDir = path.join(dataRoot, "agents");
      const coreAgentsDir = path.join(dataRoot, "coreagents");

      for (const dir of [agentsDir, coreAgentsDir]) {
        if (!fs.existsSync(dir)) continue;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          const proposalsDir = path.join(dir, entry.name, "proposals");
          if (!fs.existsSync(proposalsDir)) continue;

          for (const pf of fs.readdirSync(proposalsDir)) {
            if (!pf.endsWith(".json")) continue;
            try {
              const proposal = JSON.parse(fs.readFileSync(path.join(proposalsDir, pf), "utf-8")) as import("@cobeing/shared").AgentGrowthProposal;
              if (proposal.status === "approved" && (proposal.targetFile === "CHARACTER.md" || proposal.targetFile === "config.json")) {
                results.push(`- [${proposal.targetFile}] **${entry.name}**: ${proposal.reason.slice(0, 100)} (风险: ${proposal.risk}) [${proposal.id}]`);
              }
            } catch { /* skip */ }
          }
        }
      }

      if (results.length === 0) {
        return { toolCallId: "", content: "没有需要用户确认的待审批成长建议。" };
      }

      return { toolCallId: "", content: `## 待用户确认的成长建议\n\n${results.join("\n")}\n\n使用 WS 命令 approve_proposal / reject_proposal 处理。` };
    },
  };
}
