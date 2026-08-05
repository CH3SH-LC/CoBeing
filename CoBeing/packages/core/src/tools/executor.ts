/**
 * ToolExecutor — 统一工具执行入口
 */
import type { ToolCall, ToolResult, SandboxConfig, SandboxRunner } from "@cobeing/shared";
import { EventEmitter, createLogger } from "@cobeing/shared";
import { ToolRegistry } from "./registry.js";
import { PermissionEnforcer } from "./permission.js";
import type { ObservabilityDB } from "../observability/observability-db.js";

const log = createLogger("tool-executor");

export class ToolExecutor {
  private agentName: string;

  constructor(
    private registry: ToolRegistry,
    private permission: PermissionEnforcer,
    private events?: EventEmitter,
    private sandboxConfig?: SandboxConfig,
    private sandboxRunner?: SandboxRunner,
    private observabilityDB?: ObservabilityDB,
    agentName?: string,
  ) {
    this.agentName = agentName ?? "unknown";
  }

  async execute(toolCall: ToolCall, agentId: string, sessionId: string, workingDir: string, callDepth = 0): Promise<ToolResult> {
    const startTime = Date.now();

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

    // 3.5 插件工具钩子 — tool:before（可拦截）
    const hookBus = (globalThis as any).__cobeingHookBus;
    if (hookBus) {
      try {
        const hookResult = await hookBus.emit("tool:before", tool.name, params, {
          agentId,
          groupId: sessionId.startsWith("group:") ? sessionId.slice(6) : undefined,
        });
        if (hookResult && hookResult.allowed === false) {
          log.warn("[HOOK BLOCKED] %s: %s", tool.name, hookResult.reason);
          const reason = hookResult.reason || "blocked by plugin";
          this.events?.emit("tool:denied", { agentId, toolName: tool.name, reason });
          return { toolCallId: toolCall.id, content: `工具调用被插件拦截: ${reason}`, isError: true };
        }
      } catch (err: any) {
        log.warn("tool:before hook error: %s", err.message);
      }
    }

    // 4. 执行（try/finally 确保 tool:after 始终触发）
    log.info("[CALL] %s(%s)", tool.name, toolCall.function.arguments);
    this.events?.emit("tool:call", { agentId, toolName: tool.name, params });

    let result: ToolResult;
    try {
      result = await tool.execute(params, {
        agentId,
        sessionId,
        groupId: sessionId.startsWith("group:") ? sessionId.slice(6) : undefined,
        workingDir,
        sandbox: this.sandboxConfig ?? { enabled: false, filesystem: "isolated", network: { enabled: true, mode: "all" } },
        sandboxRunner: this.sandboxRunner,
        permissions: { mode: (this.permission?.mode ?? "full-access") as import("@cobeing/shared").PermissionMode },
        callDepth,
      });
      result.toolCallId = toolCall.id;
    } catch (execErr: any) {
      // tool:after still fires when execution throws
      if (hookBus) {
        hookBus.emit("tool:after", tool.name, {
          content: execErr?.message || "Tool execution threw",
          isError: true,
        }, {
          agentId,
          groupId: sessionId.startsWith("group:") ? sessionId.slice(6) : undefined,
        }).catch(() => {});
      }
      throw execErr;
    }

    log.info("[RESULT] %s — %s%s", tool.name, result.isError ? "ERROR: " : "", (result.content as string).slice(0, 200));
    this.events?.emit("tool:result", {
      agentId,
      toolName: tool.name,
      result: result.content,
      isError: result.isError ?? false,
    });

    // Emit tool:after hook
    if (hookBus) {
      hookBus.emit("tool:after", tool.name, {
        content: typeof result.content === "string" ? result.content : JSON.stringify(result.content),
        isError: result.isError ?? false,
      }, {
        agentId,
        groupId: sessionId.startsWith("group:") ? sessionId.slice(6) : undefined,
      }).catch(() => {});
    }

    if (this.observabilityDB) {
      const paramStr = JSON.stringify(params);
      const resultStr = typeof result.content === "string" ? result.content : JSON.stringify(result.content);
      this.observabilityDB.insertToolCall({
        agent_id: agentId,
        agent_name: this.agentName,
        tool_name: toolCall.function.name,
        is_error: result.isError ? 1 : 0,
        latency_ms: Date.now() - startTime,
        param_chars: paramStr.length,
        result_chars: resultStr.length,
        timestamp: Date.now(),
      });
    }

    return result;
  }
}
