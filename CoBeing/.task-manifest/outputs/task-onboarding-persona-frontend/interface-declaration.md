# 接口声明 — task-onboarding-persona-frontend

> 本声明是我的接口承诺。「myworkflow:integration-verify」将据此验证我的产出。
> 声明时间: 2026-08-04T02:00:00+08:00

## 我将创建/修改的文件

- [x] `gui-v2/src/stores/onboarding.ts`（新）— 首启问卷状态 store（status/createdAgents/recommendations/message + applyResult 供主线程 handler 调用）+ localStorage 首启标记 helper
- [x] `gui-v2/src/components/onboarding/OnboardingOverlay.tsx`（新）— 首启问卷浮层：兴趣多选 chips + 自定义输入 + 结果视图（创建 Agent 列表 + Market 推荐卡片，安装跳转扩展页 Market tab）
- [x] `gui-v2/src/App.tsx`（修改）— TutorialController 增加 onFinished 回调；新增 OnboardingController（tutorial 关闭后立即显示问卷）；关闭问卷后向管家会话注入欢迎消息（仅首启一次）
- [x] `gui-v2/src/components/chat/ChatHeader.tsx`（修改）— 副标题 undefined 修复：provider/model 未加载显示「连接中…」，status 空隐藏状态段
- [x] `gui-v2/src/components/agent/ButlerConfigPanel.tsx`（修改）— 新增「管家形象」区（称呼输入/欢迎语输入/4 模板选择/保存），置于既有工程配置（AgentConfigTab）之上

> 合约中 ButlerConfigPanel 路径写的是 `components/settings/`，该路径不存在；实际文件为 `gui-v2/src/components/agent/ButlerConfigPanel.tsx`（AppLayout.tsx:6 引用），按实际路径修改。

## 我将暴露的接口

| 名称 | 签名 | 所在文件 |
|------|------|----------|
| OnboardingOverlay | `export function OnboardingOverlay({ onClose }: { onClose: () => void }): JSX.Element \| null` | gui-v2/src/components/onboarding/OnboardingOverlay.tsx |
| useOnboardingStore | `export const useOnboardingStore: UseBoundStore<StoreApi<OnboardingStore>>`（含 applyResult(payload) 方法） | gui-v2/src/stores/onboarding.ts |
| isOnboardingPending | `export function isOnboardingPending(): boolean`（localStorage `cobeing_onboarding_done` !== "true"） | gui-v2/src/stores/onboarding.ts |
| markOnboardingDone | `export function markOnboardingDone(): void` | gui-v2/src/stores/onboarding.ts |
| ChatHeader | 签名不变（props 同现状），仅副标题渲染逻辑修复 | gui-v2/src/components/chat/ChatHeader.tsx |
| ButlerConfigPanel | `export function ButlerConfigPanel(): JSX.Element`（签名不变，内部新增管家形象区） | gui-v2/src/components/agent/ButlerConfigPanel.tsx |
| OnboardingController | `function OnboardingController({ enabled }: { enabled: boolean }): JSX.Element \| null`（App.tsx 内部组件，tutorial 关闭后 enabled 置 true） | gui-v2/src/App.tsx |

### store 形状（useOnboardingStore）

```ts
type OnboardingStatus = "idle" | "loading" | "done" | "already_done" | "error";
interface OnboardingCreatedAgent { id: string; name: string; role: string }
interface OnboardingRecommendation { id: string; name: string; description: string; tier: string }
interface OnboardingApplyResultPayload {
  status: "done" | "already_done" | "error";
  createdAgents?: OnboardingCreatedAgent[];
  marketRecommendations?: OnboardingRecommendation[];
  message?: string;
}
// store fields: status / createdAgents / recommendations / message
// actions: submit(interests, note)（发 onboarding_apply + 置 loading + 20s 超时降级 error）、applyResult(payload)、reset()
```

## 我需要的外部输入

| 文件 | 内容（节/函数/类型） | 用途 |
|------|---------------------|------|
| gui-v2/src/App.tsx | TutorialController(11-25) | OnboardingController 仿照；onFinished 挂钩 |
| gui-v2/src/components/tutorial/TutorialOverlay.tsx | 全文件 | 浮层视觉模式参考（磨砂/卡片/圆角/动效） |
| gui-v2/src/components/chat/ChatHeader.tsx | 全文件 | 副标题 undefined 修复点 |
| gui-v2/src/components/agent/ButlerConfigPanel.tsx | 全文件 | 增加管家形象区（在 AgentConfigTab 之上） |
| gui-v2/src/stores/userProfile.ts | 全文件 | zustand + localStorage 持久化模式参考 |
| gui-v2/src/hooks/useWebSocket.ts | getWsClient() | 发送 onboarding/butler 系列 WS 消息（只读，不修改） |
| gui-v2/src/stores/chat.ts | addMessage | 欢迎消息注入（direction:"out", senderId:"butler", conversationId:"butler"） |
| gui-v2/src/stores/settings.ts / extensions.ts | setActiveView / setActiveTab | 推荐卡「安装」跳转扩展视图 Market tab |
| gui-v2/src/hooks/ws-handlers/market-handlers.ts | CustomEvent 模式 | butler 系列响应事件命名参考（ws-butler-*） |

## 我需要主线程提供的接线（集成契约，主线程负责）

| 消息类型（后端→前端） | 主线程接线动作 |
|----------------------|----------------|
| `onboarding_result` | `useOnboardingStore.getState().applyResult(payload)`（payload: {status, createdAgents?, marketRecommendations?, message?}） |
| `butler_personas` | `window.dispatchEvent(new CustomEvent("ws-butler-personas", { detail: msg }))` |
| `butler_persona_set` | `window.dispatchEvent(new CustomEvent("ws-butler-persona-set", { detail: msg }))` |
| `butler_style_updated` | `window.dispatchEvent(new CustomEvent("ws-butler-style-updated", { detail: msg }))` |

## WS 请求契约（本任务前端发送）

- `onboarding_apply` `{interests: string[], note?: string}`
- `butler_get_personas` `{}`（组件挂载时发送）
- `butler_set_persona` `{persona: string}`（模板选中即发）
- `butler_update_style` `{nickname?: string, greeting?: string, apply: true}`（保存按钮）

## 风险和假设

- 假设 1：主线程按上表接线 4 条消息；若但ler 系列事件未接线，管家形象区有降级：模板列表回退为 4 个已知模板（亲密朋友/专业秘书/学习陪伴/家庭助理），选中即时本地高亮，事件到后再补确认态。
- 假设 2：后端 onboarding_apply 与 butler 命令同步开发中；submit 内置 20s 超时降级 error 态（展示后端连接提示），避免浮层永久 loading。
- 假设 3：欢迎消息仅首启注入一次——用 localStorage done 标记 + 模块级布尔守卫双重保证（提交与跳过都会注入）。
- 风险：主线程未接线时「安装」跳转仍可用（纯本地 store 操作），但 createdAgents/recommendations 结果视图不会出现（停留在 loading → 20s 后 error 提示）。
- 风险：ChatHeader 现有调用方（ChatView.tsx:42）传参不变，仅渲染逻辑修复，不影响 GroupChatView 路径。
