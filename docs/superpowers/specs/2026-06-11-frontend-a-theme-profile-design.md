# CoBeing 前端 A 版式 + 主题化气泡 + 用户资料设计

> 日期：2026-06-11
> 状态：待用户审核
> 关联预览：
> - `D:\agent-codes\CoBeing\.superpowers\previews\option-a-layered-polish.html`
> - `D:\agent-codes\CoBeing\.superpowers\previews\option-b-executive-workbench.html`

## 目标

本次前端优化以方案 A 为主方向：保留 CoBeing 现有“樱花薄荷 + 分层毛玻璃”视觉体系，重点修正新功能露出、聊天气泡比例、头像位置、文字层级和多主题适配。

方案 B 不作为默认版式落地，但沉淀为一个内置主题，让用户能在设置中切换到“高级工作台”配色。

## 范围

1. 统一所有对话窗口的气泡版式：独立 Agent、管家、群组、思考中、工具调用、任务回执。
2. 让气泡颜色真正随主题切换：用户、助手、系统、工具气泡都使用主题 chat token。
3. 所有聊天气泡增加头像：用户头像在右，智能体/管家/群组成员头像在左。
4. 设置页新增“用户”入口，允许用户设置昵称和头像。
5. 对话中用户消息显示昵称，不再固定显示“你”。
6. 新增一个 B 方案配色的内置主题。
7. 检查最新功能入口：管家全局任务、任务回执、快捷派发/创建/摘要、Agent 能力/任务/成长 Tab、扩展中心都应可见且比例协调。

不在本次范围：
- 完整账号系统、登录同步、多设备资料同步。
- 后端 Agent prompt 中使用用户昵称。
- 重写整个页面信息架构。

## 设计方向

### 主版式

采用方案 A：
- 左侧窄导航保持实色稳定锚点。
- 管家页左侧显示 Global TODO 浮动面板。
- 中间保留对话为主，消息列表不加大容器背景，只让气泡浮在渐变基底上。
- 输入框保持居中浮动面板，宽度约为主内容区 60%-72%，避免过窄。
- 右侧详情 Sheet/Panel 中的新功能 Tab 需要统一字号、间距和卡片层级。

### 气泡比例

统一规则：
- 气泡最大宽度：桌面 `min(70%, 720px)`，群组 Agent 消息可因头像/色条略收窄。
- 气泡内边距：`16px 24px` 起步，长文本保持 `line-height: 1.65` 左右。
- 消息间距：约 24px。
- 用户消息右对齐，头像在气泡右侧；助手消息左对齐，头像在气泡左侧。
- 气泡圆角保持 `rounded-2xl`，尾部角可轻微收小，但不改变整体比例。

## 主题系统

现有 `ThemeChat` 已包含：
- `msg-user`
- `msg-assistant`
- `msg-system`
- `msg-tool`

本次实现要求：
- 所有气泡背景只使用 `bg-msg-user`、`bg-msg-assistant`、`bg-msg-system`、`bg-msg-tool` 或对应 CSS 变量。
- 不再在聊天组件中使用硬编码气泡色、Tailwind 默认色、`bg-green-*` / `bg-red-*` 等非主题色。
- 主题预览卡显示用户/助手气泡色，方便确认气泡确实随主题变化。
- 新增内置主题 `executive-workbench.json`，配色来自方案 B，但保持同一 token 结构。
- 更新 `public/themes/manifest.json`，让新主题出现在设置页。

## 用户资料

### 数据模型

前端新增轻量用户资料 store：

```ts
interface UserProfile {
  nickname: string;
  avatar: {
    type: "initial" | "emoji" | "image";
    value: string;
  };
}
```

默认值：
- `nickname`: `我`
- `avatar`: `{ type: "initial", value: "我" }`

存储方式：
- 首期使用 `localStorage`，key 为 `cobeing-user-profile`。
- 这是纯前端显示能力，不改变后端配置和 Agent 运行逻辑。

### 设置页

设置菜单新增“用户”入口，位置建议放在“常规”之前或之后。

用户设置内容：
- 昵称输入框。
- 头像设置：
  - 默认用昵称首字。
  - 可输入一个 emoji 或短文本作为头像。
  - 可选：支持图片 URL 或本地 data URL 预览；若实现成本过高，首期只做 emoji/首字母。
