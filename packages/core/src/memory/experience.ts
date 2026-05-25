/**
 * ExperienceWriter — Agent 自主经验系统
 * 在工程过程中总结问题及解决方法，固化到 EXPERIENCE.md
 */
import fs from "node:fs";
import path from "node:path";
import type { LLMProvider } from "@cobeing/providers";
import { createLogger } from "@cobeing/shared";

const log = createLogger("experience-writer");

export interface ExperienceEntry {
  task: string;
  problem: string;
  solution: string;
  date?: string;
}

export class ExperienceWriter {
  private filePath: string;

  constructor(
    filePath: string,
    private provider?: LLMProvider,
  ) {
    this.filePath = filePath;
    this.ensureFile();
  }

  private ensureFile(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, "# EXPERIENCE.md\n\n> Agent 在工程过程中积累的经验\n", "utf-8");
    }
  }

  /** 手动追加一条经验 */
  append(entry: ExperienceEntry): void {
    const date = entry.date ?? new Date().toISOString().split("T")[0];
    const block = [
      "",
      `## [${date}] ${entry.task.slice(0, 80)}`,
      `- **问题**: ${entry.problem}`,
      `- **解决**: ${entry.solution}`,
      "",
    ].join("\n");

    fs.appendFileSync(this.filePath, block + "\n", "utf-8");
    log.info("Experience appended: %s", entry.task.slice(0, 40));
  }

  /** 通过 LLM 反思对话，自动提取经验（Phase 8.4: 完整对话历史 + 质量过滤） */
  async reflect(task: string, conversation: Array<{ role: string; content: string }>): Promise<void> {
    if (!this.provider) {
      log.warn("No provider for reflection");
      return;
    }

    const convText = conversation
      .map(m => `[${m.role}]: ${m.content}`)
      .join("\n");

    // 从文件读取 prompt 模板，回退到默认
    let promptTemplate = this.loadPromptTemplate();
    const prompt = promptTemplate
      .replace("{{task}}", task)
      .replace("{{conversation}}", convText);

    try {
      let result = "";
      for await (const chunk of this.provider.chat({
        model: "",
        messages: [{ role: "user", content: prompt }],
      })) {
        if (chunk.type === "content" && chunk.content) {
          result += chunk.content;
        }
      }

      const problemMatch = result.match(/问题[：:]\s*(.+)/);
      const solutionMatch = result.match(/解决[：:]\s*(.+)/);

      if (!problemMatch || !solutionMatch) {
        log.warn("Reflection output format unexpected: %s", result.slice(0, 100));
        return;
      }

      const problem = problemMatch[1].trim();
      const solution = solutionMatch[1].trim();

      // 质量过滤：跳过无意义或过短的条目
      if (problem === "无" || solution === "无") {
        log.debug("Reflection skipped: no meaningful experience");
        return;
      }
      if (problem.length < 10 || solution.length < 10) {
        log.debug("Reflection skipped: too short (problem=%d, solution=%d)", problem.length, solution.length);
        return;
      }

      this.append({ task, problem, solution });
    } catch (err) {
      log.warn("Reflection failed: %s", err);
    }
  }

  /** 加载 prompt 模板 */
  private loadPromptTemplate(): string {
    const defaultTemplate = `分析以下任务执行过程，提取关键经验。

任务: {{task}}

执行过程:
{{conversation}}

请严格按以下格式输出（不要输出其他内容）:
问题: <遇到的核心问题或挑战，一句话>
解决: <最终的解决方案，一句话>`;

    try {
      const filePath = path.resolve("prompts/experience-reflect.md");
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, "utf-8");
      }
    } catch { /* fallback */ }
    return defaultTemplate;
  }

  /** 搜索相关经验（简单关键词匹配） */
  search(keyword: string): string[] {
    const content = this.readAll();
    if (!content) return [];

    const sections = content.split(/^## /m).slice(1);
    const lower = keyword.toLowerCase();
    return sections.filter(s => s.toLowerCase().includes(lower)).map(s => "## " + s.trim());
  }

  /** 读取全部经验内容 */
  readAll(): string {
    try {
      return fs.readFileSync(this.filePath, "utf-8");
    } catch {
      return "";
    }
  }
}
