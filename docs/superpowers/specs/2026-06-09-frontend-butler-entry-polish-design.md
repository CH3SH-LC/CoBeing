# CoBeing 前端管家入口与整体质感优化设计规格

**日期**: 2026-06-09
**版本**: 1.0
**状态**: 待用户审阅

---

## 1. 背景

2026-06-08 的新规格把 CoBeing 的产品重心进一步收敛到“管家入口 + Agent/Group 执行空间 + Market/扩展后台能力”。前端需要体现这个方向，但不能把首页变成信息密度过高的大看板。

现有 GUI 已经具备六个主入口：管家、智能体、群组、仪表盘、扩展、设置。当前 Agent/Group 页面有侧栏、主聊天区和右侧详情抽屉；管家页只有主聊天区和右侧配置抽屉，缺少与其他页面一致的侧栏结构。与此同时，`butler` 和 `host` 仍可能以普通 Agent 的方式出现在 Agent 界面语境中，不符合“管家专用入口”和“群主不是普通 Agent”的产品边界。

本规格定义一次前端优化：在保留原有布局和扩展性的基础上，让管家页补齐轻量侧栏和输入增强，同时对整体界面质感做克制提升。

---

## 2. 已确认设计决策

| 主题 | 决策 |
|------|------|
| 管家页布局 | 仿照智能体/群组页面，采用左侧栏 + 主聊天窗口 + 右侧可打开设置抽屉 |
| 管家侧栏内容 | 只放轻量任务摘要，不放完整任务大屏 |
| 任务回执 | 可以在聊天消息中使用小卡片展示 |
| 输入区 | 增加小按钮/快捷动作，但不喧宾夺主 |
| 管家设置 | 管家右侧仍有可打开的设置菜单 |
| Agent 页面过滤 | `butler` 和 `host` 都不在普通 Agent 界面显示 |
| 管家归属 | `butler` 只存在于管家专用入口 |
| 群主归属 | `host` 属于群组协作/系统角色，不作为普通 Agent 展示 |
| 整体视觉 | 全前端做质感优化，但保持原有分层 UI 和信息密度 |
| 扩展性 | 新能力采用小组件和插槽式边界，避免写死成不可扩展的大页面 |

---

## 3. 目标

1. 让管家页与智能体/群组页形成一致的信息架构。
2. 在管家侧栏中展示低信息密度任务摘要，帮助用户知道“哪些事需要我处理”。
3. 在管家聊天流中支持任务回执小卡片，表达委派、状态和下一步。
4. 在输入区增加少量快捷动作，降低派发任务、创建资源、查看摘要的操作成本。
5. 从普通 Agent 界面过滤 `butler` 和 `host`，避免核心角色混入用户创建的 Agent 列表。
6. 对导航、侧栏、按钮、空状态、Sheet、消息卡片、字体和间距做统一质感优化。
7. 保持插件、主题和后续 UI 扩展能力，不把这次改动做成封闭结构。

---

## 4. 非目标

1. 不实现完整 Global TODOboard 大看板。
2. 不把 Market、Agent、Group、TODO 全部塞进管家首页。
3. 不从全局 store 删除 `butler` 或 `host` 数据；它们仍供管家配置、群组系统逻辑和后端状态使用。
4. 不重写现有前端路由。
5. 不重做扩展页的插件系统。
6. 不把群主作为可被用户直接长期聊天的普通 Agent。
7. 不在本轮强依赖后端新 ButlerTask API；前端结构先预留，真实数据可分阶段接入。

---

## 5. 当前前端事实

### 5.1 现有布局

- `AppLayout.tsx` 负责全局渐变基底、`TitleBar`、`NavBar`、`Sidebar`、`MainContent` 和详情面板。
- `Sidebar.tsx` 当前只在 `agents` 和 `groups` 视图显示。
- `MainContent.tsx` 在 `butler` 视图中直接渲染 `ChatView key="butler"`。
- `ButlerConfigPanel.tsx` 已存在，只在 `activeView === "butler"` 时作为右侧 Sheet 打开。
- `AgentDetailPanel.tsx` 与 `GroupDetailPanel.tsx` 分别服务智能体和群组视图。

