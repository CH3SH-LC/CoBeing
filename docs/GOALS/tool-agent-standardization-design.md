# 工具智能体标准化 - 设计文档

> 日期：2026-06-08 | 状态：已确认方向

## 背景

CoBeing 当前已经有一组 ToolAgent 实现：`review`、`judgment`、`clone`、`memory`，以及一个用于创建 Agent 核心文件的 `creator`。这些能力已经在代码里发挥作用，但产品概念和边界还不够统一。

本设计明确：**工具智能体就是临时工作单元**。它不是长期存在的普通 Agent，不进入用户的 Agent 列表，不承担关系、人格、长期任务托管或群组协调职责。它在某个工具调用、系统事件或管家创建流程中被临时拉起，完成一个窄任务后返回结果并结束。

## 已确认设计决策

| 维度 | 决策 |
| --- | --- |
| 工具智能体定位 | 临时工作单元，短命、窄能力、用完即止 |
| 与普通 Agent 的区别 | 不长期存在，不进入 registry，不承担人格、关系和持续任务 |
| 与 Skill 的区别 | Skill 是方法流程；工具智能体是一次临时 LLM 工作 |
| 与 Plugin 的区别 | Plugin 扩展系统能力；工具智能体使用已有能力完成临时认知任务 |
| Memory 智能体 | 返回经验/记忆修改结果，帮助主智能体完成 `EXPERIENCE.md` 和 `MEMORY.md` 更新 |
| Creator 智能体 | 帮助管家创建 Agent 和 Group，生成核心文件、角色定义和初始配置建议 |
| 用户可见性 | 默认后台运行，必要时只展示结果或风险，不展示为普通 Agent |
| 责任归属 | 调用方负责最终应用、审批、回滚和对用户解释 |

## 目标

1. 明确工具智能体的概念和产品边界。
2. 统一说明工具智能体的触发方式和生命周期。
3. 梳理当前已有工具智能体。
4. 明确什么任务适合工具智能体。
5. 明确 Memory ToolAgent 如何帮助主智能体更新 `EXPERIENCE.md` 和 `MEMORY.md`。
6. 明确 Creator ToolAgent 如何帮助管家创建 Agent 和 Group。
7. 为后续实现统一接口和配置体系提供依据。

## 非目标

1. 不把工具智能体变成用户可直接长期聊天的 Agent。
2. 不让工具智能体拥有独立人格、长期记忆或群组成员身份。
3. 不让工具智能体静默安装 Skill、Plugin 或 Market 资源。
4. 不让工具智能体替用户做主观审批或高风险授权。
5. 不在本设计中实现新的代码，只形成后续统一实施依据。

## 概念定义

工具智能体是由系统、管家、群主、普通 Agent 或工具调用临时创建的窄任务 LLM 工作单元。

它的特点：

- **临时**：按需创建，完成后销毁或结束上下文。
- **窄能力**：只处理一个清晰任务，例如判断、审查、提取、生成局部文件、并行分析。
- **低人格**：不强调人物设定、关系感或长期表达风格。
- **后台性**：默认不出现在用户日常界面。
- **受调用方约束**：输出结果由调用方决定是否采用。
- **可失败降级**：失败不应拖垮主流程，除非它是安全门禁。

一句话口径：

> 工具智能体不是“另一个同事”，而是“被临时请来做一件窄工作的智能工具”。

## 与其他能力的关系

| 类型 | 本质 | 生命周期 | 典型职责 |
| --- | --- | --- | --- |
| Butler / 管家 | 用户入口和跨空间调度者 | 长期 | 理解用户、派发任务、回传关键事件 |
| Agent / 普通智能体 | 有人格和职责的专业联系人 | 长期 | 承接具体工作、沉淀经验、协作 |
| Group / 群组 | 长期场景空间 | 长期 | 多 Agent 协作、公共记忆、场景任务 |
| Skill | 工作方法或流程 | 可复用资源 | 指导如何做某类任务 |
| Plugin | 系统能力扩展 | 可安装资源 | Provider、工具、UI、渠道、MCP 等 |
| ToolAgent / 工具智能体 | 临时 LLM 工作单元 | 短期 | 判断、审查、提取、生成、并行子任务 |

## 生命周期

推荐生命周期：

```text
触发源
  ↓
构造输入上下文
  ↓
创建临时 ToolAgent
  ↓
运行有限轮 LLM / 工具循环
  ↓
返回结构化结果
  ↓
调用方决定如何应用
  ↓
ToolAgent 结束
```

工具智能体默认不应：

- 注册到 AgentRegistry。
- 出现在前端 Agent 列表。
- 被 WakeSystem 当作群成员唤醒。
- 拥有长期 `CHARACTER.md`、`JOB.md`、`MEMORY.md`。
- 主动向用户发消息。
- 主动修改高风险资源。

## 触发来源

工具智能体可以由四类来源触发。

### 1. 工具调用触发

普通 Agent 或群主调用某个工具时，工具内部创建 ToolAgent。

示例：

