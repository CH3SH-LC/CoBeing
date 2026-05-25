import { describe, it, expect } from "vitest";
import { AgentRegistry } from "./registry.js";
import { GroupManager } from "../group/manager.js";
import { ButlerAgent } from "./butler.js";
import type { LLMProvider } from "@cobeing/providers";

const mockProvider: LLMProvider = {
  id: "mock", name: "mock",
  chat: async function* () { yield { type: "content", content: "ok" }; },
  chatComplete: async () => "ok",
  listModels: async () => [],
  capabilities: () => ({ tools: true, vision: false, streaming: true, maxTokens: 4096, contextWindow: 128000 }),
};

describe("ButlerAgent", () => {
  it("registers self in registry", () => {
    const reg = new AgentRegistry();
    const gm = new GroupManager(reg);
    new ButlerAgent({
      id: "butler", name: "管家", role: "管家",
      systemPrompt: "test", provider: "mock", model: "mock",
      permissions: { mode: "full-access" },
      sandbox: { enabled: false, filesystem: "isolated", network: { enabled: true, mode: "all" } },
    }, mockProvider, reg, gm);
    expect(reg.get("butler")).toBeDefined();
  });

  it("has butler tools registered", () => {
    const reg = new AgentRegistry();
    const gm = new GroupManager(reg);
    const butler = new ButlerAgent({
      id: "butler", name: "管家", role: "管家",
      systemPrompt: "test", provider: "mock", model: "mock",
      permissions: { mode: "full-access" },
      sandbox: { enabled: false, filesystem: "isolated", network: { enabled: true, mode: "all" } },
    }, mockProvider, reg, gm);
    // Check butler tools are in definitions
    const defs = (butler as any).toolRegistry.listDefinitions();
    const names = defs.map((d: any) => d.function.name);
    expect(names).toContain("butler-create-agent");
    expect(names).toContain("butler-list");
    expect(names).toContain("butler-run-group");
  });
});
