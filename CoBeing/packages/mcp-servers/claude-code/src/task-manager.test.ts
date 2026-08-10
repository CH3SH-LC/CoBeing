/**
 * ClaudeCodeTaskManager 单元测试 — 状态机 + working_dir fail-fast + 取消 + 轮询
 *
 * 用 FakeRunner 注入，不触碰真实 SDK / 真实 Claude Code。
 */
import { describe, it, expect, vi } from "vitest";
import { ClaudeCodeTaskManager } from "./task-manager.js";
import type {
  ClaudeCodeRunOptions,
  ClaudeCodeRunResult,
  ClaudeCodeRunner,
} from "./types.js";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---- FakeRunner ----

class FakeRunner implements ClaudeCodeRunner {
  calls: ClaudeCodeRunOptions[] = [];
  behavior: "complete" | "fail" | "hang" = "complete";
  delayMs = 0;
  resultText = "done";
  errorText = "boom";
  sessionId = "fake-session";
  totalCostUsd = 0.5;

  async run(options: ClaudeCodeRunOptions): Promise<ClaudeCodeRunResult> {
    this.calls.push(options);
    options.onOutput?.("line1");
    options.onOutput?.("line2");
    if (this.delayMs > 0) await sleep(this.delayMs);

    if (this.behavior === "fail") {
      return { state: "failed", error: this.errorText, sessionId: this.sessionId };
    }
    if (this.behavior === "hang") {
      // 监听 abort，取消时以 cancelled 收尾
      return new Promise<ClaudeCodeRunResult>((resolve) => {
        options.signal?.addEventListener("abort", () =>
          resolve({ state: "cancelled", sessionId: this.sessionId }),
        );
      });
    }
    return {
      state: "completed",
      result: this.resultText,
      sessionId: this.sessionId,
      totalCostUsd: this.totalCostUsd,
    };
  }
}

// ---- helpers ----

const TMP = process.cwd(); // 用当前目录作为"存在的目录"

function makeManager(fake: FakeRunner) {
  return new ClaudeCodeTaskManager(fake, { pollIntervalMs: 5 });
}

async function settle(ms = 30) {
  await sleep(ms);
}

// ================================================================
//  1. start 校验：working_dir fail-fast
// ================================================================

