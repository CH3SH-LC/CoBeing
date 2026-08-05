# 完成报告 — task-butler-receipt-frontend

**状态**: DONE_WITH_CONCERNS

## 产出文件清单
- [gui-v2/src/hooks/ws-handlers/butler-task-handlers.ts](新建) — buildButlerTaskHandlers:butler_task_updated(store upsert + emitActivity + 派发 ws-butler-task-receipt 事件,detail=payload)+ dispatch_task_result(ok →「已派发给 X」,失败 →「派发失败」系统消息);导出 ButlerTaskReceiptPayload 类型
- [gui-v2/src/hooks/useWebSocket.ts](修改) — 并入 buildButlerTaskHandlers(ctx) 到主 handler 表
- [gui-v2/src/stores/butlerTasks.ts](修改) — 复活:新增 upsertTask(按 id 合并/追加 + 重算 summary),提取 computeSummary
- [gui-v2/src/components/todo/GlobalTodoPanel.tsx](修改) — 顶部「管家任务」小计区(运行中/等待你/已完成 + 总数,读 butlerTasks store;空数据不渲染)
- [gui-v2/src/components/chat/ChatInputActions.tsx](修改) — 派发菜单升级为结构化 dispatch_task(agent→{agentId,targetType:"agent"} / group→{groupId,targetType:"group"},title=输入首行或「任务」,goal=输入文本);创建/摘要按钮行为不变
- [gui-v2/src/components/chat/ChatView.tsx](修改) — 监听 ws-butler-task-receipt:convId 为 "butler"(全部回执)或 payload.targetId(目标会话)时,追加 direction:"out" + metadata.taskReceipt 消息(senderId "butler"),同 butlerTaskId 去重;未知 status 归一 running;MessageBubble 既有条件自动点亮 TaskReceiptCard

## 自检结果
- [x] 文件存在性
- [x] 接口签名匹配
- [x] 功能完整性
- [x] 接口自洽
- [x] 错误处理
- 全部通过: 是(详见 self-check.md)

## 验证结果
- `pnpm exec tsc --noEmit`(gui-v2):通过,零错误
- `pnpm build`(gui-v2):通过(7.12s,仅既有 chunk 体积警告)
- `pnpm exec vitest run gui-v2/src`:19/19 通过,GlobalTodoPanel.test.ts 2/2 未改动(纯函数测试不受影响)

## 已知担忧 (DONE_WITH_CONCERNS)
- 担忧: ChatInput.tsx 不在可修改清单,「当前输入文本」通过 DOM 向上查找同容器 textarea 读取(dispatchRef → 祖级 querySelector("textarea"),已对照 ChatInput 源码验证结构)— 影响: 若未来 ChatInput 调整布局结构(actions 行与 textarea 分属不同容器),派发 title/goal 会退化为「任务」+空 goal,需同步改为 props 传入
- 担忧: dispatch_task 后端(task-butler-receipt-backend)并行实现中,其响应契约仅保证 {ok, agentId, globalTodoId, butlerTaskId, executionRef},targetType/groupId 为后端追加字段 — 影响: 目标名解析已做防御(store 查找 + id 兜底),但「已派发给 X」在群组派发时若后端未返回 groupId/targetType 可能显示 agentId 形式;事件端(butler_task_updated)契约字段已按 prompt 实现,等待后端广播对齐
- 担忧: 回执卡片去重为「首条保留」,后续状态事件(如 running→completed)不刷新已渲染卡片(chat store 无 update 能力且不在本任务范围)— 影响: 聊天流内回执卡片保持派发时状态,状态流转只能看 GlobalTodoPanel 小计或活动日志;与合约「同 butlerTaskId 不重复追加」一致
- 担忧: 群组会话(GroupChatView)不在本任务范围,派发给群组的回执只出现在管家会话与群组的目标会话(ChatView 侧,群组聊天视图不渲染)— 影响: 用户打开群组聊天看不到回执卡片,如需群组内渲染需后续任务扩展 GroupChatView

## 交接提示(供主线程集成)
- 工作区 CLAUDE.md 要求代码变更后同步 PROGRESS.md / PROGRESS-LITE.md / docs/项目信息/;并行子任务环境下由主线程统一合并后补记
- STRUCTURE.md 无需变更:ws-handlers 按目录级记录,stores/butlerTasks.ts 已有条目
- 端到端运行验证依赖后端任务(task-butler-receipt-backend)的 dispatch_task(group 目标)与 butler_task_updated 广播落地,建议集成后跑一次真实验证:管家视图输入文本 → 派发菜单选 Agent/Group → 预期看到「已派发给 X」系统消息 + 回执卡片 + GlobalTodoPanel 管家任务小计更新
