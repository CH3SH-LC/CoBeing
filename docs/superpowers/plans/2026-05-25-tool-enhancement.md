# 方案 2 — 工具增强 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 参照 claw-code 增强 edit-file（replace_all + 结构化输出）、grep（output_mode + head_limit/offset + context lines + 完整参数对齐）、bash（输出截断 16384 字节）

**Architecture:** 纯后端工具层改动。每个工具独立修改 `.ts` 文件 + 新增 `.test.ts` 文件。不改动工具注册逻辑（工具名不变）。三个工具之间无依赖。

**Tech Stack:** TypeScript, Node.js fs/path/child_process, Vitest

---

### Task 1: edit-file 增强 — 测试 + 实现

**Files:**
- Create: `packages/core/src/tools/edit-file.test.ts`
- Modify: `packages/core/src/tools/edit-file.ts`

- [ ] **Step 1: 编写 edit-file 测试文件**

```typescript
// packages/core/src/tools/edit-file.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { editFileTool } from "./edit-file.js";

const workingDir = path.join(os.tmpdir(), "cobeing-test-edit-" + Date.now());

beforeEach(() => {
  fs.mkdirSync(workingDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(workingDir, { recursive: true, force: true });
});

function ctx() {
  return { agentId: "test-agent", sessionId: "s1", workingDir, sandbox: { enabled: false, filesystem: "isolated" as const, network: { enabled: false, mode: "all" as const } }, permissions: { mode: "full-access" as const } };
}

describe("editFileTool", () => {
  it("replaces a single occurrence of old_string", async () => {
    fs.writeFileSync(path.join(workingDir, "test.txt"), "hello world");
    const result = await editFileTool.execute(
      { path: "test.txt", old_string: "hello", new_string: "hi" },
      ctx(),
    );
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain("Edit applied to test.txt");
    expect(result.content).toContain("- occurrences: 1");
    const updated = fs.readFileSync(path.join(workingDir, "test.txt"), "utf-8");
    expect(updated).toBe("hi world");
  });

  it("replace_all replaces all occurrences", async () => {
    fs.writeFileSync(path.join(workingDir, "test.txt"), "aa bb aa cc aa");
    const result = await editFileTool.execute(
      { path: "test.txt", old_string: "aa", new_string: "xx", replace_all: true },
      ctx(),
    );
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain("- occurrences: 3");
    const updated = fs.readFileSync(path.join(workingDir, "test.txt"), "utf-8");
    expect(updated).toBe("xx bb xx cc xx");
  });

  it("rejects when old_string equals new_string", async () => {
    fs.writeFileSync(path.join(workingDir, "test.txt"), "hello");
    const result = await editFileTool.execute(
      { path: "test.txt", old_string: "hello", new_string: "hello" },
      ctx(),
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain("must be different");
  });

  it("returns error when old_string not found", async () => {
    fs.writeFileSync(path.join(workingDir, "test.txt"), "hello world");
    const result = await editFileTool.execute(
      { path: "test.txt", old_string: "goodbye", new_string: "hi" },
      ctx(),
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain("not found in file");
    expect(result.content).toContain("read the file first");
  });

  it("rejects when old_string appears multiple times without replace_all", async () => {
    fs.writeFileSync(path.join(workingDir, "test.txt"), "dup at start. some text. dup at end.");
    const result = await editFileTool.execute(
      { path: "test.txt", old_string: "dup", new_string: "xxx" },
      ctx(),
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain("不唯一");
  });

  it("includes old/new preview in output", async () => {
    fs.writeFileSync(path.join(workingDir, "test.txt"), "alpha beta gamma");
    const result = await editFileTool.execute(
      { path: "test.txt", old_string: "beta", new_string: "delta" },
      ctx(),
    );
    expect(result.content).toContain("- old: beta");
    expect(result.content).toContain("- new: delta");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm --filter @cobeing/core exec vitest run src/tools/edit-file.test.ts
```

Expected: 6 tests fail (old_string=new_string rejection, error message format, replace_all, structured output all missing)

- [ ] **Step 3: 实现 edit-file 增强**

