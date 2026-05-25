# TODOboard 触发链路修复设计

## 目标

修复 TODOboard 功能的 3 个关键缺陷，使 Agent 能在独立和群组场景中正常触发 TODO 并完成后续动作链。

## 问题分析

### P0-1: Agent TODO 触发"发射后不管"

**现状** (`runtime.ts:350-364`)：`AgentTodoScanner` 触发时调用 `agent.run(message)`，Agent 运行结果被丢弃，前端无任何事件反馈。

**影响**：
- Agent 回复无人查看
- 前端日志看不到 TODO 触发记录
- Agent 无法区分 TODO 触发与普通用户消息

### P0-2: 群组 TODO 触发绕过 WakeSystem

**现状** (`manager.ts:48-57`)：`GroupTodoScanner` 触发时调用 `targetAgent.run(message)`，完全不经过群组上下文。

**影响**：
- Agent 不知道是哪个群组触发
- 没有三层记忆上下文（群组历史/压缩摘要）
- 回复不写回群组 main 频道
- 没有 @mention 处理、队列管理

### P0-3: `todo-complete` 群组路径丢失 onComplete 动作链

**现状**：ButlerAgent 构造函数用 `makeTodoCompleteTool(2-args)` 覆盖基类的 `makeTodoCompleteTool(3-args)`，丢失 `groupScanner.complete()` 路径，`onComplete` 动作链永不触发。

## 修复方案

### Fix 1: Agent TODO 事件广播

在 `runtime.ts` 的 `onTrigger` 回调中，包装 `agent.run()` 为：
1. 广播 `agent_started` 事件（含 source: "TODOboard"）
2. 执行 `agent.run()`
3. 广播 `agent_completed` 事件 + 回复内容
4. 日志记录 TODO 触发

### Fix 2: 群组 TODO → WakeSystem 自然唤醒

将 `manager.ts` 中 GroupTodoScanner 的 `onTrigger` 改为调用 `group.postMessage("TODOboard", "@{targetAgentId} {message}")`。这样：
- 消息写入群组上下文 → WakeSystem 被触发
- WakeSystem 解析 @mentions → 加入唤醒队列
- 执行唤醒时使用完整三层记忆上下文
- 回复自动写回群组 main 频道
- `agent_started`/`agent_completed` 通过 `onAgentEvent` 自动广播

### Fix 3: Butler todo-complete 传完整参数

将 `butler.ts` 的 `makeTodoCompleteTool` 调用改为 3 参数形式，同时传入 `groupStoreGetter` 和 `groupScannerGetter`，优先走 scanner.complete() 路径以触发 onComplete。

## 不改动的范围

- TodoItem 类型（不改结构）
- TodoStore 读写逻辑
- AgentTodoScanner/GroupTodoScanner 扫描逻辑
- 前端组件
- TODO 创建/列表/删除流程
