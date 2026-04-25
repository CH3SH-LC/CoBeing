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
  divider: string;
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
  _builtInIds: string[];

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
  root.style.setProperty("--color-divider", m.divider);
}

async function fetchBuiltInIds(): Promise<string[]> {
  try {
    const resp = await fetch("/themes/manifest.json");
    return await resp.json();
  } catch {
    return [];
  }
}

export const useThemeStore = create<ThemeStore>((set, get) => ({
  current: "aurora-light",
  presets: {},
  loaded: false,
  _builtInIds: [],

  loadThemes: async () => {
    try {
      // 1. Load built-in themes via manifest
      const themeIds = await fetchBuiltInIds();

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

      set({ current: themeId, presets: all, loaded: true, _builtInIds: Object.keys(builtIn) });
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
      const id = file.name.replace(/\.json$/, "").replace(/^cobeing-theme-/, "");
      const preset = data as ThemePreset;
      applyTheme(preset);
      const newPresets = { ...get().presets, [id]: preset };
      // Save custom themes only
      const builtInIds = get()._builtInIds;
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
    const { presets, current, _builtInIds } = get();
    const newPresets = { ...presets };
    delete newPresets[id];
    // Update custom themes in localStorage
    const customOnly: Record<string, ThemePreset> = {};
    for (const [k, v] of Object.entries(newPresets)) {
      if (!_builtInIds.includes(k)) customOnly[k] = v;
    }
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(customOnly));
    // If deleting active theme, switch to first built-in
    if (current === id) {
      const firstId = _builtInIds[0] || Object.keys(newPresets)[0];
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
    return !get()._builtInIds.includes(id);
  },
}));
