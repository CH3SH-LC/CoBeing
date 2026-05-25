# 前端主题与渲染方案重设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking tracking.

**Goal:** 将前端从平铺单层渲染改为渐变基底+浮动面板的分层渲染，主题系统从单文件拆分为独立文件，支持导入/导出。

**Architecture:** 三层 Token 体系（base/surface/content），每个主题独立 JSON 文件，AppLayout 用渐变基底，所有面板浮在基底上。ThemeStore 新增导入/导出/删除自定义主题方法。

**Tech Stack:** React 19, Zustand, Tailwind v4 CSS 变量, TypeScript

---

### Task 1: 创建独立主题文件

**Files:**
- Create: `gui-v2/public/themes/manifest.json`
- Create: `gui-v2/public/themes/aurora-light.json`
- Create: `gui-v2/public/themes/aurora-dark.json`
- Create: `gui-v2/public/themes/ocean-breeze.json`
- Create: `gui-v2/public/themes/sakura.json`
- Create: `gui-v2/public/themes/midnight-steel.json`
- Delete: `gui-v2/public/themes.json`

- [ ] **Step 1: 创建 manifest.json**

```json
["aurora-light", "aurora-dark", "ocean-breeze", "sakura", "midnight-steel"]
```

- [ ] **Step 2: 创建 aurora-light.json**

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

- [ ] **Step 3: 创建 aurora-dark.json**

```json
{
  "name": "极光夜空",
  "description": "深空底色上的极光，暗蓝黑 + 翡翠绿",
  "base": {
    "gradient-from": "#08090F",
    "gradient-to": "#0E1018",
    "gradient-angle": 160
  },
  "surface": {
    "bg": "rgba(18,21,30,0.85)",
    "bg-solid": "#12151E",
    "elevated": "#1A1E2C",
    "hover": "#242938",
    "input": "#0F1118",
    "border": "rgba(37,43,59,0.7)",
    "shadow": "0 1px 3px rgba(0,0,0,0.3), 0 1px 2px rgba(0,0,0,0.2)",
    "shadow-lg": "0 4px 12px rgba(0,0,0,0.4), 0 2px 4px rgba(0,0,0,0.3)"
  },
  "content": {
    "accent": "#6EE7B7",
    "accent-warm": "#F0A080",
    "accent-dim": "#2D4A3E",
    "txt": "#E8ECF4",
    "txt-sub": "#9BA4B8",
    "txt-muted": "#5A6278",
    "success": "#6EE7B7",
    "warning": "#FBBF24",
    "danger": "#F87171",
    "purple": "#C4B5FD"
  },
  "chat": {
    "msg-user": "#1C2A3A",
    "msg-assistant": "#141E1A",
    "msg-system": "#1E1A14",
    "msg-tool": "#1A1828"
  },
  "misc": {
    "scrollbar": "#252B3B",
    "scrollbar-hover": "#3A4258",
    "overlay": "rgba(0,0,0,0.6)",
    "code-bg": "#0A0C12",
    "selection-bg": "#6EE7B7",
    "selection-fg": "#0C0E14"
  }
}
```

- [ ] **Step 4: 创建 ocean-breeze.json**

```json
{
  "name": "海风拂面",
  "description": "淡蓝灰底 + 海洋蓝强调，清爽办公风",
  "base": {
    "gradient-from": "#E8F0F8",
    "gradient-to": "#F0F4F0",
    "gradient-angle": 120
  },
  "surface": {
    "bg": "rgba(255,255,255,0.85)",
    "bg-solid": "#FFFFFF",
    "elevated": "#E8EDF2",
    "hover": "#DAE2EA",
    "input": "#FFFFFF",
    "border": "rgba(212,222,232,0.6)",
    "shadow": "0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)",
    "shadow-lg": "0 4px 12px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.04)"
  },
  "content": {
    "accent": "#0EA5E9",
    "accent-warm": "#F97316",
    "accent-dim": "#E0F2FE",
    "txt": "#1E3A5F",
    "txt-sub": "#3B6B9A",
    "txt-muted": "#8BA7C2",
    "success": "#22C55E",
    "warning": "#F97316",
    "danger": "#EF4444",
    "purple": "#A78BFA"
  },
  "chat": {
    "msg-user": "#E0F2FE",
    "msg-assistant": "#F0FDF4",
    "msg-system": "#FFF7ED",
    "msg-tool": "#EFF6FF"
  },
  "misc": {
    "scrollbar": "#B8C9D9",
    "scrollbar-hover": "#8BA7C2",
    "overlay": "rgba(0,0,0,0.18)",
    "code-bg": "#E8EDF2",
    "selection-bg": "#0EA5E9",
    "selection-fg": "#FFFFFF"
  }
}
```

- [ ] **Step 5: 创建 sakura.json**

