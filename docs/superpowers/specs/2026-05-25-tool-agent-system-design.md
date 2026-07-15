# 工具智能体系统设计规格

> 来源: `docs/调研/综合调研-可执行改进方案.txt` 方案 3
> 状态: 设计已批准，待实现

---

## 概述

工具智能体（Tool Agent）是生命短暂、用完即毁的专用 Agent。不注册到 registry、不持久化、
不出现在前端 Agent 列表、不被 WakeSystem 唤醒、任务完成后自动 dispose。

4 种类型：审查（Review）、判断（Judgment）、复制（Clone）、记忆（Memory）。

## 架构

```
packages/core/src/agent/tool-agent/
├── types.ts           # 接口 + 配置/结果类型
├── base.ts            # 裸 LLM 调用循环（不依赖 Agent 类）
├── review.ts          # 审查智能体
├── judgment.ts        # 判断智能体
├── clone.ts           # 复制智能体
├── memory.ts          # 记忆智能体
└── tool-agent.test.ts
```

### 核心：base.ts

独立于 Agent 类，直接用 Provider.chat() + 手动工具循环：

1. 构造 system prompt + user message
2. provider.chat() → 解析响应
3. 有 tool_use → ToolExecutor.execute() → 结果注入 → 回到步骤 2
4. 无 tool_use → 返回 ToolAgentResult
5. 超过 maxIterations → 强制返回
6. finally → dispose()

注入依赖（全部外部传入）：LLMProvider、ToolExecutor、PermissionEnforcer、workingDir。

### 类型定义

```typescript
export type ToolAgentType = "review" | "judgment" | "clone" | "memory";

export interface ToolAgentConfig {
  id: string;
  type: ToolAgentType;
  parentAgentId: string;
  groupId?: string;
  maxIterations: number;
  tools: string[];
  systemPrompt: string;
  abortSignal?: AbortSignal;
}

export interface ToolAgentResult {
  success: boolean;
  output: string;
  artifacts?: string[];
  metadata?: Record<string, unknown>;
}

export interface ToolAgent {
  readonly type: ToolAgentType;
  run(config: ToolAgentConfig): Promise<ToolAgentResult>;
  dispose(): Promise<void>;
}
```

### dispose 必须做的事

1. 关闭所有 SQLite 连接（WAL checkpoint + close）
2. 删除临时工作目录（如果创建了）
3. 从内存中移除引用
4. 不写 registry.json
5. 不保留会话历史

---

## 1. 审查智能体（Review Tool Agent）

### 现状与改造

现有 `review-pipeline.ts` 依赖 `manager.ts` 创建的持久化 Reviewer Agent。改造为临时 ToolAgent。

**变更**：
- `group-tools.ts` group-send 拦截：`reviewPipeline()` → `ReviewToolAgent.run()`
- `manager.ts`：移除 `createReviewerAgent()`、delete 中的 Reviewer 销毁逻辑
- `group.ts`：移除 `reviewerAgent` 属性
- `review-pipeline.ts`：**删除**，逻辑迁移到 `tool-agent/review.ts`
- `review-experience.ts`：保留，经验注入逻辑不变

### System Prompt

沿用现有 `agent.ts buildReviewPrompt()` 内容，检查工作轨迹（thinking + toolCalls + finalMessage）：
是否只说不做、是否实际执行了工具、是否有实际产出。

### 输入

```typescript
interface ReviewInput {
  agentJobMd: string;
  agentTrace: { thinking: string[]; toolCalls: Array<{name:string;args:unknown;result:string}>; finalMessage: string };
  groupRecentMessages: string[];
  agentMentions: string[];
  groupTaskMd: string;
  groupPlanMd: string;
  groupProgressMd: string;
}
```

### 流程

1. 组装 ReviewInput
2. base.ts 调用 LLM → 返回 `{ pass: boolean; reason: string }`
3. 解析结果 → ToolAgentResult
4. dispose()

---

## 2. 判断智能体（Judgment Tool Agent）

### 功能

群组中非 Host 发言时，在唤醒群主之前做一层廉价过滤，判断是否真的需要唤醒群主。

### 触发位置

`wake-system.ts` 的 `enqueueMention()` 中：

```
消息到达 → 扫描 @mention
  → 目标是群主（@host）且不是显式 @mention？
    → 是：创建判断智能体 → 传入最近消息（从 current.md）→ 运行（max 3 轮）
      → wake_host=true → 群主入队（附带 reason + urgency）
      → wake_host=false → 不入队，记录日志
    → 否（显式 @host 或其他 Agent）：直接入队（保持现有行为）
```

### System Prompt

