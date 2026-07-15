import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

vi.mock("better-sqlite3", () => ({
  default: class BrokenDatabase {
    constructor() {
      throw new Error("mock missing native binding");
    }
  },
}));

import { ObservabilityDB } from "./observability-db.js";

describe("ObservabilityDB", () => {
  let tmpDir: string;
  let db: ObservabilityDB | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "observability-db-test-"));
  });

  afterEach(() => {
    db?.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("records metrics when the sqlite native binding is unavailable", () => {
    const now = Date.now();

    expect(() => {
      db = new ObservabilityDB(tmpDir);
    }).not.toThrow();

    db!.insertLLMCall({
      agent_id: "agent-1",
      agent_name: "Agent One",
      group_id: "group-1",
      model: "test-model",
      provider: "test-provider",
      latency_ms: 120,
      input_tokens: 10,
      output_tokens: 20,
      cache_hit_tokens: 2,
      cache_miss_tokens: 8,
      is_error: 0,
      fallback_used: 1,
      round: 1,
      timestamp: now,
    });
    db!.insertLLMCall({
      agent_id: "agent-2",
      agent_name: "Agent Two",
      group_id: "group-2",
      model: "test-model",
      provider: "test-provider",
      latency_ms: 500,
      input_tokens: 100,
      output_tokens: 200,
      cache_hit_tokens: 0,
      cache_miss_tokens: 0,
      is_error: 1,
      error_message: "rate limited",
      fallback_used: 0,
      round: 1,
      timestamp: now,
    });
    db!.insertToolCall({
      agent_id: "agent-1",
      agent_name: "Agent One",
      group_id: "group-1",
      tool_name: "search",
      is_error: 1,
      latency_ms: 80,
      param_chars: 12,
      result_chars: 0,
      timestamp: now,
    });

    const dashboard = db!.getDashboard("group-1");
    expect(dashboard.tokens.total).toBe(30);
    expect(dashboard.tokens.today).toBe(30);
    expect(dashboard.errors.llmTotal).toBe(1);
    expect(dashboard.errors.fallbackCount).toBe(1);
    expect(dashboard.errors.toolErrorRate).toBe(100);
    expect(dashboard.tools[0]).toMatchObject({ name: "search", count: 1, errorRate: 100 });
    expect(dashboard.agents[0]).toMatchObject({ agentId: "agent-1", agentName: "Agent One", callCount: 1, totalTokens: 30 });

    const llmStats = db!.getLLMStats({ groupId: "group-1" });
    expect(llmStats.total).toBe(1);
    expect(llmStats.calls[0].agent_id).toBe("agent-1");

    const toolStats = db!.getToolStats({ agentId: "agent-1" });
    expect(toolStats.total).toBe(1);
    expect(toolStats.calls[0].tool_name).toBe("search");

    const fallbackPath = path.join(tmpDir, "observability", "observability.db.fallback.json");
    expect(fs.existsSync(fallbackPath)).toBe(true);

    db!.close();
    db = new ObservabilityDB(tmpDir);
    expect(db.getLLMStats({ groupId: "group-1" }).total).toBe(1);
    expect(db.getToolStats({ groupId: "group-1" }).total).toBe(1);
  });
});