```json
{
  "name": "樱花和风",
  "description": "暖白底 + 樱花粉强调，柔和日系风",
  "base": {
    "gradient-from": "#FFF8FA",
    "gradient-to": "#FFF5F0",
    "gradient-angle": 145
  },
  "surface": {
    "bg": "rgba(255,255,255,0.85)",
    "bg-solid": "#FFFFFF",
    "elevated": "#FFF5F7",
    "hover": "#FFECEE",
    "input": "#FFFFFF",
    "border": "rgba(245,230,234,0.6)",
    "shadow": "0 1px 3px rgba(0,0,0,0.05), 0 1px 2px rgba(0,0,0,0.03)",
    "shadow-lg": "0 4px 12px rgba(0,0,0,0.06), 0 2px 4px rgba(0,0,0,0.03)"
  },
  "content": {
    "accent": "#EC4899",
    "accent-warm": "#F59E0B",
    "accent-dim": "#FCE7F3",
    "txt": "#44403C",
    "txt-sub": "#78716C",
    "txt-muted": "#A8A29E",
    "success": "#10B981",
    "warning": "#F59E0B",
    "danger": "#EF4444",
    "purple": "#C084FC"
  },
  "chat": {
    "msg-user": "#FFF1F5",
    "msg-assistant": "#F0FDF4",
    "msg-system": "#FFFBEB",
    "msg-tool": "#FDF4FF"
  },
  "misc": {
    "scrollbar": "#E8D5DA",
    "scrollbar-hover": "#C9ADB6",
    "overlay": "rgba(0,0,0,0.15)",
    "code-bg": "#FFF5F7",
    "selection-bg": "#EC4899",
    "selection-fg": "#FFFFFF"
  }
}
```

- [ ] **Step 6: 创建 midnight-steel.json**

```json
{
  "name": "午夜钢铁",
  "description": "深灰底 + 琥珀金强调，专业 IDE 风",
  "base": {
    "gradient-from": "#16171A",
    "gradient-to": "#1A1B1E",
    "gradient-angle": 150
  },
  "surface": {
    "bg": "rgba(33,34,37,0.88)",
    "bg-solid": "#212225",
    "elevated": "#2A2B2F",
    "hover": "#35363B",
    "input": "#18191C",
    "border": "rgba(51,51,54,0.7)",
    "shadow": "0 1px 3px rgba(0,0,0,0.3), 0 1px 2px rgba(0,0,0,0.2)",
    "shadow-lg": "0 4px 12px rgba(0,0,0,0.4), 0 2px 4px rgba(0,0,0,0.3)"
  },
  "content": {
    "accent": "#FBBF24",
    "accent-warm": "#FB923C",
    "accent-dim": "#423006",
    "txt": "#E4E4E7",
    "txt-sub": "#A1A1AA",
    "txt-muted": "#71717A",
    "success": "#4ADE80",
    "warning": "#FBBF24",
    "danger": "#F87171",
    "purple": "#A78BFA"
  },
  "chat": {
    "msg-user": "#1E2A3A",
    "msg-assistant": "#1A2A1E",
    "msg-system": "#2A2518",
    "msg-tool": "#251E30"
  },
  "misc": {
    "scrollbar": "#333336",
    "scrollbar-hover": "#52525B",
    "overlay": "rgba(0,0,0,0.6)",
    "code-bg": "#18191C",
    "selection-bg": "#FBBF24",
    "selection-fg": "#1A1B1E"
  }
}
```

- [ ] **Step 7: 删除旧 themes.json**

删除 `gui-v2/public/themes.json`

- [ ] **Step 8: 提交**

```bash
git add gui-v2/public/themes/
git rm gui-v2/public/themes.json
git commit -m "refactor: split themes.json into independent theme files"
```

---

### Task 2: 更新 ThemePreset 类型和 ThemeStore

**Files:**
- Modify: `gui-v2/src/stores/theme.ts`

- [ ] **Step 1: 重写 ThemePreset 接口和 ThemeStore**

将 `gui-v2/src/stores/theme.ts` 整体重写为：