```
你是群组"{groupName}"中群主"{hostName}"的判断助手。
唯一职责：审查 Agent 发言，决定是否需要唤醒群主。

需要唤醒群主（wake_host: true）：
1. 发言包含对群主的直接提问或决策请求
2. 报告了关键错误、阻塞问题、安全隐患
3. 群组明显偏离方向、陷入死循环、成员间严重冲突
4. 用户需求发生变化，需要群主重新确认方向
5. 有 Agent 反复失败同一任务超过合理次数
6. 成员完成了阶段任务或关键里程碑，需要群主推进下一阶段

不需要唤醒群主（wake_host: false）：
1. 例行进度更新
2. 子任务完成通知（非阶段结束）
3. Agent 间的内部协调沟通
4. 对他人消息的确认/回应
5. 工具调用结果的正常汇报

输出格式（仅 JSON，无其他内容）：
{"wake_host":true|false,"reason":"一句话原因","urgency":"high"|"medium"|"low"}
```

### 输入（仅群组级数据，不读私有上下文）

```typescript
interface JudgmentInput {
  targetMessage: string;
  fromAgentId: string;
  fromAgentName: string;
  recentMessages: string[];   // 从 current.md 最近 10 条
  hostName: string;
  groupName: string;
}
```

### 性能设计

- 轻量模型：`judgmentModel` 配置项（默认 `deepseek-chat`）
- 超时保护：LLM 调用超过 15 秒 → 默认 `wake_host: true`（宁可多唤醒不能漏关键消息）

### 集成

| 文件 | 改动 |
|------|------|
| `wake-system.ts` | `enqueueMention()` 中 @host 目标加入判断分支；新增 `_judgmentModel` 配置 |
| `tool-agent/judgment.ts` | 新建 |
| `config/default.json` | 新增 `judgmentModel: "deepseek-chat"` |

---

## 3. 复制智能体（Clone Tool Agent）

### 功能

母体 Agent 通过 `agent-clone` 工具创建克隆体并行工作。

### 工具定义

```
agent-clone 参数：
  tasks: Array<{
    description: string;
    contextFiles?: string[];
  }>
  maxIterations?: number;  // 默认 5

返回：Array<{ cloneId: string; result: string }>
```

### System Prompt

```
你是 Agent "{parentName}" (ID: {parentId}) 的克隆体，在群组 "{groupName}" 中执行并行子任务。

你的任务：{task}

重要规则：
1. 你没有母体的 MEMORY.md 和 EXPERIENCE.md 访问权限。只使用提供的上下文文件。
2. 你可以读取、写入、编辑工作区中的文件。
3. 你可以在工作区中执行 bash 命令。
4. 你不能向群组发送消息。你的唯一输出是返回给母体的结果摘要。
5. 你不能创建新的克隆体（禁止递归克隆）。
6. 完成后，总结：做了什么、发现了什么、产生了什么文件。
7. 如果遇到无法解决的错误，清晰报告并停止。

提供的上下文文件：{fileList}
在 {maxIterations} 轮内完成并返回结果摘要。
```

### 权限

```typescript
const CLONE_ALLOWED_TOOLS = [
  "read-file", "write-file", "edit-file",
  "glob", "grep", "bash", "web-fetch"
];
const CLONE_BLOCKED_TOOLS = [
  "agent-clone",       // 防止递归爆炸
  "group-send",        // 防止污染群组
  "agent-message",     // 防止直接通信
  "bind-workspace",    // 防止绕过安全边界
];
```

权限级别继承母体。

### 工作目录

使用母体的 `effectiveWorkspace`，不创建独立目录——这才是"分身"的真正含义。

### 生命周期

```
1. 母体调用 agent-clone({ tasks: [...] })
2. 为每个 task 创建 CloneToolAgent → Promise.all 并行运行
3. 全部完成 → 整合结果返回母体
4. dispose()（无文件清理，操作的是共享 workspace）
5. 单克隆体失败 → result 含错误信息，不阻塞其他克隆体
6. 母体 stop() → AbortSignal 传递触发所有克隆体中断
```

### 集成

| 文件 | 改动 |
|------|------|
| `tools/agent-clone.ts` | 新建 |
| `agent.ts` | `injectBuiltinTools()` 注册 agent-clone |
| `tool-agent/clone.ts` | 新建 |
| `tool-agent/base.ts` | 支持 AbortSignal 传递 |

---

## 4. 记忆智能体（Memory Tool Agent）

### 两种形态

| | 个人记忆智能体 | 群组记忆智能体 |
|------|------|------|
| 触发 | Agent 完成群组唤醒后（有实际工具调用时） | 群组完成一个 phase 后 |
| 审查范围 | 本次唤醒的 WakeSession 轨迹 | 本阶段 PROGRESS.md + 所有 Agent 发言 |
| 写入位置 | `agents/{id}/workspace/EXPERIENCE.md` | `groups/{id}/workspace/EXPERIENCE.md` |
| 关注点 | 个人教训、用户偏好、工具技巧 | 群组约定、协作模式、接口变更 |

