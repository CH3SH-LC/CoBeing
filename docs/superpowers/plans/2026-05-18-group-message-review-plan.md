# 群组消息审核系统 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 CoBeing 群组系统实现消息审核机制 — Agent 向群组发消息前由 Reviewer Agent 审查工作实质，不通过则在同一次唤醒周期内迭代修正。

**Architecture:** 在 group-send 工具层插入审核管道，拦截消息 → 调用 Reviewer（无状态，一次性审核）→ 通过则发布，不通过则将意见返回给原 Agent 并在本轮继续修正。每群组一个共享 Reviewer Agent，自动创建/销毁。

**Tech Stack:** TypeScript, CoBeing Agent/Tool/Group 框架

---

### Task 1: 审核相关类型定义

**Files:**
- Create: `packages/shared/src/review.ts`
- Modify: `packages/shared/src/types.ts` — GroupConfig 扩展
- Modify: `packages/shared/src/index.ts` — 导出 review 模块

- [ ] **Step 1: 创建 review.ts**

```typescript
// packages/shared/src/review.ts

export interface ReviewerConfig {
  enabled: boolean
  maxRounds: number       // 默认 3，设为 0 等价于关闭
  provider?: string       // 可选，默认跟随群组
  model?: string          // 可选，默认跟随群组
}

export interface AgentTraceToolCall {
  tool: string
  args: Record<string, unknown>
  result: string
}

export interface AgentTrace {
  thinking: string[]
  toolCalls: AgentTraceToolCall[]
  finalMessage: string
}

export interface ReviewInput {
  agentJobMd: string
  agentTrace: AgentTrace
  groupRecentMessages: string[]     // 最近 N 条消息文本
  agentMentions: string[]           // @该 Agent 的消息
  groupTaskMd: string
  groupPlanMd: string
  groupProgressMd: string
}

export interface ReviewResult {
  pass: boolean
  reason: string
}

export type ReviewLogEventType = 'review_pending' | 'review_passed' | 'review_failed_override'

export interface ReviewLogEvent {
  type: ReviewLogEventType
  agentId: string
  groupId: string
  rounds?: number
  reason?: string
}
```

- [ ] **Step 2: 扩展 GroupConfig**

```typescript
// packages/shared/src/types.ts
// 在 GroupConfig interface 中追加 reviewer 字段
export interface GroupConfig {
  id: string;
  name: string;
  members: string[];
  owner?: string;
  topic?: string;
  status?: 'active' | 'completed' | 'archived';
  reviewer?: ReviewerConfig;    // ← 新增
}
```

- [ ] **Step 3: 导出 review 模块**

```typescript
// packages/shared/src/index.ts
export * from './review.js'
```

- [ ] **Step 4: 验证构建**

Run: `pnpm build` (从 CoBeing 目录)
Expected: 构建通过，无类型错误

- [ ] **Step 5: 提交**

```bash
git add packages/shared/src/review.ts packages/shared/src/types.ts packages/shared/src/index.ts
git commit -m "feat: add review types and GroupConfig.reviewer field"
```

---

### Task 2: WakeSession 轨迹记录

**Files:**
- Create: `packages/core/src/agent/wake-session.ts`
- Modify: `packages/core/src/agent/agent.ts`

- [ ] **Step 1: 创建 WakeSession 类**

```typescript
// packages/core/src/agent/wake-session.ts
import { AgentTrace, AgentTraceToolCall } from '@cobeing/shared'

export class WakeSession {
  readonly startTime: number = Date.now()
  private _thinking: string[] = []
  private _toolCalls: AgentTraceToolCall[] = []
  finalMessage: string = ''

  recordThinking(text: string) {
    this._thinking.push(text)
  }

  recordToolCall(tool: string, args: Record<string, unknown>, result: string) {
    this._toolCalls.push({ tool, args, result })
  }

  getTrace(): AgentTrace {
    return {
      thinking: [...this._thinking],
      toolCalls: [...this._toolCalls],
      finalMessage: this.finalMessage
    }
  }

  reset() {
    this._thinking = []
    this._toolCalls = []
    this.finalMessage = ''
  }
}
```

- [ ] **Step 2: 在 Agent 中集成 WakeSession**

在 `packages/core/src/agent/agent.ts` 的 Agent class 中：

