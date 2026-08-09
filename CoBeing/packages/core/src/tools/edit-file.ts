/**
 * Edit File 工具 — 字符串替换编辑文件
 */
import fs from "node:fs";
import path from "node:path";
import type { Tool, ToolContext, ToolResult } from "@cobeing/shared";
import { detectDataPathMisuse } from "./path-guard.js";
import { checkFileVersion } from "./file-version.js";

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
      replace_all: { type: "boolean", description: "是否替换所有匹配出现，默认 false" },
      baseVersion: {
        type: "string",
        description: "并发写保护（可选）：read-file 返回的 [file-version: X] 值。若文件已被其他成员修改（版本不一致），编辑将被拒绝，需重新读取后再编辑。",
      },
    },
    required: ["path", "old_string", "new_string"],
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

    if (isProtectedPath(filePath, context.agentId)) {
      return { toolCallId: "", content: "拒绝: 无法修改受保护的 Agent 文件", isError: true };
    }
    const oldStr = params.old_string as string;
    const newStr = params.new_string as string;
    const shouldReplaceAll = (params.replace_all as boolean) ?? false;

    if (oldStr === newStr) {
      return { toolCallId: "", content: "old_string and new_string must be different", isError: true };
    }

    try {
      // 并发写保护 CAS：baseVersion 与当前版本不一致 → 拒绝（防静默覆写）
      if (params.baseVersion) {
        const conflict = checkFileVersion(filePath, params.baseVersion as string);
        if (conflict !== undefined) {
          return {
            toolCallId: "",
            content: `并发写保护：文件已被其他成员修改（当前版本 ${conflict} 与你的基准 ${params.baseVersion} 不一致），请重新读取后再编辑。`,
            isError: true,
          };
        }
      }
      const content = fs.readFileSync(filePath, "utf-8");

      const firstIdx = content.indexOf(oldStr);
      if (firstIdx === -1) {
        return {
          toolCallId: "",
          content: "old_string not found in file. Please read the file first to get the exact current content.",
          isError: true,
        };
      }

      if (!shouldReplaceAll) {
        const secondIdx = content.indexOf(oldStr, firstIdx + 1);
        if (secondIdx !== -1) {
          return { toolCallId: "", content: "要替换的文本不唯一（出现多次），请提供更多上下文", isError: true };
        }
      }

      const occurrences = shouldReplaceAll ? content.split(oldStr).length - 1 : 1;
      const newContent = shouldReplaceAll
        ? content.replaceAll(oldStr, newStr)
        : content.replace(oldStr, newStr);

      const relPath = path.relative(context.workingDir, filePath);
      fs.writeFileSync(filePath, newContent, "utf-8");

      const oldPreview = oldStr.length > 80 ? oldStr.slice(0, 80) + "..." : oldStr;
      const newPreview = newStr.length > 80 ? newStr.slice(0, 80) + "..." : newStr;
      return {
        toolCallId: "",
        content: `Edit applied to ${relPath}\n- occurrences: ${occurrences}\n- old: ${oldPreview}\n- new: ${newPreview}`,
      };
    } catch (err: any) {
      return { toolCallId: "", content: `编辑文件失败: ${err.message}`, isError: true };
    }
  },
};
