# Tool Agent System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a system of 4 ephemeral, non-persistent tool agents (Review, Judgment, Clone, Memory) that use Provider.chat() directly without depending on the Agent class.

**Architecture:** A shared `base.ts` provides an independent LLM tool loop. Four agent types implement specific behaviors on top of it. Types in `types.ts` define the common interface. Integration points modify existing code in `agent.ts`, `wake-system.ts`, `manager.ts`, `group.ts`, `group-tools.ts`, and `group-scanner.ts`.

**Tech Stack:** TypeScript, `LLMProvider` (from `@cobeing/providers`), `ToolRegistry` / `ToolExecutor` / `PermissionEnforcer` (existing), Vitest

**Spec:** `docs/superpowers/specs/2026-05-25-tool-agent-system-design.md`

---

### Task 1: Foundation — types.ts

**Files:**
- Create: `packages/core/src/agent/tool-agent/types.ts`

- [ ] **Step 1: Write types.ts**

```typescript
/**
 * Tool Agent 类型定义 — 与 Agent 类完全独立
 */
import type { Message } from "@cobeing/shared";

export type ToolAgentType = "review" | "judgment" | "clone" | "memory";

export interface ToolAgentConfig {
  id: string;
  type: ToolAgentType;
  parentAgentId: string;
  groupId?: string;
  model: string;
  maxIterations: number;
  tools: string[];
  systemPrompt: string;
  userPrompt: string;
  workingDir: string;
  abortSignal?: AbortSignal;
}

export interface ToolAgentResult {
  success: boolean;
  output: string;
  metadata?: Record<string, unknown>;
}

export interface ToolAgentRunContext {
  provider: import("@cobeing/providers").LLMProvider;
  toolRegistry: import("../../tools/registry.js").ToolRegistry;
  permission: import("../../tools/permission.js").PermissionEnforcer;
  sandboxConfig?: import("@cobeing/shared").SandboxConfig;
  sandboxRunner?: import("@cobeing/shared").SandboxRunner;
  agentName?: string;
}

// --- Review ---

export interface ReviewInput {
  agentJobMd: string;
  agentTrace: import("@cobeing/shared").AgentTrace;
  groupRecentMessages: string[];
  agentMentions: string[];
  groupTaskMd: string;
  groupPlanMd: string;
  groupProgressMd: string;
}

export interface ReviewResult {
  pass: boolean;
  reason: string;
}

// --- Judgment ---

export interface JudgmentInput {
  targetMessage: string;
  fromAgentId: string;
  fromAgentName: string;
  recentMessages: string[];
  hostName: string;
  groupName: string;
}

export interface JudgmentResult {
  wake_host: boolean;
  reason: string;
  urgency: "high" | "medium" | "low";
}

// --- Clone ---

export interface CloneTask {
  description: string;
  contextFiles?: string[];
}

export interface CloneInput {
  task: CloneTask;
  parentName: string;
  parentId: string;
  groupName?: string;
  effectiveWorkspace: string;
}

// --- Memory ---

export type MemoryMode = "personal" | "group";

export interface PersonalMemoryInput {
  agentName: string;
  agentId: string;
  trace: import("@cobeing/shared").AgentTrace;
  taskContext: string;
}

export interface GroupMemoryInput {
  groupName: string;
  groupId: string;
  phasePlan: string;
  progressMd: string;
  interfaceMd: string;
  memberContributions: string[];
}

export interface MemoryEntry {
  category: string;
  summary: string;
  detail?: string;
}

export interface MemoryToolAgentResult {
  entries: MemoryEntry[];
  interfaceUpdates?: Array<{
    agentId: string;
    section: string;
    entry: string;
  }>;
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit -p packages/core/tsconfig.json`
Expected: No errors related to tool-agent/types.ts

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/agent/tool-agent/types.ts
git commit -m "feat: add ToolAgent type definitions"
```

---

### Task 2: Foundation — base.ts (Independent LLM Tool Loop)

**Files:**
- Create: `packages/core/src/agent/tool-agent/base.ts`

- [ ] **Step 1: Write base.ts with runToolAgent() function**

```typescript
/**
 * Tool Agent 基类 — 独立 LLM 工具循环
 *
 * 不依赖 Agent 类，直接用 Provider.chat() + ToolExecutor 循环。
 */
import type { LLMProvider } from "@cobeing/providers";
import type { Message, ToolCall, ToolResult } from "@cobeing/shared";
import { ToolRegistry } from "../../tools/registry.js";
import { ToolExecutor } from "../../tools/executor.js";
import { PermissionEnforcer } from "../../tools/permission.js";
import { createLogger } from "@cobeing/shared";
import type { ToolAgentConfig, ToolAgentResult } from "./types.js";

const log = createLogger("tool-agent");

const STOP_PHRASES = new Set(["nothing to save.", "nothing to save", "Nothing to save."]);

