import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ButlerRegistry } from "./registry.js";

describe("ButlerRegistry", () => {
  let tmpDir: string;
  let registry: ButlerRegistry;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "butler-registry-test-"));
    registry = new ButlerRegistry(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("Agent Registry", () => {
    it("registers an agent", () => {
      registry.registerAgent({
        id: "react-expert",
        name: "React 专家",
        role: "React 前端专家",
        capabilities: "React 组件设计、性能优化、TypeScript",
      });

      const agents = registry.parseAgentsRegistry();
      expect(agents).toHaveLength(1);
      expect(agents[0].id).toBe("react-expert");
      expect(agents[0].role).toBe("React 前端专家");
      expect(agents[0].capabilities).toBe("React 组件设计、性能优化、TypeScript");
    });

    it("updates an existing agent", () => {
      registry.registerAgent({ id: "a1", name: "A1", role: "dev" });
      registry.registerAgent({ id: "a1", name: "A1", role: "senior dev", capabilities: "Go, Rust" });

      const agents = registry.parseAgentsRegistry();
      expect(agents).toHaveLength(1);
      expect(agents[0].role).toBe("senior dev");
      expect(agents[0].capabilities).toBe("Go, Rust");
    });

    it("unregisters an agent", () => {
      registry.registerAgent({ id: "a1", name: "A1", role: "dev" });
      registry.registerAgent({ id: "a2", name: "A2", role: "ops" });
      registry.unregisterAgent("a1");

      const agents = registry.parseAgentsRegistry();
      expect(agents).toHaveLength(1);
      expect(agents[0].id).toBe("a2");
    });

    it("gets a single agent by id", () => {
      registry.registerAgent({ id: "vue-expert", name: "Vue 专家", role: "Vue 前端" });
      const agent = registry.getAgent("vue-expert");
      expect(agent).toBeDefined();
      expect(agent!.role).toBe("Vue 前端");
    });

    it("returns undefined for unknown agent", () => {
      expect(registry.getAgent("unknown")).toBeUndefined();
    });

    it("persists to markdown file", () => {
      registry.registerAgent({
        id: "test-agent",
        name: "Test",
        role: "tester",
        capabilities: "unit test, e2e",
        groups: ["qa-team"],
        status: "活跃",
      });

      const content = registry.readAgentsRegistry();
      expect(content).toContain("## test-agent");
      expect(content).toContain("tester");
      expect(content).toContain("unit test, e2e");
      expect(content).toContain("qa-team");
      expect(content).toContain("活跃");
    });
  });

  describe("Group Registry", () => {
    it("registers a group", () => {
      registry.registerGroup({
        id: "framework-debate",
        name: "框架辩论",
        members: ["react-expert", "vue-expert"],
        topic: "React vs Vue",
      });

      const groups = registry.parseGroupsRegistry();
      expect(groups).toHaveLength(1);
      expect(groups[0].id).toBe("framework-debate");
      expect(groups[0].members).toEqual(["react-expert", "vue-expert"]);
      expect(groups[0].topic).toBe("React vs Vue");
    });

    it("unregisters a group", () => {
      registry.registerGroup({ id: "g1", name: "G1", members: ["a"] });
      registry.unregisterGroup("g1");
      expect(registry.parseGroupsRegistry()).toHaveLength(0);
    });
  });

  describe("Task Log", () => {
    it("appends and reads task log", () => {
      registry.appendTaskLog({
        timestamp: "2026-04-15 10:00",
        task: "创建前后端分离项目",
        action: "create-agent x2, create-group",
        result: "成功",
      });

      const log = registry.readTaskLog();
      expect(log).toContain("创建前后端分离项目");
      expect(log).toContain("成功");
    });

    it("creates log file with header on first write", () => {
      registry.appendTaskLog({
        timestamp: "2026-04-15",
        task: "test",
        action: "test-action",
        result: "ok",
      });

      const content = registry.readTaskLog();
      expect(content).toContain("# 任务执行日志");
    });
  });
});
