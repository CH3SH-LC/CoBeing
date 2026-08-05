/**
 * Butler tracked dispatch / work-status tools
 * (butler-dispatch-to-agent, butler-dispatch-to-group, butler-get-work-status,
 *  butler-cancel-work, butler-reply-to-group, butler-dispatch-task)
 */
import type { Tool, ToolContext, ToolResult, ButlerTaskReceiptPayload } from "@cobeing/shared";
import {
  dispatchButlerTask,
  buildButlerTaskReceiptPayload,
  type ButlerDispatchDeps,
  type ButlerDispatchReceipt,
} from "../../../butler/dispatch.js";
import type { GroupManager } from "../../../group/manager.js";
import { AgentRegistry } from "../../registry.js";

export function getButlerDispatchDeps(
  agentRegistry: AgentRegistry,
  groupManager: GroupManager,
  fallbackDataRoot: string,
): ButlerDispatchDeps | null {
  const runtime = (globalThis as any).__cobeing?.runtime;
  const dataRoot =
    runtime?.dataRoot
    ?? (globalThis as any).__cobeing?.dataRoot
    ?? (globalThis as any).__cobeingDataRoot
    ?? fallbackDataRoot;
  if (!runtime?.globalTodoStore || !runtime?.butlerTaskStore) {
    return null;
  }
  return {
    dataRoot,
    agentRegistry,
    groupManager,
    globalTodoStore: runtime.globalTodoStore,
    butlerTaskStore: runtime.butlerTaskStore,
    butlerBindingStore: runtime.butlerBindingStore,
    wsServer: runtime.wsServer ?? (globalThis as any).__cobeingWSServer,
  };
}

export interface DispatchReceiptView {
  /** 保持原文本内容不变 */
  text: string;
  /** 结构化回执视图（ButlerTaskReceiptPayload） */
  receipt: ButlerTaskReceiptPayload;
}

export function formatDispatchReceipt(
  receipt: ButlerDispatchReceipt,
  deps: ButlerDispatchDeps,
): DispatchReceiptView {
  const text = [
    "✅ 已创建可追踪管家任务",
    `Global TODO: ${receipt.globalTodo.id}`,
    `ButlerTask: ${receipt.butlerTaskId}`,
    `执行引用: ${receipt.executionRef.scope}/${receipt.executionRef.id}${receipt.executionRef.todoIds?.length ? ` (${receipt.executionRef.todoIds.join(", ")})` : ""}`,
  ].join("\n");

  const payload = buildButlerTaskReceiptPayload(deps, receipt.butlerTaskId);
  const receiptView: ButlerTaskReceiptPayload = "butlerTaskId" in payload
    ? payload
    : {
        butlerTaskId: receipt.butlerTaskId,
        globalTodoId: receipt.globalTodo.id,
        title: receipt.globalTodo.title,
        targetType: receipt.executionRef.scope,
        targetId: receipt.executionRef.id,
        assigneeName: receipt.executionRef.id,
        status: "running",
        timestamp: Date.now(),
      };
  return { text, receipt: receiptView };
}

/** 派发成功后广播完整 payload（best-effort，不阻塞工具返回） */
function broadcastDispatchReceipt(deps: ButlerDispatchDeps, receiptView: ButlerTaskReceiptPayload): void {
  try {
    deps.wsServer?.broadcast?.({ type: "butler_task_updated", payload: receiptView });
  } catch {
    // UI updates are best-effort; dispatch state is already persisted.
  }
}

export function makeDispatchToAgentTool(
  agentRegistry: AgentRegistry,
  groupManager: GroupManager,
  dataRoot: string,
): Tool {
  return {
    name: "butler-dispatch-to-agent",
    description: "将任务派发给指定 Agent，并自动创建 Global TODO、ButlerTask 和 Agent inbox 条目。",
    parameters: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "目标 Agent ID" },
        title: { type: "string", description: "任务标题" },
        goal: { type: "string", description: "任务目标和详细描述" },
        acceptance: { type: "string", description: "验收标准" },
        constraints: { type: "array", items: { type: "string" }, description: "约束条件" },
        notifyTarget: { type: "boolean", description: "是否立即通知目标 Agent，默认 true" },
      },
      required: ["agentId", "title", "goal"],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const agentId = params.agentId as string;
      const deps = getButlerDispatchDeps(agentRegistry, groupManager, dataRoot);
      if (!deps) {
        return { toolCallId: "", content: "Runtime 尚未挂载 Butler/Global TODO 存储，无法派发可追踪任务。", isError: true };
      }

      try {
        const receipt = await dispatchButlerTask(deps, {
          targetType: "agent",
          targetId: agentId,
          title: params.title as string,
          goal: params.goal as string,
          acceptance: params.acceptance as string | undefined,
          constraints: params.constraints as string[] | undefined,
          notifyTarget: params.notifyTarget as boolean | undefined,
        });
        const view = formatDispatchReceipt(receipt, deps);
        broadcastDispatchReceipt(deps, view.receipt);
        return { toolCallId: "", content: view.text };
      } catch (e) {
        return { toolCallId: "", content: `派发失败: ${(e as Error).message}`, isError: true };
      }
    },
  };
}

