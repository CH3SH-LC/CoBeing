# 系统托盘 + Tauri 打包设计

日期: 2026-04-20
状态: 已通过

## 概述

为 MyAgents 桌面应用添加系统托盘支持和 Windows 平台打包能力。用户可最小化到托盘、通过托盘菜单快捷操作，并生成 .exe 和 .msi 安装包。

## 技术方案

Tauri v2 原生 `tray-icon` 特性 + `tauri-plugin-notification`，所有功能通过 Tauri 内置 API 和事件系统实现。

---

## 一、系统托盘

### 1.1 架构

```
┌─────────────────┐     Tauri Event     ┌──────────────────┐
│  Rust (lib.rs)   │ ◄──────────────────► │  Frontend (React) │
│                  │                      │                  │
│  TrayIconBuilder│  tray-click          │  useTrayStore    │
│  MenuItems       │  tray-menu-click     │  SettingsStore   │
│  close_requested │  new-message         │  ChatStore       │
│  Notification    │  agent-status        │                  │
└─────────────────┘                      └──────────────────┘
```

### 1.2 托盘菜单

```
┌─ MyAgents ──────────────┐
│ ▶ 显示/隐藏窗口          │
│ ─────────────────────── │
│ ● 2 个 Agent 运行中      │
│ ● Group "设计讨论" 活跃   │
│ ─────────────────────── │
│ ✕ 退出                   │
└─────────────────────────┘
```

- 状态项由前端通过 Tauri event 推送，Rust 侧动态更新菜单
- 有新消息时图标加角标或系统通知

### 1.3 关闭行为

- Rust 侧拦截窗口 `close_requested` 事件
- 读 settingsStore 的 `closeBehavior`：`"minimize"` → `window.hide()`，`"close"` → `app.exit()`
- 前端设置页增加「关闭行为」下拉选项
- 双击托盘图标：显示/隐藏主窗口

### 1.4 新消息提醒

- 前端检测到新消息时，通过 `tauri-plugin-notification` 发送系统通知
- 通知内容：发言人名称 + 消息摘要
- 点击通知可聚焦到对应会话

### 1.5 新增依赖

```toml
# Cargo.toml
tauri = { features = ["tray-icon", "image-png"] }
tauri-plugin-notification = "2"
```

### 1.6 权限配置

`capabilities/default.json` 新增：

```json
{
  "permissions": [
    "core:default",
    "opener:default",
    "notification:default",
    "core:window:default",
    "core:window:allow-close",
    "core:window:allow-hide",
    "core:window:allow-show",
    "core:window:allow-set-focus"
  ]
}
```

---

## 二、打包与分发

### 2.1 打包配置

`tauri.conf.json` bundle 部分：

```json
{
  "bundle": {
    "active": true,
    "targets": ["nsis", "msi"],
    "icon": ["icons/icon.ico", "icons/icon.png"],
    "windows": {
      "webviewInstallMode": { "type": "downloadBootstrapper" }
    }
  }
}
```

### 2.2 安装包格式

| 格式 | 工具 | 特点 |
|------|------|------|
| **NSIS (.exe)** | Tauri 内置 NSIS | 便携安装器，自定义安装路径、快捷方式 |
| **WiX (.msi)** | Tauri 内置 WiX | 企业级安装，支持静默安装 `/quiet` |

### 2.3 应用元数据

- 应用名：MyAgents
- 应用 ID：`com.myagents.app`
- 版本号：从 `package.json` 的 `version` 字段同步
- WebView2：自动下载安装（Windows 10+ 默认已内置）

### 2.4 构建命令

```bash
# 双格式构建
pnpm tauri:build

# 指定格式
pnpm tauri:build --bundles nsis    # 仅 .exe
pnpm tauri:build --bundles msi     # 仅 .msi
```

### 2.5 构建产物

```
src-tauri/target/release/bundle/
├── nsis/MyAgents_1.0.0_x64-setup.exe
└── msi/MyAgents_1.0.0_x64_en-US.msi
```

### 2.6 自动更新接口预留

- `tauri.conf.json` 中预留 `updater` 配置占位（注释掉）
- Rust 侧预留 `tauri-plugin-updater` 的注册位置

---

## 三、前端变更

### 3.1 设置页新增项

在现有设置页添加「通用」子页面：

```
通用设置
├─ 关闭行为        [最小化到托盘 ▾]
└─ 通知
    ├─ 新消息通知   [开关]
    └─ 通知声音     [开关]
```

### 3.2 新增文件

| 文件 | 用途 |
|------|------|
| `stores/tray.ts` | 托盘状态管理（运行中 Agent/Group 数量、新消息计数） |
| `hooks/useTray.ts` | 监听 Tauri 托盘事件，双向通信 |

### 3.3 SettingsStore 扩展

```ts
interface Settings {
  // ... 现有字段
  closeBehavior: 'minimize' | 'close';
  notifications: {
    enabled: boolean;
    sound: boolean;
  };
}
```

### 3.4 数据流

**前端 → Rust：**
- ChatStore 检测新消息 → trayStore.updateBadge() → emit("tray-update") → Rust 更新图标角标
- AgentStore 状态变化 → trayStore.updateStatus() → emit("tray-update") → Rust 更新菜单状态项

**Rust → 前端：**
- tray 双击 → emit("tray-toggle") → useTray → window.show()/hide()
- menu 项点击 → emit("tray-action") → useTray → 执行对应操作（显示窗口、退出等）

---

## 四、修改文件清单

| 文件 | 变更 |
|------|------|
| `src-tauri/Cargo.toml` | 添加 tray-icon 特性 + notification 插件 |
| `src-tauri/src/lib.rs` | 创建托盘、菜单、事件监听、关闭拦截 |
| `src-tauri/tauri.conf.json` | bundle 配置、窗口 close-behavior |
| `src-tauri/capabilities/default.json` | 添加 notification + window 权限 |
| `src/stores/settings.ts` | 扩展 closeBehavior + notifications 字段 |
| `src/stores/tray.ts` | 新建 — 托盘状态管理 |
| `src/hooks/useTray.ts` | 新建 — 托盘事件通信 |
| `src/components/settings/` | 通用设置子页面 |
| `gui-v2/package.json` | 添加打包相关 scripts |
