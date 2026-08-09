import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { TodoStore } from "./store.js";
import type { TodoItem } from "./types.js";
import { AgentTodoScanner } from "./scanner.js";
import { GroupTodoScanner } from "./group-scanner.js";
import { GlobalTodoStore } from "./global-store.js";
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

  it("getDueTodos excludes repeat todos (they flow through getRepeatDueTodos)", () => {
    store.add({
      title: "每日天气",
      description: "报天气",
      triggerAt: new Date(Date.now() - 1000).toISOString(),
      recurrenceHint: "每天8:00",
      createdBy: "user",
      agentId: "butler",
      repeat: { type: "daily", timeOfDay: "08:00" },
      nextTriggerAt: new Date(Date.now() - 1000).toISOString(),
    });
    expect(store.getDueTodos()).toHaveLength(0);
    expect(store.getRepeatDueTodos()).toHaveLength(1);
  });

  it("advanceRepeat computes next interval trigger from current cycle", () => {
    const item = store.add({
      title: "每6小时",
      description: "轮询",
      triggerAt: "2026-08-09T00:00:00.000Z",
      recurrenceHint: "每6小时",
      createdBy: "user",
      agentId: "butler",
      repeat: { type: "interval", intervalHours: 6 },
      nextTriggerAt: "2026-08-09T00:00:00.000Z",
    });
    const advanced = store.advanceRepeat(item.id);
    expect(advanced?.nextTriggerAt).toBe("2026-08-09T06:00:00.000Z");
    expect(advanced?.status).toBe("pending");
  });

  it("advanceRepeat daily keeps same clock time next day", () => {
    const item = store.add({
      title: "每日",
      description: "daily",
      triggerAt: "2026-08-09T00:00:00.000Z",
      recurrenceHint: "每天",
      createdBy: "user",
      agentId: "butler",
      repeat: { type: "daily" },
      nextTriggerAt: "2026-08-09T00:00:00.000Z",
    });
    const advanced = store.advanceRepeat(item.id);
    const next = new Date(advanced!.nextTriggerAt!).getTime();
    expect(next).toBeGreaterThan(new Date("2026-08-09T00:00:00.000Z").getTime());
    expect(next - new Date("2026-08-09T00:00:00.000Z").getTime()).toBe(24 * 3600_000);
  });

  it("advanceRepeat clears repeat when next trigger exceeds until", () => {
    const item = store.add({
      title: "限时重复",
      description: "到 until 停止",
      triggerAt: "2026-08-09T00:00:00.000Z",
      recurrenceHint: "每小时",
      createdBy: "user",
      agentId: "butler",
      repeat: { type: "interval", intervalHours: 6, until: "2026-08-09T05:00:00.000Z" },
      nextTriggerAt: "2026-08-09T00:00:00.000Z",
    });
    const advanced = store.advanceRepeat(item.id);
    expect(advanced?.repeat).toBeUndefined();
    expect(advanced?.nextTriggerAt).toBeUndefined();
  });

  it("getStalePendingTodos respects overduePolicy cooldown and maxRetries", () => {
    const item = store.add({
      title: "写手大纲",
      description: "超时重唤醒",
      triggerAt: new Date(Date.now() - 5 * 60_000).toISOString(),
      recurrenceHint: "不重复",
      createdBy: "user",
      agentId: "butler",
      overduePolicy: { action: "re-wake", cooldownMinutes: 1, maxRetries: 2 },
    });
    store.markTriggered(item.id); // triggeredAt = now，未超 1min 冷却
    expect(store.getStalePendingTodos()).toHaveLength(0);

    // 手动把 triggeredAt 拨回到 2 分钟前 → 超冷却
    const file = item.id;
    const all = JSON.parse(fs.readFileSync(store["filePath"], "utf-8"));
    all[0].triggeredAt = new Date(Date.now() - 2 * 60_000).toISOString();
    fs.writeFileSync(store["filePath"], JSON.stringify(all), "utf-8");

    expect(store.getStalePendingTodos()).toHaveLength(1);
    store.markReTriggered(file);
    store.markReTriggered(file);
    store.markReTriggered(file); // 3 次 > maxRetries 2
    expect(store.getStalePendingTodos()).toHaveLength(0);
  });

  it("markReTriggered increments reTriggerCount and refreshes triggeredAt", () => {
    const item = store.add({
      title: "计数",
      description: "重触发计数",
      triggerAt: new Date().toISOString(),
      recurrenceHint: "不重复",
      createdBy: "user",
      agentId: "butler",
    });
    store.markTriggered(item.id);
    const before = item.triggeredAt;
    const updated = store.markReTriggered(item.id);
    expect(updated?.reTriggerCount).toBe(1);
    expect(updated?.triggeredAt).not.toBe(before);
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

  it("triggers 0time todos on scan", async () => {
    const agentDir = path.join(tmpDir, "agents", "butler");
    fs.mkdirSync(agentDir, { recursive: true });
    const store = new TodoStore(agentDir);
    store.add({
      title: "即时任务",
      description: "创建即触发",
      triggerMode: "0time",
      triggerAt: "",
      check: "需要完成",
      recurrenceHint: "不重复",
      createdBy: "user",
      agentId: "butler",
    });

    const triggered: string[] = [];
    const scanner = new AgentTodoScanner(tmpDir, mockRegistry(["butler"]), {
      onTrigger: async (_agentId, todo, _msg) => { triggered.push(todo.title); },
    });

    await scanner.scanOnce();
    expect(triggered).toEqual(["即时任务"]);
    // 已触发保持 pending，不重复
    await scanner.scanOnce();
    expect(triggered).toEqual(["即时任务"]);
  });

  it("triggers repeat todos and advances the cycle", async () => {
    const agentDir = path.join(tmpDir, "agents", "butler");
    fs.mkdirSync(agentDir, { recursive: true });
    const store = new TodoStore(agentDir);
    const item = store.add({
      title: "每6小时轮询",
      description: "轮询接口",
      triggerAt: new Date(Date.now() - 5000).toISOString(),
      recurrenceHint: "每6小时",
      createdBy: "user",
      agentId: "butler",
      repeat: { type: "interval", intervalHours: 6 },
      nextTriggerAt: new Date(Date.now() - 5000).toISOString(),
    });

    const triggered: string[] = [];
    const scanner = new AgentTodoScanner(tmpDir, mockRegistry(["butler"]), {
      onTrigger: async (_agentId, todo, _msg) => { triggered.push(todo.title); },
    });

    await scanner.scanOnce();
    expect(triggered).toHaveLength(1);
    const after = store.get(item.id)!;
    expect(after.nextTriggerAt).toBeTruthy();
    expect(new Date(after.nextTriggerAt!).getTime()).toBeGreaterThan(Date.now());
    // repeat 已触发 → 不重复触发
    await scanner.scanOnce();
    expect(triggered).toHaveLength(1);
  });

  it("re-triggers stale pending todos after cooldown (goal re-wake)", async () => {
    const agentDir = path.join(tmpDir, "agents", "butler");
    fs.mkdirSync(agentDir, { recursive: true });
    const store = new TodoStore(agentDir);
    const item = store.add({
      title: "写手大纲",
      description: "超时重唤醒",
      triggerAt: new Date(Date.now() - 30 * 60_000).toISOString(),
      recurrenceHint: "不重复",
      createdBy: "user",
      agentId: "butler",
      overduePolicy: { action: "re-wake", cooldownMinutes: 0, maxRetries: 1 },
    });

    const triggered: string[] = [];
    const scanner = new AgentTodoScanner(tmpDir, mockRegistry(["butler"]), {
      onTrigger: async (_agentId, todo, _msg) => { triggered.push(todo.title); },
    });

    await scanner.scanOnce(); // 首次 time 触发
    expect(triggered).toHaveLength(1);
    // 拨回 triggeredAt 使其 stale
    const all = JSON.parse(fs.readFileSync(store["filePath"], "utf-8"));
    all[0].triggeredAt = new Date(Date.now() - 30 * 60_000).toISOString();
    fs.writeFileSync(store["filePath"], JSON.stringify(all), "utf-8");

    await scanner.scanOnce(); // stale 重唤醒
    expect(triggered).toHaveLength(2);
    await scanner.scanOnce(); // maxRetries=1 已达上限
    expect(triggered).toHaveLength(2);
  });

  it("notifyAgentSpoke triggers condition todos listening for that agent", async () => {
    const agentDir = path.join(tmpDir, "agents", "butler");
    fs.mkdirSync(agentDir, { recursive: true });
    const store = new TodoStore(agentDir);
    store.add({
      title: "等上游发言",
      description: "agent-b 完成后检查",
      triggerMode: "condition",
      triggerAt: "",
      check: "上游是否交付",
      recurrenceHint: "不重复",
      createdBy: "user",
      agentId: "butler",
      condition: {
        type: "agent_speak",
        targetAgents: ["agent-b"],
        check: "agent-b 完成后检查",
        onFail: "remind",
      },
    });

    const triggered: string[] = [];
    const scanner = new AgentTodoScanner(tmpDir, mockRegistry(["butler"]), {
      onTrigger: async (_agentId, todo, _msg) => { triggered.push(todo.title); },
    });

    await scanner.notifyAgentSpoke("agent-a");
    expect(triggered).toEqual([]);
    await scanner.notifyAgentSpoke("agent-b");
    expect(triggered).toEqual(["等上游发言"]);
    // 已触发 → 不再重复
    await scanner.notifyAgentSpoke("agent-b");
    expect(triggered).toEqual(["等上游发言"]);
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

  it("does not retrigger condition todos that are already waiting for completion", async () => {
    const groupDir = path.join(tmpDir, "groups", "g4");
    fs.mkdirSync(groupDir, { recursive: true });
    const store = new TodoStore(groupDir);
    const todo = store.add({
      title: "检查接口",
      description: "确认上游是否交付",
      triggerMode: "condition",
      triggerAt: "",
      check: "上游已发言后检查接口是否可用",
      recurrenceHint: "不重复",
      createdBy: "host",
      targetAgentId: "host",
      condition: {
        type: "agent_speak",
        targetAgents: ["agent-a"],
        check: "agent-a 发言后检查接口",
        onFail: "remind",
      },
    });
    store.markTriggered(todo.id);

    const triggered: string[] = [];
    const scanner = new GroupTodoScanner("g4", groupDir, {
      onTrigger: async (_gid, item, _msg) => {
        triggered.push(item.id);
      },
    });

    await scanner.checkConditionTodos("agent-a");
    expect(triggered).toEqual([]);
  });

  it("does not recreate or retrigger an already-triggered 0time todo", async () => {
    const groupDir = path.join(tmpDir, "groups", "g5");
    fs.mkdirSync(groupDir, { recursive: true });
    const store = new TodoStore(groupDir);
    const todo = store.add({
      title: "即时任务",
      description: "创建即触发",
      triggerMode: "0time",
      triggerAt: "",
      check: "需要完成",
      recurrenceHint: "不重复",
      createdBy: "host",
      targetAgentId: "agent-a",
    });
    store.markTriggered(todo.id);

    const triggered: string[] = [];
    const scanner = new GroupTodoScanner("g5", groupDir, {
      onTrigger: async (_gid, item, _msg) => {
        triggered.push(item.id);
      },
    });

    // 连续扫描两轮，验证不重复触发、不新建重复条目
    await scanner.scanOnce();
    await scanner.scanOnce();

    const items = store.list();
    expect(triggered).toEqual([]);
    // 原 TODO 保持 pending（已触发过），不被过期重建
    expect(items.find(item => item.id === todo.id)?.status).toBe("pending");
    // 不产生新的 0time 重复条目
    expect(items.filter(item => item.triggerMode === "0time" && item.status === "pending")).toHaveLength(1);
    expect(items).toHaveLength(1);
  });

  it("updates only global TODOs linked to the completed group todo id", async () => {
    const groupDir = path.join(tmpDir, "groups", "g6");
    const butlerDir = path.join(tmpDir, "coreagents", "butler");
    fs.mkdirSync(groupDir, { recursive: true });
    const store = new TodoStore(groupDir);
    const matchingTodo = store.add({
      title: "Matching group todo",
      description: "complete me",
      triggerAt: new Date(Date.now() - 1000).toISOString(),
      recurrenceHint: "none",
      createdBy: "host",
      targetAgentId: "agent-a",
    });
    const otherTodo = store.add({
      title: "Other group todo",
      description: "leave me alone",
      triggerAt: new Date(Date.now() - 1000).toISOString(),
      recurrenceHint: "none",
      createdBy: "host",
      targetAgentId: "agent-b",
    });

    const globalStore = new GlobalTodoStore(butlerDir);
    const matchingGlobal = globalStore.add({
      title: "Matching global",
      description: "linked to matching group todo",
      status: "running",
      assigneeType: "group",
      assigneeId: "g6",
      createdBy: "butler",
      automationPolicy: { autoDispatch: true, autoMonitor: true, autoEscalate: true, autoArchive: true, autoContinue: true },
      progressSummary: "",
      nextAction: "",
      executionRefs: [{ scope: "group", id: "g6", todoIds: [matchingTodo.id] }],
    } as any);
    const unrelatedGlobal = globalStore.add({
      title: "Unrelated global",
      description: "linked to another group todo",
      status: "running",
      assigneeType: "group",
      assigneeId: "g6",
      createdBy: "butler",
      automationPolicy: { autoDispatch: true, autoMonitor: true, autoEscalate: true, autoArchive: true, autoContinue: true },
      progressSummary: "",
      nextAction: "",
      executionRefs: [{ scope: "group", id: "g6", todoIds: [otherTodo.id] }],
    } as any);
    (globalThis as any).__cobeing = {
      runtime: {
        globalTodoStore: globalStore,
        wsServer: { broadcastGlobalTodoUpdate: vi.fn() },
      },
    };

    const scanner = new GroupTodoScanner("g6", groupDir, {
      onTrigger: async () => {},
    });

    await scanner.complete(matchingTodo.id);

    expect(globalStore.get(matchingGlobal.id)?.status).toBe("completed");
    expect(globalStore.get(matchingGlobal.id)?.lastEvent?.summary).toContain("Matching group todo");
    expect(globalStore.get(unrelatedGlobal.id)?.status).toBe("running");

    delete (globalThis as any).__cobeing;
  });
});
