// packages/core/src/todo/global-tools.ts
import type { Tool, ToolContext, ToolResult } from "@cobeing/shared";
import { createLogger } from "@cobeing/shared";
import type { GlobalTodoStore } from "./global-store.js";
import type { GlobalTodoItem, GlobalTodoStatus } from "@cobeing/shared";

const log = createLogger("global-todo-tools");

// ============ global-todo-add ============

export function makeGlobalTodoAddTool(store: GlobalTodoStore): Tool {
  return {
    name: "global-todo-add",
    description:
      "创建一个全局跟踪任务（Global TODO）。当你（Butler）判断用户的目标需要跨群组、跨 Agent 或长期跟踪时使用。" +
      "创建后，系统会自动监控进度、升级阻塞、并在完成后触发续作判断。",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "任务标题（简短、可执行的描述）" },
        description: { type: "string", description: "详细说明：为什么需要跟踪、期望结果" },
        assigneeType: {
          type: "string",
          enum: ["butler", "agent", "group"],
          description: "初始指派对象类型",
        },
        assigneeId: { type: "string", description: "指派对象的 ID（agentId 或 groupId）" },
        responsibleAgentId: {
          type: "string",
          description: "负责执行和续作判断的 Agent ID。如果是群组任务，指定群组内的实际执行者",
        },
        autoDispatch: { type: "boolean", description: "允许自动派发（默认 true）" },
        autoMonitor: { type: "boolean", description: "允许自动监控（默认 true）" },
        autoEscalate: { type: "boolean", description: "允许自动升级（默认 true）" },
        autoArchive: { type: "boolean", description: "完成后自动回收（默认 true）" },
        autoContinue: { type: "boolean", description: "允许任务承担者自动续作（默认 true）" },
        continuationMode: {
          type: "string",
          enum: ["none", "request_coordinator", "auto_generate", "ask_user"],
          description: "续作模式：none=不续作, request_coordinator=请求协调者, auto_generate=自动生成, ask_user=询问用户",
        },
        maxDepth: { type: "number", description: "最大续作深度（限制自动生成任务链长度）" },
        stopWhen: { type: "string", description: "停止续作的条件描述" },
      },
      required: ["title", "description"],
    },
    async execute(params, _ctx: ToolContext): Promise<ToolResult> {
      const item = store.add({
        title: params.title as string,
        description: params.description as string,
        status: "pending",
        assigneeType: (params.assigneeType as GlobalTodoItem["assigneeType"]) || "butler",
        assigneeId: params.assigneeId as string | undefined,
        responsibleAgentId: params.responsibleAgentId as string | undefined,
        automationPolicy: {
          autoDispatch: params.autoDispatch !== false,
          autoMonitor: params.autoMonitor !== false,
          autoEscalate: params.autoEscalate !== false,
          autoArchive: params.autoArchive !== false,
          autoContinue: params.autoContinue !== false,
        },
        continuationPolicy: params.continuationMode
          ? {
              mode: params.continuationMode as GlobalTodoItem["continuationPolicy"] extends infer T ? (T extends { mode: infer M } ? M : never) : never,
              maxDepth: params.maxDepth as number | undefined,
              stopWhen: params.stopWhen as string | undefined,
            }
          : undefined,
        progressSummary: "已创建，等待派发",
        nextAction: params.assigneeId
          ? `派发给 ${params.assigneeType} ${params.assigneeId}`
          : "需要 Butler 决定派发对象",
        createdBy: "butler",
        executionRefs: [],
      } as any);

      // Broadcast update via globalThis
      try {
        const wsServer = (globalThis as any).__cobeing?.runtime?.wsServer;
        if (wsServer && typeof wsServer.broadcastGlobalTodoUpdate === "function") {
          wsServer.broadcastGlobalTodoUpdate();
        }
      } catch { /* non-critical */ }

      log.info("Global TODO created: %s → %s/%s", item.id, item.title, item.assigneeType, item.assigneeId);
      return {
        toolCallId: "",
        content: `✅ 已创建全局任务 "${item.title}" (ID: ${item.id})\n状态: ${item.status}\n下一步: ${item.nextAction}`,
      };
    },
  };
}

