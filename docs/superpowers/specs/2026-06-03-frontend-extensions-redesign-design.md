# CoBeing 前端扩展系统重设计

**日期**: 2026-06-03
**版本**: 1.0
**状态**: 已确认

---

## 1. 概述

对前端 GUI 进行大幅重组：新增扩展页面（整合技能/MCP/插件管理）、侧栏重排、仪表盘增强、设置页精简、关于页美化。

### 1.1 目标

- 统一管理所有扩展能力（技能、MCP 服务器、插件）到单一入口
- 仪表盘成为运维监控中心（含用量与费用）
- 设置页专注于常规配置
- 所有界面保持视觉一致性
- 修复版本号硬编码问题

---

## 2. 侧栏重排

### 2.1 新排序

```
🤖 管家
👤 智能体
👥 群组
📊 仪表盘
🧩 扩展    ← 新增，替代原 ⚡ 技能
⚙️ 设置
```

### 2.2 变更

| 变更 | 说明 |
|------|------|
| 删除 `skills` view | 技能中心不再是独立页面，并入扩展页 |
| 新增 `extensions` view | 扩展页，包含技能/MCPs/插件三个 Tab |
| 顺序调整 | 仪表盘提到扩展前面，形成"主操作区 → 监控区 → 配置区"的视觉分区 |

### 2.3 涉及文件

- `gui-v2/src/lib/types.ts` — ViewType 新增 `"extensions"`，移除 `"skills"`
- `gui-v2/src/components/layout/NavBar.tsx` — 更新 NAV_ITEMS
- `gui-v2/src/components/layout/MainContent.tsx` — 新增 extensions 路由，移除 skills 路由
- `gui-v2/src/stores/settings.ts` — 移除 `skills` 相关状态（若有）

---

## 3. 扩展页面（ExtensionsView）

### 3.1 布局：Tab 式 3 栏

```
┌──────────────────────────────────────────────────┐
│ [侧栏1: NavBar]  │  [Tab Bar: 技能 | MCPs | 插件] │
│                  ├──────────┬─────────────────────┤
│  🧩 扩展          │  列表区   │     详情窗口         │
│  (与其他页共用)    │  (搜索+  │  (所选条目的完整      │
│                  │   条目+   │   信息/配置/操作)    │
│                  │   开关)   │                     │
└──────────────────┴──────────┴─────────────────────┘
```

- **顶栏 Tab**：技能 / MCPs / 插件 三个 Tab
- **左侧列表**（~240px）：搜索框 + 条目列表，每行仅名称 + 启用开关
- **右侧窗口**（flex-1）：选中条目的详细信息、配置表单、操作按钮

### 3.2 共用交互模式

- 点击列表项 → 右侧窗口显示对应详情
- 列表内开关直接 toggle 启用/禁用
- 搜索框过滤列表
- 底部添加卡片（技能：创建技能 / MCPs：添加服务器 / 插件：无，插件来自后端注册表）

### 3.3 新建文件

- `gui-v2/src/components/extensions/ExtensionsView.tsx` — 扩展页主容器，Tab 切换 + 布局
- `gui-v2/src/components/extensions/SkillsTab.tsx` — 技能 Tab（迁移自 SkillCenter）
- `gui-v2/src/components/extensions/McpsTab.tsx` — MCPs Tab（迁移自 McpSection）
- `gui-v2/src/components/extensions/PluginsTab.tsx` — 插件 Tab（全新）
- `gui-v2/src/stores/extensions.ts` — 扩展页 UI 状态（当前 Tab、选中条目等）

---

## 4. Tab 1：技能

### 4.1 功能

原 SkillCenter.tsx 完整功能迁移，额外增加启用/禁用开关。

### 4.2 列表

| 字段 | 说明 |
|------|------|
| 技能名称 | 如 `code-review` |
| 开关 | 启用/禁用（控制 Agent 工具注入白名单） |
| + 创建技能 | 底部添加卡片，点击后在右侧窗口填写表单 |

### 4.3 详情窗口

- 技能名称、描述
- 工具数量标签
- SKILL.md 文档内容（通过 WS `get_skill_doc` 获取）
- 执行按钮、编辑按钮

### 4.4 后端

WS 端点不变：`get_skills` / `get_skill_doc` / `execute_skill` / `skill_create`

### 4.5 技能开关机制

技能启用/禁用通过 `update_config` 修改全局 `skillWhitelist` 字段：
- 后端维护一个全局技能白名单（`config/default.json` 的 `skillWhitelist` 或 registry）
- 关闭某技能后，所有 Agent 的 `skill-list` / `skill-execute` 工具不再列出该技能
- 前端 toggle 即时生效，无需重启

### 4.6 创建技能

点击列表底部 "+ 创建技能" 卡片，右侧窗口显示创建表单：
- 技能名称、描述、SKILL.md 正文
- 保存 → 调用 WS `skill_create` 写入 `data/skills/` 并更新列表

