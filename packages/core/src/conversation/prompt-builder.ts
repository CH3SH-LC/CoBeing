/**
 * System Prompt 组装器
 */
import type { AgentConfig } from "@cobeing/shared";
import type { AgentFiles } from "../agent/paths.js";
import type { MemoryStore } from "../memory/memory-store.js";

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
 * 从 Agent 文件链 + MemoryStore 快照构建 system prompt
 *
 * 链式顺序：SOUL → CHARACTER → BOOTSTRAP → systemPrompt(role) → JOB → AGENTS → MemoryStore 快照（USER → TOOLS → EXPERIENCE → MEMORY）
 */
export function buildSystemPromptFromFiles(files: AgentFiles, config: PromptConfig, memoryStore?: MemoryStore): string {
  const parts: string[] = [];

  // 1. SOUL.md — 性格特质
  const soul = files.readSoul();
  if (soul) {
    parts.push(soul);
  }

  // 2. CHARACTER.md — 人物描写与背景
  const character = files.readCharacter();
  if (character) {
    parts.push(character);
  }

  // 3. BOOTSTRAP.md — 创建时知识和行为提醒（不删除，每次激发）
  const bootstrap = files.readBootstrap();
  if (bootstrap) {
    parts.push(bootstrap);
  }

  // 4. systemPrompt — 角色描述（主体）
  parts.push(config.systemPrompt || `你是${config.name}，${config.role}`);

  // 5. JOB.md — 专注领域与专长
  const job = files.readJob();
  if (job) {
    parts.push(job);
  }

  // 6. AGENTS.md — 工作空间指南
  const agents = files.readAgents();
  if (agents) {
    parts.push(agents);
  }

  // 7-10. 从 MemoryStore 快照加载（如果提供了 MemoryStore）
  if (memoryStore) {
    const snapshotBlock = memoryStore.snapshotForSystemPrompt();
    if (snapshotBlock) {
      parts.push(snapshotBlock);
    }
  } else {
    // 兼容路径：无 MemoryStore 时直接从文件读取
    const user = files.readUser();
    if (user) {
      parts.push(`# 用户偏好\n\n${user}`);
    }

    const tools = files.readTools();
    if (tools && tools.length > 50) {
      parts.push(tools);
    }

    const experience = files.readExperience();
    if (experience && experience.length > 50) {
      parts.push(`# 你积累的经验\n\n${experience}`);
    }

    const memory = files.readMemoryIndex();
    if (memory) {
      parts.push(`# 你的历史记忆\n\n${memory}`);
    }
  }

  return parts.join("\n\n");
}

// ---- 群组协作上下文注入 ----

/** 成员画像摘要 */
export interface MemberProfile {
  id: string;
  name: string;
  role: string; // JOB.md 专注领域摘要
}

/** 群组 workspace 数据 */
export interface GroupWorkspaceData {
  task?: string | null;
  plan?: string | null;
  progress?: string | null;
  experienceSummary?: string | null;
}

/** 群组 TODO 摘要 */
export interface GroupTodoSummary {
  id: string;
  title: string;
  status: string;
  assignee?: string;
}

/**
 * 构建群组协作上下文，注入到 system prompt 末尾
 */
export function buildGroupCollaborationContext(
  currentAgentId: string,
  members: MemberProfile[],
  workspace: GroupWorkspaceData,
  todos: GroupTodoSummary[],
): string {
  const parts: string[] = [];

  // 队友信息（排除自己）
  const teammates = members.filter(m => m.id !== currentAgentId);
  if (teammates.length > 0) {
    const lines = teammates.map(m => `- ${m.name} (${m.id}) — ${m.role}`);
    parts.push(`## 你的队友\n\n${lines.join("\n")}`);
  }

  // 当前任务
  if (workspace.task) {
    const truncated = workspace.task.length > 500 ? workspace.task.slice(0, 500) + "..." : workspace.task;
    parts.push(`## 当前任务\n\n${truncated}`);
  }

  // 当前计划
  if (workspace.plan) {
    const truncated = workspace.plan.length > 500 ? workspace.plan.slice(0, 500) + "..." : workspace.plan;
    parts.push(`## 当前计划\n\n${truncated}`);
  }

  // 当前进度
  if (workspace.progress) {
    const truncated = workspace.progress.length > 500 ? workspace.progress.slice(0, 500) + "..." : workspace.progress;
    parts.push(`## 当前进度\n\n${truncated}`);
  }

  // 待办事项
  if (todos.length > 0) {
    const lines = todos.map(t =>
      `- [${t.status}] ${t.title} (ID: ${t.id})${t.assignee ? ` → ${t.assignee}` : " → 待分配"}`
    );
    parts.push(`## 待办事项\n\n${lines.join("\n")}`);
  }

  // 群组经验
  if (workspace.experienceSummary) {
    parts.push(`## 群组经验\n\n${workspace.experienceSummary}`);
  }

  // 协作行为指引
  parts.push(`## 协作行为指引

- 讨论涉及你的 JOB 领域时，主动提供专业意见
- 任务超出你的 JOB 范围时，@mention 擅长该领域的队友求助
- 完成阶段性工作后，向群组汇报进度
- 遇到阻塞时，主动告知群组并说明原因
- 与队友观点分歧 2 轮仍无共识时，@mention 群主请求仲裁
- 群主做出决策后，执行决策，不要继续争论
- 不要对每条消息都回复，只在你能提供真正价值时才发言`);

  return `# 群组协作上下文\n\n${parts.join("\n\n")}`;
}
