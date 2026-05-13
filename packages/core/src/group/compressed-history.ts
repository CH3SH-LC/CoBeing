/**
 * CompressedHistory — per-agent compressed history management
 *
 * Stores compressed phase summaries as per-agent Markdown files.
 * Used in three-layer memory: compressed history sits between abstract layer
 * and uncompressed recent messages in the context built by WakeSystem.
 */
import fs from "node:fs";
import path from "node:path";
import { createLogger } from "@cobeing/shared";

const log = createLogger("compressed-history");

export interface CompressedPhase {
  title: string;
  startDate: string;
  endDate: string;
  summary: string;
}

export class CompressedHistory {
  readonly agentId: string;
  private filePath: string;

  constructor(agentId: string, memoryDir: string) {
    this.agentId = agentId;
    this.filePath = path.join(memoryDir, `${agentId}-compressed.md`);
  }

  /** Read the full compressed history file */
  read(): string {
    try {
      return fs.readFileSync(this.filePath, "utf-8");
    } catch {
      return "";
    }
  }

  /** Append a new phase summary */
  appendPhase(phase: CompressedPhase, compressedUntilTimestamp: number): void {
    // Ensure directory exists
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });

    const dateStr = new Date(compressedUntilTimestamp).toISOString();
    let content = this.read();

    if (!content) {
      content = `# 压缩历史\n\n> 截至 ${dateStr} 的历史已总结\n`;
    }

    // Update the "截至" line
    content = content.replace(
      /截至 .+ 的历史已总结/,
      `截至 ${dateStr} 的历史已总结`,
    );

    // Append new phase
    content += `\n## ${phase.title}（${phase.startDate} ~ ${phase.endDate}）\n${phase.summary}\n`;

    fs.writeFileSync(this.filePath, content, "utf-8");
    log.info("[%s] Compressed phase appended: %s", this.agentId, phase.title);
  }

  /** Check if compressed history exists */
  exists(): boolean {
    return fs.existsSync(this.filePath);
  }
}