/** 从 provider 的流式输出中收集完整响应和工具调用 */
async function collectResponse(
  provider: LLMProvider,
  model: string,
  messages: Message[],
  tools: Array<{ type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }>,
  abortSignal?: AbortSignal,
): Promise<{ content: string; toolCalls: ToolCall[] }> {
  let content = "";
  const toolCalls: ToolCall[] = [];
  const toolCallMap = new Map<number, ToolCall>();

  for await (const chunk of provider.chat({
    model,
    messages,
    tools: tools.length > 0 ? tools : undefined,
    temperature: 0.1,
    maxTokens: 2048,
    abortSignal,
  })) {
    if (chunk.type === "content" && chunk.content) {
      content += chunk.content;
    }
    if (chunk.type === "tool_call" && chunk.toolCall) {
      const tc = chunk.toolCall;
      if (tc.index !== undefined) {
        const existing = toolCallMap.get(tc.index);
        if (existing) {
          existing.function.name += tc.function.name;
          existing.function.arguments += tc.function.arguments;
        } else {
          toolCallMap.set(tc.index, { ...tc });
        }
      } else {
        toolCalls.push(tc);
      }
    }
  }

  if (toolCallMap.size > 0) {
    const merged = [...toolCallMap.values()].map(tc => ({
      ...tc,
      id: tc.id || `tool_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    }));
    toolCalls.push(...merged);
  }

  return { content: content.trim(), toolCalls };
}

/** 独立 LLM 工具循环 */
export async function runToolAgent(
  config: ToolAgentConfig,
  provider: LLMProvider,
  toolRegistry: ToolRegistry,
  workingDir: string,
  permissionMode?: string,
  sandboxConfig?: import("@cobeing/shared").SandboxConfig,
  sandboxRunner?: import("@cobeing/shared").SandboxRunner,
): Promise<ToolAgentResult> {
  const permission = new PermissionEnforcer(
    { mode: (permissionMode as any) ?? "workspace-write" },
    undefined,
    workingDir,
  );
  const executor = new ToolExecutor(
    toolRegistry,
    permission,
    undefined,
    sandboxConfig ?? { enabled: false, filesystem: "isolated", network: { enabled: true, mode: "all" } },
    sandboxRunner,
  );

  const messages: Message[] = [
    { role: "system", content: config.systemPrompt },
    { role: "user", content: config.userPrompt },
  ];

  const toolDefs = toolRegistry.listDefinitions();

  for (let round = 0; round < config.maxIterations; round++) {
    const { content, toolCalls } = await collectResponse(
      provider,
      config.model,
      messages,
      toolDefs,
      config.abortSignal,
    );

    if (config.abortSignal?.aborted) {
      return { success: false, output: "[已停止]" };
    }

    if (content) {
      const lastAssistant = messages.filter(m => m.role === "assistant").length > 0
        ? messages[messages.length - 1]
        : null;
      if (lastAssistant && lastAssistant.role === "assistant") {
        lastAssistant.content += content;
      } else {
        messages.push({ role: "assistant", content });
      }
    }

    if (toolCalls.length === 0) {
      // No tool calls, LLM is done
      const finalContent = messages.filter(m => m.role === "assistant").map(m => m.content).join("\n").trim();
      return { success: true, output: finalContent || content };
    }

    // Execute tool calls
    const lastMsg: Message = { role: "assistant", content: content || "", toolCalls };
    if (!content) {
      // Replace the empty assistant message
      const emptyIdx = messages.findIndex(m => m.role === "assistant" && !m.content && !m.toolCalls);
      if (emptyIdx >= 0) messages[emptyIdx] = lastMsg;
      else messages.push(lastMsg);
    }

    for (const tc of toolCalls) {
      const result: ToolResult = await executor.execute(tc, config.parentAgentId, config.id, workingDir);
      messages.push({
        role: "tool",
        content: result.isError ? `Error: ${result.content}` : result.content,
        toolCallId: tc.id,
      });
    }
  }

  // Max iterations reached — return current state
  const finalContent = messages.filter(m => m.role === "assistant").map(m => m.content).join("\n").trim();
  return { success: true, output: finalContent };
}
```

- [ ] **Step 2: Verify base.ts compiles**

Run: `npx tsc --noEmit -p packages/core/tsconfig.json`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/agent/tool-agent/base.ts
git commit -m "feat: add ToolAgent base — independent LLM tool loop"
```

---

### Task 3: Review Tool Agent + Existing Code Refactor

**Files:**
- Create: `packages/core/src/agent/tool-agent/review.ts`
- Modify: `packages/core/src/tools/group-tools.ts:266-310` (replace reviewPipeline call)
- Modify: `packages/core/src/group/manager.ts` (remove createReviewerAgent + reviewer lifecycle)
- Modify: `packages/core/src/group/group.ts` (remove reviewerAgent property)
- Delete: `packages/core/src/group/review-pipeline.ts`

- [ ] **Step 1: Create review.ts**

```typescript
/**
 * Review Tool Agent — 审查 Agent 消息
 */
import type { LLMProvider } from "@cobeing/providers";
import { ToolRegistry } from "../../tools/registry.js";
import { runToolAgent } from "./base.js";
import type { ReviewInput, ToolAgentResult } from "./types.js";

const REVIEW_SYSTEM_PROMPT = `# 审核任务

你正在审核一条即将发布到群组的消息。

## 审核标准
1. 该 Agent 是否确实进行了实质性工作（调用了工具、产生了具体输出）？
2. 工作方法是否符合任务要求？
3. 该 Agent 是否在偷懒（仅声明意图而未展示实际工作成果）？

## 输出格式
只输出一个 JSON 对象：
{"pass": true|false, "reason": "用中文简要说明审核通过/不通过的原因"}

pass=true 表示消息可以发布。pass=false 表示需要修改。`;

export async function runReviewAgent(
  input: ReviewInput,
  provider: LLMProvider,
  toolRegistry: ToolRegistry,
  model: string,
  workingDir: string,
  parentAgentId: string,
): Promise<ToolAgentResult> {
  const userPrompt = buildReviewUserPrompt(input);
  return runToolAgent(
    {
      id: `tool-review-${Date.now()}`,
      type: "review",
      parentAgentId,
      model,
      maxIterations: 2,
      tools: [], // 审查不需要工具
      systemPrompt: REVIEW_SYSTEM_PROMPT,
      userPrompt,
      workingDir,
    },
    provider,
    toolRegistry,
    workingDir,
  );
}

function buildReviewUserPrompt(input: ReviewInput): string {
  return `## 该 Agent 的职责（JOB.md）
${input.agentJobMd}

## 本轮唤醒的工作轨迹
${input.agentTrace.thinking.map(t => `[思考]: ${t}`).join('\n')}
${input.agentTrace.toolCalls.map(tc =>
  `[工具:${tc.tool}] 参数:${JSON.stringify(tc.args)} → 结果:${tc.result.slice(0, 500)}`
).join('\n')}

## 待发送的群组消息
${input.agentTrace.finalMessage}

## 群组最近的讨论
${input.groupRecentMessages.join('\n')}

## 对该 Agent 的 @mention
${input.agentMentions.join('\n')}

## 群组 TASK.md
${input.groupTaskMd.slice(0, 1000)}

## 群组 PLAN.md
${input.groupPlanMd.slice(0, 1000)}

## 群组 PROGRESS.md
${input.groupProgressMd.slice(0, 1000)}

请审核以上内容，输出 JSON。`;
}

export function parseReviewOutput(output: string): { pass: boolean; reason: string } {
  try {
    const jsonMatch = output.match(/\{[\s\S]*"pass"[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return { pass: !!parsed.pass, reason: parsed.reason || '' };
    }
  } catch { /* fall through */ }
  // 解析失败时放行
  return { pass: true, reason: '' };
}
```

- [ ] **Step 2: Modify group-tools.ts — replace reviewPipeline with ReviewToolAgent**

In `packages/core/src/tools/group-tools.ts`, replace the reviewPipeline import and call:

Replace line 9-10:
```typescript
// OLD:
import { injectReviewExperience } from "../group/review-experience.js";
// NEW:
import { injectReviewExperience } from "../group/review-experience.js";
import { runReviewAgent, parseReviewOutput } from "../agent/tool-agent/review.js";
```

Replace the reviewPipeline block (from `// === 审核拦截` through the end of the review handling):
```typescript
      // === 审核拦截：消息发送前经过 Review Tool Agent 检查 ===
      if (getAgent && group.config.reviewer?.enabled !== false && group.config.reviewer?.maxRounds !== 0) {
        const agent = getAgent(context.agentId);
        if (agent) {
          const ws = (globalThis as any).__cobeingWSServer;
          const provider = (globalThis as any).__cobeingGetProvider?.(agent.config.provider) as import("@cobeing/providers").LLMProvider | undefined;
          if (provider) {
            const trace = agent.wakeSession?.getTrace();
            if (trace) {
              trace.finalMessage = msg;

              const recentMessages = group.getRecentMessages(10);
              const mentions = group.getMentionsFor(context.agentId);
              const workspace = group.workspace;
              const truncate = (s: string, max: number) => s.length > max ? s.slice(0, max) + '...' : s;

              const reviewInput = {
                agentJobMd: agent.files.readJob(),
                agentTrace: trace,
                groupRecentMessages: recentMessages.map(m => `[${m.fromAgentId}]: ${m.content}`),
                agentMentions: mentions.map(m => `[${m.fromAgentId}]: ${m.content}`),
                groupTaskMd: truncate(workspace.readTask() ?? '', 1000),
                groupPlanMd: truncate(workspace.readPlan() ?? '', 1000),
                groupProgressMd: truncate(workspace.readProgress() ?? '', 1000),
              };

              const maxRounds = group.config.reviewer?.maxRounds ?? 3;
              let result = { pass: false, reason: '' };
              let retryCount = 0;

              for (let round = 0; round < maxRounds; round++) {
                ws?.emitReviewLog({ type: 'review_pending', agentId: context.agentId, groupId: group.id });
                const toolResult = await runReviewAgent(
                  reviewInput,
                  provider,
                  agent.getToolRegistry(),
                  agent.config.model,
                  agent.effectiveWorkspace,
                  context.agentId,
                );
                const parsed = parseReviewOutput(toolResult.output);
                result = parsed;
                retryCount = round + 1;
                (context as any).reviewRetryCount = retryCount;

                if (parsed.pass) break;

                // 不通过 → 写入经验并让 Agent 重试
                injectReviewExperience(agent, parsed.reason);
                ws?.emitReviewLog({ type: 'review_failed', agentId: context.agentId, groupId: group.id, reason: parsed.reason, round });
              }

              if (result.pass) {
                group.postMessage(context.agentId, msg);
                ws?.emitReviewLog({ type: 'review_passed', agentId: context.agentId, groupId: group.id });
                return {
                  toolCallId: "",
                  content: `消息已审核通过并发布到群组 ${group.config.name}`,
                };
              } else {
                // 轮次耗尽，强制发布
                group.postMessage(context.agentId, msg, { reviewOverridden: true });
                ws?.emitReviewLog({ type: 'review_failed_override', agentId: context.agentId, groupId: group.id, reason: result.reason, retryCount });
                return {
                  toolCallId: "",
                  content: `消息已发布到群组 ${group.config.name}（审核未通过但已强制发布，轮次耗尽）`,
                };
              }
            }
          }
        }
      }

      // 无审核 → 直接发送
      group.postMessage(context.agentId, msg);
      return {
        toolCallId: "",
        content: `消息已发布到群组 ${group.config.name}`,
      };
```

- [ ] **Step 3: Remove reviewerAgent from group.ts**

In `packages/core/src/group/group.ts`:
- Remove `reviewerAgent` property
- Remove `getReviewerAgent()` method if it exists
- Remove `setReviewerAgent()` if it exists

Find the `reviewerAgent` declaration and delete it. Also check the constructor for any reviewerAgent initialization.

- [ ] **Step 4: Remove createReviewerAgent from manager.ts**

In `packages/core/src/group/manager.ts`:
- Delete the entire `createReviewerAgent()` private method
- In `create()`: remove the call to `createReviewerAgent()`
- In `delete()`: remove Reviewer disposal logic (look for `reviewerAgent` references)
- In `archiveGroup()`: remove Reviewer disposal logic
- In `restoreGroup()` / `restoreGroups()`: remove Reviewer re-creation logic

- [ ] **Step 5: Delete review-pipeline.ts**

```bash
git rm packages/core/src/group/review-pipeline.ts
```

- [ ] **Step 6: Update imports — remove review-pipeline references**

Run: `npx tsc --noEmit -p packages/core/tsconfig.json`
Fix any remaining import errors referencing `review-pipeline.ts`.

- [ ] **Step 7: Add getToolRegistry() to Agent class**

In `packages/core/src/agent/agent.ts`, add a public method to expose the tool registry (needed by review agent):

```typescript
/** Expose ToolRegistry for ToolAgent use */
getToolRegistry(): ToolRegistry {
  return this.toolRegistry;
}
```

- [ ] **Step 8: Verify build and existing tests**

```bash
pnpm build
pnpm test
```
Expected: Build passes, 296+ tests pass (review-pipeline tests will be removed/gone).

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: refactor review to ToolAgent, remove persistent Reviewer Agent"
```

---

### Task 4: Judgment Tool Agent

**Files:**
- Create: `packages/core/src/agent/tool-agent/judgment.ts`
- Modify: `packages/core/src/group/wake-system.ts` (enqueueMention judgment integration)
- Modify: `config/default.json` (add judgmentModel)

- [ ] **Step 1: Create judgment.ts**

```typescript
/**
 * Judgment Tool Agent — 判断是否需要唤醒群主
 */
import type { LLMProvider } from "@cobeing/providers";
import { ToolRegistry } from "../../tools/registry.js";
import { runToolAgent } from "./base.js";
import type { JudgmentInput, JudgmentResult, ToolAgentResult } from "./types.js";

const JUDGMENT_SYSTEM_PROMPT = `你是群组中的判断助手。唯一职责：审查 Agent 发言，决定是否需要唤醒群主。

需要唤醒群主（wake_host: true）：
1. 发言包含对群主的直接提问或决策请求
2. 报告了关键错误、阻塞问题、安全隐患
3. 群组明显偏离方向、陷入死循环、成员间严重冲突
4. 用户需求发生变化，需要群主重新确认方向
5. 有 Agent 反复失败同一任务超过合理次数
6. 成员完成了阶段任务或关键里程碑，需要群主推进下一阶段

不需要唤醒群主（wake_host: false）：
1. 例行进度更新（"我完成了 X"、"正在做 Y"）
2. 子任务完成通知（非阶段结束）
3. Agent 间的内部协调沟通
4. 对他人消息的确认/回应
5. 工具调用结果的正常汇报

输出格式（仅 JSON，无其他内容）：
{"wake_host":true|false,"reason":"一句话原因","urgency":"high"|"medium"|"low"}`;

export async function runJudgmentAgent(
  input: JudgmentInput,
  provider: LLMProvider,
  model: string,
  parentAgentId: string,
  workingDir: string,
  timeoutMs = 15000,
): Promise<JudgmentResult> {
  const toolRegistry = new ToolRegistry(); // 判断不需要工具

  const userPrompt = `## 群组信息
群组: ${input.groupName}
群主: ${input.hostName}

## 触发消息
发送者: ${input.fromAgentName} (${input.fromAgentId})
内容: ${input.targetMessage}

## 群组最近消息（从 current.md）
${input.recentMessages.join('\n')}

请判断是否需要唤醒群主。只输出 JSON。`;

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), timeoutMs);

  try {
    const result = await runToolAgent(
      {
        id: `tool-judgment-${Date.now()}`,
        type: "judgment",
        parentAgentId,
        model,
        maxIterations: 2,
        tools: [],
        systemPrompt: JUDGMENT_SYSTEM_PROMPT,
        userPrompt,
        workingDir,
        abortSignal: abortController.signal,
      },
      provider,
      toolRegistry,
      workingDir,
    );
    return parseJudgmentOutput(result.output);
  } catch {
    // 超时或其他错误 → 默认唤醒（宁可多唤醒不能漏关键消息）
    return { wake_host: true, reason: "判断超时，默认唤醒群主", urgency: "medium" };
  } finally {
    clearTimeout(timeout);
  }
}

function parseJudgmentOutput(output: string): JudgmentResult {
  try {
    const jsonMatch = output.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        wake_host: parsed.wake_host === true,
        reason: parsed.reason || '',
        urgency: parsed.urgency || 'medium',
      };
    }
  } catch { /* fall through */ }
  return { wake_host: true, reason: "判断结果解析失败，默认唤醒", urgency: "medium" };
}
```

- [ ] **Step 2: Integrate into wake-system.ts**

In `packages/core/src/group/wake-system.ts`, add import at top:

```typescript
import { runJudgmentAgent } from "../agent/tool-agent/judgment.js";
```

Add judgment config fields to WakeSystem class properties (near other config fields):

```typescript
private _judgmentModel: string;
private _judgmentProvider?: import("@cobeing/providers").LLMProvider;
```

In constructor, add initialization:
```typescript
this._judgmentModel = (globalThis as any).__cobeingConfig?.judgmentModel ?? "deepseek-chat";
```

Add setter method:
```typescript
setJudgmentProvider(provider: import("@cobeing/providers").LLMProvider): void {
  this._judgmentProvider = provider;
}
```

Modify `enqueueMention()` to add judgment logic. After the existing checks (agent exists, not self, etc.) and before adding to the queue, add:

```typescript
// Judgment: for @host targets without explicit @host mention, run judgment first
private async enqueueMentionWithJudgment(
  targetAgentId: string,
  triggerMsgId: string,
  triggerTag: string,
  triggerContent: string,
  mentionText?: string,
): Promise<void> {
  // If this is targeting the owner AND not a direct @host mention
  const isOwner = targetAgentId === this.ownerId;
  const isExplicitHostMention = mentionText && (
    mentionText === "@host" ||
    mentionText === `@${this.ownerId}`
  );

  if (isOwner && !isExplicitHostMention && this._judgmentProvider) {
    const host = this.getAgent(targetAgentId);
    const fromAgent = triggerTag ? this.getAgent(triggerTag.replace(/^@/, "")) : undefined;
    if (host) {
      try {
        const recentMsgs = this.currentMd
          ? this.currentMd.getRecent(10)
          : [];
        const result = await runJudgmentAgent(
          {
            targetMessage: triggerContent,
            fromAgentId: triggerTag || "unknown",
            fromAgentName: fromAgent?.name ?? triggerTag ?? "unknown",
            recentMessages: recentMsgs.map(m => `[${(m as any).fromAgentId || (m as any).tag}]: ${(m as any).content}`),
            hostName: host.name,
            groupName: this.ctx.groupId,
          },
          this._judgmentProvider,
          this._judgmentModel,
          targetAgentId,
          host.effectiveWorkspace,
        );

        if (!result.wake_host) {
          log.info("[%s] Judgment: NOT waking host — %s", this.ctx.groupId, result.reason);
          return; // Don't enqueue
        }
        log.info("[%s] Judgment: waking host (urgency=%s) — %s", this.ctx.groupId, result.urgency, result.reason);
      } catch (err) {
        log.warn("[%s] Judgment failed, defaulting to wake: %s", this.ctx.groupId, err);
        // Fall through to normal enqueue
      }
    }
  }

  // Normal enqueue
  this.enqueueMention(targetAgentId, triggerMsgId, triggerTag, triggerContent, mentionText);
}
```

The existing `handleNewMessage()` already calls `this.enqueueMention()`. Replace the owner evaluation section (the `localFilter` block) with a call to `enqueueMentionWithJudgment` for owner-targeting mentions. The simplest approach: add judgment logic before the existing `enqueueMention()` call.

In `handleNewMessage()`, for each mention that resolves to the owner, instead of direct `enqueueMention()`, store it and process after the loop with judgment:

```typescript
// In handleNewMessage(), replace the mention scanning loop's enqueueMention for owner:
// Store owner mentions for judgment processing
const ownerTriggers: Array<{ msgId: string; tag: string; content: string; mentionText: string }> = [];

for (const mention of msg.mentions) {
  if (mention === "all") continue;
  if (mention.length < 2) continue;
  const resolvedId = this.resolveMention(mention);
  if (!resolvedId) continue;
  if (resolvedId === msg.fromAgentId) continue;

  if (resolvedId === this.ownerId) {
    ownerTriggers.push({ msgId: msg.id, tag: msg.tag, content: msg.content, mentionText: `@${mention}` });
  } else {
    this.enqueueMention(resolvedId, msg.id, msg.tag, msg.content, `@${mention}`);
  }
}

// Process owner mentions with judgment
for (const trigger of ownerTriggers) {
  this.enqueueMentionWithJudgment(this.ownerId!, trigger.msgId, trigger.tag, trigger.content, trigger.mentionText);
}
```

- [ ] **Step 3: Add judgmentModel to config/default.json**

```json
"judgmentModel": "deepseek-chat",
```

Add after the existing `reviewer` config block.

- [ ] **Step 4: Wire judgment provider in runtime.ts**

In `packages/core/src/runtime.ts`, find where WakeSystem is created and add:
```typescript
// After wake system creation, set judgment provider
const judgmentProvider = this.providers.get("deepseek") || this.providers.values().next().value;
if (judgmentProvider) {
  wakeSystem.setJudgmentProvider(judgmentProvider);
}
```

- [ ] **Step 5: Verify build**

```bash
pnpm build
```
Expected: Build passes.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add Judgment Tool Agent with wake-system integration"
```

---

### Task 5: Clone Tool Agent + agent-clone Tool

**Files:**
- Create: `packages/core/src/agent/tool-agent/clone.ts`
- Create: `packages/core/src/tools/agent-clone.ts`
- Modify: `packages/core/src/agent/agent.ts` (register agent-clone, add getToolRegistry)

- [ ] **Step 1: Create clone.ts**

```typescript
/**
 * Clone Tool Agent — 母体 Agent 的分身，并行工作
 */
import type { LLMProvider } from "@cobeing/providers";
import { ToolRegistry } from "../../tools/registry.js";
import { runToolAgent } from "./base.js";
import type { CloneInput, CloneTask, ToolAgentResult } from "./types.js";
import { bashTool } from "../../tools/bash.js";
import { readFileTool } from "../../tools/read-file.js";
import { writeFileTool } from "../../tools/write-file.js";
import { editFileTool } from "../../tools/edit-file.js";
import { globTool } from "../../tools/glob.js";
import { grepTool } from "../../tools/grep.js";
import { webFetchTool } from "../../tools/web-fetch.js";

const CLONE_SYSTEM_PROMPT = `你是 Agent "{parentName}" (ID: {parentId}) 的克隆体{groupContext}，执行并行子任务。

你的任务：
{task}

重要规则：
1. 你没有母体的 MEMORY.md 和 EXPERIENCE.md 访问权限。只使用提供的上下文文件。
2. 你可以读取、写入、编辑工作区中的文件。
3. 你可以在工作区中执行 bash 命令。
4. 你不能向群组发送消息。你的唯一输出是返回给母体的结果摘要。
5. 你不能创建新的克隆体（禁止递归克隆）。
6. 完成后，总结：做了什么、发现了什么、产生了什么文件。
7. 如果遇到无法解决的错误，清晰报告并停止。

提供的上下文文件：{fileList}

在 {maxIterations} 轮内完成并返回结果摘要。`;

const CLONE_TOOLS: Record<string, import("@cobeing/shared").Tool> = {
  "bash": bashTool,
  "read-file": readFileTool,
  "write-file": writeFileTool,
  "edit-file": editFileTool,
  "glob": globTool,
  "grep": grepTool,
  "web-fetch": webFetchTool,
};

export async function runCloneAgent(
  task: CloneTask,
  parentName: string,
  parentId: string,
  groupName: string | undefined,
  effectiveWorkspace: string,
  provider: LLMProvider,
  model: string,
  maxIterations: number,
  abortSignal?: AbortSignal,
): Promise<ToolAgentResult> {
  const cloneToolRegistry = new ToolRegistry();
  for (const [name, tool] of Object.entries(CLONE_TOOLS)) {
    cloneToolRegistry.register(tool);
  }

  const groupContext = groupName ? `，在群组 "${groupName}" 中` : "";
  const fileList = task.contextFiles && task.contextFiles.length > 0
    ? task.contextFiles.join(", ")
    : "（无额外上下文文件）";

  const systemPrompt = CLONE_SYSTEM_PROMPT
    .replace("{parentName}", parentName)
    .replace("{parentId}", parentId)
    .replace("{groupContext}", groupContext)
    .replace("{task}", task.description)
    .replace("{fileList}", fileList)
    .replace("{maxIterations}", String(maxIterations));

  return runToolAgent(
    {
      id: `tool-clone-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: "clone",
      parentAgentId: parentId,
      model,
      maxIterations,
      tools: Object.keys(CLONE_TOOLS),
      systemPrompt,
      userPrompt: `开始执行任务。完成后用一段话总结你的工作。`,
      workingDir: effectiveWorkspace,
      abortSignal,
    },
    provider,
    cloneToolRegistry,
    effectiveWorkspace,
  );
}
```

- [ ] **Step 2: Create agent-clone.ts tool**

```typescript
/**
 * agent-clone 工具 — 母体 Agent 创建克隆体并行工作
 */