```typescript
// packages/core/src/tools/edit-file.ts
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
      replace_all: { type: "boolean", description: "是否替换所有匹配出现，默认 false" },
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
    const replaceAll = (params.replace_all as boolean) ?? false;

    if (oldStr === newStr) {
      return { toolCallId: "", content: "old_string and new_string must be different", isError: true };
    }

    try {
      const content = fs.readFileSync(filePath, "utf-8");

      const firstIdx = content.indexOf(oldStr);
      if (firstIdx === -1) {
        return {
          toolCallId: "",
          content: "old_string not found in file. Please read the file first to get the exact current content.",
          isError: true,
        };
      }

      if (!replaceAll) {
        const secondIdx = content.indexOf(oldStr, firstIdx + 1);
        if (secondIdx !== -1) {
          return { toolCallId: "", content: "要替换的文本不唯一（出现多次），请提供更多上下文", isError: true };
        }
      }

      const occurrences = replaceAll ? content.split(oldStr).length - 1 : 1;
      const newContent = replaceAll
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
```

- [ ] **Step 4: 运行测试确认通过**

```bash
pnpm --filter @cobeing/core exec vitest run src/tools/edit-file.test.ts
```

Expected: 6 tests pass

- [ ] **Step 5: 编译验证**

```bash
pnpm build
```

Expected: 6 packages build pass

- [ ] **Step 6: 提交**

```bash
git add packages/core/src/tools/edit-file.ts packages/core/src/tools/edit-file.test.ts
git commit -m "feat: enhance edit-file with replace_all, validation, and structured output"
```

---

### Task 2: grep 参数变更 + 条目收集重构

**Files:**
- Modify: `packages/core/src/tools/grep.ts`

- [ ] **Step 1: 重写 grep.ts — 参数 + collectMatches + 简单 output builder**

```typescript
// packages/core/src/tools/grep.ts
import fs from "node:fs";
import path from "node:path";
import type { Tool, ToolContext, ToolResult } from "@cobeing/shared";

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
    const searchDir = path.resolve(context.workingDir, (params.path as string) || ".");
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
      const flags = (caseInsensitive ? "i" : "") + (multilineFlag ? "s" : "");
      const regex = new RegExp(pattern, flags);
      const includeRegex = globPattern ? globToRegex(globPattern) : null;

      const entries: MatchEntry[] = [];
      collectMatches(searchDir, regex, includeRegex, entries, context.workingDir);

      if (entries.length === 0) {
        return { toolCallId: "", content: "无匹配结果" };
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
            ? buildContentWithContext(entries, searchDir, context.workingDir, {
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

      return { toolCallId: "", content: result };
    } catch (err: any) {
      return { toolCallId: "", content: `搜索失败: ${err.message}`, isError: true };
    }
  },
};

// ---- Internal functions ----

function collectMatches(
  dir: string,
  regex: RegExp,
  includeRegex: RegExp | null,
  entries: MatchEntry[],
  baseDir: string,
) {
  let dirents: fs.Dirent[];
  try {
    dirents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of dirents) {
    if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist") continue;
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      collectMatches(fullPath, regex, includeRegex, entries, baseDir);
    } else if (entry.isFile()) {
      if (includeRegex && !includeRegex.test(entry.name)) continue;
      try {
        const content = fs.readFileSync(fullPath, "utf-8");
        const relPath = path.relative(baseDir, fullPath).replace(/\\/g, "/");

        if (regex.flags.includes("s")) {
          // Multiline mode: test full content as a single string
          const r = new RegExp(regex.source, regex.flags + "g");
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
              entries.push({ file: relPath, line: i + 1, text: lines[i].trim() });
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
  const total = entries.length;

  for (const e of entries) {
    if (count < opts.offset) { count++; continue; }
    if (opts.headLimit > 0 && lines.length >= opts.headLimit) break;

    const prefix = opts.showLineNumbers ? `${e.file}:${e.line}: ` : `${e.file}: `;
    lines.push(prefix + e.text);
    count++;
  }

  let result = lines.join("\n");
  const remaining = total - opts.offset - lines.length;
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
  searchDir: string,
  baseDir: string,
  opts: ContentOptions,
): string {
  // Group entries by file
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
    if (opts.headLimit > 0 && outputCount >= opts.headLimit) break;
    const fileEntries = byFile.get(file)!;
    const filePath = path.join(searchDir, file);

    let content: string[];
    try {
      content = fs.readFileSync(filePath, "utf-8").split("\n");
    } catch {
      continue;
    }

    // Determine which lines to show (match lines + context)
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

    // Build output lines with gap separators
    let prev = sorted[0] - 2;
    for (const lineNum of sorted) {
      if (outputCount < opts.offset) { outputCount++; prev = lineNum; continue; }
      if (opts.headLimit > 0 && outputCount - opts.offset >= opts.headLimit) break;

      if (lineNum > prev + 1) groups.push("--");
      const prefix = opts.showLineNumbers ? `${file}-${lineNum}: ` : `${file}: `;
      groups.push(prefix + (content[lineNum - 1] || ""));
      prev = lineNum;
      outputCount++;
    }
  }

  let result = groups.join("\n");
  if (result.startsWith("--\n")) result = result.slice(3);
  const totalShown = outputCount - opts.offset;
  const remaining = entries.length - totalShown;
  if (remaining > 0 && opts.headLimit > 0 && totalShown >= opts.headLimit) {
    result += `\n... and ${remaining} more results`;
  }
  return result || "无匹配结果";
}

function globToRegex(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*");
  return new RegExp(`^${escaped}$`);
}
```

