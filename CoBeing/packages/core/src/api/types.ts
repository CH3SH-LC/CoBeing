/**
 * API 层共享类型与 payload 构建 — 从 ws-server.ts 提取
 */
import type { GroupCreatorResult } from "../agent/tool-agent/creator.js";
import type { TodoScope } from "../todo/types.js";

export interface WSMessage {
  type: string;
  payload?: unknown;
}

export type TodoMutationAction =
  | "added"
  | "completed"
  | "removed"
  | "status-updated"
  | "batch-completed"
  | "batch-removed"
  | "batch-updated";

export interface TodoMutationContext {
  scope: TodoScope;
  agentId?: string;
  groupId?: string;
}

export function buildTodoMutationPayload<TExtra extends Record<string, unknown>>(
  action: TodoMutationAction,
  context: TodoMutationContext,
  extra: TExtra,
): { action: TodoMutationAction; scope: TodoScope; agentId?: string; groupId?: string } & TExtra {
  return {
    action,
    scope: context.scope,
    ...(context.agentId ? { agentId: context.agentId } : {}),
    ...(context.groupId ? { groupId: context.groupId } : {}),
    ...extra,
  };
}

export function buildGroupCreatorDraftNote(draft: GroupCreatorResult): string {
  const memberSuggestions = draft.memberSuggestions.length
    ? `\n\n## Creator 建议补充的成员缺口\n${draft.memberSuggestions.map(s => `- ${s.role}${s.suggestedName ? `（建议名：${s.suggestedName}）` : ""}：${s.reason}`).join("\n")}`
    : "";
  const initialTasks = draft.initialTasks.length
    ? `\n\n## Creator 建议的初始任务\n${draft.initialTasks.map(t => `- ${t.title}${t.assigneeHint ? `（建议承担：${t.assigneeHint}）` : ""}${t.acceptance ? `；验收：${t.acceptance}` : ""}`).join("\n")}`
    : "";
  const confirmations = draft.userConfirmations.length
    ? `\n\n## 需要向用户确认\n${draft.userConfirmations.map(q => `- ${q}`).join("\n")}`
    : "";
  return [memberSuggestions, initialTasks, confirmations].join("");
}
