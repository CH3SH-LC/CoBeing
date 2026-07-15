# Round 2：管家入口前端 UI 改造 — 实施规格

**日期**: 2026-06-09
**状态**: 已确认
**父文档**: `docs/GOALS/frontend-butler-entry-polish-design.md`
**前置**: Round 1 数据层 + 核心 Agent 过滤已完成

---

## 1. 概述

Round 2 在 Round 1 的数据层和过滤基础上，完成管家页的前端 UI 改造。覆盖设计 spec 的 Phase 2/3/4：管家侧栏 + 布局同构、任务回执卡片 + 输入快捷按钮、整体质感优化。

所有数据来自现有 Zustand store，不依赖新后端 API。

---

## 2. 交付物总览

| # | 类型 | 文件 | 说明 |
|---|------|------|------|
| 1 | 新建 | `gui-v2/src/components/layout/ButlerSidebar.tsx` | 管家侧栏（4 区块） |
| 2 | 新建 | `gui-v2/src/components/chat/TaskReceiptCard.tsx` | 任务回执卡片 |
| 3 | 新建 | `gui-v2/src/components/chat/ChatInputActions.tsx` | 输入快捷按钮组 |
| 4 | 修改 | `gui-v2/src/lib/types.ts` | TaskReceipt + 消息 metadata 扩展 |
| 5 | 修改 | `gui-v2/src/components/layout/Sidebar.tsx` | 支持 butler 视图 |
| 6 | 修改 | `gui-v2/src/components/layout/AppLayout.tsx` | ButlerSidebar 进入布局 |
| 7 | 修改 | `gui-v2/src/components/layout/MainContent.tsx` | butler 视图允许侧栏存在 |
| 8 | 修改 | `gui-v2/src/components/chat/ChatView.tsx` | 接入卡片 + 按钮 + ChatHeader 托管 chip |
| 9 | 修改 | `gui-v2/src/styles/globals.css` | 质感：字号/间距/图标 |

**总计：3 新建 + 6 修改 = 9 文件**

---

## 3. 新建组件设计

### 3.1 ButlerSidebar

#### Props & Data

```ts
// 无需外部 props，所有数据从 store 获取
function ButlerSidebar() {
  const { summary, tasks } = useButlerTasksStore();
  const waitingTasks = tasks.filter(t => t.status === "waiting_user").slice(0, 3);
  const recentTasks = tasks.filter(t => t.status !== "cancelled").slice(-3);
  const setActiveView = useSettingsStore(s => s.setActiveView);
  const toggleDetailPanel = useSettingsStore(s => s.toggleDetailPanel);
  // ...
}
```

#### 区块结构

1. **今日托管** — 三列数字：运行中 / 待确认 / 已完成
2. **待我确认** — 最多 3 条 waiting_user 任务，点击定位到聊天
3. **最近回执** — 最近 3 条非取消任务摘要
4. **快捷入口** — 查看全部任务 / 管家设置 / 刷新

#### 空状态文案

```
现在没有需要你处理的托管事项
```

#### 视觉规格

- 与 Agent/Group 侧栏等宽（w-64）
- 半透明 surface 背景 + border
- 每个区块使用 `bg-surface` 圆角卡片
- 统计数字使用 accent 色、warning 色、success 色

### 3.2 TaskReceiptCard

#### Props

```ts
interface TaskReceiptCardProps {
  receipt: TaskReceipt;
  onViewDetail?: () => void;
  onContinueChat?: () => void;
}
```

#### 类型

```ts
interface TaskReceipt {
  id: string;
  title: string;
  assigneeType: "agent" | "group";
  assigneeName: string;
  status: "running" | "waiting_user" | "completed" | "failed" | "cancelled";
  summary?: string;
  nextAction?: string;
  artifacts?: Array<{ name: string; path?: string }>;
}
```

#### 视觉规格

- 默认高度不超过普通消息气泡的 1.5 倍
- 默认显示：标题 + 接受者 + 状态 badge + 最多 2 行摘要
- 展开后显示：来源、最近事件、可用操作（查看详情/继续追问）
- 使用 `bg-msg-tool` 类似背景
- 状态对应色：running=accent, waiting_user=warning, completed=success, failed=danger

### 3.3 ChatInputActions

#### Props

```ts
interface ChatInputActionsProps {
  view: "butler" | "agent" | "group";
  onDispatch?: () => void;
  onCreate?: () => void;
  onSummary?: () => void;
}
```

#### 管家视图按钮

