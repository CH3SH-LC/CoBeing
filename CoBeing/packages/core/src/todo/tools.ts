// packages/core/src/todo/tools.ts
import path from "node:path";
import type { Tool, ToolContext, ToolResult } from "@cobeing/shared";
import { TodoStore } from "./store.js";
import type { TodoItem, TodoScope } from "./types.js";
import { createLogger } from "@cobeing/shared";

const log = createLogger("todo-tools");
type GroupScannerGetter = (groupId: string) => import("./group-scanner.js").GroupTodoScanner | undefined;

export function makeTodoAddTool(
  agentDataRoot: string,
  groupStoreGetter?: (groupId: string) => TodoStore | undefined,
): Tool {
  return {
    name: "todo-add",
    description: "创建 TODO。支持三种触发：time（定时）/ 0time（扫描即触发）/ condition（条件触发）。",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "简短标题" },
        description: { type: "string", description: "触发时告诉你要做什么" },
        triggerMode: {
          type: "string",
          enum: ["time", "0time", "condition"],
          description: "触发模式。time=定时（默认）, 0time=扫描即触发, condition=条件触发",
        },
        triggerAt: { type: "string", description: "触发时间 ISO 8601。triggerMode=time 时必填" },
        check: { type: "string", description: "完成条件描述。0time 或 condition 模式使用" },
        conditionType: { type: "string", enum: ["agent_speak"], description: "条件类型。triggerMode=condition 时必填" },
        targetAgents: {
          type: "array", items: { type: "string" },
          description: "监视的 Agent ID 列表。condition 模式必填",
        },
        onFail: { type: "string", enum: ["remind", "recreate"], description: "条件不满足时的行为" },
        recurrenceHint: { type: "string", description: "续期提示（每天9:00 / 每周一10:00 / 不重复）" },
        repeat: {
          type: "object",
          description: "重复触发（可选，仅 time 模式；与 0time/condition 显式互斥）。触发后自动计算 nextTriggerAt 保持 pending。",
          properties: {
            type: { type: "string", enum: ["daily", "weekly", "interval"], description: "daily=每天 / weekly=每周 / interval=间隔小时" },
            timeOfDay: { type: "string", description: "HH:MM（daily/weekly 使用，本地时区）" },
            weekday: { type: "number", description: "0-6（0=周日），weekly 使用" },
            intervalHours: { type: "number", description: "interval 使用，两次触发的间隔小时数" },
            until: { type: "string", description: "ISO 8601 截止时间，超过后停止续期" },
          },
          required: ["type"],
        },
        overduePolicy: {
          type: "object",
          description: "已触发待完成超时策略（可选）。超时后低频重唤醒承担者（带冷却 + 重试上限，只重触发不重建）。",
          properties: {
            action: { type: "string", enum: ["re-wake", "escalate-to-host"], description: "re-wake=重新唤醒承担者 / escalate-to-host=升级给群主 host" },
            cooldownMinutes: { type: "number", description: "冷却分钟数（默认 10）" },
            maxRetries: { type: "number", description: "最大重触发次数（默认不限）" },
          },
          required: ["action"],
        },
        scope: { type: "string", description: "agent 或 group（默认 agent）" },
        groupId: { type: "string", description: "群组级时必填" },
        targetAgentId: { type: "string", description: "群组级时指派的目标 agent" },
        parentId: { type: "string", description: "父任务 ID（可选，子任务追踪用）" },
        dependsOn: {
          type: "array",
          items: { type: "string" },
          description: "依赖的上游任务 ID 列表（可选，上游完成后当前任务才会开始）",
        },
        onComplete: {
          type: "object",
          description: "完成后的动作链（可选）",
          properties: {
            mentionAgentId: { type: "string" },
            message: { type: "string" },
          },
        },
      },
      required: ["title", "description"],
    },
    async execute(params, context: ToolContext): Promise<ToolResult> {
      const scope = (params.scope as TodoScope) || "agent";
      const store = resolveStore(scope, params.groupId as string, agentDataRoot, context, groupStoreGetter);
      if (!store) return { toolCallId: "", content: "无法确定 TODO 存储", isError: true };

      const triggerMode = (params.triggerMode as string) || "time";

      // 验证必填参数
      if (triggerMode === "time" && !params.triggerAt) {
        return { toolCallId: "", content: "triggerMode=time 时必须提供 triggerAt", isError: true };
      }
      if (triggerMode === "condition" && !params.conditionType) {
        return { toolCallId: "", content: "triggerMode=condition 时必须提供 conditionType", isError: true };
      }
      if (triggerMode === "condition" && (!params.targetAgents || (params.targetAgents as string[]).length === 0)) {
        return { toolCallId: "", content: "triggerMode=condition 时必须提供 targetAgents（至少一个监视 Agent）", isError: true };
      }
      if (params.repeat) {
        if (triggerMode !== "time") {
          return { toolCallId: "", content: "repeat 仅支持 triggerMode=time（与 0time/condition 显式互斥）", isError: true };
        }
        if (!params.triggerAt) {
          return { toolCallId: "", content: "repeat 模式必须提供 triggerAt（首次触发时间）", isError: true };
        }
        const r = params.repeat as { type: string; intervalHours?: number };
        if (r.type === "interval" && !r.intervalHours) {
          return { toolCallId: "", content: "repeat.type=interval 时必须提供 intervalHours", isError: true };
        }
      }

      const todoInput: Omit<TodoItem, "id" | "createdAt" | "status"> = {
        title: params.title as string,
        description: params.description as string,
        triggerMode: triggerMode as TodoItem["triggerMode"],
        triggerAt: params.triggerAt as string || "",
        check: params.check as string,
        recurrenceHint: (params.recurrenceHint as string) || "不重复",
        createdBy: context.agentId || "unknown",
        agentId: scope === "agent" ? context.agentId : undefined,
        targetAgentId: scope === "group" ? params.targetAgentId as string : undefined,
        parentId: params.parentId as string | undefined,
        dependsOn: params.dependsOn as string[] | undefined,
        onComplete: params.onComplete as any,
        repeat: params.repeat as any,
        overduePolicy: params.overduePolicy as any,
      };
      // repeat 的 nextTriggerAt 初始 = 首次触发时间
      if (params.repeat && triggerMode === "time") {
        todoInput.nextTriggerAt = params.triggerAt as string;
      }

      if (triggerMode === "condition" && params.conditionType) {
        todoInput.condition = {
          type: params.conditionType as "agent_speak",
          targetAgents: params.targetAgents as string[] || [],
          check: (params.check as string) || "",
          onFail: (params.onFail as "remind" | "recreate") || "remind",
        };
      }

      const item = store.add(todoInput);

      log.info("TODO added: %s (%s) mode=%s", item.id, item.title, triggerMode);
      const modeLabel = triggerMode === "0time" ? "立即触发" : triggerMode === "condition" ? "条件触发" : `时间: ${item.triggerAt}`;
      return {
        toolCallId: "",
        content: `已创建 TODO "${item.title}" (ID: ${item.id})，${modeLabel}`,
      };
    },
  };
}

