import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LLMProvider } from "@cobeing/providers";
import { AgentFiles, AgentPaths } from "../agent/paths.js";
import { ButlerTaskStore } from "../butler/butler-task-store.js";
import { GlobalTodoStore } from "../todo/global-store.js";
import { makeAgentTaskAcceptTool, makeAgentTaskCompleteTool, makeAgentTaskReportTool } from "./agent-task.js";

const mockProvider: LLMProvider = {
  id: "mock",
  name: "mock",
  chat: async function* () { yield { type: "content", content: "ok" }; },
  chatComplete: async () => JSON.stringify({ decision: "complete", reason: "done" }),
  listModels: async () => [],
  capabilities: () => ({ tools: true, vision: false, streaming: true, maxTokens: 4096, contextWindow: 128000 }),
};

describe("agent task tools", () => {
  let tmpDir: string;
  let files: AgentFiles;
  let globalTodoStore: GlobalTodoStore;
  let butlerTaskStore: ButlerTaskStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cobeing-agent-task-"));
    const agentPaths = new AgentPaths(path.join(tmpDir, "agents", "agent-a"));
    agentPaths.ensureDirs();
    files = new AgentFiles(agentPaths);
    const butlerDir = path.join(tmpDir, "coreagents", "butler");
    globalTodoStore = new GlobalTodoStore(butlerDir);
    butlerTaskStore = new ButlerTaskStore(butlerDir);
    (globalThis as any).__cobeing = {
      runtime: {
        globalTodoStore,
        butlerTaskStore,
        wsServer: { broadcastGlobalTodoUpdate: vi.fn(), broadcast: vi.fn() },
      },
    };
  });

  afterEach(() => {
    delete (globalThis as any).__cobeing;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("syncs accept, report, and completion to Global TODO and ButlerTask", async () => {
    const globalTodo = globalTodoStore.add({
      title: "Tracked task",
      description: "A task delegated by Butler",
      status: "pending",
      assigneeType: "agent",
      assigneeId: "agent-a",
      responsibleAgentId: "agent-a",
      createdBy: "butler",
      automationPolicy: { autoDispatch: true, autoMonitor: true, autoEscalate: true, autoArchive: true, autoContinue: true },
      progressSummary: "",
      nextAction: "",
      executionRefs: [],
    } as any);
    const butlerTask = butlerTaskStore.create({
      globalTodoId: globalTodo.id,
      title: globalTodo.title,
      goal: globalTodo.description,
      targetType: "agent",
      targetId: "agent-a",
      status: "dispatched",
    });
    globalTodoStore.update(globalTodo.id, { butlerTaskId: butlerTask.id } as any);

    const acceptTool = makeAgentTaskAcceptTool(files);
    await acceptTool.execute({
      title: "Tracked task",
      goal: "Do the delegated work",
      sourceType: "butler",
      sourceId: "butler",
      globalTodoId: globalTodo.id,
    }, { agentId: "agent-a" });

    const inboxItem = files.readInbox()[0];
    expect(inboxItem.globalTodoId).toBe(globalTodo.id);
    expect(globalTodoStore.get(globalTodo.id)?.status).toBe("running");
    expect(globalTodoStore.get(globalTodo.id)?.executionRefs).toEqual([
      expect.objectContaining({ scope: "agent", id: "agent-a", todoIds: [inboxItem.id] }),
    ]);
    expect(butlerTaskStore.get(butlerTask.id)?.status).toBe("running");

    const reportTool = makeAgentTaskReportTool(files);
    await reportTool.execute({
      taskId: inboxItem.id,
      status: "waiting_user",
      progressNote: "Need user preference",
    }, { agentId: "agent-a" });

    expect(globalTodoStore.get(globalTodo.id)?.status).toBe("waiting_user");
    expect(globalTodoStore.get(globalTodo.id)?.lastEvent?.type).toBe("needs_user_decision");
    expect(butlerTaskStore.get(butlerTask.id)?.status).toBe("waiting_user");

    const completeTool = makeAgentTaskCompleteTool(files, mockProvider, "mock-model");
    await completeTool.execute({
      taskId: inboxItem.id,
      summary: "Delivered the requested result",
      outcome: "success",
    }, { agentId: "agent-a", agentName: "Agent A" });

    expect(globalTodoStore.get(globalTodo.id)?.status).toBe("completed");
    expect(globalTodoStore.get(globalTodo.id)?.lastEvent?.type).toBe("completed");
    expect(butlerTaskStore.get(butlerTask.id)?.status).toBe("completed");
  });
});
