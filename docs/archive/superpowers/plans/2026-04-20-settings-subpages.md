# 设置页子页面 Implementation Plan

> **For agentic workers:** 按项目 CLAUDE.md 规则，所有任务内联执行，禁止使用 subagents。逐步执行每个 Task 的 Step。

**Goal:** 实现 Providers、Channels、MCP 服务器、日志 4 个设置子页面，通过 WS 命令实时读写后端配置。

**Architecture:** 后端 ws-server.ts 新增 `get_config` / `update_config` 命令，前端创建 Config Store 管理 WS 通信，4 个独立 Section 组件替换 PlaceholderSection。

**Tech Stack:** TypeScript, React 19, Zustand, Radix UI Dialog, WebSocket

---

## File Structure

| 操作 | 文件 | 职责 |
|------|------|------|
| 修改 | `packages/core/src/api/ws-server.ts` | 添加 get_config / update_config / subscribe_log 命令 |
| 创建 | `gui-v2/src/stores/config.ts` | 配置状态管理 + WS 读写 |
| 创建 | `gui-v2/src/components/settings/ProvidersSection.tsx` | Providers 列表 + 编辑 Dialog |
| 创建 | `gui-v2/src/components/settings/ChannelsSection.tsx` | Channels 列表 + 编辑 Dialog |
| 创建 | `gui-v2/src/components/settings/McpSection.tsx` | MCP 服务器列表 + 编辑 Dialog |
| 创建 | `gui-v2/src/components/settings/LogsSection.tsx` | 实时日志查看器 |
| 修改 | `gui-v2/src/components/settings/SettingsView.tsx` | 替换 4 个 PlaceholderSection |
| 修改 | `gui-v2/src/hooks/useWebSocket.ts` | 处理 config / log WS 消息类型 |

---

### Task 1: 后端 — 添加 get_config / update_config / subscribe_log 命令

**Files:**
- Modify: `packages/core/src/api/ws-server.ts`

- [ ] **Step 1: 添加 configPath 属性和 import**

在 `ws-server.ts` 顶部添加 import：

```ts
import fs from "node:fs";
import path from "node:path";
```

在 `CoreWSServer` 类中添加 `configPath` 属性，修改 constructor：

```ts
constructor(private port: number = 18765, private configPath?: string) {}
```

- [ ] **Step 2: 添加 get_config / update_config / subscribe_log 命令到 handleMessage**

在 `handleMessage` 的 `switch` 中，`case "get_log"` 之后、`default` 之前添加：

```ts
      case "get_config": {
        const configFilePath = this.configPath || path.resolve("config/default.json");
        try {
          const raw = fs.readFileSync(configFilePath, "utf-8");
          const config = JSON.parse(raw);
          this.sendToClient(ws, { type: "config", payload: config });
        } catch (err) {
          this.sendToClient(ws, { type: "error", payload: { message: `Failed to read config: ${err}` } });
        }
        break;
      }

      case "update_config": {
        const { path: configPath, value } = msg.payload as { path: string; value: unknown };
        const configFilePath = this.configPath || path.resolve("config/default.json");
        try {
          const raw = fs.readFileSync(configFilePath, "utf-8");
          const config = JSON.parse(raw);
          setNestedValue(config, configPath, value);
          fs.writeFileSync(configFilePath, JSON.stringify(config, null, 2) + "\n", "utf-8");
          this.sendToClient(ws, { type: "config_updated", payload: { path: configPath, success: true } });
          // 广播新配置给所有客户端
          this.broadcast({ type: "config", payload: config });
        } catch (err) {
          this.sendToClient(ws, { type: "error", payload: { message: `Failed to update config: ${err}` } });
        }
        break;
      }

      case "subscribe_log": {
        // 返回当前日志 + 标记客户端订阅实时日志
        this.sendToClient(ws, { type: "log", payload: this.messageLog });
        (ws as any).__subscribedLog = true;
        break;
      }
```

- [ ] **Step 3: 添加 setNestedValue 辅助函数 + 修改 logMessage 支持订阅**

在文件末尾（class 外部）添加：

```ts
/** 按 "a.b.c" 路径设置嵌套对象值 */
function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split(".");
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!(keys[i] in current) || typeof current[keys[i]] !== "object") {
      current[keys[i]] = {};
    }
    current = current[keys[i]] as Record<string, unknown>;
  }
  current[keys[keys.length - 1]] = value;
}
```

