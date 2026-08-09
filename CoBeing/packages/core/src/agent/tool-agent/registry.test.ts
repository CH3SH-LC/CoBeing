import { describe, it, expect } from "vitest";
import { ToolAgentRegistry } from "./registry.js";
import { loadToolAgentSpec } from "./spec.js";

describe("ToolAgentRegistry（轻量注册表, 决策 #8 / spec #4）", () => {
  it("loadAll loads all 8 built-in specs from data/toolagents", () => {
    const r = new ToolAgentRegistry();
    r.loadAll();
    const specs = r.listSpecs();
    expect(specs.length).toBeGreaterThanOrEqual(8);
    expect(r.getSpec("review")?.trigger).toBe("group-send");
    expect(r.getSpec("clone")?.writePolicy).toBe("return_only");
    expect(r.getSpec("memory")?.failurePolicy).toBe("ignore");
  });

  it("creator spec systemPrompt comes from config card (双份 prompt 已合并, no legacy character field)", () => {
    const spec = loadToolAgentSpec("creator");
    // 配置卡 prompt 为权威（expression 字段），不得再残留 character 旧字段
    expect(spec.systemPrompt).toBeTruthy();
    expect(spec.systemPrompt).toContain("expression");
    expect(spec.systemPrompt).not.toContain("character");
  });

  it("registerPluginAgent stores plugin tool agents (复活死注册)", () => {
    const r = new ToolAgentRegistry();
    r.registerPluginAgent({ id: "custom-tool-agent", name: "Custom" });
    r.registerPluginAgent({ name: "missing-id" }); // 无 id → 拒绝
    expect(r.listPluginAgents()).toHaveLength(1);
    expect(r.listPluginAgents()[0]).toMatchObject({ id: "custom-tool-agent", name: "Custom" });
  });

  it("getSpec returns undefined for unknown type", () => {
    const r = new ToolAgentRegistry();
    expect(r.getSpec("review" as any)).toBeUndefined();
  });
});