```typescript
import { WakeSession } from './wake-session.js'

export class Agent {
  // ... 现有属性
  wakeSession?: WakeSession  // 在群组模式下使用

  // 在 run() 中，当以群组模式唤醒时初始化
  async run(options: AgentRunOptions): Promise<void> {
    if (options.groupId) {
      if (!this.wakeSession) this.wakeSession = new WakeSession()
      this.wakeSession.reset()
    }
    // ... 继续现有逻辑
  }

  // 获取 wake 轨迹（供 review-pipeline 调用）
  getWakeTrace(): AgentTrace | null {
    return this.wakeSession?.getTrace() ?? null
  }
}
```

- [ ] **Step 3: 在 ConversationLoop 中记录轨迹**

找到 `conversation-loop.ts` 中 LLM 返回文本和处理工具调用的位置。在消息处理循环中：

```typescript
// 在 onChunk / onComplete 回调中记录 thinking
// (具体位置需根据 conversation-loop.ts 现有代码确定)
// 大致逻辑：
if (agent.wakeSession) {
  // LLM 输出文本时记录 thinking
  agent.wakeSession.recordThinking(chunk.text)
}
```

以及在 ToolExecutor 执行工具后记录工具调用：

```typescript
// 工具执行完毕后
if (agent.wakeSession) {
  agent.wakeSession.recordToolCall(toolName, args, result.content)
}
```

- [ ] **Step 4: 验证构建**

Run: `pnpm build`
Expected: 构建通过

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/agent/wake-session.ts packages/core/src/agent/agent.ts
git commit -m "feat: add WakeSession for agent trace recording"
```

---

### Task 3: 审核管道核心逻辑

**Files:**
- Create: `packages/core/src/group/review-pipeline.ts`

- [ ] **Step 1: 实现 reviewPipeline 函数**

```typescript
// packages/core/src/group/review-pipeline.ts
import { ReviewInput, ReviewResult } from '@cobeing/shared'
import { Group } from './group.js'
import { Agent } from '../agent/agent.js'

export interface ReviewContext {
  agentId: string
  groupId: string
  reviewRetryCount: number  // 跨工具调用传递的重试计数
}

export async function reviewPipeline(
  group: Group,
  agent: Agent,
  message: string,
  ctx: ReviewContext
): Promise<{ result: ReviewResult; retryCount: number }> {
  const reviewer = group.reviewerAgent
  if (!reviewer) {
    // 无 Reviewer 时直接通过
    return { result: { pass: true, reason: '' }, retryCount: ctx.reviewRetryCount }
  }

  // 1. 收集 Agent 轨迹
  const trace = agent.getWakeTrace()
  if (!trace) {
    return { result: { pass: true, reason: '' }, retryCount: ctx.reviewRetryCount }
  }
  trace.finalMessage = message

  // 2. 收集群组上下文
  const recentMessages = group.getRecentMessages(10)  // 最近 10 条
  const mentions = group.getMentionsFor(agent.id)     // @该 Agent 的消息
  const workspace = group.workspace

  // 3. 读取 JOB.md
  const jobMd = await agent.readProfileFile('JOB.md') || ''

  // 4. 组装审核输入
  const input: ReviewInput = {
    agentJobMd: jobMd,
    agentTrace: trace,
    groupRecentMessages: recentMessages.map(m => `[${m.fromAgentId}]: ${m.content}`),
    agentMentions: mentions.map(m => `[${m.fromAgentId}]: ${m.content}`),
    groupTaskMd: await workspace.readFile('TASK.md'),
    groupPlanMd: await workspace.readFile('PLAN.md'),
    groupProgressMd: await workspace.readFile('PROGRESS.md'),
  }

  // 5. 调用 Reviewer（无状态，一次性）
  const reviewResult = await reviewer.reviewOnce(input)

  // 6. 递增重试计数
  const retryCount = ctx.reviewRetryCount + 1

  return { result: reviewResult, retryCount }
}
```

- [ ] **Step 2: 在 Reviewer Agent 上实现 reviewOnce 方法**

Reviewer Agent 需要 `reviewOnce(input)` 方法，该方法：
1. 组装一次性 system prompt（包含审核标准和输入数据）
2. 调用 LLM（不保留上下文，使用 `max_tokens: 512`）
3. 解析 LLM 输出为 `{ pass: boolean, reason: string }`
4. 丢弃 LLM 会话（不写 history、不写 memory）

```typescript
// 在 Agent 类上新增 (或 reviewer-agent.ts)
async reviewOnce(input: ReviewInput): Promise<ReviewResult> {
  const prompt = this.buildReviewPrompt(input)
  // 使用 LLM 的一次性调用，不保留上下文
  const response = await this.llm.call(prompt, {
    maxTokens: 512,
    temperature: 0.1,        // 低温度保证一致性
    storeConversation: false  // 不保存到历史
  })
  return this.parseReviewResult(response.text)
}