修改 `logMessage` 方法，在 `this.broadcast(...)` 之后添加对订阅者的推送：

```ts
  logMessage(direction: "in" | "out" | "system", content: string): void {
    const entry = { timestamp: Date.now(), direction, content };
    this.messageLog.push(entry);
    if (this.messageLog.length > 500) this.messageLog.shift();
    this.broadcast({ type: "message", payload: entry });
    // 推送给日志订阅者
    const logData = JSON.stringify({ type: "log_entry", payload: entry });
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN && (client as any).__subscribedLog) {
        client.send(logData);
      }
    }
  }
```

- [ ] **Step 4: 验证后端编译**

Run: `cd D:/agent-codes/myagents && pnpm build`
Expected: 编译成功

- [ ] **Step 5: Commit**

```bash
cd D:/agent-codes/myagents
git add packages/core/src/api/ws-server.ts
git commit -m "feat(core): add get_config, update_config, subscribe_log WS commands"
```

---

### Task 2: 前端 — Config Store

**Files:**
- Create: `gui-v2/src/stores/config.ts`

- [ ] **Step 1: 创建配置状态管理 Store**

创建 `gui-v2/src/stores/config.ts`：

```ts
import { create } from "zustand";
import { getWsClient } from "@/hooks/useWebSocket";

export interface ProviderEntry {
  name: string;
  apiKeyEnv: string;
  type?: string;
  baseURL?: string;
}

export interface ChannelEntry {
  name: string;
  enabled: boolean;
  type: string;
  [key: string]: unknown;
}

export interface McpEntry {
  name: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

interface ConfigStore {
  providers: Record<string, ProviderEntry>;
  channels: Record<string, ChannelEntry>;
  mcpServers: Record<string, McpEntry>;
  loaded: boolean;

  setConfig: (config: {
    providers?: Record<string, ProviderEntry>;
    channels?: Record<string, ChannelEntry>;
    mcpServers?: Record<string, McpEntry>;
  }) => void;

  fetchConfig: () => void;

  updateProvider: (name: string, entry: ProviderEntry) => void;
  deleteProvider: (name: string) => void;

  updateChannel: (name: string, entry: ChannelEntry) => void;
  deleteChannel: (name: string) => void;

  updateMcp: (name: string, entry: McpEntry) => void;
  deleteMcp: (name: string) => void;
}

function sendUpdate(configPath: string, value: unknown) {
  getWsClient()?.send({ type: "update_config", payload: { path: configPath, value } });
}

export const useConfigStore = create<ConfigStore>((set, get) => ({
  providers: {},
  channels: {},
  mcpServers: {},
  loaded: false,

  setConfig: (config) => set({
    providers: config.providers || {},
    channels: config.channels || {},
    mcpServers: config.mcpServers || {},
    loaded: true,
  }),

  fetchConfig: () => {
    getWsClient()?.send({ type: "get_config" });
  },

  updateProvider: (name, entry) => {
    const providers = { ...get().providers, [name]: entry };
    set({ providers });
    sendUpdate(`providers.${name}`, {
      apiKeyEnv: entry.apiKeyEnv,
      type: entry.type || undefined,
      baseURL: entry.baseURL || undefined,
    });
  },

  deleteProvider: (name) => {
    const { [name]: _, ...rest } = get().providers;
    set({ providers: rest });
    sendUpdate(`providers.${name}`, null);
  },

  updateChannel: (name, entry) => {
    const channels = { ...get().channels, [name]: entry };
    set({ channels });
    sendUpdate(`channels.${name}`, entry);
  },

  deleteChannel: (name) => {
    const { [name]: _, ...rest } = get().channels;
    set({ channels: rest });
    sendUpdate(`channels.${name}`, null);
  },

  updateMcp: (name, entry) => {
    const mcpServers = { ...get().mcpServers, [name]: entry };
    set({ mcpServers });
    sendUpdate(`mcpServers.${name}`, {
      transport: entry.transport,
      command: entry.command || undefined,
      args: entry.args || undefined,
      env: entry.env || undefined,
      url: entry.url || undefined,
      headers: entry.headers || undefined,
    });
  },

  deleteMcp: (name) => {
    const { [name]: _, ...rest } = get().mcpServers;
    set({ mcpServers: rest });
    sendUpdate(`mcpServers.${name}`, null);
  },
}));
```

