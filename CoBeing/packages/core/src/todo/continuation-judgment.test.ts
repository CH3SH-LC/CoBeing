import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LLMProvider } from "@cobeing/providers";
import { GlobalTodoStore } from "./global-store.js";
import { applyContinuationResult } from "./continuation-judgment.js";

const mockProvider: LLMProvider = {
  id: "mock",
  name: "mock",
  chat: async function* () { yield { type: "content", content: "ok" }; },
  chatComplete: async () => "ok",
  listModels: async () => [],
  capabilities: () => ({ tools: true, vision: false, streaming: true, maxTokens: 4096, contextWindow: 128000 }),
};

describe("applyContinuationResult", () => {
  it("creates a Global TODO for agent-scoped auto-generated continuation work", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cobeing-continuation-"));
    try {
      const store = new GlobalTodoStore(tmpDir);
      const completedTodo = store.add({
        title: "Original task",
        description: "Do the first task",
        status: "completed",
        assigneeType: "agent",
        assigneeId: "agent-a",
        responsibleAgentId: "agent-a",
        createdBy: "butler",
        automationPolicy: { autoDispatch: true, autoMonitor: true, autoEscalate: true, autoArchive: true, autoContinue: true },
        continuationPolicy: { mode: "auto_generate" },
        progressSummary: "done",
        nextAction: "",
        executionRefs: [],
      } as any);

      await applyContinuationResult({
        decision: "auto_generate",
        reason: "A clear next step exists",
        nextTodo: {
          goal: "Follow-up task",
          description: "Do the natural next task",
          scope: "agent",
        },
      }, {
        completedTodo,
        continuationPolicy: completedTodo.continuationPolicy,
        agentContext: { agentId: "agent-a", provider: mockProvider, model: "mock" },
        workspaceDir: tmpDir,
        globalTodoStore: store,
        isGroupContext: false,
      });

      const items = store.list();
      expect(items).toHaveLength(2);
      expect(items[1]).toMatchObject({
        title: "Follow-up task",
        description: "Do the natural next task",
        status: "pending",
        assigneeType: "agent",
        assigneeId: "agent-a",
        responsibleAgentId: "agent-a",
      });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
