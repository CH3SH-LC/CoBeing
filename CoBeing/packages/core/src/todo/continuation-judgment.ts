// packages/core/src/todo/continuation-judgment.ts
import { createLogger } from "@cobeing/shared";
import type { LLMProvider } from "@cobeing/providers";
import type { TodoItem } from "./types.js";
import type { GlobalTodoItem } from "@cobeing/shared";
import type { GlobalTodoStore } from "./global-store.js";
import type { TodoStore } from "./store.js";

const log = createLogger("continuation-judgment");

export interface ContinuationResult {
  decision: "complete" | "wait_user" | "auto_generate" | "request_cross_layer";
  reason: string;
  nextTodo?: {
    goal: string;
    description: string;
    scope: "agent" | "group" | "global";
    assigneeType?: string;
    assigneeId?: string;
  };
  crossLayerRequest?: {
    target: "butler" | "host";
    request: string;
  };
}

export interface ContinuationParams {
  completedTodo: TodoItem | GlobalTodoItem;
  continuationPolicy: GlobalTodoItem["continuationPolicy"];
  agentContext: {
    agentId: string;
    provider: LLMProvider;
    model: string;
  };
  workspaceDir: string;
  globalTodoStore?: GlobalTodoStore;
  groupTodoStore?: TodoStore;
  isGroupContext: boolean;
}

function isAutoAllowed(decision: ContinuationResult): boolean {
  const highRiskKeywords = [
    "付款", "支付", "付费", "购买",
    "授权", "权限", "安装", "删除",
    "隐私", "密码", "密钥", "token",
    "扩大", "范围扩大", "超出范围",
  ];
  const combined = `${decision.reason} ${decision.nextTodo?.goal || ""} ${decision.nextTodo?.description || ""}`;
  for (const kw of highRiskKeywords) {
    if (combined.includes(kw)) return false;
  }
  return true;
}

export async function runContinuationJudgment(
  params: ContinuationParams,
): Promise<ContinuationResult> {
  const { completedTodo, continuationPolicy, agentContext } = params;

  if (!continuationPolicy || continuationPolicy.mode === "none") {
    return { decision: "complete", reason: "无续作策略，任务收束" };
  }

  if (continuationPolicy.mode === "ask_user") {
    return { decision: "wait_user", reason: "续作策略要求用户确认" };
  }

  const prompt = buildPrompt(completedTodo, continuationPolicy, params.isGroupContext);
  try {
    const content = await agentContext.provider.chatComplete({
      model: agentContext.model,
      messages: [{ role: "user", content: prompt }],
      maxTokens: 500,
    });
    const parsed = parseResponse(content);
    log.info("Continuation judgment: %s → %s", (completedTodo as any).id || "", parsed.decision);

    if (parsed.decision === "auto_generate" && !isAutoAllowed(parsed)) {
      return {
        decision: "wait_user",
        reason: `需要用户确认（涉及高风险操作）: ${parsed.reason}`,
      };
    }

    return parsed;
  } catch (err: any) {
    log.error("Continuation judgment failed: %s", err.message);
    return { decision: "wait_user", reason: "续作判断失败，需要用户或 Butler 确认后续责任" };
  }
}

function buildPrompt(
  todo: TodoItem | GlobalTodoItem,
  policy: GlobalTodoItem["continuationPolicy"],
  isGroup: boolean,
): string {
  const title = (todo as any).title || (todo as GlobalTodoItem).title;
  const desc = todo.description;
  const deliverable = (todo as TodoItem).deliverable;

  return `你是一个任务的执行者。你刚刚完成了这个任务：

标题: ${title}
描述: ${desc}${deliverable ? `\n交付物: ${deliverable}` : ""}
上下文: ${isGroup ? "群组协作" : "个人任务"}

续作策略: ${policy?.mode || "none"}
${policy?.stopWhen ? `停止条件: ${policy.stopWhen}` : ""}

请判断：
1. 这个任务是否完全结束了？
2. 是否还有自然的下一步？
3. 下一步是否需要用户参与？

回复 JSON（不要其他内容）：
{
  "decision": "complete|wait_user|auto_generate|request_cross_layer",
  "reason": "你的判断理由",
  "nextGoal": "如果 decision=auto_generate，写下一步的简短目标",
  "nextDescription": "如果 decision=auto_generate，写下一步的详细描述"
}

规则：
- complete: 任务已完全结束，不需要继续
- wait_user: 下一步需要用户决定、确认或提供信息
- auto_generate: 下一步清晰明确、低风险、自然延续，可以自动创建
- request_cross_layer: 下一步需要跨群组或跨层协调

注意：涉及用户主观选择、付款、授权、隐私、范围扩大的操作，必须选择 wait_user。`;
}

