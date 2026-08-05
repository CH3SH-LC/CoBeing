# 子任务:task-butler-receipt-frontend(阶段 A 前端)

## 任务描述
点亮任务回执:butler_task_updated 事件 handler;复活 stores/butlerTasks.ts(零消费者→GlobalTodoPanel 显示管家任务小计);ChatInputActions 派发菜单从插文本升级为结构化 dispatch_task;任务回执卡片真实渲染(聊天流内)。

## 关键契约(读 .task-manifest/task-contract-butler.md 中你的条目)
- 事件契约:butler_task_updated payload {butlerTaskId, globalTodoId?, title, targetType, targetId, assigneeName, status, summary?, nextAction?, timestamp}
- 请求契约:dispatch_task{agentId|groupId, targetType?("agent"|"group",默认 agent), title, goal, acceptance?, constraints?} → dispatch_task_result{ok, agentId, globalTodoId, butlerTaskId, executionRef}
- **允许修改 useWebSocket.ts**(把 buildButlerTaskHandlers 并入主表);不得修改 App.tsx/ChatHeader.tsx/ButlerConfigPanel.tsx(T5 范围)。

## 实现要点
1. butler-task-handlers.ts:buildButlerTaskHandlers(ctx) → butler_task_updated:upsert 到 useButlerTasksStore(按 butlerTaskId;store 现有字段不足以承载时扩展 setTasks 或新增 setUpsert——butlerTasks.ts 在你的改动范围)+ emitActivity + dispatchEvent("ws-butler-task-receipt", detail: payload)。
2. GlobalTodoPanel.tsx:顶部「管家任务」小计区(运行中/等待你计数,读 butlerTasks store;空数据显示「暂无托管任务」或不渲染该区)。注意保持既有 GlobalTodoPanel.test.ts 通过(2 tests),若展示模型变化同步更新测试。
3. ChatInputActions.tsx:「派发」菜单选择 Agent/Group 后发 dispatch_task(agent→{agentId,targetType:"agent"},group→{groupId,targetType:"group"},title=当前输入文本首行或「任务」,goal=当前输入文本);发送成功(dispatch_task_result.ok)→ 插入本地系统消息「已派发给 X」;失败 → 错误消息。派发菜单数据:Agent 列表(getVisibleUserAgents)+ Group 列表(groups store)。
4. ChatView.tsx:监听 ws-butler-task-receipt 事件 → 向 chat store 追加一条方向 out 的 system 消息(metadata.taskReceipt = 结构化 receipt:title/assigneeType/assigneeName/status/summary/nextAction)→ TaskReceiptCard 自动渲染。消息去重(同 butlerTaskId 已有回执消息则不重复追加)。
5. 类型:handler 本地 interface 即可(与 market-handlers.ts 风格一致);不要求改 lib/types.ts(主线程集成合并)。

## 验证
- cd D:/agent-codes/CoBeing/gui-v2 && pnpm exec tsc --noEmit
- cd D:/agent-codes/CoBeing/gui-v2 && pnpm build
- cd D:/agent-codes/CoBeing && pnpm exec vitest run gui-v2/src(不得破坏既有 19 测试,GlobalTodoPanel.test 若有变化同步更新)

## 工作协议
遵循「myworkflow:subagent-protocol」,task-id=task-butler-receipt-frontend。声明/自检/完成报告写 .task-manifest/outputs/task-butler-receipt-frontend/。
