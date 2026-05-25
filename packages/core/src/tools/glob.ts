/**
 * Glob 工具 — 按模式搜索文件
 */
import fs from "node:fs";
import path from "node:path";
import type { Tool, ToolContext, ToolResult } from "@cobeing/shared";

export const globTool: Tool = {
  name: "glob",
  description: "按模式搜索文件",
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "glob 模式，如 **/*.ts" },
      path: { type: "string", description: "搜索目录" },
    },
    required: ["pattern"],
  },
  async execute(params, context: ToolContext): Promise<ToolResult> {
    const searchDir = path.resolve(context.workingDir, (params.path as string) || ".");
    const pattern = params.pattern as string;

    try {
      const results = globWalk(searchDir, pattern);
      if (results.length === 0) {
        return { toolCallId: "", content: "无匹配文件" };
      }
      // 返回相对于 workingDir 的路径
      const relPaths = results.slice(0, 200).map(f => path.relative(context.workingDir, f));
      return { toolCallId: "", content: relPaths.join("\n") };
    } catch (err: any) {
      return { toolCallId: "", content: `搜索失败: ${err.message}`, isError: true };
    }
  },
};

/** 简易 glob 实现 — 支持 * 和 ** */
function globWalk(dir: string, pattern: string): string[] {
  const results: string[] = [];
  const parts = pattern.split("/");

  function walk(currentDir: string, depth: number) {
    if (depth >= parts.length) return;
    const part = parts[depth];
    const isLast = depth === parts.length - 1;

    if (part === "**") {
      // 递归所有子目录
      walk(currentDir, depth + 1); // ** 匹配 0 层
      try {
        for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
          if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
          if (entry.isDirectory()) {
            walk(path.join(currentDir, entry.name), depth);     // 继续匹配 **
            walk(path.join(currentDir, entry.name), depth + 1); // 下一层
          }
        }
      } catch { /* ignore */ }
    } else {
      try {
        for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
          if (entry.name.startsWith(".")) continue;
          if (!matchGlob(entry.name, part)) continue;

          const fullPath = path.join(currentDir, entry.name);
          if (isLast) {
            if (entry.isFile() || entry.isDirectory()) results.push(fullPath);
          } else if (entry.isDirectory()) {
            walk(fullPath, depth + 1);
          }
        }
      } catch { /* ignore */ }
    }
  }

  walk(dir, 0);
  return results;
}

function matchGlob(name: string, pattern: string): boolean {
  // 只处理 * 通配符（不支持 ?、[] 等）
  if (!pattern.includes("*")) return name === pattern;
  const regexStr = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*");
  return new RegExp(`^${regexStr}$`).test(name);
}