### 5.2 当前角色混入风险

- `useWebSocket.ts` 在收到 `state` 后直接 `setAgents(p.agents)`，不会过滤核心 Agent。
- `Sidebar.tsx` 的 `AgentList` 使用完整 `agents` 列表排序和展示，因此 `butler`、`host` 可能进入普通 Agent 侧栏。
- 部分选择器已经过滤 `butler`，例如群组创建、群组成员添加、群聊 mention 等，但过滤规则不统一。

### 5.3 可复用能力

- `LogMessage.metadata` 已存在，可承载任务回执元信息。
- `TodoPanel` 已支持 Agent/Group TODO，适合继续放在详情抽屉，不适合搬到首页。
- `activity.ts`、`wakeQueue.ts`、`observability` 已提供活动和运行状态数据，后续可为摘要提供输入。
- `plugins.ts` 已支持插件 settings-panel，说明前端已有动态扩展意识。

---

## 6. 信息架构设计

### 6.1 全局结构

管家、智能体、群组三类主操作入口应共享同一骨架：

```text
NavBar
  ├── Context Sidebar
  ├── Main Chat / Workspace
  └── Right Detail Sheet
```

区别只在 Context Sidebar 内容：

| 视图 | 左侧栏内容 | 主区域 | 右侧 Sheet |
|------|------------|--------|------------|
| 管家 | 任务摘要、待确认、最近回执 | Butler 聊天 | 管家设置 |
| 智能体 | 普通 Agent 列表，不含 butler/host | Agent 聊天 | Agent 配置/文件/TODO |
| 群组 | 群组列表 | Group 聊天 | 成员/工作区/配置/TODO |

### 6.2 管家侧栏

新增 `ButlerSidebar`。它只展示轻量摘要，每个区块最多 3 条，不出现完整任务表。

推荐区块：

1. **今日托管**
   - 运行中数量
   - 待用户确认数量
   - 最近完成数量

2. **待我确认**
   - 只显示需要用户决策的任务标题和来源
   - 点击后把对应回执定位到聊天，或打开一个轻量详情 Sheet

3. **最近回执**
   - 显示最近 3 条委派/完成/卡住事件
   - 不显示长日志和群组内部过程

4. **快捷入口**
   - 查看全部任务摘要
   - 打开管家设置
   - 重新同步状态

侧栏空状态文案应保持轻：

```text
现在没有需要你处理的托管事项
```

### 6.3 管家主聊天区

保留 `ChatView` 的主体体验，不给消息列表容器添加面板背景。优化点：

- `ChatHeader` 中显示管家名称、连接状态、当前托管摘要小 chip。
- 配置按钮继续打开 `ButlerConfigPanel`。
- 新对话按钮保留。
- 任务回执作为消息内小卡片出现，不常驻在页面顶部。

### 6.4 管家右侧设置

继续使用 `ButlerConfigPanel`，但视觉上与 Agent/Group Sheet 对齐：

- 顶部显示管家身份、Provider/Model、状态。
- 主体复用 `AgentConfigTab`，但可以隐藏不适合管家的普通 Agent 行为。
- 后续可增加“管家人格”“托管偏好”“主动性”等专属 Tab，但本轮不强制实现。

---

## 7. 新功能设计

### 7.1 任务回执小卡片

新增 `TaskReceiptCard`，用于聊天消息内展示结构化任务状态。

默认折叠信息：

| 字段 | 示例 |
|------|------|
| 标题 | 已委派：端午旅行计划 |
| 接受者 | 旅行筹备组 |
| 状态 | 运行中 / 待确认 / 已完成 |
| 下一步 | 等待你选择舒适优先或体验优先 |

展开后显示：

- 来源消息
- assignee 类型和名称
- 最近事件摘要
- 可用操作：查看详情、继续追问、取消托管

任务回执必须遵守低信息密度原则：

