/**
 * System Prompt 组装器
 */
import type { AgentConfig } from "@myagents/shared";

export function buildSystemPrompt(agentConfig: AgentConfig): string {
  const parts: string[] = [];

  parts.push(agentConfig.systemPrompt);

  if (agentConfig.role) {
    parts.push(`\n你的角色是: ${agentConfig.role}`);
  }

  parts.push("\n你可以使用工具来完成任务。当需要执行操作时，请调用合适的工具。");

  return parts.join("\n");
}
