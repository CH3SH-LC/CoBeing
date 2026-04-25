// packages/core/src/integration/host-filter.integration.test.ts
import { describe, it, expect } from "vitest";
import { LocalFilterEngine } from "../group/local-filter.js";

describe("Host Filter Integration", () => {
  it("LocalFilterEngine degrades gracefully when model not available", async () => {
    const engine = new LocalFilterEngine();
    expect(engine.isEnabled()).toBe(false);

    const result = await engine.evaluate("test-group", []);
    expect(result.shouldWake).toBe(true);
    expect(result.reason).toContain("未启用");
  });

  it("LocalFilterEngine handles empty messages", async () => {
    const engine = new LocalFilterEngine();
    const result = await engine.evaluate("test-group", []);
    expect(result.shouldWake).toBe(true);
  });

  it("LocalFilterEngine dispose is safe to call multiple times", () => {
    const engine = new LocalFilterEngine();
    engine.dispose();
    engine.dispose();
    expect(engine.isEnabled()).toBe(false);
  });
});
