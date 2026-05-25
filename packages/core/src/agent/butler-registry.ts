/**
 * ButlerRegistry — 管家持久化注册表
 * 管理 data/butler/ 下的 AGENTS_REGISTRY.md、GROUPS_REGISTRY.md、TASK_LOG.md
 */
import fs from "node:fs";
import path from "node:path";
import { createLogger } from "@cobeing/shared";

const log = createLogger("butler-registry");

export interface AgentRegistryEntry {
  id: string;
  name: string;
  role: string;
  capabilities?: string;
  provider?: string;
  model?: string;
  systemPrompt?: string;
  createdAt?: string;
  groups?: string[];
  status?: string;
}

export interface GroupRegistryEntry {
  id: string;
  name: string;
  members: string[];
  topic?: string;
  createdAt?: string;
  status?: string;
  outcome?: string;
}

export interface TaskLogEntry {
  timestamp: string;
  task: string;
  action: string;
  result: string;
}

export class ButlerRegistry {
  private dataDir: string;

  constructor(dataRoot?: string) {
    this.dataDir = dataRoot
      ? path.join(dataRoot, "butler")
      : path.resolve("data", "butler");
    fs.mkdirSync(this.dataDir, { recursive: true });
  }

  // ---- Agent Registry ----

  /** 读取 Agent 注册表 */
  readAgentsRegistry(): string {
    return this.readFile(this.agentsRegistryPath);
  }

  /** 解析 Agent 注册表为结构化数据 */
  parseAgentsRegistry(): AgentRegistryEntry[] {
    const content = this.readAgentsRegistry();
    if (!content) return [];
    return this.parseAgentEntries(content);
  }

  /** 获取单个 Agent 信息 */
  getAgent(agentId: string): AgentRegistryEntry | undefined {
    return this.parseAgentsRegistry().find(a => a.id === agentId);
  }

  /** 注册/更新 Agent */
  registerAgent(entry: AgentRegistryEntry): void {
    const agents = this.parseAgentsRegistry();
    const existing = agents.findIndex(a => a.id === entry.id);

    const record = {
      id: entry.id,
      name: entry.name,
      role: entry.role,
      capabilities: entry.capabilities ?? "",
      provider: entry.provider ?? "",
      model: entry.model ?? "",
      systemPrompt: entry.systemPrompt ?? "",
      createdAt: entry.createdAt ?? new Date().toISOString().split("T")[0],
      groups: entry.groups ?? [],
      status: entry.status ?? "活跃",
    };

    if (existing >= 0) {
      agents[existing] = record;
    } else {
      agents.push(record);
    }

    this.writeAgentsRegistry(agents);
    log.info("Agent registered: %s", entry.id);
  }

  /** 移除 Agent */
  unregisterAgent(agentId: string): void {
    const agents = this.parseAgentsRegistry().filter(a => a.id !== agentId);
    this.writeAgentsRegistry(agents);
    log.info("Agent unregistered: %s", agentId);
  }

  // ---- Group Registry ----

  /** 读取 Group 注册表 */
  readGroupsRegistry(): string {
    return this.readFile(this.groupsRegistryPath);
  }

  /** 解析 Group 注册表 */
  parseGroupsRegistry(): GroupRegistryEntry[] {
    const content = this.readGroupsRegistry();
    if (!content) return [];
    return this.parseGroupEntries(content);
  }

  /** 注册/更新 Group */
  registerGroup(entry: GroupRegistryEntry): void {
    const groups = this.parseGroupsRegistry();
    const existing = groups.findIndex(g => g.id === entry.id);

    const record = {
      id: entry.id,
      name: entry.name,
      members: entry.members,
      topic: entry.topic ?? "",
      createdAt: entry.createdAt ?? new Date().toISOString().split("T")[0],
      status: entry.status ?? "活跃",
      outcome: entry.outcome ?? "",
    };

    if (existing >= 0) {
      groups[existing] = record;
    } else {
      groups.push(record);
    }

    this.writeGroupsRegistry(groups);
    log.info("Group registered: %s", entry.id);
  }

  /** 移除 Group */
  unregisterGroup(groupId: string): void {
    const groups = this.parseGroupsRegistry().filter(g => g.id !== groupId);
    this.writeGroupsRegistry(groups);
    log.info("Group unregistered: %s", groupId);
  }

  // ---- Task Log ----

