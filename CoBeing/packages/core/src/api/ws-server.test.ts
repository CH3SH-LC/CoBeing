import { describe, expect, it } from "vitest";
import { buildGroupCreatorDraftNote, buildTodoMutationPayload } from "./ws-server.js";

describe("buildTodoMutationPayload", () => {
  it("includes group scope context for removed todos", () => {
    const payload = buildTodoMutationPayload(
      "removed",
      { scope: "group", groupId: "travel-team" },
      { todoId: "todo-1" },
    );

    expect(payload).toEqual({
      action: "removed",
      scope: "group",
      groupId: "travel-team",
      todoId: "todo-1",
    });
  });

  it("includes agent scope context for added todos", () => {
    const todo = {
      id: "todo-2",
      title: "整理资料",
      description: "把旅行资料归档",
      status: "pending" as const,
      triggerAt: "2026-06-09T08:00:00.000Z",
      recurrenceHint: "不重复",
      createdBy: "user",
      createdAt: "2026-06-08T08:00:00.000Z",
      agentId: "researcher",
    };

    const payload = buildTodoMutationPayload(
      "added",
      { scope: "agent", agentId: "researcher" },
      { todo },
    );

    expect(payload).toEqual({
      action: "added",
      scope: "agent",
      agentId: "researcher",
      todo,
    });
  });
});

describe("buildGroupCreatorDraftNote", () => {
  it("formats member gaps, initial tasks, and user confirmations for host handoff", () => {
    const note = buildGroupCreatorDraftNote({
      guide: "# GUIDE",
      plan: "# PLAN",
      memberSuggestions: [
        { role: "资料检索", reason: "需要查证来源", suggestedName: "研究员" },
      ],
      initialTasks: [
        { title: "澄清范围", assigneeHint: "host", acceptance: "形成范围清单" },
      ],
      userConfirmations: ["是否允许联网检索？"],
    });

    expect(note).toContain("Creator 建议补充的成员缺口");
    expect(note).toContain("资料检索（建议名：研究员）：需要查证来源");
    expect(note).toContain("澄清范围（建议承担：host）；验收：形成范围清单");
    expect(note).toContain("是否允许联网检索？");
  });
});
