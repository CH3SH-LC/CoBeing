/**
 * Agent Task 工具 — 任务收件箱管理
 */
import { mapAgentStatusToGlobal, type AgentTaskInboxItem, type AgentTaskStatus, type ButlerTaskReceiptPayload, type Tool, type ToolContext, type ToolResult } from "@cobeing/shared";
import type { LLMProvider } from "@cobeing/providers";
import type { AgentFiles } from "../agent/paths.js";
import { runTaskArchive } from "../agent/tool-agent/task-archive.js";
import { runMemoryAgent } from "../agent/tool-agent/memory.js";
import type { PersonalMemoryInput } from "../agent/tool-agent/types.js";
import { applyContinuationResult, runContinuationJudgment } from "../todo/continuation-judgment.js";

function runtimeStores(): {
  globalTodoStore?: any;
  butlerTaskStore?: any;
  wsServer?: any;
} {
  return (globalThis as any).__cobeing?.runtime ?? {};
}

function eventTypeForStatus(status: AgentTaskStatus): string {
  switch (status) {
    case "waiting_user":
      return "needs_user_decision";
    case "blocked":
    case "waiting_dependency":
      return "blocked";
    case "failed":
      return "failed";
    case "completed":
      return "completed";
    default:
      return "status_digest";
  }
}

function butlerStatusForAgent(status: AgentTaskStatus): string {
  switch (status) {
    case "waiting_user":
    case "completed":
    case "failed":
    case "cancelled":
      return status;
    default:
      return "running";
  }
}

function syncTrackedTask(
  task: AgentTaskInboxItem,
  status: AgentTaskStatus,
  context: ToolContext,
  summary: string,
): void {
  if (!task.globalTodoId) return;

  const { globalTodoStore, butlerTaskStore, wsServer } = runtimeStores();
  const globalTodo = globalTodoStore?.get?.(task.globalTodoId);
  if (!globalTodo) return;

  const agentId = context.agentId || globalTodo.responsibleAgentId || task.sourceId;
  const globalStatus = mapAgentStatusToGlobal(status);
  const blocker =
    status === "blocked" || status === "waiting_dependency" || status === "failed"
      ? {
          type: status === "waiting_dependency" ? "dependency" : status === "failed" ? "tool_error" : "agent_stalled",
          summary: task.blockerReason || task.failureSummary || summary,
          since: globalTodo.internalBlocker?.since || new Date().toISOString(),
        }
      : undefined;

  globalTodoStore.update(task.globalTodoId, {
    status: globalStatus,
    responsibleAgentId: agentId,
    progressSummary: summary,
    nextAction: status === "completed"
      ? "Agent completed the delegated work"
      : status === "waiting_user"
        ? "Waiting for user decision in Butler entry"
        : `Agent ${agentId} is ${status}`,
    internalBlocker: blocker,
    lastEvent: {
      id: `evt-${Date.now()}`,
      type: eventTypeForStatus(status),
      butlerTaskId: globalTodo.butlerTaskId || task.globalTodoId,
      groupId: globalTodo.assigneeType === "group" ? globalTodo.assigneeId || "" : "",
      fromAgentId: agentId,
      severity: status === "failed" || status === "blocked" ? "warning" : "info",
      summary,
      createdAt: new Date().toISOString(),
    },
  });

  if (agentId) {
    globalTodoStore.addExecutionRef?.(task.globalTodoId, {
      scope: "agent",
      id: agentId,
      todoIds: [task.id],
    });
  }

  if (globalTodo.butlerTaskId && butlerTaskStore?.update) {
    butlerTaskStore.update(globalTodo.butlerTaskId, {
      status: butlerStatusForAgent(status),
      latestSummary: summary,
    });
  }

  // 广播携带完整视图：status/title 从最新 store 视图与上下文组装
  const butlerTask = globalTodo.butlerTaskId ? butlerTaskStore?.get?.(globalTodo.butlerTaskId) : undefined;
  const targetId = globalTodo.assigneeId || agentId || task.sourceId || "";
  const assigneeName = (context as any).agentName || agentId || targetId;
  const receiptPayload: ButlerTaskReceiptPayload = {
    butlerTaskId: globalTodo.butlerTaskId || butlerTask?.id,
    globalTodoId: task.globalTodoId,
    title: butlerTask?.title ?? globalTodo.title ?? task.title,
    targetType: globalTodo.assigneeType === "group" ? "group" : "agent",
    targetId,
    assigneeName,
    status: butlerTask?.status ?? butlerStatusForAgent(status),
    summary,
    nextAction: globalTodo.nextAction,
    timestamp: Date.now(),
  };
  wsServer?.broadcastGlobalTodoUpdate?.();
  wsServer?.broadcast?.({ type: "butler_task_updated", payload: receiptPayload });
}