export function makeTodoListTool(
  agentDataRoot: string,
  groupStoreGetter?: (groupId: string) => TodoStore | undefined,
): Tool {
  return {
    name: "todo-list",
    description: "列出当前 TODO。",
    parameters: {
      type: "object",
      properties: {
        scope: { type: "string", description: "agent 或 group（默认 agent）" },
        groupId: { type: "string", description: "群组级时必填" },
        status: { type: "string", description: "筛选状态: pending / completed" },
      },
    },
    async execute(params, context: ToolContext): Promise<ToolResult> {
      const scope = (params.scope as TodoScope) || "agent";
      const store = resolveStore(scope, params.groupId as string, agentDataRoot, context, groupStoreGetter);
      if (!store) return { toolCallId: "", content: "无法确定 TODO 存储", isError: true };

      const items = store.list(params.status as any);
      if (items.length === 0) return { toolCallId: "", content: "没有 TODO" };

      const lines = items.map(i => {
        let line = `- [${i.status}] ${i.title} (ID: ${i.id})\n  触发: ${i.triggerAt}\n  内容: ${i.description}`;
        if (i.parentId) line += `\n  父任务: ${i.parentId}`;
        if (i.dependsOn?.length) line += `\n  依赖: ${i.dependsOn.join(", ")}`;
        if (i.targetAgentId) line += `\n  负责人: ${i.targetAgentId}`;
        return line;
      });
      return { toolCallId: "", content: `TODO 列表 (${items.length} 条):\n\n${lines.join("\n\n")}` };
    },
  };
}

