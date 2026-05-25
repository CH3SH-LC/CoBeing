import { describe, it, expect } from "vitest";
import { getRole, canManageGroup, type GroupRole } from "./roles.js";
import type { GroupConfig } from "@cobeing/shared";

describe("GroupRole", () => {
  const config: GroupConfig = {
    id: "g1",
    name: "test-group",
    members: ["agent-a", "agent-b"],
    owner: "owner-agent",
  };

  describe("getRole", () => {
    it("identifies user role", () => {
      expect(getRole("user", config)).toBe("user");
    });

    it("identifies owner role", () => {
      expect(getRole("owner-agent", config)).toBe("owner");
    });

    it("identifies member role", () => {
      expect(getRole("agent-a", config)).toBe("member");
    });

    it("defaults to member for unknown agents", () => {
      expect(getRole("stranger", config)).toBe("member");
    });

    it("defaults to member when no owner is set", () => {
      const noOwner = { ...config, owner: undefined };
      expect(getRole("owner-agent", noOwner)).toBe("member");
    });
  });

  describe("canManageGroup", () => {
    it("user can manage", () => {
      expect(canManageGroup("user", config)).toBe(true);
    });

    it("owner can manage", () => {
      expect(canManageGroup("owner-agent", config)).toBe(true);
    });

    it("member cannot manage", () => {
      expect(canManageGroup("agent-a", config)).toBe(false);
    });
  });
});