// ============ global-todo-list ============

export function makeGlobalTodoListTool(store: GlobalTodoStore): Tool {
  return {
    name: "global-todo-list",
    description: "列出全局跟踪任务。可按状态筛选，也可只看等待用户处理或停滞的任务。",
    parameters: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["pending", "running", "waiting_user", "completed", "cancelled"],
          description: "按状态筛选",
        },
        waitingUser: { type: "boolean", description: "仅列出等待用户处理的任务" },
        stalled: { type: "number", description: "列出停滞超过 N 小时的任务" },
      },
    },
    async execute(params, _ctx: ToolContext): Promise<ToolResult> {
      let items: GlobalTodoItem[];

      if (params.waitingUser) {
        items = store.getWaitingUser();
      } else if (params.stalled) {
        items = store.getStalled(params.stalled as number);
      } else {
        items = store.list(params.status as GlobalTodoStatus | undefined);
      }

      if (items.length === 0) return { toolCallId: "", content: "没有匹配的全局任务。" };

      const lines = items.map(i => {
        const statusLabel =
          i.status === "running" ? "🟢 执行中" :
          i.status === "waiting_user" ? "🟡 等待用户" :
          i.status === "completed" ? "✅ 已完成" :
          i.status === "cancelled" ? "❌ 已取消" : "⚪ 待派发";

        let line = `[${statusLabel}] ${i.title} (ID: ${i.id})\n  指派: ${i.assigneeType}/${i.assigneeId || "未指定"}`;
        if (i.responsibleAgentId) line += `\n  负责人: ${i.responsibleAgentId}`;
        if (i.nextAction) line += `\n  下一步: ${i.nextAction}`;
        if (i.lastEvent) line += `\n  最近事件: ${i.lastEvent.summary}`;
        if (i.internalBlocker) line += `\n  ⚠ 阻塞: ${i.internalBlocker.summary}`;
        return line;
      });
      return { toolCallId: "", content: `全局任务 (${items.length} 条):\n\n${lines.join("\n\n")}` };
    },
  };
}

// ============ global-todo-update ============

export function makeGlobalTodoUpdateTool(store: GlobalTodoStore): Tool {
  return {
    name: "global-todo-update",
    description: "更新全局任务的状态、进度摘要、下一步行动或阻塞信息。",
    parameters: {
      type: "object",
      properties: {
        todoId: { type: "string", description: "全局 TODO ID" },
        status: {
          type: "string",
          enum: ["pending", "running", "waiting_user", "completed", "cancelled"],
          description: "新状态",
        },
        progressSummary: { type: "string", description: "当前进度摘要" },
        nextAction: { type: "string", description: "下一步行动" },
        assigneeType: { type: "string", enum: ["butler", "agent", "group"], description: "更改指派类型" },
        assigneeId: { type: "string", description: "更改指派对象" },
        responsibleAgentId: { type: "string", description: "更改负责人" },
        blockerType: {
          type: "string",
          enum: ["missing_info", "dependency", "resource", "tool_error", "agent_stalled"],
          description: "阻塞类型（设置阻塞）",
        },
        blockerSummary: { type: "string", description: "阻塞描述" },
        clearBlocker: { type: "boolean", description: "清除阻塞" },
        eventType: { type: "string", description: "记录事件类型" },
        eventSummary: { type: "string", description: "记录事件摘要" },
      },
      required: ["todoId"],
    },
    async execute(params, _ctx: ToolContext): Promise<ToolResult> {
      const id = params.todoId as string;
      const existing = store.get(id);
      if (!existing) return { toolCallId: "", content: `未找到全局任务: ${id}`, isError: true };

      const patch: Record<string, any> = {};

      if (params.status) patch.status = params.status;
      if (params.progressSummary !== undefined) patch.progressSummary = params.progressSummary;
      if (params.nextAction !== undefined) patch.nextAction = params.nextAction;
      if (params.assigneeType) patch.assigneeType = params.assigneeType;
      if (params.assigneeId !== undefined) patch.assigneeId = params.assigneeId;
      if (params.responsibleAgentId !== undefined) patch.responsibleAgentId = params.responsibleAgentId;

      if (params.eventType || params.eventSummary) {
        patch.lastEvent = {
          type: (params.eventType as string) || "update",
          summary: (params.eventSummary as string) || "状态更新",
          id: `event-${Date.now()}`,
          butlerTaskId: existing.butlerTaskId || id,
          groupId: existing.assigneeId || "",
          fromAgentId: existing.responsibleAgentId || "butler",
          severity: "info" as const,
          createdAt: new Date().toISOString(),
        };
      }

      if (params.clearBlocker) {
        patch.internalBlocker = undefined;
      } else if (params.blockerType) {
        patch.internalBlocker = {
          type: params.blockerType,
          summary: (params.blockerSummary as string) || "",
          since: existing.internalBlocker?.since || new Date().toISOString(),
        };
      }

      const updated = store.update(id, patch as any);
      if (!updated) return { toolCallId: "", content: `更新失败: ${id}`, isError: true };

      // Broadcast
      try {
        const wsServer = (globalThis as any).__cobeing?.runtime?.wsServer;
        if (wsServer && typeof wsServer.broadcastGlobalTodoUpdate === "function") {
          wsServer.broadcastGlobalTodoUpdate();
        }
      } catch { /* non-critical */ }

      log.info("Global TODO updated: %s → status=%s", id, updated.status);
      return {
        toolCallId: "",
        content: `✅ 已更新全局任务 "${updated.title}"\n状态: ${updated.status}${updated.nextAction ? `\n下一步: ${updated.nextAction}` : ""}`,
      };
    },
  };
}

