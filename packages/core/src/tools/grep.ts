/**
 * Grep 工具 — 搜索文件内容（正则）
 */
import fs from "node:fs";
import path from "node:path";
import type { Tool, ToolContext, ToolResult } from "@cobeing/shared";

export const grepTool: Tool = {
  name: "grep",
  description: "搜索文件内容（正则）",
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "正则表达式" },
      path: { type: "string", description: "搜索目录" },
      include: { type: "string", description: "文件名模式，如 *.ts" },
    },
    required: ["pattern"],
  },
  async execute(params, context: ToolContext): Promise<ToolResult> {
    const searchDir = path.resolve(context.workingDir, (params.path as string) || ".");
    const pattern = params.pattern as string;
    const include = params.include as string | undefined;

    try {
      const regex = new RegExp(pattern, "i");
      const includeRegex = include ? globToRegex(include) : null;
      const results: string[] = [];

      walkGrep(searchDir, regex, includeRegex, results, context.workingDir);

      if (results.length === 0) {
        return { toolCallId: "", content: "无匹配结果" };
      }
      return { toolCallId: "", content: results.slice(0, 100).join("\n") };
    } catch (err: any) {
      return { toolCallId: "", content: `搜索失败: ${err.message}`, isError: true };
    }
  },
};

function walkGrep(dir: string, regex: RegExp, includeRegex: RegExp | null, results: string[], baseDir: string) {
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist") continue;
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walkGrep(fullPath, regex, includeRegex, results, baseDir);
      } else if (entry.isFile()) {
        if (includeRegex && !includeRegex.test(entry.name)) continue;
        try {
          const content = fs.readFileSync(fullPath, "utf-8");
          const lines = content.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              const relPath = path.relative(baseDir, fullPath);
              results.push(`${relPath}:${i + 1}: ${lines[i].trim()}`);
              if (results.length >= 200) return;
            }
          }
        } catch { /* binary or unreadable */ }
      }
    }
  } catch { /* ignore */ }
}

function globToRegex(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*");
  return new RegExp(`^${escaped}$`);
}
