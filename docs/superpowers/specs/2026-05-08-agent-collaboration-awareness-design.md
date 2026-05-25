# Agent 协作意识（待办 #13）设计规格

> 日期：2026-05-08
> 对应待办项：P3.5 — #13 Agent 协作意识

## 概述

增强 Agent 在群组中的协作意识，使其从"被动响应 @mention"进化为"主动感知队友、任务和自身角色"。

## 现状

- `buildGroupCollaborationContext()` 已提供成员画像（name/role/capabilities/personality）
- 三层上下文架构（Abstract + Compressed + Recent）已就位
- TASK.md/PLAN.md/PROGRESS.md 已在 Layer 1 注入，但截断 500 字符
- Agent 被唤醒时对"当前谁在处理什么"无感知
- Agent 不会主动根据 JOB 和能力自我选择任务

## 变更清单

### 1. `packages/core/src/conversation/prompt-builder.ts`

#### 1a. 能力雷达

在 `buildGroupCollaborationContext()` 中新增"能力覆盖"区块。不进行程序化语义分析，而是：

1. 收集所有成员的 JOB.md 中"核心能力"关键词，生成能力列表
2. 将能力列表 + TASK.md（完整版）一起注入上下文
3. 由 Agent（LLM）自行判断：任务需要什么、谁擅长什么、缺口在哪

LLM 天然具备这种语义匹配能力，不需要我们写 NLP 逻辑。

#### 1b. 扩大 TASK.md 截断

- `workspace.task` 截断从 500 放宽到 2000 字符（或完整内容）

#### 1c. 角色自适应指令

在协作规则区块新增：

```
## 角色自适应

根据你的 JOB.md 专注领域：
- 当前任务与你的领域匹配 → 主动承担，直接开始
- 需要多领域协作 → 分析清楚后 @mention 对应成员，说明你负责什么、需要谁做什么
- 你的领域暂时用不上 → 保持待命，但仍可补充相关信息
```

### 2. `packages/core/src/group/group-context-v2.ts`

#### 2a. Agent 活跃状态

```typescript
export interface AgentActiveStatus {
  agentId: string;
  status: "idle" | "processing";
  since: number; // timestamp when status started
}
```

新增 `setAgentStatus()` 和 `getActiveStatuses()` 方法。

### 3. `packages/core/src/group/wake-system.ts`

#### 3a. 执行前刷新上下文

`executeWake()` 中 Layer 1 构建前，重新调用 `group.getMemberProfiles()` 和 `group.workspace.getSummary()`，确保拿到最新数据。

#### 3b. Agent 状态广播

- 开始处理 Agent → `ctxV2.setAgentStatus(agentId, "processing")`
- 处理完成 → `ctxV2.setAgentStatus(agentId, "idle")`
- 在 Layer 1 中注入当前活跃状态列表

### 4. Agent 活跃状态注入协作上下文

在 `buildGroupCollaborationContext()` 中新增"当前活跃成员"区块：

```
## 当前活跃状态

- @agentA: 正在处理中
- @agentB: 空闲
```

## 不变的部分

- WakeSystem 的三层上下文架构不变
- Agent 工具集不变（group-members/talk-create/talk-send/talk-read）
- ConversationLoop 的 group isolation 机制不变
- 前端展示不变

## 涉及文件

1. `packages/core/src/conversation/prompt-builder.ts` — 核心增强
2. `packages/core/src/group/group-context-v2.ts` — AgentActiveStatus
3. `packages/core/src/group/wake-system.ts` — 执行前刷新 + 状态广播
4. `packages/core/src/group/group.ts` — 透传状态方法
