# 接口声明 — task-butler-receipt-backend
> 本声明是我的接口承诺。「myworkflow:integration-verify」将据此验证我的产出。
> 声明时间: 2026-08-04T00:30:00+08:00

## 我将创建/修改的文件
- [x] packages/shared/src/butler-bridge.ts — 追加 ButlerTaskReceiptPayload 接口（广播事件 payload 类型）
- [x] packages/core/src/butler/dispatch.ts — broadcast() 升级为完整 payload；新增导出 buildButlerTaskReceiptPayload / resolveAssigneeName
- [x] packages/core/src/agent/butler/tools/dispatch-tools.ts — formatDispatchReceipt 返回结构化回执（文本不变）；派发/取消/回复工具广播完整 payload
- [x] packages/core/src/tools/agent-task.ts — syncTrackedTask 广播携带 status/title 等完整视图
- [x] packages/core/src/api/handlers/agent.ts — dispatch_task 支持 targetType:"agent"|"group" + groupId（向后兼容）
- [x] packages/core/src/butler/dispatch.test.ts — 新增测试（广播 payload 结构 / group 路径 / 向后兼容 / 降级）

## 我将暴露的接口
| 名称 | 签名 | 所在文件 |
|------|------|----------|
| ButlerTaskReceiptPayload | `export interface ButlerTaskReceiptPayload { butlerTaskId: string; globalTodoId?: string; title: string; targetType: "agent" \| "group"; targetId: string; assigneeName: string; status: string; summary?: string; nextAction?: string; timestamp: number }` | packages/shared/src/butler-bridge.ts |
| buildButlerTaskReceiptPayload | `export function buildButlerTaskReceiptPayload(deps: ButlerDispatchDeps, butlerTaskId?: string): ButlerTaskReceiptPayload \| { timestamp: number }` | packages/core/src/butler/dispatch.ts |
| formatDispatchReceipt | `export function formatDispatchReceipt(receipt: ButlerDispatchReceipt, deps: ButlerDispatchDeps): { text: string; receipt: ButlerTaskReceiptPayload }` | packages/core/src/agent/butler/tools/dispatch-tools.ts |

> 合约签名变更说明：合约只规定了 ButlerTaskReceiptPayload 的签名；formatDispatchReceipt 从返回 string 改为返回结构化对象 `{ text, receipt }`（合约要求「内容不变 + 附加结构化视图」），两个调用点（makeDispatchToAgentTool / makeDispatchToGroupTool，同文件内）同步改为使用 `formatted.text`。`broadcast` 保持模块私有，仅调整内部调用（`broadcast(deps, butlerTask.id)`），对外签名不变。

## 我需要的外部输入
| 文件 | 内容（节/函数/类型） | 用途 |
|------|---------------------|------|
| packages/core/src/butler/dispatch.ts | ButlerDispatchDeps / dispatchButlerTask / broadcast 广播点 | 广播升级点；butlerTask.id 传入 |
| packages/core/src/agent/butler/tools/dispatch-tools.ts | formatDispatchReceipt / makeDispatchToAgentTool / makeDispatchToGroupTool / makeCancelWorkTool / makeReplyToGroupTool / getButlerDispatchDeps | 回执结构化 + 派发后广播（wsServer 从 deps 取，可用性由 getButlerDispatchDeps 保证，缺省时可选链跳过） |
| packages/core/src/tools/agent-task.ts | syncTrackedTask 状态同步广播（line 109） | 广播携带 status/title（task.title、globalTodo、butlerTaskStore、butlerStatusForAgent 可得） |
| packages/shared/src/butler-bridge.ts | 类型区 | 追加 TaskReceipt payload 类型 |
| packages/core/src/api/handlers/agent.ts | dispatch_task（495-546） | 扩展 targetType/groupId；groupManager.get 校验；响应增加 targetType/targetId |
| packages/core/src/group/manager.ts | get() / getGroupTodoStore() | assigneeName 取 group.config.name；group 路径测试桩 |
| packages/core/src/agent/registry.ts | get() | assigneeName 取 agent.name |
| packages/shared/src/types.ts | GroupConfig.name / GlobalTodoItem | 类型字段确认 |

## 风险和假设
- 假设 1：`Agent.name` 与 `Group.config.name` 为目标展示名来源；取不到时降级为 targetId。
- 假设 2：broadcast() 取不到 store 视图时降级仅 `{ timestamp }`，向后兼容（契约明确要求）。
- 风险 1：dispatchButlerTask 内部 broadcast 与工具层广播会各发一次 butler_task_updated（契约第 2、3 点均要求完整 payload 广播）；前端按 butlerTaskId upsert，重复事件幂等无害。
- 风险 2：makeCancelWorkTool / makeReplyToGroupTool 的但ler_task_updated 广播原为 `{butlerTaskId, globalTodoId, timestamp}`，本次一并升级为完整 payload，保证所有广播点符合前端事件契约（任务契约 note 2：至少含 butlerTaskId/globalTodoId/title/status）。此改动在合约列出的文件内。
- 假设 3：dispatch_task 的 group 校验用 `groupManager?.get(groupId)` + `isSafeId`；旧 payload（仅 agentId）默认 targetType="agent" 继续工作。
