# 群组消息审核系统设计

> 日期：2026-05-18
> 状态：设计稿

---

## 1. 问题

智能体在群组中可能存在以下行为：
- 未实际工作就汇报进度（偷懒/画饼）
- 工作方法不符合要求
- 输出质量不达标

需要一个自动化的审核机制，在消息发布到群组前进行检查。

## 2. 设计目标

- 每个群组配一个 Reviewer Agent，审核所有成员发往群组的消息
- 审核不通过时，在原 Agent 的同一唤醒周期内迭代修正
- 审核通过的反馈自动沉淀为 Agent 的经验
- Reviewer 无状态，每次审核后清空上下文

### Agent 输出轨迹收集

`agentTrace` 来源于 Agent 当前唤醒周期的执行记录器（`WakeSessionRecorder`），每次 Agent 唤醒时创建：

- Agent 每次 LLM 调用的完整输入输出（thinking + 生成的文本）
- Agent 调用的每个工具及参数
- 每个工具返回的结果

该记录器在 Agent 唤醒时初始化，在唤醒结束时销毁。`group-send` 调用时从记录器中提取当前已累积的全部轨迹。

## 3. 整体流程

```
Agent A 被唤醒（正常工作周期）
  │
  ├─ 做工作、调工具、生成输出
  │
  ├─ 调用 group-send 发送消息到群组
  │     │
  │     ▼
  ├─ [系统拦截] 消息标记为 pending_review
  │     │
  │     ├─ 组装 Reviewer 输入包：
  │     │   ├─ Agent A 的 JOB.md
  │     │   ├─ Agent A 本轮唤醒的全部输出轨迹
  │     │   │   ├─ LLM 生成的所有文本
  │     │   │   ├─ 调用的所有工具及参数
  │     │   │   ├─ 所有工具返回结果
  │     │   │   └─ 待发送的群组消息
  │     │   ├─ 群组最近 N 条消息（群组公共上下文）
  │     │   ├─ Agent A 被 @mention 的消息
  │     │   └─ 群组 TASK.md / PLAN.md / PROGRESS.md
  │     │
  │     ├─ 调用 Reviewer Agent 审核
  │     │
  │     ├─ [通过] ──→ 消息发布到群组 → Agent A 本轮正常结束
  │     │
  │     └─ [不通过] ──→
  │           1. 审核意见自动写入 Agent A 的 MEMORY.md（经验沉淀）
  │           2. group-send 工具返回审核意见给 Agent A
  │           3. Agent A 在同一唤醒周期内看到反馈 → 修正 → 重试 group-send
  │           4. 循环直到审核通过或轮次耗尽
  │
  └─ 审核通过 → 消息进入群组上下文，WakeSystem 通知其他成员
```

**关键约束**：Agent A 从首次尝试群组发消息到审核通过/最终失败，全程保持在同一个唤醒周期内。不经过睡眠-唤醒的切换。

## 4. 重试机制

### 4.1 审核轮次

```
Reviewer 每次返回: { pass: boolean, reason: string }

┌─ pass=true  → 消息发布到群组，Agent A 本轮结束
│
└─ pass=false → [本轮重试计数+1]
     ├─ 本轮重试计数 < maxRounds (默认3) →
     │   • 审核意见写入 Agent A 的 MEMORY.md 作为经验
     │   • group-send 工具返回审核意见
     │   • Agent A 保持在当前唤醒周期，看到反馈后修正重试
     │
     └─ 本轮重试计数 ≥ maxRounds →
         • 消息强制发布到群组，带 "⚠️ 审核未通过" 标签
         • 发送审核失败日志到前端
```

### 4.2 配置项

位于群组 `config.json`：

```json
{
  "reviewer": {
    "enabled": true,
    "maxRounds": 3,
    "provider": "default",
    "model": "default"
  }
}
```