- [ ] **Step 2: Commit**

```bash
cd D:/agent-codes/myagents
git add gui-v2/src/stores/config.ts
git commit -m "feat(gui): add config store for settings WS communication"
```

---

### Task 3: 前端 — Providers 设置页

**Files:**
- Create: `gui-v2/src/components/settings/ProvidersSection.tsx`

- [ ] **Step 1: 创建 Providers 列表 + 编辑组件**

创建 `gui-v2/src/components/settings/ProvidersSection.tsx`：

```tsx
import { useState } from "react";
import { useConfigStore, type ProviderEntry } from "@/stores/config";
import * as Dialog from "@radix-ui/react-dialog";
import * as DialogPrimitive from "@radix-ui/react-dialog";

const EMPTY_ENTRY: ProviderEntry = { name: "", apiKeyEnv: "", type: "openai-compat", baseURL: "" };

export function ProvidersSection() {
  const providers = useConfigStore((s) => s.providers);
  const updateProvider = useConfigStore((s) => s.updateProvider);
  const deleteProvider = useConfigStore((s) => s.deleteProvider);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<{ key: string; entry: ProviderEntry }>({ key: "", entry: EMPTY_ENTRY });

  const entries = Object.entries(providers);

  const handleAdd = () => {
    setEditing({ key: "", entry: { ...EMPTY_ENTRY } });
    setEditOpen(true);
  };

  const handleEdit = (key: string) => {
    setEditing({ key, entry: { ...providers[key] } });
    setEditOpen(true);
  };

  const handleSave = () => {
    const name = editing.key || editing.entry.name.trim();
    if (!name) return;
    updateProvider(name, { ...editing.entry, name });
    setEditOpen(false);
  };

  const handleDelete = (key: string) => {
    if (confirm(`确定删除 Provider "${key}"？`)) deleteProvider(key);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-txt">Providers</h2>
          <p className="text-sm text-txt-muted">LLM 服务商配置</p>
        </div>
        <button onClick={handleAdd} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-accent text-white hover:bg-accent/90">+ 添加</button>
      </div>

      {entries.length === 0 ? (
        <div className="p-6 rounded-xl border border-dashed border-bdr text-center text-sm text-txt-muted">暂无 Provider</div>
      ) : (
        <div className="space-y-2">
          {entries.map(([key, p]) => (
            <div key={key} className="flex items-center gap-3 p-3 rounded-lg bg-bg-elevated">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-txt">{key}</div>
                <div className="text-[11px] text-txt-muted truncate">
                  {p.type || "openai-compat"} · {p.baseURL || "default"} · <span className="text-accent">{p.apiKeyEnv}</span>
                </div>
              </div>
              <button onClick={() => handleEdit(key)} className="text-xs text-txt-sub hover:text-accent">编辑</button>
              <button onClick={() => handleDelete(key)} className="text-xs text-txt-sub hover:text-danger">删除</button>
            </div>
          ))}
        </div>
      )}

      <Dialog.Root open={editOpen} onOpenChange={setEditOpen}>
        <Dialog.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 bg-black/40 z-40" />
          <DialogPrimitive.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[420px] bg-bg-surface rounded-xl shadow-xl p-6 z-50 border border-bdr">
            <Dialog.Title className="text-base font-semibold text-txt mb-4">
              {editing.key ? `编辑 ${editing.key}` : "添加 Provider"}
            </Dialog.Title>
            <div className="space-y-3">
              {!editing.key && (
                <label className="block">
                  <span className="text-xs text-txt-sub">名称（英文标识符）</span>
                  <input value={editing.entry.name} onChange={(e) => setEditing({ ...editing, entry: { ...editing.entry, name: e.target.value } })} className="mt-1 w-full px-3 py-2 rounded-lg bg-bg-input border border-bdr text-sm text-txt focus:outline-none focus:border-accent/50" placeholder="e.g. openai" />
                </label>
              )}
              <label className="block">
                <span className="text-xs text-txt-sub">API Key 环境变量</span>
                <input value={editing.entry.apiKeyEnv} onChange={(e) => setEditing({ ...editing, entry: { ...editing.entry, apiKeyEnv: e.target.value } })} className="mt-1 w-full px-3 py-2 rounded-lg bg-bg-input border border-bdr text-sm text-txt focus:outline-none focus:border-accent/50" placeholder="e.g. OPENAI_API_KEY" />
              </label>
              <label className="block">
                <span className="text-xs text-txt-sub">类型</span>
                <select value={editing.entry.type} onChange={(e) => setEditing({ ...editing, entry: { ...editing.entry, type: e.target.value } })} className="mt-1 w-full px-3 py-2 rounded-lg bg-bg-input border border-bdr text-sm text-txt focus:outline-none focus:border-accent/50">
                  <option value="openai-compat">OpenAI Compatible</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="gemini">Gemini</option>
                </select>
              </label>
              <label className="block">
                <span className="text-xs text-txt-sub">Base URL（可选）</span>
                <input value={editing.entry.baseURL || ""} onChange={(e) => setEditing({ ...editing, entry: { ...editing.entry, baseURL: e.target.value } })} className="mt-1 w-full px-3 py-2 rounded-lg bg-bg-input border border-bdr text-sm text-txt focus:outline-none focus:border-accent/50" placeholder="https://api.openai.com/v1" />
              </label>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setEditOpen(false)} className="px-4 py-2 rounded-lg text-xs text-txt-sub hover:bg-bg-hover">取消</button>
              <button onClick={handleSave} className="px-4 py-2 rounded-lg text-xs font-medium bg-accent text-white hover:bg-accent/90">保存</button>
            </div>
          </DialogPrimitive.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd D:/agent-codes/myagents
git add gui-v2/src/components/settings/ProvidersSection.tsx
git commit -m "feat(gui): add Providers settings page with edit dialog"
```

