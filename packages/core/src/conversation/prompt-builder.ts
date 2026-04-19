/**
 * System Prompt 组装器
 */
import type { AgentConfig } from "@myagents/shared";
import type { AgentFiles } from "../agent/paths.js";

export function buildSystemPrompt(agentConfig: AgentConfig): string {
  const parts: string[] = [];

  parts.push(agentConfig.systemPrompt);

  if (agentConfig.role) {
    parts.push(`\n你的角色是: ${agentConfig.role}`);
  }

  parts.push("\n你可以使用工具来完成任务。当需要执行操作时，请调用合适的工具。");

  return parts.join("\n");
}

interface PromptConfig {
  name: string;
  role: string;
  systemPrompt: string;
}

/**
 * 从 Agent 文件链构建 system prompt
 *
 * 链式顺序：SOUL → BOOTSTRAP → systemPrompt(role) → AGENTS → USER → EXPERIENCE → MEMORY
 * BOOTSTRAP 读取后自动删除（一次性引导）
 */
export function buildSystemPromptFromFiles(files: AgentFiles, config: PromptConfig): string {
  const parts: string[] = [];

  // 1. SOUL.md — 人格基底
  const soul = files.readSoul();
  if (soul) {
    parts.push(soul);
  }

  // 2. BOOTSTRAP.md — 启动引导（一次性，读取后删除）
  const bootstrap = files.consumeBootstrap();
  if (bootstrap) {
    parts.push(bootstrap);
  }

  // 3. systemPrompt — 角色描述（主体）
  parts.push(config.systemPrompt || `你是${config.name}，${config.role}`);

  // 4. AGENTS.md — 工作空间指南
  const agents = files.readAgents();
  if (agents) {
    parts.push(agents);
  }

  // 5. USER.md — 用户偏好
  const user = files.readUser();
  if (user) {
    parts.push(`# 用户偏好\n\n${user}`);
  }

  // 6. EXPERIENCE.md — 相关经验（跳过短内容噪声）
  const experience = files.readExperience();
  if (experience && experience.length > 50) {
    parts.push(`# 你积累的经验\n\n${experience}`);
  }

  // 7. MEMORY.md — 历史记忆索引
  const memory = files.readMemoryIndex();
  if (memory) {
    parts.push(`# 你的历史记忆\n\n${memory}`);
  }

  return parts.join("\n\n");
}
