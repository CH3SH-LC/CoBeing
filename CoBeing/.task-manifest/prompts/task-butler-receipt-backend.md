# 子任务:task-butler-receipt-backend(阶段 A 后端)

## 任务描述
把派发回执从「文本」升级为「结构化 + 事件」:butler_task_updated 广播携带完整视图;formatDispatchReceipt 输出结构化回执;Agent 状态同步广播携带状态;dispatch_task WS 命令支持 group 目标。

## 关键契约(读 .task-manifest/task-contract-butler.md 中你的条目)
- 输出文件清单与验证命令见合约。
- **不动 ws-server.ts / runtime.ts / 前端**(主线程集成)。

## 实现要点
1. butler-bridge.ts 追加 ButlerTaskReceiptPayload(签名见合约)。
2. dispatch.ts:broadcast() 升级——读 deps.butlerTaskStore 最新视图,组 ButlerTaskReceiptPayload{butlerTaskId, globalTodoId, title, targetType, targetId, assigneeName(目标名,从 deps.agentRegistry/groupManager 取), status:"running", summary?, nextAction?, timestamp};取不到视图时降级仅 {timestamp}(向后兼容)。注意广播点要能拿到 butlerTaskId——必要时调整 dispatchButlerTask 内部调用。
3. dispatch-tools.ts:formatDispatchReceipt 保留文本;工具 execute 在派发成功后通过 deps.wsServer.broadcast 发 butler_task_updated 带完整 payload(先读 getButlerDispatchDeps 确认 wsServer 可用性)。
4. agent-task.ts:syncTrackedTask 的广播携带 status/title(读代码确认字段可得性)。
5. agent.ts dispatch_task:payload 增加 targetType("agent"|"group",默认"agent")+ groupId;group 目标校验 groupManager.get(groupId) 且走 dispatchButlerTask targetType:"group";响应 dispatch_task_result 增加 targetType/targetId。保持旧 payload 兼容。
6. 测试:广播 payload 含 butlerTaskId/status;group 路径;向后兼容。

## 验证
- cd D:/agent-codes/CoBeing/packages/core && pnpm exec tsc --noEmit
- cd D:/agent-codes/CoBeing && pnpm exec vitest run packages/core/src/butler packages/core/src/tools/agent-task.test.ts

## 工作协议
遵循「myworkflow:subagent-protocol」,task-id=task-butler-receipt-backend。声明/自检/完成报告写 .task-manifest/outputs/task-butler-receipt-backend/。