describe("start 校验 (working_dir fail-fast)", () => {
  it("缺少 workingDir 时拒绝", () => {
    const fake = new FakeRunner();
    const mgr = makeManager(fake);
    const r = mgr.start({ prompt: "修复 bug" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("工作目录");
  });

  it("workingDir 为空字符串时拒绝", () => {
    const mgr = makeManager(new FakeRunner());
    const r = mgr.start({ workingDir: "", prompt: "修复 bug" });
    expect(r.ok).toBe(false);
  });

  it("workingDir 为相对路径时拒绝", () => {
    const mgr = makeManager(new FakeRunner());
    const r = mgr.start({ workingDir: "relative/dir", prompt: "x" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("绝对");
  });

  it("workingDir 不存在时拒绝", () => {
    const mgr = makeManager(new FakeRunner());
    const r = mgr.start({ workingDir: "Z:/definitely-not-exist-xyz/", prompt: "x" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("不存在");
  });

  it("缺少 prompt 时拒绝", () => {
    const mgr = makeManager(new FakeRunner());
    const r = mgr.start({ workingDir: TMP });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("提示词");
  });

  it("合法入参返回 taskId 且不产生 fake 调用之外的副作用", () => {
    const fake = new FakeRunner();
    const mgr = makeManager(fake);
    const r = mgr.start({ workingDir: TMP, prompt: "写一个脚本" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(typeof r.taskId).toBe("string");
  });

  it("maxTurns / maxBudgetUsd 为负时拒绝", () => {
    const mgr = makeManager(new FakeRunner());
    expect(mgr.start({ workingDir: TMP, prompt: "x", maxTurns: -1 }).ok).toBe(false);
    expect(mgr.start({ workingDir: TMP, prompt: "x", maxBudgetUsd: -0.5 }).ok).toBe(false);
  });
});

// ================================================================
//  2. 状态机
// ================================================================

describe("状态机", () => {
  it("start 后状态为 running，且字段透传", async () => {
    const fake = new FakeRunner();
    const mgr = makeManager(fake);
    const r = mgr.start({ workingDir: TMP, prompt: "修复", model: "claude-sonnet-5", maxTurns: 10, maxBudgetUsd: 1.5 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const rec = mgr.status(r.taskId)!;
    expect(rec.state).toBe("running");
    expect(rec.cwd).toBe(TMP);
    expect(rec.prompt).toBe("修复");
    expect(rec.model).toBe("claude-sonnet-5");
    expect(rec.maxTurns).toBe(10);
    expect(rec.maxBudgetUsd).toBe(1.5);
    expect(fake.calls[0].cwd).toBe(TMP);
    expect(fake.calls[0].maxTurns).toBe(10);
    expect(fake.calls[0].maxBudgetUsd).toBe(1.5);
    expect(fake.calls[0].model).toBe("claude-sonnet-5");
  });

  it("完成后状态变为 completed，result 与 sessionId 记录", async () => {
    const fake = new FakeRunner();
    const mgr = makeManager(fake);
    const r = mgr.start({ workingDir: TMP, prompt: "修复" });
    if (!r.ok) return;
    await settle();
    const rec = mgr.status(r.taskId)!;
    expect(rec.state).toBe("completed");
    expect(rec.result).toBe("done");
    expect(rec.sessionId).toBe("fake-session");
    expect(rec.totalCostUsd).toBe(0.5);
  });

  it("失败后状态变为 failed，error 记录", async () => {
    const fake = new FakeRunner();
    fake.behavior = "fail";
    const mgr = makeManager(fake);
    const r = mgr.start({ workingDir: TMP, prompt: "x" });
    if (!r.ok) return;
    await settle();
    const rec = mgr.status(r.taskId)!;
    expect(rec.state).toBe("failed");
    expect(rec.error).toBe("boom");
  });

  it("runner 抛异常时记为 failed（未取消场景）", async () => {
    const fake = new FakeRunner();
    fake.behavior = "fail";
    const mgr = makeManager(fake);
    // 让 fake 直接 reject：临时替换
    const orig = fake.run.bind(fake);
    fake.run = async (o) => { throw new Error("crash"); void o; };
    const r = mgr.start({ workingDir: TMP, prompt: "x" });
    if (!r.ok) return;
    await settle();
    const rec = mgr.status(r.taskId)!;
    expect(rec.state).toBe("failed");
    expect(rec.error).toContain("crash");
    fake.run = orig;
  });

  it("onOutput 增量累积到 output，读取时拼接", async () => {
    const mgr = makeManager(new FakeRunner());
    const r = mgr.start({ workingDir: TMP, prompt: "x" });
    if (!r.ok) return;
    await settle();
    const rec = mgr.status(r.taskId)!;
    expect(rec.output.join("")).toBe("line1line2");
  });
});

// ================================================================
//  3. 取消
// ================================================================

describe("取消", () => {
  it("cancel 运行中任务 → 状态 cancelled，signal 被触发", async () => {
    const fake = new FakeRunner();
    fake.behavior = "hang";
    const mgr = makeManager(fake);
    const r = mgr.start({ workingDir: TMP, prompt: "x" });
    if (!r.ok) return;
    const cancel = mgr.cancel(r.taskId);
    expect(cancel.ok).toBe(true);
    await settle();
    const rec = mgr.status(r.taskId)!;
    expect(rec.state).toBe("cancelled");
    // hang runner 在 abort 时返回 cancelled，不会被 completed 覆盖
    expect(fake.calls[0].signal?.aborted).toBe(true);
  });

  it("cancel 已结束任务 → 返回错误", async () => {
    const fake = new FakeRunner();
    const mgr = makeManager(fake);
    const r = mgr.start({ workingDir: TMP, prompt: "x" });
    if (!r.ok) return;
    await settle();
    const cancel = mgr.cancel(r.taskId);
    expect(cancel.ok).toBe(false);
  });

  it("cancel 未知任务 → 返回错误", () => {
    const mgr = makeManager(new FakeRunner());
    expect(mgr.cancel("nope").ok).toBe(false);
  });

  it("cancel 后 runner 才完成，不覆盖 cancelled 状态", async () => {
    const fake = new FakeRunner();
    fake.behavior = "hang";
    const mgr = makeManager(fake);
    const r = mgr.start({ workingDir: TMP, prompt: "x" });
    if (!r.ok) return;
    mgr.cancel(r.taskId);
    await settle();
    expect(mgr.status(r.taskId)!.state).toBe("cancelled");
  });
});

// ================================================================
//  4. result 轮询
// ================================================================

describe("result 轮询", () => {
  it("已完成任务走快路径立即返回", async () => {
    const fake = new FakeRunner();
    const mgr = makeManager(fake);
    const r = mgr.start({ workingDir: TMP, prompt: "x" });
    if (!r.ok) return;
    await settle();
    const rec = await mgr.result(r.taskId, 1000);
    expect(rec!.state).toBe("completed");
  });

  it("慢任务在超时窗口内等到完成", async () => {
    const fake = new FakeRunner();
    fake.delayMs = 40;
    const mgr = makeManager(fake);
    const r = mgr.start({ workingDir: TMP, prompt: "x" });
    if (!r.ok) return;
    const rec = await mgr.result(r.taskId, 1000);
    expect(rec!.state).toBe("completed");
  });

  it("超时后返回 running 记录（不抛错）", async () => {
    const fake = new FakeRunner();
    fake.delayMs = 2000;
    const mgr = makeManager(fake);
    const r = mgr.start({ workingDir: TMP, prompt: "x" });
    if (!r.ok) return;
    const rec = await mgr.result(r.taskId, 30);
    expect(rec!.state).toBe("running");
  });

  it("未知任务返回 undefined", async () => {
    const mgr = makeManager(new FakeRunner());
    expect(await mgr.result("nope", 100)).toBeUndefined();
  });
});

// ================================================================
//  5. list & 未知 id
// ================================================================

describe("list & 未知 id", () => {
  it("list 返回全部任务记录", async () => {
    const mgr = makeManager(new FakeRunner());
    const a = mgr.start({ workingDir: TMP, prompt: "a" });
    const b = mgr.start({ workingDir: TMP, prompt: "b" });
    if (!a.ok || !b.ok) return;
    const list = mgr.list();
    expect(list.length).toBe(2);
  });

  it("status 未知任务返回 undefined", () => {
    const mgr = makeManager(new FakeRunner());
    expect(mgr.status("nope")).toBeUndefined();
  });
});

// ================================================================
//  6. 并发独立
// ================================================================

describe("并发独立", () => {
  it("两个任务一成一败，状态互不影响", async () => {
    const okRunner = new FakeRunner();
    const failRunner = new FakeRunner();
    failRunner.behavior = "fail";

    const mgrOk = makeManager(okRunner);
    const mgrFail = makeManager(failRunner);

    const ok = mgrOk.start({ workingDir: TMP, prompt: "ok" });
    const bad = mgrFail.start({ workingDir: TMP, prompt: "fail" });
    if (!ok.ok || !bad.ok) return;

    await settle();
    expect(mgrOk.status(ok.taskId)!.state).toBe("completed");
    expect(mgrFail.status(bad.taskId)!.state).toBe("failed");
  });
});

// ================================================================
//  7. 默认值（manager options）
// ================================================================

describe("默认值", () => {
  it("未传 maxBudgetUsd / maxTurns 时应用默认值", async () => {
    const fake = new FakeRunner();
    const mgr = new ClaudeCodeTaskManager(fake, {
      defaultMaxBudgetUsd: 2,
      defaultMaxTurns: 50,
      pollIntervalMs: 5,
    });
    const r = mgr.start({ workingDir: TMP, prompt: "x" });
    if (!r.ok) return;
    expect(fake.calls[0].maxBudgetUsd).toBe(2);
    expect(fake.calls[0].maxTurns).toBe(50);
  });
});