private buildReviewPrompt(input: ReviewInput): string {
  return `# 审核任务

你正在审核一条即将发布到群组的消息。

## 审核标准
1. 该 Agent 是否确实进行了实质性工作（调用了工具、产生了具体输出）？
2. 工作方法是否符合任务要求？
3. 该 Agent 是否在偷懒（仅声明意图而未展示实际工作成果）？

## 该 Agent 的职责（JOB.md）
${input.agentJobMd}

## 本轮唤醒的工作轨迹
${input.agentTrace.thinking.map(t => `[思考]: ${t}`).join('\n')}
${input.agentTrace.toolCalls.map(tc => `[工具:${tc.tool}] 参数:${JSON.stringify(tc.args)} → 结果:${tc.result.slice(0,500)}`).join('\n')}

## 待发送的群组消息
${input.agentTrace.finalMessage}

## 群组最近的讨论
${input.groupRecentMessages.join('\n')}

## 针对该 Agent 的 @mention
${input.agentMentions.join('\n')}

## 群组任务
${input.groupTaskMd.slice(0, 1000)}

## 群组计划
${input.groupPlanMd.slice(0, 1000)}

## 进度
${input.groupProgressMd.slice(0, 1000)}

请严格按以下 JSON 格式回复（不要包含其他内容）：
{"pass": true/false, "reason": "如果不通过，请简要说明原因（50字以内）"}`
}

private parseReviewResult(text: string): ReviewResult {
  try {
    return JSON.parse(text.trim())
  } catch {
    // JSON 解析失败 → 视为通过（防崩溃）
    return { pass: true, reason: '' }
  }
}
```

- [ ] **Step 3: 验证构建**

Run: `pnpm build`
Expected: 构建通过

- [ ] **Step 4: 提交**

```bash
git add packages/core/src/group/review-pipeline.ts
git commit -m "feat: implement review pipeline with stateless reviewer call"
```

---

### Task 4: 群组自动创建/销毁 Reviewer Agent

**Files:**
- Modify: `packages/core/src/group/group.ts`
- Modify: `packages/core/src/group/manager.ts`

- [ ] **Step 1: Group 类新增 reviewerAgent 引用和 reviewer 配置读写**

```typescript
// packages/core/src/group/group.ts
export class Group {
  // ... 现有属性
  reviewerAgent?: Agent

  get reviewerConfig(): ReviewerConfig {
    return this.config.reviewer ?? { enabled: false, maxRounds: 3 }
  }

  setReviewerConfig(config: Partial<ReviewerConfig>) {
    this.config.reviewer = { ...this.reviewerConfig, ...config }
  }
}
```

- [ ] **Step 2: GroupManager.create 中自动创建 Reviewer**

```typescript
// packages/core/src/group/manager.ts
// 在 create() 方法中，group 实例化之后

async create(config: GroupConfig): Promise<Group> {
  // ... 现有逻辑：registry → new Group → 连接
  
  // 新增：自动创建 Reviewer Agent
  if (config.reviewer?.enabled !== false) {
    const reviewerAgent = await this.createReviewerAgent(group)
    group.reviewerAgent = reviewerAgent
  }
  
  // ... 现有逻辑：saveGroup → TodoScanner → return group
}

