/**
 * Agent enhancement 域 WS 命令 handler — 从 ws-server.ts 的 switch 迁移
 * get_agent_capability / get_agent_inbox / get_agent_proposals /
 * approve_proposal / reject_proposal
 */
import fs from "node:fs";
import path from "node:path";
import { AgentPaths, AgentFiles } from "../../agent/paths.js";
import { isSafeId, isSafeLeafFilename } from "../security.js";
import type { HandlerRegistrar } from "./types.js";

export function registerEnhancementHandlers(register: HandlerRegistrar): void {
  register("get_agent_capability", function (ws, msg) {
    const { agentId: aId } = msg.payload as { agentId: string };
    if (!aId || !isSafeId(aId)) {
      this.sendToClient(ws, { type: "error", payload: { message: "Invalid agentId" } });
      return;
    }
    const aPaths = AgentPaths.forAgent(aId, this.dataRoot);
    const capPath = aPaths.capabilityPath;
    if (!fs.existsSync(capPath)) {
      this.sendToClient(ws, { type: "agent_capability", payload: { agentId: aId, capability: null } });
      return;
    }
    try {
      const capability = JSON.parse(fs.readFileSync(capPath, "utf-8"));
      this.sendToClient(ws, { type: "agent_capability", payload: { agentId: aId, capability } });
    } catch {
      this.sendToClient(ws, { type: "error", payload: { message: "Failed to read capability" } });
    }
  });

  register("get_agent_inbox", function (ws, msg) {
    const { agentId: inId } = msg.payload as { agentId: string };
    if (!inId || !isSafeId(inId)) {
      this.sendToClient(ws, { type: "error", payload: { message: "Invalid agentId" } });
      return;
    }
    const inPaths = AgentPaths.forAgent(inId, this.dataRoot);
    const inboxPath = inPaths.inboxPath;
    if (!fs.existsSync(inboxPath)) {
      this.sendToClient(ws, { type: "agent_inbox", payload: { agentId: inId, active: [], archived: [] } });
      return;
    }
    try {
      const data = JSON.parse(fs.readFileSync(inboxPath, "utf-8"));
      const active = Array.isArray(data) ? data : (data.active ?? []);
      const archived = Array.isArray(data) ? [] : (data.archived ?? []);
      this.sendToClient(ws, { type: "agent_inbox", payload: { agentId: inId, active, archived } });
    } catch {
      this.sendToClient(ws, { type: "error", payload: { message: "Failed to read inbox" } });
    }
  });

  register("get_agent_proposals", function (ws, msg) {
    const { agentId: pId } = msg.payload as { agentId: string };
    if (!pId || !isSafeId(pId)) {
      this.sendToClient(ws, { type: "error", payload: { message: "Invalid agentId" } });
      return;
    }
    const pPaths = AgentPaths.forAgent(pId, this.dataRoot);
    const proposalsDir = pPaths.proposalsDir;
    if (!fs.existsSync(proposalsDir)) {
      this.sendToClient(ws, { type: "agent_proposals", payload: { agentId: pId, proposals: [] } });
      return;
    }
    const proposals: import("@cobeing/shared").AgentGrowthProposal[] = [];
    for (const pf of fs.readdirSync(proposalsDir)) {
      if (!pf.endsWith(".json")) continue;
      try {
        proposals.push(JSON.parse(fs.readFileSync(path.join(proposalsDir, pf), "utf-8")));
      } catch { /* skip */ }
    }
    this.sendToClient(ws, { type: "agent_proposals", payload: { agentId: pId, proposals } });
  });

  register("approve_proposal", function (ws, msg) {
    const { agentId: apId, proposalId } = msg.payload as { agentId: string; proposalId: string };
    if (!apId || !isSafeId(apId) || !proposalId || !isSafeLeafFilename(proposalId + ".json")) {
      this.sendToClient(ws, { type: "error", payload: { message: "Invalid parameters" } });
      return;
    }
    const apPaths = AgentPaths.forAgent(apId, this.dataRoot);
    const propPath = apPaths.proposalPath(proposalId);
    if (!fs.existsSync(propPath)) {
      this.sendToClient(ws, { type: "error", payload: { message: "Proposal not found" } });
      return;
    }
    try {
      const prop = JSON.parse(fs.readFileSync(propPath, "utf-8")) as import("@cobeing/shared").AgentGrowthProposal;
      prop.status = "applied";
      prop.reviewedBy = "user";
      prop.reviewedAt = new Date().toISOString();
      fs.writeFileSync(propPath, JSON.stringify(prop, null, 2), "utf-8");

      const apFiles = new AgentFiles(apPaths);
      // 新体系：Agent 有 EXPRESSION.md（人味表达规范）时，CHARACTER.md 建议改写入 EXPRESSION.md
      if (prop.targetFile === "CHARACTER.md") {
        if (apFiles.readExpression()) {
          apFiles.writeExpression(prop.proposedPatch);
        } else {
          apFiles.writeCharacter(prop.proposedPatch);
        }
      } else if (prop.targetFile === "config.json") {
        try {
          const newConfig = JSON.parse(prop.proposedPatch);
          apFiles.writeConfig(newConfig);
        } catch {
          this.sendToClient(ws, { type: "error", payload: { message: "Proposed config.json patch is not valid JSON" } });
          return;
        }
      }

      this.sendToClient(ws, { type: "proposal_applied", payload: { agentId: apId, proposalId, targetFile: prop.targetFile } });
    } catch (e) {
      this.sendToClient(ws, { type: "error", payload: { message: `Failed to apply proposal: ${(e as Error).message}` } });
    }
  });

  register("reject_proposal", function (ws, msg) {
    const { agentId: rpId, proposalId: rPropId } = msg.payload as { agentId: string; proposalId: string };
    if (!rpId || !isSafeId(rpId) || !rPropId || !isSafeLeafFilename(rPropId + ".json")) {
      this.sendToClient(ws, { type: "error", payload: { message: "Invalid parameters" } });
      return;
    }
    const rpPaths = AgentPaths.forAgent(rpId, this.dataRoot);
    const rPropPath = rpPaths.proposalPath(rPropId);
    if (!fs.existsSync(rPropPath)) {
      this.sendToClient(ws, { type: "error", payload: { message: "Proposal not found" } });
      return;
    }
    try {
      const prop = JSON.parse(fs.readFileSync(rPropPath, "utf-8")) as import("@cobeing/shared").AgentGrowthProposal;
      prop.status = "rejected";
      prop.reviewedBy = "user";
      prop.reviewedAt = new Date().toISOString();
      fs.writeFileSync(rPropPath, JSON.stringify(prop, null, 2), "utf-8");
      this.sendToClient(ws, { type: "proposal_rejected", payload: { agentId: rpId, proposalId: rPropId } });
    } catch (e) {
      this.sendToClient(ws, { type: "error", payload: { message: `Failed to reject proposal: ${(e as Error).message}` } });
    }
  });
}
