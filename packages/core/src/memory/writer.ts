/**
 * MemoryWriter — 将对话记录按天写入 memory/ 目录
 * 硬编码程序，不通过 LLM 工具调用
 */
import fs from "node:fs";
import path from "node:path";
import { createLogger } from "@cobeing/shared";

const log = createLogger("memory-writer");

export interface MemoryEntry {
  session: string;       // "main" | "group:{groupId}:main" | "group:{groupId}:talk:{talkId}"
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolName?: string;
  toolResult?: string;
  timestamp?: number;
}

export class MemoryWriter {
  constructor(private memoryDir: string) {
    fs.mkdirSync(memoryDir, { recursive: true });
  }

  /** 追加一条记录到当天文件 */
  async append(entry: MemoryEntry): Promise<void> {
    const today = new Date().toISOString().split("T")[0];
    const filePath = path.join(this.memoryDir, `${today}.md`);
    const formatted = this.formatEntry(entry);

    try {
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, `# ${today} 对话记录\n\n`, "utf-8");
      }
      fs.appendFileSync(filePath, formatted + "\n", "utf-8");
    } catch (err) {
      log.warn("Failed to write memory entry: %s", err);
    }
  }

  /** 批量追加一轮对话 */
  async appendRound(session: string, messages: Array<{ role: string; content: string }>): Promise<void> {
    for (const msg of messages) {
      await this.append({
        session,
        role: msg.role as MemoryEntry["role"],
        content: msg.content,
      });
    }
  }

  private formatEntry(entry: MemoryEntry): string {
    const ts = entry.timestamp ?? Date.now();
    const time = new Date(ts).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    const header = `## ${time} [${entry.session}]`;

    let body = "";
    switch (entry.role) {
      case "user":
        body = `**User:** ${entry.content}`;
        break;
      case "assistant":
        body = `**Assistant:** ${entry.content}`;
        break;
      case "tool":
        body = `**Tool: ${entry.toolName ?? "unknown"}**\n\`\`\`\n${entry.content}\n\`\`\``;
        break;
      case "system":
        body = `**System:** ${entry.content}`;
        break;
    }

    return `${header}\n${body}\n`;
  }
}
