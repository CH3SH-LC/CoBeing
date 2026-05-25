/**
 * Write File 工具 — 写入文件（覆盖或创建）
 */
import fs from "node:fs";
import path from "node:path";
import type { Tool, ToolContext, ToolResult } from "@cobeing/shared";
import { scanContent } from "../memory/security-scan.js";

const PROTECTED_AGENTS = new Set(["butler", "host"]);
const MEMORY_FILES = new Set(["MEMORY.md", "EXPERIENCE.md"]);

function isProtectedPath(targetPath: string, agentId: string): boolean {
  const normalized = path.resolve(targetPath).replace(/\\/g, "/");
  for (const protectedId of PROTECTED_AGENTS) {
    if (agentId === protectedId) continue; // 自身可以修改自己的文件
    const pattern = `/agents/${protectedId}/`;
    if (normalized.includes(pattern)) return true;
  }
  return false;
}

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
    const workingDir = context.workingDir;
    const filePath = path.resolve(workingDir, params.path as string);

    // Path containment: prevent escaping working directory
    const rel = path.relative(workingDir, filePath);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      return { toolCallId: "", content: "Error: path escapes working directory", isError: true };
    }

    // Symlink escape prevention: resolve real path; for non-existent files check parent
    try {
      const realPath = fs.realpathSync(filePath);
      const realRel = path.relative(workingDir, realPath);
      if (realRel.startsWith("..") || path.isAbsolute(realRel)) {
        return { toolCallId: "", content: "Error: path escapes working directory (symlink)", isError: true };
      }
    } catch {
      // File doesn't exist yet — check parent directory for symlink escapes
      const parentDir = path.dirname(filePath);
      try {
        const realParent = fs.realpathSync(parentDir);
        const realParentRel = path.relative(workingDir, realParent);
        if (realParentRel.startsWith("..") || path.isAbsolute(realParentRel)) {
          return { toolCallId: "", content: "Error: path escapes working directory", isError: true };
        }
      } catch {
        // Parent doesn't exist either — will be created by mkdirSync below
      }
    }

    if (isProtectedPath(filePath, context.agentId)) {
      return { toolCallId: "", content: "拒绝: 无法修改受保护的 Agent 文件", isError: true };
    }

    const content = params.content as string;

    // 安全扫描：写入 MEMORY.md / EXPERIENCE.md 前检测注入
    const fileName = path.basename(filePath);
    if (MEMORY_FILES.has(fileName)) {
      const scan = scanContent(content);
      if (!scan.safe) {
        return { toolCallId: "", content: `安全扫描拒绝: 内容匹配威胁模式 '${scan.threat}'`, isError: true };
      }
    }

    try {
      const dir = path.dirname(filePath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, content, "utf-8");
      const relPath = path.relative(context.workingDir, filePath);
      return { toolCallId: "", content: `已写入 ${relPath} (${content.length} 字符)` };
    } catch (err: any) {
      return { toolCallId: "", content: `写入文件失败: ${err.message}`, isError: true };
    }
  },
};