  /** 追加任务日志 */
  appendTaskLog(entry: TaskLogEntry): void {
    const line = `- [${entry.timestamp}] ${entry.task} | ${entry.action} | ${entry.result}\n`;
    const filePath = this.taskLogPath;

    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, "# 任务执行日志\n\n", "utf-8");
    }
    fs.appendFileSync(filePath, line, "utf-8");
  }

  /** 读取任务日志 */
  readTaskLog(): string {
    return this.readFile(this.taskLogPath);
  }

  // ---- 路径 ----

  get agentsRegistryPath() { return path.join(this.dataDir, "AGENTS_REGISTRY.md"); }
  get groupsRegistryPath() { return path.join(this.dataDir, "GROUPS_REGISTRY.md"); }
  get taskLogPath() { return path.join(this.dataDir, "TASK_LOG.md"); }

  // ---- 内部方法 ----

  private readFile(filePath: string): string {
    try {
      return fs.readFileSync(filePath, "utf-8");
    } catch {
      return "";
    }
  }

  private writeAgentsRegistry(agents: AgentRegistryEntry[]): void {
    const lines = ["# Agent 注册表", ""];
    for (const a of agents) {
      lines.push(`## ${a.id}`);
      lines.push(`- 角色：${a.role}`);
      if (a.capabilities) lines.push(`- 能力：${a.capabilities}`);
      if (a.provider) lines.push(`- Provider：${a.provider}`);
      if (a.model) lines.push(`- 模型：${a.model}`);
      if (a.systemPrompt) lines.push(`- 系统提示词：${a.systemPrompt}`);
      lines.push(`- 创建时间：${a.createdAt}`);
      if (a.groups && a.groups.length > 0) lines.push(`- 所属群组：${a.groups.join(", ")}`);
      lines.push(`- 状态：${a.status}`);
      lines.push("");
    }
    fs.writeFileSync(this.agentsRegistryPath, lines.join("\n"), "utf-8");
  }

  private writeGroupsRegistry(groups: GroupRegistryEntry[]): void {
    const lines = ["# 群组注册表", ""];
    for (const g of groups) {
      lines.push(`## ${g.id}`);
      lines.push(`- 名称：${g.name}`);
      lines.push(`- 成员：${g.members.join(", ")}`);
      if (g.topic) lines.push(`- 主题：${g.topic}`);
      lines.push(`- 创建时间：${g.createdAt}`);
      lines.push(`- 状态：${g.status}`);
      if (g.outcome) lines.push(`- 成果：${g.outcome}`);
      lines.push("");
    }
    fs.writeFileSync(this.groupsRegistryPath, lines.join("\n"), "utf-8");
  }

  /** 解析 ## id 格式的 Agent 条目 */
  private parseAgentEntries(content: string): AgentRegistryEntry[] {
    const entries: AgentRegistryEntry[] = [];
    const sections = content.split(/^## /m).filter(s => s.trim());

    for (const section of sections) {
      const lines = section.split("\n");
      const id = lines[0].trim();
      if (!id || id.startsWith("#")) continue;

      const entry: AgentRegistryEntry = { id, name: id, role: "" };

      for (const line of lines.slice(1)) {
        const match = line.match(/^-\s+([^：]+)：(.+)$/);
        if (!match) continue;
        const [, label, value] = match;
        switch (label.trim()) {
          case "角色": entry.role = value.trim(); break;
          case "能力": entry.capabilities = value.trim(); break;
          case "Provider": entry.provider = value.trim(); break;
          case "模型": entry.model = value.trim(); break;
          case "系统提示词": entry.systemPrompt = value.trim(); break;
          case "创建时间": entry.createdAt = value.trim(); break;
          case "所属群组": entry.groups = value.trim().split(", ").filter(Boolean); break;
          case "状态": entry.status = value.trim(); break;
        }
      }

      entries.push(entry);
    }

    return entries;
  }

  /** 解析 Group 条目 */
  private parseGroupEntries(content: string): GroupRegistryEntry[] {
    const entries: GroupRegistryEntry[] = [];
    const sections = content.split(/^## /m).filter(s => s.trim());

    for (const section of sections) {
      const lines = section.split("\n");
      const id = lines[0].trim();
      if (!id || id.startsWith("#")) continue;

      const entry: GroupRegistryEntry = { id, name: id, members: [] };

      for (const line of lines.slice(1)) {
        const match = line.match(/^-\s+([^：]+)：(.+)$/);
        if (!match) continue;
        const [, label, value] = match;
        switch (label.trim()) {
          case "名称": entry.name = value.trim(); break;
          case "成员": entry.members = value.trim().split(", ").filter(Boolean); break;
          case "主题": entry.topic = value.trim(); break;
          case "创建时间": entry.createdAt = value.trim(); break;
          case "状态": entry.status = value.trim(); break;
          case "成果": entry.outcome = value.trim(); break;
        }
      }

      entries.push(entry);
    }

    return entries;
  }
}
