/**
 * Unified ToolAgent spec loader.
 *
 * Specs are metadata for temporary ToolAgents. They describe lifecycle and
 * caller responsibilities; they do not grant ToolAgents persistent identity.
 */
import { loadToolAgentData } from "./base.js";
import type {
  ToolAgentFailurePolicy,
  ToolAgentSpec,
  ToolAgentType,
  ToolAgentVisibility,
  ToolAgentWritePolicy,
} from "./types.js";

interface RawToolAgentSpec {
  name?: unknown;
  purpose?: unknown;
  trigger?: unknown;
  model?: unknown;
  maxIterations?: unknown;
  timeoutMs?: unknown;
  tools?: unknown;
  inputSchema?: unknown;
  outputSchema?: unknown;
  visibility?: unknown;
  writePolicy?: unknown;
  failurePolicy?: unknown;
}

const DEFAULTS: Record<ToolAgentType, Pick<ToolAgentSpec, "trigger" | "visibility" | "writePolicy" | "failurePolicy">> = {
  review: { trigger: "group-send", visibility: "system_log", writePolicy: "return_only", failurePolicy: "fallback_allow" },
  judgment: { trigger: "wake-judgment", visibility: "system_log", writePolicy: "return_only", failurePolicy: "fallback_allow" },
  clone: { trigger: "agent-clone", visibility: "hidden", writePolicy: "return_only", failurePolicy: "ignore" },
  memory: { trigger: "work-complete", visibility: "hidden", writePolicy: "caller_applies", failurePolicy: "ignore" },
  creator: { trigger: "manual", visibility: "hidden", writePolicy: "caller_applies", failurePolicy: "escalate" },
  "growth-reviewer": { trigger: "proposal-review", visibility: "hidden", writePolicy: "caller_applies", failurePolicy: "fallback_block" },
  "task-archive": { trigger: "task-complete", visibility: "hidden", writePolicy: "caller_applies", failurePolicy: "ignore" },
  "capability-updater": { trigger: "capability-update", visibility: "hidden", writePolicy: "caller_applies", failurePolicy: "ignore" },
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function asEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? value as T : fallback;
}

function purposeFromPrompt(prompt: string | null, type: ToolAgentType): string {
  if (!prompt) return `${type} ToolAgent`;
  return prompt.trim().split(/\r?\n/).find(Boolean)?.slice(0, 120) || `${type} ToolAgent`;
}

export function loadToolAgentSpec(type: ToolAgentType, dataRoot?: string): ToolAgentSpec {
  const { config, prompt } = loadToolAgentData(type, dataRoot);
  const raw = (config ?? {}) as RawToolAgentSpec;
  const defaults = DEFAULTS[type];
  const visibility = asEnum<ToolAgentVisibility>(
    raw.visibility,
    ["hidden", "system_log", "user_summary"],
    defaults.visibility,
  );
  const writePolicy = asEnum<ToolAgentWritePolicy>(
    raw.writePolicy,
    ["return_only", "caller_applies", "safe_auto_apply"],
    defaults.writePolicy,
  );
  const failurePolicy = asEnum<ToolAgentFailurePolicy>(
    raw.failurePolicy,
    ["ignore", "fallback_allow", "fallback_block", "escalate"],
    defaults.failurePolicy,
  );

  return {
    type,
    name: asString(raw.name) ?? type,
    purpose: asString(raw.purpose) ?? purposeFromPrompt(prompt, type),
    trigger: asString(raw.trigger) ?? defaults.trigger,
    model: asString(raw.model),
    maxIterations: asNumber(raw.maxIterations) ?? 3,
    timeoutMs: asNumber(raw.timeoutMs),
    tools: asStringArray(raw.tools),
    inputSchema: asRecord(raw.inputSchema),
    outputSchema: asRecord(raw.outputSchema),
    visibility,
    writePolicy,
    failurePolicy,
    systemPrompt: prompt ?? undefined,
  };
}
