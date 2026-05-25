// packages/core/src/group/host-tools.test.ts
import { describe, it, expect, vi } from "vitest";
import {
  makeHostGuideDiscussionTool,
  makeHostDecomposeTaskTool,
  makeHostSummarizeProgressTool,
  makeHostRecordDecisionTool,
  makeHostManageTodoTool,
  makeHostReviewTodoTool,
} from "./host-tools.js";

function mockGroup() {
  return {
    postMessage: vi.fn(),
    ctxV2: {
      getMessages: vi.fn().mockReturnValue([
        { id: "1", fromAgentId: "alice", content: "讨论方案A", tag: "main", timestamp: Date.now(), mentions: [] },
      ]),
    },
    workspace: {
      updateTask: vi.fn(),
      appendProgress: vi.fn(),
      getSummary: vi.fn().mockReturnValue({ task: "", plan: "", progress: "" }),
    },
    config: { id: "g1", name: "test-group", members: ["alice", "bob"], owner: "host" },
  };
}

describe("host-guide-discussion", () => {
  it("posts discussion guide to group", async () => {
    const group = mockGroup();
    const tool = makeHostGuideDiscussionTool(() => group as any);
    const result = await tool.execute(
      { groupId: "g1", topic: "方案选择", goals: "确定最终方案" },
      { agentId: "host" } as any,
    );
    expect(group.postMessage).toHaveBeenCalledWith("host", expect.stringContaining("方案选择"));
    expect(result.isError).toBeFalsy();
  });

  it("returns error for missing group", async () => {
    const tool = makeHostGuideDiscussionTool(() => undefined);
    const result = await tool.execute({ groupId: "missing", topic: "test" }, { agentId: "host" } as any);
    expect(result.isError).toBe(true);
  });
});

describe("host-decompose-task", () => {
  it("creates TODOs for subtasks", async () => {
    const addTodo = vi.fn().mockReturnValue({ id: "todo-1", title: "sub-1" });
    const group = mockGroup();
    const tool = makeHostDecomposeTaskTool(() => group as any, addTodo);
    const result = await tool.execute(
      {
        groupId: "g1",
        task: "实现登录功能",
        subtasks: [
          { title: "设计接口", assignee: "alice", triggerAt: "2026-04-26T09:00:00+08:00" },
          { title: "实现后端", assignee: "bob", triggerAt: "2026-04-27T09:00:00+08:00" },
        ],
      },
      { agentId: "host" } as any,
    );
    expect(addTodo).toHaveBeenCalledTimes(2);
    expect(group.postMessage).toHaveBeenCalled();
    expect(result.isError).toBeFalsy();
  });
});

describe("host-summarize-progress", () => {
  it("writes summary to group workspace", async () => {
    const group = mockGroup();
    const tool = makeHostSummarizeProgressTool(() => group as any);
    const result = await tool.execute(
      { groupId: "g1", summary: "完成方案讨论，确定方案A" },
      { agentId: "host" } as any,
    );
    expect(group.workspace.appendProgress).toHaveBeenCalled();
    expect(result.isError).toBeFalsy();
  });
});

describe("host-record-decision", () => {
  it("records decision to group context and file", async () => {
    const group = mockGroup();
    const appendDecision = vi.fn();
    const tool = makeHostRecordDecisionTool(() => group as any, appendDecision);
    const result = await tool.execute(
      { groupId: "g1", decision: "采用方案A", reason: "性能更好" },
      { agentId: "host" } as any,
    );
    expect(group.postMessage).toHaveBeenCalled();
    expect(appendDecision).toHaveBeenCalled();
    expect(result.isError).toBeFalsy();
  });
});

describe("host-manage-todo", () => {
  it("lists group todos", async () => {
    const listTodos = vi.fn().mockReturnValue([
      { id: "t1", title: "task-1", status: "pending", triggerAt: "2026-04-26T09:00:00+08:00" },
    ]);
    const tool = makeHostManageTodoTool(listTodos);
    const result = await tool.execute(
      { action: "list", groupId: "g1" },
      { agentId: "host" } as any,
    );
    expect(listTodos).toHaveBeenCalled();
    expect(result.content).toContain("task-1");
  });

  it("returns empty message when no todos", async () => {
    const listTodos = vi.fn().mockReturnValue([]);
    const tool = makeHostManageTodoTool(listTodos);
    const result = await tool.execute(
      { action: "list", groupId: "g1" },
      { agentId: "host" } as any,
    );
    expect(result.content).toBe("没有 TODO");
  });

  it("assigns todo to member", async () => {
    const updateTodo = vi.fn().mockReturnValue({ id: "t1" });
    const tool = makeHostManageTodoTool(() => [], updateTodo);
    const result = await tool.execute(
      { action: "assign", groupId: "g1", todoId: "t1", assignee: "alice" },
      { agentId: "host" } as any,
    );
    expect(updateTodo).toHaveBeenCalled();
  });

  it("returns error for unknown action", async () => {
    const tool = makeHostManageTodoTool(() => []);
    const result = await tool.execute(
      { action: "unknown", groupId: "g1" },
      { agentId: "host" } as any,
    );
    expect(result.isError).toBe(true);
  });
});

describe("host-review-todo", () => {
  it("reviews overdue todos and recommends action", async () => {
    const getDueTodos = vi.fn().mockReturnValue([
      { id: "t1", title: "overdue-task", targetAgentId: "alice", triggerAt: "2026-04-20T09:00:00+08:00" },
    ]);
    const tool = makeHostReviewTodoTool(getDueTodos);
    const result = await tool.execute(
      { groupId: "g1" },
      { agentId: "host" } as any,
    );
    expect(result.content).toContain("overdue-task");
  });

  it("returns no due todos message", async () => {
    const getDueTodos = vi.fn().mockReturnValue([]);
    const tool = makeHostReviewTodoTool(getDueTodos);
    const result = await tool.execute(
      { groupId: "g1" },
      { agentId: "host" } as any,
    );
    expect(result.content).toContain("没有到期");
  });
});