- `enabled`：总开关
- `maxRounds`：单条消息最大审核轮次（默认 3）
- `provider` / `model`：可选，指定 Reviewer 使用的 LLM（默认跟随群组配置）

## 5. Reviewer Agent

### 5.1 创建与生命周期

- 群组创建时**自动创建** Reviewer Agent
- 群组销毁时**自动销毁** Reviewer Agent
- 标记 `config.json` 中 `isReviewer: true`（系统保护）
- 命名：`{groupName}-reviewer`
- 不可被用户手动删除
- 不可被 @mention 唤醒

### 5.2 系统角色定义

Reviewer Agent 的 JOB.md（自动生成）：

```
你的工作是审核群组成员发往群组的消息。

审核标准：
1. 该智能体是否确实进行了实质性工作（调用了工具、产生了输出）
2. 工作方法是否符合任务要求
3. 智能体是否在偷懒（仅声明意图而未展示实际工作成果）

审核依据：
- 该智能体的 JOB.md（了解其职责）
- 该智能体本轮唤醒的全部输出轨迹（文本、工具调用、工具结果）
- 群组最近的消息上下文
- 群组 TASK.md / PLAN.md / PROGRESS.md

审核要求：
- 一次只做一件事：审核当前消息
- 每次审核后清空上下文，不保留记忆
- 返回 pass=true/false + 具体原因
```

### 5.3 无状态调用

每次审核组装一次性的系统 Prompt，包含完整上下文：
- Agent 的 JOB.md
- Agent 本轮完整输出轨迹
- 群组上下文窗口
- 群组工作区文档摘要

审核完成后，Reviewer 的对话上下文**全部丢弃**，不写入 MEMORY.md，不使用记忆系统。

## 6. 审核输入包结构

```
ReviewInput {
  agentJobMd: string        // 发送者的 JOB.md 全文
  agentTrace: {             // 发送者本轮唤醒完整轨迹
    thinking: string[]      // LLM 生成的推理/思考文本
    toolCalls: [{           // 工具调用记录
      tool: string
      args: object
      result: string
    }]
    finalMessage: string    // 待发送的群组消息
  }
  groupContext: {
    recentMessages: Message[]   // 群组最近 N 条消息
    mentions: Message[]         // @该 Agent 的消息
  }
  groupWorkspace: {
    taskMd: string
    planMd: string
    progressMd: string
  }
}
```

## 7. Agent 端改动

### 7.1 group-send 工具行为变更

```typescript
// 新行为
async function handleGroupSend(agentId, message, context) {
  const group = groupManager.get(context.groupId)

  // 审核关闭 → 直接发布
  if (!group.config.reviewer.enabled) {
    group.addMessage(agentId, message)
    return { success: true }
  }

  // 审核开启 → 进入审核管道
  const reviewResult = await reviewPipeline(agentId, message, context)

  if (reviewResult.pass) {
    // 审核通过 → 正常发布
    group.addMessage(agentId, message)
    return { success: true }
  }

  if (reviewResult.retryCount < group.config.reviewer.maxRounds) {
    // 审核未通过，可重试
    // group-send 向 Agent 返回反馈
    return {
      success: false,
      reviewFailed: true,
      feedback: reviewResult.reason,
      retryCount: reviewResult.retryCount,
      retryAvailable: true
    }
  }

  // 轮次耗尽 → 强制发布 + 标记
  group.addMessage(agentId, message, { reviewOverridden: true })
  emitFrontendLog({
    type: 'review_failed_override',
    agentId,
    groupId,
    rounds: group.config.reviewer.maxRounds,
    reason: reviewResult.reason
  })
  return {
    success: true,
    reviewOverridden: true,
    finalFeedback: reviewResult.reason
  }
}
```

### 7.2 自动经验注入

审核不通过时，系统自动向 Agent A 的 MEMORY.md 追加经验条目：

```
## 2026-05-18 审核反馈（群组：{groupName}）

向群组发送消息时审核未通过：
- 原因：{reviewer 返回的 reason}
- 处理结果：已根据反馈修正后通过 / 轮次耗尽强制发布
```

