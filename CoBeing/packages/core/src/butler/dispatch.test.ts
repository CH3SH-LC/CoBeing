/**
 * Butler dispatch 测试 — 派发回执广播 payload 结构与 dispatch_task group 路径
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { AgentRegistry } from "../agent/registry.js";
import { ButlerTaskStore } from "./butler-task-store.js";
import { GlobalTodoStore } from "../todo/global-store.js";
import { dispatchButlerTask, buildButlerTaskReceiptPayload, type ButlerDispatchDeps } from "./dispatch.js";
import { registerAgentHandlers } from "../api/handlers/agent.js";
import type { WsCommandHandler } from "../api/handlers/types.js";

interface CapturedMessage {
  type: string;
  payload: any;
}

class FakeWsServer {
  messages: CapturedMessage[] = [];
  broadcast(msg: CapturedMessage): void {
    this.messages.push(msg);
  }
  broadcastGlobalTodoUpdate(): void {}
}

/** 群组桩：g1 存在，其余不存在 */
function makeFakeGroupManager(): any {
  const groupTodoStore = {
    add: (item: any) => ({ ...item, id: "group-todo-1" }),
  };
  const fakeGroup = {
    id: "g1",
    config: { id: "g1", name: "旅行小队", members: [] },
    postMessage: () => {},
  };
  return {
    get: (id: string) => (id === "g1" ? fakeGroup : undefined),
    getGroupTodoStore: (id: string) => (id === "g1" ? groupTodoStore : undefined),
  };
}

describe("dispatchButlerTask broadcast payload", () => {
  let tmpDir: string;
  let wsServer: FakeWsServer;
  let registry: AgentRegistry;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "butler-dispatch-test-"));
    wsServer = new FakeWsServer();
    registry = new AgentRegistry();
    registry.register({ id: "alice", name: "Alice" } as any);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeDeps(extra?: Partial<ButlerDispatchDeps>): ButlerDispatchDeps {
    return {
      dataRoot: tmpDir,
      agentRegistry: registry,
      globalTodoStore: new GlobalTodoStore(tmpDir),
      butlerTaskStore: new ButlerTaskStore(tmpDir),
      wsServer,
      ...extra,
    } as unknown as ButlerDispatchDeps;
  }

  function lastButlerTaskEvent() {
    return wsServer.messages.find(m => m.type === "butler_task_updated");
  }

  it("broadcasts full receipt payload on agent dispatch", async () => {
    const deps = makeDeps();
    const receipt = await dispatchButlerTask(deps, {
      targetType: "agent",
      targetId: "alice",
      title: "调研竞品",
      goal: "收集 3 家竞品信息",
      notifyTarget: false,
    });

    const evt = lastButlerTaskEvent();
    expect(evt).toBeDefined();
    const p = evt!.payload;
    expect(p.butlerTaskId).toBe(receipt.butlerTaskId);
    expect(p.globalTodoId).toBe(receipt.globalTodo.id);
    expect(p.title).toBe("调研竞品");
    expect(p.targetType).toBe("agent");
    expect(p.targetId).toBe("alice");
    expect(p.assigneeName).toBe("Alice");
    expect(p.status).toBe("running");
    expect(typeof p.timestamp).toBe("number");
  });

  it("broadcasts full payload on group dispatch with assigneeName from group config", async () => {
    const deps = makeDeps({ groupManager: makeFakeGroupManager() });
    const receipt = await dispatchButlerTask(deps, {
      targetType: "group",
      targetId: "g1",
      title: "组队调研",
      goal: "完成调研报告",
    });

    const evt = lastButlerTaskEvent();
    expect(evt).toBeDefined();
    const p = evt!.payload;
    expect(p.butlerTaskId).toBe(receipt.butlerTaskId);
    expect(p.targetType).toBe("group");
    expect(p.targetId).toBe("g1");
    expect(p.assigneeName).toBe("旅行小队");
    expect(p.status).toBe("running");
  });

  it("falls back to timestamp-only payload when store view is unavailable", async () => {
    const brokenStore = {
      create: (input: any) => ({ ...input, id: "bt-missing", createdAt: "", updatedAt: "" }),
      get: () => undefined,
    } as any;
    const deps = makeDeps({ butlerTaskStore: brokenStore });
    await dispatchButlerTask(deps, {
      targetType: "agent",
      targetId: "alice",
      title: "T",
      goal: "G",
      notifyTarget: false,
    });

    const evt = lastButlerTaskEvent();
    expect(evt).toBeDefined();
    expect(Object.keys(evt!.payload)).toEqual(["timestamp"]);
    expect(typeof evt!.payload.timestamp).toBe("number");
  });

  it("buildButlerTaskReceiptPayload returns fallback for unknown butlerTaskId", () => {
    const deps = makeDeps();
    const payload = buildButlerTaskReceiptPayload(deps, "bt-unknown");
    expect(Object.keys(payload)).toEqual(["timestamp"]);
  });

  it("falls back assigneeName to targetId when target has no name", async () => {
    registry.register({ id: "bob" } as any);
    const deps = makeDeps();
    await dispatchButlerTask(deps, {
      targetType: "agent",
      targetId: "bob",
      title: "T",
      goal: "G",
      notifyTarget: false,
    });

    const evt = lastButlerTaskEvent();
    expect(evt?.payload.assigneeName).toBe("bob");
  });
});