export function makeAgentTaskAcceptTool(files: AgentFiles): Tool {
  return {
    name: "agent-task-accept",
    description: "接收一个新任务，将其添加到你的任务收件箱。接收后应立即开始执行。",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "任务标题" },
        goal: { type: "string", description: "任务目标和详细描述" },
        acceptance: { type: "string", description: "验收标准（可选）" },
        constraints: { type: "array", items: { type: "string" }, description: "约束条件（可选）" },
        sourceType: { type: "string", enum: ["user", "butler", "group", "system"], description: "任务来源类型" },
        sourceId: { type: "string", description: "来源者 ID" },
        globalTodoId: { type: "string", description: "关联的全局 TODO 条目 ID（可选）" },
      },
      required: ["title", "goal", "sourceType", "sourceId"],
    },
    async execute(params, context: ToolContext): Promise<ToolResult> {
      const now = new Date().toISOString();

      // 原子认领（决策：TODO 单一真相源 — 补原子认领）：
      // 若指定了 globalTodoId，检查该全局任务是否已被其他 Agent 认领。
      // 已认领且负责人不是当前 Agent → 拒绝，避免并发覆盖 responsibleAgentId。
      const globalTodoId = params.globalTodoId as string | undefined;
      if (globalTodoId) {
        const { globalTodoStore } = runtimeStores();
        const globalTodo = globalTodoStore?.get?.(globalTodoId);
        if (globalTodo) {
          const agentId = context.agentId;
          const claimedBy = globalTodo.responsibleAgentId;
          if (claimedBy && claimedBy !== agentId && globalTodo.status === "running") {
            return {
              toolCallId: "",
              isError: true,
              content: `⚠️ 该任务已被 **${claimedBy}** 认领并正在执行中。请勿重复认领同一任务；如需协助，可联系负责人或请求分派新的子任务。`,
            };
          }
        }
      }

      const item: AgentTaskInboxItem = {
        id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        title: params.title as string,
        goal: params.goal as string,
        acceptance: params.acceptance as string | undefined,
        constraints: params.constraints as string[] | undefined,
        sourceType: params.sourceType as "user" | "butler" | "group" | "system",
        sourceId: params.sourceId as string,
        globalTodoId,
        status: "running",
        createdAt: now,
        updatedAt: now,
      };
      files.addInboxItem(item);
      syncTrackedTask(item, "running", context, `Agent accepted task: ${item.title}`);
      return { toolCallId: "", content: `✅ 任务已接收: **${item.title}** (ID: ${item.id})\n目标: ${item.goal}` };
    },
  };
}

export function makeAgentTaskReportTool(files: AgentFiles): Tool {
  return {
    name: "agent-task-report",
    description: "汇报任务进度、阻塞原因或依赖关系。",
    parameters: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "要更新的任务 ID" },
        status: { type: "string", enum: ["running", "blocked", "waiting_user", "waiting_dependency"], description: "新状态" },
        progressNote: { type: "string", description: "进度说明" },
        blockerReason: { type: "string", description: "阻塞原因（状态为 blocked/waiting_dependency 时必填）" },
        dependencyRefs: {
          type: "array",
          items: {
            type: "object",
            properties: {
              agentId: { type: "string" },
              todoId: { type: "string" },
              reason: { type: "string" },
            },
          },
          description: "依赖的其他 Agent 和 TODO",
        },
      },
      required: ["taskId", "status"],
    },
    async execute(params, context: ToolContext): Promise<ToolResult> {
      const existing = files.readInbox().find(task => task.id === params.taskId);
      if (!existing) {
        return { toolCallId: "", content: `找不到任务: ${params.taskId as string}`, isError: true };
      }

      const status = params.status as AgentTaskStatus;
      const patch: Partial<AgentTaskInboxItem> = {
        status,
        updatedAt: new Date().toISOString(),
      };
      if (params.blockerReason) patch.blockerReason = params.blockerReason as string;
      if (params.dependencyRefs) patch.dependencyRefs = params.dependencyRefs as AgentTaskInboxItem["dependencyRefs"];

      files.updateInboxItem(params.taskId as string, patch);
      syncTrackedTask(
        { ...existing, ...patch, status },
        status,
        context,
        (params.progressNote as string | undefined)
          || (params.blockerReason as string | undefined)
          || `Agent reported ${status}: ${existing.title}`,
      );

      const statusLabel: Record<string, string> = {
        running: "▶️ 执行中", blocked: "🚫 已阻塞", waiting_user: "⏳ 等待用户",
        waiting_dependency: "🔗 等待依赖",
      };
      return { toolCallId: "", content: `${statusLabel[params.status as string] || params.status as string}: 任务 ${params.taskId} 状态已更新` };
    },
  };
}