```ts
import { create } from "zustand";

/* ── Layered theme types ── */

export interface ThemeBase {
  "gradient-from": string;
  "gradient-to": string;
  "gradient-angle": number;
}

export interface ThemeSurface {
  bg: string;
  "bg-solid": string;
  elevated: string;
  hover: string;
  input: string;
  border: string;
  shadow: string;
  "shadow-lg": string;
}

export interface ThemeContent {
  accent: string;
  "accent-warm": string;
  "accent-dim": string;
  txt: string;
  "txt-sub": string;
  "txt-muted": string;
  success: string;
  warning: string;
  danger: string;
  purple: string;
}

export interface ThemeChat {
  "msg-user": string;
  "msg-assistant": string;
  "msg-system": string;
  "msg-tool": string;
}

export interface ThemeMisc {
  scrollbar: string;
  "scrollbar-hover": string;
  overlay: string;
  "code-bg": string;
  "selection-bg": string;
  "selection-fg": string;
}

export interface ThemePreset {
  name: string;
  description?: string;
  base: ThemeBase;
  surface: ThemeSurface;
  content: ThemeContent;
  chat: ThemeChat;
  misc: ThemeMisc;
}

/* ── Validation ── */

const REQUIRED_PATHS = [
  "name",
  "base.gradient-from", "base.gradient-to", "base.gradient-angle",
  "surface.bg", "surface.bg-solid", "surface.elevated", "surface.border",
  "content.accent", "content.txt", "content.txt-sub", "content.txt-muted",
];

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], obj);
}

export function validateTheme(data: unknown): { valid: boolean; missing: string[] } {
  if (!data || typeof data !== "object") return { valid: false, missing: ["(root)"] };
  const missing = REQUIRED_PATHS.filter((p) => !getNestedValue(data as Record<string, unknown>, p));
  return { valid: missing.length === 0, missing };
}

/* ── Store ── */

const STORAGE_KEY = "cobeing-theme-id";
const CUSTOM_KEY = "cobeing-custom-themes";

interface ThemeStore {
  current: string;
  presets: Record<string, ThemePreset>;
  loaded: boolean;

  loadThemes: () => Promise<void>;
  setTheme: (id: string) => void;
  getCurrentPreset: () => ThemePreset | undefined;
  exportTheme: (id: string) => void;
  importTheme: (file: File) => Promise<{ ok: boolean; error?: string }>;
  deleteCustomTheme: (id: string) => void;
  isCustomTheme: (id: string) => boolean;
}

/** Apply a theme preset to :root CSS custom properties */
function applyTheme(preset: ThemePreset) {
  const root = document.documentElement;

  // base layer
  const b = preset.base;
  root.style.setProperty("--color-base-from", b["gradient-from"]);
  root.style.setProperty("--color-base-to", b["gradient-to"]);
  root.style.setProperty("--base-gradient-angle", String(b["gradient-angle"]));

  // surface layer
  const s = preset.surface;
  root.style.setProperty("--color-surface", s.bg);
  root.style.setProperty("--color-surface-solid", s["bg-solid"]);
  root.style.setProperty("--color-elevated", s.elevated);
  root.style.setProperty("--color-hover", s.hover);
  root.style.setProperty("--color-input", s.input);
  root.style.setProperty("--color-bdr", s.border);
  root.style.setProperty("--shadow-surface", s.shadow);
  root.style.setProperty("--shadow-surface-lg", s["shadow-lg"]);

  // content layer
  const c = preset.content;
  root.style.setProperty("--color-accent", c.accent);
  root.style.setProperty("--color-accent-warm", c["accent-warm"]);
  root.style.setProperty("--color-accent-dim", c["accent-dim"]);
  root.style.setProperty("--color-txt", c.txt);
  root.style.setProperty("--color-txt-sub", c["txt-sub"]);
  root.style.setProperty("--color-txt-muted", c["txt-muted"]);
  root.style.setProperty("--color-success", c.success);
  root.style.setProperty("--color-warning", c.warning);
  root.style.setProperty("--color-danger", c.danger);
  root.style.setProperty("--color-purple", c.purple);

  // chat layer
  const ch = preset.chat;
  root.style.setProperty("--color-msg-user", ch["msg-user"]);
  root.style.setProperty("--color-msg-assistant", ch["msg-assistant"]);
  root.style.setProperty("--color-msg-system", ch["msg-system"]);
  root.style.setProperty("--color-msg-tool", ch["msg-tool"]);

  // misc
  const m = preset.misc;
  root.style.setProperty("--app-bg", b["gradient-from"]);
  root.style.setProperty("--app-fg", c.txt);
  root.style.setProperty("--scrollbar", m.scrollbar);
  root.style.setProperty("--scrollbar-hover", m["scrollbar-hover"]);
  root.style.setProperty("--overlay", m.overlay);
  root.style.setProperty("--code-bg", m["code-bg"]);
  root.style.setProperty("--selection-bg", m["selection-bg"]);
  root.style.setProperty("--selection-fg", m["selection-fg"]);
}

export const useThemeStore = create<ThemeStore>((set, get) => ({
  current: "aurora-light",
  presets: {},
  loaded: false,

  loadThemes: async () => {
    try {
      // 1. Load built-in themes via manifest
      const manifestResp = await fetch("/themes/manifest.json");
      const themeIds: string[] = await manifestResp.json();

      const builtIn: Record<string, ThemePreset> = {};
      for (const id of themeIds) {
        try {
          const resp = await fetch(`/themes/${id}.json`);
          builtIn[id] = await resp.json();
        } catch {
          console.warn(`Failed to load theme: ${id}`);
        }
      }

      // 2. Merge custom themes from localStorage
      let custom: Record<string, ThemePreset> = {};
      try {
        custom = JSON.parse(localStorage.getItem(CUSTOM_KEY) || "{}");
      } catch { /* ignore */ }

      const all = { ...builtIn, ...custom };

      // 3. Determine active theme
      const saved = localStorage.getItem(STORAGE_KEY);
      const themeId = saved && all[saved] ? saved : Object.keys(builtIn)[0] || "aurora-light";

      if (all[themeId]) {
        applyTheme(all[themeId]);
      }

      set({ current: themeId, presets: all, loaded: true });
    } catch (err) {
      console.error("Failed to load themes:", err);
      set({ loaded: true });
    }
  },

  setTheme: (id: string) => {
    const { presets } = get();
    const preset = presets[id];
    if (!preset) return;
    applyTheme(preset);
    localStorage.setItem(STORAGE_KEY, id);
    set({ current: id });
  },

  getCurrentPreset: () => {
    const { current, presets } = get();
    return presets[current];
  },

  exportTheme: (id: string) => {
    const preset = get().presets[id];
    if (!preset) return;
    const json = JSON.stringify(preset, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cobeing-theme-${id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  },

  importTheme: async (file: File) => {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const { valid, missing } = validateTheme(data);
      if (!valid) {
        return { ok: false, error: `缺少字段: ${missing.join(", ")}` };
      }
      // Use filename (without .json) as theme ID, or name field
      const id = file.name.replace(/\.json$/, "").replace(/^cobeing-theme-/, "");
      const preset = data as ThemePreset;
      applyTheme(preset);
      const newPresets = { ...get().presets, [id]: preset };
      // Save custom themes
      const builtInIds = await getBuiltInIds();
      const customOnly: Record<string, ThemePreset> = {};
      for (const [k, v] of Object.entries(newPresets)) {
        if (!builtInIds.includes(k)) customOnly[k] = v;
      }
      localStorage.setItem(CUSTOM_KEY, JSON.stringify(customOnly));
      localStorage.setItem(STORAGE_KEY, id);
      set({ current: id, presets: newPresets });
      return { ok: true };
    } catch {
      return { ok: false, error: "文件解析失败，请确认是有效的 JSON 文件" };
    }
  },

  deleteCustomTheme: (id: string) => {
    const { presets, current } = get();
    const newPresets = { ...presets };
    delete newPresets[id];
    // Update localStorage
    const builtInIds = Object.keys(presets).filter((k) => !get().isCustomTheme(k));
    const customOnly: Record<string, ThemePreset> = {};
    for (const [k, v] of Object.entries(newPresets)) {
      if (!builtInIds.includes(k)) customOnly[k] = v;
    }
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(customOnly));
    // If deleting active theme, switch to first built-in
    if (current === id) {
      const firstId = builtInIds[0] || Object.keys(newPresets)[0];
      if (firstId && newPresets[firstId]) {
        applyTheme(newPresets[firstId]);
        localStorage.setItem(STORAGE_KEY, firstId);
        set({ current: firstId, presets: newPresets });
      }
    } else {
      set({ presets: newPresets });
    }
  },

  isCustomTheme: (id: string) => {
    // A theme is custom if it's not loadable from /themes/{id}.json
    // We determine this by checking if the ID exists in the built-in manifest
    // For simplicity, we track built-in IDs at load time
    return !get()._builtInIds?.includes(id);
  },

  // Internal: track built-in theme IDs
  _builtInIds: [] as string[],
}));

/** Helper: re-fetch built-in IDs for custom theme management */
async function getBuiltInIds(): Promise<string[]> {
  try {
    const resp = await fetch("/themes/manifest.json");
    return await resp.json();
  } catch {
    return [];
  }
}
```

