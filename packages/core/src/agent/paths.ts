/**
 * AgentPaths — 管理 Agent 独立目录下的所有文件路径
 */
import path from "node:path";
import fs from "node:fs";

export class AgentPaths {
  constructor(private baseDir: string) {}

  /** Agent 根目录路径 */
  get directory(): string { return this.baseDir; }

  get characterPath()  { return path.join(this.baseDir, "CHARACTER.md"); }
  get jobPath()        { return path.join(this.baseDir, "JOB.md"); }
  get soulPath()       { return path.join(this.baseDir, "SOUL.md"); }
  get agentsPath()     { return path.join(this.baseDir, "AGENTS.md"); }
  get experiencePath() { return path.join(this.baseDir, "EXPERIENCE.md"); }
  get memoryIndexPath(){ return path.join(this.baseDir, "MEMORY.md"); }
  get memoryDir()      { return path.join(this.baseDir, "memory"); }
  get workspaceDir()   { return path.join(this.baseDir, "workspace"); }
  get configPath()     { return path.join(this.baseDir, "config.json"); }
  get skillsDir()      { return path.join(this.baseDir, "skills"); }
  get userPath()       { return path.join(this.baseDir, "USER.md"); }
  get bootstrapPath()  { return path.join(this.baseDir, "BOOTSTRAP.md"); }
  get toolsPath()      { return path.join(this.baseDir, "TOOLS.md"); }
  get dbPath()        { return path.join(this.baseDir, "memory.db"); }

  static forAgent(agentId: string, dataRoot?: string): AgentPaths {
    // dataRoot is the DATA root (e.g. "data"), agents live under dataRoot/agents/
    const root = dataRoot
      ? path.join(dataRoot, "agents")
      : path.resolve("data", "agents");
    return new AgentPaths(path.join(root, agentId));
  }

  /** 确保目录结构存在 */
  ensureDirs(): void {
    fs.mkdirSync(this.baseDir, { recursive: true });
    fs.mkdirSync(this.memoryDir, { recursive: true });
    fs.mkdirSync(this.workspaceDir, { recursive: true });
    fs.mkdirSync(this.skillsDir, { recursive: true });
  }
}

export class AgentFiles {
  constructor(private paths: AgentPaths) {}

  /** 读取 CHARACTER.md */
  readCharacter(): string {
    return this.readFile(this.paths.characterPath);
  }

  /** 写入 CHARACTER.md */
  writeCharacter(content: string): void {
    fs.writeFileSync(this.paths.characterPath, content, "utf-8");
  }

  /** 读取 JOB.md */
  readJob(): string {
    return this.readFile(this.paths.jobPath);
  }

  /** 写入 JOB.md */
  writeJob(content: string): void {
    fs.writeFileSync(this.paths.jobPath, content, "utf-8");
  }

  /** 读取 SOUL.md */
  readSoul(): string {
    return this.readFile(this.paths.soulPath);
  }

  /** 写入 SOUL.md */
  writeSoul(content: string): void {
    fs.writeFileSync(this.paths.soulPath, content, "utf-8");
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

  /** 读取 EXPERIENCE.md */
  readExperience(): string {
    return this.readFile(this.paths.experiencePath);
  }

  /** 写入 EXPERIENCE.md */
  writeExperience(content: string): void {
    fs.writeFileSync(this.paths.experiencePath, content, "utf-8");
  }

  /** 读取 USER.md */
  readUser(): string {
    return this.readFile(this.paths.userPath);
  }

  /** 写入 USER.md */
  writeUser(content: string): void {
    fs.writeFileSync(this.paths.userPath, content, "utf-8");
  }

  /** 读取 BOOTSTRAP.md */
  readBootstrap(): string {
    return this.readFile(this.paths.bootstrapPath);
  }

  /** 写入 BOOTSTRAP.md */
  writeBootstrap(content: string): void {
    fs.writeFileSync(this.paths.bootstrapPath, content, "utf-8");
  }

  /** 读取并删除 BOOTSTRAP.md（一次性引导） — 已弃用，保留兼容 */
  consumeBootstrap(): string {
    const content = this.readFile(this.paths.bootstrapPath);
    // 不再删除 — BOOTSTRAP 在创建后和加入群组时都需要重新激发
    return content;
  }

  /** 读取 TOOLS.md */
  readTools(): string {
    return this.readFile(this.paths.toolsPath);
  }

  /** 写入 TOOLS.md */
  writeTools(content: string): void {
    fs.writeFileSync(this.paths.toolsPath, content, "utf-8");
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

    if (!existing) {
      this.writeExperience(`# EXPERIENCE.md\n\n> Agent 在工程过程中积累的经验${block}`);
    } else {
      fs.appendFileSync(this.paths.experiencePath, block + "\n", "utf-8");
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

  private readFile(filePath: string): string {
    try {
      return fs.readFileSync(filePath, "utf-8");
    } catch {
      return "";
    }
  }
}
