# 自检报告 — task-butler-receipt-frontend
> 自检时间: 2026-08-04T03:30:00+08:00

## 文件存在性
- [x] gui-v2/src/hooks/ws-handlers/butler-task-handlers.ts — 存在且非空(新)
- [x] gui-v2/src/hooks/useWebSocket.ts — 存在,已并入 handler
- [x] gui-v2/src/stores/butlerTasks.ts — 存在,已扩展 upsertTask
- [x] gui-v2/src/components/todo/GlobalTodoPanel.tsx — 存在,已加小计区
- [x] gui-v2/src/components/chat/ChatInputActions.tsx — 存在,已结构化派发
- [x] gui-v2/src/components/chat/ChatView.tsx — 存在,已加回执监听

## 接口签名匹配(与 interface-declaration.md 对比)
- [x] buildButlerTaskHandlers: `export function buildButlerTaskHandlers(_ctx: WsHandlerContext): Record<string, WsMessageHandler>` — 实际签名一致(参数名 _ctx 仅命名差异)
- [x] ButlerTaskReceiptPayload: `export interface ButlerTaskReceiptPayload { butlerTaskId; globalTodoId?; title; targetType; targetId; assigneeName; status; summary?; nextAction?; timestamp }` — 字段与合约一致
- [x] upsertTask: `(task: Partial<ButlerTaskSummary> & Pick<ButlerTaskSummary, "id">) => void` — 实际签名一致

## 功能完整性
- [x] butler_task_updated:按 butlerTaskId upsert 到 store + emitActivity + dispatchEvent("ws-butler-task-receipt", detail: payload)
- [x] dispatch_task_result:ok → 本地系统消息「已派发给 X」+ 活动日志;失败 → 「派发失败:{reason}」
- [x] useWebSocket.ts 主表并入 buildButlerTaskHandlers(ctx)
- [x] GlobalTodoPanel 顶部「管家任务」小计区:运行中/等待你/已完成计数,空数据不渲染,不破坏既有 2 个测试
- [x] ChatInputActions 派发菜单:Agent(getVisibleUserAgents)+ Group(groups store);agent→{agentId,targetType:"agent"},group→{groupId,targetType:"group"},title=输入首行或「任务」,goal=输入文本
- [x] ChatView 回执点亮:监听 ws-butler-task-receipt,convId 为 "butler" 或 payload.targetId 时追加 direction:"out" + metadata.taskReceipt 消息,同 butlerTaskId 去重;MessageBubble 既有 taskReceipt 渲染条件直接点亮 TaskReceiptCard(未改 MessageBubble)
- [x] 类型本地化:handler 模块内 interface(与 market-handlers.ts 风格一致),lib/types.ts 未改

## 接口自洽
- [x] 所有导出的函数/类型在同一个模块内有定义
- [x] 没有引用不存在的模块/文件 → `pnpm exec tsc --noEmit` 零错误
- [x] 没有孤立的导出 → grep 验证:buildButlerTaskHandlers 被 useWebSocket.ts 引用;upsertTask 被 handler 引用;ButlerTaskReceiptPayload 被 handler/ChatView 引用
- [x] 事件流闭环:handler dispatchEvent → ChatView addEventListener,事件名唯一("ws-butler-task-receipt"),grep 无其他同名定义

## 错误处理
- [x] 事件 payload 缺 butlerTaskId → 直接 return,不写 store/不发事件
- [x] TaskReceipt 未知 status(pending/failed 等)→ 归一为 "running",避免 TaskReceiptCard statusConfig 崩溃
- [x] dispatch_task_result.ok=false → 错误系统消息 + error 活动日志
- [x] 目标名解析防御:targetType=group 或(有 groupId 无 agentId)→ 群组名;否则 agent 名;store 找不到 → 用 id 兜底,再兜底「Agent/群组」
- [x] 回执去重:同 butlerTaskId 同会话已有回执消息则不重复追加(合约要求)
- [x] ChatView 监听带 cleanup(removeEventListener),React 重挂载/视图切换安全

## 验证命令结果
- [x] `cd D:/agent-codes/CoBeing/gui-v2 && pnpm exec tsc --noEmit` — 通过,零错误
- [x] `cd D:/agent-codes/CoBeing/gui-v2 && pnpm build` — 通过(built in 7.12s,仅既有 chunk 体积警告)
- [x] `cd D:/agent-codes/CoBeing && pnpm exec vitest run gui-v2/src` — 19/19 通过(含 GlobalTodoPanel.test 2/2,未改动测试)