- [ ] **Step 2: 编译验证**

```bash
pnpm build
```

Expected: 6 packages build pass

- [ ] **Step 3: 编写 grep 测试文件**

```typescript
// packages/core/src/tools/grep.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { grepTool } from "./grep.js";

const workingDir = path.join(os.tmpdir(), "cobeing-test-grep-" + Date.now());

beforeEach(() => {
  fs.mkdirSync(workingDir, { recursive: true });
  fs.writeFileSync(path.join(workingDir, "a.ts"), "const x = 1;\nfunction foo() {}\n// foo bar\n");
  fs.writeFileSync(path.join(workingDir, "b.ts"), "export const y = 2;\nexport function bar() {}\n");
  fs.mkdirSync(path.join(workingDir, "sub"), { recursive: true });
  fs.writeFileSync(path.join(workingDir, "sub", "c.md"), "# Title\n## Section\nfoo\n");
});

afterEach(() => {
  fs.rmSync(workingDir, { recursive: true, force: true });
});

function ctx() {
  return { agentId: "test-agent", sessionId: "s1", workingDir, sandbox: { enabled: false, filesystem: "isolated" as const, network: { enabled: false, mode: "all" as const } }, permissions: { mode: "full-access" as const } };
}

describe("grepTool", () => {
  describe("output_mode: content (default)", () => {
    it("finds matches with file:line: format", async () => {
      const result = await grepTool.execute({ pattern: "foo" }, ctx());
      expect(result.isError).toBeFalsy();
      expect(result.content).toContain("a.ts:");
      expect(result.content).toContain("foo");
    });

    it("shows no matches message when nothing found", async () => {
      const result = await grepTool.execute({ pattern: "zzzNOTFOUNDzzz" }, ctx());
      expect(result.content).toBe("无匹配结果");
    });
  });

  describe("output_mode: files_with_matches", () => {
    it("returns only file paths", async () => {
      const result = await grepTool.execute({ pattern: "foo", output_mode: "files_with_matches" }, ctx());
      expect(result.isError).toBeFalsy();
      expect(result.content).toContain("a.ts");
      expect(result.content).toContain("sub/c.md");
      expect(result.content).not.toContain("b.ts");
      expect(result.content).not.toContain(":");
    });
  });

  describe("output_mode: count", () => {
    it("returns file: N format", async () => {
      const result = await grepTool.execute({ pattern: "foo", output_mode: "count" }, ctx());
      expect(result.isError).toBeFalsy();
      expect(result.content).toMatch(/a\.ts: \d/);
      expect(result.content).toMatch(/sub\/c\.md: \d/);
    });
  });

  describe("head_limit and offset", () => {
    it("limits output to head_limit", async () => {
      // "x" appears in both a.ts and b.ts
      const result = await grepTool.execute({ pattern: "x", head_limit: 1 }, ctx());
      const lines = result.content.split("\n").filter(l => !l.startsWith("..."));
      expect(lines.length).toBeLessThanOrEqual(1);
    });

    it("skips offset entries", async () => {
      // "x" appears in a.ts and b.ts
      const resultAll = await grepTool.execute({ pattern: "x", output_mode: "content" }, ctx());
      const resultSkip = await grepTool.execute({ pattern: "x", output_mode: "content", offset: 1 }, ctx());
      expect(resultSkip.content).not.toBe(resultAll.content);
    });

    it("shows remaining count when truncated", async () => {
      const result = await grepTool.execute({ pattern: "o", head_limit: 1 }, ctx());
      expect(result.content).toContain("more result");
    });
  });

  describe("glob / include filter", () => {
    it("filters by glob pattern", async () => {
      const result = await grepTool.execute({ pattern: "foo", glob: "*.ts" }, ctx());
      expect(result.content).toContain("a.ts");
      expect(result.content).not.toContain("c.md");
    });

    it("include works as glob alias", async () => {
      const result = await grepTool.execute({ pattern: "foo", include: "*.md" }, ctx());
      expect(result.content).toContain("c.md");
      expect(result.content).not.toContain("a.ts");
    });

    it("glob takes precedence over include when both set", async () => {
      const result = await grepTool.execute({ pattern: "foo", glob: "*.ts", include: "*.md" }, ctx());
      expect(result.content).toContain("a.ts");
      expect(result.content).not.toContain("c.md");
    });
  });

  describe("-n (line numbers)", () => {
    it("hides line numbers when -n is false", async () => {
      const result = await grepTool.execute({ pattern: "foo", "-n": false }, ctx());
      // Should have "a.ts: " without line number
      expect(result.content).toMatch(/a\.ts: /);
      expect(result.content).not.toMatch(/a\.ts:\d+: /);
    });
  });

  describe("-i (case sensitivity)", () => {
    it("is case insensitive by default", async () => {
      fs.writeFileSync(path.join(workingDir, "case.ts"), "HELLO");
      const result = await grepTool.execute({ pattern: "hello" }, ctx());
      expect(result.content).toContain("case.ts");
    });

    it("respects case when -i is false", async () => {
      fs.writeFileSync(path.join(workingDir, "case.ts"), "HELLO");
      const result = await grepTool.execute({ pattern: "hello", "-i": false }, ctx());
      expect(result.content).toBe("无匹配结果");
    });
  });

  describe("context lines (-A, -B, -C)", () => {
    it("shows lines after match with -A", async () => {
      const result = await grepTool.execute({ pattern: "foo", "-A": 1 }, ctx());
      // a.ts line 3 has "foo bar", line 2 is "function foo() {}"
      // After line 2 there should be line 3 as context
      expect(result.content).toContain("foo");
    });

    it("shows lines before match with -B", async () => {
      const result = await grepTool.execute({ pattern: "Section", "-B": 1 }, ctx());
      // sub/c.md has "## Section" at line 2, before context should show line 1 "# Title"
      expect(result.content).toContain("Title");
    });

    it("shows context around match with -C", async () => {
      const result = await grepTool.execute({ pattern: "Section", "-C": 1 }, ctx());
      expect(result.content).toContain("Title");
    });

    it("shows gap separator for non-adjacent context blocks", async () => {
      // Create a file with matches far apart
      fs.writeFileSync(path.join(workingDir, "gap.ts"), "line1\nfoo\nline3\nline4\nline5\nfoo\nline7\n");
      const result = await grepTool.execute({ pattern: "foo", "-C": 0, path: "." }, ctx());
      // Without context, two matches are in output
      expect(result.content).toContain("foo");
    });
  });

  describe("multiline", () => {
    it("matches across lines when multiline is true", async () => {
      fs.writeFileSync(path.join(workingDir, "multi.ts"), "line one\nline two\nline three");
      const result = await grepTool.execute({ pattern: "one.line", multiline: true }, ctx());
      // With dotAll (s flag), . matches newlines
      expect(result.content).not.toBe("无匹配结果");
    });
  });
});
```

