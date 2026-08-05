# 完成报告 — task-butler-receipt-backend

**状态**: DONE

## 产出文件清单
- [packages/shared/src/butler-bridge.ts] — 追加 `ButlerTaskReceiptPayload` 接口（butler_task_updated 广播 payload 类型，与合约签名逐字段一致）
- [packages/core/src/butler/dispatch.ts] — `broadcast()` 升级：读 butlerTaskStore 最新视图组完整 payload；新增导出 `buildButlerTaskReceiptPayload(deps, butlerTaskId?)`（视图缺失/异常降级仅 `{timestamp}`）与 `resolveAssigneeName`（agent 取 agent.name、group 取 group.config.name，降级 targetId）；`dispatchButlerTask` 广播点传入 `butlerTask.id`
- [packages/core/src/agent/butler/tools/dispatch-tools.ts] — `formatDispatchReceipt` 改为返回 `{ text, receipt }`（文本内容不变 + 结构化视图）；两个派发工具派发成功后经 `deps.wsServer.broadcast` 发完整 payload；`makeCancelWorkTool`/`makeReplyToGroupTool` 的 butler_task_updated 广播同步升级为完整 payload（保证全部广播点符合前端事件契约）
- [packages/core/src/tools/agent-task.ts] — `syncTrackedTask` 广播从 `{globalTodoId, timestamp}` 升级为完整 ButlerTaskReceiptPayload（status=butlerStatusForAgent、title 从 butlerTask store 最新视图取）
- [packages/core/src/api/handlers/agent.ts] — `dispatch_task` payload 扩展 `targetType`("agent"|"group"，默认 agent)+ `groupId`；group 目标校验 `groupManager.get(groupId)` + isSafeId；响应 `dispatch_task_result` 增加 `targetType`/`targetId`/`groupId`；旧 payload（仅 agentId）向后兼容
- [packages/core/src/butler/dispatch.test.ts] — 新增 10 个测试：agent/group 派发广播完整 payload（butlerTaskId/status/assigneeName）、store 视图缺失降级 timestamp-only、assigneeName 降级 targetId、handler group 路径（result 含 targetType/targetId + 广播）、旧 payload 兼容、显式 targetType agent、group 不存在/agentId 缺失校验

## 自检结果
- [x] 文件存在性
- [x] 接口签名匹配
- [x] 功能完整性
- [x] 接口自洽
- [x] 错误处理
- 全部通过: 是

## 验证结果
- `cd packages/core && pnpm exec tsc --noEmit` — 通过
- `pnpm exec vitest run packages/core/src/butler packages/core/src/tools/agent-task.test.ts` — 4 文件 39 测试全部通过（dispatch.test.ts 新增 10 个）
- `pnpm build` — 7 个 workspace 包全部构建成功
- 额外回归：`vitest run packages/core/src/api/ws-server.test.ts` — 3 测试通过（ws-server.ts 未改动）

## 已知观察（非阻塞）
- 工具驱动派发时 butler_task_updated 会发两次（dispatchButlerTask 内部一次 + 工具层一次）——契约第 2、3 点均明确要求完整 payload 广播，属有意设计；前端按 butlerTaskId upsert，重复事件幂等无害。
- 本次变更文件严格限制在合约列出的 5 个源文件 + 新增测试；未触碰 ws-server.ts / runtime.ts / 前端。工作树中其它已修改文件（butler.ts、ws-server.ts、runtime.ts 等）为会话前已有状态，非本次产出。
- 按工作区文档规则（PROGRESS.md / PROGRESS-LITE.md / docs/项目信息 / STRUCTURE.md 同步）属于主线程集成职责，建议主智能体在集成时统一更新；本子任务不越界修改这些文档。
