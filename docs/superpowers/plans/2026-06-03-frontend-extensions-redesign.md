# 前端扩展系统重设计 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重组前端 GUI：新增扩展页面（技能/MCPs/插件三Tab）、侧栏重排、仪表盘重设计、设置页精简、关于页美化 + 版本号动态获取。

**Architecture:** 分 7 个阶段顺序推进：类型&Store 基础 → 后端 API → 新组件 → 布局导航 → 仪表盘 → 设置 → 清理验证。每个阶段以 `pnpm build` + `pnpm test` + `gui-v2 tsc --noEmit` 验证。

**Tech Stack:** React 18 + TypeScript + Zustand + Tailwind CSS + WebSocket

---

## File Structure Map

```
gui-v2/src/
├── lib/types.ts                    [MODIFY] ViewType, ExtensionsTab, PluginInfo.configSchema
├── stores/
│   ├── settings.ts                  [MODIFY] SettingsSection remove usage/mcp
│   ├── extensions.ts                [CREATE] activeTab, selectedItem UI state
│   ├── plugins.ts                   [MODIFY] PluginInfo add configSchema
│   └── observability.ts            [MODIFY] add usage fields
├── components/
│   ├── extensions/                  [CREATE dir]
│   │   ├── ExtensionsView.tsx       [CREATE] Tab container + 3-column layout
│   │   ├── SkillsTab.tsx           [CREATE] Migrate from SkillCenter
│   │   ├── McpsTab.tsx             [CREATE] Migrate from McpSection
│   │   └── PluginsTab.tsx          [CREATE] New plugin management
│   ├── layout/
│   │   ├── NavBar.tsx              [MODIFY] New NAV_ITEMS order
│   │   └── MainContent.tsx         [MODIFY] Add extensions route, remove skills
│   ├── observability/
│   │   ├── DashboardView.tsx       [MODIFY] Centered card layout + usage merge
│   │   ├── TokenCard.tsx           [MODIFY] Centered style
│   │   └── LatencyCard.tsx         [MODIFY] Centered style
│   └── settings/
│       └── SettingsView.tsx        [MODIFY] Remove usage/mcp, new AboutSection
├── hooks/
│   └── useWebSocket.ts             [MODIFY] toggle_plugin/config handlers
│
packages/core/src/
├── api/ws-server.ts                [MODIFY] get_config+version, toggle_plugin, update_plugin_config
└── runtime.ts                      [MODIFY] getConfig() +version
```

---

### Task 1: 类型定义更新

**Files:**
- Modify: `CoBeing/gui-v2/src/lib/types.ts`
- Modify: `CoBeing/gui-v2/src/stores/settings.ts`
- Modify: `CoBeing/gui-v2/src/stores/plugins.ts`

- [ ] **Step 1: 更新 types.ts — ViewType, ExtensionsTab, PluginInfo.configSchema**

Edit `CoBeing/gui-v2/src/lib/types.ts` line 3:

```typescript
// Replace line 3:
// export type ViewType = "butler" | "agents" | "groups" | "skills" | "settings" | "dashboard";
// With:
export type ViewType = "butler" | "agents" | "groups" | "dashboard" | "extensions" | "settings";
```

Add after the ViewType line (around line 4):

```typescript
export type ExtensionsTab = "skills" | "mcps" | "plugins";
```

Find `PluginInfo` (should already be defined around line 60-80; if not, add the new field):

Add to PluginInfo interface (after `config?:` line):

```typescript
  configSchema?: {
    fields?: Array<{ key: string; label: string; type: string; secret?: boolean }>;
    features?: Array<{ key: string; label: string; desc?: string }>;
  };
```

- [ ] **Step 2: 更新 settings.ts — 移除 usage/mcp**

Edit `CoBeing/gui-v2/src/stores/settings.ts` line 4:

```typescript
// Replace line 4:
// export type SettingsSection = "general" | "theme" | "providers" | "channels" | "mcp" | "sandbox" | "usage" | "logs" | "search" | "export" | "about" | `plugin:${string}`;
// With:
export type SettingsSection = "general" | "theme" | "providers" | "channels" | "sandbox" | "logs" | "search" | "export" | "about" | `plugin:${string}`;
```

- [ ] **Step 3: 验证类型编译**

Run: `cd CoBeing\gui-v2; npx tsc --noEmit`
Expected: No errors (may have pre-existing errors in unrelated files — confirm no NEW errors in types.ts, settings.ts, plugins.ts)

- [ ] **Step 4: 创建 extensions store**

Create `CoBeing/gui-v2/src/stores/extensions.ts`:

```typescript
import { create } from "zustand";
import type { ExtensionsTab } from "@/lib/types";

interface ExtensionsStore {
  activeTab: ExtensionsTab;
  selectedItem: string | null;
  searchQuery: string;

  setActiveTab: (tab: ExtensionsTab) => void;
  setSelectedItem: (id: string | null) => void;
  setSearchQuery: (q: string) => void;
}

export const useExtensionsStore = create<ExtensionsStore>((set) => ({
  activeTab: "skills",
  selectedItem: null,
  searchQuery: "",

  setActiveTab: (tab) => set({ activeTab: tab, selectedItem: null, searchQuery: "" }),
  setSelectedItem: (id) => set({ selectedItem: id }),
  setSearchQuery: (q) => set({ searchQuery: q }),
}));
```

- [ ] **Step 5: 验证**

Run: `cd CoBeing\gui-v2; npx tsc --noEmit`
Expected: No new errors

---

### Task 2: 后端 API 新增端点

**Files:**
- Modify: `CoBeing/packages/core/src/api/ws-server.ts`
- Modify: `CoBeing/packages/core/src/runtime.ts`

- [ ] **Step 1: get_config 响应新增 version 字段**

Edit `CoBeing/packages/core/src/runtime.ts`. Find `getConfig()` method. Add:

```typescript
getConfig(): Record<string, unknown> {
  // ... existing code ...
  const result = { /* existing config */ };
  // Add version
  try {
    const pkgPath = path.resolve(this.rootDir, "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    result.version = pkg.version ?? "0.0.0";
  } catch {
    result.version = "0.0.0";
  }
  return result;
}
```

Open `CoBeing/packages/core/src/runtime.ts` and find the `getConfig()` method (search for `getConfig()`). Find the `return` statement at the end of the method. Before the return, read the root `package.json` and inject `version` into the returned object. Example pattern:

```typescript
// At end of getConfig(), before the return:
let version = "0.0.0";
try {
  const pkgPath = path.resolve(this.rootDir, "package.json");
  version = JSON.parse(fs.readFileSync(pkgPath, "utf-8")).version ?? "0.0.0";
} catch { /* keep default */ }

return {
  ...existingConfig,
  version,
};
```

- [ ] **Step 2: 新增 toggle_plugin WS handler**

In `CoBeing/packages/core/src/api/ws-server.ts`, add a new case in the message switch statement (near the other plugin cases around line ~339):

