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
});
