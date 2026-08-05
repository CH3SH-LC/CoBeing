# 自检报告 — task-butler-receipt-backend
> 自检时间: 2026-08-04T00:35:00+08:00

## 文件存在性
- [x] packages/shared/src/butler-bridge.ts — 存在且非空（追加 ButlerTaskReceiptPayload，L94-105）
- [x] packages/core/src/butler/dispatch.ts — 存在且非空（broadcast 升级 + buildButlerTaskReceiptPayload/resolveAssigneeName）
- [x] packages/core/src/agent/butler/tools/dispatch-tools.ts — 存在且非空（formatDispatchReceipt 结构化 + 派发/取消/回复广播完整 payload）
- [x] packages/core/src/tools/agent-task.ts — 存在且非空（syncTrackedTask 广播携带 status/title）
- [x] packages/core/src/api/handlers/agent.ts — 存在且非空（dispatch_task 扩展 targetType/groupId）
- [x] packages/core/src/butler/dispatch.test.ts — 存在且非空（10 个测试）

## 接口签名匹配（与 interface-declaration.md 对比）
- [x] ButlerTaskReceiptPayload: `export interface ButlerTaskReceiptPayload { butlerTaskId: string; globalTodoId?: string; title: string; targetType: "agent" | "group"; targetId: string; assigneeName: string; status: string; summary?: string; nextAction?: string; timestamp: number }` — 与合约逐字段一致（含顺序与可选性）
- [x] buildButlerTaskReceiptPayload: `export function buildButlerTaskReceiptPayload(deps: ButlerDispatchDeps, butlerTaskId?: string): ButlerTaskReceiptPayload | { timestamp: number }` — 实际签名一致（L66）
- [x] formatDispatchReceipt: `export function formatDispatchReceipt(receipt: ButlerDispatchReceipt, deps: ButlerDispatchDeps): { text: string; receipt: ButlerTaskReceiptPayload }` — 实际签名一致（L48）
- [x] resolveAssigneeName: `export function resolveAssigneeName(deps: ButlerDispatchDeps, targetType: "agent" | "group", targetId: string): string` — 实际签名一致（L45）

## 功能完整性
- [x] broadcast() 读 butlerTaskStore 最新视图组完整 payload（含 assigneeName：agent 取 agent.name、group 取 group.config.name），取不到视图降级仅 {timestamp}；广播点传入 butlerTask.id（dispatchButlerTask L237）
- [x] formatDispatchReceipt 保留原文本内容不变，附加结构化 receipt 视图；makeDispatchToAgentTool / makeDispatchToGroupTool 派发成功后经 deps.wsServer.broadcast 发完整 payload（wsServer 缺省时可选链跳过）
- [x] makeCancelWorkTool / makeReplyToGroupTool 的 butler_task_updated 广播升级为完整 payload（有 butlerTaskId 时）
- [x] syncTrackedTask 广播携带 status/title（butlerTaskStore.get 取最新视图；status 用 butlerStatusForAgent；title 取 butlerTask.title ?? globalTodo.title ?? task.title）
- [x] dispatch_task 支持 targetType "agent"|"group"（默认 agent）+ groupId；group 目标校验 groupManager.get(groupId) 且走 dispatchButlerTask targetType:"group"；响应 dispatch_task_result 含 targetType/targetId/groupId；旧 payload（仅 agentId）兼容
- [x] 测试覆盖：广播 payload 含 butlerTaskId/status（agent+group 路径）、assigneeName 降级、store 视图缺失降级 timestamp-only、handler group 路径、旧 payload 向后兼容、group 不存在校验、agentId 缺失校验

## 接口自洽
- [x] 所有导出的函数/类型在同一个模块内有定义（tsc --noEmit 通过，全仓无类型错误）
- [x] 没有引用不存在的模块/文件 → import 验证：dispatch.ts 从 @cobeing/shared 导入 ButlerTaskReceiptPayload（shared/index.ts re-export butler-bridge ✓）；dispatch-tools.ts 从 ../../../butler/dispatch.js 导入 buildButlerTaskReceiptPayload（同仓相对路径 ✓）；agent-task.ts 从 @cobeing/shared 导入 ✓；测试文件 import 路径均存在
- [x] 没有孤立的导出 → buildButlerTaskReceiptPayload 被 dispatch-tools.ts 3 处 + dispatch.ts 内部 + 测试引用；formatDispatchReceipt 被两个派发工具引用；resolveAssigneeName 被 buildButlerTaskReceiptPayload 内部引用
- [x] 未修改合约外文件：git 确认本次变更仅触碰合约列出的 5 个文件 + 新增 dispatch.test.ts（ws-server.ts/runtime.ts/前端未动；工作树中其它 M 文件为会话前已存在的状态）

## 错误处理
- [x] broadcast 全程 try/catch，UI 广播失败不影响派发持久化
- [x] buildButlerTaskReceiptPayload：butlerTaskId 缺失 / store.get 返回 undefined / get 抛异常 → 均降级 { timestamp }
- [x] 工具层 broadcastDispatchReceipt try/catch，广播失败不阻塞工具返回
- [x] dispatch_task：groupId/agentId 缺失、isSafeId 非法、Agent/Group 不存在、runtime stores 未挂载均返回 error；dispatchButlerTask 异常返回 dispatch_task_result ok:false
- [x] resolveAssigneeName 取名字段时 try/catch，异常降级 targetId

## 验证命令结果
- [x] `cd packages/core && pnpm exec tsc --noEmit` — 通过（无输出）
- [x] `pnpm exec vitest run packages/core/src/butler packages/core/src/tools/agent-task.test.ts` — 4 文件 39 测试全部通过（含新增 dispatch.test.ts 10 个）
- [x] `pnpm build` — 7 个 workspace 包全部构建成功
- [x] 额外：`vitest run packages/core/src/api/ws-server.test.ts` — 3 测试通过（确认 handler 改动无回归）