---

### Task 4: 前端 — Channels 设置页

**Files:**
- Create: `gui-v2/src/components/settings/ChannelsSection.tsx`

- [ ] **Step 1: 创建 Channels 列表 + 编辑组件**

创建 `gui-v2/src/components/settings/ChannelsSection.tsx`：

```tsx
import { useState } from "react";
import { useConfigStore, type ChannelEntry } from "@/stores/config";
import * as Dialog from "@radix-ui/react-dialog";
import * as DialogPrimitive from "@radix-ui/react-dialog";

const CHANNEL_TYPES = ["onebot", "wecom", "feishu", "discord"] as const;

const TYPE_FIELDS: Record<string, { key: string; label: string; placeholder: string }[]> = {
  onebot: [
    { key: "wsUrl", label: "WebSocket URL", placeholder: "ws://localhost:6700" },
    { key: "botQQ", label: "Bot QQ", placeholder: "123456789" },
    { key: "accessToken", label: "Access Token", placeholder: "" },
  ],
  wecom: [
    { key: "wecomCorpId", label: "Corp ID", placeholder: "" },
    { key: "wecomAgentId", label: "Agent ID", placeholder: "" },
    { key: "wecomSecret", label: "Secret", placeholder: "" },
  ],
  feishu: [
    { key: "feishuAppId", label: "App ID", placeholder: "" },
    { key: "feishuAppSecret", label: "App Secret", placeholder: "" },
  ],
  discord: [
    { key: "discordBotToken", label: "Bot Token", placeholder: "" },
    { key: "discordGuildId", label: "Guild ID", placeholder: "" },
  ],
};

const EMPTY: ChannelEntry = { name: "", enabled: false, type: "onebot" };

export function ChannelsSection() {
  const channels = useConfigStore((s) => s.channels);
  const updateChannel = useConfigStore((s) => s.updateChannel);
  const deleteChannel = useConfigStore((s) => s.deleteChannel);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<{ key: string; entry: ChannelEntry }>({ key: "", entry: EMPTY });

  const entries = Object.entries(channels);

  const handleAdd = () => setEditing({ key: "", entry: { ...EMPTY } });
  const handleEdit = (key: string) => {
    const ch = channels[key];
    setEditing({ key, entry: { ...ch } });
    setEditOpen(true);
  };

  // handleAdd should also open dialog
  const openAdd = () => {
    setEditing({ key: "", entry: { ...EMPTY } });
    setEditOpen(true);
  };

  const handleSave = () => {
    const name = editing.key || editing.entry.name.trim();
    if (!name) return;
    updateChannel(name, { ...editing.entry, name });
    setEditOpen(false);
  };

  const handleDelete = (key: string) => {
    if (confirm(`确定删除 Channel "${key}"？`)) deleteChannel(key);
  };

  const updateField = (fieldKey: string, value: string) => {
    setEditing({ ...editing, entry: { ...editing.entry, [fieldKey]: value } });
  };

  const fields = TYPE_FIELDS[editing.entry.type] || [];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-txt">Channels</h2>
          <p className="text-sm text-txt-muted">消息渠道配置</p>
        </div>
        <button onClick={openAdd} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-accent text-white hover:bg-accent/90">+ 添加</button>
      </div>

      {entries.length === 0 ? (
        <div className="p-6 rounded-xl border border-dashed border-bdr text-center text-sm text-txt-muted">暂无 Channel</div>
      ) : (
        <div className="space-y-2">
          {entries.map(([key, ch]) => (
            <div key={key} className="flex items-center gap-3 p-3 rounded-lg bg-bg-elevated">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-txt">{key}</div>
                <div className="text-[11px] text-txt-muted">{ch.type} · {ch.enabled ? "已启用" : "已禁用"}</div>
              </div>
              <button onClick={() => updateChannel(key, { ...ch, enabled: !ch.enabled })} className={`text-xs px-2 py-1 rounded ${ch.enabled ? "bg-success/10 text-success" : "bg-bg-base text-txt-muted"}`}>
                {ch.enabled ? "启用" : "禁用"}
              </button>
              <button onClick={() => handleEdit(key)} className="text-xs text-txt-sub hover:text-accent">编辑</button>
              <button onClick={() => handleDelete(key)} className="text-xs text-txt-sub hover:text-danger">删除</button>
            </div>
          ))}
        </div>
      )}

      <Dialog.Root open={editOpen} onOpenChange={setEditOpen}>
        <Dialog.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 bg-black/40 z-40" />
          <DialogPrimitive.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[420px] bg-bg-surface rounded-xl shadow-xl p-6 z-50 border border-bdr max-h-[80vh] overflow-y-auto">
            <Dialog.Title className="text-base font-semibold text-txt mb-4">
              {editing.key ? `编辑 ${editing.key}` : "添加 Channel"}
            </Dialog.Title>
            <div className="space-y-3">
              {!editing.key && (
                <label className="block">
                  <span className="text-xs text-txt-sub">名称</span>
                  <input value={editing.entry.name} onChange={(e) => setEditing({ ...editing, entry: { ...editing.entry, name: e.target.value } })} className="mt-1 w-full px-3 py-2 rounded-lg bg-bg-input border border-bdr text-sm text-txt focus:outline-none focus:border-accent/50" />
                </label>
              )}
              <label className="block">
                <span className="text-xs text-txt-sub">类型</span>
                <select value={editing.entry.type} onChange={(e) => setEditing({ ...editing, entry: { ...editing.entry, type: e.target.value, ...Object.fromEntries(fields.map(f => [f.key, ""])) } as ChannelEntry })} className="mt-1 w-full px-3 py-2 rounded-lg bg-bg-input border border-bdr text-sm text-txt focus:outline-none focus:border-accent/50">
                  {CHANNEL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              {fields.map(f => (
                <label key={f.key} className="block">
                  <span className="text-xs text-txt-sub">{f.label}</span>
                  <input value={(editing.entry[f.key] as string) || ""} onChange={(e) => updateField(f.key, e.target.value)} className="mt-1 w-full px-3 py-2 rounded-lg bg-bg-input border border-bdr text-sm text-txt focus:outline-none focus:border-accent/50" placeholder={f.placeholder} />
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setEditOpen(false)} className="px-4 py-2 rounded-lg text-xs text-txt-sub hover:bg-bg-hover">取消</button>
              <button onClick={handleSave} className="px-4 py-2 rounded-lg text-xs font-medium bg-accent text-white hover:bg-accent/90">保存</button>
            </div>
          </DialogPrimitive.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd D:/agent-codes/myagents
git add gui-v2/src/components/settings/ChannelsSection.tsx
git commit -m "feat(gui): add Channels settings page with type-specific fields"
```

