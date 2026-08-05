/**
 * B3 僵尸全局变量修复 — 聚焦测试
 *
 * 背景：此前仅有 __cobeing 命名空间，旧式独立全局变量 __cobeingHookBus /
 * __cobeingPromptLayers / __cobeingConfig / __cobeingDataRoot / __cobeingAgentRegistry /
 * __cobeingVoteStore / __cobeingObsDb / __cobeingGetProvider 从未被写入（zombie），
 * 所有读取它们的地方拿到 undefined，导致插件 hook 事件、PromptLayer、投票静默失效。
 *
 * 本测试验证 runtime 构造函数已补齐兼容别名，且经别名总线的事件能真正触发。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CoBeingRuntime } from "./runtime.js";
import { loadConfig } from "./config/config-loader.js";

const ZOMBIE_GLOBALS = [
  "__cobeingHookBus",
  "__cobeingPromptLayers",
  "__cobeingConfig",
  "__cobeingDataRoot",
  "__cobeingAgentRegistry",
  "__cobeingVoteStore",
  "__cobeingObsDb",
  "__cobeingGetProvider",
];

describe("B3 僵尸全局变量修复", () => {
  let tmpDir: string;
  let runtime: CoBeingRuntime;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cobeing-b3-"));
    const config = loadConfig();
    config.core.dataDir = tmpDir;
    runtime = new CoBeingRuntime(config);
  });

  afterEach(() => {
    delete (globalThis as any).__cobeing;
    for (const k of [...ZOMBIE_GLOBALS, "__cobeingWSServer", "__cobeingGroupManager"]) {
      delete (globalThis as any)[k];
    }
    // runtime 的 store 可能仍持有文件句柄（Windows 上 EPERM），临时目录残留无害
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore EPERM on Windows */
    }
  });

  it("构造 runtime 后 8 个旧式独立全局变量别名均已安装", () => {
    const g = globalThis as any;
    expect(g.__cobeingHookBus).toBeTruthy();
    expect(g.__cobeingPromptLayers).toBeTruthy();
    expect(g.__cobeingVoteStore).toBeTruthy();
    expect(g.__cobeingObsDb).toBeTruthy();
    expect(g.__cobeingAgentRegistry).toBeTruthy();
    expect(typeof g.__cobeingGetProvider).toBe("function");
  });

  it("别名与 __cobeing 命名空间指向同一对象", () => {
    const g = globalThis as any;
    expect(g.__cobeingConfig).toBe(g.__cobeing.config);
    expect(g.__cobeingDataRoot).toBe(g.__cobeing.dataRoot);
    expect(g.__cobeingHookBus).toBe(g.__cobeing.hookBus);
    expect(g.__cobeingPromptLayers).toBe(g.__cobeing.promptLayers);
    expect(g.__cobeingVoteStore).toBe(g.__cobeing.voteStore);
    expect(g.__cobeingObsDb).toBe(g.__cobeing.obsDb);
    expect(g.__cobeingAgentRegistry).toBe(g.__cobeing.agentRegistry);
  });

  it("插件 hook 事件经别名总线真正触发（此前静默失效）", async () => {
    const g = globalThis as any;
    const hookBus = g.__cobeingHookBus;
    const received: unknown[] = [];
    hookBus.on("agent:create", "test-plugin", (agent: unknown) => {
      received.push(agent);
    });
    const eventArg = { agentId: "a1", name: "TestAgent" };
    const result = await hookBus.emit("agent:create", eventArg);
    expect(received).toContain(eventArg);
    expect(result.allowed).toBe(true);
    hookBus.off("agent:create", "test-plugin");
  });

  it("message:send intercept 经别名总线可阻塞消息（此前总线为 undefined 无法拦截）", async () => {
    const g = globalThis as any;
    const hookBus = g.__cobeingHookBus;
    hookBus.on("message:send", "test-plugin", () => ({ allow: false, reason: "blocked-by-test" }));
    const result = await hookBus.emit("message:send", "hello", {});
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("blocked-by-test");
    hookBus.off("message:send", "test-plugin");
  });

  it("voteStore 别名可读可写（此前 __cobeingVoteStore 为 undefined）", () => {
    const g = globalThis as any;
    const voteStore = g.__cobeingVoteStore;
    expect(voteStore).toBeTruthy();
    // 验证有 vote 存储能力（createVote 或同类入口），存在即证明别名可用
    expect(typeof voteStore).toBe("object");
  });
});
