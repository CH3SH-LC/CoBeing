# Agent 协作能力强化设计

> 日期: 2026-04-25
> 状态: 待实现
> 模块: 13-17（协作意识、主动行为、任务分派、冲突解决、知识共享）

## 背景

当前 Agent 协作是纯被动的：Agent 只在被 @mention 时才响应，对群组上下文（任务、计划、队友能力）完全无感知，无法主动接力协作，无结构化任务流转，无冲突解决，知识完全隔离。

本设计从 **Prompt 驱动** 角度强化协作能力：通过在 system prompt 中注入协作上下文和行为指令，让 Agent 自主判断何时引入队友、何时求助、何时汇报。

## 设计原则

- **Prompt 驱动**：协作行为由 prompt 指令引导，不增加新的代码逻辑分支
- **按需详情**：Prompt 注入摘要，Agent 通过 read-file 按需获取群组 workspace 文件详情
- **最小侵入**：复用现有机制（WakeSystem @mention 路由、TODO 系统、群组 workspace 文件），不引入新的复杂子系统

## 模块 13：Agent 协作意识

### 目标

Agent 加入群组后，自动感知队友是谁、群组在做什么、自己该扮演什么角色。

### 机制：协作上下文注入

在 `prompt-builder.ts` 的 `buildSystemPromptFromFiles()` 中新增群组协作上下文块。当 Agent 在群组会话中被唤醒时，system prompt 末尾追加：

```
# 群组协作上下文

## 你的队友
- 张三 (agent-zhangsan) — 前端开发 | 擅长 React/CSS/UI 细节
- 李四 (agent-lisi) — 后端开发 | 擅长 Node.js/数据库/API 设计
- 王五 (agent-wangwu) — 测试工程师 | 擅长自动化测试/边界用例

## 当前任务
实现用户登录功能（TASK.md 摘要）

## 当前计划
- 前端：登录表单 + 验证逻辑 → 张三
- 后端：认证 API + JWT → 李四
- 测试：登录流程测试 → 王五

## 当前进度
- 张三：表单 UI 完成 80%
- 李四：API 接口已完成
- 王五：待开始

## 待办事项
- [pending] 实现登录 API (→ 待分配)
- [pending] 编写登录测试 (→ 待分配)
- [in-progress] 登录表单 UI (→ 张三)

## 群组经验（摘要）
- 关键决策：使用 JWT 而非 session（理由：无状态，易扩展）
- 协作教训：前端先 mock API 可以并行开发

## 协作行为指引
- 讨论涉及你的 JOB 领域时，主动提供专业意见
- 任务超出你的 JOB 范围时，@mention 擅长该领域的队友求助
- 完成阶段性工作后，向群组汇报进度
- 遇到阻塞时，主动告知群组并说明原因
- 与队友观点分歧 2 轮仍无共识时，@mention 群主请求仲裁
- 群主做出决策后，执行决策，不要继续争论
```

### 数据来源

| 信息 | 来源 | 提取方式 |
|------|------|---------|
| 队友姓名 | CHARACTER.md | 解析 `- Name: xxx` 行 |
| 队友角色 | JOB.md | 解析 `## 专注领域` 段落 |
| 当前任务 | TASK.md | 读取文件内容，截取前 500 字 |
| 当前计划 | PLAN.md | 读取文件内容，截取前 500 字 |
| 当前进度 | PROGRESS.md | 读取文件内容，截取最近更新 |
| 待办事项 | TODO 系统 | 查询群组 pending/in-progress TODO |
| 群组经验 | EXPERIENCE.md | 读取群组 workspace 中的文件 |
| 协作行为 | 硬编码 | prompt-builder 中拼接 |

### 关键实现

#### 协作上下文注入调用链

```
WakeSystem.executeWake(entry)
  ├── 1. 构建协作上下文字符串
  │     buildGroupCollaborationContext(groupId, agentId, group, registry)
  │     → 读取成员画像、TASK/PLAN/PROGRESS、TODO、EXPERIENCE
  │     → 返回格式化的协作上下文文本
  │
  ├── 2. 设置 Agent 的 groupContext 属性
  │     agent.setGroupContext(collaborationContext)
  │     → Agent 内部暂存这个字符串
  │
  ├── 3. 调用 agent.run(context)
  │     → ConversationLoop.run() 调用 promptBuilder()
  │     → promptBuilder 闭包读取 agent.groupContext
  │     → buildSystemPromptFromFiles(files, config, undefined, groupContext)
  │     → 在 system prompt 末尾追加协作上下文
  │
  └── 4. Agent 回复后清理
        agent.clearGroupContext()
```

#### 文件改动

