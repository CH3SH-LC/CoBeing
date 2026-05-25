/**
 * OpenClaw 风格的 Skill 系统
 *
 * 特性：
 * - SKILL.md 格式（YAML frontmatter + Markdown）
 * - 多目录加载（bundled, managed, workspace, personal）
 * - 技能门控（bins, env, config, os）
 * - 配置覆盖（skills.entries.*）
 * - 技能优先级（workspace > personal > managed > bundled）
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { createLogger } from "@cobeing/shared";

const logger = createLogger("skills:openclaw");

/**
 * SKILL.md Frontmatter
 */
export interface SkillFrontmatter {
  name: string;
  description: string;
  homepage?: string;
  userInvocable?: boolean;
  disableModelInvocation?: boolean;
  commandDispatch?: "tool";
  commandTool?: string;
  commandArgMode?: "raw";
  metadata?: {
    openclaw?: {
      emoji?: string;
      always?: boolean;
      os?: Array<"darwin" | "linux" | "win32">;
      requires?: {
        bins?: string[];
        anyBins?: string[];
        env?: string[];
        config?: string[];
      };
      primaryEnv?: string;
      install?: Array<{
        id: string;
        kind: "brew" | "node" | "go" | "uv" | "download";
        formula?: string;
        package?: string;
        bins?: string[];
        label?: string;
        url?: string;
        archive?: "tar.gz" | "tar.bz2" | "zip";
        extract?: boolean;
        stripComponents?: number;
        targetDir?: string;
        os?: Array<"darwin" | "linux" | "win32">;
      }>;
    };
  };
}

/**
 * 完整的 Skill 定义
 */
export interface OpenClawSkill {
  frontmatter: SkillFrontmatter;
  content: string;
  location: string;
  key: string;
  priority: number;
}

/**
 * 技能加载选项
 */
export interface SkillLoadOptions {
  extraDirs?: string[];
  dataDir?: string;
  agentId?: string;
}

/**
 * 技能配置覆盖
 */
export interface SkillEntryConfig {
  enabled?: boolean;
  apiKey?: string | { source: "env"; provider: string; id: string };
  env?: Record<string, string>;
  config?: Record<string, unknown>;
}

export class OpenClawSkillLoader {
  private options: SkillLoadOptions;
  private skills: Map<string, OpenClawSkill> = new Map();
  private platform: NodeJS.Platform;

  constructor(options: SkillLoadOptions = {}) {
    this.options = {
      dataDir: options.dataDir || "data",
      ...options,
    };
    this.platform = process.platform;
  }

  /**
   * 加载所有技能
   */
  async loadAll(): Promise<void> {
    const locations = this.getSkillLocations();

    // 按优先级从低到高加载（后面的覆盖前面的）
    for (const location of locations) {
      await this.loadFromDirectory(location.root, location.priority);
    }

    logger.info("Loaded %d skills from %d locations", this.skills.size, locations.length);
  }

  /**
   * 获取技能加载位置
   */
  private getSkillLocations(): Array<{ root: string; priority: number }> {
    const { dataDir, agentId } = this.options;
    const locations: Array<{ root: string; priority: number }> = [];

    // 1. Bundled skills (最低优先级)
    locations.push({ root: join(this.options.dataDir || ".", "skills"), priority: 1 });

    // 2. Managed skills
    locations.push({ root: join(dataDir || "data", "skills"), priority: 2 });

    // 3. Personal skills
    locations.push({ root: join(this.getHomeDir(), ".agents", "skills"), priority: 3 });

    // 4. Agent-specific skills
    if (agentId) {
      locations.push({ root: join(dataDir || "data", "agents", agentId, "skills"), priority: 4 });
      locations.push({ root: join(dataDir || "data", "agents", agentId, ".agents", "skills"), priority: 5 });
    }

    // 5. Extra dirs (最低优先级，放在 bundled 之前)
    if (this.options.extraDirs) {
      for (const dir of this.options.extraDirs) {
        locations.unshift({ root: dir, priority: 0 });
      }
    }

    return locations.filter(loc => existsSync(loc.root));
  }

  /**
   * 从目录加载技能
   */
  private async loadFromDirectory(root: string, priority: number): Promise<void> {
    if (!existsSync(root)) return;

    const entries = readdirSync(root, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillPath = join(root, entry.name);
      const skillFile = join(skillPath, "SKILL.md");

      if (existsSync(skillFile)) {
        try {
          const skill = this.parseSkillFile(skillFile, entry.name, priority);
          if (this.checkSkillGating(skill)) {
            // 同名的 skill，高优先级覆盖低优先级
            this.skills.set(skill.key, skill);
            logger.debug("Loaded skill: %s from %s (priority %d)", skill.key, skill.location, priority);
          } else {
            logger.debug("Skipped gated skill: %s", skill.key);
          }
        } catch (error: any) {
          logger.error("Failed to load skill from %s: %s", skillPath, error.message);
        }
      }
    }
  }

  /**
   * 解析 SKILL.md 文件
   */
  private parseSkillFile(filePath: string, dirName: string, priority: number): OpenClawSkill {
    const content = readFileSync(filePath, "utf-8");
    const frontmatter = this.extractFrontmatter(content);
    const key = frontmatter.name || dirName;

    return {
      frontmatter,
      content,
      location: dirname(filePath),
      key,
      priority,
    };
  }