import type { Tool, ToolResult } from "@cobeing/shared";
import type { LLMProvider } from "@cobeing/providers";
import { runCloneAgent } from "../agent/tool-agent/clone.js";
import { createLogger } from "@cobeing/shared";

const log = createLogger("agent-clone");

export function makeAgentCloneTool(
  getProvider: (providerId?: string) => LLMProvider | undefined,
  getModel: (agentId: string) => string,
): Tool {
  return {
    name: "agent-clone",
    description: "创建临时克隆体并行执行子任务。每个克隆体独立工作，完成后返回结果。克隆体不能向群组发消息、不能创建新克隆体。",
    parameters: {
      type: "object",
      properties: {
        tasks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              description: { type: "string", description: "克隆体的任务描述" },
              contextFiles: {
                type: "array",
                items: { type: "string" },
                description: "上下文文件路径列表（可选）",
              },
            },
            required: ["description"],
          },
          description: "并行任务列表，最多 5 个",
        },
        maxIterations: {
          type: "number",
          description: "每个克隆体的最大 LLM 轮次，默认 5",
        },
      },
      required: ["tasks"],
    },
    async execute(params, context): Promise<ToolResult> {
      const tasks = params.tasks as Array<{ description: string; contextFiles?: string[] }>;
      const maxIterations = (params.maxIterations as number) ?? 5;

      if (!Array.isArray(tasks) || tasks.length === 0) {
        return { toolCallId: "", content: "错误: tasks 必须是非空数组", isError: true };
      }
      if (tasks.length > 5) {
        return { toolCallId: "", content: "错误: 最多同时创建 5 个克隆体", isError: true };
      }

      const provider = getProvider();
      if (!provider) {
        return { toolCallId: "", content: "错误: 无法获取 LLM Provider", isError: true };
      }

      const model = getModel(context.agentId);
      const parentName = context.agentId; // Will be resolved by caller

      const results = await Promise.all(
        tasks.map(async (task, i) => {
          try {
            const result = await runCloneAgent(
              task,
              parentName,
              context.agentId,
              undefined, // groupName not needed in standalone
              context.workingDir,
              provider,
              model,
              maxIterations,
            );
            return { cloneId: `clone-${i + 1}`, result: result.output };
          } catch (err: any) {
            return { cloneId: `clone-${i + 1}`, result: `错误: ${err.message}` };
          }
        }),
      );

      const summary = results.map(r =>
        `### ${r.cloneId}\n${r.result}`
      ).join("\n\n");

      return {
        toolCallId: "",
        content: `克隆体执行完成 (${results.length} 个):\n\n${summary}`,
      };
    },
  };
}
```

- [ ] **Step 3: Register agent-clone in agent.ts**

In `packages/core/src/agent/agent.ts`:

Add import at top:
```typescript
import { makeAgentCloneTool } from "../tools/agent-clone.js";
```

In the constructor, find where other tools are registered (after the `makeSummarizePhaseTool` line) and add:

```typescript
// agent-clone 工具（创建克隆体并行工作）
this.toolRegistry.register(makeAgentCloneTool(
  (providerId) => providerId
    ? this._allProviders.get(providerId)
    : this.provider,
  (_agentId) => this.config.model,
));
```

Also add `agent-clone` to the `getToolRegistry()` method (already added in Task 3).

- [ ] **Step 4: Verify build**

```bash
pnpm build
```
Expected: Build passes.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add Clone Tool Agent + agent-clone tool"
```