export function makeTodoCompleteTool(
  agentDataRoot: string,
  groupStoreGetter?: (groupId: string) => TodoStore | undefined,
  groupScannerGetter?: (groupId: string) => import("./group-scanner.js").GroupTodoScanner | undefined,
): Tool {
  return {
    name: "todo-complete",
    description: "完成一个 TODO。",
    parameters: {
      type: "object",
      properties: {
        todoId: { type: "string", description: "TODO ID" },
        scope: { type: "string", description: "agent 或 group" },
        groupId: { type: "string", description: "群组级时必填" },
      },
      required: ["todoId", "scope"],
    },
    async execute(params, context: ToolContext): Promise<ToolResult> {
      const scope = params.scope as TodoScope;
      const groupId = params.groupId as string;

      // 群组级 TODO 优先使用 groupScanner.complete() 以触发 onComplete
      if (scope === "group" && groupId && groupScannerGetter) {
        const scanner = groupScannerGetter(groupId);
        if (scanner) {
          const item = await scanner.complete(params.todoId as string);
          if (!item) return { toolCallId: "", content: `未找到 TODO: ${params.todoId}`, isError: true };
          log.info("TODO completed via scanner: %s (%s)", item.id, item.title);
          return { toolCallId: "", content: `已完成 TODO "${item.title}"` };
        }
      }

      // fallback: 直接操作 store
      const store = resolveStore(scope, groupId, agentDataRoot, context, groupStoreGetter);
      if (!store) return { toolCallId: "", content: "无法确定 TODO 存储", isError: true };

      const item = store.complete(params.todoId as string);
      if (!item) return { toolCallId: "", content: `未找到 TODO: ${params.todoId}`, isError: true };

      log.info("TODO completed: %s (%s)", item.id, item.title);
      return { toolCallId: "", content: `已完成 TODO "${item.title}"` };
    },
  };
}

export function makeTodoRemoveTool(
  agentDataRoot: string,
  groupStoreGetter?: (groupId: string) => TodoStore | undefined,
): Tool {
  return {
    name: "todo-remove",
    description: "删除一个 TODO（彻底移除）。",
    parameters: {
      type: "object",
      properties: {
        todoId: { type: "string", description: "TODO ID" },
        scope: { type: "string", description: "agent 或 group" },
        groupId: { type: "string", description: "群组级时必填" },
      },
      required: ["todoId", "scope"],
    },
    async execute(params, context: ToolContext): Promise<ToolResult> {
      const scope = params.scope as TodoScope;
      const store = resolveStore(scope, params.groupId as string, agentDataRoot, context, groupStoreGetter);
      if (!store) return { toolCallId: "", content: "无法确定 TODO 存储", isError: true };

      const ok = store.remove(params.todoId as string);
      if (!ok) return { toolCallId: "", content: `未找到 TODO: ${params.todoId}`, isError: true };

      log.info("TODO removed: %s", params.todoId);
      return { toolCallId: "", content: `已删除 TODO` };
    },
  };
}

// ---- todo-review ----

