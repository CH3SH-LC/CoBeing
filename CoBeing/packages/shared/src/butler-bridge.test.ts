import { describe, expect, it } from "vitest";
import {
  CORE_AGENT_IDS,
  DEFAULT_ALLOWED_EVENTS,
  DEFAULT_ESCALATION_POLICY,
} from "./butler-bridge.js";

describe("CORE_AGENT_IDS", () => {
  it("contains butler and host", () => {
    expect(CORE_AGENT_IDS.has("butler")).toBe(true);
    expect(CORE_AGENT_IDS.has("host")).toBe(true);
  });

  it("does not contain arbitrary ids", () => {
    expect(CORE_AGENT_IDS.has("random-agent")).toBe(false);
    expect(CORE_AGENT_IDS.has("")).toBe(false);
  });

  it("is a Set with size 2", () => {
    expect(CORE_AGENT_IDS.size).toBe(2);
  });
});

describe("DEFAULT_ESCALATION_POLICY", () => {
  it("has all escalation policies set", () => {
    expect(DEFAULT_ESCALATION_POLICY.routineProgress).toBe("silent");
    expect(DEFAULT_ESCALATION_POLICY.blocked).toBe("notify");
    expect(DEFAULT_ESCALATION_POLICY.needsUserDecision).toBe("notify");
    expect(DEFAULT_ESCALATION_POLICY.completed).toBe("notify");
    expect(DEFAULT_ESCALATION_POLICY.failed).toBe("notify");
    expect(DEFAULT_ESCALATION_POLICY.scopeChange).toBe("notify");
  });
});

describe("DEFAULT_ALLOWED_EVENTS", () => {
  it("contains all six event types", () => {
    expect(DEFAULT_ALLOWED_EVENTS).toContain("needs_user_decision");
    expect(DEFAULT_ALLOWED_EVENTS).toContain("blocked");
    expect(DEFAULT_ALLOWED_EVENTS).toContain("completed");
    expect(DEFAULT_ALLOWED_EVENTS).toContain("failed");
    expect(DEFAULT_ALLOWED_EVENTS).toContain("scope_change");
    expect(DEFAULT_ALLOWED_EVENTS).toContain("status_digest");
  });

  it("has exactly six items", () => {
    expect(DEFAULT_ALLOWED_EVENTS).toHaveLength(6);
  });
});
