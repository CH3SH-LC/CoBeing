/**
 * Read File 工具 — 读取文件内容
 */
import fs from "node:fs";
import path from "node:path";
import type { Tool, ToolContext, ToolResult } from "@cobeing/shared";
import { detectDataPathMisuse } from "./path-guard.js";
import { formatVersionLine } from "./file-version.js";

export const readFileTool: Tool = {
  name: "read-file",
  description: "读取文件内容",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "文件路径" },
      offset: { type: "number", description: "起始行号（从 0 开始）" },
      limit: { type: "number", description: "读取行数" },
    },
    required: ["path"],
  },
  async execute(params, context: ToolContext): Promise<ToolResult> {
    const workingDir = context.workingDir;
    const filePath = path.resolve(workingDir, params.path as string);

    // 误用防护：Agent 把 data/... 项目相对路径当工作目录相对路径
    const misuse = detectDataPathMisuse(workingDir, params.path as string);
    if (misuse) {
      return { toolCallId: "", content: misuse, isError: true };
    }

    // Path containment: prevent escaping working directory
    const rel = path.relative(workingDir, filePath);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      return { toolCallId: "", content: "Error: path escapes working directory", isError: true };
    }

    // Symlink escape prevention: resolve real path if file exists
    try {
      const realPath = fs.realpathSync(filePath);
      const realRel = path.relative(workingDir, realPath);
      if (realRel.startsWith("..") || path.isAbsolute(realRel)) {
        return { toolCallId: "", content: "Error: path escapes working directory (symlink)", isError: true };
      }
    } catch {
      // File doesn't exist yet — ok, will fail naturally on readFileSync below
    }

    const offset = params.offset as number | undefined;
    const limit = params.limit as number | undefined;

    try {
      const content = fs.readFileSync(filePath, "utf-8");
      let lines = content.split("\n");

      if (offset !== undefined) {
        lines = lines.slice(offset);
      }
      if (limit !== undefined) {
        lines = lines.slice(0, limit);
      }

      // 带行号输出
      const startLine = offset ?? 0;
      const numbered = lines.map((line, i) => `${startLine + i}\t${line}`).join("\n");
      const body = numbered || "(empty file)";
      // 并发写保护：附带文件版本（写回时携带 baseVersion）
      const contentWithVersion = body + formatVersionLine(filePath);

      return { toolCallId: "", content: contentWithVersion };
    } catch (err: any) {
      return { toolCallId: "", content: `读取文件失败: ${err.message}`, isError: true };
    }
  },
};