| 按钮 | 图标 | 行为 |
|------|------|------|
| 派发 | `Send` (lucide) | 打开目标选择（Agent/Group 列表） |
| 创建 | `Plus` (lucide) | 打开创建菜单（Agent/Group） |
| 摘要 | `BarChart3` (lucide) | 发消息请求管家总结托管状态 |

#### 视觉规格

- 低视觉权重：`text-txt-muted` + `border-bdr` 细边框
- 小尺寸：`text-xs` + `px-2 py-1`
- 放在输入框底部左侧
- hover 变 `text-txt` + `bg-hover`

---

## 4. 修改组件清单

### 4.1 Sidebar.tsx

- 当前 `activeView !== "agents" && activeView !== "groups"` 时 return null
- 新增 `activeView === "butler"` 分支，渲染 `<ButlerSidebar />`

### 4.2 AppLayout.tsx

- 无结构变更。`ButlerSidebar` 在 `Sidebar` 内部渲染，布局自动适应。

### 4.3 MainContent.tsx

- 当前 butler 视图直接渲染 `<ChatView key="butler">`
- 不修改 ChatView 渲染逻辑，只确保侧栏存在时不冲突

### 4.4 ChatView.tsx

修改点：

1. **ChatHeader** — 管家视图时显示托管摘要 chip（`<span>0 托管中</span>` 从 butlerTasks 读取）
2. **MessageBubble** — 当 `msg.metadata?.taskReceipt` 存在时渲染 `<TaskReceiptCard>`
3. **ChatInput** — 管家视图时底部左侧嵌入 `<ChatInputActions view="butler">`

### 4.5 types.ts

新增类型：

```ts
interface TaskReceipt {
  id: string;
  title: string;
  assigneeType: "agent" | "group";
  assigneeName: string;
  status: "running" | "waiting_user" | "completed" | "failed" | "cancelled";
  summary?: string;
  nextAction?: string;
  artifacts?: Array<{ name: string; path?: string }>;
}

// 扩展 LogMessage.metadata
// metadata?: { taskReceipt?: TaskReceipt; cards?: Array<{ type: string; payload: unknown }> }
```

---

## 5. 质感优化清单

### 5.1 字号

- 禁止新增 `text-[9px]`/`text-[10px]`/`text-[11px]`
- 正文/按钮/输入框/标签默认 `text-sm`
- 仅 badge、时间戳、代码路径允许 `text-xs`
- 现有过小字号在本次涉及的文件中修正

### 5.2 图标迁移

- 新增按钮使用 `lucide-react`（Send, Plus, BarChart3, Settings, List）
- 导航栏 `🤖` emoji 保持不变
- 设置按钮 `⚙` → `Settings` (lucide)

### 5.3 间距

- 主容器 padding 保持 20px+
- 列表项 padding 使用 14px 20px
- 侧栏区块间距使用 gap 14-16px

---

## 6. 扩展性预留

### 6.1 插槽类型（仅类型定义，不实现动态注册）

```ts
type ButlerSidebarSection = "today" | "waiting" | "recent" | "shortcuts";
type ChatInputActionSlot = "dispatch" | "create" | "summary";
type MessageCardType = "taskReceipt";
```

### 6.2 消息 metadata 扩展

`LogMessage.metadata` 增加 `cards` 数组以备后续插件扩展：

```ts
metadata?: {
  taskReceipt?: TaskReceipt;
  cards?: Array<{ type: string; payload: unknown }>;
}
```

---

## 7. 测试要求

前端纯 UI 变更，不新增自动化测试。验收方式：
- `gui-v2 npx tsc --noEmit` 零错误
- `vite build` 构建成功
- 手动验收：管家页侧栏可见、卡片渲染、按钮可点击

---

## 8. 不在本 Round 范围

- ❌ 后端 ButlerTask API
- ❌ 数据实际填充（butlerTasks 保持空状态）
- ❌ 全局 TODOboard 大看板
- ❌ Market UI
- ❌ 插件动态注册 UI 插槽

---

## 9. 验收标准

1. 管家页出现左侧轻量任务摘要侧栏
2. 管家主聊天仍是视觉中心
3. 管家右侧设置抽屉可打开（已有，保持不变）
4. 管家聊天可展示任务回执小卡片（若 metadata 存在）
5. 输入区出现低视觉权重快捷按钮（管家视图）
6. 新建 UI 不引入过小字号
7. 新增颜色使用 CSS token
8. `gui-v2 npx tsc --noEmit` 零错误
9. `vite build` 通过
10. 管家侧栏只摘要，不展示完整任务表
