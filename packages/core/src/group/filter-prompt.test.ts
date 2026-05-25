// packages/core/src/group/filter-prompt.test.ts
import { describe, it, expect } from "vitest";
import { buildFilterUserPrompt, FILTER_SYSTEM_PROMPT, FILTER_JSON_GRAMMAR } from "./filter-prompt.js";

describe("filter-prompt", () => {
  it("buildFilterUserPrompt formats messages correctly", () => {
    const messages = [
      { fromAgentId: "alice", content: "大家觉得这个方案怎么样？", timestamp: 1714000000000 },
      { fromAgentId: "bob", content: "我觉得可以", timestamp: 1714000060000 },
    ];
    const prompt = buildFilterUserPrompt("test-group", messages);

    expect(prompt).toContain("群组 test-group");
    expect(prompt).toContain("alice: 大家觉得这个方案怎么样？");
    expect(prompt).toContain("bob: 我觉得可以");
    expect(prompt).toContain("shouldWake");
  });

  it("FILTER_SYSTEM_PROMPT contains key instructions", () => {
    expect(FILTER_SYSTEM_PROMPT).toContain("不确定时一律选 shouldWake: true");
    expect(FILTER_SYSTEM_PROMPT).toContain("JSON");
  });

  it("FILTER_JSON_GRAMMAR defines valid structure", () => {
    expect(FILTER_JSON_GRAMMAR).toContain("shouldWake");
    expect(FILTER_JSON_GRAMMAR).toContain("boolean");
  });

  it("buildFilterUserPrompt handles empty messages", () => {
    const prompt = buildFilterUserPrompt("empty-group", []);
    expect(prompt).toContain("群组 empty-group");
    expect(prompt).toContain("shouldWake");
  });
});
