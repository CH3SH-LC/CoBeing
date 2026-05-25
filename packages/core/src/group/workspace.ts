/**
 * Group Workspace — 每个 Group 的独立工作空间
 *
 * 包含：
 * - MEMBERS.md: 成员列表和职责
 * - STRUCTURE.md: 项目结构
 * - TASK.md: 任务描述
 * - PROGRESS.md: 当前进度
 * - PLAN.md: 任务分工和计划
 */
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createLogger } from "@cobeing/shared";

const logger = createLogger("group:workspace");

export interface GroupWorkspacePaths {
  root: string;
  members: string;
  structure: string;
  task: string;
  progress: string;
  plan: string;
  conversations: string;
  experience: string;
  interface: string;
  guide: string;
}

export class GroupWorkspace {
  readonly paths: GroupWorkspacePaths;
  readonly groupId: string;
  readonly groupName: string;

  constructor(groupId: string, groupName: string, dataRoot: string = "data") {
    this.groupId = groupId;
    this.groupName = groupName;

    const workspaceRoot = join(dataRoot, "groups", groupId);
    this.paths = {
      root: workspaceRoot,
      members: join(workspaceRoot, "MEMBERS.md"),
      structure: join(workspaceRoot, "STRUCTURE.md"),
      task: join(workspaceRoot, "TASK.md"),
      progress: join(workspaceRoot, "PROGRESS.md"),
      plan: join(workspaceRoot, "PLAN.md"),
      conversations: join(workspaceRoot, "conversations"),
      experience: join(workspaceRoot, "EXPERIENCE.md"),
      interface: join(workspaceRoot, "INTERFACE.md"),
      guide: join(workspaceRoot, "GUIDE.md"),
    };
  }

  private static readonly GROUPS_TEMPLATES_DIR = join("config", "templates", "groups");

  private static resolveTemplate(templateName: string, vars: Record<string, string>): string {
    const src = join(GroupWorkspace.GROUPS_TEMPLATES_DIR, templateName);
    if (!existsSync(src)) return "";
    let content = readFileSync(src, "utf-8");
    for (const [key, value] of Object.entries(vars)) {
      content = content.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
    }
    return content;
  }

  /**
   * 初始化工作空间
   * 只在文件不存在时创建，避免覆盖已有内容
   */
  initialize(members: string[], ownerName: string): void {
    // 创建目录
    mkdirSync(this.paths.root, { recursive: true });
    mkdirSync(this.paths.conversations, { recursive: true });

    // 只在文件不存在时写入初始文档
    if (!existsSync(this.paths.members)) this.writeMembers(members, ownerName);
    if (!existsSync(this.paths.structure)) this.writeStructure();
    if (!existsSync(this.paths.task)) this.writeTask("");
    if (!existsSync(this.paths.progress)) this.writeProgress("");
    if (!existsSync(this.paths.plan)) this.writePlan("");
    if (!existsSync(this.paths.experience)) this.writeExperience();
    if (!existsSync(this.paths.interface)) this.writeInterface('', members);
    if (!existsSync(this.paths.guide)) this.writeGuide();

    logger.info(`[Group:${this.groupId}] Workspace initialized at ${this.paths.root}`);
  }

  /**
   * 写入 MEMBERS.md
   */
  writeMembers(members: string[], ownerName: string): void {
    const now = new Date().toISOString();
    const vars: Record<string, string> = {
      groupName: this.groupName,
      groupId: this.groupId,
      datetime: now,
      ownerName,
      memberList: members.map((name, i) => `${i + 1}. **${name}**`).join("\n"),
    };
    let content = GroupWorkspace.resolveTemplate("MEMBERS.md", vars);
    if (!content) {
      content = `# ${this.groupName} - 成员列表

> 群组 ID: ${this.groupId}
> 创建时间: ${now}

## 群主 (Owner)

- **${ownerName}** (负责整体协调和任务分配)

## 成员 (Members)

${vars.memberList}

## 成员职责

- **群主**: 任务分解、进度跟踪、协调沟通
- **成员**: 按照计划完成各自任务，及时汇报进度

## 更新日志

- ${now} - 初始化成员列表
`;
    }
    writeFileSync(this.paths.members, content, "utf-8");
  }

