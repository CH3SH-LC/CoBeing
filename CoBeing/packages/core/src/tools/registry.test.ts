import { describe, it, expect } from "vitest";
import { ToolRegistry } from "./registry.js";
import type { Tool } from "@cobeing/shared";

const mockTool: Tool = {
  name: "test-tool",
  description: "A test tool",
  parameters: { type: "object", properties: { x: { type: "number" } }, required: ["x"] },
  execute: async (params) => ({ toolCallId: "1", content: String(params.x) }),
};

describe("ToolRegistry", () => {
  it("registers and retrieves a tool", () => {
    const reg = new ToolRegistry();
    reg.register(mockTool);
    expect(reg.get("test-tool")).toBe(mockTool);
    expect(reg.has("test-tool")).toBe(true);
    expect(reg.has("nope")).toBe(false);
  });

  it("lists definitions for LLM", () => {
    const reg = new ToolRegistry();
    reg.register(mockTool);
    const defs = reg.listDefinitions();
    expect(defs).toHaveLength(1);
    expect(defs[0]).toEqual({
      type: "function",
      function: { name: "test-tool", description: "A test tool", parameters: mockTool.parameters },
    });
  });

  it("unregisters a tool", () => {
    const reg = new ToolRegistry();
    reg.register(mockTool);
    reg.unregister("test-tool");
    expect(reg.has("test-tool")).toBe(false);
    expect(reg.listDefinitions()).toHaveLength(0);
  });

  it("listAll returns all tools", () => {
    const reg = new ToolRegistry();
    reg.register(mockTool);
    expect(reg.listAll()).toHaveLength(1);
  });
});