export function makeDispatchToGroupTool(
  agentRegistry: AgentRegistry,
  groupManager: GroupManager,
  dataRoot: string,
): Tool {
  return {
    name: "butler-dispatch-to-group",
    description: "将任务派发给指定群组，并自动创建 Global TODO、ButlerTask、群组 TODO 和管家绑定。",
    parameters: {
      type: "object",
      properties: {
        groupId: { type: "string", description: "目标群组 ID" },
        title: { type: "string", description: "任务标题" },
        goal: { type: "string", description: "任务目标和详细描述" },
        acceptance: { type: "string", description: "验收标准" },
        constraints: { type: "array", items: { type: "string" }, description: "约束条件" },
        responsibleAgentId: { type: "string", description: "群组内首要负责 Agent，默认 host" },
      },
      required: ["groupId", "title", "goal"],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const deps = getButlerDispatchDeps(agentRegistry, groupManager, dataRoot);
      if (!deps) {
        return { toolCallId: "", content: "Runtime 尚未挂载 Butler/Global TODO 存储，无法派发可追踪任务。", isError: true };
      }

      try {
        const receipt = await dispatchButlerTask(deps, {
          targetType: "group",
          targetId: params.groupId as string,
          title: params.title as string,
          goal: params.goal as string,
          acceptance: params.acceptance as string | undefined,
          constraints: params.constraints as string[] | undefined,
          responsibleAgentId: params.responsibleAgentId as string | undefined,
        });
        const view = formatDispatchReceipt(receipt, deps);
        broadcastDispatchReceipt(deps, view.receipt);
        return { toolCallId: "", content: view.text };
      } catch (e) {
        return { toolCallId: "", content: `派发失败: ${(e as Error).message}`, isError: true };
      }
    },
  };
}

export function makeGetWorkStatusTool(
  agentRegistry: AgentRegistry,
  groupManager: GroupManager,
  dataRoot: string,
): Tool {
  return {
    name: "butler-get-work-status",
    description: "查询 ButlerTask 与 Global TODO 的当前状态。",
    parameters: {
      type: "object",
      properties: {
        globalTodoId: { type: "string", description: "Global TODO ID" },
        butlerTaskId: { type: "string", description: "ButlerTask ID" },
        targetId: { type: "string", description: "按 Agent/Group ID 查询" },
        status: { type: "string", description: "按 ButlerTask 状态筛选" },
      },
      required: [],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const deps = getButlerDispatchDeps(agentRegistry, groupManager, dataRoot);
      if (!deps) {
        return { toolCallId: "", content: "Runtime 尚未挂载 Butler/Global TODO 存储，无法查询。", isError: true };
      }

      const globalTodoId = params.globalTodoId as string | undefined;
      const butlerTaskId = params.butlerTaskId as string | undefined;
      if (globalTodoId || butlerTaskId) {
        const globalTodo = globalTodoId
          ? deps.globalTodoStore.get(globalTodoId)
          : deps.globalTodoStore.getByButlerTaskId(butlerTaskId as string);
        const task = butlerTaskId
          ? deps.butlerTaskStore.get(butlerTaskId)
          : globalTodo?.butlerTaskId
            ? deps.butlerTaskStore.get(globalTodo.butlerTaskId)
            : undefined;
        if (!globalTodo && !task) {
          return { toolCallId: "", content: "未找到对应任务。", isError: true };
        }
        return { toolCallId: "", content: JSON.stringify({ globalTodo, butlerTask: task }, null, 2) };
      }

      const tasks = deps.butlerTaskStore.list({
        status: params.status as any,
        targetId: params.targetId as string | undefined,
      });
      return { toolCallId: "", content: JSON.stringify({ tasks }, null, 2) };
    },
  };
}

