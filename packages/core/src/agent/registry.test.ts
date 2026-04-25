import { describe, it, expect } from "vitest";
import { AgentRegistry } from "./registry.js";

function mockAgent(id: string, name: string) {
  return { id, name, getStatus: () => "idle" } as any;
}

describe("AgentRegistry", () => {
  it("registers and retrieves an agent", () => {
    const reg = new AgentRegistry();
    const a = mockAgent("a1", "coder");
    reg.register(a);
    expect(reg.get("a1")).toBe(a);
    expect(reg.get("nope")).toBeUndefined();
  });

  it("throws on duplicate ID", () => {
    const reg = new AgentRegistry();
    reg.register(mockAgent("a1", "coder"));
    expect(() => reg.register(mockAgent("a1", "coder2"))).toThrow();
  });

  it("unregisters an agent", () => {
    const reg = new AgentRegistry();
    reg.register(mockAgent("a1", "coder"));
    reg.unregister("a1");
    expect(reg.get("a1")).toBeUndefined();
    expect(reg.list()).toHaveLength(0);
  });

  it("lists all agents", () => {
    const reg = new AgentRegistry();
    reg.register(mockAgent("a1", "coder"));
    reg.register(mockAgent("a2", "reader"));
    expect(reg.list()).toHaveLength(2);
  });
});
