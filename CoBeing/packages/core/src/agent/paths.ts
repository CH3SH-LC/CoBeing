/**
 * AgentPaths — 管理 Agent 独立目录下的所有文件路径
 */
import path from "node:path";
import fs from "node:fs";
import { maintainExperienceSummarySync } from "../conversation/prompt-builder.js";
import type { AgentCapabilityCard, AgentTaskInboxItem, AgentGrowthProposal, AgentReflectionRecord } from "@cobeing/shared";

export function isSafeAgentId(agentId: string): boolean {
  if (!agentId || agentId.length > 128) return false;
  if (agentId === "." || agentId === "..") return false;
  if (path.isAbsolute(agentId)) return false;
  // Keep the id as one filesystem path segment while allowing existing Unicode names.
  return !/[\\/\x00-\x1F<>:"|?*]|\s$|\.$/u.test(agentId);
}

export class AgentPaths {
  constructor(private baseDir: string) {}

  /** Agent 根目录路径 */
  get directory(): string { return this.baseDir; }

  /** 旧角色文件（兼容历史数据；新 Agent 不再生成） */
  get characterPath()  { return path.join(this.baseDir, "CHARACTER.md"); }
  /** 人味表达规范 — 新 Agent 的表达方式约束（无身份设定） */
  get expressionPath() { return path.join(this.baseDir, "EXPRESSION.md"); }
  get jobPath()        { return path.join(this.baseDir, "JOB.md"); }
  get agentsPath()     { return path.join(this.baseDir, "AGENTS.md"); }
  get experiencePath() { return path.join(this.baseDir, "EXPERIENCE.md"); }
  get memoryIndexPath(){ return path.join(this.baseDir, "MEMORY.md"); }
  get memoryDir()      { return path.join(this.baseDir, "memory"); }
  get workspaceDir()   { return path.join(this.baseDir, "workspace"); }
  get configPath()     { return path.join(this.baseDir, "config.json"); }
  get skillsDir()      { return path.join(this.baseDir, "skills"); }
  get dbPath()           { return path.join(this.baseDir, "memory.db"); }
  get capabilityPath()   { return path.join(this.baseDir, "capability.json"); }
  get inboxPath()        { return path.join(this.baseDir, "inbox.json"); }
  get reflectionPath()   { return path.join(this.baseDir, "reflection.json"); }
  get proposalsDir()     { return path.join(this.baseDir, "proposals"); }
  proposalPath(id: string) { return path.join(this.baseDir, "proposals", `${id}.json`); }

  static forAgent(agentId: string, dataRoot?: string): AgentPaths {
    if (!isSafeAgentId(agentId)) {
      throw new Error(`Invalid agentId: ${agentId}`);
    }
    const category = (agentId === "butler" || agentId === "host") ? "coreagents" : "agents";
    const root = dataRoot
      ? path.join(dataRoot, category)
      : path.resolve("data", category);
    return new AgentPaths(path.join(root, agentId));
  }

  /** 确保目录结构存在 */
  ensureDirs(): void {
    fs.mkdirSync(this.baseDir, { recursive: true });
    fs.mkdirSync(this.memoryDir, { recursive: true });
    fs.mkdirSync(this.workspaceDir, { recursive: true });
    fs.mkdirSync(this.skillsDir, { recursive: true });
    fs.mkdirSync(this.proposalsDir, { recursive: true });
  }
}

export function createDefaultCapabilityCard(input: {
  agentId: string;
  displayName: string;
  role: string;
  capabilities?: string;
  tools?: string[];
  skills?: string[];
}): AgentCapabilityCard {
  const rawDomains = input.capabilities || input.role;
  const domains = rawDomains
    .split(/[,;，；、\n]/)
    .map(part => part.trim())
    .filter(Boolean)
    .slice(0, 8);

  const normalizedDomains = domains.length > 0 ? domains : ["general"];

  return {
    agentId: input.agentId,
    displayName: input.displayName,
    role: input.role,
    domains: normalizedDomains,
    strengths: normalizedDomains,
    limitations: ["New agent; capability profile has not been refined through completed work yet."],
    taskTypes: [
      {
        id: "general-task",
        label: input.role || "General task",
        examples: normalizedDomains.slice(0, 3),
        inputRequirements: ["Clear goal", "Acceptance criteria when available"],
        outputFormats: ["Concise result summary", "Artifacts or next steps when relevant"],
      },
    ],
    preferredTools: input.tools ?? [],
    preferredSkills: input.skills ?? [],
    collaboration: {
      canWorkAlone: true,
      goodInGroups: true,
      needsReviewFor: ["High-risk actions", "User-facing final decisions"],
      shouldDelegate: ["Tasks outside listed domains", "Work requiring unavailable tools or permissions"],
    },
    reliability: {
      completedTasks: 0,
      failedTasks: 0,
      lastUpdated: new Date().toISOString(),
    },
  };
}

export class AgentFiles {
  constructor(private paths: AgentPaths) {}

  /** 读取 CHARACTER.md（旧角色文件，兼容历史数据） */
  readCharacter(): string {
    return this.readFile(this.paths.characterPath);
  }

  /** 写入 CHARACTER.md（旧角色文件，兼容） */
  writeCharacter(content: string): void {
    fs.writeFileSync(this.paths.characterPath, content, "utf-8");
  }

  /** 读取 EXPRESSION.md（人味表达规范） */
  readExpression(): string {
    return this.readFile(this.paths.expressionPath);
  }

  /** 写入 EXPRESSION.md */
  writeExpression(content: string): void {
    fs.writeFileSync(this.paths.expressionPath, content, "utf-8");
  }

  /** 读取 JOB.md */
  readJob(): string {
    return this.readFile(this.paths.jobPath);
  }

  /** 写入 JOB.md */
  writeJob(content: string): void {
    fs.writeFileSync(this.paths.jobPath, content, "utf-8");
  }

  /** 读取 AGENTS.md（自我描述） */
  readAgents(): string {
    return this.readFile(this.paths.agentsPath);
  }

  /** 写入 AGENTS.md */
  writeAgents(content: string): void {
    fs.writeFileSync(this.paths.agentsPath, content, "utf-8");
  }

  /** 读取 MEMORY.md（索引） */
  readMemoryIndex(): string {
    return this.readFile(this.paths.memoryIndexPath);
  }

  /** 写入 MEMORY.md（索引） */
  writeMemoryIndex(content: string): void {
    fs.writeFileSync(this.paths.memoryIndexPath, content, "utf-8");
  }

  /** 读取 config.json */
  readConfig(): Record<string, unknown> {
    const raw = this.readFile(this.paths.configPath);
    if (!raw) return {};
    try { return JSON.parse(raw); } catch { return {}; }
  }

  /** 写入 config.json */
  writeConfig(config: Record<string, unknown>): void {
    fs.writeFileSync(this.paths.configPath, JSON.stringify(config, null, 2), "utf-8");
  }

  /** 确保 EXPERIENCE.md 存在（不存在则创建初始文件，与原 ExperienceWriter 构造副作用一致） */
  ensureExperienceFile(): void {
    if (!fs.existsSync(this.paths.experiencePath)) {
      fs.writeFileSync(this.paths.experiencePath, "# EXPERIENCE.md\n\n> Agent 在工程过程中积累的经验\n", "utf-8");
    }
  }

  /** 读取 EXPERIENCE.md */
  readExperience(): string {
    return this.readFile(this.paths.experiencePath);
  }

  /** 写入 EXPERIENCE.md */
  writeExperience(content: string): void {
    fs.writeFileSync(this.paths.experiencePath, content, "utf-8");
  }

  /** 追加内容到 MEMORY.md（经验索引） */
  appendMemoryIndex(entry: string): void {
    const existing = this.readMemoryIndex();
    if (!existing) {
      this.writeMemoryIndex(entry);
    } else {
      fs.appendFileSync(this.paths.memoryIndexPath, entry + "\n", "utf-8");
    }
  }

  /** 追加一条经验到 EXPERIENCE.md */
  appendExperience(entry: { task: string; problem: string; solution: string; date?: string }): void {
    const existing = this.readExperience();
    const date = entry.date ?? new Date().toISOString().split("T")[0];
    const block = [
      "",
      `## [${date}] ${entry.task.slice(0, 80)}`,
      `- **问题**: ${entry.problem}`,
      `- **解决**: ${entry.solution}`,
      "",
    ].join("\n");

    const summaryLine = `- [${date}] ${entry.task.slice(0, 100)}`;

    if (!existing) {
      const initial = `# EXPERIENCE.md\n\n> Agent 工作过程中积累的经验\n\n<!-- EXPERIENCE_SUMMARY_START -->\n## 经验概要\n${summaryLine}\n<!-- EXPERIENCE_SUMMARY_END -->\n\n## 详细经验\n${block}`;
      this.writeExperience(initial);
    } else {
      // 追加详细经验
      fs.appendFileSync(this.paths.experiencePath, block + "\n", "utf-8");
      // 重新读取完整文件以维护概要区
      const full = this.readExperience();
      const updated = maintainExperienceSummarySync(full, summaryLine);
      if (updated !== full) {
        this.writeExperience(updated);
      }
    }
  }

  /** 列出 memory 目录下的文件 */
  listMemoryFiles(): string[] {
    if (!fs.existsSync(this.paths.memoryDir)) return [];
    return fs.readdirSync(this.paths.memoryDir)
      .filter(f => f.endsWith(".md"))
      .sort();
  }

  /** 读取指定 memory 文件 */
  readMemoryFile(filename: string): string {
    return this.readFile(path.join(this.paths.memoryDir, filename));
  }

  // ===========================================
  // Agent Enhancement — Capability
  // ===========================================

  readCapability(): AgentCapabilityCard | null {
    const raw = this.readFile(this.paths.capabilityPath);
    if (!raw) return null;
    try { return JSON.parse(raw) as AgentCapabilityCard; } catch { return null; }
  }

  writeCapability(card: AgentCapabilityCard): void {
    fs.writeFileSync(this.paths.capabilityPath, JSON.stringify(card, null, 2), "utf-8");
  }

  // ===========================================
  // Agent Enhancement — Inbox
  // ===========================================

  readInbox(): AgentTaskInboxItem[] {
    const raw = this.readFile(this.paths.inboxPath);
    if (!raw) return [];
    try {
      const data = JSON.parse(raw);
      if (Array.isArray(data)) return data;
      return [...(data.active ?? []), ...(data.archived ?? [])];
    } catch { return []; }
  }

  writeInbox(items: AgentTaskInboxItem[]): void {
    const archived = items.filter(i =>
      ["completed", "cancelled"].includes(i.status) &&
      (Date.now() - new Date(i.updatedAt).getTime()) > 7 * 24 * 60 * 60 * 1000
    );
    const active = items.filter(i => !archived.includes(i));
    fs.writeFileSync(this.paths.inboxPath, JSON.stringify({ active, archived }, null, 2), "utf-8");
  }

  addInboxItem(item: AgentTaskInboxItem): void {
    const items = this.readInbox();
    items.push(item);
    this.writeInbox(items);
  }

  updateInboxItem(id: string, patch: Partial<AgentTaskInboxItem>): void {
    const items = this.readInbox();
    const idx = items.findIndex(i => i.id === id);
    if (idx >= 0) {
      items[idx] = { ...items[idx], ...patch, updatedAt: new Date().toISOString() };
      this.writeInbox(items);
    }
  }

  // ===========================================
  // Agent Enhancement — Reflection
  // ===========================================

  readReflections(): AgentReflectionRecord[] {
    const raw = this.readFile(this.paths.reflectionPath);
    if (!raw) return [];
    try { return JSON.parse(raw) as AgentReflectionRecord[]; } catch { return []; }
  }

  addReflection(record: AgentReflectionRecord): void {
    const records = this.readReflections();
    records.push(record);
    const trimmed = records.slice(-100);
    fs.writeFileSync(this.paths.reflectionPath, JSON.stringify(trimmed, null, 2), "utf-8");
  }

  // ===========================================
  // Agent Enhancement — Proposals
  // ===========================================

  listProposals(): AgentGrowthProposal[] {
    if (!fs.existsSync(this.paths.proposalsDir)) return [];
    const files = fs.readdirSync(this.paths.proposalsDir).filter(f => f.endsWith(".json"));
    return files.map(f => {
      try { return JSON.parse(fs.readFileSync(path.join(this.paths.proposalsDir, f), "utf-8")) as AgentGrowthProposal; }
      catch { return null; }
    }).filter(Boolean) as AgentGrowthProposal[];
  }

  readProposal(id: string): AgentGrowthProposal | null {
    const p = this.paths.proposalPath(id);
    if (!fs.existsSync(p)) return null;
    try { return JSON.parse(fs.readFileSync(p, "utf-8")) as AgentGrowthProposal; } catch { return null; }
  }

  writeProposal(proposal: AgentGrowthProposal): void {
    if (!fs.existsSync(this.paths.proposalsDir)) {
      fs.mkdirSync(this.paths.proposalsDir, { recursive: true });
    }
    fs.writeFileSync(this.paths.proposalPath(proposal.id), JSON.stringify(proposal, null, 2), "utf-8");
  }

  private readFile(filePath: string): string {
    try {
      return fs.readFileSync(filePath, "utf-8");
    } catch {
      return "";
    }
  }
}
