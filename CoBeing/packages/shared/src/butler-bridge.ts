// packages/shared/src/butler-bridge.ts
// Butler entry bridge shared types — Round 1 data layer

// ========== Escalation Event Types ==========

export type ButlerEscalationType =
  | "needs_user_decision"
  | "blocked"
  | "completed"
  | "failed"
  | "scope_change"
  | "status_digest";

// ========== User Question ==========

export interface ButlerUserQuestion {
  prompt: string;
  choices?: Array<{
    id: string;
    label: string;
    description?: string;
    recommended?: boolean;
  }>;
  freeformAllowed: boolean;
}

// ========== Escalation Event ==========

export interface ButlerEscalationEvent {
  id: string;
  type: ButlerEscalationType;
  butlerTaskId: string;
  groupId: string;
  fromAgentId: string;
  severity: "info" | "warning" | "critical";
  summary: string;
  question?: ButlerUserQuestion;
  options?: Array<{
    id: string;
    label: string;
    tradeoff?: string;
    recommended?: boolean;
  }>;
  artifacts?: Array<{
    name: string;
    path?: string;
    url?: string;
    description?: string;
  }>;
  suggestedNextStep?: string;
  createdAt: string;
}

// ========== Butler Task ==========

export type ButlerTaskStatus =
  | "routing"
  | "dispatched"
  | "running"
  | "waiting_user"
  | "completed"
  | "failed"
  | "cancelled";

export interface MarketResourceRef {
  id: string;
  kind: "agent" | "group" | "skill" | "plugin";
  source: "official" | "community" | "local";
  status: "suggested" | "approved" | "installed" | "rejected";
}

export interface ButlerTask {
  id: string;
  globalTodoId: string;
  userMessageId?: string;
  title: string;
  goal: string;
  targetType: "agent" | "group";
  targetId: string;
  status: ButlerTaskStatus;
  acceptance?: string;
  constraints?: string[];
  userPreferences?: string[];
  marketResources?: MarketResourceRef[];
  latestSummary?: string;
  pendingQuestion?: ButlerUserQuestion;
  createdAt: string;
  updatedAt: string;
}

// ========== Global TODO Item ==========

export type GlobalTodoStatus =
  | "pending"
  | "running"
  | "waiting_user"
  | "completed"
  | "cancelled";

export interface ExecutionRef {
  scope: "agent" | "group";
  id: string;
  todoIds?: string[];
  messageIds?: string[];
}

export interface GlobalTodoItem {
  id: string;
  title: string;
  description: string;
  status: GlobalTodoStatus;
  assigneeType: "butler" | "agent" | "group";
  assigneeId?: string;
  responsibleAgentId?: string;
  butlerTaskId?: string;

  /** 自动化策略：控制 Butler 的自主程度 */
  automationPolicy: {
    autoDispatch: boolean;
    autoMonitor: boolean;
    autoEscalate: boolean;
    autoArchive: boolean;
    autoContinue: boolean;
  };

  /** 续作策略：任务完成后是否自动生成后续任务 */
  continuationPolicy?: {
    mode: "none" | "request_coordinator" | "auto_generate" | "ask_user";
    maxDepth?: number;
    stopWhen?: string;
    nextCheckHint?: string;
  };

  executionRefs: ExecutionRef[];

  progressSummary: string;
  nextAction: string;
  lastEvent?: ButlerEscalationEvent;

  /** 内部阻塞信息（不作为状态暴露） */
  internalBlocker?: {
    type: "missing_info" | "dependency" | "resource" | "tool_error" | "agent_stalled";
    summary: string;
    since: string;
  };

  createdBy: "user" | "butler";
  createdAt: string;
  updatedAt: string;
}

// ========== Group Butler Binding ==========

export interface GroupButlerBinding {
  groupId: string;
  butlerId: "butler";
  alias: string;
  enabled: boolean;
  allowedEvents: ButlerEscalationType[];
  escalationPolicy: {
    routineProgress: "silent";
    blocked: "notify";
    needsUserDecision: "notify";
    completed: "notify";
    failed: "notify";
    scopeChange: "notify";
  };
  createdAt: string;
  updatedAt: string;
}

// ========== Constants ==========

export const DEFAULT_ESCALATION_POLICY: GroupButlerBinding["escalationPolicy"] = {
  routineProgress: "silent",
  blocked: "notify",
  needsUserDecision: "notify",
  completed: "notify",
  failed: "notify",
  scopeChange: "notify",
};

export const DEFAULT_ALLOWED_EVENTS: ButlerEscalationType[] = [
  "needs_user_decision",
  "blocked",
  "completed",
  "failed",
  "scope_change",
  "status_digest",
];

export const CORE_AGENT_IDS = new Set(["butler", "host"]);
