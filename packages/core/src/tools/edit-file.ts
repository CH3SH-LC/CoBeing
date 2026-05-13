/**
 * Edit File 工具 — 字符串替换编辑文件
 */
import fs from "node:fs";
import path from "node:path";
import type { Tool, ToolContext, ToolResult } from "@cobeing/shared";

const PROTECTED_AGENTS = new Set(["butler", "host"]);

function isProtectedPath(targetPath: string, agentId: string): boolean {
  const normalized = path.resolve(targetPath).replace(/\\/g, "/");
  for (const protectedId of PROTECTED_AGENTS) {
    if (agentId === protectedId) continue;
    const pattern = `/agents/${protectedId}/`;
    if (normalized.includes(pattern)) return true;
  }
  return false;
}

export const editFileTool: Tool = {
  name: "edit-file",
  description: "编辑文件（字符串替换）",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "文件路径" },
      old_string: { type: "string", description: "要替换的文本" },
      new_string: { type: "string", description: "替换后的文本" },
    },
    required: ["path", "old_string", "new_string"],
  },
  async execute(params, context: ToolContext): Promise<ToolResult> {
    const filePath = path.resolve(context.workingDir, params.path as string);
    if (isProtectedPath(filePath, context.agentId)) {
      return { toolCallId: "", content: "拒绝: 无法修改受保护的 Agent 文件", isError: true };
    }
    const oldStr = params.old_string as string;
    const newStr = params.new_string as string;

    try {
      const content = fs.readFileSync(filePath, "utf-8");

      // 检查唯一匹配
      const firstIdx = content.indexOf(oldStr);
      if (firstIdx === -1) {
        return { toolCallId: "", content: `未找到要替换的文本`, isError: true };
      }
      const secondIdx = content.indexOf(oldStr, firstIdx + 1);
      if (secondIdx !== -1) {
        return { toolCallId: "", content: `要替换的文本不唯一（出现多次），请提供更多上下文`, isError: true };
      }

      const newContent = content.replace(oldStr, newStr);
      const relPath = path.relative(context.workingDir, filePath);
      fs.writeFileSync(filePath, newContent, "utf-8");
      return { toolCallId: "", content: `已编辑 ${relPath}` };
    } catch (err: any) {
      return { toolCallId: "", content: `编辑文件失败: ${err.message}`, isError: true };
    }
  },
};
