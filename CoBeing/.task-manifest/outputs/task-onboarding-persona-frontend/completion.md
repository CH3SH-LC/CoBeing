# 完成报告 — task-onboarding-persona-frontend

**状态**: DONE_WITH_CONCERNS

## 产出文件清单

| 文件 | 类型 | 内容摘要 |
|------|------|----------|
| `gui-v2/src/stores/onboarding.ts` | 新增 | `useOnboardingStore`（status: idle/loading/done/already_done/error、createdAgents、recommendations、message）+ `submit(interests, note?)`（发 onboarding_apply + loading + 20s 超时降级 error）+ `applyResult(payload)`（主线程 onboarding_result handler 调用）+ `reset()`；`isOnboardingPending()` / `markOnboardingDone()`（localStorage `cobeing_onboarding_done`） |
| `gui-v2/src/components/onboarding/OnboardingOverlay.tsx` | 新增 | `OnboardingOverlay({ onClose })`：磨砂浮层（blur 18px saturate 1.35 + overlay 72% + bg-surface + shadow-surface-lg，同 TutorialOverlay 风格）。问卷视图：7 项兴趣 chips 多选 + 可选自定义输入 + 「开始使用」/「跳过」；loading 态；结果视图：createdAgents 列表 + Market 推荐卡（tier 徽章四色规范 + 描述 + 安装跳转 extensions Market tab / 逐卡跳过）+ 「完成」；error 视图：文案 + 重试/跳过。全部主题 token，无硬编码色值 |
| `gui-v2/src/App.tsx` | 修改 | TutorialController 增加 `onFinished` 回调；新增 `OnboardingController({ enabled })`（tutorial 关闭/跳过 → tutorialDone=true → 立即显示问卷，两浮层不叠加）；`injectButlerWelcomeMessage()`：问卷关闭后向 butler 会话注入欢迎消息（direction:"out"、senderId:"butler"、senderName:"管家"、含引导性问题「你想先处理什么？我可以帮你创建专属智能体」），模块级守卫仅一次 |
| `gui-v2/src/components/chat/ChatHeader.tsx` | 修改 | 副标题 `formatAgentSubtitle(provider, model, status)`：provider/model 均未加载 → 「连接中…」；status 空 → 隐藏「· status」段；group 成员数 `?? 0` 兜底。原 `undefined / undefined · undefined` 串不再出现 |
| `gui-v2/src/components/agent/ButlerConfigPanel.tsx` | 修改 | 新增「管家形象」区（AgentConfigTab 工程配置之上）：称呼输入 + 欢迎语输入 + 语气模板 4 选（选中即发 butler_set_persona，立即本地高亮）+ 保存按钮（butler_update_style{nickname, greeting, apply:true}）。挂载发 butler_get_personas；响应经 window CustomEvent（ws-butler-*）监听 |

> 注意：合约中 ButlerConfigPanel 路径写的是 `components/settings/`，该路径不存在；实际文件为 `gui-v2/src/components/agent/ButlerConfigPanel.tsx`（AppLayout.tsx:6 引用），按实际路径修改。未触碰 useWebSocket.ts / todo-handlers.ts / ChatInputActions.tsx / GlobalTodoPanel.tsx。

## 自检结果

- [x] 文件存在性
- [x] 接口签名匹配
- [x] 功能完整性
- [x] 接口自洽（tsc 全量解析通过）
- [x] 错误处理
- 全部通过: **是**（详见 self-check.md）

## 验证命令结果

1. `cd D:/agent-codes/CoBeing/gui-v2 && pnpm exec tsc --noEmit` — ✅ exit 0
2. `cd D:/agent-codes/CoBeing/gui-v2 && pnpm build` — ✅ exit 0（tsc + vite build，✓ built in 7.33s，仅既有 chunk size/dynamic import warning，与本次改动无关）
3. `cd D:/agent-codes/CoBeing && pnpm exec vitest run gui-v2/src` — ✅ 4 文件 19 测试全绿，未破坏既有测试

## 需要主线程做的事（集成契约）

| 后端消息 | 主线程接线动作 |
|---------|---------------|
| `onboarding_result` | `useOnboardingStore.getState().applyResult(payload)`（payload: {status, createdAgents?, marketRecommendations?, message?}） |
| `butler_personas` | `window.dispatchEvent(new CustomEvent("ws-butler-personas", { detail: msg }))` |
| `butler_persona_set` | `window.dispatchEvent(new CustomEvent("ws-butler-persona-set", { detail: msg }))` |
| `butler_style_updated` | `window.dispatchEvent(new CustomEvent("ws-butler-style-updated", { detail: msg }))` |

前端发送：`onboarding_apply{interests, note?}`、`butler_get_personas{}`、`butler_set_persona{persona}`、`butler_update_style{nickname?, greeting?, apply:true}`。

## 已知担忧 (DONE_WITH_CONCERNS)

- 担忧 1: butler 系列响应（butler_personas/butler_persona_set/butler_style_updated）依赖主线程在 useWebSocket 中接线为 ws-butler-* CustomEvent。未接线时管家形象区有完整降级（回退 4 模板 + 本地高亮 + 2s 按钮复位），但「模板已应用/已保存」确认态与后端实际写入的当前模板不会显示。— 影响: 后端联动体验（主线程接线后自动恢复，无需改前端）。
- 担忧 2: 问卷「安装」按钮只做跳转（extensions Market tab），不直接发 market_install——与合约描述一致（推荐不自动安装），但用户需在 Market tab 中手动安装。— 影响: 轻微多一步操作，属契约预期行为。
- 担忧 3: submit 20s 超时降级文案为通用「后端未响应」提示，未区分「后端无 Provider 导致创建失败」（后端 error 消息会原样展示，走 applyResult 路径不受影响）。— 影响: 仅影响后端完全不响应时的提示精度。
- 担忧 4: 欢迎消息注入时机为问卷关闭时（handleClose），若此时 chat store 尚未就绪（理论上 App 挂载后即就绪），addMessage 带显式 conversationId "butler"，无空指针风险。— 影响: 低。
