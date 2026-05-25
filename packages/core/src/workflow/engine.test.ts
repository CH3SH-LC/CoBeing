import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { WorkflowEngine } from "./engine.js";

describe("WorkflowEngine", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("analyze 返回任务分析结果", async () => {
    const engine = new WorkflowEngine({
      provider: {
        chat: async function* () {
          yield { type: "content", content: "需要前端开发（React, TypeScript）和后端开发（Node.js, 数据库）两种 Agent。" };
          yield { type: "done" };
        },
      } as any,
    });

    const analysis = await engine.analyze("开发一个全栈 Web 应用");
    expect(analysis).toBeDefined();
    expect(analysis).toContain("前端开发");
  });

  it("plan 返回执行步骤列表", async () => {
    const engine = new WorkflowEngine({
      provider: {
        chat: async function* () {
          yield { type: "content", content: "1. 创建前端 Agent\n2. 创建后端 Agent\n3. 组建开发群组\n4. 分配任务" };
          yield { type: "done" };
        },
      } as any,
    });

    const steps = await engine.plan("开发 Web 应用", "需要前端和后端开发");
    expect(steps).toBeDefined();
    expect(steps.length).toBeGreaterThan(0);
  });

  it("无 provider 时 analyze 返回错误", async () => {
    const engine = new WorkflowEngine({});
    const result = await engine.analyze("test");
    expect(result).toContain("Error");
  });
});
