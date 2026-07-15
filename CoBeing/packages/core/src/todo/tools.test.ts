import { describe, expect, it, vi } from "vitest";
import {
  makeTodoBatchCompleteTool,
  makeTodoReviewTool,
} from "./tools.js";

describe("todo tools group completion", () => {
  it("batch-completes group todos through the group scanner", async () => {
    const scanner = {
      complete: vi.fn().mockResolvedValue({ id: "todo-1", title: "上游任务" }),
    };
    const tool = makeTodoBatchCompleteTool(
      "data",
      undefined,
      () => scanner as any,
    );

    const result = await tool.execute(
      { scope: "group", groupId: "g1", todoIds: ["todo-1"] },
      { agentId: "host" } as any,
    );

    expect(scanner.complete).toHaveBeenCalledWith("todo-1");
    expect(result.content).toContain("1 条成功");
  });

  it("approves group todo reviews through the group scanner", async () => {
    const scanner = {
      complete: vi.fn().mockResolvedValue({ id: "todo-1", title: "验收任务" }),
    };
    const tool = makeTodoReviewTool(
      "data",
      undefined,
      () => scanner as any,
    );

    const result = await tool.execute(
      { scope: "group", groupId: "g1", todoId: "todo-1", decision: "approve" },
      { agentId: "host" } as any,
    );

    expect(scanner.complete).toHaveBeenCalledWith("todo-1");
    expect(result.content).toContain("已通过");
  });
});
