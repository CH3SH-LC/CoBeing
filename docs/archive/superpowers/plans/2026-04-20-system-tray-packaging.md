# 系统托盘 + Tauri 打包 实施计划

> **For agentic workers:** 按项目 CLAUDE.md 规则，所有任务内联执行，禁止使用 subagents。逐步执行每个 Task 的 Step。

**Goal:** 为 MyAgents 添加 Windows 系统托盘支持（最小化到托盘、右键菜单、新消息通知）并配置 .exe + .msi 双格式打包。

**Architecture:** Tauri v2 原生 `tray-icon` 特性构建托盘菜单，`tauri-plugin-notification` 推送系统通知，Rust 侧拦截窗口关闭事件并根据用户设置决定隐藏或退出。前端通过 Tauri event 双向通信。

**Tech Stack:** Tauri v2 (Rust), React 19, Zustand, @tauri-apps/api, @tauri-apps/plugin-notification

---

## File Structure

| 操作 | 文件 | 职责 |
|------|------|------|
| 修改 | `gui-v2/src-tauri/Cargo.toml` | 添加 tray-icon 特性 + notification 插件 |
| 修改 | `gui-v2/src-tauri/src/lib.rs` | 托盘创建、菜单、关闭拦截、事件处理 |
| 修改 | `gui-v2/src-tauri/tauri.conf.json` | bundle 打包配置 (nsis + msi) |
| 修改 | `gui-v2/src-tauri/capabilities/default.json` | notification + window 权限 |
| 修改 | `gui-v2/package.json` | 添加 notification 插件前端包 |
| 修改 | `gui-v2/src/stores/settings.ts` | 扩展 closeBehavior + notifications |
| 创建 | `gui-v2/src/stores/tray.ts` | 托盘状态管理 |
| 创建 | `gui-v2/src/hooks/useTray.ts` | Tauri 托盘事件通信 |
| 修改 | `gui-v2/src/components/settings/SettingsView.tsx` | 常规设置子页面 |

---

### Task 1: Rust 依赖与权限配置

**Files:**
- Modify: `gui-v2/src-tauri/Cargo.toml`
- Modify: `gui-v2/src-tauri/capabilities/default.json`
- Modify: `gui-v2/src-tauri/tauri.conf.json`

- [ ] **Step 1: 更新 Cargo.toml — 添加 tray-icon 特性和 notification 插件**

将 `gui-v2/src-tauri/Cargo.toml` 的 `[dependencies]` 部分替换为：

```toml
[dependencies]
tauri = { version = "2", features = ["tray-icon", "image-png"] }
tauri-plugin-opener = "2"
tauri-plugin-notification = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

- [ ] **Step 2: 更新 capabilities/default.json — 添加权限**

将 `gui-v2/src-tauri/capabilities/default.json` 全部内容替换为：

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Capability for the main window",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "opener:default",
    "notification:default",
    "core:window:default",
    "core:window:allow-close",
    "core:window:allow-hide",
    "core:window:allow-show",
    "core:window:allow-set-focus",
    "core:window:allow-set-icon",
    "core:window:allow-destroy"
  ]
}
```

- [ ] **Step 3: 更新 tauri.conf.json — bundle 打包配置**