- 默认高度不超过普通消息气泡的 1.5 倍。
- 默认最多显示 2 行说明。
- 不显示原始工具参数和长 JSON。

### 7.2 输入区小按钮

新增 `ChatInputActions`，在输入框底部左侧显示小按钮。

管家视图推荐按钮：

| 按钮 | 行为 |
|------|------|
| 派发 | 打开目标选择小菜单：Agent / Group |
| 创建 | 打开创建 Agent / 创建 Group 快捷菜单 |
| 摘要 | 请求管家总结托管状态 |
| 资源 | 后续接入 Market 推荐，不在本轮强依赖 |

智能体/群组视图可以复用该组件，但按钮集合不同：

- Agent：技能、绑定、TODO。
- Group：@ 提及、成员、TODO。

按钮应是低视觉权重，不使用大面积彩色块。

### 7.3 管家侧栏任务摘要

新增轻量数据结构 `ButlerTaskSummary`：

```ts
interface ButlerTaskSummary {
  id: string;
  title: string;
  assigneeType: "agent" | "group";
  assigneeId: string;
  assigneeName: string;
  status: "running" | "waiting_user" | "completed" | "cancelled";
  lastEvent: string;
  nextAction?: string;
  updatedAt: number;
}
```

数据来源分阶段：

1. 第一阶段：前端可从现有聊天 metadata、activity、TODO 更新事件中生成摘要。
2. 第二阶段：后端新增 ButlerTask / Global TODO API 后改为真实接口。

### 7.4 核心 Agent 过滤

新增统一常量：

```ts
export const CORE_AGENT_IDS = new Set(["butler", "host"]);
```

新增统一 helper：

```ts
export function isCoreAgent(id: string): boolean {
  return CORE_AGENT_IDS.has(id);
}

export function getVisibleUserAgents(agents: AgentInfo[]): AgentInfo[] {
  return agents.filter((agent) => !isCoreAgent(agent.id));
}
```

应用规则：

- Agent 侧栏只显示 `getVisibleUserAgents(agents)`。
- Agent 自动选择只从 visible agents 选择。
- Agent 详情面板只允许打开 visible agents。
- 创建群组、添加成员、普通 @mention 选择器不提供 `butler` 和 `host`。
- 如果群组内部需要展示 host，应以“系统群主/协调者”身份展示，不进入普通 Agent 列表。

---

## 8. 组件边界

### 8.1 新建组件

| 文件 | 职责 |
|------|------|
| `gui-v2/src/lib/coreAgents.ts` | 核心 Agent 常量和过滤 helper |
| `gui-v2/src/components/layout/ButlerSidebar.tsx` | 管家视图专用侧栏 |
| `gui-v2/src/components/chat/TaskReceiptCard.tsx` | 聊天内任务回执小卡片 |
| `gui-v2/src/components/chat/ChatInputActions.tsx` | 输入区快捷动作按钮组 |
| `gui-v2/src/stores/butlerTasks.ts` | 管家任务摘要 UI store，支持未来真实 API |

### 8.2 修改组件

| 文件 | 修改 |
|------|------|
| `gui-v2/src/components/layout/AppLayout.tsx` | 确保 ButlerSidebar 与现有 Sidebar 并列进入布局 |
| `gui-v2/src/components/layout/Sidebar.tsx` | AgentList 使用 visible agents，过滤 butler/host |
| `gui-v2/src/components/layout/MainContent.tsx` | Butler 视图保持 ChatView，但允许管家侧栏存在 |
| `gui-v2/src/components/chat/ChatView.tsx` | 接入 TaskReceiptCard 与 ChatInputActions，并拆小公共子组件 |
| `gui-v2/src/components/chat/GroupChatView.tsx` | mention/member 选择过滤 host/butler，复用输入动作结构 |
| `gui-v2/src/components/agent/ButlerConfigPanel.tsx` | 视觉对齐右侧设置 Sheet，保留管家专属入口 |
| `gui-v2/src/components/agent/AgentDetailPanel.tsx` | 防御性过滤核心 Agent |
| `gui-v2/src/components/group/GroupMembersTab.tsx` | 添加成员时不提供 butler/host |
| `gui-v2/src/components/group/CreateGroupDialog.tsx` | 继续排除 butler/host，并统一使用 helper |
| `gui-v2/src/components/settings/ChannelsSection.tsx` | 若作为普通 Agent 绑定目标，排除 butler/host；如需要绑定管家，使用专门管家入口 |
| `gui-v2/src/styles/globals.css` | 统一细节质感，避免过小字号和硬边框 |

