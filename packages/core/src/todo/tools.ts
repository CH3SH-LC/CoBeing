// packages/core/src/todo/tools.ts
import path from "node:path";
import type { Tool, ToolContext, ToolResult } from "@cobeing/shared";
import { TodoStore } from "./store.js";
import type { TodoScope } from "./types.js";
import { createLogger } from "@cobeing/shared";

const log = createLogger("todo-tools");

export function makeTodoAddTool(
  agentDataRoot: string,
  groupStoreGetter?: (groupId: string) => TodoStore | undefined,
): Tool {
  return {
    name: "todo-add",
    description: "创建定时 TODO。到达触发时间后系统会以 TODOboard 身份唤醒你执行任务。",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "简短标题" },
        description: { type: "string", description: "触发时告诉你要做什么" },
        triggerAt: { type: "string", description: "触发时间 (ISO 8601，如 2026-04-25T09:00:00+08:00)" },
        recurrenceHint: { type: "string", description: "续期提示（每天9:00 / 每周一10:00 / 不重复）" },
        scope: { type: "string", description: "agent 或 group（默认 agent）" },
        groupId: { type: "string", description: "群组级时必填" },
        targetAgentId: { type: "string", description: "群组级时指派的目标 agent" },
        onComplete: {
          type: "object",
          description: "完成后的动作链（可选）",
          properties: {
            mentionAgentId: { type: "string" },
            message: { type: "string" },
          },
        },
      },
      required: ["title", "description", "triggerAt", "recurrenceHint"],
    },
    async execute(params, context: ToolContext): Promise<ToolResult> {
      const scope = (params.scope as TodoScope) || "agent";
      const store = resolveStore(scope, params.groupId as string, agentDataRoot, context, groupStoreGetter);
      if (!store) return { toolCallId: "", content: "无法确定 TODO 存储", isError: true };

      const item = store.add({
        title: params.title as string,
        description: params.description as string,
        triggerAt: params.triggerAt as string,
        recurrenceHint: params.recurrenceHint as string,
        createdBy: context.agentId || "unknown",
        agentId: scope === "agent" ? context.agentId : undefined,
        targetAgentId: scope === "group" ? params.targetAgentId as string : undefined,
        onComplete: params.onComplete as any,
      });

      log.info("TODO added: %s (%s) triggerAt=%s", item.id, item.title, item.triggerAt);
      return {
        toolCallId: "",
        content: `已创建 TODO "${item.title}" (ID: ${item.id})，触发时间: ${item.triggerAt}`,
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

      const lines = items.map(i =>
        `- [${i.status}] ${i.title} (ID: ${i.id})\n  触发: ${i.triggerAt}\n  内容: ${i.description}`
      );
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