- `agent.ts`：新增 `private _groupContext?: string`，`setGroupContext(ctx)` / `clearGroupContext()` 方法
- `prompt-builder.ts`：`buildSystemPromptFromFiles()` 增加可选 `groupContext?: string` 参数，拼接到末尾
- `wake-system.ts`：`executeWake()` 中在调用 `agent.run()` 前设置 groupContext，回复后清理
- `group.ts`：新增 `getMemberProfiles()` 方法，收集所有成员的姓名+角色+JOB 摘要
  - 遍历 `config.members`，用 `AgentPaths.forAgent(id)` 找到每个成员的目录
  - 读取 CHARACTER.md 提取 `- Name: xxx`
  - 读取 JOB.md 提取 `## 专注领域` 下的第一段
  - 返回 `Array<{ id, name, role }>` 格式的摘要
- `workspace.ts`：新增 `readExperience()` / `writeExperience()` / `readExperienceSummary()` 方法
  - `initialize()` 中创建 `EXPERIENCE.md` 初始文件
  - `readExperienceSummary()` 返回最近 3-5 条经验条目

## 模块 14：协作接力行为

### 目标

Agent 被 @mention 激活后，在回复中 @mention 合适的人来引入协作。

### 核心机制

Agent 不主动读历史决定发言——它们只被 @mention 激活。激活后，Agent 根据当前话题和自身 JOB，在回复中 @mention 其他 Agent。WakeSystem 检测到 @mention 后自动唤醒目标 Agent。

### AGENTS.md 模板新增「协作接力」章节

```markdown
## 协作接力

你被 @mention 激活后，在回复中判断是否需要引入其他队友。

### 何时 @mention 其他队友
- 讨论涉及另一个队友的 JOB 领域 → @mention 他们，请他们补充专业意见
- 你完成了一部分工作，下一步需要另一个队友接力 → @mention 他们并说明你做了什么
- 你遇到了超出自己 JOB 范围的问题 → @mention 擅长该领域的队友求助
- 你需要确认某个技术决策 → @mention 相关队友征求意见

### 何时直接回复（不 @mention）
- 问题完全在你的 JOB 范围内，你能独立回答
- 只是信息确认或简单回复
- 别人已经回答了

### 如何 @mention
- 在消息中写 @agent-id 即可，WakeSystem 会自动唤醒他们
- @all 提及所有人（谨慎使用）
- 说明你为什么 @mention 他们，给他们上下文

### 协作边界
- 不要对每条消息都回复，只在你能提供真正价值时才发言
- 与队友观点分歧 2 轮仍无共识 → @mention 群主请求仲裁
- 群主做出决策后，执行决策，不要继续争论
```

### 协作流程示例

```
[用户]: @张三 帮我做登录页面

[张三]: 好的，我来做登录表单。后端认证 API 需要 @李四 来做，
       我先搭前端骨架，API ready 后对接。
       @李四 认证接口用 JWT 还是 session？

[李四]: 用 JWT 吧，我来做。@王五 登录流程的测试用例你来写？

[王五]: 收到，我先写测试骨架，等你们 ready 了跑。
```

### 数据流

Agent 回复 → 写入 GroupContextV2 → WakeSystem 扫描 @mention → 唤醒目标 Agent → 循环

## 模块 15：任务分解与分派

### 目标

群主将大任务拆解为子任务，通过 TODO 系统分配和追踪。

### 已有基础

- `host-decompose-task` 工具：群主拆解任务创建 TODO
- `host-manage-todo` 工具：list/assign/complete/remove 操作
- TODO 系统支持 `targetAgentId` 字段：可指定负责人

### 增强点

#### 1. TODO 完成时自动 @mention 下一个 Agent

- `host-decompose-task` 增加 `nextAgent` 参数：子任务完成后要通知谁
- TODO 被标记 completed 时，自动向群组 main 频道发消息 `@{nextAgent} {taskTitle} 已完成，请开始你的部分`
- 实现：`todo/tools.ts` 中 `makeTodoCompleteTool` 增加完成后自动发群组消息的逻辑

#### 2. 协作上下文中注入 TODO 列表

- prompt-builder 的协作上下文中注入群组 pending/in-progress TODO
- Agent 看到与自己 JOB 匹配的 TODO 时，可 @mention 群主表示认领

#### 3. Agent 自动认领任务（prompt 驱动）

协作上下文注入中新增：
```
## 待办事项
- [pending] 实现登录 API (→ 待分配)
- [pending] 编写登录测试 (→ 待分配)
- [in-progress] 登录表单 UI (→ 张三)
```

AGENTS.md 新增：
```markdown
### 认领任务
- 看到与你 JOB 匹配的待分配 TODO → @mention 群主表示认领
- 群主确认后会通过 TODO 系统分配给你
```

### 关键实现