---

### Task 5: 前端 — MCP 服务器设置页

**Files:**
- Create: `gui-v2/src/components/settings/McpSection.tsx`

- [ ] **Step 1: 创建 MCP 服务器列表 + 编辑组件**

创建 `gui-v2/src/components/settings/McpSection.tsx`：

```tsx
import { useState } from "react";
import { useConfigStore, type McpEntry } from "@/stores/config";
import * as Dialog from "@radix-ui/react-dialog";
import * as DialogPrimitive from "@radix-ui/react-dialog";

const EMPTY: McpEntry = { name: "", transport: "stdio", command: "", args: [], url: "" };

export function McpSection() {
  const mcpServers = useConfigStore((s) => s.mcpServers);
  const updateMcp = useConfigStore((s) => s.updateMcp);
  const deleteMcp = useConfigStore((s) => s.deleteMcp);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<{ key: string; entry: McpEntry }>({ key: "", entry: EMPTY });

  const entries = Object.entries(mcpServers);

  const openAdd = () => { setEditing({ key: "", entry: { ...EMPTY } }); setEditOpen(true); };
  const handleEdit = (key: string) => { setEditing({ key, entry: { ...mcpServers[key] } }); setEditOpen(true); };

  const handleSave = () => {
    const name = editing.key || editing.entry.name.trim();
    if (!name) return;
    updateMcp(name, { ...editing.entry, name });
    setEditOpen(false);
  };

  const handleDelete = (key: string) => {
    if (confirm(`确定删除 MCP 服务器 "${key}"？`)) deleteMcp(key);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-txt">MCP 服务器</h2>
          <p className="text-sm text-txt-muted">MCP 工具服务器连接</p>
        </div>
        <button onClick={openAdd} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-accent text-white hover:bg-accent/90">+ 添加</button>
      </div>

      {entries.length === 0 ? (
        <div className="p-6 rounded-xl border border-dashed border-bdr text-center text-sm text-txt-muted">暂无 MCP 服务器</div>
      ) : (
        <div className="space-y-2">
          {entries.map(([key, m]) => (
            <div key={key} className="flex items-center gap-3 p-3 rounded-lg bg-bg-elevated">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-txt">{key}</div>
                <div className="text-[11px] text-txt-muted">
                  {m.transport} · {m.transport === "stdio" ? m.command : m.url}
                </div>
              </div>
              <button onClick={() => handleEdit(key)} className="text-xs text-txt-sub hover:text-accent">编辑</button>
              <button onClick={() => handleDelete(key)} className="text-xs text-txt-sub hover:text-danger">删除</button>
            </div>
          ))}
        </div>
      )}

      <Dialog.Root open={editOpen} onOpenChange={setEditOpen}>
        <Dialog.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 bg-black/40 z-40" />
          <DialogPrimitive.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[420px] bg-bg-surface rounded-xl shadow-xl p-6 z-50 border border-bdr">
            <Dialog.Title className="text-base font-semibold text-txt mb-4">
              {editing.key ? `编辑 ${editing.key}` : "添加 MCP 服务器"}
            </Dialog.Title>
            <div className="space-y-3">
              {!editing.key && (
                <label className="block">
                  <span className="text-xs text-txt-sub">名称</span>
                  <input value={editing.entry.name} onChange={(e) => setEditing({ ...editing, entry: { ...editing.entry, name: e.target.value } })} className="mt-1 w-full px-3 py-2 rounded-lg bg-bg-input border border-bdr text-sm text-txt focus:outline-none focus:border-accent/50" />
                </label>
              )}
              <label className="block">
                <span className="text-xs text-txt-sub">传输方式</span>
                <select value={editing.entry.transport} onChange={(e) => setEditing({ ...editing, entry: { ...editing.entry, transport: e.target.value as "stdio" | "http" } })} className="mt-1 w-full px-3 py-2 rounded-lg bg-bg-input border border-bdr text-sm text-txt focus:outline-none focus:border-accent/50">
                  <option value="stdio">stdio</option>
                  <option value="http">http</option>
                </select>
              </label>
              {editing.entry.transport === "stdio" ? (
                <>
                  <label className="block">
                    <span className="text-xs text-txt-sub">命令</span>
                    <input value={editing.entry.command || ""} onChange={(e) => setEditing({ ...editing, entry: { ...editing.entry, command: e.target.value } })} className="mt-1 w-full px-3 py-2 rounded-lg bg-bg-input border border-bdr text-sm text-txt focus:outline-none focus:border-accent/50" placeholder="npx" />
                  </label>
                  <label className="block">
                    <span className="text-xs text-txt-sub">参数（逗号分隔）</span>
                    <input value={(editing.entry.args || []).join(", ")} onChange={(e) => setEditing({ ...editing, entry: { ...editing.entry, args: e.target.value.split(",").map(s => s.trim()).filter(Boolean) } })} className="mt-1 w-full px-3 py-2 rounded-lg bg-bg-input border border-bdr text-sm text-txt focus:outline-none focus:border-accent/50" placeholder="-y, @modelcontextprotocol/server-filesystem" />
                  </label>
                </>
              ) : (
                <label className="block">
                  <span className="text-xs text-txt-sub">URL</span>
                  <input value={editing.entry.url || ""} onChange={(e) => setEditing({ ...editing, entry: { ...editing.entry, url: e.target.value } })} className="mt-1 w-full px-3 py-2 rounded-lg bg-bg-input border border-bdr text-sm text-txt focus:outline-none focus:border-accent/50" placeholder="http://localhost:3000/mcp" />
                </label>
              )}
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setEditOpen(false)} className="px-4 py-2 rounded-lg text-xs text-txt-sub hover:bg-bg-hover">取消</button>
              <button onClick={handleSave} className="px-4 py-2 rounded-lg text-xs font-medium bg-accent text-white hover:bg-accent/90">保存</button>
            </div>
          </DialogPrimitive.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd D:/agent-codes/myagents
git add gui-v2/src/components/settings/McpSection.tsx
git commit -m "feat(gui): add MCP servers settings page with transport-specific fields"
```