该条目在当前 wake 周期内即注入上下文，后续 LLM 调用可见。

### 7.3 审核管道实现

```typescript
async function reviewPipeline(agentId, message, context) {
  const group = groupManager.get(context.groupId)
  const groupContext = getGroupRecentContext(context.groupId, agentId)
  const agentTrace = getAgentCurrentTrace(agentId)  // 本轮唤醒全部轨迹
  const agentJob = readAgentJobMd(agentId)
  const workspace = readGroupWorkspace(context.groupId)

  // 组装 Reviewer 输入
  const input = {
    agentJobMd: agentJob,
    agentTrace: {
      thinking: agentTrace.thinking,
      toolCalls: agentTrace.toolCalls,
      finalMessage: message
    },
    groupContext: {
      recentMessages: groupContext.recentMessages,
      mentions: groupContext.mentions
    },
    groupWorkspace: {
      taskMd: workspace.taskMd,
      planMd: workspace.planMd,
      progressMd: workspace.progressMd
    }
  }

  // 调用 Reviewer（无状态，一次性）
  const reviewer = group.reviewerAgent
  const result = await reviewer.review(input)

  // retryCount 由审核管道维护，附加在 context 中跨工具调用传递
  const retryCount = (context.reviewRetryCount ?? 0) + 1
  context.reviewRetryCount = retryCount

  return {
    pass: result.pass,
    reason: result.reason,
    retryCount
  }
}
```

## 8. 前端改动

### 8.1 日志面板

新增审核事件条目类型：

| 事件 | 显示内容 |
|------|---------|
| `review_pending` | `[审核中] {agentName} 的消息正在审核...` |
| `review_passed` | `[审核通过] {agentName} 的消息已通过审核` |
| `review_failed_override` | `[审核失败] {agentName} 的消息在第 N 轮仍未通过，已强制发布（⚠️ 标记）` |

### 8.2 群组消息气泡

- 审核中的消息：灰字占位符 `🔍 {agentName} 正在提交消息...`（其他 Agent 可见状态但不可见内容）
- 轮次耗尽强制发布：消息右上角显示 `⚠️` 标记

## 9. 审核相关类型定义

```typescript
// packages/shared/src/types.ts

interface ReviewerConfig {
  enabled: boolean
  maxRounds: number       // 默认 3
  provider?: string       // 可选，默认跟随群组
  model?: string          // 可选，默认跟随群组
}

interface ReviewInput {
  agentJobMd: string
  agentTrace: {
    thinking: string[]
    toolCalls: ToolCallRecord[]
    finalMessage: string
  }
  groupContext: {
    recentMessages: Message[]
    mentions: Message[]
  }
  groupWorkspace: {
    taskMd: string
    planMd: string
    progressMd: string
  }
}

interface ReviewResult {
  pass: boolean
  reason: string
}

// 审核事件日志
type FrontendLogEvent =
  | { type: 'review_pending'; agentId: string; groupId: string }
  | { type: 'review_passed'; agentId: string; groupId: string }
  | { type: 'review_failed_override'; agentId: string; groupId: string; rounds: number; reason: string }
```

## 10. 边界情况

| 场景 | 行为 |
|------|------|
| 审核开关关闭 | 消息直接发布，不走审核管道 |
| Reviewer 调用失败（LLM 报错） | 视为审核通过，消息直接发布，前端记录警告日志 |
| Agent 在审核重试中切换话题 | 每次 group-send 调用独立审核，不追溯之前被拒的消息 |
| Agent 长时间不重试（超时） | Agent 唤醒有自然超时，超时后消息丢弃，前端记录超时日志 |
| 群组未配置 Reviewer | 自动用群组默认 provider/model 创建，若群组也无 provider 则报错 |
| maxRounds = 0 | 等价于关闭审核，消息直接发布 |
