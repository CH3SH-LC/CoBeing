import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ButlerTaskStore } from "./butler-task-store.js";

describe("ButlerTaskStore", () => {
  let tmpDir: string;
  let store: ButlerTaskStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "butler-task-test-"));
    store = new ButlerTaskStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("create", () => {
    it("creates a task with auto-generated id", () => {
      const task = store.create({
        globalTodoId: "gt-1",
        title: "Plan trip",
        goal: "3-day Hangzhou trip",
        targetType: "group",
        targetId: "group-1",
        status: "routing",
      });

      expect(task.id).toBeTruthy();
      expect(task.globalTodoId).toBe("gt-1");
      expect(task.status).toBe("routing");
      expect(task.createdAt).toBeTruthy();
    });
  });

  describe("get", () => {
    it("returns task by id", () => {
      const created = store.create({
        globalTodoId: "gt-1",
        title: "Test",
        goal: "",
        targetType: "agent",
        targetId: "a1",
        status: "dispatched",
      });
      expect(store.get(created.id)?.title).toBe("Test");
    });
  });

  describe("update", () => {
    it("updates fields", () => {
      const created = store.create({
        globalTodoId: "gt-1",
        title: "Original",
        goal: "",
        targetType: "agent",
        targetId: "a1",
        status: "routing",
      });
      const updated = store.update(created.id, { title: "Updated", latestSummary: "In progress" });
      expect(updated?.title).toBe("Updated");
      expect(updated?.latestSummary).toBe("In progress");
    });
  });

  describe("transition", () => {
    it("allows valid routing -> dispatched", () => {
      const created = store.create({
        globalTodoId: "gt-1",
        title: "Test",
        goal: "",
        targetType: "group",
        targetId: "g1",
        status: "routing",
      });
      const result = store.transition(created.id, "dispatched");
      expect(result?.status).toBe("dispatched");
    });

    it("allows valid dispatched -> running", () => {
      const created = store.create({
        globalTodoId: "gt-1",
        title: "Test",
        goal: "",
        targetType: "group",
        targetId: "g1",
        status: "dispatched",
      });
      const result = store.transition(created.id, "running");
      expect(result?.status).toBe("running");
    });

    it("allows valid running -> waiting_user", () => {
      const created = store.create({
        globalTodoId: "gt-1",
        title: "Test",
        goal: "",
        targetType: "group",
        targetId: "g1",
        status: "running",
      });
      const result = store.transition(created.id, "waiting_user");
      expect(result?.status).toBe("waiting_user");
    });

    it("allows valid waiting_user -> completed", () => {
      const created = store.create({
        globalTodoId: "gt-1",
        title: "Test",
        goal: "",
        targetType: "group",
        targetId: "g1",
        status: "waiting_user",
      });
      const result = store.transition(created.id, "completed");
      expect(result?.status).toBe("completed");
    });

    it("allows completed -> running (rework)", () => {
      const created = store.create({
        globalTodoId: "gt-1",
        title: "Test",
        goal: "",
        targetType: "group",
        targetId: "g1",
        status: "completed",
      });
      const result = store.transition(created.id, "running");
      expect(result?.status).toBe("running");
    });

    it("rejects invalid routing -> completed", () => {
      const created = store.create({
        globalTodoId: "gt-1",
        title: "Test",
        goal: "",
        targetType: "group",
        targetId: "g1",
        status: "routing",
      });
      const result = store.transition(created.id, "completed");
      expect(result).toBeUndefined();
      expect(store.get(created.id)?.status).toBe("routing");
    });

    it("rejects transition from cancelled", () => {
      const created = store.create({
        globalTodoId: "gt-1",
        title: "Test",
        goal: "",
        targetType: "group",
        targetId: "g1",
        status: "cancelled",
      });
      const result = store.transition(created.id, "running");
      expect(result).toBeUndefined();
    });
  });

  describe("delete", () => {
    it("deletes and returns true", () => {
      const created = store.create({
        globalTodoId: "gt-1",
        title: "Delete me",
        goal: "",
        targetType: "agent",
        targetId: "a1",
        status: "routing",
      });
      expect(store.delete(created.id)).toBe(true);
      expect(store.get(created.id)).toBeUndefined();
    });
  });

  describe("list", () => {
    it("filters by status", () => {
      store.create({ globalTodoId: "gt-1", title: "A", goal: "", targetType: "agent", targetId: "a1", status: "routing" });
      store.create({ globalTodoId: "gt-2", title: "B", goal: "", targetType: "group", targetId: "g1", status: "running" });

      const routing = store.list({ status: "routing" });
      expect(routing).toHaveLength(1);
    });

    it("filters by targetType", () => {
      store.create({ globalTodoId: "gt-1", title: "A", goal: "", targetType: "agent", targetId: "a1", status: "routing" });
      store.create({ globalTodoId: "gt-2", title: "B", goal: "", targetType: "group", targetId: "g1", status: "routing" });

      expect(store.list({ targetType: "group" })).toHaveLength(1);
    });
  });

  describe("getByGlobalTodoId", () => {
    it("finds by global todo id", () => {
      store.create({ globalTodoId: "gt-1", title: "Test", goal: "", targetType: "agent", targetId: "a1", status: "routing" });
      expect(store.getByGlobalTodoId("gt-1")?.title).toBe("Test");
      expect(store.getByGlobalTodoId("nonexistent")).toBeUndefined();
    });
  });

  describe("getByTarget", () => {
    it("returns all tasks for a target", () => {
      store.create({ globalTodoId: "gt-1", title: "A", goal: "", targetType: "agent", targetId: "a1", status: "routing" });
      store.create({ globalTodoId: "gt-2", title: "B", goal: "", targetType: "agent", targetId: "a1", status: "running" });
      store.create({ globalTodoId: "gt-3", title: "C", goal: "", targetType: "agent", targetId: "a2", status: "routing" });

      expect(store.getByTarget("a1")).toHaveLength(2);
    });
  });

  describe("persistence round-trip", () => {
    it("survives store re-creation", () => {
      const s1 = new ButlerTaskStore(tmpDir);
      const created = s1.create({
        globalTodoId: "gt-1",
        title: "Persist",
        goal: "Test persistence",
        targetType: "group",
        targetId: "g1",
        status: "routing",
        acceptance: "Done",
      });

      const s2 = new ButlerTaskStore(tmpDir);
      const loaded = s2.get(created.id);
      expect(loaded?.title).toBe("Persist");
      expect(loaded?.acceptance).toBe("Done");
    });
  });

  describe("追加式状态变更事件日志（决策：TODO 单一真相源）", () => {
    it("create 写入 create 事件", () => {
      const task = store.create({ globalTodoId: "gt-ev", title: "T", goal: "", targetType: "agent", targetId: "a1", status: "routing" });
      expect(task.eventLog?.length).toBe(1);
      expect(task.eventLog?.[0].type).toBe("create");
      expect(task.eventLog?.[0].to).toBe("routing");
    });

    it("transition 追加 transition 事件（含 from/to）", () => {
      const task = store.create({ globalTodoId: "gt-ev2", title: "T2", goal: "", targetType: "agent", targetId: "a1", status: "routing" });
      const trans = store.transition(task.id, "dispatched");
      expect(trans?.eventLog?.length).toBe(2);
      expect(trans?.eventLog?.[1].type).toBe("transition");
      expect(trans?.eventLog?.[1].from).toBe("routing");
      expect(trans?.eventLog?.[1].to).toBe("dispatched");
    });

    it("非法 transition 不追加事件", () => {
      const task = store.create({ globalTodoId: "gt-ev3", title: "T3", goal: "", targetType: "agent", targetId: "a1", status: "cancelled" });
      const result = store.transition(task.id, "running"); // cancelled 是终态
      expect(result).toBeUndefined();
      const loaded = store.get(task.id);
      expect(loaded?.eventLog?.length).toBe(1); // 只有 create
    });

    it("update 追加 update 事件（记录变更字段）", () => {
      const task = store.create({ globalTodoId: "gt-ev4", title: "T4", goal: "", targetType: "agent", targetId: "a1", status: "routing" });
      const updated = store.update(task.id, { latestSummary: "progress 50%" });
      expect(updated?.eventLog?.length).toBe(2);
      expect(updated?.eventLog?.[1].type).toBe("update");
      expect(updated?.eventLog?.[1].fields).toContain("latestSummary");
    });

    it("事件日志持久化（store 重建后仍存在）", () => {
      const t = store.create({ globalTodoId: "gt-ev5", title: "T5", goal: "", targetType: "agent", targetId: "a1", status: "routing" });
      store.transition(t.id, "dispatched");
      const s2 = new ButlerTaskStore(tmpDir);
      const loaded = s2.get(t.id);
      expect(loaded?.eventLog?.length).toBe(2);
    });
  });
});