---

## 5. Tab 2：MCPs

### 5.1 功能

原 `McpSection.tsx` 从设置迁移，改为列表+窗口布局。

### 5.2 列表

| 字段 | 说明 |
|------|------|
| 服务器名称 | 如 `GitHub`、`Word 文档` |
| 在线状态 | 绿色圆点 = 在线，灰色 = 已关闭 |
| 开关 | 连接/断开 |
| + 添加服务器 | 底部虚线卡片，点击后在右侧窗口显示添加表单 |

### 5.3 详情窗口

- 服务器名称、传输类型、工具数量、连接状态标签
- **连接配置**（表单）：传输方式、命令/URL、环境变量（密钥字段遮罩）
- **工具列表**（标签云）：该服务器提供的所有工具名
- 操作按钮：保存配置、测试连接、删除服务器

### 5.4 后端

- WS `update_config` 写入 `mcpServers.<name>`（现有逻辑不变）
- 新增 `test_mcp_connection` WS 端点（可选）：测试连接是否可用
- 工具列表通过 `list_plugins` 或现有 MCP 工具发现获取

### 5.5 与现有 McpSection 的差异

| 项目 | 旧 McpSection | 新 McpsTab |
|------|--------------|------------|
| 位置 | 设置 → 连接 → MCP 服务器 | 扩展 → MCPs Tab |
| 添加流程 | 在同一页面底部 | 点击"+"卡片 → 右侧窗口显示表单 |
| 开关 | "连接"/"断开"按钮 | 列表内 Toggle 开关 |
| 配置编辑 | 独立表单区 | 选中后在右侧窗口编辑 |
| 工具预览 | 无 | 标签云展示 |

---

## 6. Tab 3：插件

### 6.1 功能

全新页面。监视所有已注册插件，提供启用/关闭和可视化配置。

### 6.2 列表

| 字段 | 说明 |
|------|------|
| 插件名称 | 如 `DeepSeek`、`QQBot`、`智谱 (GLM)` |
| 版本 | `v1.0.0` |
| 开关 | 启用/禁用（对应 registry.json 的 enabled 字段） |

**不需要分类分组**。所有插件平铺，按名称字母序排列。搜索框过滤。

### 6.3 详情窗口（动态渲染）

选中插件后，窗口内容根据插件的具体配置动态渲染。不同插件展示不同内容：

**QQBot 示例**：
- 信息卡片行：版本、类型、所需 CoBeing 版本、自定义实例数
- 连接配置区：App ID、App Secret（遮罩）、Bot QQ 号、服务器地址
- 功能开关区：群消息、私聊消息、富媒体、自动审核（每个一行 toggle）

**Provider 插件示例**（如 DeepSeek）：
- 信息卡片行：版本、Base URL、模型数量
- API 密钥配置区
- 模型列表（标签云 + 每个模型的上下文窗口/最大输出）

**通用兜底**：
- 基本信息（id, name, version, kind）
- 配置 JSON 编辑器（原始 `config` 字段）

### 6.4 插件配置的数据模型

插件配置来自两个层面：

**registry.json 的 config 字段**（插件级）：
```json
{
  "plugins": {
    "qqbot": {
      "enabled": true,
      "config": {
        "appId": "123456789",
        "appSecret": "***",
        "botUin": "1234567890",
        "serverUrl": "ws://localhost:8080",
        "features": {
          "groupMessage": true,
          "privateMessage": true,
          "richMedia": false,
          "autoReview": true
        }
      }
    }
  }
}
```

**manifest (cobeing.plugin.json) 声明**配置文件格式（新增 `configSchema` 字段，可选）：
```json
{
  "configSchema": {
    "fields": [
      { "key": "appId", "label": "App ID", "type": "string", "secret": false },
      { "key": "appSecret", "label": "App Secret", "type": "string", "secret": true },
      { "key": "botUin", "label": "Bot QQ 号", "type": "string" },
      { "key": "serverUrl", "label": "服务器地址", "type": "string" }
    ],
    "features": [
      { "key": "groupMessage", "label": "群消息", "desc": "接收群聊 @ 消息" },
      { "key": "privateMessage", "label": "私聊消息", "desc": "接收私聊消息" },
      { "key": "richMedia", "label": "富媒体", "desc": "接收和发送图片、文件" },
      { "key": "autoReview", "label": "自动审核", "desc": "消息发送前经 Reviewer 审核" }
    ]
  }
}
```

若无 `configSchema`，右侧窗口显示通用 JSON 编辑器（只读 + 编辑 toggle）。

### 6.5 数据来源