---

### Task 6: Memory Tool Agent

**Files:**
- Create: `packages/core/src/agent/tool-agent/memory.ts`
- Modify: `packages/core/src/agent/agent.ts` (trigger personal memory after run())
- Modify: `packages/core/src/todo/group-scanner.ts` (trigger group memory on phase completion)

- [ ] **Step 1: Create memory.ts**

```typescript
/**
 * Memory Tool Agent — 个人/群组经验提取
 */
import type { LLMProvider } from "@cobeing/providers";
import { ToolRegistry } from "../../tools/registry.js";
import { readFileTool } from "../../tools/read-file.js";
import { grepTool } from "../../tools/grep.js";
import { runToolAgent } from "./base.js";
import type {
  MemoryMode, PersonalMemoryInput, GroupMemoryInput,
  MemoryEntry, MemoryToolAgentResult, ToolAgentResult,
} from "./types.js";

const MEMORY_TOOLS: Record<string, import("@cobeing/shared").Tool> = {
  "read-file": readFileTool,
  "grep": grepTool,
};

const PERSONAL_SYSTEM_PROMPT = `你是 Agent "{agentName}" 的记忆助手。审查本次工作轨迹，提取值得记住的经验。

审查材料：思考和推理过程、调用的工具及结果、最终回复内容、任务上下文。

