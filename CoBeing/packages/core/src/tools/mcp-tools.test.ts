/**
 * mcp-tools 测试 — mcp-register 附带 MCP server 的 instructions 使用指南
 *
 * 目标：Agent 通过 mcp-register 注册 claude-code 等 MCP 工具时，
 * 能同时获得 server 提供的【使用指南】，而非只拿到工具名列表。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeMCPRegisterTool, makeMCPDiscoverTool } from "./mcp-tools.js";
import type { Tool } from "@cobeing/shared";

const context: any = { agentId: "agent-1", sessionId: "s1", workingDir: "D:/w" };

function fakeTool(name: string): Tool {
  return {
    name,
    description: `工具 ${name} 的说明`,
    parameters: { type: "object", properties: {} },
    async execute() {
      return { toolCallId: "", content: "ok" };
    },
  };
}

function makeFakeManager(opts: {
  tools: Tool[];
  instructions?: string;
}) {
  return {
    getServerTools: (serverId: string) => (serverId === "claude-code" ? opts.tools : []),
    getInstructions: (serverId: string) =>
      serverId === "claude-code" ? opts.instructions : undefined,
    getServers: () => [],
  } as any;
}

function installFakeAgentRegistry() {
  const registerTool = vi.fn();
  const rebuildLoop = vi.fn();
  (globalThis as any).__cobeingAgentRegistry = {
    get: (id: string) =>
      id === "agent-1" ? { registerTool, rebuildLoop } : undefined,
  };
  return { registerTool, rebuildLoop };
}

beforeEach(() => {
  installFakeAgentRegistry();
});

afterEach(() => {
  delete (globalThis as any).__cobeingAgentRegistry;
});

describe("mcp-register 附带 instructions 使用指南", () => {
  it("注册成功时，返回内容包含【使用指南】与 server 的 instructions", async () => {
    const guide = "先 claude_code_start 拿 task_id，再用 claude_code_result 轮询。";
    const manager = makeFakeManager({
      tools: [fakeTool("claude_code_start"), fakeTool("claude_code_result")],
      instructions: guide,
    });
    const tool = makeMCPRegisterTool(manager);
    const r = await tool.execute({ serverId: "claude-code" }, context);
    expect(r.isError).toBeFalsy();
    expect(r.content).toContain("已注册 MCP 服务器 \"claude-code\"");
    expect(r.content).toContain("claude_code_start");
    expect(r.content).toContain("【使用指南】");
    expect(r.content).toContain(guide);
  });

  it("server 无 instructions 时不附带指南段", async () => {
    const manager = makeFakeManager({
      tools: [fakeTool("claude_code_start")],
      instructions: undefined,
    });
    const tool = makeMCPRegisterTool(manager);
    const r = await tool.execute({ serverId: "claude-code" }, context);
    expect(r.isError).toBeFalsy();
    expect(r.content).toContain("claude_code_start");
    expect(r.content).not.toContain("【使用指南】");
  });

  it("未知 server（无工具）返回错误", async () => {
    const manager = makeFakeManager({ tools: [fakeTool("x")] });
    const tool = makeMCPRegisterTool(manager);
    const r = await tool.execute({ serverId: "nonexistent" }, context);
    expect(r.isError).toBe(true);
    expect(r.content).toContain("没有可用工具");
  });

  it("Agent 不在注册表时返回错误", async () => {
    const manager = makeFakeManager({
      tools: [fakeTool("claude_code_start")],
      instructions: "指南",
    });
    const tool = makeMCPRegisterTool(manager);
    const r = await tool.execute({ serverId: "claude-code" }, { ...context, agentId: "ghost" });
    expect(r.isError).toBe(true);
    expect(r.content).toContain("未在注册表");
  });
});

describe("mcp-discover 保持可用", () => {
  it("serverId 过滤时列出工具与提示", async () => {
    const manager = {
      getServerTools: () => [fakeTool("claude_code_start")],
      getInstructions: () => undefined,
      getServers: () => [
        {
          id: "claude-code",
          serverName: "claude-code-mcp",
          toolCount: 1,
          tools: [{ name: "claude_code_start", description: "提交任务", inputSchema: {} }],
          connected: true,
        },
      ],
    } as any;
    const tool = makeMCPDiscoverTool(manager);
    const r = await tool.execute({ serverId: "claude-code" }, context);
    expect(r.isError).toBeFalsy();
    expect(r.content).toContain("claude_code_start");
    expect(r.content).toContain("mcp-register");
  });
});