注意：上面 store 里的 `loadThemes` 需要在设置 `_builtInIds` 的地方做一个小调整。实际实现中，`loadThemes` 的 set 调用应为：

```ts
set({ current: themeId, presets: all, loaded: true, _builtInIds: Object.keys(builtIn) });
```

同时 `ThemeStore` interface 末尾加上：

```ts
_builtInIds: string[];
```

- [ ] **Step 2: 验证构建通过**

Run: `cd D:/agent-codes/cobeing/gui-v2 && npx tsc --noEmit 2>&1 | head -20`
Expected: 无类型错误（注意 import ThemePreset 的其他文件可能报错，下一步修复）

- [ ] **Step 3: 提交**

```bash
git add gui-v2/src/stores/theme.ts
git commit -m "refactor: rewrite ThemeStore with layered token types and import/export"
```

---

### Task 3: 更新 globals.css

**Files:**
- Modify: `gui-v2/src/styles/globals.css`

- [ ] **Step 1: 重写 globals.css**

将 `gui-v2/src/styles/globals.css` 替换为：

```css
@import "tailwindcss";

/* ── Tailwind v4 @theme — placeholder values for class generation.
   Actual values are injected at runtime by ThemeStore.applyTheme().
   These are fallbacks only. ── */

@theme {
  /* base layer */
  --color-base-from: #F0F4F8;
  --color-base-to: #E8F0E8;

  /* surface layer */
  --color-surface: rgba(255,255,255,0.82);
  --color-surface-solid: #FFFFFF;
  --color-elevated: #F1F4F7;
  --color-hover: #E8ECF1;
  --color-input: #FFFFFF;
  --color-bdr: rgba(226,232,240,0.6);

  /* content layer */
  --color-accent: #10B981;
  --color-accent-warm: #F59E0B;
  --color-accent-dim: #D1FAE5;

  --color-msg-user: #EEF4FF;
  --color-msg-assistant: #ECFDF5;
  --color-msg-system: #FFF8EB;
  --color-msg-tool: #F5F3FF;

  --color-txt: #1E293B;
  --color-txt-sub: #475569;
  --color-txt-muted: #94A3B8;

  --color-success: #10B981;
  --color-warning: #F59E0B;
  --color-danger: #EF4444;
  --color-purple: #8B5CF6;

  --font-display: "Space Grotesk", sans-serif;
  --font-body: "Noto Sans SC", system-ui, sans-serif;
  --font-mono: "JetBrains Mono", monospace;
}

/* ── Runtime CSS variables (set by ThemeStore) ── */
:root {
  --app-bg: #F0F4F8;
  --app-fg: #1E293B;
  --base-gradient-angle: 135;
  --scrollbar: #CBD5E1;
  --scrollbar-hover: #94A3B8;
  --overlay: rgba(0,0,0,0.2);
  --code-bg: #F1F5F9;
  --selection-bg: #10B981;
  --selection-fg: #FFFFFF;
  --shadow-surface: 0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04);
  --shadow-surface-lg: 0 4px 12px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.04);
}

/* ── Global Reset ── */
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body, #root {
  height: 100%;
  overflow: hidden;
  background: var(--app-bg);
  color: var(--app-fg);
  font-family: var(--font-body);
  transition: background-color 0.3s, color 0.3s;
}

/* ── Scrollbar ── */
::-webkit-scrollbar {
  width: 6px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: var(--scrollbar);
  border-radius: 3px;
}
::-webkit-scrollbar-thumb:hover {
  background: var(--scrollbar-hover);
}

/* ── Selection ── */
::selection {
  background: var(--selection-bg);
  color: var(--selection-fg);
}

/* ── Focus ring ── */
:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

/* ── Code blocks ── */
.msg-content pre {
  background: var(--code-bg);
  border: 1px solid var(--color-bdr);
  border-radius: 8px;
  padding: 12px;
  overflow-x: auto;
  margin: 8px 0;
  font-family: var(--font-mono);
  font-size: 13px;
}

.msg-content code {
  font-family: var(--font-mono);
  font-size: 13px;
}

.msg-content :not(pre) > code {
  background: var(--code-bg);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 12px;
}

.msg-content p {
  margin: 4px 0;
  line-height: 1.6;
}

.msg-content ul, .msg-content ol {
  padding-left: 20px;
  margin: 4px 0;
}

.msg-content table {
  border-collapse: collapse;
  margin: 8px 0;
  width: 100%;
}
.msg-content th, .msg-content td {
  border: 1px solid var(--color-bdr);
  padding: 6px 10px;
  text-align: left;
}
.msg-content th {
  background: var(--code-bg);
}

.hljs {
  background: transparent !important;
}

/* ── highlight.js atom-one-dark theme (code blocks) ── */
.code-block-pre .hljs {
  background: transparent !important;
  color: #abb2bf;
}
.code-block-pre .hljs-comment,
.code-block-pre .hljs-quote { color: #5c6370; font-style: italic; }
.code-block-pre .hljs-doctag,
.code-block-pre .hljs-keyword,
.code-block-pre .hljs-formula { color: #c678dd; }
.code-block-pre .hljs-section,
.code-block-pre .hljs-name,
.code-block-pre .hljs-selector-tag,
.code-block-pre .hljs-deletion,
.code-block-pre .hljs-subst { color: #e06c75; }
.code-block-pre .hljs-literal { color: #56b6c2; }
.code-block-pre .hljs-string,
.code-block-pre .hljs-regexp,
.code-block-pre .hljs-addition,
.code-block-pre .hljs-attribute,
.code-block-pre .hljs-meta .hljs-string { color: #98c379; }
.code-block-pre .hljs-attr,
.code-block-pre .hljs-variable,
.code-block-pre .hljs-template-variable,
.code-block-pre .hljs-type,
.code-block-pre .hljs-selector-class,
.code-block-pre .hljs-selector-attr,
.code-block-pre .hljs-selector-pseudo,
.code-block-pre .hljs-number { color: #d19a66; }
.code-block-pre .hljs-symbol,
.code-block-pre .hljs-bullet,
.code-block-pre .hljs-link,
.code-block-pre .hljs-meta,
.code-block-pre .hljs-selector-id,
.code-block-pre .hljs-title { color: #61aeee; }
.code-block-pre .hljs-built_in,
.code-block-pre .hljs-title.class_,
.code-block-pre .hljs-class .hljs-title { color: #e6c07b; }
.code-block-pre .hljs-emphasis { font-style: italic; }
.code-block-pre .hljs-strong { font-weight: bold; }
.code-block-pre .hljs-link { text-decoration: underline; }
```