---

### Task 6: 前端 — 日志页

**Files:**
- Create: `gui-v2/src/components/settings/LogsSection.tsx`

- [ ] **Step 1: 创建实时日志查看器组件**

创建 `gui-v2/src/components/settings/LogsSection.tsx`：

```tsx
import { useState, useRef, useEffect } from "react";
import { getWsClient } from "@/hooks/useWebSocket";

interface LogEntry {
  timestamp: number;
  direction: string;
  content: string;
}

type LogLevel = "all" | "in" | "out" | "system";

export function LogsSection() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState<LogLevel>("all");
  const [autoScroll, setAutoScroll] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 订阅日志
  useEffect(() => {
    getWsClient()?.send({ type: "subscribe_log" });
  }, []);

  // 监听原生 WS 消息（通过自定义事件桥接）
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.type === "log") {
        setLogs(detail.payload as LogEntry[]);
      } else if (detail?.type === "log_entry") {
        setLogs(prev => {
          const next = [...prev, detail.payload as LogEntry];
          return next.length > 500 ? next.slice(-500) : next;
        });
      }
    };
    window.addEventListener("ws-log", handler);
    return () => window.removeEventListener("ws-log", handler);
  }, []);

  // 自动滚动
  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs, autoScroll]);

  // 检测手动滚动
  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    setAutoScroll(atBottom);
  };

  const filtered = filter === "all" ? logs : logs.filter(l => l.direction === filter);

  const dirColors: Record<string, string> = {
    in: "text-accent",
    out: "text-success",
    system: "text-accent-warm",
  };

  return (
    <div className="flex flex-col h-[calc(100vh-200px)]">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-lg font-semibold text-txt">日志</h2>
          <p className="text-sm text-txt-muted">{filtered.length} 条记录</p>
        </div>
        <div className="flex items-center gap-2">
          {(["all", "in", "out", "system"] as LogLevel[]).map(l => (
            <button key={l} onClick={() => setFilter(l)} className={`px-2 py-1 rounded text-[11px] ${filter === l ? "bg-accent/10 text-accent font-medium" : "text-txt-muted hover:text-txt"}`}>
              {l === "all" ? "全部" : l}
            </button>
          ))}
          <button onClick={() => setLogs([])} className="ml-2 px-2 py-1 rounded text-[11px] text-txt-muted hover:text-danger">清空</button>
        </div>
      </div>

      <div ref={containerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto rounded-lg bg-bg-elevated border border-bdr p-3 font-mono text-xs space-y-1">
        {filtered.length === 0 ? (
          <div className="text-txt-muted text-center py-8">暂无日志</div>
        ) : (
          filtered.map((log, i) => (
            <div key={i} className="flex gap-2">
              <span className="text-txt-muted shrink-0">{new Date(log.timestamp).toLocaleTimeString()}</span>
              <span className={`shrink-0 w-12 ${dirColors[log.direction] || "text-txt-muted"}`}>[{log.direction}]</span>
              <span className="text-txt break-all">{log.content}</span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
      {!autoScroll && (
        <button onClick={() => { setAutoScroll(true); bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }} className="mt-2 mx-auto px-3 py-1.5 rounded-lg text-xs bg-accent text-white hover:bg-accent/90">跳到底部</button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd D:/agent-codes/myagents
git add gui-v2/src/components/settings/LogsSection.tsx
git commit -m "feat(gui): add real-time log viewer with filtering and auto-scroll"
```

