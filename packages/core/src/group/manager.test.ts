import { describe, it, expect } from "vitest";
import { GroupManager } from "./manager.js";
import { AgentRegistry } from "../agent/registry.js";

describe("GroupManager", () => {
  it("creates and retrieves a group", () => {
    const reg = new AgentRegistry();
    const mgr = new GroupManager(reg);
    const g = mgr.create({ id: "g1", name: "test", members: [] });
    expect(mgr.get("g1")).toBe(g);
  });

  it("lists groups", () => {
    const reg = new AgentRegistry();
    const mgr = new GroupManager(reg);
    mgr.create({ id: "g1", name: "a", members: [] });
    mgr.create({ id: "g2", name: "b", members: [] });
    expect(mgr.list()).toHaveLength(2);
  });

  it("deletes a group", () => {
    const reg = new AgentRegistry();
    const mgr = new GroupManager(reg);
    mgr.create({ id: "g1", name: "a", members: [] });
    mgr.delete("g1");
    expect(mgr.get("g1")).toBeUndefined();
  });
});