- [ ] **Step 2: 提交**

```bash
git add gui-v2/src/styles/globals.css
git commit -m "refactor: update globals.css with layered token placeholders and shadow variables"
```

---

### Task 4: 改造 AppLayout 基底渲染

**Files:**
- Modify: `gui-v2/src/components/layout/AppLayout.tsx`

- [ ] **Step 1: 重写 AppLayout.tsx**

```tsx
import { TitleBar } from "./TitleBar";
import { NavBar } from "./NavBar";
import { Sidebar } from "./Sidebar";
import { MainContent } from "./MainContent";
import { AgentDetailPanel } from "@/components/agent/AgentDetailPanel";
import { GroupDetailPanel } from "@/components/group/GroupDetailPanel";
import { ButlerConfigPanel } from "@/components/agent/ButlerConfigPanel";

export function AppLayout() {
  return (
    <div
      className="flex flex-col h-screen w-screen overflow-hidden text-txt font-body"
      style={{
        background: `linear-gradient(var(--base-gradient-angle, 135deg), var(--color-base-from), var(--color-base-to))`,
      }}
    >
      <TitleBar />
      <div className="flex flex-1 min-h-0 gap-0">
        <NavBar />
        <Sidebar />
        <MainContent />
        <AgentDetailPanel />
        <GroupDetailPanel />
        <ButlerConfigPanel />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 提交**

```bash
git add gui-v2/src/components/layout/AppLayout.tsx
git commit -m "feat: AppLayout uses gradient base layer instead of flat bg"
```

---

### Task 5: 改造 NavBar 和 TitleBar

**Files:**
- Modify: `gui-v2/src/components/layout/NavBar.tsx`
- Modify: `gui-v2/src/components/layout/TitleBar.tsx`

- [ ] **Step 1: 更新 NavBar.tsx — 用 bg-surface-solid + shadow**

将 NavBar 的 `<nav>` className 从：
```
w-14 h-full flex flex-col items-center py-4 gap-1.5 bg-bg-surface shrink-0
```
改为：
```
w-14 h-full flex flex-col items-center py-4 gap-1.5 bg-surface-solid shrink-0 border-r border-bdr/30
```
style 加上 shadow：
```tsx
style={{ boxShadow: "var(--shadow-surface)" }}
```

- [ ] **Step 2: 更新 TitleBar.tsx — 用 bg-surface-solid**

TitleBar 的 `<div>` className 从：
```
relative h-10 flex items-center justify-center bg-bg-surface shrink-0 select-none border-b border-bdr/50
```
改为：
```
relative h-10 flex items-center justify-center bg-surface-solid shrink-0 select-none border-b border-bdr/30
```

- [ ] **Step 3: 提交**

```bash
git add gui-v2/src/components/layout/NavBar.tsx gui-v2/src/components/layout/TitleBar.tsx
git commit -m "feat: NavBar and TitleBar use surface-solid with shadow"
```

---

### Task 6: 改造 Sidebar 和 MainContent

**Files:**
- Modify: `gui-v2/src/components/layout/Sidebar.tsx`
- Modify: `gui-v2/src/components/layout/MainContent.tsx`

- [ ] **Step 1: 更新 Sidebar.tsx**

将列表面板容器从：
```
flex-1 rounded-xl bg-bg-surface overflow-hidden
```
改为：
```
flex-1 rounded-xl bg-surface overflow-hidden border border-bdr/40
```
加上 style：
```tsx
style={{ boxShadow: "var(--shadow-surface)" }}
```

搜索框 className 中的 `bg-bg-surface` 改为 `bg-surface-solid`。

AgentCard 中的 `bg-bg-base` 改为 `bg-surface-solid`。

- [ ] **Step 2: 更新 MainContent.tsx**

移除所有 `<main>` 上的 `bg-bg-base`（基底渐变由 AppLayout 提供，main 不需要背景色）。三个 `<main>` 的 className 统一改为：
```
flex-1 h-full flex flex-col min-w-0
```

- [ ] **Step 3: 提交**

```bash
git add gui-v2/src/components/layout/Sidebar.tsx gui-v2/src/components/layout/MainContent.tsx
git commit -m "feat: Sidebar and MainContent use layered rendering"
```

---

### Task 7: 改造 ChatView 和 GroupChatView

**Files:**
- Modify: `gui-v2/src/components/chat/ChatView.tsx`
- Modify: `gui-v2/src/components/chat/GroupChatView.tsx`
- Modify: `gui-v2/src/components/chat/ToolCallMessage.tsx`
- Modify: `gui-v2/src/components/chat/GroupMessageBubble.tsx`

- [ ] **Step 1: 更新 ChatView.tsx**

ChatHeader 容器从：
```
flex items-center rounded-xl bg-bg-surface shrink-0
```
改为：
```
flex items-center rounded-xl bg-surface shrink-0 border border-bdr/40
```
加上 `style={{ boxShadow: "var(--shadow-surface)" }}`

MessageList 空状态和有消息时的容器从 `bg-bg-surface` 改为 `bg-surface`，都加上 `border border-bdr/40` 和 `style={{ boxShadow: "var(--shadow-surface)" }}`。

ChatInput 外层容器从 `bg-bg-surface` 改为 `bg-surface`，加上 `border border-bdr/40` 和 shadow。

弹出菜单（技能选择、@提及）从 `bg-bg-elevated` 改为 `bg-elevated`。

- [ ] **Step 2: 更新 GroupChatView.tsx**

同理，所有 `bg-bg-surface` → `bg-surface`，加 shadow/border。
所有 `bg-bg-elevated` → `bg-elevated`。
所有 `bg-bg-input` → `bg-input`。

- [ ] **Step 3: 更新 ToolCallMessage.tsx**

检查并替换所有硬编码颜色。`bg-bg-surface` → `bg-surface`，`bg-bg-elevated` → `bg-elevated`。

- [ ] **Step 4: 更新 GroupMessageBubble.tsx**

同上模式。

- [ ] **Step 5: 提交**

```bash
git add gui-v2/src/components/chat/
git commit -m "feat: chat components use layered rendering with shadow panels"
```

---

### Task 8: 改造 Settings、Skill、Agent、Group 组件

**Files:**
- Modify: `gui-v2/src/components/settings/SettingsView.tsx`
- Modify: `gui-v2/src/components/settings/ThemeSelector.tsx`
- Modify: `gui-v2/src/components/skill/SkillCenter.tsx`
- Modify: `gui-v2/src/components/agent/AgentDetailPanel.tsx`
- Modify: `gui-v2/src/components/agent/ButlerConfigPanel.tsx`
- Modify: `gui-v2/src/components/group/GroupDetailPanel.tsx`
- Modify: `gui-v2/src/components/group/GroupMembersTab.tsx`
- Modify: `gui-v2/src/components/group/GroupConfigTab.tsx`
- Modify: `gui-v2/src/components/group/GroupWorkspaceTab.tsx`
- Modify: `gui-v2/src/components/agent/AgentConfigTab.tsx`
- Modify: `gui-v2/src/components/agent/AgentFilesTab.tsx`
- Modify: `gui-v2/src/components/agent/CreateAgentDialog.tsx`
- Modify: `gui-v2/src/components/group/CreateGroupDialog.tsx`

- [ ] **Step 1: 全局替换旧 token 名称**

在所有上述文件中执行替换：
- `bg-bg-surface` → `bg-surface`
- `bg-bg-elevated` → `bg-elevated`
- `bg-bg-hover` → `bg-hover`
- `bg-bg-input` → `bg-input`
- `bg-bg-base` → `bg-surface-solid`（用于非 AppLayout 的基底元素）
- `border-bdr` → `border-bdr`（保持不变，但检查是否有硬编码边框色）

- [ ] **Step 2: 面板容器加 shadow**

所有作为独立面板的容器（Settings 左右面板、Skill 左右面板、DetailPanel 等），在 className 中加 `border border-bdr/40`，并加 `style={{ boxShadow: "var(--shadow-surface)" }}`。

- [ ] **Step 3: 清理硬编码颜色**

搜索所有文件中的 `bg-white`、`text-white`、`#fff`、`#FFF`、`#ffffff` 等硬编码颜色。
- `bg-white` → `bg-surface-solid`（背景用）
- `text-white` 在按钮上（如 `bg-accent text-white`）保留不变