```typescript
case "toggle_plugin": {
  const { pluginId, enabled } = p as { pluginId: string; enabled: boolean };
  if (!pluginId || typeof enabled !== "boolean") {
    sendError("缺少 pluginId 或 enabled");
    return;
  }
  const registryPath = path.join(this.dataRoot, "plugins", "registry.json");
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
  if (!registry.plugins[pluginId]) {
    sendError(`插件 ${pluginId} 不存在`);
    return;
  }
  registry.plugins[pluginId].enabled = enabled;
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2), "utf-8");
  send({ type: "plugin_toggled", payload: { pluginId, enabled } });
  break;
}
```

- [ ] **Step 3: 新增 update_plugin_config WS handler**

```typescript
case "update_plugin_config": {
  const { pluginId, config } = p as { pluginId: string; config: Record<string, unknown> };
  if (!pluginId || !config) {
    sendError("缺少 pluginId 或 config");
    return;
  }
  const registryPath = path.join(this.dataRoot, "plugins", "registry.json");
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
  if (!registry.plugins[pluginId]) {
    sendError(`插件 ${pluginId} 不存在`);
    return;
  }
  registry.plugins[pluginId].config = config;
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2), "utf-8");
  send({ type: "plugin_config_updated", payload: { pluginId, config } });
  break;
}
```

- [ ] **Step 4: list_plugins 扩充 configSchema**

Find the `listPlugins()` private method in ws-server.ts (around line 2257). In the loop that builds `PluginInfo` objects, add reading `configSchema` from manifest:

```typescript
// Inside listPlugins(), where PluginInfo is assembled:
const manifestPath = path.join(entry.dir, "cobeing.plugin.json");
let configSchema = undefined;
try {
  const manifestRaw = fs.readFileSync(manifestPath, "utf-8");
  const manifest = JSON.parse(manifestRaw);
  configSchema = manifest.configSchema ?? undefined;
} catch { /* no configSchema */ }

const info: PluginInfo = {
  // ... existing fields ...
  configSchema,  // ADD THIS
};
```

- [ ] **Step 5: 构建验证**

Run: `cd CoBeing; pnpm build`
Expected: 7 packages build successfully

- [ ] **Step 6: 测试验证**

Run: `cd CoBeing; pnpm test`
Expected: 417 tests pass

---

### Task 3: 侧栏导航更新

**Files:**
- Modify: `CoBeing/gui-v2/src/components/layout/NavBar.tsx`
- Modify: `CoBeing/gui-v2/src/components/layout/MainContent.tsx`

- [ ] **Step 1: 更新 NavBar.tsx 的 NAV_ITEMS**

Edit `CoBeing/gui-v2/src/components/layout/NavBar.tsx` lines 7-13:

```typescript
// Replace:
// const NAV_ITEMS: { icon: string; view: ViewType; label: string }[] = [
//   { icon: "🤖", view: "butler", label: "管家" },
//   { icon: "👤", view: "agents", label: "智能体" },
//   { icon: "👥", view: "groups", label: "群组" },
//   { icon: "⚡", view: "skills", label: "技能" },
//   { icon: "📊", view: "dashboard", label: "仪表盘" },
//   { icon: "⚙️", view: "settings", label: "设置" },
// ];

// With:
const NAV_ITEMS: { icon: string; view: ViewType; label: string }[] = [
  { icon: "🤖", view: "butler", label: "管家" },
  { icon: "👤", view: "agents", label: "智能体" },
  { icon: "👥", view: "groups", label: "群组" },
  { icon: "📊", view: "dashboard", label: "仪表盘" },
  { icon: "🧩", view: "extensions", label: "扩展" },
  { icon: "⚙️", view: "settings", label: "设置" },
];
```

- [ ] **Step 2: 更新 MainContent.tsx 路由**

Edit `CoBeing/gui-v2/src/components/layout/MainContent.tsx`:

Line 9 — remove SkillCenter import:
```typescript
// DELETE: import { SkillCenter } from "@/components/skill/SkillCenter";
```

Line 10 — add ExtensionsView import:
```typescript
import { ExtensionsView } from "@/components/extensions/ExtensionsView";
```

Lines 70-75 — update the skills/dashboard/settings block:
```typescript
  // Extensions, Dashboard, and Settings: self-contained layouts
  return (
    <main className="flex-1 h-full flex flex-col min-w-0 min-h-0 overflow-hidden">
      {activeView === "extensions" && <ExtensionsView />}
      {activeView === "dashboard" && <DashboardView />}
      {activeView === "settings" && <SettingsView />}
    </main>
  );
```

- [ ] **Step 3: 创建 ExtensionsView 骨架（确保编译通过）**

Create `CoBeing/gui-v2/src/components/extensions/ExtensionsView.tsx` (placeholder):

```typescript
export function ExtensionsView() {
  return (
    <div className="flex-1 h-full flex items-center justify-center">
      <p className="text-txt-muted text-sm">扩展页面 — 施工中</p>
    </div>
  );
}
```

- [ ] **Step 4: 验证**

Run: `cd CoBeing\gui-v2; npx tsc --noEmit`
Expected: No new errors. MainContent imports resolve.

---

### Task 4: ExtensionsView — 主容器 + Tab 栏 + 3 栏布局

**Files:**
- Modify: `CoBeing/gui-v2/src/components/extensions/ExtensionsView.tsx` (replace placeholder)

- [ ] **Step 1: 实现 ExtensionsView 完整布局**

Replace `CoBeing/gui-v2/src/components/extensions/ExtensionsView.tsx`:

```typescript
import { useExtensionsStore } from "@/stores/extensions";
import { cn } from "@/lib/utils";
import type { ExtensionsTab } from "@/lib/types";
import { SkillsTab } from "./SkillsTab";
import { McpsTab } from "./McpsTab";
import { PluginsTab } from "./PluginsTab";

const TABS: { id: ExtensionsTab; label: string; icon: string }[] = [
  { id: "skills", label: "技能", icon: "📦" },
  { id: "mcps", label: "MCPs", icon: "🔌" },
  { id: "plugins", label: "插件", icon: "🧩" },
];

export function ExtensionsView() {
  const activeTab = useExtensionsStore((s) => s.activeTab);
  const setActiveTab = useExtensionsStore((s) => s.setActiveTab);

  return (
    <div className="flex-1 h-full flex flex-col min-w-0 min-h-0 overflow-hidden">
      {/* Tab bar */}
      <div className="flex shrink-0 border-b border-bdr/30 bg-surface-solid"
           style={{ padding: "0 20px" }}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "text-sm font-medium transition-colors border-b-2 -mb-px",
              activeTab === tab.id
                ? "border-accent text-accent"
                : "border-transparent text-txt-muted hover:text-txt"
            )}
            style={{ padding: "12px 16px" }}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content: 3-column layout */}
      <div className="flex-1 flex min-h-0" style={{ padding: 16, gap: 16 }}>
        {activeTab === "skills" && <SkillsTab />}
        {activeTab === "mcps" && <McpsTab />}
        {activeTab === "plugins" && <PluginsTab />}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 验证**

Run: `cd CoBeing\gui-v2; npx tsc --noEmit`
Expected: Missing SkillsTab/McpsTab/PluginsTab modules (will create next).

---

### Task 5: SkillsTab — 迁移 SkillCenter 到扩展页

**Files:**
- Create: `CoBeing/gui-v2/src/components/extensions/SkillsTab.tsx`

- [ ] **Step 1: 实现 SkillsTab — 列表+详情窗口**

Create `CoBeing/gui-v2/src/components/extensions/SkillsTab.tsx`:

```typescript
import { useState, useEffect, useCallback } from "react";
import { getWsClient } from "@/hooks/useWebSocket";
import { useExtensionsStore } from "@/stores/extensions";
import { cn } from "@/lib/utils";