- `todo/tools.ts`：`makeTodoCompleteTool` 增加群组消息通知
- `host-tools.ts`：`makeHostDecomposeTaskTool` 增加 `nextAgent` 字段
- `prompt-builder.ts`：协作上下文注入 TODO 列表

## 模块 16：冲突解决与共识机制

### 目标

Agent 之间观点分歧时，通过仲裁机制解决。

### 设计

#### 1. Agent 自我感知冲突（prompt 指令）

协作行为指引中已包含：
```
- 与队友观点分歧 2 轮仍无共识时，@mention 群主请求仲裁
- 群主做出决策后，执行决策，不要继续争论
```

#### 2. Screener 冲突检测增强

当前 Screener prompt 已有「成员间冲突升级（互相否定 3+ 轮）」检测。
增强：在唤醒群主时附带结构化冲突摘要：
- 谁和谁分歧
- 各方观点摘要
- 分歧焦点

#### 3. 仲裁流程

1. Agent 分歧 → @mention 群主（或 Screener 检测到冲突唤醒群主）
2. 群主阅读冲突上下文
3. 群主做出决策，@mention 相关 Agent 传达决定
4. 决策记录到群组 workspace（通过 `host-record-decision` 工具）
5. 相关 Agent 执行决策

#### 4. 不做的事

- 不做投票系统
- 不做自动妥协/合并方案
- 不做复杂的共识算法

## 模块 17：知识共享与经验传递

### 目标

群组协作中的关键决策和教训沉淀为群组级经验。

### 群组级 EXPERIENCE.md

- 位置：`data/groups/{groupId}/EXPERIENCE.md`
- 初始内容：

```markdown
# 群组协作经验

## 关键决策
_记录协作中的重要决策和理由_

- （暂无）

## 协作教训
_记录协作中发现的问题和改进_

- （暂无）

## 有效模式
_记录哪些协作方式效果好_

- （暂无）
```

### 写入时机

- 协作中做出重要决策时 → Agent 用 write-file 写入群组 EXPERIENCE.md
- 协作结束（任务完成）时 → Agent 总结协作模式和教训
- 群主可通过 `host-record-decision` 工具记录决策

### 注入方式

- 协作上下文中注入群组 EXPERIENCE.md 的摘要（最近 3-5 条）
- Agent 可通过 read-file 读取完整内容

### 与个人 EXPERIENCE.md 的关系

- 个人 EXPERIENCE.md：Agent 在任何会话中积累的领域经验和协作经验
- 群组 EXPERIENCE.md：本群组协作过程中的共享经验
- 两者独立，个人经验不自动同步到群组（避免隐私泄露）

## 涉及文件

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `packages/core/src/conversation/prompt-builder.ts` | 修改 | 新增 `buildGroupCollaborationContext()`，在 system prompt 末尾追加协作上下文 |
| `packages/core/src/group/wake-system.ts` | 修改 | `executeWake()` 中注入协作上下文到 promptBuilder 回调 |
| `packages/core/src/group/workspace.ts` | 修改 | 新增 `readExperience()` / `writeExperience()` / `readExperienceSummary()` |
| `packages/core/src/group/group.ts` | 修改 | `addMember()` 时收集成员画像，提供 `getMemberProfiles()` |
| `packages/core/src/tools/host-tools.ts` | 修改 | `makeHostDecomposeTaskTool` 增加 `nextAgent` 字段 |
| `packages/core/src/todo/tools.ts` | 修改 | `makeTodoCompleteTool` 增加完成后群组消息通知 |
| `packages/core/src/group/screener.ts` | 修改 | 冲突检测时附带结构化摘要 |
| `config/templates/AGENTS.md` | 修改 | 新增「协作接力」和「认领任务」章节 |
| `config/templates/EXPERIENCE.md` | 不变 | 个人经验模板保持不变 |
| 新增 `data/groups/{id}/EXPERIENCE.md` | 新增 | 群组级经验文件（由 GroupWorkspace.initialize 创建） |

## 实现优先级

1. **Phase 1: 协作上下文注入**（模块 13 核心）
   - prompt-builder 新增 `buildGroupCollaborationContext()`
   - wake-system 注入协作上下文
   - group.ts 新增成员画像收集

2. **Phase 2: 协作接力行为**（模块 14）
   - AGENTS.md 模板新增协作接力章节
   - 纯 prompt 改动，无代码逻辑变更

3. **Phase 3: 任务分派增强**（模块 15）
   - TODO 完成时自动 @mention
   - 协作上下文注入 TODO 列表

4. **Phase 4: 冲突解决**（模块 16）
   - Screener 冲突摘要增强
   - AGENTS.md 增加仲裁行为指引

5. **Phase 5: 知识共享**（模块 17）
   - GroupWorkspace 新增 EXPERIENCE.md
   - 协作上下文注入群组经验摘要
