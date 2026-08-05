/**
 * Agent 能力卡扫描与评分 — 从 ws-server.ts 提取
 */
import fs from "node:fs";
import path from "node:path";
import type { AgentCapabilityCard } from "@cobeing/shared";

export function loadCapabilityCards(
  dataRoot: string,
  excludeAgentIds: string[] = [],
): AgentCapabilityCard[] {
  const cards: AgentCapabilityCard[] = [];
  for (const dir of [path.join(dataRoot, "agents"), path.join(dataRoot, "coreagents")]) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || excludeAgentIds.includes(entry.name)) continue;
      const capPath = path.join(dir, entry.name, "capability.json");
      if (!fs.existsSync(capPath)) continue;
      try {
        const card = JSON.parse(fs.readFileSync(capPath, "utf-8")) as AgentCapabilityCard;
        if (card.agentId) cards.push(card);
      } catch {
        // Ignore malformed local capability files.
      }
    }
  }
  return cards;
}

export function scoreCapability(
  card: AgentCapabilityCard,
  taskDescription: string,
  requiredDomains: string[] = [],
): { score: number; confidence: number; reason: string } {
  const taskTerms = taskDescription
    .toLowerCase()
    .split(/[\s,.;:，。；、：()[\]{}"'`]+/u)
    .map(t => t.trim())
    .filter(t => t.length > 1);
  const required = requiredDomains.map(d => d.toLowerCase().trim()).filter(Boolean);
  const haystack = [
    card.role,
    ...(card.domains ?? []),
    ...(card.strengths ?? []),
    ...(card.limitations ?? []),
    ...(card.taskTypes ?? []).flatMap(t => [t.label, ...t.examples, ...t.inputRequirements, ...t.outputFormats]),
    ...(card.preferredTools ?? []),
    ...(card.preferredSkills ?? []),
  ].join(" ").toLowerCase();

  let score = 0;
  const hits: string[] = [];
  for (const term of [...required, ...taskTerms]) {
    if (haystack.includes(term)) {
      score += required.includes(term) ? 3 : 1;
      if (!hits.includes(term)) hits.push(term);
    }
  }
  const confidence = Math.min(0.95, Math.max(0.1, score / Math.max(4, required.length * 3 + taskTerms.length)));
  return {
    score,
    confidence,
    reason: hits.length > 0 ? `命中能力关键词: ${hits.slice(0, 8).join(", ")}` : "未命中明确关键词，按现有能力画像排序",
  };
}