---

### Task 7: 集成 — WS 消息处理 + SettingsView 替换

**Files:**
- Modify: `gui-v2/src/hooks/useWebSocket.ts`
- Modify: `gui-v2/src/components/settings/SettingsView.tsx`

- [ ] **Step 1: 在 useWebSocket 中添加 config / log 消息处理**

在 `gui-v2/src/hooks/useWebSocket.ts` 中：

1. 在文件顶部导入区添加：

```ts
import { useConfigStore } from "@/stores/config";
```

2. 在 `useWebSocket` 函数内，其他 store 引用之后添加：

```ts
const setConfig = useConfigStore((s) => s.setConfig);
```

3. 在 `useEffect` 内的 switch 中，`case "error"` 之前添加：

```ts
        case "config": {
          const p = msg.payload as {
            providers?: Record<string, unknown>;
            channels?: Record<string, unknown>;
            mcpServers?: Record<string, unknown>;
          };
          setConfig({
            providers: (p.providers || {}) as any,
            channels: (p.channels || {}) as any,
            mcpServers: (p.mcpServers || {}) as any,
          });
          break;
        }

        case "config_updated": {
          // 配置已更新，重新拉取
          wsClient?.send({ type: "get_config" });
          break;
        }

        case "log": {
          // 初始日志批量加载
          window.dispatchEvent(new CustomEvent("ws-log", { detail: msg }));
          break;
        }

        case "log_entry": {
          // 实时日志条目
          window.dispatchEvent(new CustomEvent("ws-log", { detail: msg }));
          break;
        }
```