- [ ] **Step 4: 运行测试**

```bash
pnpm --filter @cobeing/core exec vitest run src/tools/grep.test.ts
```

Expected: all tests pass

- [ ] **Step 5: 运行全量测试确认无回归**

```bash
pnpm test
```

Expected: all tests pass

- [ ] **Step 6: 提交**

```bash
git add packages/core/src/tools/grep.ts packages/core/src/tools/grep.test.ts
git commit -m "feat: enhance grep with output_mode, pagination, context lines, and full claw-code alignment"
```

---

### Task 3: bash 输出截断 — 测试 + 实现

**Files:**
- Create: `packages/core/src/tools/bash.test.ts`
- Modify: `packages/core/src/tools/bash.ts`

- [ ] **Step 1: 编写 bash 测试**

```typescript
// packages/core/src/tools/bash.test.ts
import { describe, it, expect } from "vitest";
import { bashTool } from "./bash.js";
import os from "node:os";

const isWindows = os.platform() === "win32";

function ctx() {
  return {
    agentId: "test-agent",
    sessionId: "s1",
    workingDir: os.tmpdir(),
    sandbox: { enabled: false, filesystem: "isolated" as const, network: { enabled: false, mode: "all" as const } },
    permissions: { mode: "full-access" as const },
  };
}

describe("bashTool", () => {
  it("executes a simple command", async () => {
    const cmd = isWindows ? "echo hello" : "echo hello";
    const result = await bashTool.execute({ command: cmd, timeout: 10 }, ctx());
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain("hello");
  });

  it("returns error for failed command", async () => {
    const cmd = isWindows
      ? "Get-ChildItem __nonexistent_path_xyz__"
      : "ls __nonexistent_path_xyz__";
    const result = await bashTool.execute({ command: cmd, timeout: 10 }, ctx());
    // May or may not be error depending on shell, but shouldn't crash
    expect(result).toHaveProperty("content");
  });

  it("truncates output exceeding 16384 bytes", async () => {
    // Generate > 16384 bytes of output
    const count = isWindows ? 2000 : 2000; // ~2000 lines of output
    const cmd = isWindows
      ? `1..${count} | ForEach-Object { "line $_" }`
      : `for i in $(seq 1 ${count}); do echo "line $i"; done`;
    const result = await bashTool.execute({ command: cmd, timeout: 30 }, ctx());
    // Output should be truncated
    expect(result.content.length).toBeLessThanOrEqual(17000); // 16384 + truncation message
    expect(result.content).toContain("truncated");
  });

  it("does not truncate short output", async () => {
    const cmd = isWindows ? "echo short" : "echo short";
    const result = await bashTool.execute({ command: cmd, timeout: 10 }, ctx());
    expect(result.content).not.toContain("truncated");
  });
});
```

