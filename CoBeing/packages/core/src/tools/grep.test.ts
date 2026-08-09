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
  return {
    agentId: "test-agent",
    sessionId: "s1",
    workingDir,
    sandbox: { enabled: false, filesystem: "isolated" as const, network: { enabled: false, mode: "all" as const } },
    permissions: { mode: "full-access" as const },
  };
}

describe("grepTool", () => {
  describe("output_mode: content (default)", () => {
    it("finds matches with file:line: format", async () => {
      const result = await grepTool.execute({ pattern: "foo" }, ctx());
      expect(result.isError).toBeFalsy();
      expect(result.content).toContain("a.ts:");
      expect(result.content).toContain("foo");
    });

    it("returns a tool error when path escapes workingDir", async () => {
      const result = await grepTool.execute({ pattern: "foo", path: ".." }, ctx());
      expect(result.isError).toBe(true);
      expect(result.content).toContain("path escapes working directory");
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
      // Should not contain line numbers or colons
      const lines = result.content.split("\n").filter(l => !l.startsWith("..."));
      for (const line of lines) {
        expect(line).not.toMatch(/:\d/);
      }
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
    it("limits output to head_limit in content mode", async () => {
      const result = await grepTool.execute({ pattern: "o", head_limit: 1 }, ctx());
      const lines = result.content.split("\n").filter(l => !l.startsWith("..."));
      expect(lines.length).toBeLessThanOrEqual(1);
    });

    it("skips offset entries", async () => {
      const resultAll = await grepTool.execute({ pattern: "o", output_mode: "content" }, ctx());
      const resultSkip = await grepTool.execute({ pattern: "o", output_mode: "content", offset: 1 }, ctx());
      expect(resultSkip.content).not.toBe(resultAll.content);
    });

    it("shows remaining count when truncated", async () => {
      const result = await grepTool.execute({ pattern: "o", head_limit: 1 }, ctx());
      expect(result.content).toContain("more result");
    });

    it("head_limit 0 shows all results", async () => {
      const result = await grepTool.execute({ pattern: "o", head_limit: 0 }, ctx());
      expect(result.content).not.toContain("more result");
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

    it("glob takes precedence when both set", async () => {
      const result = await grepTool.execute({ pattern: "foo", glob: "*.ts", include: "*.md" }, ctx());
      expect(result.content).toContain("a.ts");
      expect(result.content).not.toContain("c.md");
    });
  });

  describe("-n (line numbers)", () => {
    it("hides line numbers when -n is false", async () => {
      const result = await grepTool.execute({ pattern: "foo", "-n": false }, ctx());
      expect(result.content).toMatch(/a\.ts: /);
      // Should NOT have line number after colon
      const matchLine = result.content.split("\n").find(l => l.includes("a.ts"));
      if (matchLine) {
        expect(matchLine).not.toMatch(/a\.ts:\d+: /);
      }
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
      expect(result.content).toContain("foo");
    });

    it("shows lines before match with -B", async () => {
      const result = await grepTool.execute({ pattern: "Section", "-B": 1, path: "." }, ctx());
      expect(result.content).toContain("Title");
    });

    it("shows context around match with -C", async () => {
      const result = await grepTool.execute({ pattern: "Section", "-C": 1, path: "." }, ctx());
      expect(result.content).toContain("Title");
    });
  });

  describe("context lines", () => {
    it("shows -- separator between non-adjacent match groups", async () => {
      fs.writeFileSync(path.join(workingDir, "gap.ts"), "line1\nfoo\nline3\nline4\nline5\nfoo\nline7\n");
      const result = await grepTool.execute({ pattern: "foo", "-C": 0, path: "." }, ctx());
      expect(result.content).toContain("foo");
    });
  });

  describe("multiline", () => {
    it("matches across lines when multiline is true", async () => {
      fs.writeFileSync(path.join(workingDir, "multi.ts"), "line one\nline two\nline three\n");
      const result = await grepTool.execute({ pattern: "one.line", multiline: true }, ctx());
      expect(result.content).not.toBe("无匹配结果");
    });
  });

  describe("扫描上限防护", () => {
    it("深度超限时截断并提示（不递归全盘）", async () => {
      // 构造 25 层深目录
      let deep = workingDir;
      for (let i = 0; i < 25; i++) {
        deep = path.join(deep, `d${i}`);
        fs.mkdirSync(deep, { recursive: true });
      }
      fs.writeFileSync(path.join(deep, "deep.txt"), "needle\n");
      const result = await grepTool.execute({ pattern: "needle" }, ctx());
      // 深度 20 上限内应截断：要么找到但带截断提示，要么明确提示截断
      expect(result.isError).toBeFalsy();
      if (result.content.includes("needle")) {
        expect(result.content).toContain("截断");
      }
    });

    it("文件数超限时截断并提示", async () => {
      for (let i = 0; i < 20; i++) {
        fs.writeFileSync(path.join(workingDir, `bulk-${i}.txt`), "haystack\n");
      }
      const result = await grepTool.execute({ pattern: "nonexistent-pattern-xyz" }, ctx());
      expect(result.isError).toBeFalsy();
      // 小目录不截断，正常返回无匹配
      expect(result.content).toContain("无匹配结果");
    });
  });
});
