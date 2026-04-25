import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ExperienceWriter } from "./experience.js";

describe("ExperienceWriter", () => {
  let tmpDir: string;
  let experiencePath: string;
  let writer: ExperienceWriter;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "exp-test-"));
    experiencePath = path.join(tmpDir, "EXPERIENCE.md");
    writer = new ExperienceWriter(experiencePath, {
      chat: async function* () {
        yield { type: "content", content: "问题: mock problem\n解决: mock solution" };
        yield { type: "done" };
      },
    } as any);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("初始化时创建 EXPERIENCE.md", () => {
    expect(fs.existsSync(experiencePath)).toBe(true);
    const content = fs.readFileSync(experiencePath, "utf-8");
    expect(content).toContain("EXPERIENCE.md");
  });

  it("手动追加经验条目", () => {
    writer.append({
      task: "修复内存泄漏",
      problem: "EventEmitter 未取消订阅",
      solution: "在 dispose 中调用 removeAllListeners",
    });

    const content = fs.readFileSync(experiencePath, "utf-8");
    expect(content).toContain("修复内存泄漏");
    expect(content).toContain("EventEmitter 未取消订阅");
    expect(content).toContain("removeAllListeners");
  });

  it("追加多条经验保持格式", () => {
    writer.append({ task: "任务A", problem: "问题A", solution: "方案A" });
    writer.append({ task: "任务B", problem: "问题B", solution: "方案B" });

    const content = fs.readFileSync(experiencePath, "utf-8");
    expect(content).toContain("任务A");
    expect(content).toContain("任务B");
  });

  it("reflect 通过 LLM 总结对话生成经验", async () => {
    const conversation = [
      { role: "user", content: "帮我修复这个 TypeScript 编译错误" },
      { role: "assistant", content: "我发现类型定义不匹配" },
      { role: "tool", content: "已修改 interface 定义" },
      { role: "assistant", content: "编译通过了" },
    ];

    await writer.reflect("修复TS编译错误", conversation);

    const content = fs.readFileSync(experiencePath, "utf-8");
    expect(content).toContain("mock problem");
    expect(content).toContain("mock solution");
  });

  it("search 检索相关经验", () => {
    writer.append({ task: "React hooks 优化", problem: "useEffect 无限循环", solution: "添加正确的依赖数组" });
    writer.append({ task: "数据库查询优化", problem: "N+1 查询", solution: "使用 DataLoader 批量加载" });

    const results = writer.search("React hooks");
    expect(results).toHaveLength(1);
    expect(results[0]).toContain("useEffect 无限循环");

    const noResults = writer.search("Python");
    expect(noResults).toHaveLength(0);
  });

  it("读取全部经验内容", () => {
    writer.append({ task: "T1", problem: "P1", solution: "S1" });
    writer.append({ task: "T2", problem: "P2", solution: "S2" });

    const all = writer.readAll();
    expect(all).toContain("T1");
    expect(all).toContain("T2");
  });
});
