import fs from "node:fs";
import path from "node:path";
import type { Tool, ToolContext, ToolResult } from "@cobeing/shared";
import { detectDataPathMisuse } from "./path-guard.js";

interface MatchEntry {
  file: string;
  line: number;
  text: string;
}

interface ContentOptions {
  after: number;
  before: number;
  contextLines: number;
  showLineNumbers: boolean;
  offset: number;
  headLimit: number;
}

export const grepTool: Tool = {
  name: "grep",
  description: "搜索文件内容（正则）",
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "正则表达式" },
      path: { type: "string", description: "搜索目录" },
      glob: { type: "string", description: "文件名 glob 过滤，如 *.ts" },
      include: { type: "string", description: "已废弃，请使用 glob" },
      output_mode: {
        type: "string",
        description: "输出模式: content（默认）, files_with_matches, count",
      },
      head_limit: { type: "number", description: "最大输出条目数，默认 250。0 = 无限制" },
      offset: { type: "number", description: "跳过前 N 条结果，默认 0" },
      "-A": { type: "number", description: "匹配行后显示 N 行上下文" },
      "-B": { type: "number", description: "匹配行前显示 N 行上下文" },
      "-C": { type: "number", description: "匹配行前后各显示 N 行上下文" },
      multiline: { type: "boolean", description: "启用 dotAll 多行匹配模式" },
      "-i": { type: "boolean", description: "大小写不敏感，默认 true" },
      "-n": { type: "boolean", description: "显示行号，默认 true" },
    },
    required: ["pattern"],
  },
  async execute(params, context: ToolContext): Promise<ToolResult> {
    const pattern = params.pattern as string;
    const globPattern = (params.glob as string) || (params.include as string) || undefined;
    const outputMode = (params.output_mode as string) || "content";
    const headLimit = (params.head_limit as number) ?? 250;
    const offset = (params.offset as number) ?? 0;
    const after = (params["-A"] as number) ?? 0;
    const before = (params["-B"] as number) ?? 0;
    const ctxLines = (params["-C"] as number) ?? 0;
    const multilineFlag = (params.multiline as boolean) ?? false;
    const caseInsensitive = (params["-i"] as boolean) ?? true;
    const showLineNumbers = (params["-n"] as boolean) ?? true;

    try {
      const searchDir = resolveWithinWorkingDir(context.workingDir, (params.path as string) || ".");
      const flags = (caseInsensitive ? "i" : "") + (multilineFlag ? "s" : "");
      const regex = new RegExp(pattern, flags);
      const includeRegex = globPattern ? globToRegex(globPattern) : null;

      const entries: MatchEntry[] = [];
      const scanState = { files: 0, truncated: false };
      collectMatches(searchDir, regex, includeRegex, entries, context.workingDir, scanState);

      if (entries.length === 0) {
        return { toolCallId: "", content: scanState.truncated
          ? `无匹配结果（搜索范围超出上限已截断：已遍历 ${MAX_SCAN_FILES} 个文件仍未找到，请缩小 path 范围后重试）`
          : "无匹配结果" };
      }

      const useContext = ctxLines > 0 || before > 0 || after > 0;

      let result: string;
      switch (outputMode) {
        case "files_with_matches":
          result = buildFilesWithMatches(entries, offset, headLimit);
          break;
        case "count":
          result = buildCountOutput(entries, offset, headLimit);
          break;
        case "content":
        default:
          result = useContext
            ? buildContentWithContext(entries, context.workingDir, {
                after: ctxLines || after,
                before: ctxLines || before,
                contextLines: 0,
                showLineNumbers,
                offset,
                headLimit,
              })
            : buildContentOutput(entries, { showLineNumbers, offset, headLimit });
          break;
      }

      if (scanState.truncated) {
        result += `\n\n⚠️ 搜索范围超出上限已截断（最多遍历 ${MAX_SCAN_FILES} 个文件 / ${MAX_SCAN_DEPTH} 层目录），结果可能不完整。请缩小 path 参数范围后重试。`;
      }

      return { toolCallId: "", content: result };
    } catch (err: any) {
      return { toolCallId: "", content: `搜索失败: ${err.message}`, isError: true };
    }
  },
};

// ---- Internal functions ----

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
const MAX_SCAN_FILES = 2000;   // 最多遍历 2000 个文件
const MAX_SCAN_DEPTH = 12;     // 最多递归 12 层目录
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 单个文件超过 2MB 不读入内存（日志/db 等大文件）