  /**
   * 写入 STRUCTURE.md
   */
  writeStructure(structure: string = ""): void {
    const vars: Record<string, string> = {
      groupName: this.groupName,
      datetime: new Date().toISOString(),
      structureContent: structure || "```\n# 待添加项目结构\n```",
    };
    let content = GroupWorkspace.resolveTemplate("STRUCTURE.md", vars);
    if (!content) {
      content = `# ${this.groupName} - 项目结构

> 本文档记录项目的文件/目录结构

## 目录结构

${vars.structureContent}

## 说明

- 在群主指导下添加项目的目录结构
- 标注关键文件和目录的用途
- 保持更新，确保所有成员都能快速定位

## 更新日志

- ${vars.datetime} - 初始化结构文档
`;
    }
    writeFileSync(this.paths.structure, content, "utf-8");
  }

  /**
   * 写入 TASK.md
   */
  writeTask(task: string): void {
    const vars: Record<string, string> = {
      groupName: this.groupName,
      datetime: new Date().toISOString(),
      taskContent: task || "待添加任务描述...",
    };
    let content = GroupWorkspace.resolveTemplate("TASK.md", vars);
    if (!content) {
      content = `# ${this.groupName} - 任务描述

> 本文档记录群组的任务目标和要求

## 任务目标

${vars.taskContent}

## 验收标准

- [ ] 待添加验收标准

## 依赖关系

- 前置依赖: 无
- 后续依赖: 无

## 更新日志

- ${vars.datetime} - 初始化任务文档
`;
    }
    writeFileSync(this.paths.task, content, "utf-8");
  }

  /**
   * 写入 PROGRESS.md
   */
  writeProgress(_progress: string): void {
    const now = new Date().toISOString();
    const vars: Record<string, string> = {
      groupName: this.groupName,
      date: now.slice(0, 10),
      time: now.slice(11, 16),
    };
    let content = GroupWorkspace.resolveTemplate("PROGRESS.md", vars);
    if (!content) {
      content = `# ${this.groupName} - 工作日志

> 记录谁在什么时候做了什么、产出了什么。追踪总进度见 PLAN.md。

## ${vars.date}

### ${vars.time}
- 初始化工作日志

`;
    }
    writeFileSync(this.paths.progress, content, "utf-8");
  }

  /**
   * 追加 PROGRESS 日志条目
   */
  appendProgressEntry(agentName: string, entry: string): void {
    const now = new Date();
    const dateKey = now.toISOString().slice(0, 10);
    const timeKey = now.toISOString().slice(11, 16);

    let content = this.readProgress();
    if (!content) { this.writeProgress(''); content = this.readProgress()!; }

    const dateHeader = `## ${dateKey}`;
    if (!content.includes(dateHeader)) {
      content = content.trimEnd() + `\n\n${dateHeader}\n`;
    }

    const dateIdx = content.indexOf(dateHeader);
    const afterDate = content.slice(dateIdx + dateHeader.length);

    const timeHeader = `### ${timeKey}`;
    if (afterDate.includes(timeHeader)) {
      const tIdx = afterDate.indexOf(timeHeader);
      const lineBreak = afterDate.indexOf('\n', tIdx);
      const insertPoint = dateIdx + dateHeader.length + (lineBreak >= 0 ? lineBreak : afterDate.length) + 1;
      content = content.slice(0, insertPoint) +
        `- @${agentName}: ${entry}\n` +
        content.slice(insertPoint);
    } else {
      content = content.slice(0, dateIdx + dateHeader.length) +
        `\n\n${timeHeader}\n- @${agentName}: ${entry}` +
        afterDate;
    }

    writeFileSync(this.paths.progress, content, 'utf-8');
  }