- `agent-clone` 创建 Clone ToolAgent。
- 后续可以有 `tool-review-output`、`tool-extract-structured-data` 等工具。

### 2. 系统事件触发

系统生命周期事件触发 ToolAgent。

示例：

- Agent 完成一次群组工作后，触发 Memory ToolAgent。
- 群组 TODO 或阶段完成后，触发 Group Memory ToolAgent。

### 3. 门禁触发

某个动作执行前，先由 ToolAgent 判断是否允许或是否需要升级。

示例：

- `group-send` 发消息前触发 Review ToolAgent。
- 疑似需要唤醒群主前触发 Judgment ToolAgent。

### 4. 创建流程触发

管家或前端创建资源时，ToolAgent 帮助生成初始内容。

示例：

- 创建 Agent 时生成 `CHARACTER.md` 和 `JOB.md`。
- 创建 Group 时生成群组定位、群主初始职责、成员建议、群组 GUIDE 和初始公共记忆。

## 当前已有工具智能体

### Review ToolAgent

作用：审查 Agent 准备发送到群组的消息，判断是否有实际工作、是否偷懒、是否符合任务要求。

触发：`group-send` 发消息前。

输出：`pass` 和 `reason`。

适用场景：

- 群组消息质量门禁。
- 防止 Agent 只说“我马上做”但没有实际产出。
- 防止无效刷屏。

### Judgment ToolAgent

作用：判断是否真的需要唤醒群主。

触发：群组中出现对群主的非显式提及或需要过滤的群主唤醒场景。

输出：`wake_host`、`reason`、`urgency`。

适用场景：

- 减少群主无效唤醒。
- 判断阻塞、冲突、阶段完成、偏航等是否需要群主介入。
- 在判断失败或超时时默认唤醒群主，避免漏掉关键事件。

### Clone ToolAgent

作用：作为母体 Agent 的临时分身，并行执行子任务。

触发：母体 Agent 调用 `agent-clone` 工具。

输出：每个克隆体的结果摘要。

限制：

- 不向群组发送消息。
- 不创建新的克隆体。
- 不拥有母体完整记忆。
- 完成后只把结果返回母体。

适用场景：

- 并行检查多个文件。
- 并行调研多个候选方案。
- 并行生成几个局部草案。
- 母体需要快速分摊重复子任务。

### Memory ToolAgent

作用：从工作轨迹中提取值得保留的经验和记忆修改建议，帮助主智能体完成 `EXPERIENCE.md` 和 `MEMORY.md` 的更新。

触发：

- Agent 完成一次有实际工具调用的群组工作后。
- 群组阶段或 TODO 完成后。
- 后续也可由主 Agent 显式请求。

输出不应只是普通文本，而应是结构化结果：

```ts
interface MemoryToolAgentOutput {
  experienceEntries: Array<{
    category: string;
    summary: string;
    detail?: string;
  }>;
  memoryUpdates: Array<{
    target: "MEMORY.md";
    operation: "append" | "replace" | "remove";
    reason: string;
    content: string;
  }>;
  warnings?: string[];
}
```

应用策略：

- `EXPERIENCE.md` 条目可以由主 Agent 自动追加，仍需摘要、去重和安全扫描。
- `MEMORY.md` 修改应更谨慎，只写事实、环境、用户长期偏好或稳定约定。
- Memory ToolAgent 不应直接成为记忆主体。它返回建议，由主智能体或调用方完成写入。
- 涉及用户隐私、群组内部敏感信息、跨群组泄露风险时，应拒绝或降级为建议。

推荐口径：

> Memory ToolAgent 是主智能体的临时记忆编辑助手。它帮助主智能体看见“这次工作有什么值得记住”，但长期记忆仍属于主智能体。

### Creator ToolAgent

作用：帮助管家创建 Agent 和 Group。

当前代码中主要用于创建 Agent 时生成 `CHARACTER.md` 和 `JOB.md`。后续应扩展为也能帮助创建 Group。

触发：

- Butler 创建 Agent。
- 前端创建 Agent。
- Butler 创建 Group。
- 后续 Butler 从 Market 或模板创建资源时。

创建 Agent 时可生成：

- `CHARACTER.md`。
- `JOB.md`。
- 能力画像建议。
- 初始工具和 Skill 建议。
- 用户确认项。

创建 Group 时可生成：

- 群组名称和场景定位。
- 群主职责 prompt。
- 群组 GUIDE。
- 初始成员建议。
- 成员缺口分析。
- 初始公共记忆种子。
- 初始 TODOboard 建议。
- 是否需要从 Market 拉取 Agent、Skill 或 Plugin 的建议。

Creator ToolAgent 不应直接绕过管家完成高风险资源安装。它负责生成草案和建议，由管家向用户解释并确认。

推荐口径：

> Creator ToolAgent 是管家的临时创建助手。它不拥有资源管理权，只帮助管家把“我要一个什么样的 Agent 或 Group”转成初始文件、配置建议和待确认项。

## 什么任务适合工具智能体

适合的任务通常满足以下条件：

