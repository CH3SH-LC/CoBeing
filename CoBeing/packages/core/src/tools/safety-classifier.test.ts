import { describe, it, expect } from "vitest";
import { SafetyClassifier } from "./safety-classifier.js";
import type { LLMProvider } from "@cobeing/providers";

function mockProvider(verdict: "allow" | "deny" | "ask" = "allow", reason = "mock"): LLMProvider & { calls: () => number } {
  let n = 0;
  const provider: any = {
    id: "mock", name: "mock",
    chat: async function* () {
      n++;
      yield { type: "content", content: JSON.stringify({ verdict, reason }) };
    },
    chatComplete: async () => JSON.stringify({ verdict, reason }),
    listModels: async () => [],
    capabilities: () => ({ tools: false, vision: false, streaming: true, maxTokens: 4096, contextWindow: 128000 }),
  };
  return Object.assign(provider, { calls: () => n });
}

const input = {
  toolName: "bash",
  paramsSummary: '{"command":"npm install"}',
  agentId: "agent-a",
  workingDir: "/tmp",
};

describe("SafetyClassifier (决策 #10 / spec #5)", () => {
  it("classifies allow when model says allow", async () => {
    const c = new SafetyClassifier(mockProvider("allow"));
    const r = await c.classify(input);
    expect(r.verdict).toBe("allow");
  });

  it("classifies deny when model says deny", async () => {
    const c = new SafetyClassifier(mockProvider("deny"));
    const r = await c.classify(input);
    expect(r.verdict).toBe("deny");
  });

  it("caches allow for identical input (no extra provider call)", async () => {
    const p = mockProvider("allow");
    const c = new SafetyClassifier(p);
    await c.classify(input);
    await c.classify(input);
    expect(p.calls()).toBe(1);
  });

  it("does not cache deny (reclassifies each time)", async () => {
    const p = mockProvider("deny");
    const c = new SafetyClassifier(p);
    await c.classify(input);
    await c.classify(input);
    expect(p.calls()).toBe(2);
  });

  it("trips circuit after consecutive denies → fail-closed deny without provider call", async () => {
    const p = mockProvider("deny");
    const c = new SafetyClassifier(p, undefined, 3, 20); // 连续 3 次 deny 熔断
    for (let i = 0; i < 3; i++) {
      expect((await c.classify(input)).verdict).toBe("deny");
    }
    const before = p.calls();
    const r = await c.classify(input);
    expect(r.verdict).toBe("deny");
    expect(r.reason).toContain("熔断");
    expect(p.calls()).toBe(before); // 熔断后不再调 provider
  });

  it("fails closed when no provider is available", async () => {
    // 全局无 provider、构造也未注入 → fail-closed deny
    const prev = (globalThis as any).__cobeing;
    (globalThis as any).__cobeing = undefined;
    (globalThis as any).__cobeingGetProvider = undefined;
    const c = new SafetyClassifier();
    const r = await c.classify(input);
    expect(r.verdict).toBe("deny");
    expect(r.reason).toContain("fail-closed");
    (globalThis as any).__cobeing = prev;
    (globalThis as any).__cobeingGetProvider = undefined;
  });

  it("denies when output is not valid JSON (fail-closed on parse failure)", async () => {
    const p: any = {
      id: "mock", name: "mock",
      chat: async function* () { yield { type: "content", content: "I think it's fine" }; },
      chatComplete: async () => "I think it's fine",
      listModels: async () => [],
      capabilities: () => ({ tools: false, vision: false, streaming: true, maxTokens: 4096, contextWindow: 128000 }),
    };
    const c = new SafetyClassifier(p);
    const r = await c.classify(input);
    expect(r.verdict).toBe("deny");
  });
});
