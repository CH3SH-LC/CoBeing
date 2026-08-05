import type { TodoMutationPayload } from "@/lib/types";
import { useActivityStore } from "@/stores/activity";
import type { WsHandlerContext, WsMessageHandler } from "./types";

export function buildTodoHandlers(ctx: WsHandlerContext): Record<string, WsMessageHandler> {
  const { setTodos } = ctx;

  return {
    todos: (msg) => {
      const tp = msg.payload as { todos: any[] };
      setTodos(tp.todos);
    },

    todo_added: (msg) => {
      const ta = msg.payload as TodoMutationPayload;
      const todo = ta.todo;
      if (!todo) return;
      useActivityStore.getState().addTodoChange({
        action: "added",
        title: todo.title,
        scope: ta.scope || (todo.agentId ? "agent" : "group"),
        agentId: ta.agentId || todo.agentId || todo.targetAgentId,
        groupId: ta.groupId || todo.groupId,
      });
      window.dispatchEvent(new CustomEvent("ws-todo-updated", { detail: msg }));
    },

    todo_completed: (msg) => {
      const tc = msg.payload as TodoMutationPayload;
      const todo = tc.todo;
      if (!todo) return;
      useActivityStore.getState().addTodoChange({
        action: "completed",
        title: todo.title,
        scope: tc.scope || (todo.agentId ? "agent" : "group"),
        agentId: tc.agentId || todo.agentId || todo.targetAgentId,
        groupId: tc.groupId || todo.groupId,
      });
      window.dispatchEvent(new CustomEvent("ws-todo-updated", { detail: msg }));
    },

    todo_removed: (msg) => {
      const tr = msg.payload as TodoMutationPayload;
      useActivityStore.getState().addTodoChange({
        action: "removed",
        title: tr.todoId || "TODO",
        scope: tr.scope || "agent",
        agentId: tr.agentId,
        groupId: tr.groupId,
      });
      window.dispatchEvent(new CustomEvent("ws-todo-updated", { detail: msg }));
    },

    todo_updated: (msg) => {
      window.dispatchEvent(new CustomEvent("ws-todo-updated", { detail: msg }));
    },

    todo_batch_result: (msg) => {
      window.dispatchEvent(new CustomEvent("ws-todo-updated", { detail: msg }));
    },

    global_todos: (msg) => {
      window.dispatchEvent(new CustomEvent("ws-global-todos", { detail: msg }));
    },

    global_todo_updated: () => {
      window.dispatchEvent(new CustomEvent("ws-global-todo-updated"));
    },
  };
}
