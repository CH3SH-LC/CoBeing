# 自检报告 — task-onboarding-persona-frontend

> 自检时间: 2026-08-04T02:40:00+08:00

## 文件存在性

- [x] `gui-v2/src/stores/onboarding.ts` — 存在且非空（127 行）
- [x] `gui-v2/src/components/onboarding/OnboardingOverlay.tsx` — 存在且非空（298 行）
- [x] `gui-v2/src/App.tsx` — 已修改（TutorialController onFinished + OnboardingController + 欢迎消息注入）
- [x] `gui-v2/src/components/chat/ChatHeader.tsx` — 已修改（formatAgentSubtitle 空态修复）
- [x] `gui-v2/src/components/agent/ButlerConfigPanel.tsx` — 已修改（ButlerPersonaSection 形象区）

## 接口签名匹配（与 interface-declaration.md 对比）

- [x] OnboardingOverlay: `export function OnboardingOverlay({ onClose }: { onClose: () => void })` — 实际签名一致（OnboardingOverlay.tsx:77）
- [x] useOnboardingStore: `export const useOnboardingStore = create<OnboardingStore>(...)` 含 `applyResult(payload)` / `submit(interests, note?)` / `reset()` — 一致（onboarding.ts:67）
- [x] isOnboardingPending: `export function isOnboardingPending(): boolean` — 一致（onboarding.ts:9），localStorage `cobeing_onboarding_done` !== "true"
- [x] markOnboardingDone: `export function markOnboardingDone(): void` — 一致（onboarding.ts:14）
- [x] ChatHeader: 签名不变，仅新增内部 helper `formatAgentSubtitle` — 一致（ChatHeader.tsx:12）
- [x] ButlerConfigPanel: `export function ButlerConfigPanel()` 签名不变，新增内部 `ButlerPersonaSection` — 一致（ButlerConfigPanel.tsx:184）

## 功能完整性

- [x] 首启检测：localStorage `cobeing_onboarding_done`，OnboardingOverlay 自身 + App 控制器双重防御
- [x] 兴趣多选 chips：生活/学习/旅行/购物/创作/家庭事务/工作杂事 7 项，多选切换，选中态 `bg-accent text-white`
- [x] 可选自定义输入 → `note` 字段（空则不携带）
- [x] 提交 → `onboarding_apply {interests, note?}`，置 loading 态，防重复提交
- [x] 结果视图：createdAgents 列表（首字母徽章 + name + role）+ Market 推荐卡片（name + tier 徽章 + description + 安装/跳过）
- [x] 安装按钮 → `setActiveView("extensions")` + `setActiveTab("market")` 跳转扩展视图 Market tab
- [x] 跳过路径：问卷头部/底部跳过 → 完成标记 + 关闭
- [x] 完成标记：markOnboardingDone 后 onClose
- [x] 欢迎消息：问卷关闭（提交或跳过）后向 butler 会话注入 `direction:"out", senderId:"butler", senderName:"管家"` 消息，含引导性问题「你想先处理什么？我可以帮你创建专属智能体」；模块级布尔 + localStorage 双守卫，仅注入一次
- [x] OnboardingController：首启且 tutorial 关闭/跳过后才显示问卷，两浮层不叠加（tutorialDone 状态驱动）
- [x] ChatHeader：provider/model 均未加载 → 「连接中…」；status 空 → 隐藏「· status」段；group 成员数 undefined 兜底 0
- [x] ButlerConfigPanel 管家形象区：称呼输入 + 欢迎语输入 + 4 模板选择（选中即发 butler_set_persona）+ 保存（butler_update_style{nickname, greeting, apply:true}），置于 AgentConfigTab 之上；挂载时发 butler_get_personas

## 接口自洽

- [x] 所有导出的函数/类型在同一个模块内有定义
- [x] 没有引用不存在的模块/文件 → `pnpm exec tsc --noEmit` 通过（exit 0），全部 import 解析成功
- [x] 没有孤立的导出 → grep 验证：OnboardingOverlay 被 App.tsx 引用；isOnboardingPending/markOnboardingDone 被 App.tsx + OnboardingOverlay 引用；useOnboardingStore 被 OnboardingOverlay 引用且 applyResult 供主线程 handler 调用（合约契约）

## 错误处理

- [x] submit 20s 超时未收到 onboarding_result → 降级 error 态 + 提示文案，浮层不会永久 loading
- [x] error 视图提供「重试」（复用上次兴趣/备注重新提交）与「跳过」两条出路
- [x] butler 系列事件未接线降级：模板列表回退 4 个已知模板；选中立即本地高亮；保存按钮 2s 复位；事件到后再补「模板已应用/已保存」确认态
- [x] 推荐卡可逐张跳过（dismissed 本地列表）
- [x] localStorage 读写均有 try/catch / window 守卫
- [x] 组件 hooks 全部在早退 return 之前无条件调用（React hooks 规则）

## 验证命令结果

- [x] `cd D:/agent-codes/CoBeing/gui-v2 && pnpm exec tsc --noEmit` — exit 0
- [x] `cd D:/agent-codes/CoBeing/gui-v2 && pnpm build` — exit 0（`tsc && vite build`，✓ built in 7.33s，仅既有 chunk size/dynamic import warning）
- [x] `cd D:/agent-codes/CoBeing && pnpm exec vitest run gui-v2/src` — 4 文件 19 测试全绿，未破坏既有测试