- [ ] **Step 4: 提交**

```bash
git add gui-v2/src/components/settings/ gui-v2/src/components/skill/ gui-v2/src/components/agent/ gui-v2/src/components/group/
git commit -m "feat: all panels use layered rendering, remove hardcoded colors"
```

---

### Task 9: 改造 UI 基础组件

**Files:**
- Modify: `gui-v2/src/components/ui/button.tsx`
- Modify: `gui-v2/src/components/ui/dialog.tsx`
- Modify: `gui-v2/src/components/ui/sheet.tsx`
- Modify: `gui-v2/src/components/ui/switch.tsx`
- Modify: `gui-v2/src/components/ui/tabs.tsx`

- [ ] **Step 1: 检查并修复每个 UI 组件**

逐个读取每个 UI 文件，将其中所有硬编码颜色替换为 CSS 变量 token。常见模式：
- `bg-white` → `bg-surface-solid`
- `bg-background` → `bg-surface-solid`
- `text-foreground` → `text-txt`
- `border-border` → `border-bdr`
- `bg-muted` → `bg-elevated`
- 任何 `hsl(...)` 或 `#...` 硬编码值 → 对应的 CSS 变量

- [ ] **Step 2: 提交**

```bash
git add gui-v2/src/components/ui/
git commit -m "refactor: UI base components use theme tokens, remove hardcoded colors"
```