4. 在 `_connected` case 中，`wsClient?.send({ type: "get_state" })` 之后添加：

```ts
          wsClient?.send({ type: "get_config" });
```

5. 更新 useEffect 依赖数组，添加 `setConfig`。

- [ ] **Step 2: 替换 SettingsView 中的 PlaceholderSection**

在 `gui-v2/src/components/settings/SettingsView.tsx` 中：

1. 在文件顶部添加导入：

```ts
import { ProvidersSection } from "./ProvidersSection";
import { ChannelsSection } from "./ChannelsSection";
import { McpSection } from "./McpSection";
import { LogsSection } from "./LogsSection";
```

2. 替换 4 个 PlaceholderSection：

```tsx
{settingsSection === "providers" && <ProvidersSection />}
{settingsSection === "channels" && <ChannelsSection />}
{settingsSection === "mcp" && <McpSection />}
{settingsSection === "logs" && <LogsSection />}
```

- [ ] **Step 3: 验证编译**

Run: `cd D:/agent-codes/myagents/gui-v2 && npx tsc --noEmit`
Expected: 无错误

Run: `cd D:/agent-codes/myagents/gui-v2 && npm run build`
Expected: 构建成功

- [ ] **Step 4: Commit**

```bash
cd D:/agent-codes/myagents
git add gui-v2/src/hooks/useWebSocket.ts gui-v2/src/components/settings/SettingsView.tsx
git commit -m "feat(gui): integrate config WS commands and replace settings placeholders"
```
