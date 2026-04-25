/**
 * MemoryReader — 读取历史对话和记忆索引
 */
import fs from "node:fs";
import path from "node:path";

export class MemoryReader {
  constructor(private memoryDir: string, private memoryIndexPath: string) {}

  /** 读取 MEMORY.md 索引 */
  readIndex(): string {
    try {
      return fs.readFileSync(this.memoryIndexPath, "utf-8");
    } catch {
      return "";
    }
  }

  /** 读取最近 N 天的对话记录 */
  readRecent(days: number): string {
    const files = this.getRecentFiles(days);
    if (files.length === 0) return "";

    return files.map(f => {
      const content = fs.readFileSync(path.join(this.memoryDir, f), "utf-8");
      return content;
    }).join("\n\n---\n\n");
  }

  /** 搜索包含关键词的对话 */
  search(keyword: string, limit = 10): string[] {
    if (!fs.existsSync(this.memoryDir)) return [];
    const results: string[] = [];

    const files = fs.readdirSync(this.memoryDir).filter(f => f.endsWith(".md")).sort().reverse();
    for (const file of files) {
      if (results.length >= limit) break;
      const content = fs.readFileSync(path.join(this.memoryDir, file), "utf-8");
      const lines = content.split("\n");
      for (const line of lines) {
        if (line.toLowerCase().includes(keyword.toLowerCase())) {
          results.push(`[${file}] ${line.trim()}`);
          if (results.length >= limit) break;
        }
      }
    }

    return results;
  }

  private getRecentFiles(days: number): string[] {
    if (!fs.existsSync(this.memoryDir)) return [];

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    return fs.readdirSync(this.memoryDir)
      .filter(f => f.endsWith(".md"))
      .filter(f => new Date(f.replace(".md", "")) >= cutoff)
      .sort();
  }
}