function parseResponse(content: string): ContinuationResult {
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found");
    const parsed = JSON.parse(jsonMatch[0]);

    const decision = parsed.decision || "complete";
    if (!["complete", "wait_user", "auto_generate", "request_cross_layer"].includes(decision)) {
      return { decision: "wait_user", reason: "续作判断返回了无效决策，需要确认后续责任" };
    }

    const result: ContinuationResult = {
      decision,
      reason: parsed.reason || "无理由",
    };

    if (decision === "auto_generate" && parsed.nextGoal) {
      result.nextTodo = {
        goal: parsed.nextGoal,
        description: parsed.nextDescription || "",
        scope: "agent",
      };
    }

    return result;
  } catch {
    return { decision: "wait_user", reason: "无法解析续作判断结果，需要确认后续责任" };
  }
}

export async function applyContinuationResult(
  result: ContinuationResult,
  params: ContinuationParams,
): Promise<void> {
  if (result.decision === "auto_generate" && result.nextTodo) {
    const { groupTodoStore, globalTodoStore, agentContext } = params;
    if (groupTodoStore && result.nextTodo.scope === "group") {
      groupTodoStore.add({
        title: result.nextTodo.goal,
        description: result.nextTodo.description,
        triggerMode: "0time",
        triggerAt: "",
        recurrenceHint: "不重复",
        createdBy: "continuation-judgment",
        groupId: (params.completedTodo as TodoItem).groupId,
        targetAgentId: agentContext.agentId,
      });
      log.info("Auto-generated group continuation TODO: %s", result.nextTodo.goal);
    } else if (globalTodoStore) {
      globalTodoStore.add({
        title: result.nextTodo.goal,
        description: result.nextTodo.description,
        status: "pending",
        assigneeType: (result.nextTodo.assigneeType as any) || "agent",
        assigneeId: result.nextTodo.assigneeId || agentContext.agentId,
        responsibleAgentId: result.nextTodo.assigneeId || agentContext.agentId,
        createdBy: "butler",
        automationPolicy: { autoDispatch: true, autoMonitor: true, autoEscalate: true, autoArchive: true, autoContinue: true },
        continuationPolicy: params.continuationPolicy,
        progressSummary: `Auto-generated continuation after ${(params.completedTodo as any).title || (params.completedTodo as any).id || "completed task"}`,
        nextAction: "Butler should dispatch or confirm the continuation task",
        executionRefs: [],
      } as any);
      log.info("Auto-generated global continuation TODO: %s", result.nextTodo.goal);
    }
  }

  if (result.decision === "request_cross_layer" && result.crossLayerRequest) {
    const { globalTodoStore, agentContext } = params;
    if (result.crossLayerRequest.target === "butler" && globalTodoStore) {
      globalTodoStore.add({
        title: `[续作请求] ${result.crossLayerRequest.request}`,
        description: `由 Agent ${agentContext.agentId} 提出`,
        status: "pending",
        assigneeType: "butler",
        createdBy: "butler",
        automationPolicy: { autoDispatch: true, autoMonitor: true, autoEscalate: true, autoArchive: true, autoContinue: true },
        progressSummary: "等待 Butler 评估续作请求",
        nextAction: "Butler 需要评估此跨层续作请求",
        executionRefs: [],
      } as any);
      log.info("Cross-layer continuation request sent to Butler");
    }
  }
}
