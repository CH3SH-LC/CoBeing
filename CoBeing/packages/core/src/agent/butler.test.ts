import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AgentRegistry } from "./registry.js";
import { GroupManager } from "../group/manager.js";
import { ButlerAgent } from "./butler.js";
import { AgentFiles, AgentPaths } from "./paths.js";
import { GlobalTodoStore } from "../todo/global-store.js";
import { ButlerTaskStore } from "../butler/butler-task-store.js";
import { GroupButlerBindingStore } from "../butler/butler-binding-store.js";
import type { LLMProvider } from "@cobeing/providers";

const mockProvider: LLMProvider = {
  id: "mock", name: "mock",
  chat: async function* () { yield { type: "content", content: "ok" }; },
  chatComplete: async () => "ok",
  listModels: async () => [],
  capabilities: () => ({ tools: true, vision: false, streaming: true, maxTokens: 4096, contextWindow: 128000 }),
};

describe("ButlerAgent", () => {
  let tmpDir: string;
  let oldCwd: string;
  let reg: AgentRegistry;
  const createdButlers: ButlerAgent[] = [];

  beforeEach(() => {
    oldCwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cobeing-butler-test-"));
    reg = new AgentRegistry();
    process.chdir(tmpDir);
  });

  afterEach(async () => {
    for (const agent of reg.list()) {
      if (typeof (agent as any).dispose === "function") {
        await agent.dispose();
      }
    }
    for (const butler of createdButlers.splice(0)) {
      await butler.dispose();
    }
    process.chdir(oldCwd);
    delete (globalThis as any).__cobeing;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("registers self in registry", () => {
    const gm = new GroupManager(reg);
    const butler = new ButlerAgent({
      id: "butler", name: "管家", role: "管家",
      systemPrompt: "test", provider: "mock", model: "mock",
      permissions: { mode: "full-access" },
      sandbox: { enabled: false, filesystem: "isolated", network: { enabled: true, mode: "all" } },
    }, mockProvider, reg, gm);
    createdButlers.push(butler);
    expect(reg.get("butler")).toBeDefined();
  });

  it("has butler tools registered", () => {
    const gm = new GroupManager(reg);
    const butler = new ButlerAgent({
      id: "butler", name: "管家", role: "管家",
      systemPrompt: "test", provider: "mock", model: "mock",
      permissions: { mode: "full-access" },
      sandbox: { enabled: false, filesystem: "isolated", network: { enabled: true, mode: "all" } },
    }, mockProvider, reg, gm);
    createdButlers.push(butler);
    // Check butler tools are in definitions
    const defs = (butler as any).toolRegistry.listDefinitions();
    const names = defs.map((d: any) => d.function.name);
    expect(names).toContain("butler-create-agent");
    expect(names).toContain("butler-list");
    expect(names).toContain("butler-run-group");
  });

  it("creates a default capability card for newly created agents", async () => {
    const gm = new GroupManager(reg);
    const butler = new ButlerAgent({
      id: "butler", name: "管家", role: "管家",
      systemPrompt: "test", provider: "mock", model: "mock",
      permissions: { mode: "full-access" },
      sandbox: { enabled: false, filesystem: "isolated", network: { enabled: true, mode: "all" } },
    }, mockProvider, reg, gm);
    createdButlers.push(butler);

    const tool = (butler as any).toolRegistry.get("butler-create-agent");
    expect(tool).toBeDefined();
    await tool.execute({
      name: "Researcher",
      role: "research assistant",
      capabilities: "research, summarize, compare sources",
      sandbox: { enabled: false, filesystem: "isolated", network: { enabled: true, mode: "all" } },
    }, { agentId: "butler" });

    const files = new AgentFiles(AgentPaths.forAgent("researcher", path.join(tmpDir, "data")));
    const card = files.readCapability();
    expect(card?.agentId).toBe("researcher");
    expect(card?.displayName).toBe("Researcher");
    expect(card?.domains.join(" ")).toContain("research");
  });

  it("dispatches to an agent as a tracked Butler task, global TODO, and inbox item", async () => {
    const dataRoot = path.join(tmpDir, "data");
    const butlerDataDir = path.join(dataRoot, "coreagents", "butler");
    const globalTodoStore = new GlobalTodoStore(butlerDataDir);
    const butlerTaskStore = new ButlerTaskStore(butlerDataDir);
    const butlerBindingStore = new GroupButlerBindingStore(butlerDataDir);
    (globalThis as any).__cobeing = {
      dataRoot,
      runtime: {
        dataRoot,
        globalTodoStore,
        butlerTaskStore,
        butlerBindingStore,
        wsServer: { broadcastGlobalTodoUpdate: vi.fn(), broadcast: vi.fn() },
      },
    };

    const targetAgent = {
      id: "agent-a",
      name: "Agent A",
      getStatus: () => "idle",
      handleIncomingMessage: vi.fn(async () => ({ content: "accepted" })),
    };
    reg.register(targetAgent as any);
    const gm = new GroupManager(reg, dataRoot);
    const butler = new ButlerAgent({
      id: "butler", name: "管家", role: "管家",
      systemPrompt: "test", provider: "mock", model: "mock",
      permissions: { mode: "full-access" },
      sandbox: { enabled: false, filesystem: "isolated", network: { enabled: true, mode: "all" } },
    }, mockProvider, reg, gm);
    createdButlers.push(butler);

    const tool = (butler as any).toolRegistry.get("butler-dispatch-to-agent");
    expect(tool).toBeDefined();
    const result = await tool.execute({
      agentId: "agent-a",
      title: "Collect notes",
      goal: "Collect three research notes",
      acceptance: "Three concise bullets",
      constraints: ["no web"],
    }, { agentId: "butler" });

    expect(result.isError).not.toBe(true);
    const globalItems = globalTodoStore.list();
    expect(globalItems).toHaveLength(1);
    expect(globalItems[0]).toMatchObject({
      title: "Collect notes",
      status: "running",
      assigneeType: "agent",
      assigneeId: "agent-a",
      responsibleAgentId: "agent-a",
    });
    expect(globalItems[0].executionRefs).toEqual([
      expect.objectContaining({ scope: "agent", id: "agent-a" }),
    ]);

    const butlerTasks = butlerTaskStore.list();
    expect(butlerTasks).toHaveLength(1);
    expect(butlerTasks[0]).toMatchObject({
      globalTodoId: globalItems[0].id,
      targetType: "agent",
      targetId: "agent-a",
      status: "running",
    });
    expect(globalTodoStore.get(globalItems[0].id)?.butlerTaskId).toBe(butlerTasks[0].id);

    const inboxFiles = new AgentFiles(AgentPaths.forAgent("agent-a", dataRoot));
    const inbox = inboxFiles.readInbox();
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({
      title: "Collect notes",
      sourceType: "butler",
      sourceId: "butler",
      globalTodoId: globalItems[0].id,
      status: "running",
    });
  });
});