- WS `list_plugins` 端点（已存在），返回 `PluginInfo[]`，需扩充 `configSchema` 字段
- 插件启用/禁用 → 新增 WS 端点 `toggle_plugin` 修改 `registry.json` 的 `enabled`
- 插件配置写入 → 新增 WS 端点 `update_plugin_config` 写入 `registry.json` 的 `config` 字段
- 自定义实例管理：已有 `add_plugin_instance` / `remove_plugin_instance` / `update_plugin_instance`

---

## 7. 仪表盘增强

### 7.1 合并用量监控

原 `UsageMonitor.tsx`（设置 → 运维 → 用量监控）的核心内容合并到 `DashboardView.tsx`。

### 7.2 统一居中卡片设计

所有卡片采用：
- 居中布局
- 图标 + 标签（上方小字）
- 大号数字
- 小字补充说明

### 7.3 卡片布局

```
┌──────────────────────────────────────────┐
│  仪表盘                    [群组筛选]     │
├──────────┬──────────┬────────────────────┤
│ ⚡ 今日   │ ⏱️ 响应  │ ❌ 错误率          │
│  12.5K   │  1.2s    │   0.3%            │
│ Token    │ 延迟     │                   │
├──────────┴──────────┴────────────────────┤
│ 💰 用量与费用                            │
│  ¥0.12    ¥3.45    78%     ¥12.80       │
│ 今日费用  本月累计  缓存命中  历史总计     │
├──────────────────────────────────────────┤
│ 🤖 Agent 活跃度（7 天）                  │
│  87       42       31       156          │
│ 管家      群主     审查者    总调用       │
├──────────────────────────────────────────┤
│ 🟢 活跃 Agent (4)                        │
│ 执行中: 管家·群组A, 群主·群组B           │
│ 排队中: 审查者, code-reviewer            │
└──────────────────────────────────────────┘
```

### 7.4 删除内容

- ❌ 工具排行卡片（ToolRankCard）
- ❌ Token 趋势迷你柱状图（TokenCard 内的 7 天趋势）
- ❌ LatencyCard 内的 24h SVG 折线图

### 7.5 涉及文件

- Modify: `gui-v2/src/components/observability/DashboardView.tsx` — 重写卡片布局
- Modify: `gui-v2/src/components/observability/TokenCard.tsx` — 改为居中样式
- Modify: `gui-v2/src/components/observability/LatencyCard.tsx` — 改为居中样式
- Delete: `gui-v2/src/components/settings/UsageMonitor.tsx` — 内容合并到 DashboardView
- Delete: `gui-v2/src/stores/usage.ts` — 合并到 observability store

---

## 8. 设置页精简

### 8.1 移除内容

| 移除 | 去向 |
|------|------|
| 用量监控 | 仪表盘 |
| MCP 服务器 | 扩展 → MCPs Tab |

### 8.2 精简后菜单

```
常规
  ├── 常规
  └── 主题
连接
  ├── Providers
  └── Channels
运维
  └── 沙箱监控
数据
  ├── 搜索对话
  ├── 日志
  ├── 导出数据
  └── 关于
```

（插件 settings-panel 动态注入保持不动）

### 8.3 涉及文件

- Modify: `gui-v2/src/components/settings/SettingsView.tsx` — 删除 usage/mcp 菜单项和相关渲染分支
- Modify: `gui-v2/src/stores/settings.ts` — `SettingsSection` 类型移除 `"usage"` `"mcp"`（或保留类型兼容）

---

## 9. 关于页美化 + 版本号修复

### 9.1 布局

居中设计：
- 应用图标/emoji（🦾）
- 产品名：CoBeing
- 大号版本号（主题色）：v1.4.0
- 副标题：多 Agent 协作框架
- 技术栈标签：React + Tauri · TypeScript · WebSocket
- 按钮：重新打开教程（当前无自动更新机制，"检查更新"按钮暂不实现，预留位置）

### 9.2 版本号获取

**方案 A（选中）**：从后端获取。在 `get_config` WS 响应中增加 `version` 字段，后端从根 `package.json` 读取。单一真实来源。

### 9.3 涉及文件

- Modify: `gui-v2/src/components/settings/SettingsView.tsx` — AboutSection 重写
- Modify: `packages/core/src/api/ws-server.ts` — `get_config` 响应新增 `version` 字段（从 package.json 读取）
- Modify: `packages/core/src/runtime.ts` — `getConfig()` 方法增加 version

---

## 10. 类型变更汇总

### 10.1 types.ts

```typescript
// ViewType 变更为:
export type ViewType = "butler" | "agents" | "groups" | "dashboard" | "extensions" | "settings";
// 移除 "skills"

// 新增 ExtensionsTab 类型:
export type ExtensionsTab = "skills" | "mcps" | "plugins";
```

### 10.2 settings.ts

```typescript
// SettingsSection 移除 "usage" "mcp"，新增：
export type SettingsSection =
  | "general" | "theme" | "providers" | "channels"
  | "sandbox" | "logs" | "search" | "export" | "about"
  | `plugin:${string}`;
```

