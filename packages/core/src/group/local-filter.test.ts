// packages/core/src/group/local-filter.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { LocalFilterEngine } from "./local-filter.js";
import type { GroupMessageV2 } from "./group-context-v2.js";

describe("LocalFilterEngine", () => {
  let engine: LocalFilterEngine;

  beforeEach(() => {
    engine = new LocalFilterEngine();
  });

  it("starts disabled when model not loaded", () => {
    expect(engine.isEnabled()).toBe(false);
  });

  it("evaluate returns default wake result when disabled", async () => {
    const messages: GroupMessageV2[] = [
      { id: "1", fromAgentId: "alice", content: "test", tag: "main", timestamp: Date.now(), mentions: [] },
    ];
    const result = await engine.evaluate("test-group", messages);
    expect(result.shouldWake).toBe(true);
    expect(result.priority).toBe("normal");
  });

  it("parseFilterResult parses valid JSON", () => {
    const json = '{"shouldWake": true, "reason": "有新问题", "summary": "讨论方案", "priority": "high"}';
    const result = (engine as any).parseFilterResult(json);
    expect(result.shouldWake).toBe(true);
    expect(result.reason).toBe("有新问题");
    expect(result.priority).toBe("high");
  });

  it("parseFilterResult handles invalid JSON gracefully", () => {
    const result = (engine as any).parseFilterResult("not json");
    expect(result.shouldWake).toBe(true);
    expect(result.priority).toBe("normal");
  });

  it("parseFilterResult handles partial JSON", () => {
    const json = '{"shouldWake": false}';
    const result = (engine as any).parseFilterResult(json);
    expect(result.shouldWake).toBe(false);
    expect(result.reason).toBe("");
  });

  it("parseFilterResult defaults shouldWake to true for missing field", () => {
    const json = '{"reason": "test"}';
    const result = (engine as any).parseFilterResult(json);
    expect(result.shouldWake).toBe(true);
  });

  it("dispose does not throw when not initialized", () => {
    expect(() => engine.dispose()).not.toThrow();
  });

  it("evaluate handles empty messages when disabled", async () => {
    const result = await engine.evaluate("test-group", []);
    expect(result.shouldWake).toBe(true);
  });
});