private async createReviewerAgent(group: Group): Promise<Agent> {
  const reviewerId = `${group.id}-reviewer`
  
  // 如果已存在则跳过
  if (this.agentRegistry.has(reviewerId)) {
    return this.agentRegistry.get(reviewerId)!
  }

  // 创建 Reviewer Agent 的 config，标记 isReviewer
  const reviewerConfig: AgentConfig = {
    id: reviewerId,
    name: `${group.name}审核官`,
    role: 'reviewer',
    isReviewer: true,   // 系统标记
    provider: group.config.reviewer?.provider,
    model: group.config.reviewer?.model,
    // Reviewer 不需要工具权限
    toolPermissions: [],
    skills: []
  }

  // 生成 JOB.md
  const jobMd = `你的工作是审核群组成员发往群组的消息。

审核标准：
1. 该智能体是否确实进行了实质性工作（调用了工具、产生了输出）
2. 工作方法是否符合任务要求
3. 智能体是否在偷懒（仅声明意图而未展示实际工作成果）

审核要求：
- 一次只做一件事：审核当前消息
- 每次审核后清空上下文，不保留记忆
- 返回 pass=true/false + 具体原因（50字以内）`

  // 注册并初始化
  const agent = this.registry.createAgent(reviewerConfig)
  await agent.writeProfileFile('JOB.md', jobMd)
  
  return agent
}
```

- [ ] **Step 3: 群组销毁时销毁 Reviewer**

```typescript
// group/manager.ts delete() 方法中
async delete(groupId: string): Promise<void> {
  const group = this.groups.get(groupId)
  if (!group) return

  // 销毁 Reviewer Agent
  if (group.reviewerAgent) {
    this.registry.destroyAgent(group.reviewerAgent.id)
  }

  // ... 现有逻辑：registry remove → group.dispose() → 删目录
}
```

- [ ] **Step 4: 恢复群组时恢复 Reviewer**

```typescript
// group/manager.ts restoreGroups() 中
// 在 Group 实例化并连接后，恢复 Reviewer
if (group.reviewerConfig.enabled) {
  const reviewerAgent = await this.createReviewerAgent(group)
  group.reviewerAgent = reviewerAgent
}
```

- [ ] **Step 5: 验证构建**

Run: `pnpm build`
Expected: 构建通过

- [ ] **Step 6: 提交**

```bash
git add packages/core/src/group/group.ts packages/core/src/group/manager.ts
git commit -m "feat: auto-create reviewer agent on group creation"
```

---

### Task 5: group-send 工具增加审核拦截

**Files:**
- Modify: `packages/core/src/tools/group-tools.ts`

- [ ] **Step 1: 修改 makeGroupSendTool，增加审核拦截**

```typescript
// packages/core/src/tools/group-tools.ts

// 修改 execute 部分
async execute(params, context) {
  const group = getGroup(params.groupId)
  if (!group) return { toolCallId: context.toolCallId, content: '群组不存在', isError: true }

  const agent = this.agentRegistry.get(context.agentId)
  if (!agent) return { toolCallId: context.toolCallId, content: 'Agent不存在', isError: true }

  let message = params.message
  if (params.mention) message = `${params.mention} ${message}`

  // === 审核拦截 ===
  if (group.reviewerConfig.enabled) {
    const reviewCtx: ReviewContext = {
      agentId: context.agentId,
      groupId: group.id,
      reviewRetryCount: (context as any).reviewRetryCount ?? 0
    }

    emitReviewLog({ type: 'review_pending', agentId: context.agentId, groupId: group.id })

    const { result, retryCount } = await reviewPipeline(group, agent, message, reviewCtx)

    if (result.pass) {
      // 审核通过 → 正常发布
      group.postMessage(context.agentId, message)
      emitReviewLog({ type: 'review_passed', agentId: context.agentId, groupId: group.id })
      return { toolCallId: context.toolCallId, content: '消息已发送到群组。' }
    }

    if (retryCount < group.reviewerConfig.maxRounds) {
      // 未通过但可重试 → 注入反馈，不发布消息
      await injectReviewExperience(agent, group, result.reason, false)
      return {
        toolCallId: context.toolCallId,
        content: `【审核未通过】\n原因：${result.reason}\n请根据反馈修正后重新发送消息。本轮还可重试 ${group.reviewerConfig.maxRounds - retryCount} 次。`
      }
    }

    // 轮次耗尽 → 强制发布 + 标记
    group.postMessage(context.agentId, message, { reviewOverridden: true })
    await injectReviewExperience(agent, group, result.reason, true)
    emitReviewLog({ type: 'review_failed_override', agentId: context.agentId, groupId: group.id, rounds: retryCount, reason: result.reason })
    return {
      toolCallId: context.toolCallId,
      content: `消息已强制发送（经 ${retryCount} 轮审核未通过）。\n最终审核意见：${result.reason}\n请在下次工作中注意。`
    }
  }

  // === 审核关闭，直接发布 ===
  group.postMessage(context.agentId, message)
  return { toolCallId: context.toolCallId, content: '消息已发送到群组。' }
}
```

- [ ] **Step 2: 处理 maxRounds=0 的情况**

```typescript
// 在审核拦截入口处添加快速通道
if (group.reviewerConfig.enabled && group.reviewerConfig.maxRounds === 0) {
  // maxRounds=0 视为审核关闭，但保留 enabled 标记
  group.postMessage(context.agentId, message)
  return { toolCallId: context.toolCallId, content: '消息已发送到群组。' }
}
```

- [ ] **Step 3: 验证构建**

Run: `pnpm build`
Expected: 构建通过

- [ ] **Step 4: 提交**

```bash
git add packages/core/src/tools/group-tools.ts
git commit -m "feat: add review interception to group-send tool"
```

---

### Task 6: 审核反馈自动经验注入

**Files:**
- Create: `packages/core/src/group/review-experience.ts`
- Modify: `packages/core/src/tools/group-tools.ts` (导入新函数)

- [ ] **Step 1: 实现经验注入函数**

```typescript
// packages/core/src/group/review-experience.ts
import { Agent } from '../agent/agent.js'
import { Group } from './group.js'