### 10.3 plugins.ts

`PluginInfo` 可能需要扩充 `config` 字段（插件的自定义配置项）。

---

## 11. 后端 API 变更

| 端点 | 变更类型 | 说明 |
|------|----------|------|
| `get_config` | 增强 | 响应新增 `version` 字段（从根 package.json 读取） |
| `list_plugins` | 增强 | 响应中的 `PluginInfo` 新增 `configSchema` 字段（来自 manifest） |
| `toggle_plugin` | **新增** | 修改 `registry.json` 中插件的 `enabled` 状态 |
| `update_plugin_config` | **新增** | 写入 `registry.json` 中插件的 `config` 字段 |
| `add_plugin_instance` | 不变 | 已存在 |
| `remove_plugin_instance` | 不变 | 已存在 |
| `update_plugin_instance` | 不变 | 已存在 |
| `get_skills` | 不变 | 技能列表 |
| `get_skill_doc` | 不变 | 技能文档 |
| `execute_skill` | 不变 | 执行技能 |
| `skill_create` | 不变 | 创建技能 |
| `update_config` → `skillWhitelist` | **新增** | 全局技能白名单，控制技能启用/禁用 |
| `get_dashboard` | 增强 | 响应扩充用量相关字段（已在 observability DB 中） |

---

## 12. 文件变更汇总

### 新建（5 个）

| 文件 | 说明 |
|------|------|
| `gui-v2/src/components/extensions/ExtensionsView.tsx` | 扩展页主容器 |
| `gui-v2/src/components/extensions/SkillsTab.tsx` | 技能 Tab |
| `gui-v2/src/components/extensions/McpsTab.tsx` | MCPs Tab |
| `gui-v2/src/components/extensions/PluginsTab.tsx` | 插件 Tab |
| `gui-v2/src/stores/extensions.ts` | 扩展页 UI 状态 |

### 修改（~15 个）

| 文件 | 变更 |
|------|------|
| `gui-v2/src/lib/types.ts` | ViewType 变更，ExtensionsTab 新增 |
| `gui-v2/src/components/layout/NavBar.tsx` | NAV_ITEMS 更新 |
| `gui-v2/src/components/layout/MainContent.tsx` | 新增 extensions 路由，移除 skills |
| `gui-v2/src/stores/settings.ts` | SettingsSection 移除 usage/mcp |
| `gui-v2/src/components/settings/SettingsView.tsx` | 删除 usage/mcp 分支，AboutSection 重写 |
| `gui-v2/src/components/observability/DashboardView.tsx` | 重写布局，合并用量监控 |
| `gui-v2/src/components/observability/TokenCard.tsx` | 改为居中样式 |
| `gui-v2/src/components/observability/LatencyCard.tsx` | 改为居中样式 |
| `gui-v2/src/stores/observability.ts` | 扩展用量数据字段 |
| `gui-v2/src/stores/plugins.ts` | PluginInfo 可能扩充 config |
| `gui-v2/src/hooks/useWebSocket.ts` | 可能需要新增 test_mcp_connection 处理 |
| `packages/core/src/runtime.ts` | getConfig() 增加 version |
| `packages/core/src/api/ws-server.ts` | get_config 增加 version；update_config 支持插件 config |

### 删除（2 个）

| 文件 | 说明 |
|------|------|
| `gui-v2/src/components/settings/UsageMonitor.tsx` | 合并到仪表盘 |
| `gui-v2/src/stores/usage.ts` | 合并到 observability store |

功能迁移完成后，以下旧文件删除：

| 文件 | 说明 |
|------|------|
| `gui-v2/src/components/skill/SkillCenter.tsx` | 迁入 ExtensionsView/SkillsTab |
| `gui-v2/src/stores/skills.ts` | 由 SkillsTab 内联管理或合并到 extensions store |
| `gui-v2/src/components/settings/McpSection.tsx` | 迁入 ExtensionsView/McpsTab |
| `gui-v2/src/components/settings/UsageMonitor.tsx` | 合并到 DashboardView |
| `gui-v2/src/stores/usage.ts` | 合并到 observability store |

---

## 13. 非功能需求

- 构建：`pnpm build` 7 包全部通过
- 测试：417 tests 保持通过
- TypeScript：`gui-v2 tsc --noEmit` 零错误
- 现有 WS 端点向后兼容，不破坏旧客户端
- 主题 CSS 变量保持，不引入新的硬编码颜色

---

## 14. 未涉及/后续迭代

- 插件的"安装"功能（当前插件通过文件系统部署，不在前端管理安装卸载）
- 技能执行结果流式展示（当前为一次性返回）
- MCP 服务器连接状态实时监控
- 仪表盘图表（趋势图/折线图）后续版本恢复