// ============ global-todo-link-execution ============

export function makeGlobalTodoLinkExecutionTool(store: GlobalTodoStore): Tool {
  return {
    name: "global-todo-link-execution",
    description: "将全局任务链接到具体的群组或 Agent 执行实例。派发任务后调用此工具建立跟踪引用。",
    parameters: {
      type: "object",
      properties: {
        todoId: { type: "string", description: "全局 TODO ID" },
        scope: { type: "string", enum: ["agent", "group"], description: "执行范围" },
        refId: { type: "string", description: "执行对象的 ID（agentId 或 groupId）" },
        refTodoIds: {
          type: "array",
          items: { type: "string" },
          description: "在该范围内创建的对应 TODO ID 列表",
        },
      },
      required: ["todoId", "scope", "refId"],
    },
    async execute(params, _ctx: ToolContext): Promise<ToolResult> {
      const id = params.todoId as string;
      const existing = store.get(id);
      if (!existing) return { toolCallId: "", content: `未找到全局任务: ${id}`, isError: true };

      const ok = store.addExecutionRef(id, {
        scope: params.scope as "agent" | "group",
        id: params.refId as string,
        todoIds: params.refTodoIds as string[],
      });

      if (!ok) return { toolCallId: "", content: `链接失败: ${id}`, isError: true };

      log.info("Global TODO linked: %s → %s/%s", id, params.scope, params.refId);
      return {
        toolCallId: "",
        content: `🔗 已将全局任务 "${existing.title}" 链接到 ${params.scope} ${params.refId}`,
      };
    },
  };
}

// ============ global-todo-continue ============

