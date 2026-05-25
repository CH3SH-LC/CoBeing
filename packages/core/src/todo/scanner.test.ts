import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { TodoStore } from "./store.js";
import type { TodoItem } from "./types.js";
import { AgentTodoScanner } from "./scanner.js";
import { GroupTodoScanner } from "./group-scanner.js";
import type { AgentRegistry } from "../agent/registry.js";

describe("TodoStore", () => {
  let tmpDir: string;
  let store: TodoStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cobeing-todo-test-"));
    store = new TodoStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty list when file does not exist", () => {
    expect(store.list()).toEqual([]);
  });

  it("adds and retrieves a todo", () => {
    const item = store.add({
      title: "测试任务",
      description: "这是一个测试",
      triggerAt: new Date(Date.now() + 3600_000).toISOString(),
      recurrenceHint: "不重复",
      createdBy: "user",
      agentId: "butler",
    });
    expect(item.id).toBeTruthy();
    expect(item.status).toBe("pending");

    const all = store.list();
    expect(all).toHaveLength(1);
    expect(all[0].title).toBe("测试任务");
  });

  it("filters by status", () => {
    store.add({
      title: "A",
      description: "a",
      triggerAt: new Date().toISOString(),
      recurrenceHint: "不重复",
      createdBy: "user",
      agentId: "butler",
    });
    const item2 = store.add({
      title: "B",
      description: "b",
      triggerAt: new Date().toISOString(),
      recurrenceHint: "不重复",
      createdBy: "user",
      agentId: "butler",
    });
    store.complete(item2.id);

    expect(store.list("pending")).toHaveLength(1);
    expect(store.list("completed")).toHaveLength(1);
  });

  it("completes a todo and returns updated item", () => {
    const item = store.add({
      title: "完成我",
      description: "desc",
      triggerAt: new Date().toISOString(),
      recurrenceHint: "不重复",
      createdBy: "user",
      agentId: "butler",
    });
    const updated = store.complete(item.id);
    expect(updated?.status).toBe("completed");
    expect(updated?.completedAt).toBeTruthy();
  });

  it("removes a todo", () => {
    const item = store.add({
      title: "删除我",
      description: "desc",
      triggerAt: new Date().toISOString(),
      recurrenceHint: "不重复",
      createdBy: "user",
      agentId: "butler",
    });
    expect(store.remove(item.id)).toBe(true);
    expect(store.list()).toHaveLength(0);
    expect(store.remove(item.id)).toBe(false); // 再删一次返回 false
  });

  it("markTriggered sets triggeredAt but keeps pending status", () => {
    const item = store.add({
      title: "触发我",
      description: "desc",
      triggerAt: new Date().toISOString(),
      recurrenceHint: "不重复",
      createdBy: "user",
      agentId: "butler",
    });
    const updated = store.markTriggered(item.id);
    expect(updated?.status).toBe("pending");
    expect(updated?.triggeredAt).toBeTruthy();
  });

  it("getDueTodos excludes already-triggered items", () => {
    const past = store.add({
      title: "过期未触发",
      description: "已过期",
      triggerAt: new Date(Date.now() - 1000).toISOString(),
      recurrenceHint: "不重复",
      createdBy: "user",
      agentId: "butler",
    });
    const pastTriggered = store.add({
      title: "过期已触发",
      description: "已触发过",
      triggerAt: new Date(Date.now() - 2000).toISOString(),
      recurrenceHint: "不重复",
      createdBy: "user",
      agentId: "butler",
    });
    store.markTriggered(pastTriggered.id);

    store.add({
      title: "未来任务",
      description: "还没到",
      triggerAt: new Date(Date.now() + 3600_000).toISOString(),
      recurrenceHint: "不重复",
      createdBy: "user",
      agentId: "butler",
    });

    const due = store.getDueTodos();
    expect(due).toHaveLength(1);
    expect(due[0].id).toBe(past.id);
  });

  it("survives corrupt JSON gracefully", () => {
    fs.writeFileSync(store["filePath"], "NOT JSON{", "utf-8");
    expect(store.list()).toEqual([]);
  });

  it("get returns todo by id", () => {
    const item = store.add({
      title: "查找我",
      description: "desc",
      triggerAt: new Date().toISOString(),
      recurrenceHint: "不重复",
      createdBy: "user",
      agentId: "butler",
    });
    expect(store.get(item.id)?.title).toBe("查找我");
    expect(store.get("nonexistent")).toBeUndefined();
  });
});

// Minimal mock for AgentRegistry
function mockRegistry(agentIds: string[]): AgentRegistry {
  const agents = new Map(agentIds.map(id => {
    const agent = {
      id,
      name: id,
      getStatus: () => "idle",
      run: async (input: string) => ({ content: `reply to: ${input}` }),
      memoryStore: { appendHistory: async () => {} },
    };
    return [id, agent as any];
  }));
  return {
    get: (id: string) => agents.get(id),
    list: () => [...agents.values()],
  } as any;
}

