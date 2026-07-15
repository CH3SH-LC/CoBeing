import { afterEach, describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GroupManager } from "./manager.js";
import { AgentRegistry } from "../agent/registry.js";
import { GroupButlerBindingStore } from "../butler/butler-binding-store.js";
import { hasDeleteMarker, readMasterRegistry } from "@cobeing/shared";

describe("GroupManager", () => {
  const tmpDirs: string[] = [];
  let managers: GroupManager[] = [];

  function registerAgent(reg: AgentRegistry, id: string): void {
    reg.register({
      id,
      name: id,
      getStatus: () => "idle",
      getActiveSessions: () => [],
      run: async () => ({ content: "ok" }),
      clearGroupLoop: () => {},
      memoryStore: { appendHistory: async () => {} },
    } as any);
  }

  afterEach(() => {
    delete (globalThis as any).__cobeing;
    for (const mgr of managers.splice(0)) {
      mgr.disposeAll();
    }
    for (const dir of tmpDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("creates and retrieves a group", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cobeing-group-manager-test-"));
    tmpDirs.push(tmpDir);
    const reg = new AgentRegistry();
    const mgr = new GroupManager(reg, tmpDir);
    managers.push(mgr);
    const g = mgr.create({ id: "g1", name: "test", members: [] });
    expect(mgr.get("g1")).toBe(g);
  });

  it("creates a Butler binding when a group is created", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cobeing-group-binding-test-"));
    tmpDirs.push(tmpDir);
    const reg = new AgentRegistry();
    const bindingStore = new GroupButlerBindingStore(path.join(tmpDir, "coreagents", "butler"));
    (globalThis as any).__cobeing = {
      runtime: { butlerBindingStore: bindingStore },
    };
    const mgr = new GroupManager(reg, tmpDir);
    managers.push(mgr);

    mgr.create({ id: "g1", name: "test", members: [] });

    expect(bindingStore.get("g1")).toMatchObject({
      groupId: "g1",
      butlerId: "butler",
      enabled: true,
    });
  });

  it("lists groups", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cobeing-group-manager-test-"));
    tmpDirs.push(tmpDir);
    const reg = new AgentRegistry();
    const mgr = new GroupManager(reg, tmpDir);
    managers.push(mgr);
    mgr.create({ id: "g1", name: "a", members: [] });
    mgr.create({ id: "g2", name: "b", members: [] });
    expect(mgr.list()).toHaveLength(2);
  });

  it("deletes a group", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cobeing-group-manager-test-"));
    tmpDirs.push(tmpDir);
    const reg = new AgentRegistry();
    const mgr = new GroupManager(reg, tmpDir);
    managers.push(mgr);
    mgr.create({ id: "g1", name: "a", members: [] });
    mgr.delete("g1");
    expect(mgr.get("g1")).toBeUndefined();
  });

  it("marks deleted group data so it cannot be restored as a ghost", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cobeing-group-delete-test-"));
    tmpDirs.push(tmpDir);
    const reg = new AgentRegistry();
    const mgr = new GroupManager(reg, tmpDir);
    managers.push(mgr);
    mgr.create({ id: "g1", name: "a", members: ["host"] });

    mgr.delete("g1");

    const registry = readMasterRegistry(tmpDir);
    expect(registry.groups.g1).toBeUndefined();
    const groupsDir = path.join(tmpDir, "groups");
    const entries = fs.existsSync(groupsDir) ? fs.readdirSync(groupsDir) : [];
    expect(entries.every(name => name === "g1" ? hasDeleteMarker(path.join(groupsDir, name)) : name.includes(".deleted."))).toBe(true);
  });

  it("completes group todos through the scanner so downstream dependencies are notified", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cobeing-group-complete-test-"));
    tmpDirs.push(tmpDir);
    const reg = new AgentRegistry();
    registerAgent(reg, "host");
    registerAgent(reg, "agent-a");
    registerAgent(reg, "agent-b");
    const mgr = new GroupManager(reg, tmpDir);
    managers.push(mgr);
    const group = mgr.create({ id: "g1", name: "work", owner: "host", members: ["host", "agent-a", "agent-b"] });
    const store = mgr.getGroupTodoStore("g1");
    expect(store).toBeTruthy();

    const upstream = store!.add({
      title: "完成接口",
      description: "交付接口",
      triggerAt: new Date(Date.now() + 3600_000).toISOString(),
      recurrenceHint: "不重复",
      createdBy: "host",
      groupId: "g1",
      targetAgentId: "agent-a",
    });
    const downstream = store!.add({
      title: "接入接口",
      description: "等待接口完成后接入",
      triggerMode: "0time",
      triggerAt: "",
      check: "接口已完成",
      recurrenceHint: "不重复",
      createdBy: "host",
      groupId: "g1",
      targetAgentId: "agent-b",
      dependsOn: [upstream.id],
    });

    const completed = await mgr.completeGroupTodo("g1", upstream.id);

    expect(completed?.status).toBe("completed");
    expect(group.getHistory().some(message =>
      message.content.includes("@agent-b") &&
      message.content.includes("依赖完成通知") &&
      message.content.includes(downstream.title)
    )).toBe(true);
  });
});
