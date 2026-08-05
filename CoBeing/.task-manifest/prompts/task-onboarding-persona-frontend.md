# 子任务:task-onboarding-persona-frontend(阶段 B+C 前端)

## 任务描述
首启 OnboardingOverlay 问卷 + 欢迎消息注入 + ChatHeader 空态 undefined 修复 + ButlerConfigPanel 管家形象区(模板选择/称呼/欢迎语)。

## 关键契约(读 .task-manifest/task-contract-butler.md 中你的条目)
- WS 契约(后端同步实现中,按此对接):
  - 发 onboarding_apply{interests:string[], note?} → 收 onboarding_result{status:"done"|"already_done"|"error", createdAgents:[{id,name,role}], marketRecommendations:[{id,name,description,tier}], message?}
  - 发 butler_get_personas{} → 收 butler_personas{personas:[{id,name}], current}
  - 发 butler_set_persona{persona} → 收 butler_persona_set{ok, persona, message?}
  - 发 butler_update_style{nickname?, greeting?, apply:boolean} → 收 butler_style_updated{ok, message?}
- **不动 useWebSocket.ts**(主线程接线 onboarding 消息);不得修改 todo-handlers.ts/ChatInputActions.tsx/GlobalTodoPanel.tsx(T4 范围)。

## 实现要点
1. **必读** CoBeing/.claude/skills/frontend-design/ 三份规则文件(user-ui-preferences / co-being-ui-terms / co-being-ui-design-preferences),UI 遵循主题 token 与浮层规范。
2. OnboardingOverlay.tsx:首启检测(localStorage cobeing_onboarding_done !== "true")→ 问卷浮层:欢迎文案 + 兴趣多选 chips(生活/学习/旅行/购物/创作/家庭事务/工作杂事)+ 可选自定义输入 + 「开始使用」(提交)/「跳过」。提交 → send onboarding_apply → 展示结果视图:创建的 Agent 列表(名称/角色)+ Market 推荐卡片(名称/tier/描述 + 安装按钮(跳转扩展页 Market tab)/跳过)→ 完成标记。UI 复用磨砂浮层(参考 TutorialOverlay/Sheet 样式)。
3. App.tsx:OnboardingController(仿 TutorialController 11-25):首启且 TutorialOverlay 已关闭/跳过时显示 OnboardingOverlay(两浮层不叠加——tutorial 完成后立即出问卷)。
4. 欢迎消息:OnboardingOverlay 关闭(无论提交或跳过)后,向管家聊天区注入一条管家欢迎消息(chat store addMessage,direction:"out",senderId:"butler",内容:自我介绍 + 引导性问题「你想先处理什么?我可以帮你创建专属智能体」),仅首启注入一次。
5. ChatHeader.tsx:副标题 undefined 修复——provider/model 未加载时显示「连接中…」;status 空时隐藏状态段。
6. ButlerConfigPanel.tsx:新增「管家形象」区(在既有工程配置之上):称呼输入 + 欢迎语输入 + 模板选择(4 个 persona,选中即发 butler_set_persona)+ 保存按钮(发 butler_update_style{nickname,greeting,apply:true})。组件内部用 getWsClient().send + 本地 state。
7. stores/onboarding.ts:useOnboardingStore——status(idle/loading/done/already_done/error)、createdAgents、recommendations、message;提供 applyResult 方法供主线程 handler 调用(主线程接线 onboarding_result 消息)。

## 验证
- cd D:/agent-codes/CoBeing/gui-v2 && pnpm exec tsc --noEmit
- cd D:/agent-codes/CoBeing/gui-v2 && pnpm build
- cd D:/agent-codes/CoBeing && pnpm exec vitest run gui-v2/src(不得破坏既有测试)

## 工作协议
遵循「myworkflow:subagent-protocol」,task-id=task-onboarding-persona-frontend。声明/自检/完成报告写 .task-manifest/outputs/task-onboarding-persona-frontend/。