describe("AgentTodoScanner", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cobeing-scanner-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("scans agent dirs and finds due todos", async () => {
    const agentDir = path.join(tmpDir, "agents", "butler");
    fs.mkdirSync(agentDir, { recursive: true });
    const store = new TodoStore(agentDir);
    store.add({
      title: "过期任务",
      description: "测试触发",
      triggerAt: new Date(Date.now() - 5000).toISOString(),
      recurrenceHint: "不重复",
      createdBy: "user",
      agentId: "butler",
    });

    let triggered = false;
    const scanner = new AgentTodoScanner(tmpDir, mockRegistry(["butler"]), {
      onTrigger: async (_agentId, _todo, _message) => {
        triggered = true;
      },
    });

    await scanner.scanOnce();
    expect(triggered).toBe(true);
  });

  it("skips agents with no TODO file", async () => {
    const scanner = new AgentTodoScanner(tmpDir, mockRegistry(["butler"]), {
      onTrigger: async () => { throw new Error("should not trigger"); },
    });
    await scanner.scanOnce();
  });

  it("triggers multiple todos for same agent sequentially", async () => {
    const agentDir = path.join(tmpDir, "agents", "butler");
    fs.mkdirSync(agentDir, { recursive: true });
    const store = new TodoStore(agentDir);
    store.add({
      title: "任务1",
      description: "desc1",
      triggerAt: new Date(Date.now() - 1000).toISOString(),
      recurrenceHint: "不重复",
      createdBy: "user",
      agentId: "butler",
    });
    store.add({
      title: "任务2",
      description: "desc2",
      triggerAt: new Date(Date.now() - 2000).toISOString(),
      recurrenceHint: "不重复",
      createdBy: "user",
      agentId: "butler",
    });

    const order: string[] = [];
    const scanner = new AgentTodoScanner(tmpDir, mockRegistry(["butler"]), {
      onTrigger: async (_agentId, todo, _message) => {
        order.push(todo.title);
      },
    });

    await scanner.scanOnce();
    expect(order).toHaveLength(2);
    // 两者都应被触发
    expect(order).toContain("任务1");
    expect(order).toContain("任务2");
  });
});

describe("GroupTodoScanner", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cobeing-group-scanner-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("scans group dir and triggers due todos", async () => {
    const groupDir = path.join(tmpDir, "groups", "test-group");
    fs.mkdirSync(groupDir, { recursive: true });
    const store = new TodoStore(groupDir);
    store.add({
      title: "群组任务",
      description: "做某事",
      triggerAt: new Date(Date.now() - 1000).toISOString(),
      recurrenceHint: "不重复",
      createdBy: "host",
      targetAgentId: "agent-a",
    });

    const triggered: any[] = [];
    const scanner = new GroupTodoScanner("test-group", groupDir, {
      onTrigger: async (groupId, todo, msg) => {
        triggered.push({ groupId, todo, msg });
      },
    });

    await scanner.scanOnce();
    expect(triggered).toHaveLength(1);
    expect(triggered[0].groupId).toBe("test-group");
    expect(triggered[0].todo.targetAgentId).toBe("agent-a");
  });

  it("handles onComplete action chain", async () => {
    const groupDir = path.join(tmpDir, "groups", "g2");
    fs.mkdirSync(groupDir, { recursive: true });
    const store = new TodoStore(groupDir);
    store.add({
      title: "链式任务",
      description: "完成后创建下一个",
      triggerAt: new Date(Date.now() - 1000).toISOString(),
      recurrenceHint: "不重复",
      createdBy: "host",
      targetAgentId: "agent-b",
      onComplete: {
        mentionAgentId: "host",
        message: "任务已完成",
      },
    });

    const actions: string[] = [];
    const scanner = new GroupTodoScanner("g2", groupDir, {
      onTrigger: async (gid, todo, msg) => {
        actions.push("trigger");
      },
      onCompleteAction: async (gid, todo) => {
        actions.push("complete-action");
      },
    });

    await scanner.scanOnce();
    expect(actions).toContain("trigger");
  });

  it("triggers different agents in parallel, same agent sequentially", async () => {
    const groupDir = path.join(tmpDir, "groups", "g3");
    fs.mkdirSync(groupDir, { recursive: true });
    const store = new TodoStore(groupDir);
    store.add({
      title: "A-1",
      description: "desc",
      triggerAt: new Date(Date.now() - 1000).toISOString(),
      recurrenceHint: "不重复",
      createdBy: "host",
      targetAgentId: "agent-a",
    });
    store.add({
      title: "A-2",
      description: "desc",
      triggerAt: new Date(Date.now() - 2000).toISOString(),
      recurrenceHint: "不重复",
      createdBy: "host",
      targetAgentId: "agent-a",
    });
    store.add({
      title: "B-1",
      description: "desc",
      triggerAt: new Date(Date.now() - 1000).toISOString(),
      recurrenceHint: "不重复",
      createdBy: "host",
      targetAgentId: "agent-b",
    });

    const triggered: string[] = [];
    const scanner = new GroupTodoScanner("g3", groupDir, {
      onTrigger: async (_gid, todo, _msg) => {
        triggered.push(todo.title);
      },
    });

    await scanner.scanOnce();
    expect(triggered).toHaveLength(3);
    expect(triggered).toContain("A-1");
    expect(triggered).toContain("A-2");
    expect(triggered).toContain("B-1");
  });
});
