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
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
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
    };
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

    logger.info(`[Group:${this.groupId}] Workspace initialized at ${this.paths.root}`);
  }

  /**
   * 写入 MEMBERS.md
   */
  writeMembers(members: string[], ownerName: string): void {
    const content = `# ${this.groupName} - 成员列表

> 群组 ID: ${this.groupId}
> 创建时间: ${new Date().toISOString()}

## 群主 (Owner)

- **${ownerName}** (负责整体协调和任务分配)

## 成员 (Members)

${members.map((name, i) => `${i + 1}. **${name}**`).join("\n")}

## 成员职责

- **群主**: 任务分解、进度跟踪、协调沟通
- **成员**: 按照计划完成各自任务，及时汇报进度

## 更新日志

- ${new Date().toISOString()} - 初始化成员列表
`;

    writeFileSync(this.paths.members, content, "utf-8");
  }

  /**
   * 写入 STRUCTURE.md
   */
  writeStructure(structure: string = ""): void {
    const content = `# ${this.groupName} - 项目结构

> 本文档记录项目的文件/目录结构

## 目录结构

${structure || "```\n# 待添加项目结构\n```"}

## 说明

- 在群主指导下添加项目的目录结构
- 标注关键文件和目录的用途
- 保持更新，确保所有成员都能快速定位

## 更新日志

- ${new Date().toISOString()} - 初始化结构文档
`;

    writeFileSync(this.paths.structure, content, "utf-8");
  }

  /**
   * 写入 TASK.md
   */
  writeTask(task: string): void {
    const content = `# ${this.groupName} - 任务描述

> 本文档记录群组的任务目标和要求

## 任务目标

${task || "待添加任务描述..."}

## 验收标准

- [ ] 待添加验收标准

## 依赖关系

- 前置依赖: 无
- 后续依赖: 无

## 更新日志

- ${new Date().toISOString()} - 初始化任务文档
`;

    writeFileSync(this.paths.task, content, "utf-8");
  }

  /**
   * 写入 PROGRESS.md
   */
  writeProgress(_progress: string): void {
    const content = `# ${this.groupName} - 当前进度

> 本文档记录项目进展和完成情况

## 整体进度

- **当前阶段**: 初始化
- **完成度**: 0%
- **最后更新**: ${new Date().toISOString()}

## 各成员进度

### 群主
- [ ] 初始化项目
- [ ] 分配任务

### 成员
- [ ] 待分配

## 重要里程碑

- [ ] 项目启动
- [ ] 第一个版本完成
- [ ] 测试通过
- [ ] 发布上线

## 阻塞问题

- 无

## 更新日志

- ${new Date().toISOString()} - 初始化进度文档
`;

    writeFileSync(this.paths.progress, content, "utf-8");
  }

  /**
   * 写入 PLAN.md
   */
  writePlan(plan: string): void {
    const content = `# ${this.groupName} - 任务分工和计划

> 本文档记录任务分工、时间计划和执行策略

## 任务分解

${plan || "### 待添加任务分解..."}

## 时间计划

| 阶段 | 任务 | 负责人 | 预计时间 | 状态 |
|------|------|--------|----------|------|
| 初始化 | 项目启动 | 群主 | 1天 | 待开始 |

## 执行策略

1. **沟通机制**: 每日同步，及时汇报问题
2. **协作方式**: 群主协调，成员执行
3. **质量控制**: 代码审查，测试验证

## 风险预案

- **人员变动**: 提前记录项目知识，减少依赖
- **技术难题**: 群主组织讨论，共同解决
- **进度延迟**: 及时调整计划，优先保证核心功能

## 更新日志

- ${new Date().toISOString()} - 初始化计划文档
`;

    writeFileSync(this.paths.plan, content, "utf-8");
  }

  /**
   * 写入 EXPERIENCE.md（群组级协作经验）
   */
  writeExperience(): void {
    const content = `# ${this.groupName} - 群组协作经验

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

- ${new Date().toISOString()} - 初始化协作经验文档
`;
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
  } {
    return {
      members: this.readMembers(),
      task: this.readTask(),
      progress: this.readProgress(),
      plan: this.readPlan(),
      structure: this.readStructure(),
      experience: this.readExperience(),
    };
  }
}