### 8.3 可选拆分

`ChatView.tsx` 当前体量较大，建议在实现时拆出：

- `ChatHeader`
- `MessageList`
- `MessageBubble`
- `ChatInput`
- `ToolCallsGroup`

拆分只服务本次需求，不做无关重构。

---

## 9. 视觉设计规则

### 9.1 总体质感

- 继续使用渐变基底，不改成纯色后台。
- 导航栏保持实色 surface solid。
- 侧栏和设置面板使用半透明 surface + 柔和边框 + `var(--shadow-surface)`。
- 主聊天消息直接浮在基底上，消息气泡独立成层。
- 避免满屏卡片嵌套。

### 9.2 信息密度

- 管家侧栏每个区块最多 3 条。
- 主聊天区不常驻展示任务总览。
- 任务详情通过展开、Sheet 或点击进入，而不是默认铺开。
- Dashboard 仍是监控入口，不承担日常任务入口。

### 9.3 字号与间距

- 正文、按钮、输入框、标签默认 `text-sm`。
- 仅 badge、日志时间戳、代码路径允许 `text-xs`。
- 禁止新增 `text-[9px]`、`text-[10px]`、`text-[11px]`。
- 主容器 padding 保持 20px 以上。
- 列表项 padding 使用 `14px 20px` 附近。

### 9.4 图标

- 新增按钮优先使用 `lucide-react` 图标。
- 逐步减少导航和关键按钮中的 emoji。
- 对不熟悉的图标提供 `title` 或 tooltip。

---

## 10. 扩展性设计

### 10.1 插槽边界

本次不需要一次性实现完整插件 UI 插槽，但组件边界应预留以下方向：

| 插槽 | 用途 |
|------|------|
| `butler-sidebar-section` | 插件或后续系统能力向管家侧栏追加摘要区块 |
| `chat-input-action` | 插件向输入区追加小动作 |
| `message-card` | 插件或后端事件渲染特定消息卡片 |
| `detail-panel-tab` | 管家/Agent/Group 详情抽屉追加 Tab |

### 10.2 数据扩展

`TaskReceiptCard` 不应该只识别一个固定字段。推荐从 `LogMessage.metadata` 中读取：

```ts
metadata?: {
  taskReceipt?: TaskReceipt;
  cards?: Array<{ type: string; payload: unknown }>;
}
```

第一阶段只实现 `taskReceipt`。后续插件可通过 `cards` 扩展。

### 10.3 主题扩展

所有新增颜色必须走现有 CSS token 或主题变量，不硬编码业务色。允许用 `color-mix()` 基于 token 生成轻量状态背景。

---

## 11. 用户流程

### 流程 1：用户从管家派发任务

1. 用户在管家输入区输入需求。
2. 用户可点击“派发”小按钮选择目标 Agent/Group，也可自然语言交给管家判断。
3. 管家回复中出现任务回执小卡片。
4. 管家侧栏“最近回执”出现一条摘要。
5. 若后续需要用户决策，侧栏“待我确认”出现提示。

### 流程 2：用户查看管家设置

1. 用户点击管家 ChatHeader 的设置按钮。
2. 右侧打开 `ButlerConfigPanel`。
3. 用户调整管家模型、权限、工具或后续人格设置。
4. 关闭后回到聊天，不改变主界面信息密度。

### 流程 3：用户进入 Agent 页面