---

### Task 10: 更新 ThemeSelector 支持导入/导出

**Files:**
- Modify: `gui-v2/src/components/settings/ThemeSelector.tsx`

- [ ] **Step 1: 重写 ThemeSelector.tsx**

```tsx
import { useThemeStore } from "@/stores/theme";
import { cn } from "@/lib/utils";
import { useRef, useState } from "react";

export function ThemeSelector() {
  const current = useThemeStore((s) => s.current);
  const presets = useThemeStore((s) => s.presets);
  const setTheme = useThemeStore((s) => s.setTheme);
  const exportTheme = useThemeStore((s) => s.exportTheme);
  const importTheme = useThemeStore((s) => s.importTheme);
  const deleteCustomTheme = useThemeStore((s) => s.deleteCustomTheme);
  const isCustomTheme = useThemeStore((s) => s.isCustomTheme);

  const fileRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState(false);

  const entries = Object.entries(presets);

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError(null);
    setImportSuccess(false);
    const result = await importTheme(file);
    if (result.ok) {
      setImportSuccess(true);
      setTimeout(() => setImportSuccess(false), 3000);
    } else {
      setImportError(result.error || "导入失败");
    }
    // Reset input so same file can be re-imported
    e.target.value = "";
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs text-txt-muted font-medium">选择主题</div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => exportTheme(current)}
            className="px-2.5 py-1 rounded-lg bg-elevated text-[11px] text-txt-sub hover:bg-hover transition-colors"
          >
            导出当前
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            className="px-2.5 py-1 rounded-lg bg-accent/10 text-accent text-[11px] font-medium hover:bg-accent/20 transition-colors"
          >
            导入主题
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json"
            onChange={handleImport}
            className="hidden"
          />
        </div>
      </div>

      {importError && (
        <div className="px-3 py-2 rounded-lg bg-danger/10 text-danger text-xs">{importError}</div>
      )}
      {importSuccess && (
        <div className="px-3 py-2 rounded-lg bg-success/10 text-success text-xs">主题导入成功</div>
      )}

      <div className="grid grid-cols-1 gap-2">
        {entries.map(([id, preset]) => {
          const active = current === id;
          const custom = isCustomTheme(id);
          const s = preset.surface;
          const c = preset.content;

          return (
            <div key={id} className="flex items-stretch gap-2">
              <button
                onClick={() => setTheme(id)}
                className={cn(
                  "flex-1 flex items-center gap-4 p-3 rounded-xl transition-all text-left border",
                  active
                    ? "border-accent/50 shadow-[var(--shadow-surface)]"
                    : "border-transparent hover:shadow-[var(--shadow-surface)]"
                )}
                style={{
                  backgroundColor: s["bg-solid"],
                }}
              >
                {/* Color preview strip */}
                <div className="flex shrink-0 rounded-lg overflow-hidden" style={{ width: 48, height: 48 }}>
                  <div style={{ width: 12, height: 48, backgroundColor: preset.base["gradient-from"] }} />
                  <div style={{ width: 12, height: 48, backgroundColor: s["bg-solid"] }} />
                  <div style={{ width: 12, height: 48, backgroundColor: c.accent }} />
                  <div style={{ width: 12, height: 48, backgroundColor: c.purple }} />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium" style={{ color: c.txt }}>
                      {preset.name}
                    </span>
                    {active && (
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                        style={{ backgroundColor: c.accent, color: "#FFFFFF" }}
                      >
                        当前
                      </span>
                    )}
                    {custom && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-elevated text-txt-muted font-medium">
                        自定义
                      </span>
                    )}
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: c["txt-muted"] }}>
                    {preset.description || "用户导入的主题"}
                  </div>
                </div>

                {/* Preview dots */}
                <div className="flex gap-1 shrink-0">
                  {[c.accent, c.purple, c.danger, c.warning, c.success].map((color, i) => (
                    <div
                      key={i}
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </button>

              {/* Delete button for custom themes */}
              {custom && (
                <button
                  onClick={(e) => { e.stopPropagation(); deleteCustomTheme(id); }}
                  className="px-2 rounded-lg text-txt-muted hover:bg-danger/10 hover:text-danger transition-colors text-xs"
                  title="删除主题"
                >
                  ✕
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 提交**

```bash
git add gui-v2/src/components/settings/ThemeSelector.tsx
git commit -m "feat: ThemeSelector supports import/export and custom theme management"
```

---

### Task 11: 最终验证与清理

**Files:**
- Modify: `gui-v2/STRUCTURE.md`（如存在则同步更新）

- [ ] **Step 1: 全局搜索残留硬编码颜色**

在 `gui-v2/src/` 中搜索以下模式，确认无遗漏：
- `bg-white`（应全部替换为 `bg-surface-solid`）
- `text-white`（按钮上的保留，其他替换）
- `#fff` / `#FFF` / `#ffffff` / `#FFFFFF`
- `rgb(` / `rgba(` （仅限内联 style 中的硬编码，CSS 变量中的保留）

Run: `grep -rn "bg-white\|#fff\|#FFF\b\|#ffffff" gui-v2/src/ --include="*.tsx" --include="*.ts"`

- [ ] **Step 2: 验证构建**

Run: `cd D:/agent-codes/cobeing/gui-v2 && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 3: 验证开发服务器**

Run: `cd D:/agent-codes/cobeing/gui-v2 && npm run dev`
打开浏览器检查：
1. 默认主题（极光白昼）显示渐变基底 + 浮动面板
2. 切换到暗色主题，颜色全部正确跟随
3. 切换到其他主题，渐变基底变化
4. 设置页面导入/导出按钮可用

- [ ] **Step 4: 更新 STRUCTURE.md（如需要）**

同步文件结构变化：新增 `public/themes/` 目录、删除 `public/themes.json`。

- [ ] **Step 5: 最终提交**

```bash
git add -A
git commit -m "chore: final cleanup and STRUCTURE.md sync for theme rendering redesign"
```
