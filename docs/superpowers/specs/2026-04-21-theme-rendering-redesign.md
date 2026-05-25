# CoBeing 前端主题与渲染方案重设计

日期：2026-04-21

## 问题

1. **主题扩展能力不强** — 5 个主题共用一个 `themes.json`，无法导入/导出单个主题
2. **硬编码颜色** — 组件中存在 `bg-white`、`#fff` 等硬编码值，切换主题后不跟随变化
3. **新增组件配色错误** — 缺乏清晰的分层规范，新组件不知道该用哪个 token
4. **渲染无层次** — 所有界面是平铺单层结构，缺少背景层+浮动组件的深度感

## 方案：分层 Token + 渐变基底 + 独立主题文件

### 1. 主题文件结构

每个主题一个独立 JSON，放在 `public/themes/` 目录：

```
public/themes/
  manifest.json              ← 内置主题 ID 列表
  aurora-light.json
  aurora-dark.json
  ocean-breeze.json
  sakura.json
  midnight-steel.json
```

`manifest.json`：
```json
["aurora-light", "aurora-dark", "ocean-breeze", "sakura", "midnight-steel"]
```

### 2. Token 三层体系

主题 JSON 内 token 按语义分三层：

**base 层** — 渐变基底（仅 AppLayout 根元素使用）：
- `gradient-from` — 渐变起始色
- `gradient-to` — 渐变终止色
- `gradient-angle` — 渐变角度（度）

**surface 层** — 浮动面板/卡片：
- `bg` — 面板背景（可半透明）
- `bg-solid` — 不透明背景（导航栏等固定元素）
- `elevated` — 面板内嵌区域
- `hover` — 悬停状态
- `input` — 输入框背景
- `border` — 边框（带透明度）
- `shadow` — 面板阴影（CSS box-shadow 值）
- `shadow-lg` — 大阴影

**content 层** — 文字与强调色：
- `accent`, `accent-warm`, `accent-dim`
- `txt`, `txt-sub`, `txt-muted`
- `success`, `warning`, `danger`, `purple`

**chat 层** — 消息气泡：
- `msg-user`, `msg-assistant`, `msg-system`, `msg-tool`

**misc 层** — 杂项：
- `scrollbar`, `scrollbar-hover`, `overlay`, `code-bg`, `selection-bg`, `selection-fg`

### 3. 完整主题示例

```json
{
  "name": "极光白昼",
  "description": "明亮天空上的极光，薄荷白底 + 翡翠绿",
  "base": {
    "gradient-from": "#F0F4F8",
    "gradient-to": "#E8F0E8",
    "gradient-angle": 135
  },
  "surface": {
    "bg": "rgba(255,255,255,0.82)",
    "bg-solid": "#FFFFFF",
    "elevated": "#F1F4F7",
    "hover": "#E8ECF1",
    "input": "#FFFFFF",
    "border": "rgba(226,232,240,0.6)",
    "shadow": "0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)",
    "shadow-lg": "0 4px 12px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.04)"
  },
  "content": {
    "accent": "#10B981",
    "accent-warm": "#F59E0B",
    "accent-dim": "#D1FAE5",
    "txt": "#1E293B",
    "txt-sub": "#475569",
    "txt-muted": "#94A3B8",
    "success": "#10B981",
    "warning": "#F59E0B",
    "danger": "#EF4444",
    "purple": "#8B5CF6"
  },
  "chat": {
    "msg-user": "#EEF4FF",
    "msg-assistant": "#ECFDF5",
    "msg-system": "#FFF8EB",
    "msg-tool": "#F5F3FF"
  },
  "misc": {
    "scrollbar": "#CBD5E1",
    "scrollbar-hover": "#94A3B8",
    "overlay": "rgba(0,0,0,0.2)",
    "code-bg": "#F1F5F9",
    "selection-bg": "#10B981",
    "selection-fg": "#FFFFFF"
  }
}
```

### 4. CSS 变量映射

`applyTheme()` 将主题 JSON 映射到 CSS 变量：

```
--color-base-from       ← base.gradient-from
--color-base-to         ← base.gradient-to
--base-gradient-angle   ← base.gradient-angle

--color-surface         ← surface.bg
--color-surface-solid   ← surface.bg-solid
--color-elevated        ← surface.elevated
--color-hover           ← surface.hover
--color-input           ← surface.input
--color-bdr             ← surface.border
--shadow-surface        ← surface.shadow
--shadow-surface-lg     ← surface.shadow-lg

--color-accent          ← content.accent
--color-txt             ← content.txt
... (其余 content/chat/misc token)
```

`globals.css` 的 `@theme` 块提供 Tailwind v4 占位值，运行时由 `applyTheme()` 覆盖。

### 5. 渲染层次

```
AppLayout (style: linear-gradient from base tokens)
├── TitleBar   (bg-surface-solid, shadow)
├── NavBar     (bg-surface-solid, shadow)
├── Sidebar
│   └── 列表面板 (bg-surface, shadow-surface, rounded-xl, border)
├── MainContent
│   ├── ChatHeader  (bg-surface, shadow-surface, rounded-xl, border)
│   ├── MessageList (bg-surface, shadow-surface, rounded-xl, border)
│   └── ChatInput   (bg-surface, shadow-surface, rounded-xl, border)
├── AgentDetailPanel  (bg-surface, shadow-surface)
└── GroupDetailPanel  (bg-surface, shadow-surface)
```

**基底渲染**：AppLayout 根 div 使用内联 style 渲染渐变：
```tsx
style={{ background: `linear-gradient(${angle}deg, var(--color-base-from), var(--color-base-to))` }}
```