interface SkillInfo {
  name: string;
  description?: string;
  toolCount?: number;
  enabled?: boolean;
}

export function SkillsTab() {
  const selectedItem = useExtensionsStore((s) => s.selectedItem);
  const setSelectedItem = useExtensionsStore((s) => s.setSelectedItem);
  const searchQuery = useExtensionsStore((s) => s.searchQuery);
  const setSearchQuery = useExtensionsStore((s) => s.setSearchQuery);

  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [skillWhitelist, setSkillWhitelist] = useState<Set<string>>(new Set());
  const [skillDoc, setSkillDoc] = useState<string>("");
  const [loading, setLoading] = useState(false);

  // Fetch skills on mount
  const fetchSkills = useCallback(() => {
    const client = getWsClient();
    if (!client) return;
    client.send({ type: "get_skills", payload: {} });
  }, []);

  useEffect(() => {
    fetchSkills();
    // Listen for skill_list event
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.skills) {
        setSkills(detail.skills.map((s: any) => ({ ...s, enabled: skillWhitelist.has(s.name) })));
      }
    };
    window.addEventListener("ws-skill-list", handler);
    return () => window.removeEventListener("ws-skill-list", handler);
  }, [fetchSkills, skillWhitelist]);

  // Fetch skill doc when selected
  useEffect(() => {
    if (!selectedItem) { setSkillDoc(""); return; }
    const client = getWsClient();
    if (!client) return;
    client.send({ type: "get_skill_doc", payload: { name: selectedItem } });
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.name === selectedItem && detail?.body) {
        setSkillDoc(detail.body);
      }
    };
    window.addEventListener("ws-skill-doc", handler);
    return () => window.removeEventListener("ws-skill-doc", handler);
  }, [selectedItem]);

  // Toggle skill
  const toggleSkill = (name: string, enabled: boolean) => {
    const next = new Set(skillWhitelist);
    if (enabled) next.add(name); else next.delete(name);
    setSkillWhitelist(next);
    const client = getWsClient();
    client?.send({ type: "update_config", payload: { path: "skillWhitelist", value: [...next] } });
  };

  const filtered = skills.filter(s =>
    !searchQuery || s.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const selected = skills.find(s => s.name === selectedItem);

  return (
    <div className="flex-1 flex min-h-0" style={{ gap: 16 }}>
      {/* Left: skill list */}
      <div className="w-60 shrink-0 rounded-xl bg-surface border border-bdr/40 flex flex-col"
           style={{ boxShadow: "var(--shadow-surface)" }}>
        <div style={{ padding: 12 }}>
          <input
            type="text"
            placeholder="🔍 搜索技能..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg px-3 py-1.5 text-sm bg-input border border-bdr text-txt
                       focus:outline-none focus:border-accent/50"
          />
        </div>
        <div className="flex-1 overflow-y-auto" style={{ padding: "0 8px 8px" }}>
          {filtered.map((skill) => (
            <button
              key={skill.name}
              onClick={() => setSelectedItem(skill.name)}
              className={cn(
                "w-full flex items-center justify-between rounded-lg text-sm transition-colors",
                selectedItem === skill.name
                  ? "bg-accent/10 text-accent"
                  : "text-txt-sub hover:bg-hover"
              )}
              style={{ padding: "8px 10px", marginBottom: 1 }}
            >
              <span className="truncate text-left">{skill.name}</span>
              <ToggleSwitch
                checked={skillWhitelist.has(skill.name)}
                onChange={(v) => toggleSkill(skill.name, v)}
              />
            </button>
          ))}
        </div>
        {/* Create skill card */}
        <div style={{ padding: "4px 8px 8px" }}>
          <button
            onClick={() => setSelectedItem("__new__")}
            className="w-full rounded-lg border border-dashed border-accent/50 text-accent text-sm
                       hover:bg-accent/5 transition-colors"
            style={{ padding: "10px" }}
          >
            + 创建技能
          </button>
        </div>
      </div>

      {/* Right: detail window */}
      <div className="flex-1 rounded-xl bg-surface border border-bdr/40 overflow-y-auto"
           style={{ boxShadow: "var(--shadow-surface)", padding: 24 }}>
        {selectedItem === "__new__" ? (
          <CreateSkillForm onCreated={(name) => { fetchSkills(); setSelectedItem(name); }} />
        ) : selected ? (
          <div>
            <h3 className="text-lg font-semibold text-txt">{selected.name}</h3>
            {selected.description && (
              <p className="text-sm text-txt-muted mt-1">{selected.description}</p>
            )}
            {selected.toolCount != null && (
              <span className="inline-block mt-2 rounded-full px-3 py-0.5 text-xs bg-accent/10 text-accent">
                {selected.toolCount} 个工具
              </span>
            )}
            <div className="mt-6 p-4 rounded-xl bg-elevated">
              <pre className="text-sm text-txt-sub whitespace-pre-wrap font-mono">
                {skillDoc || "加载中..."}
              </pre>
            </div>
            <div className="mt-4 flex gap-2">
              <button className="rounded-lg px-4 py-2 text-sm bg-accent text-white hover:opacity-90">
                执行技能
              </button>
            </div>
          </div>
        ) : (
          <div className="h-full flex items-center justify-center">
            <p className="text-sm text-txt-muted">选择一项技能查看详情</p>
          </div>
        )}
      </div>
    </div>
  );
}

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={(e) => { e.stopPropagation(); onChange(!checked); }}
      className={cn(
        "relative inline-flex h-4 w-7 items-center rounded-full transition-colors shrink-0",
        checked ? "bg-accent" : "bg-input border border-bdr"
      )}
    >
      <span
        className={cn(
          "inline-block h-3 w-3 rounded-full bg-white transition-transform",
          checked ? "translate-x-3" : "translate-x-0.5"
        )}
      />
    </button>
  );
}