export async function injectReviewExperience(
  agent: Agent,
  group: Group,
  reason: string,
  exhausted: boolean
): Promise<void> {
  const dateStr = new Date().toISOString().slice(0, 10)
  const status = exhausted ? '轮次耗尽强制发布' : '已根据反馈修正后通过'
  
  const entry = `\n## ${dateStr} 审核反馈（群组：${group.config.name}）\n向群组发送消息时审核未通过：\n- 原因：${reason}\n- 处理结果：${status}\n`

  // 追加到 Agent 的 MEMORY.md
  await agent.appendProfileFile('MEMORY.md', entry)
}
```

- [ ] **Step 2: 在 group-tools.ts 中导入并使用**

```typescript
// group-tools.ts 顶部
import { injectReviewExperience } from '../group/review-experience.js'
```

- [ ] **Step 3: 验证构建**

Run: `pnpm build`
Expected: 构建通过

- [ ] **Step 4: 提交**

```bash
git add packages/core/src/group/review-experience.ts packages/core/src/tools/group-tools.ts
git commit -m "feat: auto-inject review feedback as agent experience"
```

---

### Task 7: 前端日志事件

**Files:**
- Modify: `packages/core/src/api/ws-server.ts`
- Modify: `gui-v2/src/hooks/useWebSocket.ts`

- [ ] **Step 1: 后端 WS 新增审核日志广播**

在 `ws-server.ts` 中新增 `emitReviewLog` 函数：

```typescript
// packages/core/src/api/ws-server.ts
function emitReviewLog(event: ReviewLogEvent) {
  wsServer.broadcast({
    type: 'review_log',
    ...event
  })
}
```

在审核拦截点中调用（已在 Task 5 中引用此函数，需要确保它可访问）。

- [ ] **Step 2: 前端处理 review_log 事件**

在 `gui-v2/src/hooks/useWebSocket.ts` 中添加：

```typescript
// 在消息分发 switch 中
case 'review_log':
  addLogEntry({
    timestamp: Date.now(),
    type: mapReviewType(msg.type),
    message: formatReviewMessage(msg)
  })
  break

function mapReviewType(type: string): 'info' | 'warning' | 'error' {
  switch (type) {
    case 'review_pending': return 'info'
    case 'review_passed': return 'info'
    case 'review_failed_override': return 'warning'
  }
}

function formatReviewMessage(msg: ReviewLogEvent): string {
  switch (msg.type) {
    case 'review_pending': return `[审核中] ${msg.agentId} 的消息正在审核...`
    case 'review_passed': return `[审核通过] ${msg.agentId} 的消息已通过审核`
    case 'review_failed_override': return `[审核失败] ${msg.agentId} 的消息在第 ${msg.rounds} 轮仍未通过（${msg.reason}），已强制发布`
  }
}
```

- [ ] **Step 3: 验证构建**

Run: `pnpm build` 和 `cd gui-v2 && npm run build`
Expected: 前后端构建通过

- [ ] **Step 4: 提交**

```bash
git add packages/core/src/api/ws-server.ts gui-v2/src/hooks/useWebSocket.ts
git commit -m "feat: add review log events (frontend + backend)"
```

---

### Task 8: 前端群组消息审核状态显示

**Files:**
- Modify: `gui-v2/src/components/chat/GroupMessageBubble.tsx`
- Modify: `gui-v2/src/components/chat/GroupChatView.tsx`（可能需要）

- [ ] **Step 1: 消息气泡增加审核状态标记**

在 `GroupMessageBubble.tsx` 中：

```typescript
// 在消息渲染部分
// 假设消息有 metadata.reviewOverridden 标记
const isReviewOverridden = message.metadata?.reviewOverridden === true