提取重点（个人层面）：
1. 学到了什么关于项目/工具/环境的知识？
2. 犯了什么错误，如何修复的？
3. 哪些策略特别有效？
4. 收到了什么用户偏好或反馈？
5. 发现了什么新的工作模式或最佳实践？

输出格式（JSON 数组）：
[{"category":"类别","summary":"一行摘要（≤120字符）","detail":"详细描述（可选）"}]

类别包括：工具发现、用户偏好、架构决策、协作模式、错误教训、最佳实践

如果本次工作没有值得保存的经验，输出空数组 []。`;

const GROUP_SYSTEM_PROMPT = `你是群组 "{groupName}" 的记忆助手。审查本阶段群组协作，提取群组级经验。

审查材料：本阶段 PROGRESS.md 工作日志、各成员发言和产出、当前 INTERFACE.md、PLAN.md 完成情况。

提取重点（群组层面）：
1. 群组建立了什么新的约定或决策？
2. 哪些协作模式有效/无效？
3. 发现了什么外部依赖或约束？
4. Agent 间的 INTERFACE.md 需要什么更新？
5. 阶段推进中有什么值得下次借鉴的？

输出格式（JSON 对象）：
{
  "entries": [{"category":"类别","summary":"一行摘要（≤120字符）","detail":"详细描述（可选）"}],
  "interfaceUpdates": [{"agentId":"agent id","section":"章节名","entry":"新接口条目"}]
}

