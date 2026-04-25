/**
 * Write File 工具 — 写入文件（覆盖或创建）
 */
import fs from "node:fs";
import path from "node:path";
import type { Tool, ToolContext, ToolResult } from "@cobeing/shared";

export const writeFileTool: Tool = {
  name: "write-file",
  description: "写入文件（覆盖或创建）",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "文件路径" },
      content: { type: "string", description: "文件内容" },
    },
    required: ["path", "content"],
  },
  async execute(params, context: ToolContext): Promise<ToolResult> {
    const filePath = path.resolve(context.workingDir, params.path as string);
    const content = params.content as string;

    try {
      // 确保目录存在
      const dir = path.dirname(filePath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, content, "utf-8");
      return { toolCallId: "", content: `已写入 ${filePath} (${content.length} 字符)` };
    } catch (err: any) {
      return { toolCallId: "", content: `写入文件失败: ${err.message}`, isError: true };
    }
  },
};