export function makeGlobalTodoContinueTool(store: GlobalTodoStore): Tool {
  return {
    name: "global-todo-continue",
    description:
      "对全局任务执行续作决策。当任务完成或阶段结束时，判断是否需要生成后续任务。\n" +
      "决策选项:\n" +
      "- complete: 任务已完全结束，收束归档\n" +
      "- continue: 任务需要继续，生成后续 TODO\n" +
      "- wait_user: 下一步需要用户确认或选择\n" +
      "- cancel: 取消此任务",
    parameters: {
      type: "object",
      properties: {
        todoId: { type: "string", description: "全局 TODO ID" },
        decision: {
          type: "string",
          enum: ["complete", "continue", "wait_user", "cancel"],
          description: "续作决策",
        },
        nextTitle: { type: "string", description: "如果 continue，描述下一步标题" },
        nextDescription: { type: "string", description: "如果 continue，描述下一步详情" },
        nextAssigneeType: { type: "string", enum: ["butler", "agent", "group"], description: "下一步指派类型" },
        nextAssigneeId: { type: "string", description: "下一步指派对象" },
        reason: { type: "string", description: "决策理由（供用户理解为什么做此决定）" },
      },
      required: ["todoId", "decision", "reason"],
    },
    async execute(params, _ctx: ToolContext): Promise<ToolResult> {
      const id = params.todoId as string;
      const decision = params.decision as string;
      const reason = params.reason as string;
      const existing = store.get(id);
      if (!existing) return { toolCallId: "", content: `未找到全局任务: ${id}`, isError: true };

      if (decision === "complete" || decision === "cancel") {
        store.update(id, {
          status: decision === "complete" ? "completed" : "cancelled",
          nextAction: `已${decision === "complete" ? "完成" : "取消"}。原因: ${reason}`,
        } as any);

        try {
          const wsServer = (globalThis as any).__cobeing?.runtime?.wsServer;
          if (wsServer && typeof wsServer.broadcastGlobalTodoUpdate === "function") {
            wsServer.broadcastGlobalTodoUpdate();
          }
        } catch { /* non-critical */ }

        return { toolCallId: "", content: `✅ 全局任务 "${existing.title}" 已${decision === "complete" ? "完成收束" : "取消"}。` };
      }

      if (decision === "wait_user") {
        store.update(id, {
          status: "waiting_user",
          nextAction: reason,
        } as any);

        try {
          const wsServer = (globalThis as any).__cobeing?.runtime?.wsServer;
          if (wsServer && typeof wsServer.broadcastGlobalTodoUpdate === "function") {
            wsServer.broadcastGlobalTodoUpdate();
          }
        } catch { /* non-critical */ }

        return { toolCallId: "", content: `🟡 全局任务 "${existing.title}" 已进入等待用户状态。\n原因: ${reason}` };
      }

      if (decision === "continue") {
        if (!params.nextTitle) {
          return { toolCallId: "", content: "continue 决策必须提供 nextTitle", isError: true };
        }

        const currentDepth = existing.continuationPolicy?.maxDepth;
        if (currentDepth !== undefined && currentDepth <= 0) {
          store.update(id, { status: "waiting_user", nextAction: "续作深度已达上限，需要用户决定是否继续" } as any);
          return { toolCallId: "", content: "⚠ 续作深度已达上限，任务进入等待用户状态。" };
        }

        const nextItem = store.add({
          title: params.nextTitle as string,
          description: (params.nextDescription as string) || `续作自: ${existing.title}`,
          status: "pending",
          assigneeType: (params.nextAssigneeType as GlobalTodoItem["assigneeType"]) || existing.assigneeType,
          assigneeId: (params.nextAssigneeId as string) || existing.assigneeId,
          responsibleAgentId: existing.responsibleAgentId,
          automationPolicy: existing.automationPolicy,
          continuationPolicy: currentDepth !== undefined && existing.continuationPolicy
            ? { ...existing.continuationPolicy, maxDepth: currentDepth - 1 }
            : existing.continuationPolicy,
          progressSummary: "续作自上一阶段",
          nextAction: `等待派发（续作自: ${existing.title}）`,
          createdBy: "butler",
          executionRefs: [],
        } as any);

        store.update(id, {
          status: "completed",
          nextAction: `已生成后续任务: ${nextItem.title}`,
        } as any);

        try {
          const wsServer = (globalThis as any).__cobeing?.runtime?.wsServer;
          if (wsServer && typeof wsServer.broadcastGlobalTodoUpdate === "function") {
            wsServer.broadcastGlobalTodoUpdate();
          }
        } catch { /* non-critical */ }

        log.info("Global TODO continued: %s → %s", id, nextItem.id);
        return {
          toolCallId: "",
          content: `🔄 已生成后续任务 "${nextItem.title}" (ID: ${nextItem.id})\n当前任务已标记完成。\n原因: ${reason}`,
        };
      }

      return { toolCallId: "", content: `未知决策: ${decision}`, isError: true };
    },
  };
}