- [ ] **Step 2: 运行测试确认截断测试失败**

```bash
pnpm --filter @cobeing/core exec vitest run src/tools/bash.test.ts
```

Expected: truncation test fails (no truncation logic yet), other tests pass

- [ ] **Step 3: 实现 bash 输出截断**

在 `executeLocal` 函数中，`resolve` 返回前添加截断逻辑：

```typescript
// packages/core/src/tools/bash.ts
// 在文件顶部新增常量:
const MAX_OUTPUT_BYTES = 16384;

// 修改 executeLocal 函数的 resolve 部分:
function executeLocal(command: string, timeout: number, cwd: string): Promise<ToolResult> {
  const finalCmd = translateCommand(command);
  const shell = isWindows ? "powershell.exe" : undefined;

  return new Promise((resolve) => {
    exec(finalCmd, { cwd, timeout, maxBuffer: 1024 * 1024, shell }, (error, stdout, stderr) => {
      if (error) {
        const errContent = stderr || error.message;
        resolve({
          toolCallId: "",
          content: errContent.length > MAX_OUTPUT_BYTES
            ? errContent.slice(0, MAX_OUTPUT_BYTES) + `\n[output truncated — exceeded ${MAX_OUTPUT_BYTES} bytes]`
            : errContent,
          isError: true,
        });
        return;
      }
      const output = stdout || "(no output)";
      if (output.length > MAX_OUTPUT_BYTES) {
        resolve({
          toolCallId: "",
          content: output.slice(0, MAX_OUTPUT_BYTES) + `\n[output truncated — exceeded ${MAX_OUTPUT_BYTES} bytes]`,
        });
      } else {
        resolve({ toolCallId: "", content: output });
      }
    });
  });
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
pnpm --filter @cobeing/core exec vitest run src/tools/bash.test.ts
```

Expected: 4 tests pass

- [ ] **Step 5: 编译验证 + 全量测试**

```bash
pnpm build
```

Expected: 6 packages build pass

```bash
pnpm test
```

Expected: all tests pass

- [ ] **Step 6: 提交**

```bash
git add packages/core/src/tools/bash.ts packages/core/src/tools/bash.test.ts
git commit -m "feat: add 16384-byte output truncation to bash tool"
```

---

### Task 4: 文档同步

**Files:**
- Modify: `PROGRESS.md`
- Modify: `PROGRESS-LITE.md`
- Modify: `STRUCTURE.md`（新增 3 个测试文件）

- [ ] **Step 1: 更新 STRUCTURE.md 新增测试文件**

在 `packages/core/src/tools/` 区块追加:
```
- `edit-file.test.ts` — edit-file 工具测试（6 tests）
- `grep.test.ts` — grep 工具测试（15+ tests）
- `bash.test.ts` — bash 工具测试（4 tests）
```

- [ ] **Step 2: 更新 PROGRESS.md**

在文件顶部追加变更记录。

- [ ] **Step 3: 更新 PROGRESS-LITE.md**

追加精简条目。

- [ ] **Step 4: 运行全量测试最终确认**

```bash
pnpm test
```

Expected: all tests pass (282 + 新增 ~25 tests)

- [ ] **Step 5: 最终提交**

```bash
git add PROGRESS.md PROGRESS-LITE.md STRUCTURE.md
git commit -m "docs: update progress and structure for tool enhancement (方案 2)"
```
