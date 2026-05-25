import { describe, it, expect } from "vitest";
import { ToolExecutor } from "./executor.js";
import { ToolRegistry } from "./registry.js";
import { PermissionEnforcer } from "./permission.js";
import type { Tool, ToolCall } from "@cobeing/shared";

const echoTool: Tool = {
  name: "echo",
  description: "echo back",
  parameters: { type: "object", properties: { msg: { type: "string" } }, required: ["msg"] },
  execute: async (params) => ({ toolCallId: "", content: params.msg as string }),
};

const failTool: Tool = {
  name: "fail",
  description: "always fails",
  parameters: { type: "object", properties: {} },
  execute: async () => ({ toolCallId: "", content: "something went wrong", isError: true }),
};

function makeExecutor(mode: string = "full-access") {
  const registry = new ToolRegistry();
  registry.register(echoTool);
  registry.register(failTool);
  const permission = new PermissionEnforcer({ mode: mode as any }, undefined, "/workspace");
  return new ToolExecutor(registry, permission, undefined, { enabled: false, filesystem: "isolated", network: { enabled: true, mode: "all" } });
}

const toolCall = (name: string, args: string): ToolCall => ({
  id: "call-1",
  type: "function",
  function: { name, arguments: args },
});

describe("ToolExecutor", () => {
  it("executes a tool successfully", async () => {
    const executor = makeExecutor();
    const result = await executor.execute(toolCall("echo", `{"msg":"hello"}`), "agent-1", "s1", "/workspace");
    expect(result.content).toBe("hello");
    expect(result.isError).toBeFalsy();
  });

  it("returns error for unknown tool", async () => {
    const executor = makeExecutor();
    const result = await executor.execute(toolCall("nope", "{}"), "agent-1", "s1", "/workspace");
    expect(result.isError).toBe(true);
    expect(result.content).toContain("未知工具");
  });

  it("returns error for invalid JSON args", async () => {
    const executor = makeExecutor();
    const result = await executor.execute(toolCall("echo", "not-json"), "agent-1", "s1", "/workspace");
    expect(result.isError).toBe(true);
    expect(result.content).toContain("JSON");
  });

  it("denies tool when permission check fails", async () => {
    const registry = new ToolRegistry();
    registry.register(echoTool);
    const permission = new PermissionEnforcer(
      { mode: "ask", deny: ["echo"] }, undefined, "/workspace",
    );
    const executor = new ToolExecutor(registry, permission);
    const result = await executor.execute(toolCall("echo", `{"msg":"hi"}`), "agent-1", "s1", "/workspace");
    expect(result.isError).toBe(true);
    expect(result.content).toContain("权限不足");
  });

  it("passes through tool execution errors", async () => {
    const executor = makeExecutor();
    const result = await executor.execute(toolCall("fail", "{}"), "agent-1", "s1", "/workspace");
    expect(result.isError).toBe(true);
    expect(result.content).toBe("something went wrong");
  });

  it("sets toolCallId on result", async () => {
    const executor = makeExecutor();
    const result = await executor.execute(toolCall("echo", `{"msg":"hi"}`), "agent-1", "s1", "/workspace");
    expect(result.toolCallId).toBe("call-1");
  });
});
