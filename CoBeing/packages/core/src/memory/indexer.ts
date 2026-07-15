/**
 * MemoryIndexer — 调用 LLM 总结历史对话，生成 MEMORY.md 索引
 */
import fs from "node:fs";
import path from "node:path";
import type { LLMProvider } from "@cobeing/providers";
import { createLogger } from "@cobeing/shared";

const log = createLogger("memory-indexer");

export class MemoryIndexer {
  constructor(
    private memoryDir: string,
    private memoryIndexPath: string,
    private provider: LLMProvider,
    private model: string,
  ) {}

  /** 总结最近 N 天的对话，更新 MEMORY.md */
  async index(days = 7): Promise<void> {
    const files = this.getRecentFiles(days);
    if (files.length === 0) {
      log.info("No memory files to index");
      return;
    }

    // 读取所有文件内容
    const allContent = files.map(f => {
      const content = fs.readFileSync(path.join(this.memoryDir, f), "utf-8");
      return content;
    }).join("\n\n---\n\n");

    // 截断防止超 context
    const truncated = allContent.length > 30000
      ? allContent.slice(0, 30000) + "\n...(truncated)"
      : allContent;

    // 调用 LLM 总结
    const summary = await this.summarize(truncated);

    // 写入 MEMORY.md
    const existing = this.readExistingIndex();
    const updated = this.mergeIndex(existing, summary);
    fs.writeFileSync(this.memoryIndexPath, updated, "utf-8");

    log.info("Memory index updated (%d files indexed)", files.length);
  }

  private async summarize(content: string): Promise<string> {
    let result = "";
    for await (const chunk of this.provider.chat({
      model: this.model,
      messages: [
        {
          role: "system",
          content: `你是记忆索引器。请将以下对话记录总结为简洁的索引条目。
每条一行，格式："- 日期摘要（关键事件、决策、结果）"
只保留重要信息，忽略闲聊。用中文输出。`,
        },
        { role: "user", content },
      ],
    })) {
      if (chunk.type === "content" && chunk.content) {
        result += chunk.content;
      }
    }
    return result || "(无摘要)";
  }

  private readExistingIndex(): string {
    try {
      return fs.readFileSync(this.memoryIndexPath, "utf-8");
    } catch {
      return "# 记忆索引\n\n";
    }
  }

  private mergeIndex(existing: string, newSummary: string): string {
    const today = new Date().toISOString().split("T")[0];
    const header = `# 记忆索引\n\n`;
    const entry = `## ${today}\n${newSummary}\n\n`;

    // 如果已有今天的条目，替换；否则追加
    const todayMarker = `## ${today}`;
    if (existing.includes(todayMarker)) {
      const lines = existing.split("\n");
      const startIdx = lines.findIndex(l => l.startsWith(todayMarker));
      let endIdx = startIdx + 1;
      while (endIdx < lines.length && !lines[endIdx].startsWith("## ")) endIdx++;
      const replaced = [...lines.slice(0, startIdx), ...entry.split("\n"), ...lines.slice(endIdx)];
      return replaced.join("\n");
    }

    return header + entry + existing.replace("# 记忆索引\n\n", "");
  }

  private getRecentFiles(days: number): string[] {
    if (!fs.existsSync(this.memoryDir)) return [];

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    return fs.readdirSync(this.memoryDir)
      .filter(f => f.endsWith(".md"))
      .filter(f => {
        const dateStr = f.replace(".md", "");
        const fileDate = new Date(dateStr);
        return fileDate >= cutoff;
      })
      .sort();
  }
}
