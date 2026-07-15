// gui-v2/src/lib/coreAgents.ts
// Core agent filtering — keeps butler/host out of user-facing Agent views

export const CORE_AGENT_IDS = new Set(["butler", "host"]);

export function isCoreAgent(id: string): boolean {
  return CORE_AGENT_IDS.has(id);
}

export function getVisibleUserAgents<T extends { id: string }>(agents: T[]): T[] {
  return agents.filter((agent) => !isCoreAgent(agent.id));
}