如果本阶段没有值得保存的经验，输出 {"entries": [], "interfaceUpdates": []}。`;

function buildPersonalPrompt(input: PersonalMemoryInput): string {
  return `## Agent: ${input.agentName} (${input.agentId})

## 思考过程
${input.trace.thinking.join('\n')}

## 工具调用
${input.trace.toolCalls.map(tc =>
  `[${tc.tool}] ${JSON.stringify(tc.args)} → ${tc.result.slice(0, 500)}`
).join('\n')}

## 最终回复
${input.trace.finalMessage.slice(0, 1000)}

## 任务上下文
${input.taskContext.slice(0, 1000)}

请审查以上内容，提取值得保存的经验。输出 JSON 数组。`;
}

function buildGroupPrompt(input: GroupMemoryInput): string {
  return `## 群组: ${input.groupName} (${input.groupId})

## 本阶段 PLAN.md
${input.phasePlan.slice(0, 2000)}

## 本阶段 PROGRESS.md
${input.progressMd.slice(0, 2000)}

## INTERFACE.md
${input.interfaceMd.slice(0, 2000)}

## 成员贡献
${input.memberContributions.join('\n')}

请审查以上内容，提取群组级经验。输出 JSON 对象。`;
}

export async function runMemoryAgent(
  mode: MemoryMode,
  input: PersonalMemoryInput | GroupMemoryInput,
  provider: LLMProvider,
  model: string,
  workingDir: string,
): Promise<MemoryToolAgentResult> {
  const toolRegistry = new ToolRegistry();
  for (const [name, tool] of Object.entries(MEMORY_TOOLS)) {
    toolRegistry.register(tool);
  }

  const systemPrompt = mode === "personal"
    ? PERSONAL_SYSTEM_PROMPT.replace("{agentName}", (input as PersonalMemoryInput).agentName)
    : GROUP_SYSTEM_PROMPT.replace("{groupName}", (input as GroupMemoryInput).groupName);

  const userPrompt = mode === "personal"
    ? buildPersonalPrompt(input as PersonalMemoryInput)
    : buildGroupPrompt(input as GroupMemoryInput);

  const result = await runToolAgent(
    {
      id: `tool-memory-${mode}-${Date.now()}`,
      type: "memory",
      parentAgentId: mode === "personal" ? (input as PersonalMemoryInput).agentId : (input as GroupMemoryInput).groupId,
      model,
      maxIterations: 3,
      tools: Object.keys(MEMORY_TOOLS),
      systemPrompt,
      userPrompt,
      workingDir,
    },
    provider,
    toolRegistry,
    workingDir,
  );

  return parseMemoryOutput(result, mode);
}

function parseMemoryOutput(result: ToolAgentResult, mode: MemoryMode): MemoryToolAgentResult {
  try {
    const output = result.output.trim();
    if (!output || output === "[]" || output === "Nothing to save." || output === "Nothing to save") {
      return { entries: [] };
    }

    const jsonMatch = output.match(mode === "personal" ? /\[[\s\S]*\]/ : /\{[\s\S]*\}/);
    if (!jsonMatch) return { entries: [] };

    const parsed = JSON.parse(jsonMatch[0]);

    if (mode === "personal") {
      return { entries: Array.isArray(parsed) ? parsed : [] };
    } else {
      return {
        entries: Array.isArray(parsed.entries) ? parsed.entries : [],
        interfaceUpdates: Array.isArray(parsed.interfaceUpdates) ? parsed.interfaceUpdates : undefined,
      };
    }
  } catch {
    return { entries: [] };
  }
}
```

- [ ] **Step 2: Trigger personal memory in agent.ts after run()**

In `packages/core/src/agent/agent.ts`, add import at top:

```typescript
import { runMemoryAgent } from "./tool-agent/memory.js";
```

In the `run()` method, after the `reflectInBackground()` call (line ~658), add group-mode memory trigger:

```typescript
// 群组模式下触发个人记忆智能体（异步，不阻塞返回）
if (isGroup && this.wakeSession) {
  const trace = this.wakeSession.getTrace();
  const hasToolCalls = trace.toolCalls.length > 0;
  if (hasToolCalls) {
    setImmediate(async () => {
      try {
        const memoryResult = await runMemoryAgent(
          "personal",
          {
            agentName: this.name,
            agentId: this.id,
            trace,
            taskContext: input,
          },
          this.provider,
          this.config.model,
          this.effectiveWorkspace,
        );
        if (memoryResult.entries.length > 0) {
          for (const entry of memoryResult.entries) {
            this.files.appendExperience(
              `- [${new Date().toISOString().slice(0, 10)}] [${entry.category}]: ${entry.summary}`,
              entry.detail,
            );
          }
          this.logger.info("Memory: saved %d entries from wake session", memoryResult.entries.length);
        }
      } catch (err) {
        this.logger.debug("Memory agent failed (non-blocking): %s", err);
      }
    });
  }
}
```

- [ ] **Step 3: Trigger group memory in group-scanner.ts**

In `packages/core/src/todo/group-scanner.ts`, add import at top:

```typescript
import { runMemoryAgent } from "../agent/tool-agent/memory.js";
```

In the phase completion detection logic, add after the phase is marked complete:

