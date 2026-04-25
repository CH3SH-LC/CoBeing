/**
 * Read File 工具 — 读取文件内容
 */
import fs from "node:fs";
import path from "node:path";
import type { Tool, ToolContext, ToolResult } from "@cobeing/shared";

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
    const filePath = path.resolve(context.workingDir, params.path as string);
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

      return { toolCallId: "", content: numbered || "(empty file)" };
    } catch (err: any) {
      return { toolCallId: "", content: `读取文件失败: ${err.message}`, isError: true };
    }
  },
};