将 `gui-v2/src-tauri/tauri.conf.json` 的 `bundle` 部分替换为：

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "MyAgents",
  "version": "0.1.0",
  "identifier": "com.myagents.app",
  "build": {
    "beforeDevCommand": "npm run dev",
    "devUrl": "http://localhost:1420",
    "beforeBuildCommand": "npm run build",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "label": "main",
        "title": "MyAgents",
        "width": 1200,
        "height": 800,
        "minWidth": 900,
        "minHeight": 600
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": ["nsis", "msi"],
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ],
    "windows": {
      "webviewInstallMode": { "type": "downloadBootstrapper" }
    }
  }
}
```

注意：`windows` 数组中添加了 `"label": "main"` 以匹配 capabilities 配置。

- [ ] **Step 4: 验证 Rust 编译**

Run: `cd D:/agent-codes/myagents/gui-v2 && cargo check --manifest-path src-tauri/Cargo.toml`
Expected: 编译成功，无错误

- [ ] **Step 5: Commit**

```bash
cd D:/agent-codes/myagents
git add gui-v2/src-tauri/Cargo.toml gui-v2/src-tauri/capabilities/default.json gui-v2/src-tauri/tauri.conf.json
git commit -m "feat(gui): add tray-icon + notification deps and bundle config"
```

---

### Task 2: Rust 托盘核心逻辑

**Files:**
- Modify: `gui-v2/src-tauri/src/lib.rs`

- [ ] **Step 1: 实现完整托盘逻辑**

将 `gui-v2/src-tauri/src/lib.rs` 全部内容替换为：

```rust
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    Manager, RunEvent,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // 托盘菜单
            let toggle = MenuItem::with_id(app, "toggle", "显示/隐藏窗口", true, None::<&str>)?;
            let status = MenuItem::with_id(app, "status", "就绪", false, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;

            let menu = Menu::with_items(app, &[&toggle, &status, &sep, &quit])?;

            // 托盘图标
            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("MyAgents")
                .menu(&menu)
                .menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "toggle" => {
                        if let Some(w) = app.get_webview_window("main") {
                            if w.is_visible().unwrap_or(false) {
                                let _ = w.hide();
                            } else {
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::DoubleClick { .. } = event {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                })
                .build(app)?;

            // 拦截窗口关闭事件 — 默认最小化到托盘
            if let Some(w) = app.get_webview_window("main") {
                let window = w.clone();
                w.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        // 读取设置决定行为，默认隐藏到托盘
                        let behavior = window
                            .eval("window.__TAURI_INTERNALS__?.closeBehavior ?? 'minimize'")
                            .is_ok();

                        if !behavior {
                            // eval 失败时默认隐藏
                        }
                        // 始终阻止关闭，由前端通过 app.exit() 退出
                        api.prevent_close();
                        let _ = window.hide();
                    }
                });
            }

            // 监听前端事件：更新托盘状态文本
            app.listen("tray-update-status", |event| {
                // 状态更新通过前端 emit 触发
                let _ = event;
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_app_handle, event| {
        if let RunEvent::ExitRequested { api, .. } = event {
            // 阻止意外退出
            api.prevent_exit();
        }
    });
}
```

- [ ] **Step 2: 验证 Rust 编译**

Run: `cd D:/agent-codes/myagents/gui-v2 && cargo check --manifest-path src-tauri/Cargo.toml`
Expected: 编译成功

- [ ] **Step 3: Commit**

```bash
cd D:/agent-codes/myagents
git add gui-v2/src-tauri/src/lib.rs
git commit -m "feat(gui): implement system tray with menu, close interception, and events"
```

---

### Task 3: 前端 Tray Store

**Files:**
- Create: `gui-v2/src/stores/tray.ts`

- [ ] **Step 1: 创建托盘状态管理 store**

创建 `gui-v2/src/stores/tray.ts`：

```ts
import { create } from "zustand";

interface TrayStore {
  /** 运行中的 Agent 数量 */
  runningAgents: number;
  /** 活跃的 Group 数量 */
  activeGroups: number;
  /** 未读消息计数 */
  unreadCount: number;
  /** 状态文本（显示在托盘菜单） */
  statusText: string;

  updateStatus: (runningAgents: number, activeGroups: number) => void;
  incrementUnread: () => void;
  clearUnread: () => void;
}

