/**
 * Glob 工具 — 按模式搜索文件
 */
import fs from "node:fs";
import path from "node:path";
import type { Tool, ToolContext, ToolResult } from "@cobeing/shared";
import { detectDataPathMisuse } from "./path-guard.js";

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
    const pattern = params.pattern as string;

    try {
      const searchDir = resolveWithinWorkingDir(context.workingDir, (params.path as string) || ".");
      const { results, truncated } = globWalk(searchDir, pattern);
      if (results.length === 0) {
        return { toolCallId: "", content: truncated
          ? `无匹配文件（搜索范围超出上限已截断：已遍历 ${MAX_GLOB_FILES} 个文件，请缩小 path 范围后重试）`
          : "无匹配文件" };
      }
      // 返回相对于 workingDir 的路径
      const relPaths = results.slice(0, 200).map(f => path.relative(context.workingDir, f));
      let content = relPaths.join("\n");
      if (truncated) {
        content += `\n\n⚠️ 搜索范围超出上限已截断（最多遍历 ${MAX_GLOB_FILES} 个文件 / ${MAX_GLOB_DEPTH} 层目录），结果可能不完整。请缩小 path 参数范围后重试。`;
      }
      return { toolCallId: "", content };
    } catch (err: any) {
      return { toolCallId: "", content: `搜索失败: ${err.message}`, isError: true };
    }
  },
};

/** 简易 glob 实现 — 支持 * 和 ** */
function resolveWithinWorkingDir(workingDir: string, target: string): string {
  const misuse = detectDataPathMisuse(workingDir, target);
  if (misuse) throw new Error(misuse);
  const realWorking = fs.existsSync(workingDir) ? fs.realpathSync(workingDir) : path.resolve(workingDir);
  const resolved = path.resolve(realWorking, target);
  const realTarget = fs.existsSync(resolved) ? fs.realpathSync(resolved) : resolved;
  const rel = path.relative(realWorking, realTarget);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("path escapes working directory");
  }
  return realTarget;
}

/** 扫描上限：防止工作目录异常时（如兜底到项目根）递归全盘扫描导致内存耗尽 */
const MAX_GLOB_FILES = 2000;
const MAX_GLOB_DEPTH = 12;

function globWalk(dir: string, pattern: string): { results: string[]; truncated: boolean } {
  const results: string[] = [];
  let truncated = false;
  const state = { files: 0 };
  const parts = pattern.split("/");

  function walk(currentDir: string, depth: number) {
    if (depth > MAX_GLOB_DEPTH) { truncated = true; return; }
    if (state.files >= MAX_GLOB_FILES) { truncated = true; return; }
    if (depth >= parts.length) return;
    const part = parts[depth];
    const isLast = depth === parts.length - 1;

    if (part === "**") {
      // 递归所有子目录
      walk(currentDir, depth + 1); // ** 匹配 0 层
      try {
        for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
          if (state.files >= MAX_GLOB_FILES) { truncated = true; return; }
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
          if (state.files >= MAX_GLOB_FILES) { truncated = true; return; }
          if (entry.name.startsWith(".")) continue;
          if (!matchGlob(entry.name, part)) continue;

          const fullPath = path.join(currentDir, entry.name);
          if (isLast) {
            if (entry.isFile() || entry.isDirectory()) { results.push(fullPath); state.files++; }
          } else if (entry.isDirectory()) {
            walk(fullPath, depth + 1);
          }
        }
      } catch { /* ignore */ }
    }
  }

  walk(dir, 0);
  return { results, truncated };
}

function matchGlob(name: string, pattern: string): boolean {
  // 只处理 * 通配符（不支持 ?、[] 等）
  if (!pattern.includes("*")) return name === pattern;
  const regexStr = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*");
  return new RegExp(`^${regexStr}$`).test(name);
}