1. 用户点击智能体入口。
2. 侧栏只显示用户可管理的普通 Agent。
3. `butler` 和 `host` 不出现。
4. 如果没有普通 Agent，显示空状态并提供创建 Agent 动作。

### 流程 4：用户进入群组页面

1. 群组页仍显示群组列表和群聊。
2. 群主如果需要展示，应作为群组内系统角色或协调者展示。
3. 用户添加群组成员时不能选择 `butler` 或 `host`。

---

## 12. 边界情况

### 12.1 后端还没有 ButlerTask API

前端显示空摘要或从现有事件中派生摘要，不阻塞布局优化。侧栏文案：

```text
暂无托管摘要
```

### 12.2 Agent 列表过滤后为空

显示空状态：

```text
还没有普通智能体
```

提供“新建 Agent”按钮。

### 12.3 用户直接访问 butler 聊天

`MainContent` 仍自动选择 `activeConversation = "butler"`。即使 Agent 页面过滤 butler，管家入口仍可正常聊天。

### 12.4 后端仍返回 host

保留 store 中的 `host` 数据，但 UI 中普通 Agent 入口不展示。群组逻辑若需要 host，由群组组件用系统角色方式解释。

### 12.5 任务回执元数据缺失

消息按普通文本渲染。不得因为 metadata 缺失导致消息崩溃。

### 12.6 插件扩展内容过多

每个侧栏插槽必须有高度限制和折叠规则，不能破坏低信息密度原则。

---

## 13. 验收标准

1. 管家页出现左侧轻量任务摘要侧栏。
2. 管家主聊天仍是视觉中心。
3. 管家右侧设置抽屉可打开，并保留配置能力。
4. 管家聊天中可以展示任务回执小卡片。
5. 输入区出现低视觉权重快捷按钮。
6. Agent 页面不显示 `butler`。
7. Agent 页面不显示 `host`。
8. Agent 页面自动选择不会选中 `butler` 或 `host`。
9. 创建群组、添加成员、普通 Agent 选择器不提供 `butler` 或 `host`。
10. 新增 UI 不引入 `text-[9px]`、`text-[10px]`、`text-[11px]`。
11. 新增颜色使用 CSS token 或 `color-mix()`，不硬编码一次性主题。
12. 构建通过 `pnpm build`。
13. 前端首屏信息密度低于详细 mockup：管家侧栏只摘要，不展示完整任务表。

---

## 14. 推荐实施分层

### Phase 1 — 核心 Agent 过滤

- 新增 `coreAgents.ts`。
- Agent 侧栏过滤 `butler` 和 `host`。
- Agent 自动选择使用 visible agents。
- 群组成员选择和普通选择器统一 helper。

### Phase 2 — 管家侧栏与布局同构

- 新增 `ButlerSidebar`。
- `AppLayout` 或 `Sidebar` 接入 butler 侧栏。
- 管家页形成侧栏 + 聊天 + 设置 Sheet 的同构布局。

### Phase 3 — 聊天轻功能

- 新增 `TaskReceiptCard`。
- 新增 `ChatInputActions`。
- `ChatView` 接入任务回执和管家输入小按钮。

### Phase 4 — 质感优化与扩展性整理

- 导航和按钮图标改用 lucide。
- 修复过小字号。
- 优化空状态、侧栏列表、Sheet 视觉。
- 为未来 UI 插槽保留类型边界。

---

## 15. 最终口径

这次前端优化不是把 CoBeing 改成任务管理后台，而是让“管家作为入口”变得更真实、更清晰。

管家页应该像其他主操作入口一样有侧栏和设置抽屉，但侧栏只承载摘要和提醒。任务详情仍通过聊天、抽屉或后续专门入口渐进展开。

`butler` 和 `host` 都是核心角色，不是普通 Agent。普通用户在 Agent 页面看到的应该是自己创建和管理的工作智能体；管家在管家入口，群主在群组协作语境中。

视觉上保持 CoBeing 既有的分层、留白和柔和基底，同时减少 emoji 依赖、过小字号和后台感，让界面更高级，但不牺牲未来插件和资源扩展能力。