export function makeTodoReviewTool(
  agentDataRoot: string,
  groupStoreGetter?: (groupId: string) => TodoStore | undefined,
  groupScannerGetter?: GroupScannerGetter,
): Tool {
  return {
    name: "todo-review",
    description: "验收 TODO 交付物。群主或关联 Agent 检查子任务完成后调用，可批准通过或打回重做。",
    parameters: {
      type: "object",
      properties: {
        todoId: { type: "string", description: "TODO ID" },
        scope: { type: "string", description: "agent 或 group" },
        groupId: { type: "string", description: "群组级时必填" },
        decision: {
          type: "string",
          description: "验收决定: approve（通过）或 rework（打回重做）",
          enum: ["approve", "rework"],
        },
        feedback: { type: "string", description: "验收意见或打回原因" },
      },
      required: ["todoId", "scope", "decision"],
    },
    async execute(params, context: ToolContext): Promise<ToolResult> {
      const scope = params.scope as TodoScope;
      const decision = params.decision as string;
      const feedback = params.feedback as string | undefined;

      if (decision === "approve") {
        if (scope === "group" && params.groupId && groupScannerGetter) {
          const scanner = groupScannerGetter(params.groupId as string);
          if (scanner) {
            const item = await scanner.complete(params.todoId as string);
            if (!item) return { toolCallId: "", content: `未找到 TODO: ${params.todoId}`, isError: true };
            log.info("TODO review approved: %s (%s)", item.id, item.title);
            return {
              toolCallId: "",
              content: `✅ 已通过 TODO "${item.title}"${feedback ? `\n意见: ${feedback}` : ""}`,
            };
          }
        }
      }

      const store = resolveStore(scope, params.groupId as string, agentDataRoot, context, groupStoreGetter);
      if (!store) return { toolCallId: "", content: "无法确定 TODO 存储", isError: true };

      const item = store.get(params.todoId as string);
      if (!item) return { toolCallId: "", content: `未找到 TODO: ${params.todoId}`, isError: true };

      if (decision === "approve") {
        store.complete(params.todoId as string);
        log.info("TODO review approved: %s (%s)", item.id, item.title);
        return {
          toolCallId: "",
          content: `✅ 已通过 TODO "${item.title}"${feedback ? `\n意见: ${feedback}` : ""}`,
        };
      }

      if (decision === "rework") {
        store.updateStatus(params.todoId as string, "pending");
        log.info("TODO review rework: %s (%s)", item.id, item.title);
        return {
          toolCallId: "",
          content: `🔄 TODO "${item.title}" 已打回重做${feedback ? `\n原因: ${feedback}` : ""}`,
        };
      }

      return { toolCallId: "", content: `未知决定: ${decision}`, isError: true };
    },
  };
}

// ---- Helper ----

function resolveStore(
  scope: TodoScope,
  groupId: string | undefined,
  agentDataRoot: string,
  context: ToolContext,
  groupStoreGetter?: (groupId: string) => TodoStore | undefined,
): TodoStore | undefined {
  if (scope === "group") {
    if (!groupId) return undefined;
    return groupStoreGetter?.(groupId);
  }
  const agentId = context.agentId || "unknown";
  return new TodoStore(path.join(agentDataRoot, "agents", agentId));
}

// ---- Batch tools ----

export function makeTodoBatchCompleteTool(
  agentDataRoot: string,
  groupStoreGetter?: (groupId: string) => TodoStore | undefined,
  groupScannerGetter?: GroupScannerGetter,
): Tool {
  return {
    name: "todo-batch-complete",
    description: "批量完成 TODO。传入多个 TODO ID 一次完成。",
    parameters: {
      type: "object",
      properties: {
        todoIds: {
          type: "array",
          items: { type: "string" },
          description: "要完成的 TODO ID 列表",
        },
        scope: { type: "string", description: "agent 或 group" },
        groupId: { type: "string", description: "群组级时必填" },
      },
      required: ["todoIds", "scope"],
    },
    async execute(params, context: ToolContext): Promise<ToolResult> {
      const scope = params.scope as TodoScope;
      const ids = params.todoIds as string[];
      let result: { completed: number; failed: Array<{ id: string; reason: string }> };
      if (scope === "group" && params.groupId && groupScannerGetter) {
        const scanner = groupScannerGetter(params.groupId as string);
        if (scanner) {
          let completed = 0;
          const failed: Array<{ id: string; reason: string }> = [];
          for (const id of ids) {
            const item = await scanner.complete(id);
            if (item) completed++;
            else failed.push({ id, reason: "未找到" });
          }
          result = { completed, failed };
        } else {
          const store = resolveStore(scope, params.groupId as string, agentDataRoot, context, groupStoreGetter);
          if (!store) return { toolCallId: "", content: "无法确定 TODO 存储", isError: true };
          result = store.batchComplete(ids);
        }
      } else {
        const store = resolveStore(scope, params.groupId as string, agentDataRoot, context, groupStoreGetter);
        if (!store) return { toolCallId: "", content: "无法确定 TODO 存储", isError: true };
        result = store.batchComplete(ids);
      }
      let msg = `批量完成: ${result.completed} 条成功`;
      if (result.failed.length > 0) {
        msg += `, ${result.failed.length} 条失败`;
        for (const f of result.failed) {
          msg += `\n- ${f.id}: ${f.reason}`;
        }
      }
      return { toolCallId: "", content: msg };
    },
  };
}