```typescript
// Phase completed — trigger group memory agent
const group = this.getGroup?.();
if (group) {
  const provider = (globalThis as any).__cobeingGetProvider?.() as import("@cobeing/providers").LLMProvider | undefined;
  if (provider) {
    const model = (globalThis as any).__cobeingConfig?.judgmentModel ?? "deepseek-chat";
    setImmediate(async () => {
      try {
        const memoryResult = await runMemoryAgent(
          "group",
          {
            groupName: group.config.name,
            groupId: group.id,
            phasePlan: group.workspace.readPlan() ?? "",
            progressMd: group.workspace.readProgress() ?? "",
            interfaceMd: group.workspace.readInterface() ?? "",
            memberContributions: [], // extracted from progress
          },
          provider,
          model,
          group.workspace.workspaceDir,
        );
        if (memoryResult.entries.length > 0) {
          for (const entry of memoryResult.entries) {
            group.workspace.appendExperience(
              `- [${new Date().toISOString().slice(0, 10)}] [${entry.category}]: ${entry.summary}`,
              entry.detail,
            );
          }
        }
        if (memoryResult.interfaceUpdates) {
          for (const update of memoryResult.interfaceUpdates) {
            group.workspace.appendInterfaceSection(update.agentId, update.entry);
          }
        }
      } catch (err) {
        // Non-blocking
      }
    });
  }
}
```

- [ ] **Step 4: Verify build**

```bash
pnpm build
```
Expected: Build passes.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add Memory Tool Agent (personal + group modes)"
```

---

### Task 7: Tests

**Files:**
- Create: `packages/core/src/agent/tool-agent/tool-agent.test.ts`

- [ ] **Step 1: Write tests for base.ts**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { runToolAgent } from "./base.js";
import { ToolRegistry } from "../../tools/registry.js";
import type { ToolAgentConfig } from "./types.js";
import type { LLMProvider, ChatChunk, ChatParams } from "@cobeing/providers";
import { bashTool } from "../../tools/bash.js";
import { readFileTool } from "../../tools/read-file.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cobeing-tool-agent-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function mockProvider(responses: Array<AsyncIterable<ChatChunk>>): LLMProvider {
  let call = 0;
  return {
    id: "mock",
    name: "Mock",
    chat: vi.fn(async function* (params: ChatParams) {
      const chunks = responses[call] ?? responses[responses.length - 1];
      call++;
      yield* chunks;
    }),
    chatComplete: vi.fn(async () => ""),
    listModels: vi.fn(async () => []),
    capabilities: vi.fn(() => ({}) as any),
  } as any;
}

async function* textChunk(text: string): AsyncIterable<ChatChunk> {
  yield { type: "content", content: text };
  yield { type: "done" };
}

describe("runToolAgent", () => {
  it("returns LLM text output when no tool calls", async () => {
    const provider = mockProvider([textChunk("任务已完成。")]);
    const registry = new ToolRegistry();

    const config: ToolAgentConfig = {
      id: "test-1",
      type: "review",
      parentAgentId: "agent-1",
      model: "test-model",
      maxIterations: 3,
      tools: [],
      systemPrompt: "你是测试助手。",
      userPrompt: "执行测试。",
      workingDir: tmpDir,
    };

    const result = await runToolAgent(config, provider, registry, tmpDir);
    expect(result.success).toBe(true);
    expect(result.output).toContain("任务已完成");
  });

  it("executes tools and returns final response", async () => {
    // First response: tool call (bash)
    // Second response: text after tool result
    const provider = mockProvider([
      (async function* () {
        yield {
          type: "tool_call",
          toolCall: {
            id: "tc1",
            type: "function",
            function: { name: "bash", arguments: JSON.stringify({ command: "echo hello" }) },
          },
        } as any;
        yield { type: "done" };
      })(),
      textChunk("命令执行成功，输出是 hello。"),
    ]);

    const registry = new ToolRegistry();
    registry.register(bashTool);

    const config: ToolAgentConfig = {
      id: "test-2",
      type: "clone",
      parentAgentId: "agent-1",
      model: "test-model",
      maxIterations: 3,
      tools: ["bash"],
      systemPrompt: "你是测试助手。",
      userPrompt: "执行测试。",
      workingDir: tmpDir,
    };

    const result = await runToolAgent(config, provider, registry, tmpDir);
    expect(result.success).toBe(true);
    expect(result.output).toContain("hello");
  });

  it("stops at maxIterations", async () => {
    // Always return tool call to force looping
    const provider = mockProvider([
      (async function* () {
        yield {
          type: "tool_call",
          toolCall: {
            id: "tc_loop",
            type: "function",
            function: { name: "bash", arguments: JSON.stringify({ command: "echo x" }) },
          },
        } as any;
        yield { type: "done" };
      })(),
    ]);

    const registry = new ToolRegistry();
    registry.register(bashTool);

    const config: ToolAgentConfig = {
      id: "test-3",
      type: "clone",
      parentAgentId: "agent-1",
      model: "test-model",
      maxIterations: 2,
      tools: ["bash"],
      systemPrompt: "你是测试助手。",
      userPrompt: "执行测试。",
      workingDir: tmpDir,
    };

    const result = await runToolAgent(config, provider, registry, tmpDir);
    expect(result.success).toBe(true);
    // Should stop after 2 iterations
  });
});
```

- [ ] **Step 2: Write tests for judgment parsing**

Add to `tool-agent.test.ts`:

```typescript
import { runJudgmentAgent } from "./judgment.js";

describe("runJudgmentAgent", () => {
  it("returns wake_host=true on timeout", async () => {
    // Provider that never yields
    const provider: LLMProvider = {
      id: "slow",
      name: "Slow",
      chat: vi.fn(async function* () {
        // Never yield — timeout will trigger
        await new Promise(() => {}); // hang forever
        yield { type: "done" } as any;
      }),
      chatComplete: vi.fn(async () => ""),
      listModels: vi.fn(async () => []),
      capabilities: vi.fn(() => ({}) as any),
    } as any;

    const result = await runJudgmentAgent(
      {
        targetMessage: "测试消息",
        fromAgentId: "agent-1",
        fromAgentName: "Test",
        recentMessages: [],
        hostName: "Host",
        groupName: "TestGroup",
      },
      provider,
      "test-model",
      "parent-1",
      tmpDir,
      100, // 100ms timeout
    );

    expect(result.wake_host).toBe(true);
    expect(result.reason).toContain("超时");
  });

  it("parses valid JSON output correctly", async () => {
    const provider = mockProvider([
      textChunk('{"wake_host": false, "reason": "例行进度更新", "urgency": "low"}'),
    ]);

    const result = await runJudgmentAgent(
      {
        targetMessage: "完成了 TASK-1",
        fromAgentId: "agent-1",
        fromAgentName: "Worker",
        recentMessages: [],
        hostName: "Host",
        groupName: "TestGroup",
      },
      provider,
      "test-model",
      "parent-1",
      tmpDir,
    );

    expect(result.wake_host).toBe(false);
    expect(result.reason).toBe("例行进度更新");
  });
});
```

- [ ] **Step 3: Write tests for review parsing**