**浮动面板统一模式**：`bg-surface shadow-surface rounded-xl border border-bdr/40`

**导航固定元素**：`bg-surface-solid shadow`（不透明更清晰）

### 6. 组件分类与样式模式

| 类型 | 样式模式 | 例子 |
|---|---|---|
| 基底 | 渐变背景 (inline style) | AppLayout 根元素 |
| 面板 | `bg-surface shadow-surface rounded-xl border border-bdr/40` | Sidebar列表、消息区、设置面板、技能面板 |
| 卡片 | `bg-elevated rounded-lg` | AgentCard、InfoCard、技能元数据 |
| 输入 | `bg-input border-bdr rounded-lg` | 搜索框、textarea |
| 导航 | `bg-surface-solid shadow` | NavBar、TitleBar |

### 7. 旧 token → 新 token 对照

| 旧 (平铺) | 新 (分层) | 说明 |
|---|---|---|
| `bg-base` | 渐变基底 (inline style) | 仅 AppLayout 使用 |
| `bg-surface` | `bg-surface` (可半透明) | 面板/卡片 |
| `bg-elevated` | `bg-elevated` | 不变 |
| `bg-hover` | `bg-hover` | 不变 |
| `bg-input` | `bg-input` | 不变 |
| `bdr` | `bdr` (带透明度) | rgba 替代纯色 |
| `accent/txt 等` | 不变 | |
| 无 | `shadow-surface` / `shadow-surface-lg` | 新增 |

### 8. 硬编码清理规则

- `className="bg-white"` → `bg-surface-solid`
- `style={{ color: "#fff" }}` → CSS 变量
- `style={{ background: "#..." }}` → token 或 CSS 变量
- 例外：`text-white` 用于按钮文字（`bg-accent text-white`）是合理的，不需要改

### 9. 主题导入/导出

**导出**：点击导出按钮 → 生成 JSON 文件 → 浏览器下载，文件名 `cobeing-theme-{id}.json`

**导入**：文件选择器 → JSON 解析 → 校验 → 写入 localStorage → 立即应用

**存储**：
- 内置主题：`public/themes/*.json`（随应用分发）
- 自定义主题：`localStorage` 的 `cobeing-custom-themes`
- 当前选中：`localStorage` 的 `cobeing-theme-id`

**校验必填字段**：
- `name` (string)
- `base.gradient-from`, `base.gradient-to`, `base.gradient-angle`
- `surface.bg`, `surface.bg-solid`, `surface.elevated`, `surface.border`
- `content.accent`, `content.txt`, `content.txt-sub`, `content.txt-muted`

### 10. ThemeStore API

```ts
interface ThemeStore {
  current: string;
  presets: Record<string, ThemePreset>;
  loaded: boolean;

  loadThemes: () => Promise<void>;
  setTheme: (id: string) => void;
  getCurrentPreset: () => ThemePreset | undefined;

  // 新增
  exportTheme: (id: string) => void;
  importTheme: (file: File) => Promise<boolean>;
  deleteCustomTheme: (id: string) => void;
  isCustomTheme: (id: string) => boolean;
}
```

### 11. ThemeSelector UI 改造

- 内置主题：显示标记（不可删除）
- 自定义主题：显示删除按钮
- 新增"导入主题"按钮
- 新增"导出当前主题"按钮

## 涉及文件

**修改**：
- `gui-v2/src/stores/theme.ts` — ThemePreset 类型、applyTheme、loadThemes、新增导入导出方法
- `gui-v2/src/styles/globals.css` — @theme 占位值更新、新增 shadow 变量
- `gui-v2/src/components/shared/ThemeProvider.tsx` — 可能无需改动
- `gui-v2/src/components/layout/AppLayout.tsx` — 基底渐变渲染
- `gui-v2/src/components/layout/NavBar.tsx` — bg-surface-solid
- `gui-v2/src/components/layout/TitleBar.tsx` — bg-surface-solid
- `gui-v2/src/components/layout/Sidebar.tsx` — 面板样式更新
- `gui-v2/src/components/layout/MainContent.tsx` — 移除 bg-bg-base
- `gui-v2/src/components/chat/ChatView.tsx` — 面板样式 + 硬编码清理
- `gui-v2/src/components/chat/GroupChatView.tsx` — 面板样式
- `gui-v2/src/components/chat/GroupMessageBubble.tsx` — 面板样式
- `gui-v2/src/components/chat/ToolCallMessage.tsx` — 硬编码清理
- `gui-v2/src/components/settings/SettingsView.tsx` — 面板样式
- `gui-v2/src/components/settings/ThemeSelector.tsx` — 导入/导出 UI + 自定义主题管理
- `gui-v2/src/components/skill/SkillCenter.tsx` — 面板样式
- `gui-v2/src/components/agent/AgentDetailPanel.tsx` — 面板样式
- `gui-v2/src/components/agent/CreateAgentDialog.tsx` — 硬编码清理
- `gui-v2/src/components/group/GroupDetailPanel.tsx` — 面板样式
- `gui-v2/src/components/group/CreateGroupDialog.tsx` — 硬编码清理
- `gui-v2/src/components/agent/ButlerConfigPanel.tsx` — 面板样式
- 所有 `ui/*.tsx` — 检查硬编码

**新增**：
- `gui-v2/public/themes/manifest.json`
- `gui-v2/public/themes/aurora-light.json`
- `gui-v2/public/themes/aurora-dark.json`
- `gui-v2/public/themes/ocean-breeze.json`
- `gui-v2/public/themes/sakura.json`
- `gui-v2/public/themes/midnight-steel.json`

**删除**：
- `gui-v2/public/themes.json` — 拆分为独立文件后删除
