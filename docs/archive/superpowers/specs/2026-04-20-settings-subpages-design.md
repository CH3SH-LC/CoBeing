# 设置页子页面设计

日期: 2026-04-20
状态: 已通过

## 概述

实现设置页的 4 个子页面：Providers、Channels、MCP 服务器、日志。通过 WS 命令实时读写后端配置。

## 一、后端 WS 命令扩展

在 `ws-server.ts` 中添加：

- **`get_config`** → 返回完整 AppConfig（providers/channels/mcpServers/core）
- **`update_config`** → 接收 `{ path: string, value: any }`，更新配置并持久化到 config/default.json

前端连接后通过 `get_config` 拉取配置，编辑后通过 `update_config` 推送更新。

## 二、共享 UI 模式

每个子页面统一布局：标题 + 列表（每项含编辑/删除按钮）+ 添加按钮。
点击「添加」或「编辑」弹出 Radix Dialog。

## 三、Providers 页

- 列表：名称、type、baseURL、API Key 状态（已设置/未设置）
- 编辑 Dialog：apiKeyEnv、type、baseURL
- 不展示实际 API Key，只显示环境变量名

## 四、Channels 页

- 列表：名称、type、启用状态（开关）
- 编辑 Dialog：type、enabled、以及 type 相关的额外字段（动态表单）

## 五、MCP 服务器页

- 列表：名称、transport 类型、command/url
- 添加/编辑 Dialog：transport 选择 → 根据 stdio/http 显示不同字段

## 六、日志页

- 独立窗口（window.open 或 Tauri 新窗口）
- 实时滚动日志流，连接 WS `get_log` 命令
- 支持按级别过滤（info/warn/error）
- 自动滚动到底部，新消息暂停自动滚动

## 七、新增文件

| 文件 | 职责 |
|------|------|
| `src/stores/config.ts` | 配置状态管理 + WS 通信 |
| `src/components/settings/ProvidersSection.tsx` | Providers 列表 + 编辑 |
| `src/components/settings/ChannelsSection.tsx` | Channels 列表 + 编辑 |
| `src/components/settings/McpSection.tsx` | MCP 服务器列表 + 编辑 |
| `src/components/settings/LogsSection.tsx` | 日志查看器 |
| 修改 `packages/core/src/api/ws-server.ts` | 添加 get_config / update_config 命令 |
| 修改 `gui-v2/src/components/settings/SettingsView.tsx` | 替换 PlaceholderSection |
| 修改 `gui-v2/src/hooks/useWebSocket.ts` | 处理 config/log WS 消息 |
