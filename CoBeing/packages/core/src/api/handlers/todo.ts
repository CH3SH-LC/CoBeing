/**
 * todo 域 WS 命令 handler — 从 ws-server.ts 的 switch 迁移
 * get_todos / add_todo / complete_todo / remove_todo / update_todo_status /
 * batch_complete_todo / batch_remove_todo / batch_update_todo / get_global_todos
 */
import { buildTodoMutationPayload } from "../types.js";
import type { HandlerRegistrar } from "./types.js";

export function registerTodoHandlers(register: HandlerRegistrar): void {
  register("get_todos", function (ws, msg) {
    const { scope, agentId, groupId } = msg.payload as {
      scope: "agent" | "group"; agentId?: string; groupId?: string;
    };
    const store = this.resolveTodoStore(scope, agentId, groupId);
    if (!store) {
      this.sendToClient(ws, { type: "error", payload: { message: "无法确定 TODO 存储" } });
      return;
    }
    this.sendToClient(ws, { type: "todos", payload: { todos: store.list() } });
  });

  register("add_todo", function (ws, msg) {
    const { title, description, triggerAt, recurrenceHint, scope, agentId, groupId, targetAgentId, onComplete } = msg.payload as {
      title: string; description: string; triggerAt: string; recurrenceHint: string;
      scope: "agent" | "group"; agentId?: string; groupId?: string;
      targetAgentId?: string; onComplete?: any;
    };
    const store = this.resolveTodoStore(scope, agentId, groupId);
    if (!store) {
      this.sendToClient(ws, { type: "error", payload: { message: "无法确定 TODO 存储" } });
      return;
    }
    const item = store.add({
      title, description, triggerAt, recurrenceHint,
      createdBy: "user",
      agentId: scope === "agent" ? agentId : undefined,
      targetAgentId: scope === "group" ? targetAgentId : undefined,
      onComplete,
    });
    const payload = buildTodoMutationPayload("added", { scope, agentId, groupId }, { todo: item });
    this.sendToClient(ws, { type: "todo_added", payload });
    this.broadcast({ type: "todo_updated", payload });
  });

  register("complete_todo", async function (ws, msg) {
    const { todoId, scope, agentId, groupId } = msg.payload as {
      todoId: string; scope: "agent" | "group"; agentId?: string; groupId?: string;
    };
    const store = this.resolveTodoStore(scope, agentId, groupId);
    if (!store) {
      this.sendToClient(ws, { type: "error", payload: { message: "无法确定 TODO 存储" } });
      return;
    }
    const item = scope === "group" && groupId
      ? await this.groupManager?.completeGroupTodo?.(groupId, todoId)
      : store.complete(todoId);
    if (!item) {
      this.sendToClient(ws, { type: "error", payload: { message: `TODO not found: ${todoId}` } });
      return;
    }
    const payload = buildTodoMutationPayload("completed", { scope, agentId, groupId }, { todo: item });
    this.sendToClient(ws, { type: "todo_completed", payload });
    this.broadcast({ type: "todo_updated", payload });
  });

  register("remove_todo", function (ws, msg) {
    const { todoId: rTodoId, scope: rScope, agentId: rAgentId, groupId: rGroupId } = msg.payload as {
      todoId: string; scope: "agent" | "group"; agentId?: string; groupId?: string;
    };
    const store = this.resolveTodoStore(rScope, rAgentId, rGroupId);
    if (!store) {
      this.sendToClient(ws, { type: "error", payload: { message: "无法确定 TODO 存储" } });
      return;
    }
    const ok = store.remove(rTodoId);
    if (!ok) {
      this.sendToClient(ws, { type: "error", payload: { message: `TODO not found: ${rTodoId}` } });
      return;
    }
    const payload = buildTodoMutationPayload("removed", { scope: rScope, agentId: rAgentId, groupId: rGroupId }, { todoId: rTodoId });
    this.sendToClient(ws, { type: "todo_removed", payload });
    this.broadcast({ type: "todo_updated", payload });
  });

  register("update_todo_status", async function (ws, msg) {
    const { todoId: sTodoId, status: sStatus, scope: sScope, agentId: sAgentId, groupId: sGroupId } = msg.payload as {
      todoId: string; status: string; scope: "agent" | "group"; agentId?: string; groupId?: string;
    };
    const store = this.resolveTodoStore(sScope, sAgentId, sGroupId);
    if (!store) {
      this.sendToClient(ws, { type: "error", payload: { message: "无法确定 TODO 存储" } });
      return;
    }
    if (sScope === "group" && sGroupId && sStatus === "completed") {
      const item = await this.groupManager?.completeGroupTodo?.(sGroupId, sTodoId);
      if (!item) {
        this.sendToClient(ws, { type: "error", payload: { message: `TODO not found: ${sTodoId}` } });
        return;
      }
    } else {
      const result = store.updateStatus(sTodoId, sStatus as any);
      if (!result.ok) {
        this.sendToClient(ws, { type: "error", payload: { message: result.error || "更新失败" } });
        return;
      }
    }
    this.broadcast({
      type: "todo_updated",
      payload: buildTodoMutationPayload("status-updated", { scope: sScope, agentId: sAgentId, groupId: sGroupId }, {
        todoId: sTodoId,
        status: sStatus,
      }),
    });
  });

  register("batch_complete_todo", async function (ws, msg) {
    const { todoIds, scope: bcScope, agentId: bcAgentId, groupId: bcGroupId } = msg.payload as {
      todoIds: string[]; scope: "agent" | "group"; agentId?: string; groupId?: string;
    };
    const store = this.resolveTodoStore(bcScope, bcAgentId, bcGroupId);
    if (!store) { this.sendToClient(ws, { type: "error", payload: { message: "无法确定 TODO 存储" } }); return; }
    let result: { completed: number; failed: Array<{ id: string; reason: string }> };
    if (bcScope === "group" && bcGroupId && this.groupManager?.completeGroupTodo) {
      let completed = 0;
      const failed: Array<{ id: string; reason: string }> = [];
      for (const id of todoIds) {
        const item = await this.groupManager.completeGroupTodo(bcGroupId, id);
        if (item) completed++;
        else failed.push({ id, reason: "未找到" });
      }
      result = { completed, failed };
    } else {
      result = store.batchComplete(todoIds);
    }
    this.sendToClient(ws, { type: "todo_batch_result", payload: { action: "complete", scope: bcScope, agentId: bcAgentId, groupId: bcGroupId, ...result } });
    this.broadcast({
      type: "todo_updated",
      payload: buildTodoMutationPayload("batch-completed", { scope: bcScope, agentId: bcAgentId, groupId: bcGroupId }, { result }),
    });
  });

  register("batch_remove_todo", function (ws, msg) {
    const { todoIds: brIds, scope: brScope, agentId: brAgentId, groupId: brGroupId } = msg.payload as {
      todoIds: string[]; scope: "agent" | "group"; agentId?: string; groupId?: string;
    };
    const store = this.resolveTodoStore(brScope, brAgentId, brGroupId);
    if (!store) { this.sendToClient(ws, { type: "error", payload: { message: "无法确定 TODO 存储" } }); return; }
    const result = store.batchRemove(brIds);
    this.sendToClient(ws, { type: "todo_batch_result", payload: { action: "remove", scope: brScope, agentId: brAgentId, groupId: brGroupId, ...result } });
    this.broadcast({
      type: "todo_updated",
      payload: buildTodoMutationPayload("batch-removed", { scope: brScope, agentId: brAgentId, groupId: brGroupId }, { result }),
    });
  });

  register("batch_update_todo", function (ws, msg) {
    const { todoIds: buIds, scope: buScope, agentId: buAgentId, groupId: buGroupId, targetAgentId } = msg.payload as {
      todoIds: string[]; scope: "agent" | "group"; agentId?: string; groupId?: string; targetAgentId?: string;
    };
    const store = this.resolveTodoStore(buScope, buAgentId, buGroupId);
    if (!store) { this.sendToClient(ws, { type: "error", payload: { message: "无法确定 TODO 存储" } }); return; }
    const result = store.batchUpdate(buIds, { targetAgentId });
    this.sendToClient(ws, { type: "todo_batch_result", payload: { action: "update", scope: buScope, agentId: buAgentId, groupId: buGroupId, ...result } });
    this.broadcast({
      type: "todo_updated",
      payload: buildTodoMutationPayload("batch-updated", { scope: buScope, agentId: buAgentId, groupId: buGroupId }, { result, targetAgentId }),
    });
  });

  register("get_global_todos", function (ws, msg) {
    const gts = (globalThis as any).__cobeing?.runtime?.globalTodoStore;
    if (!gts) {
      this.sendToClient(ws, { type: "error", payload: { message: "GlobalTodoStore 未初始化" } });
      return;
    }
    const items = gts.list();
    this.sendToClient(ws, { type: "global_todos", payload: { todos: items } });
  });
}
