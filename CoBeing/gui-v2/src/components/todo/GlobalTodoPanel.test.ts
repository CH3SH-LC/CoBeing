import { describe, expect, it } from "vitest";
import type { GlobalTodoInfo } from "@/lib/types";
import { buildGlobalTodoPanelModel, getGlobalTodoDisplayLines } from "./GlobalTodoPanel";

function makeTodo(overrides: Partial<GlobalTodoInfo>): GlobalTodoInfo {
  return {
    id: "todo",
    title: "Untitled",
    description: "",
    status: "pending",
    assigneeType: "butler",
    progressSummary: "",
    nextAction: "",
    executionRefs: [],
    createdAt: "2026-06-12T00:00:00.000Z",
    updatedAt: "2026-06-12T00:00:00.000Z",
    ...overrides,
  };
}

describe("GlobalTodoPanel display model", () => {
  it("separates active, completed, and cancelled global tasks", () => {
    const model = buildGlobalTodoPanelModel([
      makeTodo({ id: "pending", status: "pending" }),
      makeTodo({ id: "running", status: "running" }),
      makeTodo({ id: "waiting", status: "waiting_user" }),
      makeTodo({ id: "done", status: "completed" }),
      makeTodo({ id: "cancelled", status: "cancelled" }),
    ]);

    expect(model.counts).toEqual({
      pending: 1,
      running: 1,
      waitingUser: 1,
      completed: 1,
      cancelled: 1,
    });
    expect(model.activeTodos.map((todo) => todo.id)).toEqual(["pending", "running", "waiting"]);
    expect(model.completedTodos.map((todo) => todo.id)).toEqual(["done"]);
    expect(model.cancelledTodos.map((todo) => todo.id)).toEqual(["cancelled"]);
  });

  it("shows progress, next action, assignment, and execution refs from real global todo fields", () => {
    const lines = getGlobalTodoDisplayLines(makeTodo({
      id: "global-1",
      title: "\u6574\u7406\u8d44\u6599",
      description: "\u6536\u96c6\u4e09\u4efd\u53c2\u8003\u8d44\u6599",
      status: "running",
      assigneeType: "group",
      assigneeId: "research-team",
      responsibleAgentId: "agent-librarian",
      progressSummary: "\u5df2\u5b8c\u6210\u4e24\u4efd\u8d44\u6599\u6574\u7406",
      nextAction: "\u7b49\u5f85\u7b2c\u4e09\u4efd\u8d44\u6599\u786e\u8ba4",
      executionRefs: [
        { scope: "group", id: "research-team", todoIds: ["g1", "g2"] },
        { scope: "agent", id: "agent-librarian", todoIds: ["a1"] },
      ],
    }));

    // 2026-07-08 \u8d77 GlobalTodoPanel \u91c7\u7528\u7d27\u51d1\u5c55\u793a\uff1abody \u5408\u5e76\u8fdb\u5ea6+\u4e0b\u4e00\u6b65\u4e3a\u5355\u884c\uff0cmeta \u4ec5\u6307\u6d3e\u884c
    expect(lines.body).toEqual([
      "\u5df2\u5b8c\u6210\u4e24\u4efd\u8d44\u6599\u6574\u7406 \u00b7 \u7b49\u5f85\u7b2c\u4e09\u4efd\u8d44\u6599\u786e\u8ba4",
    ]);
    expect(lines.meta).toEqual([
      "\u6307\u6d3e\uff1a\u7fa4\u7ec4 research-team",
    ]);
  });
});
