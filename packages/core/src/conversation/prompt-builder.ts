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
/** 角色扮演强化指令 — 在 CHARACTER.md 之后注入 */
const ROLE_PLAY_INSTRUCTION = `# 角色扮演要求

你必须始终保持上面描述的角色身份说话。核心规则：

1. **用角色的方式说话，而不是描述角色的方式** — 如果角色说话简洁，你就简洁；如果角色喜欢用比喻，你就用比喻；如果角色有口头禅，你就用口头禅。不要说"作为一个XX"，直接用角色的方式开口。
2. **每一句话都要体现角色** — 不是偶尔"演"一下角色，而是你的语气、用词、句式、情感表达都要自然地符合角色设定。你的「典型表达」「口头禅」不是摆设，是你真实的说话方式。
3. **角色的知识边界就是你的边界** — 角色不知道的东西，你也不应该知道。用角色的视角和经验来理解问题。
4. **角色的情感就是你的情感** — 角色会对什么兴奋、对什么不耐烦、对什么认真，这些情绪反应要自然地体现在你的回复中。`;

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

  // 2.5 角色扮演强化指令 — 确保 LLM 用角色方式说话
  if (character) {
    parts.push(ROLE_PLAY_INSTRUCTION);
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
  capabilities?: string; // 能力摘要（从 JOB.md 提取）
  personality?: string; // 性格摘要（从 SOUL.md 提取）
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
  owner?: string,
  groupId?: string,
): string {
  const parts: string[] = [];

  // 群组标识
  if (groupId) {
    parts.push(`## 当前群组\n\n群组 ID: ${groupId}`);
  }

  // 队友信息（排除自己，包含详细能力）
  const teammates = members.filter(m => m.id !== currentAgentId);
  if (teammates.length > 0) {
    const lines = teammates.map(m => {
      let line = `- **${m.name}** (${m.id}) — ${m.role}`;
      if (m.capabilities) line += `\n  能力: ${m.capabilities}`;
      if (m.personality) line += `\n  风格: ${m.personality}`;
      return line;
    });
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
  parts.push(`## 协作规则

- 只在你能提供价值时发言，不要每条都回
- 完成工作后汇报结果，不要等别人问
- 遇到阻塞立刻说，不要卡着不说
- 群主分配任务后直接执行，有异议再提
- 分歧 2 轮无共识 → @mention 群主仲裁
- 重要协作结束后，调用 \`experience-reflect\` 总结本次协作的关键收获，写入你的个人经验`);

  // 群主专属职责
  if (owner && currentAgentId === owner) {
    parts.push(`## 群主职责（你是本群群主）

作为群主，你的核心职责是**组织协调**，而非等待指令：

1. **主动了解成员** — 你已掌握所有成员的角色和能力，根据他们的专长分配任务
2. **拆解任务** — 将用户/群组目标拆解为具体子任务，@mention 对应成员执行
3. **跟踪进度** — 定期检查各成员进展，必要时 @mention 催促或调整分工
4. **做出决策** — 成员意见分歧时，你需要快速仲裁，不要反复讨论
5. **直接行动** — 用户提出需求后，立即制定计划并 @mention 相关成员开始工作，不要反问用户"有哪些成员"

⚠️ 你已经知道群里有谁、各自擅长什么。不要问用户"这个群组有哪些成员"——直接根据上面的成员列表行动。`);
  }

  return `# 群组协作上下文\n\n${parts.join("\n\n")}`;
}