export function makeAgentTaskCompleteTool(
  files: AgentFiles,
  provider: LLMProvider,
  model: string,
): Tool {
  return {
    name: "agent-task-complete",
    description: "标记任务完成，提交交付物和证据。完成后自动触发经验提取和任务归档判断。",
    parameters: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "要完成的任务 ID" },
        summary: { type: "string", description: "完成总结" },
        artifacts: {
          type: "array",
          items: { type: "object", properties: { name: { type: "string" }, path: { type: "string" }, description: { type: "string" } } },
          description: "交付物列表",
        },
        outcome: { type: "string", enum: ["success", "partial", "failed"], description: "完成结果" },
      },
      required: ["taskId"],
    },
    async execute(params, context: ToolContext): Promise<ToolResult> {
      const taskId = params.taskId as string;
      const inbox = files.readInbox();
      const task = inbox.find(t => t.id === taskId);
      if (!task) {
        return { toolCallId: "", content: `找不到任务: ${taskId}`, isError: true };
      }

      // 1. 标记完成
      const outcome = (params.outcome as string) ?? "success";
      const finalStatus = outcome === "failed" ? "failed" as const : "completed" as const;
      files.updateInboxItem(taskId, {
        status: finalStatus,
        artifacts: params.artifacts as any,
        failureSummary: outcome === "failed" ? (params.summary as string | undefined) : undefined,
        updatedAt: new Date().toISOString(),
      } as any);
      const completedTask: AgentTaskInboxItem = {
        ...task,
        status: finalStatus,
        artifacts: params.artifacts as AgentTaskInboxItem["artifacts"],
        failureSummary: outcome === "failed" ? (params.summary as string | undefined) : task.failureSummary,
        updatedAt: new Date().toISOString(),
      };
      const summary = (params.summary as string | undefined) || `Agent completed task: ${task.title}`;
      syncTrackedTask(completedTask, finalStatus, context, summary);

      // 2. 写反思记录
      const reflection = {
        id: `ref_${Date.now()}`,
        agentId: context.agentId ?? "",
        taskId,
        outcome: outcome as "success" | "partial" | "failed",
        whatWorked: [],
        whatFailed: [],
        userPreferences: [],
        toolLessons: [],
        suggestedJobUpdates: [],
        suggestedCharacterUpdates: [],
        createdAt: new Date().toISOString(),
      };
      files.addReflection(reflection as any);

      // 3. 触发 MemoryAgent（异步，不阻塞返回）
      const workingDir = process.cwd();
      const agentName = (context as any).agentName ?? "Agent";
      const agentId = context.agentId ?? "";

      const { globalTodoStore } = runtimeStores();
      const globalTodo = task.globalTodoId ? globalTodoStore?.get?.(task.globalTodoId) : undefined;
      if (globalTodo && finalStatus === "completed" && globalTodo.continuationPolicy) {
        setImmediate(async () => {
          try {
            const agentContext = { agentId, provider, model };
            const continuationContext = {
              completedTodo: globalTodo,
              continuationPolicy: globalTodo.continuationPolicy,
              agentContext,
              workspaceDir: workingDir,
              globalTodoStore,
              isGroupContext: false,
            };
            const result = await runContinuationJudgment(continuationContext);
            await applyContinuationResult(result, continuationContext);
            if (result.decision === "wait_user") {
              globalTodoStore.update(globalTodo.id, {
                status: "waiting_user",
                nextAction: result.reason,
              } as any);
            }
          } catch {
            // Continuation failure should not make the task completion fail.
          }
        });
      }

      setImmediate(async () => {
        try {
          const memoryInput: PersonalMemoryInput = {
            agentName,
            agentId,
            trace: {
              thinking: [task.goal],
              toolCalls: [],
              finalMessage: (params.summary as string) ?? task.title,
            },
            taskContext: task.title,
          };
          await runMemoryAgent("personal", memoryInput, provider, model, workingDir);
        } catch { /* 记忆提取失败不影响主流程 */ }
      });

      // 4. 触发 TaskArchive（异步）
      setImmediate(async () => {
        try {
          const capability = files.readCapability();
          const reflections = files.readReflections();
          const archiveResult = await runTaskArchive(provider, model, {
            task: { ...task, status: finalStatus },
            capability,
            recentReflections: reflections.slice(-5),
          }, workingDir);

          if (archiveResult.summaryEntry) {
            const items = files.readInbox();
            const idx = items.findIndex(i => i.id === taskId);
            if (idx >= 0) {
              items[idx] = { ...items[idx], globalMappingNote: archiveResult.summaryEntry };
              files.writeInbox(items);
            }
          }
        } catch { /* 归档判断失败不影响主流程 */ }
      });

      const outcomeLabel = outcome === "success" ? "✅ 完成" : outcome === "partial" ? "⚠️ 部分完成" : "❌ 失败";
      return { toolCallId: "", content: `${outcomeLabel}: **${task.title}**${params.summary ? `\n\n${params.summary}` : ""}` };
    },
  };
}