  /**
   * 写入 PLAN.md
   */
  writePlan(plan: string): void {
    const vars: Record<string, string> = {
      groupName: this.groupName,
      datetime: new Date().toISOString(),
      planContent: plan || "（Host 调查后填写依赖关系）",
    };
    let content = GroupWorkspace.resolveTemplate("PLAN.md", vars);
    if (!content) {
      content = `# ${this.groupName} - 执行计划

## 模块依赖

> 各模块间的接口依赖关系（详见 INTERFACE.md）

${plan || "（Host 调查后填写依赖关系）"}

## 阶段计划

${plan ? '' : "（Host 调查后填充阶段计划。每个阶段含具体任务和 @负责人，阶段最后两个任务固定：检查接口依赖 + 用户审核）"}

## 执行策略

1. **并行原则**: 同阶段无依赖的任务可同时 @mention 唤醒多个 Agent
2. **接口优先**: 先定义接口 → 再各自实现 → 最后联调检查
3. **动态调整**: 根据实际进展随时更新本计划，阶段数量可增减

## 风险预案

- **接口不匹配**: 及时同步 INTERFACE.md，Host 协调
- **人员阻塞**: 依赖项未就位时，先做其他可并行的工作

## 更新日志

- ${vars.datetime} - 初始化计划文档
`;
    }
    writeFileSync(this.paths.plan, content, "utf-8");
  }

  /**
   * 写入 EXPERIENCE.md（群组级协作经验）
   */
  writeExperience(): void {
    const vars: Record<string, string> = {
      groupName: this.groupName,
      datetime: new Date().toISOString(),
    };
    let content = GroupWorkspace.resolveTemplate("EXPERIENCE.md", vars);
    if (!content) {
      content = `# ${this.groupName} - 群组协作经验

> 本文档记录协作过程中的关键决策和教训

## 关键决策

_记录协作中的重要决策和理由_

- （暂无）

## 协作教训

_记录协作中发现的问题和改进_

- （暂无）

## 有效模式

_记录哪些协作方式效果好_

- （暂无）

## 更新日志

- ${vars.datetime} - 初始化协作经验文档
`;
    }
    writeFileSync(this.paths.experience, content, "utf-8");
  }

  /**
   * 读取 EXPERIENCE.md
   */
  readExperience(): string | null {
    if (!existsSync(this.paths.experience)) return null;
    return readFileSync(this.paths.experience, "utf-8");
  }

  /**
   * 读取 GUIDE.md — 群组规则
   * 优先群组 workspace，回退 data/ 根目录
   */
  readGuide(): string | null {
    if (existsSync(this.paths.guide)) {
      return readFileSync(this.paths.guide, "utf-8");
    }
    const globalGuide = join("data", "GUIDE.md");
    if (existsSync(globalGuide)) {
      return readFileSync(globalGuide, "utf-8");
    }
    return null;
  }

  /**
   * 写入 GUIDE.md（从模板初始化）
   */
  writeGuide(): void {
    const vars: Record<string, string> = {
      groupName: this.groupName,
    };
    let content = GroupWorkspace.resolveTemplate("GUIDE.md", vars);
    if (!content) {
      content = `# ${this.groupName} 群组规则\n\n## 协作约定\n\n## 工作流约束\n\n## 沟通规范\n`;
    }
    writeFileSync(this.paths.guide, content, "utf-8");
  }

  /**
   * 写入 INTERFACE.md
   */
  writeInterface(content: string = '', memberNames?: string[]): void {
    if (content) {
      writeFileSync(this.paths.interface, content, "utf-8");
      return;
    }
    const vars: Record<string, string> = {
      memberSections: memberNames?.length ? memberNames.map(n => `## ${n}\n`).join('\n') : '',
    };
    const resolved = GroupWorkspace.resolveTemplate("INTERFACE.md", vars);
    if (resolved) {
      writeFileSync(this.paths.interface, resolved, "utf-8");
      return;
    }
    const fallback = '# 群组接口\n\n' + (memberNames?.length ? memberNames.map(n => `## ${n}\n`).join('\n') : '');
    writeFileSync(this.paths.interface, fallback, "utf-8");
  }

  /**
   * 读取 INTERFACE.md
   */
  readInterface(): string | null {
    if (!existsSync(this.paths.interface)) return null;
    return readFileSync(this.paths.interface, "utf-8");
  }

  /**
   * 追加 INTERFACE.md 章节（幂等）
   */
  appendInterfaceSection(agentName: string): void {
    const current = this.readInterface() || '# 群组接口\n';
    if (current.includes(`## ${agentName}`)) return;
    appendFileSync(this.paths.interface, `\n## ${agentName}\n`, "utf-8");
  }

