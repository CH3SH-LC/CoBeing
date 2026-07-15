import { createLogger } from "@cobeing/shared";
import type { GlobalTodoItem } from "@cobeing/shared";
import type { AgentRegistry } from "../agent/registry.js";
import { AgentFiles, AgentPaths } from "../agent/paths.js";
import type { GroupManager } from "../group/manager.js";
import type { ButlerTaskStore } from "./butler-task-store.js";
import type { GroupButlerBindingStore } from "./butler-binding-store.js";
import type { GlobalTodoStore } from "../todo/global-store.js";

const log = createLogger("butler-dispatch");

export interface ButlerDispatchInput {
  targetType: "agent" | "group";
  targetId: string;
  title: string;
  goal: string;
  acceptance?: string;
  constraints?: string[];
  responsibleAgentId?: string;
  userMessageId?: string;
  notifyTarget?: boolean;
}

export interface ButlerDispatchDeps {
  dataRoot: string;
  agentRegistry: AgentRegistry;
  groupManager?: GroupManager;
  globalTodoStore: GlobalTodoStore;
  butlerTaskStore: ButlerTaskStore;
  butlerBindingStore?: GroupButlerBindingStore;
  wsServer?: { broadcastGlobalTodoUpdate?: () => void; broadcast?: (message: unknown) => void };
}

export interface ButlerDispatchReceipt {
  globalTodo: GlobalTodoItem;
  butlerTaskId: string;
  executionRef: { scope: "agent" | "group"; id: string; todoIds?: string[] };
}

function makeInboxId(): string {
  return `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function broadcast(deps: ButlerDispatchDeps): void {
  try {
    deps.wsServer?.broadcastGlobalTodoUpdate?.();
    deps.wsServer?.broadcast?.({ type: "butler_task_updated", payload: { timestamp: Date.now() } });
  } catch {
    // UI updates are best-effort; dispatch state is already persisted.
  }
}

export async function dispatchButlerTask(
  deps: ButlerDispatchDeps,
  input: ButlerDispatchInput,
): Promise<ButlerDispatchReceipt> {
  if (input.targetType === "agent" && !deps.agentRegistry.get(input.targetId)) {
    throw new Error(`Agent not found: ${input.targetId}`);
  }
  if (input.targetType === "group" && !deps.groupManager?.get(input.targetId)) {
    throw new Error(`Group not found: ${input.targetId}`);
  }

  if (input.targetType === "group") {
    deps.butlerBindingStore?.create(input.targetId);
  }

  const responsibleAgentId =
    input.targetType === "agent"
      ? input.targetId
      : input.responsibleAgentId || "host";

  const globalTodo = deps.globalTodoStore.add({
    title: input.title,
    description: input.goal,
    status: "running",
    assigneeType: input.targetType,
    assigneeId: input.targetId,
    responsibleAgentId,
    automationPolicy: {
      autoDispatch: true,
      autoMonitor: true,
      autoEscalate: true,
      autoArchive: true,
      autoContinue: true,
    },
    continuationPolicy: { mode: "request_coordinator" },
    progressSummary: `Dispatched to ${input.targetType} ${input.targetId}`,
    nextAction: input.targetType === "agent"
      ? "Agent is expected to report progress through its task inbox"
      : "Group host is expected to report key milestones",
    createdBy: "butler",
    executionRefs: [],
  } as any);

  const butlerTask = deps.butlerTaskStore.create({
    globalTodoId: globalTodo.id,
    userMessageId: input.userMessageId,
    title: input.title,
    goal: input.goal,
    targetType: input.targetType,
    targetId: input.targetId,
    status: "running",
    acceptance: input.acceptance,
    constraints: input.constraints,
    latestSummary: `Dispatched to ${input.targetType} ${input.targetId}`,
  });

  let executionRef: ButlerDispatchReceipt["executionRef"];

  if (input.targetType === "agent") {
    const targetPaths = AgentPaths.forAgent(input.targetId, deps.dataRoot);
    targetPaths.ensureDirs();
    const targetFiles = new AgentFiles(targetPaths);
    const now = new Date().toISOString();
    const inboxId = makeInboxId();
    targetFiles.addInboxItem({
      id: inboxId,
      globalTodoId: globalTodo.id,
      sourceType: "butler",
      sourceId: "butler",
      title: input.title,
      goal: input.goal,
      acceptance: input.acceptance,
      constraints: input.constraints,
      status: "running",
      createdAt: now,
      updatedAt: now,
    });
    executionRef = { scope: "agent", id: input.targetId, todoIds: [inboxId] };

    const agent = deps.agentRegistry.get(input.targetId) as any;
    if (input.notifyTarget !== false && typeof agent?.handleIncomingMessage === "function") {
      await agent.handleIncomingMessage({
        channelId: "system",
        senderId: "butler",
        senderName: "Butler",
        content: [
          `New tracked Butler task: ${input.title}`,
          `Global TODO: ${globalTodo.id}`,
          `Butler task: ${butlerTask.id}`,
          `Goal: ${input.goal}`,
          input.acceptance ? `Acceptance: ${input.acceptance}` : "",
          "The task has already been added to your inbox. Report progress with agent-task-report and finish with agent-task-complete.",
        ].filter(Boolean).join("\n"),
      });
    }
  } else {
    const groupTodoStore = deps.groupManager?.getGroupTodoStore(input.targetId);
    if (!groupTodoStore) {
      throw new Error(`Group TODO store not found: ${input.targetId}`);
    }
    const groupTodo = groupTodoStore.add({
      title: input.title,
      description: input.goal,
      triggerMode: "0time",
      triggerAt: "",
      check: input.acceptance,
      recurrenceHint: "none",
      createdBy: "butler",
      groupId: input.targetId,
      targetAgentId: responsibleAgentId,
    });
    executionRef = { scope: "group", id: input.targetId, todoIds: [groupTodo.id] };

    try {
      deps.groupManager?.get(input.targetId)?.postMessage(
        "butler",
        `@${responsibleAgentId} New tracked Butler task: ${input.title}\nGlobal TODO: ${globalTodo.id}\nButler task: ${butlerTask.id}\nGoal: ${input.goal}`,
      );
    } catch (err: any) {
      log.warn("Failed to post Butler dispatch to group %s: %s", input.targetId, err.message);
    }
  }

  deps.globalTodoStore.update(globalTodo.id, {
    butlerTaskId: butlerTask.id,
    executionRefs: [executionRef],
    progressSummary: `Dispatched to ${input.targetType} ${input.targetId}`,
  } as any);

  const updatedGlobal = deps.globalTodoStore.get(globalTodo.id) ?? globalTodo;
  broadcast(deps);

  return {
    globalTodo: updatedGlobal,
    butlerTaskId: butlerTask.id,
    executionRef,
  };
}