export const useTrayStore = create<TrayStore>((set, get) => ({
  runningAgents: 0,
  activeGroups: 0,
  unreadCount: 0,
  statusText: "就绪",

  updateStatus: (runningAgents, activeGroups) => {
    const parts: string[] = [];
    if (runningAgents > 0) parts.push(`${runningAgents} 个 Agent 运行中`);
    if (activeGroups > 0) parts.push(`${activeGroups} 个 Group 活跃`);
    const statusText = parts.length > 0 ? parts.join("，") : "就绪";
    set({ runningAgents, activeGroups, statusText });

    // 通知 Rust 侧更新菜单
    import("@tauri-apps/api/event").then(({ emit }) => {
      emit("tray-update-status", { statusText });
    });
  },

  incrementUnread: () => {
    const unreadCount = get().unreadCount + 1;
    set({ unreadCount });
  },

  clearUnread: () => {
    set({ unreadCount: 0 });
  },
}));
```

- [ ] **Step 2: Commit**

```bash
cd D:/agent-codes/myagents
git add gui-v2/src/stores/tray.ts
git commit -m "feat(gui): add tray state management store"
```

---

### Task 4: 扩展 Settings Store

**Files:**
- Modify: `gui-v2/src/stores/settings.ts`

- [ ] **Step 1: 添加 closeBehavior 和 notifications 设置**

将 `gui-v2/src/stores/settings.ts` 全部内容替换为：

```ts
import { create } from "zustand";
import type { ViewType } from "@/lib/types";

export type SettingsSection = "general" | "theme" | "providers" | "channels" | "mcp" | "logs" | "about";
export type CloseBehavior = "minimize" | "close";

interface NotificationSettings {
  enabled: boolean;
  sound: boolean;
}

interface SettingsStore {
  activeView: ViewType;
  connected: boolean;
  detailPanelOpen: boolean;
  createAgentDialogOpen: boolean;
  createGroupDialogOpen: boolean;
  settingsSection: SettingsSection;
  closeBehavior: CloseBehavior;
  notifications: NotificationSettings;

  setActiveView: (view: ViewType) => void;
  setConnected: (val: boolean) => void;
  toggleDetailPanel: () => void;
  setDetailPanelOpen: (open: boolean) => void;
  setCreateAgentDialogOpen: (open: boolean) => void;
  setCreateGroupDialogOpen: (open: boolean) => void;
  setSettingsSection: (section: SettingsSection) => void;
  setCloseBehavior: (behavior: CloseBehavior) => void;
  setNotifications: (settings: Partial<NotificationSettings>) => void;
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  activeView: "chat",
  connected: false,
  detailPanelOpen: false,
  createAgentDialogOpen: false,
  createGroupDialogOpen: false,
  settingsSection: "theme",
  closeBehavior: "minimize",
  notifications: { enabled: true, sound: true },

  setActiveView: (view) => set({ activeView: view }),
  setConnected: (val) => set({ connected: val }),
  toggleDetailPanel: () => set((s) => ({ detailPanelOpen: !s.detailPanelOpen })),
  setDetailPanelOpen: (open) => set({ detailPanelOpen: open }),
  setCreateAgentDialogOpen: (open) => set({ createAgentDialogOpen: open }),
  setCreateGroupDialogOpen: (open) => set({ createGroupDialogOpen: open }),
  setSettingsSection: (section) => set({ settingsSection: section }),
  setCloseBehavior: (behavior) => set({ closeBehavior: behavior }),
  setNotifications: (settings) =>
    set((s) => ({ notifications: { ...s.notifications, ...settings } })),
}));
```

- [ ] **Step 2: Commit**

```bash
cd D:/agent-codes/myagents
git add gui-v2/src/stores/settings.ts
git commit -m "feat(gui): extend settings store with closeBehavior and notifications"
```

---

### Task 5: 前端托盘 Hook

**Files:**
- Create: `gui-v2/src/hooks/useTray.ts`

- [ ] **Step 1: 创建托盘事件通信 hook**

创建 `gui-v2/src/hooks/useTray.ts`：

```ts
import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useSettingsStore } from "@/stores/settings";
import { useTrayStore } from "@/stores/tray";
import { useAgentsStore } from "@/stores/agents";
import { useGroupsStore } from "@/stores/groups";

/**
 * 托盘事件通信 Hook。
 * 监听前端状态变化，推送给 Rust 侧更新托盘菜单。
 */
