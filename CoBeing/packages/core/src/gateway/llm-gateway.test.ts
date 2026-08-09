import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LLMGateway, chatWithGateway, chatCompleteWithGateway } from "./llm-gateway.js";
import type { ChatParams, ChatChunk } from "@cobeing/shared";

/**
 * 构造一个"非惰性" mock provider：chat() 调用时立即执行体逻辑（真实 provider 的
 * chat() 通常是普通 async 函数，流式内容从返回的 AsyncIterable 上消费）——
 * 这样 gateway 的并发/重试语义（覆盖"获取 iterable"阶段）才能被真实测到。
 */
function makeProvider(overrides: {
  chatImpl?: (params: ChatParams) => Promise<AsyncIterable<ChatChunk>>;
  chatCompleteImpl?: (params: ChatParams) => Promise<unknown>;
}) {
  const chatImpl = overrides.chatImpl ?? (async (_p: ChatParams) => ({
    [Symbol.asyncIterator]() {
      let done = false;
      return {
        next: async () => done ? { done: true, value: undefined } : (done = true, { done: false, value: { type: "content", content: "ok" } as ChatChunk }),
        return: async () => ({ done: true, value: undefined }),
      };
    },
  }));
  return {
    chat: chatImpl,
    chatComplete: overrides.chatCompleteImpl ?? (async (_p: ChatParams) => "complete-ok"),
  } as any;
}

const g = globalThis as any;