  /**
   * 提取 YAML frontmatter
   */
  private extractFrontmatter(content: string): SkillFrontmatter {
    const match = content.match(/^---\n([\s\S]+?)\n---/);
    if (!match) {
      throw new Error("No frontmatter found");
    }

    const yaml = match[1];
    const frontmatter: SkillFrontmatter = this.parseYaml(yaml);

    return frontmatter;
  }

  /**
   * 简单的 YAML 解析器
   * 注意：生产环境应该使用 yaml 库，这里简化处理
   */
  private parseYaml(_yaml: string): any {
    const lines = _yaml.split("\n");
    const result: any = {};

    for (const line of lines) {
      const match = line.match(/^(\w+):\s*(.+)$/);
      if (match) {
        const [, key, value] = match;
        result[key] = this.parseYamlValue(value);
      }
    }

    return result;
  }

  /**
   * 解析 YAML 值
   */
  private parseYamlValue(value: string): string | boolean | object {
    value = value.trim();

    // Boolean
    if (value === "true") return true;
    if (value === "false") return false;

    // String
    if (value.startsWith('"') && value.endsWith('"')) {
      return value.slice(1, -1);
    }

    // Object (简化处理，实际需要完整 YAML 解析)
    if (value.startsWith("{")) {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }

    return value;
  }

  /**
   * 检查技能门控
   */
  private checkSkillGating(skill: OpenClawSkill): boolean {
    const { always, os, requires } = skill.frontmatter.metadata?.openclaw || {};

    // always: true 跳过所有门控
    if (always) return true;

    // OS 检查
    if (os && os.length > 0 && !os.includes(this.platform as any)) {
      logger.debug("Skill %s: OS gate failed (requires %v, have %s)", skill.key, os, this.platform);
      return false;
    }

    // Bins 检查
    if (requires?.bins && requires.bins.length > 0) {
      for (const bin of requires.bins) {
        if (!this.hasBinary(bin)) {
          logger.debug("Skill %s: bin gate failed (missing %s)", skill.key, bin);
          return false;
        }
      }
    }

    // Env 检查
    if (requires?.env && requires.env.length > 0) {
      for (const envVar of requires.env) {
        if (!process.env[envVar]) {
          logger.debug("Skill %s: env gate failed (missing %s)", skill.key, envVar);
          return false;
        }
      }
    }

    return true;
  }

  /**
   * 检查二进制是否存在
   */
  private hasBinary(_name: string): boolean {
    // 简化实现，实际应该使用 which/where
    return false;
  }

  /**
   * 获取主目录
   */
  private getHomeDir(): string {
    return process.env.HOME || process.env.USERPROFILE || "";
  }

  /**
   * 获取所有技能
   */
  getAllSkills(): OpenClawSkill[] {
    return Array.from(this.skills.values()).sort((a, b) => b.priority - a.priority);
  }

  /**
   * 获取技能
   */
  getSkill(key: string): OpenClawSkill | undefined {
    return this.skills.get(key);
  }

  /**
   * 应用配置覆盖
   */
  applyConfig(config: Record<string, SkillEntryConfig>): void {
    for (const [key, entry] of Object.entries(config)) {
      const skill = this.skills.get(key);
      if (!skill) continue;

      // enabled: false 禁用技能
      if (entry.enabled === false) {
        this.skills.delete(key);
        logger.debug("Disabled skill: %s", key);
        continue;
      }

      // 注入环境变量
      if (entry.env) {
        Object.assign(process.env, entry.env);
      }

      // apiKey 注入
      if (entry.apiKey) {
        const envVar = skill.frontmatter.metadata?.openclaw?.primaryEnv;
        if (envVar) {
          if (typeof entry.apiKey === "string") {
            process.env[envVar] = entry.apiKey;
          } else {
            // 从 SecretRef 读取（简化处理）
            process.env[envVar] = "API_KEY_FROM_SECRET";
          }
        }
      }

      logger.debug("Applied config to skill: %s", key);
    }
  }

  /**
   * 构建技能提示词（用于 LLM）
   */
  buildSkillsPrompt(skills?: string[]): string {
    const targetSkills = skills
      ? skills.map(key => this.skills.get(key)).filter((s): s is OpenClawSkill => s !== undefined)
      : this.getAllSkills();

    if (targetSkills.length === 0) return "";

    const lines: string[] = ["## Available Skills\n"];

    for (const skill of targetSkills) {
      const emoji = skill.frontmatter.metadata?.openclaw?.emoji || "🔧";
      lines.push(`### ${emoji} ${skill.frontmatter.name}`);
      lines.push(`${skill.frontmatter.description}`);
      lines.push(`Location: ${skill.location}`);
      lines.push("");
    }

    return lines.join("\n");
  }

  /**
   * 获取技能统计
   */
  getStats(): {
    total: number;
    byPriority: Record<number, number>;
    gated: number;
  } {
    const skills = this.getAllSkills();
    const byPriority: Record<number, number> = {};

    for (const skill of skills) {
      byPriority[skill.priority] = (byPriority[skill.priority] || 0) + 1;
    }

    return {
      total: skills.length,
      byPriority,
      gated: 0, // TODO: 统计被门控过滤的技能数
    };
  }
}