export function useTray() {
  const closeBehavior = useSettingsStore((s) => s.closeBehavior);
  const notifications = useSettingsStore((s) => s.notifications);
  const agents = useAgentsStore((s) => s.agents);
  const groups = useGroupsStore((s) => s.groups);
  const updateStatus = useTrayStore((s) => s.updateStatus);
  const incrementUnread = useTrayStore((s) => s.incrementUnread);
  const clearUnread = useTrayStore((s) => s.clearUnread);

  // 暴露 closeBehavior 给 Rust 侧窗口关闭事件读取
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__TAURI_CLOSE_BEHAVIOR__ = closeBehavior;
  }, [closeBehavior]);

  // 监听 Agent/Group 状态变化，更新托盘
  useEffect(() => {
    const runningAgents = agents.filter((a) => a.status === "running").length;
    const activeGroups = groups.filter((g) => g.members.length > 0).length;
    updateStatus(runningAgents, activeGroups);
  }, [agents, groups, updateStatus]);

  // 监听窗口焦点变化 — 获得焦点时清除未读
  useEffect(() => {
    const unlisten = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (focused) clearUnread();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [clearUnread]);

  // 监听 Rust 侧托盘动作
  useEffect(() => {
    const unlisten = listen<string>("tray-action", (event) => {
      if (event.payload === "quit") {
        getCurrentWindow().destroy();
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);
}

/**
 * 通知调用工具 — 当收到新消息时调用。
 * 根据 settings.notifications.enabled 决定是否发送系统通知。
 */
export async function sendNotification(title: string, body: string) {
  const enabled = useSettingsStore.getState().notifications.enabled;
  if (!enabled) return;

  try {
    const { sendNotification } = await import("@tauri-apps/plugin-notification");
    if (sendNotification) {
      sendNotification({ title, body });
    }
  } catch {
    // notification 插件不可用时静默失败
  }
}
```

- [ ] **Step 2: 安装前端 notification 插件依赖**

Run: `cd D:/agent-codes/myagents/gui-v2 && pnpm add @tauri-apps/plugin-notification`

Expected: 安装成功

- [ ] **Step 3: Commit**

```bash
cd D:/agent-codes/myagents
git add gui-v2/src/hooks/useTray.ts gui-v2/package.json gui-v2/pnpm-lock.yaml
git commit -m "feat(gui): add tray communication hook and notification plugin"
```

---

### Task 6: 集成 Tray Hook 到应用

**Files:**
- Modify: `gui-v2/src/hooks/useWebSocket.ts`
- Modify: `gui-v2/src/App.tsx` (或主入口文件)

- [ ] **Step 1: 在 useWebSocket 中集成未读计数和通知**

在 `gui-v2/src/hooks/useWebSocket.ts` 文件顶部添加导入：

```ts
import { useTrayStore } from "@/stores/tray";
import { sendNotification } from "@/hooks/useTray";
```

在 `useWebSocket` 函数内部添加 tray store 引用（在其他 store 引用之后）：

```ts
const incrementUnread = useTrayStore((s) => s.incrementUnread);
```

在 `case "message"` 分支中，`direction === "in"` 的处理块内，`startWaiting()` 之后添加：

```ts
incrementUnread();
sendNotification("新消息", p.content.slice(0, 100));
```

完整的 `case "message"` 分支变为：

```ts
case "message": {
  const p = msg.payload as WsMessagePayload;
  if (p.direction === "in") {
    addMessage({
      direction: "in",
      content: p.content,
      timestamp: p.timestamp,
    });
    startWaiting();
    incrementUnread();
    sendNotification("新消息", p.content.slice(0, 100));
  } else if (p.direction === "out") {
    finalizeStream(p.content);
  } else {
    addMessage({
      direction: "system",
      content: p.content,
      timestamp: p.timestamp,
    });
  }
  break;
}
```

同时更新 `useEffect` 依赖数组，添加 `incrementUnread`。

- [ ] **Step 2: 在 App 入口挂载 useTray hook**

找到 App 入口文件（`gui-v2/src/App.tsx` 或 `gui-v2/src/main.tsx`），在组件内添加：

```ts
import { useTray } from "@/hooks/useTray";
```

在组件函数体内调用：

```ts
useTray();
```

- [ ] **Step 3: 验证 TypeScript 编译**

Run: `cd D:/agent-codes/myagents/gui-v2 && pnpm build`
Expected: 编译成功

- [ ] **Step 4: Commit**

```bash
cd D:/agent-codes/myagents
git add gui-v2/src/hooks/useWebSocket.ts gui-v2/src/App.tsx
git commit -m "feat(gui): integrate tray notifications into WebSocket message flow"
```

---

### Task 7: 常规设置页面

**Files:**
- Modify: `gui-v2/src/components/settings/SettingsView.tsx`

- [ ] **Step 1: 替换 PlaceholderSection 为 GeneralSection**

在 `gui-v2/src/components/settings/SettingsView.tsx` 中：

1. 添加导入：

```ts
import { useSettingsStore, type CloseBehavior } from "@/stores/settings";
```

（注意 `useSettingsStore` 已有导入，只需添加 `CloseBehavior`）

2. 在文件末尾（`InfoCard` 之后）添加 `GeneralSection` 组件：

```tsx
function GeneralSection() {
  const closeBehavior = useSettingsStore((s) => s.closeBehavior);
  const setCloseBehavior = useSettingsStore((s) => s.setCloseBehavior);
  const notifications = useSettingsStore((s) => s.notifications);
  const setNotifications = useSettingsStore((s) => s.setNotifications);

  return (
    <div>
      <h2 className="text-lg font-semibold text-txt mb-1">常规</h2>
      <p className="text-sm text-txt-muted mb-6">应用行为和通知设置</p>

      <div className="space-y-6 max-w-md">
        {/* 关闭行为 */}
        <div>
          <label className="text-sm font-medium text-txt block mb-2">关闭行为</label>
          <select
            value={closeBehavior}
            onChange={(e) => setCloseBehavior(e.target.value as CloseBehavior)}
            className="w-full px-3 py-2 rounded-lg bg-bg-elevated border border-bdr text-sm text-txt focus:outline-none focus:ring-2 focus:ring-accent/50"
          >
            <option value="minimize">最小化到系统托盘</option>
            <option value="close">直接退出程序</option>
          </select>
          <p className="text-[11px] text-txt-muted mt-1">
            {closeBehavior === "minimize"
              ? "关闭窗口时程序将继续在后台运行"
              : "关闭窗口时程序将完全退出"}
          </p>
        </div>

        {/* 通知设置 */}
        <div>
          <label className="text-sm font-medium text-txt block mb-3">通知</label>
          <div className="space-y-3">
            <label className="flex items-center justify-between">
              <span className="text-sm text-txt-sub">新消息通知</span>
              <button
                role="switch"
                aria-checked={notifications.enabled}
                onClick={() => setNotifications({ enabled: !notifications.enabled })}
                className={cn(
                  "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
                  notifications.enabled ? "bg-accent" : "bg-bg-elevated border border-bdr"
                )}
              >
                <span
                  className={cn(
                    "inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform",
                    notifications.enabled ? "translate-x-4" : "translate-x-0.5"
                  )}
                />
              </button>
            </label>
            <label className="flex items-center justify-between">
              <span className="text-sm text-txt-sub">通知声音</span>
              <button
                role="switch"
                aria-checked={notifications.sound}
                onClick={() => setNotifications({ sound: !notifications.sound })}
                className={cn(
                  "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
                  notifications.sound ? "bg-accent" : "bg-bg-elevated border border-bdr"
                )}
              >
                <span
                  className={cn(
                    "inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform",
                    notifications.sound ? "translate-x-4" : "translate-x-0.5"
                  )}
                />
              </button>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
```

3. 将 `settingsSection === "general"` 的渲染从：

```tsx
{settingsSection === "general" && <PlaceholderSection title="常规设置" desc="语言、日志级别、数据目录" />}
```

替换为：

```tsx
{settingsSection === "general" && <GeneralSection />}
```

- [ ] **Step 2: 验证 TypeScript 编译**

Run: `cd D:/agent-codes/myagents/gui-v2 && pnpm build`
Expected: 编译成功

- [ ] **Step 3: Commit**

```bash
cd D:/agent-codes/myagents
git add gui-v2/src/components/settings/SettingsView.tsx
git commit -m "feat(gui): add general settings page with close behavior and notifications"
```

---

### Task 8: 完善关闭行为 — Rust 侧读取前端设置

**Files:**
- Modify: `gui-v2/src-tauri/src/lib.rs`

- [ ] **Step 1: 改进关闭拦截逻辑，支持前端控制退出**

将 `gui-v2/src-tauri/src/lib.rs` 中 `on_window_event` 的关闭拦截逻辑替换为监听前端 `app-exit` 事件方案。

完整替换 `gui-v2/src-tauri/src/lib.rs` 为：

```rust
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    Manager, RunEvent,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // 托盘菜单
            let toggle = MenuItem::with_id(app, "toggle", "显示/隐藏窗口", true, None::<&str>)?;
            let status = MenuItem::with_id(app, "status", "就绪", false, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;

            let menu = Menu::with_items(app, &[&toggle, &status, &sep, &quit])?;

            // 托盘图标
            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("MyAgents")
                .menu(&menu)
                .menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "toggle" => {
                        if let Some(w) = app.get_webview_window("main") {
                            if w.is_visible().unwrap_or(false) {
                                let _ = w.hide();
                            } else {
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::DoubleClick { .. } = event {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                })
                .build(app)?;

            // 拦截窗口关闭 — 隐藏到托盘
            if let Some(w) = app.get_webview_window("main") {
                let window = w.clone();
                w.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                });
            }

            // 监听前端退出请求（当用户设置为 "close" 时）
            app.listen("app-exit", |_event| {
                std::process::exit(0);
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_app_handle, event| {
        if let RunEvent::ExitRequested { api, .. } = event {
            api.prevent_exit();
        }
    });
}
```

- [ ] **Step 2: 在 useTray.ts 中添加退出逻辑**

在 `gui-v2/src/hooks/useTray.ts` 文件顶部添加 `emit` 导入：

```ts
import { listen, emit } from "@tauri-apps/api/event";
```

添加 `exitApp` 导出函数：

```ts
/**
 * 退出应用 — 由前端发起，通知 Rust 侧退出。
 * 根据 closeBehavior 设置决定是否需要通过 emit 触发。
 */
export async function exitApp() {
  const closeBehavior = useSettingsStore.getState().closeBehavior;
  if (closeBehavior === "close") {
    await emit("app-exit");
  } else {
    // minimize 模式下，Rust 已拦截关闭并隐藏窗口，无需额外操作
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().hide();
  }
}
```

- [ ] **Step 3: 验证编译**

Run: `cd D:/agent-codes/myagents/gui-v2 && pnpm build && cargo check --manifest-path src-tauri/Cargo.toml`
Expected: 前端和 Rust 均编译成功

- [ ] **Step 4: Commit**

```bash
cd D:/agent-codes/myagents
git add gui-v2/src-tauri/src/lib.rs gui-v2/src/hooks/useTray.ts
git commit -m "feat(gui): implement close behavior with frontend-controlled exit"
```

---

### Task 9: 端到端验证

**Files:** 无新文件

- [ ] **Step 1: 启动开发模式验证**

Run: `cd D:/agent-codes/myagents/gui-v2 && pnpm tauri:dev`

手动验证清单：
1. 应用启动后系统托盘出现 MyAgents 图标
2. 右键托盘图标显示菜单（显示/隐藏、就绪、退出）
3. 双击托盘图标可显示/隐藏窗口
4. 关闭窗口 → 窗口隐藏到托盘（不退出）
5. 托盘菜单「退出」→ 程序完全退出
6. 设置页「常规」显示关闭行为和通知开关

- [ ] **Step 2: 验证打包构建**

Run: `cd D:/agent-codes/myagents/gui-v2 && pnpm tauri:build --bundles nsis`

Expected: 在 `src-tauri/target/release/bundle/nsis/` 生成 `.exe` 安装包

- [ ] **Step 3: Final Commit**

如果有任何验证修复，提交：

```bash
cd D:/agent-codes/myagents
git add -A
git commit -m "fix(gui): address issues found during e2e verification"
```

若无问题，跳过此步。