function collectMatches(
  dir: string,
  regex: RegExp,
  includeRegex: RegExp | null,
  entries: MatchEntry[],
  baseDir: string,
  state: { files: number; truncated: boolean } = { files: 0, truncated: false },
  depth = 0,
) {
  if (depth > MAX_SCAN_DEPTH || state.files >= MAX_SCAN_FILES) {
    state.truncated = true;
    return;
  }
  let dirents: fs.Dirent[];
  try {
    dirents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of dirents) {
    if (state.files >= MAX_SCAN_FILES) { state.truncated = true; break; }
    if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist") continue;
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      collectMatches(fullPath, regex, includeRegex, entries, baseDir, state, depth + 1);
    } else if (entry.isFile()) {
      state.files++;
      if (includeRegex && !includeRegex.test(entry.name)) continue;
      try {
        // 大文件不读入内存（日志/db/二进制等）——防止异常扫描场景内存飙升
        const stat = fs.statSync(fullPath);
        if (stat.size > MAX_FILE_SIZE) continue;
        const content = fs.readFileSync(fullPath, "utf-8");
        const relPath = path.relative(baseDir, fullPath).replace(/\\/g, "/");

        if (regex.flags.includes("s")) {
          // Multiline mode: test full content as a single string
          const r = new RegExp(regex.source, regex.flags.replace("g", "") + "g");
          let match: RegExpExecArray | null;
          while ((match = r.exec(content)) !== null) {
            const beforeMatch = content.slice(0, match.index);
            const lineNum = (beforeMatch.match(/\n/g) || []).length + 1;
            const firstLine = match[0].split("\n")[0].trim();
            entries.push({ file: relPath, line: lineNum, text: firstLine || match[0].slice(0, 80) });
            if (entries.length >= 10000) return;
          }
        } else {
          // Line-by-line mode
          const lines = content.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              entries.push({ file: relPath, line: i + 1, text: lines[i] });
              if (entries.length >= 10000) return;
            }
          }
        }
      } catch {
        /* binary or unreadable — skip */
      }
    }
  }
}

function buildContentOutput(
  entries: MatchEntry[],
  opts: { showLineNumbers: boolean; offset: number; headLimit: number },
): string {
  entries.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

  const lines: string[] = [];
  let count = 0;

  for (const e of entries) {
    if (count < opts.offset) { count++; continue; }
    if (opts.headLimit > 0 && lines.length >= opts.headLimit) break;

    const prefix = opts.showLineNumbers ? `${e.file}:${e.line}: ` : `${e.file}: `;
    lines.push(prefix + e.text);
    count++;
  }

  let result = lines.join("\n");
  const shown = lines.length;
  const total = entries.length - opts.offset;
  const remaining = total - shown;
  if (remaining > 0) {
    result += `\n... and ${remaining} more results`;
  }
  return result || "无匹配结果";
}

function buildFilesWithMatches(entries: MatchEntry[], offset: number, headLimit: number): string {
  const files = [...new Set(entries.map(e => e.file))].sort();
  const sliced = headLimit > 0
    ? files.slice(offset, offset + headLimit)
    : files.slice(offset);

  let result = sliced.join("\n");
  const remaining = files.length - offset - sliced.length;
  if (remaining > 0) {
    result += `\n... and ${remaining} more files`;
  }
  return result || "无匹配结果";
}

function buildCountOutput(entries: MatchEntry[], offset: number, headLimit: number): string {
  const counts = new Map<string, number>();
  for (const e of entries) {
    counts.set(e.file, (counts.get(e.file) || 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const sliced = headLimit > 0
    ? sorted.slice(offset, offset + headLimit)
    : sorted.slice(offset);

  const lines = sliced.map(([file, n]) => `${file}: ${n}`);
  let result = lines.join("\n");
  const remaining = sorted.length - offset - sliced.length;
  if (remaining > 0) {
    result += `\n... and ${remaining} more files`;
  }
  return result || "无匹配结果";
}

function buildContentWithContext(
  entries: MatchEntry[],
  baseDir: string,
  opts: ContentOptions,
): string {
  const byFile = new Map<string, MatchEntry[]>();
  for (const e of entries) {
    const list = byFile.get(e.file) || [];
    list.push(e);
    byFile.set(e.file, list);
  }

  const files = [...byFile.keys()].sort();
  const groups: string[] = [];
  let outputCount = 0;

  for (const file of files) {
    if (opts.headLimit > 0 && outputCount >= opts.headLimit + opts.offset) break;
    const fileEntries = byFile.get(file)!;
    const filePath = path.join(baseDir, file);

    let content: string[];
    try {
      content = fs.readFileSync(filePath, "utf-8").split("\n");
    } catch {
      continue;
    }

    const linesToShow = new Set<number>();
    const actualBefore = opts.contextLines || opts.before;
    const actualAfter = opts.contextLines || opts.after;

    for (const e of fileEntries) {
      linesToShow.add(e.line);
      for (let i = Math.max(1, e.line - actualBefore); i < e.line; i++) linesToShow.add(i);
      for (let i = e.line + 1; i <= Math.min(content.length, e.line + actualAfter); i++) linesToShow.add(i);
    }

    const sorted = [...linesToShow].sort((a, b) => a - b);
    if (sorted.length === 0) continue;

    let prev = sorted[0] - 2;
    for (const lineNum of sorted) {
      if (outputCount < opts.offset) { outputCount++; prev = lineNum; continue; }
      if (opts.headLimit > 0 && outputCount - opts.offset >= opts.headLimit) break;

      if (lineNum > prev + 1) groups.push("--");
      const prefix = opts.showLineNumbers ? `${file}:${lineNum}: ` : `${file}: `;
      groups.push(prefix + (content[lineNum - 1] || ""));
      prev = lineNum;
      outputCount++;
    }
  }

  let result = groups.join("\n");
  if (result.startsWith("--\n")) result = result.slice(3);
  return result || "无匹配结果";
}

function globToRegex(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*");
  return new RegExp(`^${escaped}$`);
}