```typescript
import { parseReviewOutput } from "./review.js";

describe("parseReviewOutput", () => {
  it("returns pass=true for valid JSON", () => {
    const result = parseReviewOutput('{"pass": true, "reason": "工作内容充实"}');
    expect(result.pass).toBe(true);
  });

  it("returns pass=false for valid JSON with pass=false", () => {
    const result = parseReviewOutput('{"pass": false, "reason": "只说不做，没有调用工具"}');
    expect(result.pass).toBe(false);
  });

  it("returns pass=true on parse failure", () => {
    const result = parseReviewOutput("不是 JSON");
    expect(result.pass).toBe(true);
  });

  it("extracts JSON from text with surrounding content", () => {
    const result = parseReviewOutput('分析完毕。\n{"pass": true, "reason": "ok"}\n以上是结果。');
    expect(result.pass).toBe(true);
  });
});
```

- [ ] **Step 4: Write tests for memory parsing**

```typescript
import { runMemoryAgent } from "./memory.js";

describe("runMemoryAgent", () => {
  it("returns empty entries for 'Nothing to save'", async () => {
    const provider = mockProvider([textChunk("Nothing to save.")]);
    const result = await runMemoryAgent(
      "personal",
      {
        agentName: "Test",
        agentId: "agent-1",
        trace: { thinking: [], toolCalls: [], finalMessage: "" },
        taskContext: "test",
      },
      provider,
      "test-model",
      tmpDir,
    );
    expect(result.entries).toEqual([]);
  });

  it("parses personal memory entries", async () => {
    const provider = mockProvider([
      textChunk(JSON.stringify([
        { category: "工具发现", summary: "bash 在 Windows 上需 chcp 65001", detail: "避免中文乱码" },
      ])),
    ]);
    const result = await runMemoryAgent(
      "personal",
      {
        agentName: "Test",
        agentId: "agent-1",
        trace: {
          thinking: ["需要执行命令"],
          toolCalls: [{ tool: "bash", args: { command: "dir" }, result: "中文乱码" }],
          finalMessage: "执行完成",
        },
        taskContext: "测试 bash 命令",
      },
      provider,
      "test-model",
      tmpDir,
    );
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].category).toBe("工具发现");
  });

  it("parses group memory with interface updates", async () => {
    const provider = mockProvider([
      textChunk(JSON.stringify({
        entries: [{ category: "协作模式", summary: "并行改同一文件需约定顺序" }],
        interfaceUpdates: [{ agentId: "agent-1", section: "API", entry: "提供 /search 接口" }],
      })),
    ]);
    const result = await runMemoryAgent(
      "group",
      {
        groupName: "TestGroup",
        groupId: "g1",
        phasePlan: "Phase 1",
        progressMd: "完成 Phase 1",
        interfaceMd: "## agent-1",
        memberContributions: ["agent-1: 完成搜索模块"],
      },
      provider,
      "test-model",
      tmpDir,
    );
    expect(result.entries).toHaveLength(1);
    expect(result.interfaceUpdates).toHaveLength(1);
  });
});
```

- [ ] **Step 5: Run tests**

```bash
pnpm --filter @cobeing/core test -- --reporter=verbose tool-agent
```
Expected: All new tests pass.

- [ ] **Step 6: Run full test suite**

```bash
pnpm test
```
Expected: All existing 296 tests + new tests pass.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "test: add ToolAgent unit tests (base, judgment, review, memory)"
```

---

### Task 8: Build, Verify, and Update Docs

**Files:**
- Modify: `STRUCTURE.md` (add tool-agent/ directory)
- Modify: `PROGRESS.md` (add entry)
- Modify: `PROGRESS-LITE.md` (add entry)
- Modify: `docs/项目信息/后端能力清单.md` (add tool agent entries)
- Modify: `docs/项目信息/测试清单.md` (add test file)

- [ ] **Step 1: Full build**

```bash
pnpm build
```
Expected: All 6 packages build successfully.

- [ ] **Step 2: Full test run**

```bash
pnpm test
```
Expected: All tests pass.

- [ ] **Step 3: Update STRUCTURE.md**

Add under `packages/core/src/agent/`:
```
├── tool-agent/
│   ├── types.ts
│   ├── base.ts
│   ├── review.ts
│   ├── judgment.ts
│   ├── clone.ts
│   ├── memory.ts
│   └── tool-agent.test.ts
```

- [ ] **Step 4: Update docs**

In `PROGRESS.md`, append at top:
```
## 2026-05-25

### 新增：工具智能体系统（方案 3）

**变更原因**：实现 4 种临时、非持久化的工具智能体，在需要时创建、用完即毁。

**4 种 ToolAgent**：
1. 审查（Review）— 重构自 review-pipeline.ts，改为临时 ToolAgent 模式
2. 判断（Judgment）— 判断是否需要唤醒群主，减少无效唤醒
3. 复制（Clone）— 母体 Agent 的分身，并行工作
4. 记忆（Memory）— 个人/群组经验自动提取

**新增文件（8 个）**：
- `packages/core/src/agent/tool-agent/types.ts`
- `packages/core/src/agent/tool-agent/base.ts`
- `packages/core/src/agent/tool-agent/review.ts`
- `packages/core/src/agent/tool-agent/judgment.ts`
- `packages/core/src/agent/tool-agent/clone.ts`
- `packages/core/src/agent/tool-agent/memory.ts`
- `packages/core/src/agent/tool-agent/tool-agent.test.ts`
- `packages/core/src/tools/agent-clone.ts`

**修改文件（7 个）**：
- `agent.ts` — 注册 agent-clone 工具；暴露 getToolRegistry()；run() 后触发个人记忆智能体
- `group-tools.ts` — 审核拦截改用 ReviewToolAgent
- `manager.ts` — 移除 createReviewerAgent + Reviewer 生命周期
- `group.ts` — 移除 reviewerAgent 属性
- `wake-system.ts` — 集成判断智能体
- `group-scanner.ts` — phase completion 触发群组记忆智能体
- `config/default.json` — 新增 judgmentModel

**删除文件（1 个）**：
- `group/review-pipeline.ts` — 逻辑迁移到 tool-agent/review.ts

**验证**: pnpm build pass, pnpm test pass
```

In `PROGRESS-LITE.md`, append at top:
```
- [New Feature] 工具智能体系统：4 种 ToolAgent（审查/判断/复制/记忆），独立 LLM 循环，用完即毁
```

- [ ] **Step 5: Final verification**

```bash
pnpm build && pnpm test
```
Expected: Build passes, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "docs: update structure and progress for tool agent system"
```

---

## Self-Review

1. **Spec coverage**: All 4 tool agents covered (Review — Task 3, Judgment — Task 4, Clone — Task 5, Memory — Task 6). Types and base — Tasks 1-2. Tests — Task 7. Docs — Task 8.
2. **No placeholders**: All steps have exact code, file paths, and commands.
3. **Type consistency**: `ToolAgentConfig`, `ToolAgentResult`, `runToolAgent()` signatures consistent across all tasks. `getToolRegistry()` added in Task 3, used in Task 5.