function CreateSkillForm({ onCreated }: { onCreated: (name: string) => void }) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [body, setBody] = useState("");

  const handleCreate = () => {
    if (!name.trim()) return;
    const client = getWsClient();
    client?.send({ type: "skill_create", payload: { name: name.trim(), description: desc.trim(), body } });
    onCreated(name.trim());
  };

  return (
    <div>
      <h3 className="text-lg font-semibold text-txt mb-4">创建技能</h3>
      <div className="space-y-4 max-w-md">
        <div>
          <label className="text-sm text-txt-sub block mb-1">名称</label>
          <input value={name} onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-input border border-bdr text-sm text-txt"
            placeholder="my-skill" />
        </div>
        <div>
          <label className="text-sm text-txt-sub block mb-1">描述</label>
          <input value={desc} onChange={(e) => setDesc(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-input border border-bdr text-sm text-txt"
            placeholder="技能描述..." />
        </div>
        <div>
          <label className="text-sm text-txt-sub block mb-1">SKILL.md 正文</label>
          <textarea value={body} onChange={(e) => setBody(e.target.value)}
            rows={10}
            className="w-full px-3 py-2 rounded-lg bg-input border border-bdr text-sm text-txt font-mono"
            placeholder="# 技能名称\n\n技能指令..." />
        </div>
        <button onClick={handleCreate}
          className="rounded-lg px-4 py-2 text-sm bg-accent text-white hover:opacity-90">
          创建
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 验证**

Run: `cd CoBeing\gui-v2; npx tsc --noEmit`
Expected: Only missing McpsTab/PluginsTab errors remain.

---

### Task 6: McpsTab — 迁移 McpSection 到扩展页

**Files:**
- Create: `CoBeing/gui-v2/src/components/extensions/McpsTab.tsx`

- [ ] **Step 1: 实现 McpsTab — 列表+配置窗口**

Create `CoBeing/gui-v2/src/components/extensions/McpsTab.tsx`:

```typescript
import { useState, useEffect, useCallback } from "react";
import { getWsClient } from "@/hooks/useWebSocket";
import { useExtensionsStore } from "@/stores/extensions";
import { cn } from "@/lib/utils";

interface McpEntry {
  name: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  enabled?: boolean;
  toolCount?: number;
}

export function McpsTab() {
  const selectedItem = useExtensionsStore((s) => s.selectedItem);
  const setSelectedItem = useExtensionsStore((s) => s.setSelectedItem);
  const searchQuery = useExtensionsStore((s) => s.searchQuery);
  const setSearchQuery = useExtensionsStore((s) => s.setSearchQuery);

  const [servers, setServers] = useState<McpEntry[]>([]);
  // Load from config store on mount
  useEffect(() => {
    // Mcp servers come from get_config response handled by useConfigStore
    // Listen for config updates
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.mcpServers) {
        const list: McpEntry[] = Object.entries(detail.mcpServers).map(([name, cfg]: [string, any]) => ({
          name,
          ...cfg,
          enabled: cfg.enabled ?? true,
        }));
        setServers(list);
      }
    };
    window.addEventListener("ws-config-loaded", handler);
    // Initial fetch
    const client = getWsClient();
    client?.send({ type: "get_config", payload: {} });
    return () => window.removeEventListener("ws-config-loaded", handler);
  }, []);

  const toggleServer = (name: string, enabled: boolean) => {
    setServers(prev => prev.map(s => s.name === name ? { ...s, enabled } : s));
    const client = getWsClient();
    client?.send({ type: "update_config", payload: { path: `mcpServers.${name}.enabled`, value: enabled } });
  };

  const deleteServer = (name: string) => {
    setServers(prev => prev.filter(s => s.name !== name));
    const client = getWsClient();
    client?.send({ type: "update_config", payload: { path: `mcpServers.${name}`, value: undefined, delete: true } });
    setSelectedItem(null);
  };

  const saveServerConfig = (name: string, config: Record<string, unknown>) => {
    setServers(prev => prev.map(s => s.name === name ? { ...s, ...config } : s));
    const client = getWsClient();
    client?.send({ type: "update_config", payload: { path: `mcpServers.${name}`, value: config } });
  };

  const filtered = servers.filter(s =>
    !searchQuery || s.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const selected = servers.find(s => s.name === selectedItem);
  const isNew = selectedItem === "__new__";

  return (
    <div className="flex-1 flex min-h-0" style={{ gap: 16 }}>
      {/* Left: server list */}
      <div className="w-60 shrink-0 rounded-xl bg-surface border border-bdr/40 flex flex-col"
           style={{ boxShadow: "var(--shadow-surface)" }}>
        <div style={{ padding: 12 }}>
          <input
            type="text" placeholder="🔍 搜索服务器..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg px-3 py-1.5 text-sm bg-input border border-bdr text-txt
                       focus:outline-none focus:border-accent/50"
          />
        </div>
        <div className="flex-1 overflow-y-auto" style={{ padding: "0 8px 8px" }}>
          {filtered.map((srv) => (
            <button
              key={srv.name}
              onClick={() => setSelectedItem(srv.name)}
              className={cn(
                "w-full flex items-center justify-between rounded-lg text-sm transition-colors",
                selectedItem === srv.name
                  ? "bg-accent/10 text-accent"
                  : "text-txt-sub hover:bg-hover"
              )}
              style={{ padding: "8px 10px", marginBottom: 1 }}
            >
              <div>
                <div className="font-medium">{srv.name}</div>
                <div className="text-xs" style={{ color: srv.enabled ? "#22c55e" : "#9ca3af" }}>
                  {srv.enabled ? `● 在线${srv.toolCount ? ` · ${srv.toolCount}工具` : ""}` : "已关闭"}
                </div>
              </div>
              <ToggleSwitch
                checked={!!srv.enabled}
                onChange={(v) => toggleServer(srv.name, v)}
              />
            </button>
          ))}
        </div>
        <div style={{ padding: "4px 8px 8px" }}>
          <button
            onClick={() => setSelectedItem("__new__")}
            className="w-full rounded-lg border border-dashed border-accent/50 text-accent text-sm
                       hover:bg-accent/5 transition-colors"
            style={{ padding: "10px" }}
          >
            + 添加 MCP 服务器
          </button>
        </div>
      </div>

      {/* Right: detail/config window */}
      <div className="flex-1 rounded-xl bg-surface border border-bdr/40 overflow-y-auto"
           style={{ boxShadow: "var(--shadow-surface)", padding: 24 }}>
        {isNew ? (
          <NewMcpForm onCreated={(name) => {
            setSelectedItem(name);
            // Refresh list
            const client = getWsClient();
            client?.send({ type: "get_config", payload: {} });
          }} />
        ) : selected ? (
          <McpDetail
            server={selected}
            onSave={(cfg) => saveServerConfig(selected.name, cfg)}
            onDelete={() => deleteServer(selected.name)}
          />
        ) : (
          <div className="h-full flex items-center justify-center">
            <p className="text-sm text-txt-muted">选择一个 MCP 服务器查看配置</p>
          </div>
        )}
      </div>
    </div>
  );
}

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch" aria-checked={checked}
      onClick={(e) => { e.stopPropagation(); onChange(!checked); }}
      className={cn(
        "relative inline-flex h-4 w-7 items-center rounded-full transition-colors shrink-0",
        checked ? "bg-accent" : "bg-input border border-bdr"
      )}
    >
      <span className={cn("inline-block h-3 w-3 rounded-full bg-white transition-transform",
        checked ? "translate-x-3" : "translate-x-0.5")} />
    </button>
  );
}

function NewMcpForm({ onCreated }: { onCreated: (name: string) => void }) {
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<"stdio" | "http">("stdio");
  const [command, setCommand] = useState("");
  const [url, setUrl] = useState("");
  const [envStr, setEnvStr] = useState("");

  const handleCreate = () => {
    if (!name.trim()) return;
    const cfg: Record<string, unknown> = { transport, enabled: true };
    if (transport === "stdio") {
      cfg.command = command.trim();
      if (envStr.trim()) {
        try { cfg.env = JSON.parse(envStr.trim()); } catch { /* ignore */ }
      }
    } else {
      cfg.url = url.trim();
    }
    const client = getWsClient();
    client?.send({ type: "update_config", payload: { path: `mcpServers.${name.trim()}`, value: cfg } });
    onCreated(name.trim());
  };

  return (
    <div>
      <h3 className="text-lg font-semibold text-txt mb-4">添加 MCP 服务器</h3>
      <div className="space-y-4 max-w-md">
        <div>
          <label className="text-sm text-txt-sub block mb-1">名称</label>
          <input value={name} onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-input border border-bdr text-sm text-txt" />
        </div>
        <div>
          <label className="text-sm text-txt-sub block mb-1">传输方式</label>
          <select value={transport} onChange={(e) => setTransport(e.target.value as any)}
            className="w-full px-3 py-2 rounded-lg bg-input border border-bdr text-sm text-txt">
            <option value="stdio">stdio</option>
            <option value="http">HTTP</option>
          </select>
        </div>
        {transport === "stdio" ? (
          <div>
            <label className="text-sm text-txt-sub block mb-1">命令</label>
            <input value={command} onChange={(e) => setCommand(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-input border border-bdr text-sm text-txt font-mono"
              placeholder="npx -y @modelcontextprotocol/server-github" />
          </div>
        ) : (
          <div>
            <label className="text-sm text-txt-sub block mb-1">URL</label>
            <input value={url} onChange={(e) => setUrl(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-input border border-bdr text-sm text-txt"
              placeholder="http://localhost:3000/mcp" />
          </div>
        )}
        <div>
          <label className="text-sm text-txt-sub block mb-1">环境变量 (JSON, 可选)</label>
          <input value={envStr} onChange={(e) => setEnvStr(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-input border border-bdr text-sm text-txt font-mono"
            placeholder='{"GITHUB_TOKEN": "ghp_xxx"}' />
        </div>
        <button onClick={handleCreate}
          className="rounded-lg px-4 py-2 text-sm bg-accent text-white hover:opacity-90">
          添加
        </button>
      </div>
    </div>
  );
}

function McpDetail({ server, onSave, onDelete }: {
  server: McpEntry;
  onSave: (cfg: Record<string, unknown>) => void;
  onDelete: () => void;
}) {
  const [transport, setTransport] = useState(server.transport);
  const [command, setCommand] = useState(server.command ?? "");
  const [url, setUrl] = useState(server.url ?? "");
  const [envStr, setEnvStr] = useState(server.env ? JSON.stringify(server.env) : "");

  const handleSave = () => {
    const cfg: Record<string, unknown> = { ...server, transport };
    if (transport === "stdio") cfg.command = command.trim();
    else cfg.url = url.trim();
    if (envStr.trim()) { try { cfg.env = JSON.parse(envStr.trim()); } catch { /* ignore */ } }
    onSave(cfg);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-txt">{server.name}</h3>
          <p className="text-sm text-txt-muted">{server.transport} · {server.toolCount ?? "?"} 个工具</p>
        </div>
        <span className={cn("text-xs px-2 py-0.5 rounded-full",
          server.enabled ? "bg-green-500/10 text-green-500" : "bg-gray-500/10 text-gray-500")}>
          {server.enabled ? "已连接" : "已断开"}
        </span>
      </div>

      <div className="bg-elevated rounded-xl p-4 mb-4">
        <h4 className="text-sm font-medium text-txt mb-3">连接配置</h4>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-txt-muted block mb-1">传输方式</label>
              <select value={transport} onChange={(e) => setTransport(e.target.value as any)}
                className="w-full px-3 py-1.5 rounded-lg bg-input border border-bdr text-sm text-txt">
                <option value="stdio">stdio</option>
                <option value="http">HTTP</option>
              </select>
            </div>
            <div>
              {transport === "stdio" ? (
                <>
                  <label className="text-xs text-txt-muted block mb-1">命令</label>
                  <input value={command} onChange={(e) => setCommand(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg bg-input border border-bdr text-sm text-txt font-mono" />
                </>
              ) : (
                <>
                  <label className="text-xs text-txt-muted block mb-1">URL</label>
                  <input value={url} onChange={(e) => setUrl(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg bg-input border border-bdr text-sm text-txt" />
                </>
              )}
            </div>
          </div>
          <div>
            <label className="text-xs text-txt-muted block mb-1">环境变量 (JSON)</label>
            <input value={envStr} onChange={(e) => setEnvStr(e.target.value)}
              className="w-full px-3 py-1.5 rounded-lg bg-input border border-bdr text-sm text-txt font-mono" />
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          <button onClick={handleSave}
            className="rounded-lg px-3 py-1.5 text-sm bg-accent text-white hover:opacity-90">
            保存配置
          </button>
        </div>
      </div>

      <div className="flex justify-between items-center">
        <button onClick={onDelete}
          className="text-sm text-danger hover:underline">
          删除此服务器
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 验证**

Run: `cd CoBeing\gui-v2; npx tsc --noEmit`
Expected: Only missing PluginsTab error remains.

---

### Task 7: PluginsTab — 插件管理

**Files:**
- Create: `CoBeing/gui-v2/src/components/extensions/PluginsTab.tsx`

- [ ] **Step 1: 实现 PluginsTab — 平铺列表+动态配置**

Create `CoBeing/gui-v2/src/components/extensions/PluginsTab.tsx`:

```typescript
import { useState, useMemo } from "react";
import { usePluginsStore, type PluginInfo } from "@/stores/plugins";
import { useExtensionsStore } from "@/stores/extensions";
import { getWsClient } from "@/hooks/useWebSocket";
import { cn } from "@/lib/utils";

export function PluginsTab() {
  const plugins = usePluginsStore((s) => s.plugins);
  const selectedItem = useExtensionsStore((s) => s.selectedItem);
  const setSelectedItem = useExtensionsStore((s) => s.setSelectedItem);
  const searchQuery = useExtensionsStore((s) => s.searchQuery);
  const setSearchQuery = useExtensionsStore((s) => s.setSearchQuery);

  const sorted = useMemo(() =>
    [...plugins].sort((a, b) => a.name.localeCompare(b.name)),
    [plugins]
  );

  const filtered = useMemo(() =>
    sorted.filter(p => !searchQuery || p.name.toLowerCase().includes(searchQuery.toLowerCase())),
    [sorted, searchQuery]
  );

  const selected = plugins.find(p => p.id === selectedItem);

  const togglePlugin = (id: string, enabled: boolean) => {
    const client = getWsClient();
    client?.send({ type: "toggle_plugin", payload: { pluginId: id, enabled } });
    // Optimistic update
    usePluginsStore.getState().setPlugins(
      plugins.map(p => p.id === id ? { ...p, enabled } : p)
    );
  };

  return (
    <div className="flex-1 flex min-h-0" style={{ gap: 16 }}>
      {/* Left: flat plugin list */}
      <div className="w-60 shrink-0 rounded-xl bg-surface border border-bdr/40 flex flex-col"
           style={{ boxShadow: "var(--shadow-surface)" }}>
        <div style={{ padding: 12 }}>
          <input
            type="text" placeholder="🔍 搜索插件..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg px-3 py-1.5 text-sm bg-input border border-bdr text-txt
                       focus:outline-none focus:border-accent/50"
          />
        </div>
        <div className="flex-1 overflow-y-auto" style={{ padding: "0 8px 8px" }}>
          {filtered.map((plugin) => (
            <button
              key={plugin.id}
              onClick={() => setSelectedItem(plugin.id)}
              className={cn(
                "w-full flex items-center justify-between rounded-lg text-sm transition-colors",
                selectedItem === plugin.id
                  ? "bg-accent/10 text-accent"
                  : "text-txt-sub hover:bg-hover"
              )}
              style={{ padding: "8px 10px", marginBottom: 1 }}
            >
              <div className="truncate text-left">
                <div className="font-medium truncate">{plugin.name}</div>
                <div className="text-xs text-txt-muted">v{plugin.version}</div>
              </div>
              <ToggleSwitch
                checked={plugin.enabled}
                onChange={(v) => togglePlugin(plugin.id, v)}
              />
            </button>
          ))}
        </div>
      </div>

      {/* Right: pluging detail/config */}
      <div className="flex-1 rounded-xl bg-surface border border-bdr/40 overflow-y-auto"
           style={{ boxShadow: "var(--shadow-surface)", padding: 24 }}>
        {selected ? (
          <PluginDetail plugin={selected} />
        ) : (
          <div className="h-full flex items-center justify-center">
            <p className="text-sm text-txt-muted">选择一个插件查看详情和配置</p>
          </div>
        )}
      </div>
    </div>
  );
}

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch" aria-checked={checked}
      onClick={(e) => { e.stopPropagation(); onChange(!checked); }}
      className={cn(
        "relative inline-flex h-4 w-7 items-center rounded-full transition-colors shrink-0",
        checked ? "bg-accent" : "bg-input border border-bdr"
      )}
    >
      <span className={cn("inline-block h-3 w-3 rounded-full bg-white transition-transform",
        checked ? "translate-x-3" : "translate-x-0.5")} />
    </button>
  );
}

function PluginDetail({ plugin }: { plugin: PluginInfo }) {
  const schema = plugin.configSchema;
  const [config, setConfig] = useState<Record<string, unknown>>(plugin.config ?? {});
  const [features, setFeatures] = useState<Record<string, boolean>>(
    (config.features as Record<string, boolean>) ?? {}
  );

  const handleFieldChange = (key: string, value: string) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  const handleFeatureToggle = (key: string, v: boolean) => {
    const next = { ...features, [key]: v };
    setFeatures(next);
    setConfig(prev => ({ ...prev, features: next }));
  };

  const handleSave = () => {
    const client = getWsClient();
    client?.send({ type: "update_plugin_config", payload: { pluginId: plugin.id, config: { ...config, features } } });
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-txt">{plugin.name}</h3>
          <p className="text-sm text-txt-muted">v{plugin.version} · {plugin.enabled ? "运行中" : "已禁用"}</p>
        </div>
        <span className={cn("text-xs px-2 py-0.5 rounded-full",
          plugin.enabled ? "bg-green-500/10 text-green-500" : "bg-gray-500/10 text-gray-500")}>
          {plugin.enabled ? "已启用" : "已禁用"}
        </span>
      </div>

      {/* Info cards */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <InfoBadge label="版本" value={plugin.version} />
        <InfoBadge label="类型" value={plugin.kind} />
        <InfoBadge label="模型数" value={String(plugin.models?.length ?? "-")} />
      </div>

      {/* Config schema form — if available */}
      {schema?.fields && schema.fields.length > 0 && (
        <div className="bg-elevated rounded-xl p-4 mb-3">
          <h4 className="text-sm font-medium text-txt mb-3">🔑 连接配置</h4>
          <div className="grid grid-cols-2 gap-3">
            {schema.fields.map((field) => (
              <div key={field.key} className={field.key.length > 20 ? "col-span-2" : ""}>
                <label className="text-xs text-txt-muted block mb-1">{field.label}</label>
                {field.secret ? (
                  <input
                    type="password"
                    value={String(config[field.key] ?? "")}
                    onChange={(e) => handleFieldChange(field.key, e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg bg-input border border-bdr text-sm text-txt"
                  />
                ) : (
                  <input
                    type="text"
                    value={String(config[field.key] ?? "")}
                    onChange={(e) => handleFieldChange(field.key, e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg bg-input border border-bdr text-sm text-txt"
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Feature toggles — if available */}
      {schema?.features && schema.features.length > 0 && (
        <div className="bg-elevated rounded-xl p-4 mb-3">
          <h4 className="text-sm font-medium text-txt mb-3">⚙️ 功能开关</h4>
          <div className="space-y-3">
            {schema.features.map((feat) => (
              <div key={feat.key} className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-txt">{feat.label}</div>
                  {feat.desc && <div className="text-xs text-txt-muted">{feat.desc}</div>}
                </div>
                <ToggleSwitch
                  checked={!!features[feat.key]}
                  onChange={(v) => handleFeatureToggle(feat.key, v)}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Models list — for provider plugins */}
      {plugin.models && plugin.models.length > 0 && (
        <div className="bg-elevated rounded-xl p-4 mb-3">
          <h4 className="text-sm font-medium text-txt mb-3">📋 模型列表 ({plugin.models.length})</h4>
          <div className="flex flex-wrap gap-2">
            {plugin.models.map((m) => (
              <span key={m.id} className="rounded-full px-3 py-1 text-xs bg-input border border-bdr text-txt-sub">
                {m.name ?? m.id}
                {m.contextWindow ? ` (${Math.round(m.contextWindow / 1024)}K)` : ""}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Fallback: raw JSON editor for plugins without configSchema */}
      {(!schema || (!schema.fields?.length && !schema.features?.length)) && (
        <div className="bg-elevated rounded-xl p-4 mb-3">
          <h4 className="text-sm font-medium text-txt mb-3">📝 配置 (JSON)</h4>
          <textarea
            value={JSON.stringify(config, null, 2)}
            onChange={(e) => { try { setConfig(JSON.parse(e.target.value)); } catch { /* invalid JSON */ } }}
            rows={8}
            className="w-full px-3 py-2 rounded-lg bg-input border border-bdr text-sm text-txt font-mono"
          />
        </div>
      )}

      <div className="flex gap-2 justify-end">
        <button onClick={handleSave}
          className="rounded-lg px-4 py-2 text-sm bg-accent text-white hover:opacity-90">
          保存配置
        </button>
      </div>
    </div>
  );
}

function InfoBadge({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-elevated text-center" style={{ padding: "8px 12px" }}>
      <div className="text-xs text-txt-muted">{label}</div>
      <div className="text-sm font-semibold text-txt">{value}</div>
    </div>
  );
}
```

Note: The `useState` import needs to be added to the file header. The actual file uses `useState` — this is already in the import block.

- [ ] **Step 2: 验证完整编译**

Run: `cd CoBeing\gui-v2; npx tsc --noEmit`
Expected: All imports resolve, no new errors.

---

### Task 8: 仪表盘重设计 — 居中卡片 + 合并用量监控

**Files:**
- Modify: `CoBeing/gui-v2/src/components/observability/DashboardView.tsx`
- Modify: `CoBeing/gui-v2/src/components/observability/TokenCard.tsx`
- Modify: `CoBeing/gui-v2/src/components/observability/LatencyCard.tsx`

- [ ] **Step 1: 重写 DashboardView**

Replace `CoBeing/gui-v2/src/components/observability/DashboardView.tsx`:

```typescript
import { useEffect } from "react";
import { getWsClient } from "@/hooks/useWebSocket";
import { useObservabilityStore } from "@/stores/observability";
import { useGroupsStore } from "@/stores/groups";
import { useUsageStore } from "@/stores/usage";
import { ActiveAgentsPanel } from "./ActiveAgentsPanel";

export function DashboardView() {
  const { dashboard, groupFilter, setGroupFilter, loading } = useObservabilityStore();
  const groups = useGroupsStore((s) => s.groups);
  const usage = useUsageStore((s) => s);

  useEffect(() => {
    const client = getWsClient();
    if (!client) return;
    const fetch = () => client.send({ type: "get_dashboard", payload: groupFilter ? { groupId: groupFilter } : {} });
    fetch();
    const interval = setInterval(fetch, 30000);
    return () => clearInterval(interval);
  }, [groupFilter]);

  if (!dashboard) return (
    <div className="flex-1 h-full flex items-center justify-center">
      <p className="text-txt-muted text-sm">{loading ? "加载中..." : "暂无数据"}</p>
    </div>
  );

  const e = dashboard.errors;

  return (
    <main className="flex-1 h-full flex flex-col min-w-0 min-h-0 overflow-y-auto" style={{ padding: 20, gap: 14 }}>
      <div className="flex items-center gap-4">
        <h2 className="text-lg font-semibold text-txt">仪表盘</h2>
        <select
          className="rounded-lg text-sm border border-bdr/40 focus:outline-none focus:border-accent/50"
          style={{ padding: "8px 12px", backgroundColor: "var(--color-surface-solid)" }}
          value={groupFilter ?? ""}
          onChange={ev => setGroupFilter(ev.target.value || undefined)}
        >
          <option value="">全部群组</option>
          {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </div>

      {/* Row 1: 3 centered cards */}
      <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
        <CenteredCard icon="⚡" label="今日 Token" value={formatNum(dashboard.tokens?.today ?? 0)}
          sub={`输入 ${formatNum(dashboard.tokens?.inputToday ?? 0)} · 输出 ${formatNum(dashboard.tokens?.outputToday ?? 0)}`} />
        <CenteredCard icon="⏱️" label="响应延迟" value={formatMs(dashboard.latency?.p50)}
          sub={`P50 ${formatMs(dashboard.latency?.p50)} · P95 ${formatMs(dashboard.latency?.p95)}`} />
        <CenteredCard icon="❌" label="错误率" value={`${e.llmErrorRate ?? 0}%`}
          sub={`LLM ${e.llmErrorRate ?? 0}% · 工具 ${e.toolErrorRate ?? 0}%`} />
      </div>

      {/* Row 2: Usage & Cost (merged from UsageMonitor) */}
      <CenteredCard icon="💰" label="用量与费用" wide
        value={
          <div className="flex justify-center gap-10">
            <StatItem label="今日费用" value={`¥${usage.totalCost.toFixed(2)}`} />
            <StatItem label="缓存命中率" value={`${calcHitRate(usage)}%`} />
            <StatItem label="本月累计" value={`¥${(usage.totalCost * 30).toFixed(2)}`} />
            <StatItem label="Token 总计" value={formatNum(usage.inputTokens + usage.outputTokens)} />
          </div>
        }
        sub={
          <span>输入 {formatNum(usage.inputTokens)} · 输出 {formatNum(usage.outputTokens)} · 缓存命中 {formatNum(usage.cacheHitTokens)} · 累计 {usage.records.length} 次请求</span>
        } />

      {/* Row 3: Agent activity */}
      {dashboard.agents && dashboard.agents.length > 0 && (
        <CenteredCard icon="🤖" label="Agent 活跃度（7 天）" wide
          value={
            <div className="flex justify-center gap-10">
              {dashboard.agents.slice(0, 4).map((a: any) => (
                <StatItem key={a.agentId} label={a.agentName} value={String(a.count ?? a.callCount ?? "-")} />
              ))}
              <StatItem label="总调用" value={String(dashboard.agents.reduce((s: number, a: any) => s + (a.count ?? a.callCount ?? 0), 0))} />
            </div>
          } />
      )}

      {/* Row 4: Active agents */}
      <div className="rounded-xl bg-surface border border-bdr/40"
           style={{ boxShadow: "var(--shadow-surface)", padding: 20 }}>
        <ActiveAgentsPanel />
      </div>
    </main>
  );
}

function CenteredCard({ icon, label, value, sub, wide }: {
  icon: string; label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="rounded-xl bg-surface border border-bdr/40 text-center"
         style={{ boxShadow: "var(--shadow-surface)", padding: wide ? "20px 24px" : "16px 20px" }}>
      <div className="text-xs text-txt-muted mb-2">{icon} {label}</div>
      {typeof value === "string" ? (
        <div className="text-2xl font-bold text-txt">{value}</div>
      ) : (
        <div>{value}</div>
      )}
      {sub && <div className="text-xs text-txt-muted mt-2">{sub}</div>}
    </div>
  );
}

function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <div className="text-xl font-bold text-txt">{value}</div>
      <div className="text-xs text-txt-muted">{label}</div>
    </div>
  );
}

function formatNum(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return String(Math.round(n));
}

function formatMs(ms?: number): string {
  if (!ms) return "-";
  if (ms >= 1000) return (ms / 1000).toFixed(1) + "s";
  return Math.round(ms) + "ms";
}

function calcHitRate(usage: { cacheHitTokens: number; inputTokens: number }): number {
  const total = usage.cacheHitTokens + usage.inputTokens;
  if (total === 0) return 0;
  return Math.round((usage.cacheHitTokens / total) * 100);
}
```

- [ ] **Step 2: 简化 TokenCard 和 LatencyCard（不再单独使用）**

Since TokenCard and LatencyCard are no longer imported by DashboardView, mark their exports as kept for potential future use (do NOT delete the files — they might be used elsewhere or in future iterations).

- [ ] **Step 3: 验证**

Run: `cd CoBeing\gui-v2; npx tsc --noEmit`
Expected: No new errors. DashboardView compiles.

---

### Task 9: 设置页精简 + 关于页美化

**Files:**
- Modify: `CoBeing/gui-v2/src/components/settings/SettingsView.tsx`

- [ ] **Step 1: 删除 usage/mcp 菜单项和相关渲染分支**

In `CoBeing/gui-v2/src/components/settings/SettingsView.tsx`:

Lines 7, 10 — remove imports:
```typescript
// DELETE: import { McpSection } from "./McpSection";
// DELETE: import { UsageMonitor } from "./UsageMonitor";
```

Lines 21, 23 — update MENU_SECTIONS:
```typescript
const MENU_SECTIONS = [
  { id: "general" as const, label: "常规", group: "" },
  { id: "theme" as const, label: "主题", group: "" },
  { id: "providers" as const, label: "Providers", group: "连接" },
  { id: "channels" as const, label: "Channels", group: "连接" },
  { id: "sandbox" as const, label: "沙箱监控", group: "运维" },
  { id: "search" as const, label: "搜索对话", group: "数据" },
  { id: "logs" as const, label: "日志", group: "数据" },
  { id: "export" as const, label: "导出数据", group: "数据" },
  { id: "about" as const, label: "关于", group: "数据" },
];
```

Lines 88, 90 — remove rendering:
```typescript
// DELETE: {settingsSection === "mcp" && <McpSection />}
// DELETE: {settingsSection === "usage" && <UsageSection />}
```

Lines 135-141 — delete `UsageSection` function:
```typescript
// DELETE the entire function UsageSection() { ... }
```

- [ ] **Step 2: 重写 AboutSection（居中 + 动态版本号）**

Replace the `AboutSection` function (lines 262-293) and `InfoCard` function (lines 296-303):

```typescript
function AboutSection() {
  const [version, setVersion] = useState("...");
  const [configVersion, setConfigVersion] = useState<string | null>(null);

  useEffect(() => {
    // Read version from config store or WS response
    // The version comes from get_config which is loaded on connect
    const client = getWsClient();
    if (client) {
      client.send({ type: "get_config", payload: {} });
    }

    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.version) {
        setVersion(detail.version);
        setConfigVersion(detail.version);
      }
    };
    window.addEventListener("ws-config-loaded", handler);

    // Fallback: try reading from existing store
    const stored = (window as any).__cobeing?.config?.version;
    if (stored) setVersion(stored);

    return () => window.removeEventListener("ws-config-loaded", handler);
  }, []);

  const handleTutorial = () => {
    const openFn = (window as any).__cobeingOpenTutorial;
    if (openFn) openFn();
  };

  return (
    <div className="flex flex-col items-center text-center" style={{ paddingTop: 40 }}>
      <div className="text-5xl mb-4">🦾</div>
      <h2 className="text-xl font-bold text-txt mb-1">CoBeing</h2>
      <div className="text-3xl font-extrabold text-accent mb-2">v{version}</div>
      <p className="text-sm text-txt-muted mb-6">多 Agent 协作框架</p>
      <div className="flex gap-4 text-xs text-txt-muted mb-8">
        <span>React + Tauri</span>
        <span>·</span>
        <span>TypeScript</span>
        <span>·</span>
        <span>WebSocket</span>
      </div>
      <button
        onClick={handleTutorial}
        className="rounded-xl px-6 py-2.5 text-sm font-medium bg-accent text-white hover:opacity-90 transition-opacity"
      >
        📖 重新打开教程
      </button>
    </div>
  );
}
```

Note: The import for `useState` and `useEffect` must already be present — `SettingsView.tsx` uses hooks from React. Verify.

- [ ] **Step 3: 验证**

Run: `cd CoBeing\gui-v2; npx tsc --noEmit`
Expected: No new errors. All deleted references resolved.

---

### Task 10: 前端 WebSocket 适配

**Files:**
- Modify: `CoBeing/gui-v2/src/hooks/useWebSocket.ts`

- [ ] **Step 1: 新增 toggle_plugin / update_plugin_config 消息处理 + version 处理**

Find the message handling switch in `useWebSocket.ts`. Add new cases:

```typescript
// Add alongside existing plugin/config handlers:
case "plugin_toggled":
  window.dispatchEvent(new CustomEvent("ws-plugin-toggled", { detail: p }));
  break;

case "plugin_config_updated":
  window.dispatchEvent(new CustomEvent("ws-plugin-config-updated", { detail: p }));
  break;

// In the get_config / config response handler, also dispatch version:
// (find existing config handler — add version dispatch)
case "config":
  window.dispatchEvent(new CustomEvent("ws-config-loaded", { detail: { ...p, version: p.version } }));
  // ... existing config store handling ...
  break;
```

(Note: Locate the actual handler for `get_config` responses — likely around line ~200-250. If the response uses a different type name like `"config"`, adjust accordingly. The key is ensuring `version` is available to the AboutSection.)

- [ ] **Step 2: 验证编译**

Run: `cd CoBeing\gui-v2; npx tsc --noEmit`
Expected: No new errors.

---

### Task 11: 清理旧文件 + 最终验证

**Files to delete:**
- `CoBeing/gui-v2/src/components/skill/SkillCenter.tsx`
- `CoBeing/gui-v2/src/stores/skills.ts`
- `CoBeing/gui-v2/src/components/settings/McpSection.tsx`
- `CoBeing/gui-v2/src/components/settings/UsageMonitor.tsx`
- `CoBeing/gui-v2/src/stores/usage.ts`

- [ ] **Step 1: 删除旧文件**

Run:
```powershell
Remove-Item "D:\agent-codes\CoBeing\gui-v2\src\components\skill\SkillCenter.tsx" -Force -ErrorAction SilentlyContinue
Remove-Item "D:\agent-codes\CoBeing\gui-v2\src\stores\skills.ts" -Force -ErrorAction SilentlyContinue
Remove-Item "D:\agent-codes\CoBeing\gui-v2\src\components\settings\McpSection.tsx" -Force -ErrorAction SilentlyContinue
Remove-Item "D:\agent-codes\CoBeing\gui-v2\src\components\settings\UsageMonitor.tsx" -Force -ErrorAction SilentlyContinue
Remove-Item "D:\agent-codes\CoBeing\gui-v2\src\stores\usage.ts" -Force -ErrorAction SilentlyContinue
```

- [ ] **Step 2: 检查未解除的引用**

Run: `cd CoBeing\gui-v2; npx tsc --noEmit`
If errors reference deleted files, remove the imports.

- [ ] **Step 3: 构建全部包**

Run: `cd CoBeing; pnpm build`
Expected: 7 packages build successfully

- [ ] **Step 4: 运行全量测试**

Run: `cd CoBeing; pnpm test`
Expected: 417 tests pass

- [ ] **Step 5: 前端 TypeScript 检查**

Run: `cd CoBeing\gui-v2; npx tsc --noEmit`
Expected: Zero errors (or only pre-existing unrelated errors)

- [ ] **Step 6: 提交**

```bash
git add -A
git commit -m "feat: 前端扩展系统重设计 — 扩展页面(技能/MCPs/插件)、仪表盘居中卡片、设置页精简、关于页美化

- 侧栏重排: 管家→智能体→群组→仪表盘→扩展→设置
- 新增 ExtensionsView: Tab 式技能/MCPs/插件三页面
- 仪表盘: 统一居中卡片 + 合并用量监控 + 删除工具排行
- 设置页: 移除用量监控/MCP服务器
- 关于页: 居中美化 + 版本号动态获取
- 后端: 新增 toggle_plugin/update_plugin_config WS 端点
- 清理旧文件: SkillCenter/McpSection/UsageMonitor + stores"
```

---

## Verification Checklist

| Check | Command | Expected |
|-------|---------|----------|
| TypeScript types | `cd gui-v2; npx tsc --noEmit` | 0 new errors |
| Backend build | `pnpm build` | 7 packages pass |
| Full tests | `pnpm test` | 417 pass |
| NavBar order | visual | Butler→Agents→Groups→Dashboard→Extensions→Settings |
| Extensions tabs | visual | Skills/MCPs/Plugins tabs render |
| Plugin list flat | visual | No category grouping |
| Dashboard centered | visual | All cards centered layout |
| Settings menu | visual | No usage/mcp entries |
| About version | visual | Shows "v1.4.0" from get_config |