export function makeCancelWorkTool(
  agentRegistry: AgentRegistry,
  groupManager: GroupManager,
  dataRoot: string,
): Tool {
  return {
    name: "butler-cancel-work",
    description: "取消一个可追踪 Butler 工作项，同步更新 ButlerTask 与 Global TODO。",
    parameters: {
      type: "object",
      properties: {
        globalTodoId: { type: "string", description: "Global TODO ID" },
        butlerTaskId: { type: "string", description: "ButlerTask ID" },
        reason: { type: "string", description: "取消原因" },
      },
      required: [],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const deps = getButlerDispatchDeps(agentRegistry, groupManager, dataRoot);
      if (!deps) {
        return { toolCallId: "", content: "Runtime 尚未挂载 Butler/Global TODO 存储，无法取消。", isError: true };
      }

      let globalTodoId = params.globalTodoId as string | undefined;
      let butlerTaskId = params.butlerTaskId as string | undefined;
      const task = butlerTaskId ? deps.butlerTaskStore.get(butlerTaskId) : undefined;
      if (!globalTodoId && task) globalTodoId = task.globalTodoId;
      const globalTodo = globalTodoId ? deps.globalTodoStore.get(globalTodoId) : undefined;
      if (!butlerTaskId && globalTodo?.butlerTaskId) butlerTaskId = globalTodo.butlerTaskId;

      if (!globalTodo && !task) {
        return { toolCallId: "", content: "未找到可取消的任务。", isError: true };
      }

      const reason = (params.reason as string | undefined) || "Cancelled by Butler";
      if (globalTodoId) {
        deps.globalTodoStore.update(globalTodoId, {
          status: "cancelled",
          progressSummary: reason,
          nextAction: "No further action",
        } as any);
      }
      if (butlerTaskId) {
        deps.butlerTaskStore.update(butlerTaskId, {
          status: "cancelled",
          latestSummary: reason,
        });
      }
      deps.wsServer?.broadcastGlobalTodoUpdate?.();
      deps.wsServer?.broadcast?.({
        type: "butler_task_updated",
        payload: butlerTaskId
          ? buildButlerTaskReceiptPayload(deps, butlerTaskId)
          : { butlerTaskId, globalTodoId, timestamp: Date.now() },
      });
      return { toolCallId: "", content: `已取消任务。Global TODO: ${globalTodoId || "无"}；ButlerTask: ${butlerTaskId || "无"}` };
    },
  };
}

export function makeReplyToGroupTool(
  agentRegistry: AgentRegistry,
  groupManager: GroupManager,
  dataRoot: string,
): Tool {
  return {
    name: "butler-reply-to-group",
    description: "以管家身份向群组回复，并可同步刷新关联 ButlerTask / Global TODO 摘要。",
    parameters: {
      type: "object",
      properties: {
        groupId: { type: "string", description: "群组 ID" },
        content: { type: "string", description: "回复内容" },
        globalTodoId: { type: "string", description: "关联 Global TODO ID" },
        butlerTaskId: { type: "string", description: "关联 ButlerTask ID" },
      },
      required: ["groupId", "content"],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const groupId = params.groupId as string;
      const group = groupManager.get(groupId);
      if (!group) return { toolCallId: "", content: `未找到群组: ${groupId}`, isError: true };
      group.postMessage("butler", params.content as string);

      const deps = getButlerDispatchDeps(agentRegistry, groupManager, dataRoot);
      if (deps) {
        let globalTodoId = params.globalTodoId as string | undefined;
        let butlerTaskId = params.butlerTaskId as string | undefined;
        const task = butlerTaskId ? deps.butlerTaskStore.get(butlerTaskId) : undefined;
        if (!globalTodoId && task) globalTodoId = task.globalTodoId;
        const globalTodo = globalTodoId ? deps.globalTodoStore.get(globalTodoId) : undefined;
        if (!butlerTaskId && globalTodo?.butlerTaskId) butlerTaskId = globalTodo.butlerTaskId;
        if (globalTodoId) {
          deps.globalTodoStore.update(globalTodoId, {
            status: "running",
            progressSummary: `Butler replied to group ${groupId}`,
            nextAction: "Group should continue from Butler reply",
          } as any);
        }
        if (butlerTaskId) {
          deps.butlerTaskStore.update(butlerTaskId, {
            status: "running",
            latestSummary: `Butler replied to group ${groupId}`,
          });
        }
        deps.wsServer?.broadcastGlobalTodoUpdate?.();
        deps.wsServer?.broadcast?.({
          type: "butler_task_updated",
          payload: butlerTaskId
            ? buildButlerTaskReceiptPayload(deps, butlerTaskId)
            : { butlerTaskId, globalTodoId, timestamp: Date.now() },
        });
      }

      return { toolCallId: "", content: `已回复群组 ${groupId}` };
    },
  };
}

export function makeDispatchTaskTool(
  agentRegistry: AgentRegistry,
  groupManager: GroupManager,
  dataRoot: string,
): Tool {
  const delegate = makeDispatchToAgentTool(agentRegistry, groupManager, dataRoot);
  return {
    ...delegate,
    name: "butler-dispatch-task",
    description: "兼容旧入口：将任务派发给指定 Agent，并创建 Global TODO、ButlerTask 和 Agent inbox 条目。",
    async execute(params, context: ToolContext): Promise<ToolResult> {
      return delegate.execute(params, context);
    },
  };
}