describe("LLMGateway", () => {
  const saved = g.__cobeing;

  beforeEach(() => {
    g.__cobeing = {};
  });

  afterEach(() => {
    if (saved === undefined) delete g.__cobeing;
    else g.__cobeing = saved;
  });

  it("chat 排队执行并返回流式结果（无全局 gateway 时直调降级）", async () => {
    const provider = makeProvider({});
    const gateway = new LLMGateway({ maxConcurrency: 1, rpmLimit: 1000 });
    const iterable = await gateway.chat(provider, { model: "m", messages: [] });
    const chunks: string[] = [];
    for await (const c of iterable) {
      if (c.type === "content" && c.content) chunks.push(c.content);
    }
    expect(chunks).toEqual(["ok"]);
  });

  it("chatComplete 排队执行并返回结果", async () => {
    const provider = makeProvider({ chatCompleteImpl: async () => ({ content: "done" }) });
    const gateway = new LLMGateway({ maxConcurrency: 1, rpmLimit: 1000 });
    const result = await gateway.chatComplete(provider, { model: "m", messages: [] });
    expect(result).toEqual({ content: "done" });
  });

  it("并发超限时排队（maxConcurrency=1 时第二个请求等待第一个完成）", async () => {
    let active = 0;
    let maxActive = 0;
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const slowProvider = makeProvider({
      chatImpl: async (_p: ChatParams) => {
        active++;
        maxActive = Math.max(maxActive, active);
        await gate;
        active--;
        return {
          [Symbol.asyncIterator]() {
            let done = false;
            return {
              next: async () => done ? { done: true, value: undefined } : (done = true, { done: false, value: { type: "content", content: "a" } as ChatChunk }),
              return: async () => ({ done: true, value: undefined }),
            };
          },
        };
      },
    });
    const gateway = new LLMGateway({ maxConcurrency: 1, rpmLimit: 1000 });
    const p1 = gateway.chat(slowProvider, { model: "m", messages: [] });
    const p2 = gateway.chat(slowProvider, { model: "m", messages: [] });
    // 让第一个请求进入执行，第二个应排队
    await new Promise(r => setTimeout(r, 20));
    expect(maxActive).toBe(1);
    release();
    const [it1, it2] = await Promise.all([p1, p2]);
    const drain = async (it: AsyncIterable<ChatChunk>) => { for await (const _ of it) { /* drain */ } };
    await Promise.all([drain(it1), drain(it2)]);
    expect(maxActive).toBe(1);
  });

  it("失败时按 retryAttempts 重试，最终成功", async () => {
    let calls = 0;
    const flakyProvider = makeProvider({
      chatImpl: async (_p: ChatParams) => {
        calls++;
        if (calls < 3) throw new Error("network hiccup");
        return {
          [Symbol.asyncIterator]() {
            let done = false;
            return {
              next: async () => done ? { done: true, value: undefined } : (done = true, { done: false, value: { type: "content", content: "recovered" } as ChatChunk }),
              return: async () => ({ done: true, value: undefined }),
            };
          },
        };
      },
    });
    const gateway = new LLMGateway({ maxConcurrency: 1, rpmLimit: 1000, retryAttempts: 3 });
    const iterable = await gateway.chat(flakyProvider, { model: "m", messages: [] });
    const chunks: string[] = [];
    for await (const c of iterable) {
      if (c.type === "content" && c.content) chunks.push(c.content);
    }
    expect(chunks).toEqual(["recovered"]);
    expect(calls).toBe(3);
  });

  it("重试耗尽后 reject", async () => {
    const failProvider = makeProvider({
      chatImpl: async () => { throw new Error("always fails"); },
    });
    const gateway = new LLMGateway({ maxConcurrency: 1, rpmLimit: 1000, retryAttempts: 2 });
    await expect(gateway.chat(failProvider, { model: "m", messages: [] })).rejects.toThrow("always fails");
  });

  it("RPM 计数随请求增长（getCurrentRpm 记录窗口内请求数）", async () => {
    const provider = makeProvider({});
    const gateway = new LLMGateway({ maxConcurrency: 2, rpmLimit: 1000 });
    expect(gateway.getStatus().currentRpm).toBe(0);
    const it1 = await gateway.chat(provider, { model: "m", messages: [] });
    for await (const _ of it1) { /* drain */ }
    expect(gateway.getStatus().currentRpm).toBe(1);
    const it2 = await gateway.chat(provider, { model: "m", messages: [] });
    for await (const _ of it2) { /* drain */ }
    expect(gateway.getStatus().currentRpm).toBe(2);
  });

  it("chatWithGateway：无全局 gateway 时直接调用 provider", async () => {
    const provider = makeProvider({});
    const iterable = await chatWithGateway(provider, { model: "m", messages: [] });
    const chunks: string[] = [];
    for await (const c of iterable) {
      if (c.type === "content" && c.content) chunks.push(c.content);
    }
    expect(chunks).toEqual(["ok"]);
  });

  it("chatWithGateway：有全局 gateway 时经 gateway 调用", async () => {
    const provider = makeProvider({});
    const gateway = new LLMGateway({ maxConcurrency: 1, rpmLimit: 1000 });
    g.__cobeing.gateway = gateway;
    const statusSpy = vi.spyOn(gateway, "chat");
    const iterable = await chatWithGateway(provider, { model: "m", messages: [] });
    for await (const _ of iterable) { /* drain */ }
    expect(statusSpy).toHaveBeenCalledWith(provider, expect.objectContaining({ model: "m" }));
  });

  it("chatCompleteWithGateway：无全局 gateway 时直调，有则经 gateway", async () => {
    const provider = makeProvider({ chatCompleteImpl: async () => "raw" });
    expect(await chatCompleteWithGateway<string>(provider, { model: "m", messages: [] })).toBe("raw");
    const gateway = new LLMGateway({ maxConcurrency: 1, rpmLimit: 1000 });
    g.__cobeing.gateway = gateway;
    const spy = vi.spyOn(gateway, "chatComplete");
    expect(await chatCompleteWithGateway<string>(provider, { model: "m", messages: [] })).toBe("raw");
    expect(spy).toHaveBeenCalled();
  });

  it("getStatus 返回并发/队列/RPM 状态", async () => {
    const provider = makeProvider({});
    const gateway = new LLMGateway({ maxConcurrency: 2, rpmLimit: 1000 });
    const status = gateway.getStatus();
    expect(status).toHaveProperty("activeCount");
    expect(status).toHaveProperty("queueLength");
    expect(status).toHaveProperty("currentRpm");
    expect(status.activeCount).toBe(0);
    expect(status.queueLength).toBe(0);
  });
});