  /**
   * 读取 EXPERIENCE.md 摘要（最近的内容，截取前 500 字）
   */
  readExperienceSummary(): string | null {
    const full = this.readExperience();
    if (!full) return null;
    const lines = full.split("\n");
    const contentLines = lines.filter(l => l.startsWith("- ") || l.startsWith("### "));
    if (contentLines.length === 0) return null;
    const summary = contentLines.join("\n");
    return summary.length > 500 ? summary.slice(0, 500) + "..." : summary;
  }

  /**
   * 追加经验条目
   */
  appendExperience(section: "关键决策" | "协作教训" | "有效模式", entry: string): void {
    let content = this.readExperience() || "";
    const sectionHeader = `## ${section}`;
    const idx = content.indexOf(sectionHeader);
    if (idx >= 0) {
      const afterHeader = idx + sectionHeader.length;
      const nextSection = content.indexOf("\n## ", afterHeader);
      const insertPoint = nextSection >= 0 ? nextSection : content.length;
      const timestamp = new Date().toISOString().slice(0, 10);
      const line = `\n- [${timestamp}] ${entry}`;
      content = content.slice(0, insertPoint) + line + content.slice(insertPoint);
    }
    writeFileSync(this.paths.experience, content, "utf-8");
  }

  /**
   * 读取成员列表
   */
  readMembers(): string | null {
    if (!existsSync(this.paths.members)) return null;
    return readFileSync(this.paths.members, "utf-8");
  }

  /**
   * 读取任务描述
   */
  readTask(): string | null {
    if (!existsSync(this.paths.task)) return null;
    return readFileSync(this.paths.task, "utf-8");
  }

  /**
   * 读取进度
   */
  readProgress(): string | null {
    if (!existsSync(this.paths.progress)) return null;
    return readFileSync(this.paths.progress, "utf-8");
  }

  /**
   * 读取计划
   */
  readPlan(): string | null {
    if (!existsSync(this.paths.plan)) return null;
    return readFileSync(this.paths.plan, "utf-8");
  }

  /**
   * 读取结构
   */
  readStructure(): string | null {
    if (!existsSync(this.paths.structure)) return null;
    return readFileSync(this.paths.structure, "utf-8");
  }

  /**
   * 追加进度记录
   */
  appendProgress(memberName: string, update: string): void {
    let content = this.readProgress() || "";
    const timestamp = new Date().toISOString();
    const entry = `\n### ${memberName} - ${timestamp}\n\n${update}\n`;
    content += entry;
    writeFileSync(this.paths.progress, content, "utf-8");
  }

  /**
   * 更新任务
   */
  updateTask(newTask: string): void {
    this.writeTask(newTask);
  }

  /**
   * 更新计划
   */
  updatePlan(newPlan: string): void {
    this.writePlan(newPlan);
  }

  /** 泛型写文件（限 structure / plan / task / interface） */
  writeFile(name: string, content: string): void {
    const paths: Record<string, string> = {
      structure: this.paths.structure,
      plan: this.paths.plan,
      task: this.paths.task,
      interface: this.paths.interface,
    };
    const filePath = paths[name];
    if (!filePath) throw new Error(`Unknown workspace file: ${name}`);
    writeFileSync(filePath, content, "utf-8");
    logger.info(`[Group:${this.groupId}] Wrote ${name}`);
  }

  /** 泛型读文件（限 structure / plan / task / interface） */
  readFile(name: string): string | null {
    const paths: Record<string, string> = {
      structure: this.paths.structure,
      plan: this.paths.plan,
      task: this.paths.task,
      interface: this.paths.interface,
    };
    const filePath = paths[name];
    if (!filePath || !existsSync(filePath)) return null;
    return readFileSync(filePath, "utf-8");
  }

  /**
   * 获取工作空间摘要
   */
  getSummary(): {
    members: string | null;
    task: string | null;
    progress: string | null;
    plan: string | null;
    structure: string | null;
    experience: string | null;
    interface: string | null;
  } {
    return {
      members: this.readMembers(),
      task: this.readTask(),
      progress: this.readProgress(),
      plan: this.readPlan(),
      structure: this.readStructure(),
      experience: this.readExperience(),
      interface: this.readInterface(),
    };
  }
}