export function makeTodoBatchRemoveTool(
  agentDataRoot: string,
  groupStoreGetter?: (groupId: string) => TodoStore | undefined,
): Tool {
  return {
    name: "todo-batch-remove",
    description: "批量删除 TODO。传入多个 TODO ID 一次删除。",
    parameters: {
      type: "object",
      properties: {
        todoIds: {
          type: "array",
          items: { type: "string" },
          description: "要删除的 TODO ID 列表",
        },
        scope: { type: "string", description: "agent 或 group" },
        groupId: { type: "string", description: "群组级时必填" },
      },
      required: ["todoIds", "scope"],
    },
    async execute(params, context: ToolContext): Promise<ToolResult> {
      const scope = params.scope as TodoScope;
      const store = resolveStore(scope, params.groupId as string, agentDataRoot, context, groupStoreGetter);
      if (!store) return { toolCallId: "", content: "无法确定 TODO 存储", isError: true };

      const ids = params.todoIds as string[];
      const result = store.batchRemove(ids);
      let msg = `批量删除: ${result.removed} 条成功`;
      if (result.failed.length > 0) {
        msg += `, ${result.failed.length} 条失败`;
        for (const f of result.failed) {
          msg += `\n- ${f.id}: ${f.reason}`;
        }
      }
      return { toolCallId: "", content: msg };
    },
  };
}

export function makeTodoBatchUpdateTool(
  agentDataRoot: string,
  groupStoreGetter?: (groupId: string) => TodoStore | undefined,
): Tool {
  return {
    name: "todo-batch-update",
    description: "批量更新 TODO。支持批量重新分配负责人或修改状态。",
    parameters: {
      type: "object",
      properties: {
        todoIds: {
          type: "array",
          items: { type: "string" },
          description: "要更新的 TODO ID 列表",
        },
        scope: { type: "string", description: "agent 或 group" },
        groupId: { type: "string", description: "群组级时必填" },
        targetAgentId: { type: "string", description: "新的负责人 ID（批量重新分配）" },
        status: {
          type: "string",
          description: "新状态",
          enum: ["pending", "in-progress", "review", "completed"],
        },
      },
      required: ["todoIds", "scope"],
    },
    async execute(params, context: ToolContext): Promise<ToolResult> {
      const scope = params.scope as TodoScope;
      const store = resolveStore(scope, params.groupId as string, agentDataRoot, context, groupStoreGetter);
      if (!store) return { toolCallId: "", content: "无法确定 TODO 存储", isError: true };

      const ids = params.todoIds as string[];
      const updates: { targetAgentId?: string; status?: TodoItem["status"] } = {};
      if (params.targetAgentId) updates.targetAgentId = params.targetAgentId as string;
      if (params.status) updates.status = params.status as TodoItem["status"];

      if (!updates.targetAgentId && !updates.status) {
        return { toolCallId: "", content: "请指定 targetAgentId 或 status", isError: true };
      }

      const result = store.batchUpdate(ids, updates);
      let msg = `批量更新: ${result.updated} 条成功`;
      if (result.failed.length > 0) {
        msg += `, ${result.failed.length} 条失败`;
        for (const f of result.failed) {
          msg += `\n- ${f.id}: ${f.reason}`;
        }
      }
      return { toolCallId: "", content: msg };
    },
  };
}