1. 输入清楚。
2. 输出可以结构化。
3. 生命周期短。
4. 不需要长期人格。
5. 不需要直接和用户建立关系。
6. 可重复执行。
7. 可由调用方验证或降级。
8. 失败影响有限，或有明确 fallback。

适合类别：

- 判断类：是否唤醒、是否通过、是否需要升级。
- 审查类：消息质量、结果质量、是否偷懒、是否遗漏。
- 提取类：从上下文提取经验、偏好、事实、结构化字段。
- 生成类：生成 Agent / Group 初始文件草案。
- 并行类：克隆体分摊多个同类子任务。
- 转换类：格式化、摘要、重写、结构化输出。
- 评分类：候选排序、风险等级、置信度判断。

## 什么任务不适合工具智能体

不适合工具智能体的任务：

- 长期陪伴和用户关系经营。
- 多日或多阶段任务托管。
- 需要完整人格和长期记忆的专业角色。
- 群组主持、任务收束和对用户负责。
- 高风险决策、用户审批、授权安装。
- 需要持续和用户来回沟通的任务。
- 需要跨多个空间统筹的调度任务。

这些应交给 Butler、Host、普通 Agent 或 Group。

## 规范接口建议

后续统一实现时，建议每个工具智能体都有一张可配置卡：

```ts
interface ToolAgentSpec {
  type: string;
  name: string;
  purpose: string;
  trigger: string;
  model?: string;
  maxIterations: number;
  timeoutMs?: number;
  tools: string[];
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  visibility: "hidden" | "system_log" | "user_summary";
  writePolicy: "return_only" | "caller_applies" | "safe_auto_apply";
  failurePolicy: "ignore" | "fallback_allow" | "fallback_block" | "escalate";
}
```

关键点：

- 默认 `return_only`。
- 能写入长期文件的必须通过调用方。
- Memory ToolAgent 应使用 `caller_applies` 或低风险 `safe_auto_apply`；即使是 `safe_auto_apply`，也只能写入调用方明确提供的目标文件，不能让 ToolAgent 拥有自己的长期记忆身份。
- Creator ToolAgent 应使用 `caller_applies`，由管家负责解释和确认。
- Review / Judgment 可以作为门禁，但必须有超时和 fallback。

## 与现有实现的差距

当前实现已经具备基础：

- `review`、`judgment`、`clone`、`memory` 有配置目录。
- `base.ts` 提供独立 LLM 工具循环。
- `creator.ts` 已能帮助创建 Agent。
- `group-send` 已接入 Review ToolAgent。
- WakeSystem 已接入 Judgment ToolAgent。
- Agent 群组运行后可异步触发个人 Memory ToolAgent。
- 群组 TODO 完成后可触发 Group Memory ToolAgent。

需要规范和补齐：

1. `ToolAgentType` 应加入 `creator`，或明确 Creator 是 ToolAgent 家族中的特殊实现。
2. Creator ToolAgent 应扩展到 Group 创建。
3. Memory ToolAgent 输出应从单纯 experience entries 扩展为 `EXPERIENCE.md` + `MEMORY.md` 修改建议。
4. Memory 写入应由主智能体或调用方应用，而不是让 ToolAgent 拥有长期记忆身份。
5. 每类 ToolAgent 都应有统一的配置卡、触发说明、失败策略和可见性策略。
6. 前端和日志应能区分“普通 Agent 工作”和“ToolAgent 后台辅助工作”。

## 后续验收方向

后续实现时至少验证：

1. Review ToolAgent 能在群组消息发送前运行，并返回 pass/reason。
2. Judgment ToolAgent 超时或解析失败时默认唤醒群主。
3. Clone ToolAgent 不能递归创建 clone，不能向群组发消息。
4. Memory ToolAgent 能返回 `EXPERIENCE.md` 条目和 `MEMORY.md` 修改建议。
5. 主 Agent 能应用 Memory ToolAgent 返回的低风险经验条目。
6. 涉及敏感或跨群组内容的 MEMORY 修改不会静默写入。
7. Creator ToolAgent 能生成 Agent 初始核心文件。
8. Creator ToolAgent 能为 Group 生成群组 GUIDE、成员建议和初始任务建议。
9. ToolAgent 不进入普通 Agent 列表。
10. ToolAgent 失败不会导致主任务永久挂起。

## 最终口径

工具智能体是临时工作，不是长期智能体。

它的价值在于把普通 Agent、管家和群主不应该长期背负的窄能力拆出来：审查、判断、记忆提取、克隆并行、创建草案。

Memory ToolAgent 是主智能体的临时记忆编辑助手。它返回经验和记忆修改建议，帮助主智能体完成 `EXPERIENCE.md` 和 `MEMORY.md` 更新。

Creator ToolAgent 是管家的临时创建助手。它帮助管家创建 Agent 和 Group，但不绕过管家和用户授权。

边界越清楚，普通 Agent 越能保持人格和长期职责，管家越能专注入口和调度，群主越能专注协作秩序。