### 触发

- **个人**：`agent.ts run()` 完成 → wakeSession.getTrace() 有工具调用 → 异步触发
- **群组**：`group-scanner.ts` 检测 phase completion → 触发
- **显式**：用户 `/remember` 命令

### System Prompt — 个人模式

```
你是 Agent "{agentName}" 的记忆助手。审查本次工作轨迹，提取值得记住的经验。

审查材料：思考和推理过程、调用的工具及结果、最终回复内容、任务上下文。

提取重点（个人层面）：
1. 学到了什么关于项目/工具/环境的知识？
2. 犯了什么错误，如何修复的？
3. 哪些策略特别有效？
4. 收到了什么用户偏好或反馈？
5. 发现了什么新的工作模式或最佳实践？

写入格式（每条一行）：- [日期] [类别]: 具体经验
类别：[工具发现] [用户偏好] [架构决策] [协作模式] [错误教训] [最佳实践]

如果本次工作没有值得保存的经验，回复 "Nothing to save."
```

### System Prompt — 群组模式

```
你是群组 "{groupName}" 的记忆助手。审查本阶段群组协作，提取群组级经验。

审查材料：本阶段 PROGRESS.md 工作日志、各成员发言和产出、当前 INTERFACE.md、PLAN.md 完成情况。

提取重点（群组层面）：
1. 群组建立了什么新的约定或决策？
2. 哪些协作模式有效/无效？
3. 发现了什么外部依赖或约束？
4. Agent 间的 INTERFACE.md 需要什么更新？
5. 阶段推进中有什么值得下次借鉴的？

写入：群组 EXPERIENCE.md（经验条目）+ 如接口变化更新 INTERFACE.md 对应章节。

如果本阶段没有值得保存的经验，回复 "Nothing to save."
```

### 写入策略

记忆智能体不直接覆盖 EXPERIENCE.md。返回结构化结果，由调用方调用 `appendExperience` →
触发 `maintainExperienceSummarySync` 自动维护概要区。

### 去重

grep 已有 EXPERIENCE.md 概要区，Jaccard 相似度 > 0.7 → 跳过。

### 返回结果格式

```typescript
interface MemoryToolAgentResult {
  entries: Array<{
    category: string;
    summary: string;       // ≤120 字符
    detail?: string;
  }>;
  interfaceUpdates?: Array<{
    agentId: string;
    section: string;
    entry: string;
  }>;
}
```

### 集成

| 文件 | 改动 |
|------|------|
| `tool-agent/memory.ts` | 新建，两种模式 |
| `agent.ts` | `run()` 完成后异步触发个人记忆智能体 |
| `todo/group-scanner.ts` | phase completion → 触发群组记忆智能体 |
| `tools/experience-reflect.ts` | 可废弃或改为调用记忆智能体的入口 |

---

## 文件变更汇总

### 新建文件

- `packages/core/src/agent/tool-agent/types.ts`
- `packages/core/src/agent/tool-agent/base.ts`
- `packages/core/src/agent/tool-agent/review.ts`
- `packages/core/src/agent/tool-agent/judgment.ts`
- `packages/core/src/agent/tool-agent/clone.ts`
- `packages/core/src/agent/tool-agent/memory.ts`
- `packages/core/src/agent/tool-agent/tool-agent.test.ts`
- `packages/core/src/tools/agent-clone.ts`

### 修改文件

- `packages/core/src/agent/agent.ts` — 注册 agent-clone 工具；run() 后触发个人记忆智能体
- `packages/core/src/group/wake-system.ts` — 判断智能体集成
- `packages/core/src/group/manager.ts` — 移除 createReviewerAgent + Reviewer 销毁逻辑
- `packages/core/src/group/group.ts` — 移除 reviewerAgent 属性
- `packages/core/src/tools/group-tools.ts` — 审核拦截改用 ReviewToolAgent
- `packages/core/src/todo/group-scanner.ts` — phase completion 触发群组记忆智能体
- `config/default.json` — 新增 judgmentModel

### 删除文件

- `packages/core/src/group/review-pipeline.ts` — 逻辑迁移到 tool-agent/review.ts

---

## 自检

- [x] 无 TBD/TODO
- [x] 内部一致：4 种 ToolAgent 均遵循 types.ts 接口 + base.ts 循环
- [x] 范围聚焦：仅方案 3 工具智能体系统，不含方案 2/5/8/9/10
- [x] 无歧义：每种 ToolAgent 的触发条件、输入、输出、集成变更均已明确