- 右侧展示聊天气泡预览，显示昵称、头像和当前主题下的气泡颜色。

## 组件改造

### ChatView

需要抽出或统一：
- `ChatAvatar`
- `MessageBubble`
- `MessageRow`
- `ToolCallsGroup`
- `ThinkingBubble`

用户消息读取 `useUserProfileStore()`：
- sender label 使用 `profile.nickname`。
- avatar 使用 profile avatar。

助手消息：
- 管家显示“管”或对应管家头像。
- Agent 使用 Agent 名称首字。
- 如果 `senderName` 存在，优先使用 `senderName`。

### GroupMessageBubble

群组消息也使用同一头像/气泡体系：
- 用户消息：头像右侧，昵称来自用户设置。
- Agent 消息：头像左侧，名称来自 Agent store；保留群组成员身份色，但不要破坏主题气泡背景。
- 审核覆盖、提及、高亮等状态标签使用主题色。

### GroupChatView

思考中气泡也加头像，并使用 `bg-msg-assistant`。

### Agent 详情新功能 Tab

重点修正：
- `CapabilityTab`、`TaskInboxTab`、`GrowthProposalsTab` 禁止 `text-[10px]` / `text-[11px]`。
- 禁止 `bg-card2`、`border-border`、Tailwind 默认彩色类。
- 标签、状态、按钮全部改用主题 token。
- Tab 标签字号至少 14px 或在可接受的小徽章场景使用 12px。

## 新功能露出检查

验收时必须确认：
- 管家页左栏 Global TODO 可见，任务状态、等待用户、完成项不挤压。
- 管家输入框快捷操作“派发 / 创建 / 摘要 / 技能”可见，按钮不使用过小字体。
- 任务回执卡在聊天气泡内显示，折叠态信息完整，展开态不破坏聊天宽度。
- Agent 详情面板显示“能力 / 任务 / 成长”三个新 Tab，内容可读。
- 扩展中心三 Tab 在页面中比例协调，不与设置页功能重复造成误导。

## 数据流

用户设置：
1. `UserProfileSection` 修改昵称/头像。
2. `useUserProfileStore` 写入 localStorage。
3. Chat 组件订阅 store，即时更新新消息和现有消息的用户显示名。

主题切换：
1. `ThemeSelector` 调用 `setTheme(id)`。
2. `theme.ts` 写入 chat token 到 `:root`。
3. 所有消息气泡因使用 CSS 变量立即变化。

Agent 新功能：
1. `AgentDetailPanel` 打开对应 Tab。
2. `useAgentEnhancementStore` 发送 WS 查询。
3. `useWebSocket` 接收 capability/inbox/proposals，写入 store。
4. Tab 内容按统一视觉样式展示。

## 错误与空状态

- 用户昵称为空时自动回退为 `我`。
- 头像为空时用昵称首字。
- 主题缺少 chat token 时使用 `globals.css` 默认值。
- Agent 能力/任务/成长数据为空时显示清晰空状态，字号不小于 14px。
- 图片头像加载失败时回退为首字头像。

## 测试与验证

实现后需要执行：
- `pnpm --filter cobeing-gui build` 或在项目实际脚本约束下运行 GUI build。
- 若改到 `.ts` 后端源码，必须运行项目根 `pnpm build`。
- 浏览器/GUI 视觉检查：
  - 默认樱花薄荷主题下用户/助手气泡颜色不同。
  - 切换到工作台主题后，用户/助手/工具/系统气泡颜色随主题变化。
  - 用户昵称修改后，所有用户消息显示昵称。
  - 用户头像在右侧，助手/Agent 头像在左侧。
  - 管家、独立 Agent、群组对话三类窗口都符合头像与气泡规则。
  - Agent 详情新 Tab 无 10px/11px 字号，无硬编码默认色。

## 文档同步

代码实现完成后需同步：
- `PROGRESS.md`
- `PROGRESS-LITE.md`
- `docs/项目信息/项目现状.md`
- `docs/项目信息/使用说明.md`
- 如新增文件，更新 `STRUCTURE.md`

本设计文档位于工作区根目录；当前工作区根目录不是 git 仓库，因此无法单独提交此设计文档。