describe("dispatch_task handler — group target & backward compat", () => {
  let tmpDir: string;
  let wsServer: FakeWsServer;
  let registry: AgentRegistry;
  let groupManager: any;
  let sent: CapturedMessage[];
  let prevRuntime: any;

  const handlers: Record<string, WsCommandHandler> = {};
  registerAgentHandlers((type, handler) => {
    handlers[type] = handler;
  });

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "butler-handler-test-"));
    wsServer = new FakeWsServer();
    registry = new AgentRegistry();
    registry.register({ id: "alice", name: "Alice" } as any);
    groupManager = makeFakeGroupManager();
    sent = [];
    prevRuntime = (globalThis as any).__cobeing;
    (globalThis as any).__cobeing = {
      runtime: {
        dataRoot: tmpDir,
        globalTodoStore: new GlobalTodoStore(tmpDir),
        butlerTaskStore: new ButlerTaskStore(tmpDir),
      },
    };
  });

  afterEach(() => {
    (globalThis as any).__cobeing = prevRuntime;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function invoke(msg: any): Promise<void> {
    const ctx: any = {
      dataRoot: tmpDir,
      agentRegistry: registry,
      groupManager,
      sendToClient: (_ws: any, m: CapturedMessage) => { sent.push(m); },
      broadcast: (m: CapturedMessage) => { wsServer.messages.push(m); },
      broadcastGlobalTodoUpdate: () => {},
    };
    const handler = handlers.dispatch_task;
    if (!handler) throw new Error("dispatch_task handler not registered");
    return handler.call(ctx, {} as any, msg as any);
  }

  it("dispatches to group and returns targetType/targetId in result", async () => {
    await invoke({
      type: "dispatch_task",
      payload: { groupId: "g1", targetType: "group", title: "旅行规划", goal: "规划周末旅行" },
    });

    const result = sent.find(m => m.type === "dispatch_task_result");
    expect(result?.payload.ok).toBe(true);
    expect(result?.payload.targetType).toBe("group");
    expect(result?.payload.targetId).toBe("g1");
    expect(result?.payload.groupId).toBe("g1");
    expect(result?.payload.butlerTaskId).toBeTruthy();
    expect(result?.payload.globalTodoId).toBeTruthy();

    const evt = wsServer.messages.find(m => m.type === "butler_task_updated");
    expect(evt).toBeDefined();
    expect(evt?.payload.butlerTaskId).toBe(result?.payload.butlerTaskId);
    expect(evt?.payload.targetType).toBe("group");
    expect(evt?.payload.title).toBe("旅行规划");
    expect(evt?.payload.status).toBe("running");
  });

  it("keeps legacy payload (agentId only) working with default targetType agent", async () => {
    await invoke({
      type: "dispatch_task",
      payload: { agentId: "alice", title: "整理周报", goal: "汇总本周工作" },
    });

    const result = sent.find(m => m.type === "dispatch_task_result");
    expect(result?.payload.ok).toBe(true);
    expect(result?.payload.targetType).toBe("agent");
    expect(result?.payload.targetId).toBe("alice");
    expect(result?.payload.agentId).toBe("alice");
    expect(result?.payload.groupId).toBeUndefined();
  });

  it("explicit targetType agent with agentId still works", async () => {
    await invoke({
      type: "dispatch_task",
      payload: { agentId: "alice", targetType: "agent", title: "T", goal: "G" },
    });

    const result = sent.find(m => m.type === "dispatch_task_result");
    expect(result?.payload.ok).toBe(true);
    expect(result?.payload.targetType).toBe("agent");
    expect(result?.payload.targetId).toBe("alice");
  });

  it("rejects unknown group", async () => {
    await invoke({
      type: "dispatch_task",
      payload: { groupId: "nope", targetType: "group", title: "T", goal: "G" },
    });

    const err = sent.find(m => m.type === "error");
    expect(err).toBeDefined();
    expect(err?.payload.message).toContain("Group not found");
  });

  it("rejects missing agentId for default agent target", async () => {
    await invoke({
      type: "dispatch_task",
      payload: { title: "T", goal: "G" },
    });

    const err = sent.find(m => m.type === "error");
    expect(err).toBeDefined();
    expect(err?.payload.message).toContain("agentId is required");
  });
});
