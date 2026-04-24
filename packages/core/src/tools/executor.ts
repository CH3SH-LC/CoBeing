/**
 * ToolExecutor — 统一工具执行入口
 */
import type { ToolCall, ToolResult, SandboxConfig, SandboxRunner } from "@cobeing/shared";
import { EventEmitter, createLogger } from "@cobeing/shared";
import { ToolRegistry } from "./registry.js";
import { PermissionEnforcer } from "./permission.js";

const log = createLogger("tool-executor");

export class ToolExecutor {
  constructor(
    private registry: ToolRegistry,
    private permission: PermissionEnforcer,
    private events?: EventEmitter,
    private sandboxConfig?: SandboxConfig,
    private sandboxRunner?: SandboxRunner,
  ) {}

  async execute(toolCall: ToolCall, agentId: string, sessionId: string, workingDir: string, callDepth = 0): Promise<ToolResult> {
    // 1. 查找工具
    const tool = this.registry.get(toolCall.function.name);
    if (!tool) {
      return { toolCallId: toolCall.id, content: `未知工具: ${toolCall.function.name}`, isError: true };
    }

    // 2. 解析参数
    let params: Record<string, unknown>;
    try {
      params = JSON.parse(toolCall.function.arguments);
    } catch {
      return { toolCallId: toolCall.id, content: `工具参数 JSON 解析失败`, isError: true };
    }

    // 3. 权限检查
    const permResult = this.permission.check(tool.name, params);
    if (!permResult.allowed) {
      log.warn("[DENIED] %s — %s", tool.name, permResult.reason);
      this.events?.emit("tool:denied", { agentId, toolName: tool.name, reason: permResult.reason! });
      return { toolCallId: toolCall.id, content: `权限不足: ${permResult.reason}`, isError: true };
    }

    // 4. 执行
    log.info("[CALL] %s(%s)", tool.name, toolCall.function.arguments);
    this.events?.emit("tool:call", { agentId, toolName: tool.name, params });
    const result = await tool.execute(params, {
      agentId,
      sessionId,
      workingDir,
      sandbox: this.sandboxConfig ?? { enabled: false, filesystem: "isolated", network: { enabled: true, mode: "all" } },
      sandboxRunner: this.sandboxRunner,
      permissions: { mode: "full-access" },
      callDepth,
    });
    result.toolCallId = toolCall.id;

    log.info("[RESULT] %s — %s%s", tool.name, result.isError ? "ERROR: " : "", (result.content as string).slice(0, 200));
    this.events?.emit("tool:result", {
      agentId,
      toolName: tool.name,
      result: result.content,
      isError: result.isError ?? false,
    });

    return result;
  }
}
