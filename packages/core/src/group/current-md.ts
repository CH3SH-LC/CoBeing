/**
 * CurrentMd — 群组热上下文管理
 *
 * 维护 current.md（JSONL 格式），存储最近 N 条消息。
 * WakeSystem 在每次唤醒前调用 roll() 裁剪。
 */
import fs from "node:fs";
import path from "node:path";
import { createLogger } from "@cobeing/shared";

const log = createLogger("current-md");

export interface CurrentMessage {
  id: string;
  tag: string;
  fromAgentId: string;
  content: string;
  timestamp: number;
}

export class CurrentMd {
  private filePath: string;
  private inMemory: CurrentMessage[] = [];

  constructor(memoryDir: string) {
    fs.mkdirSync(memoryDir, { recursive: true });
    this.filePath = path.join(memoryDir, "current.md");
  }

  /** 追加一条消息（仅内存，文件持久化由 save_chat_current 处理） */
  append(msg: CurrentMessage): void {
    this.inMemory.push(msg);
  }

  /** 裁剪到最近 maxMessages 条（仅内存） */
  roll(maxMessages: number): void {
    if (this.inMemory.length <= maxMessages) return;
    this.inMemory = this.inMemory.slice(-maxMessages);
    log.debug("Rolled current.md (memory): → %d messages", this.inMemory.length);
  }

  /** 读取所有消息（解析 JSONL） */
  read(): CurrentMessage[] {
    if (!fs.existsSync(this.filePath)) return [];
    const raw = fs.readFileSync(this.filePath, "utf-8");
    return raw.trim().split("\n").filter(Boolean).map(line => {
      try { return JSON.parse(line) as CurrentMessage; } catch { return null; }
    }).filter((m): m is CurrentMessage => m !== null);
  }

  /** 格式化为 Agent 可读的上下文文本（从内存读取） */
  readAsContext(): string {
    if (this.inMemory.length === 0) return "";

    return this.inMemory.map(msg => {
      const speaker = msg.fromAgentId;
      if (msg.tag === "main") {
        return `[${speaker}]: ${msg.content}`;
      }
      return `[Talk: ${msg.tag}] [${speaker}]: ${msg.content}`;
    }).join("\n\n");
  }
}
