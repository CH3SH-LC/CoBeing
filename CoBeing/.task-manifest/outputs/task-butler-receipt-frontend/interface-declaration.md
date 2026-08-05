# 接口声明 — task-butler-receipt-frontend
> 本声明是我的接口承诺。「myworkflow:integration-verify」将据此验证我的产出。
> 声明时间: 2026-08-04T03:00:00+08:00

## 我将创建/修改的文件
- [x] gui-v2/src/hooks/ws-handlers/butler-task-handlers.ts — 新建:buildButlerTaskHandlers(butler_task_updated → butlerTasks store upsert + emitActivity + 派发 ws-butler-task-receipt 事件;dispatch_task_result → 本地系统消息「已派发给 X」/「派发失败」)
- [x] gui-v2/src/hooks/useWebSocket.ts — 并入 buildButlerTaskHandlers 到主 handler 表
- [x] gui-v2/src/stores/butlerTasks.ts — 复活:新增 upsertTask(按 id 合并/追加),提取 computeSummary 公共计算
- [x] gui-v2/src/components/todo/GlobalTodoPanel.tsx — 顶部「管家任务」小计区(运行中/等待你/已完成,读 butlerTasks store;空数据不渲染)
- [x] gui-v2/src/components/chat/ChatInputActions.tsx — 「派发」菜单从插文本升级为结构化 dispatch_task(agent→{agentId,targetType:"agent"},group→{groupId,targetType:"group"},title=输入首行或「任务」,goal=输入文本)
- [x] gui-v2/src/components/chat/ChatView.tsx — 监听 ws-butler-task-receipt → chat store 追加 direction:"out" 消息(metadata.taskReceipt),按 butlerTaskId 去重

## 我将暴露的接口
| 名称 | 签名 | 所在文件 |
|------|------|----------|
| buildButlerTaskHandlers | `export function buildButlerTaskHandlers(ctx: WsHandlerContext): Record<string, WsMessageHandler>` | gui-v2/src/hooks/ws-handlers/butler-task-handlers.ts |
| ButlerTaskReceiptPayload | `export interface ButlerTaskReceiptPayload { butlerTaskId: string; globalTodoId?: string; title: string; targetType: "agent" \| "group"; targetId: string; assigneeName: string; status: string; summary?: string; nextAction?: string; timestamp: number }` | 同上(供 ChatView 消费事件 detail) |
| upsertTask | `upsertTask: (task: Partial<ButlerTaskSummary> & Pick<ButlerTaskSummary, "id">) => void` | gui-v2/src/stores/butlerTasks.ts(useButlerTasksStore 新增 action) |

## 我需要的外部输入(只读)
| 文件 | 内容(节/函数/类型) | 用途 |
|------|---------------------|------|
| gui-v2/src/lib/types.ts | ButlerTaskSummary / TaskReceipt / LogMessage | 事件映射到 store 与回执卡片的类型(不修改) |
| gui-v2/src/hooks/ws-handlers/types.ts | WsHandlerContext / WsMessageHandler | handler 签名 |
| gui-v2/src/hooks/ws-handlers/helpers.ts | emitActivity | 活动日志 |
| gui-v2/src/stores/chat.ts | addMessage | 追加本地系统消息与回执消息 |
| gui-v2/src/stores/agents.ts / groups.ts | agents / groups | dispatch_task_result 目标名解析 |
| gui-v2/src/hooks/useWebSocket.ts | getWsClient | ChatInputActions 发送 dispatch_task |
| gui-v2/src/lib/coreAgents.ts | getVisibleUserAgents | 派发菜单 Agent 列表(既有用法不变) |
| gui-v2/src/components/chat/MessageBubble.tsx | taskReceipt 渲染条件(已存在) | 确认 direction:"out" + metadata.taskReceipt 即可点亮 TaskReceiptCard,无需修改 |

## 风险和假设
1. **ChatInput.tsx 不在可修改清单** — ChatInputActions 通过 DOM 向上查找同容器 textarea 读取当前输入文本(dispatchRef → 祖级容器 querySelector("textarea"),已验证 ChatInput 结构:actions 行与 textarea 同处输入容器)。若 ChatInput 结构变动该方案失效。
2. **dispatch_task_result 契约** — 前端合约保证 {ok, agentId, globalTodoId, butlerTaskId, executionRef};后端并行实现将追加 targetType/groupId。解析目标名做防御:有 groupId 无 agentId → 群组名(groups store);否则 agent 名(agents store);找不到用 id 兜底。
3. **status 取值超集** — butler_task_updated 的 status 是 string,可能含 ButlerTaskSummary/TaskReceipt 联合类型之外的 "pending"/"failed":store 边界 cast;TaskReceiptCard 对未知 status 会崩(statusConfig 查找),故 ChatView 构建 receipt 时将未知 status 归一为 "running"。
4. **回执去重即"首条保留"** — 合约规定同 butlerTaskId 不重复追加;chat store 无 update-message action 且不在可修改范围,故后续状态更新不刷新已渲染卡片,卡片保持首条事件时的状态。
5. **回执归属会话** — 事件只在 ChatView 的 convId === "butler"(管家会话,显示全部回执)或 convId === payload.targetId(目标会话)时追加;群组会话(GroupChatView)不在本任务范围,不渲染回执。
6. **「已派发给 X」由 WS 层插入** — 合约要求 ChatInputActions 发送成功后插入本地系统消息;实现上由 butler-task-handlers.ts 的 dispatch_task_result handler 统一插入(组件只负责发出请求),行为等价且更健壮(响应到达时组件即使已卸载也能处理)。

## 不修改(合约红线)
- App.tsx / ChatHeader.tsx / ButlerConfigPanel.tsx(T5 范围)、todo-handlers.ts、lib/types.ts、chat store、ChatInput.tsx、GroupChatView.tsx、TaskReceiptCard.tsx