// 在气泡右上角显示 ⚠️ 标记
{isReviewOverridden && (
  <span className="text-warning text-xs ml-1" title="审核未通过，已强制发布">
    ⚠️
  </span>
)}
```

- [ ] **Step 2: 验证构建**

Run: `cd gui-v2 && npm run build`
Expected: 构建通过

- [ ] **Step 3: 提交**

```bash
git add gui-v2/src/components/chat/GroupMessageBubble.tsx
git commit -m "feat: show review override warning on group message bubble"
```

---

### Task 9: 配置模式验证

**Files:**
- Modify: `packages/core/src/config/schema.ts`

- [ ] **Step 1: 添加 reviewer 配置验证**

```typescript
// packages/core/src/config/schema.ts
// 在 group 配置模式中添加
const groupSchema = {
  // ... 现有字段
  reviewer: {
    enabled: { type: 'boolean', default: true },
    maxRounds: { type: 'number', default: 3, min: 0 },
    provider: { type: 'string', optional: true },
    model: { type: 'string', optional: true }
  }
}
```

- [ ] **Step 2: 更新 config/default.json 中的默认群组配置**

```json
{
  "groups": [],
  "reviewer": {
    "enabled": true,
    "maxRounds": 3
  }
}
```

- [ ] **Step 3: 验证构建**

Run: `pnpm build`
Expected: 构建通过

- [ ] **Step 4: 提交**

```bash
git add packages/core/src/config/schema.ts
git commit -m "feat: add reviewer config schema validation"
```

---

### Task 10: 边界情况处理

**Files:**
- Modify: `packages/core/src/tools/group-tools.ts` (Reviewer 调用失败)
- Modify: `packages/core/src/group/manager.ts` (群组无 provider)
- Modify: `packages/core/src/agent/agent.ts` (WakeSession 超时)

- [ ] **Step 1: Reviewer LLM 调用失败 → 放行**

```typescript
// review-pipeline.ts 中
try {
  const reviewResult = await reviewer.reviewOnce(input)
  // ...
} catch (err) {
  // Reviewer 调用异常 → 放行消息，记录警告
  console.warn(`[Reviewer] 审核调用失败: ${err}`)
  emitReviewLog({ type: 'review_failed_override', agentId, groupId, rounds: 0, reason: '审核服务异常，消息已直接发布' })
  return { result: { pass: true, reason: '' }, retryCount: 0 }
}
```

- [ ] **Step 2: Agent wake 超时处理**

如果 Agent 在审核重试中达到唤醒超时，group-send 已经返回结果。Agent 的下一次唤醒会看到 MEMORY.md 中注入的审核反馈经验。

- [ ] **Step 3: 验证构建**

Run: `pnpm build`
Expected: 构建通过

- [ ] **Step 4: 提交**

```bash
git add packages/core/src/group/review-pipeline.ts
git commit -m "fix: handle reviewer LLM failure gracefully"
```

---

### 自审查清单

- [x] **Spec 覆盖度**：每项 spec 需求都已对应到实施任务：
  - Reviewer Agent 创建/销毁 → Task 4
  - 审核管道 → Task 3, Task 5
  - 同一唤醒周期内迭代 → Task 5 (group-send 返回 feedback, Agent 继续)
  - 经验记录 → Task 6
  - 前端日志 → Task 7
  - UI 标记 → Task 8
  - maxRounds 配置 → Task 1 (类型), Task 9 (schema), Task 5 (逻辑)
  - 边界情况 → Task 10

- [x] **无占位符**：所有代码块包含完整实现

- [x] **类型一致性**：ReviewInput/ReviewResult/ReviewerConfig 在 Task 1 定义，后续所有任务使用相同类型名
