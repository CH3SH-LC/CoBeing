import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { GlobalTodoStore } from "./global-store.js";
import type { GlobalTodoItem } from "@cobeing/shared";

function makeTodo(
  title: string,
  status: GlobalTodoItem["status"],
  assigneeType: GlobalTodoItem["assigneeType"] = "agent",
  assigneeId = "a1",
): Omit<GlobalTodoItem, "id" | "createdAt" | "updatedAt"> {
  return {
    title,
    description: `Description for ${title}`,
    status,
    assigneeType,
    assigneeId,
    automationPolicy: { autoDispatch: true, autoMonitor: true, autoEscalate: true, autoArchive: true, autoContinue: true },
    progressSummary: "",
    nextAction: "",
    executionRefs: [],
    createdBy: "user",
  };
}

describe("GlobalTodoStore", () => {
  let tmpDir: string;
  let store: GlobalTodoStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "global-todo-test-"));
    store = new GlobalTodoStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("add", () => {
    it("creates a new global todo item with auto-generated id and timestamps", () => {
      const item = store.add(makeTodo("Plan trip", "pending", "group", "group-1"));

      expect(item.id).toBeTruthy();
      expect(typeof item.id).toBe("string");
      expect(item.title).toBe("Plan trip");
      expect(item.status).toBe("pending");
      expect(item.createdAt).toBeTruthy();
      expect(item.updatedAt).toBeTruthy();
    });

    it("sets default automationPolicy if not provided", () => {
      const item = store.add({
        title: "Test",
        description: "",
        status: "pending",
        assigneeType: "butler",
        createdBy: "user",
        progressSummary: "",
        nextAction: "",
        executionRefs: [],
        automationPolicy: { autoDispatch: true, autoMonitor: true, autoEscalate: true, autoArchive: true, autoContinue: true },
      });
      expect(item.automationPolicy.autoDispatch).toBe(true);
    });
  });

  describe("get", () => {
    it("returns item by id", () => {
      const created = store.add(makeTodo("Test", "pending"));
      const found = store.get(created.id);
      expect(found).toBeDefined();
      expect(found!.title).toBe("Test");
    });

    it("returns undefined for non-existent id", () => {
      expect(store.get("nonexistent")).toBeUndefined();
    });
  });

  describe("update", () => {
    it("updates fields and refreshes updatedAt", () => {
      const created = store.add(makeTodo("Original", "pending"));
      const originalUpdatedAt = created.updatedAt;

      const updated = store.update(created.id, {
        status: "running",
        progressSummary: "working on it",
        nextAction: "continue",
      } as any);

      expect(updated).toBeDefined();
      expect(updated!.status).toBe("running");
      expect(updated!.progressSummary).toBe("working on it");
      expect(updated!.title).toBe("Original"); // unchanged fields preserved
      expect(updated!.updatedAt).not.toBe(originalUpdatedAt);
    });

    it("returns undefined for non-existent id", () => {
      expect(store.update("nonexistent", { status: "completed" } as any)).toBeUndefined();
    });
  });

  describe("remove", () => {
    it("removes item and returns true", () => {
      const created = store.add(makeTodo("To delete", "pending", "butler", "butler"));
      expect(store.remove(created.id)).toBe(true);
      expect(store.get(created.id)).toBeUndefined();
    });

    it("returns false for non-existent id", () => {
      expect(store.remove("nonexistent")).toBe(false);
    });
  });

  describe("list", () => {
    it("returns all items without filter", () => {
      store.add(makeTodo("A", "pending"));
      store.add(makeTodo("B", "completed", "group", "g1"));
      expect(store.list()).toHaveLength(2);
    });

    it("filters by status", () => {
      store.add(makeTodo("A", "pending"));
      store.add(makeTodo("B", "completed"));
      const pending = store.list("pending");
      expect(pending).toHaveLength(1);
      expect(pending[0].title).toBe("A");
    });
  });

  describe("getByAssignee", () => {
    it("returns all items for a given assignee", () => {
      store.add(makeTodo("Task 1", "pending", "group", "g1"));
      store.add(makeTodo("Task 2", "running", "group", "g1"));
      store.add(makeTodo("Task 3", "pending", "agent", "a1"));

      const g1Items = store.getByAssignee("g1");
      expect(g1Items).toHaveLength(2);
    });
  });

  describe("getByExecutionRef", () => {
    it("finds reverse references by scope and id", () => {
      const item = store.add({
        ...makeTodo("Linked task", "running", "group", "g1"),
        executionRefs: [
          { scope: "group", id: "g1", todoIds: ["t1", "t2"] },
          { scope: "agent", id: "a1", todoIds: ["t3"] },
        ],
      });

      const groupRefs = store.getByExecutionRef("group", "g1");
      expect(groupRefs).toHaveLength(1);
      expect(groupRefs[0].id).toBe(item.id);

      const agentRefs = store.getByExecutionRef("agent", "a1");
      expect(agentRefs).toHaveLength(1);
    });
  });

  describe("getWaitingUser", () => {
    it("returns only waiting_user items", () => {
      store.add(makeTodo("w1", "waiting_user"));
      store.add(makeTodo("w2", "running"));
      store.add(makeTodo("w3", "waiting_user"));
      expect(store.getWaitingUser()).toHaveLength(2);
    });
  });

  describe("getStalled", () => {
    it("returns long-unupdated running todos", () => {
      const item = store.add(makeTodo("stale", "running"));
      store.update(item.id, {
        updatedAt: new Date(Date.now() - 3 * 3600000).toISOString(),
      } as any);
      expect(store.getStalled(2)).toHaveLength(1);
      expect(store.getStalled(5)).toHaveLength(0);
    });
  });

  describe("setStatus / setBlocker / clearBlocker", () => {
    it("transitions status", () => {
      const item = store.add(makeTodo("test", "pending"));
      expect(store.setStatus(item.id, "running")).toBe(true);
      expect(store.get(item.id)!.status).toBe("running");
    });

    it("sets and clears blocker", () => {
      const item = store.add(makeTodo("test", "running"));
      const blocker = { type: "agent_stalled" as const, summary: "No response", since: new Date().toISOString() };
      expect(store.setBlocker(item.id, blocker)).toBe(true);
      expect(store.get(item.id)!.internalBlocker?.summary).toBe("No response");
      expect(store.clearBlocker(item.id)).toBe(true);
      expect(store.get(item.id)!.internalBlocker).toBeUndefined();
    });
  });

  describe("addExecutionRef", () => {
    it("adds new ref", () => {
      const item = store.add(makeTodo("test", "running"));
      expect(store.addExecutionRef(item.id, { scope: "group", id: "g1", todoIds: ["t1"] })).toBe(true);
      expect(store.get(item.id)!.executionRefs).toHaveLength(1);
    });

    it("merges with existing ref for same scope+id", () => {
      const item = store.add({
        ...makeTodo("test", "running"),
        executionRefs: [{ scope: "group", id: "g1", todoIds: ["t1"] }],
      });
      store.addExecutionRef(item.id, { scope: "group", id: "g1", todoIds: ["t2"] });
      expect(store.get(item.id)!.executionRefs).toHaveLength(1);
      expect(store.get(item.id)!.executionRefs[0].todoIds).toEqual(["t1", "t2"]);
    });

    it("returns false for non-existent todo", () => {
      expect(store.addExecutionRef("nonexistent", { scope: "group", id: "g1" })).toBe(false);
    });
  });

  describe("getByButlerTaskId", () => {
    it("finds item by butlerTaskId", () => {
      store.add({
        ...makeTodo("Test", "pending", "group", "g1"),
        butlerTaskId: "bt-1",
        createdBy: "butler",
      });
      const found = store.getByButlerTaskId("bt-1");
      expect(found).toBeDefined();
      expect(found!.title).toBe("Test");
    });

    it("returns undefined when no match", () => {
      expect(store.getByButlerTaskId("nonexistent")).toBeUndefined();
    });
  });

  describe("count", () => {
    it("returns the number of items", () => {
      expect(store.count).toBe(0);
      store.add(makeTodo("A", "pending"));
      expect(store.count).toBe(1);
      store.add(makeTodo("B", "pending"));
      expect(store.count).toBe(2);
    });
  });

  describe("persistence round-trip", () => {
    it("survives store re-creation", () => {
      const store1 = new GlobalTodoStore(tmpDir);
      const created = store1.add(makeTodo("Persist me", "pending"));
      const store2 = new GlobalTodoStore(tmpDir);
      const loaded = store2.get(created.id);
      expect(loaded).toBeDefined();
      expect(loaded!.title).toBe("Persist me");
    });
  });
});
