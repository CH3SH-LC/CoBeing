# 插件→前端动态发现架构 设计规格

## 概述

**问题**：后端插件系统成熟（8 个插件、HookBus、全能力矩阵），但前端完全硬编码。`cobeingVersion >= 1.4.0` vs 实际 `1.3.1` 导致所有插件运行时被静默禁用。即使启用，前端也无从知晓插件存在。

**目标**：建立从插件清单到前端的完整动态发现管道，使任何插件类型（provider/channel/tool/extension/未来新增）无需改前端代码即可正确显示。

---

## 1. 核心数据管道

```
registry.json → PluginLoader → runtime providers/channels Map
                                      ↓
                        list_plugins WS 端点 (新增)
                        get_state 扩充 plugins
                        get_config 合并插件数据
                                      ↓
                        前端 pluginsStore (新增)
                        单一数据源，消费全部插件能力
                                      ↓
            ┌──────────┬──────────┬──────────┬──────────┐
            ↓          ↓          ↓          ↓          ↓
      ProviderSel  ChannelSel  Settings    Dashboard   Model
                                Panels      Cards      Select
```

**原则**：前端不再包含任何 Provider/Channel/Model 硬编码列表。所有能力从 `list_plugins` 动态获取。

---

## 2. 后端变更

### 2.1 版本统一 (P0)

| 文件 | 变更 |
|------|------|
| 7 个 workspace `package.json` (root, gui-v2, core, providers, shared, channels, plugin-sdk) | `1.3.1` → `1.4.0` |
| 2 个 mcp-servers `package.json` (office, qqbot) | `1.3.1` → `1.4.0` |
| `gui-v2/src-tauri/tauri.conf.json` | `1.3.1` → `1.4.0` |

插件 manifest 的 `"cobeingVersion": ">=1.4.0"` **不变**。版本校验自然通过。

### 2.2 UI Extensions 全局变量修复 (P0)

`packages/core/src/api/ws-server.ts:330`：
```
- __cobeingUIExtensions
+ __cobeing.uiExtensions
```

### 2.3 新增 `list_plugins` WS 端点

**请求**：`{ type: "list_plugins" }`
**响应**：`{ type: "plugins", payload: PluginInfo[] }`

```typescript
interface PluginInfo {
  id: string;              // "cobeing-plugin-zhipu"
  name: string;            // "Zhipu / GLM Provider"
  kind: "model-provider" | "channel" | "tool" | "extension" | "memory-backend";
  version: string;
  enabled: boolean;

  // kind-specific
  models?: ModelInfo[];         // provider: 从 models.json / listModels() 读取
  channelType?: string;          // channel: e.g. "qqbot"
  toolDefs?: ToolDef[];          // tool
  extensions?: UIExtension[];    // extension
}
```

**实现**：
1. 从 PluginLoader 获取已加载插件列表
2. Provider 类 → 从 `getAllProviders()` 获取实例，调用 `listModels()` 或读 `models.json`
3. Channel 类 → 从 `getAllChannels()` 获取实例
4. Tool 类 → 从 `__cobeing.pluginTools` 获取
5. Extension 类 → 从 `__cobeing.uiExtensions.list()` 获取
6. `_custom` 插件实例 → 扫描 `instances/` 目录

### 2.4 新增实例管理端点

| 端点 | 请求 | 说明 |
|------|------|------|
| `add_plugin_instance` | `{ pluginId, instanceId, config }` | 在 `_custom` 插件的 `instances/` 目录写入 JSON |
| `remove_plugin_instance` | `{ pluginId, instanceId }` | 删除对应 JSON 文件 |
| `update_plugin_instance` | `{ pluginId, instanceId, config }` | 更新对应 JSON 文件 |

操作后触发热重载，`list_plugins` 返回更新后的数据。

### 2.5 `get_state` 扩充

在现有 `{ agents, groups, channels, timestamp }` 基础上追加：
```typescript
plugins: Array<{ id: string; kind: string; enabled: boolean }>
```

### 2.6 `get_config` 扩充

返回的 config 对象中：
- `providers` 合并插件注册的 Provider 条目（若 config 中未配置）
- `channels` 合并插件注册的 Channel 条目（若 config 中未配置）

Config 中的 `providers` 仅保留 `deepseek`（原生）。

---

## 3. 自定义 Provider / Channel 插件

### 3.1 存储结构

```
data/plugins/providers/_custom/
├── cobeing.plugin.json         # 插件清单
├── index.js                    # register() → 扫描 instances/ → 逐个注册
└── instances/                  # 用户实例（通过 WS 端点管理）
    ├── my-llm.json
    └── my-llm2.json

data/plugins/channels/_custom/
├── cobeing.plugin.json
├── index.js
└── instances/
    └── my-discord.json
```

### 3.2 实例 JSON 格式

```json
{
  "id": "my-llm",
  "name": "我的自部署模型",
  "kind": "model-provider",
  "apiKeyEnv": "MY_LLM_KEY",
  "baseURL": "https://api.example.com/v1"
}
```

### 3.3 `_custom` Provider 插件

```javascript
// data/plugins/providers/_custom/index.js
export default {
  id: "cobeing-plugin-custom-provider",
  name: "Custom Provider Loader",
  kind: "model-provider",
  async register(api) {
    const instancesDir = path.join(import.meta.dirname, "instances");
    if (!fs.existsSync(instancesDir)) return;
    for (const file of fs.readdirSync(instancesDir)) {
      if (!file.endsWith(".json")) continue;
      const cfg = JSON.parse(fs.readFileSync(path.join(instancesDir, file), "utf-8"));
      const apiKey = process.env[cfg.apiKeyEnv] || "";
      api.registerModelProvider(new OpenAICompatProvider({
        id: cfg.id, name: cfg.name,
        apiKey, baseURL: cfg.baseURL,
        models: cfg.models || [],
      }));
    }
  }
};
```

### 3.4 `_custom` Channel 插件

```javascript
// data/plugins/channels/_custom/index.js
export default {
  id: "cobeing-plugin-custom-channel",
  name: "Custom Channel Loader",
  kind: "channel",
  async register(api) {
    // 同 Provider 模式，扫描 instances/ → 注册 Channel
  }
};
```

---

## 4. 前端变更

### 4.1 新增文件

| 文件 | 说明 |
|------|------|
| `gui-v2/src/stores/plugins.ts` | 插件能力 Store（Zustand） |

```typescript
interface PluginsStore {
  plugins: PluginInfo[];
  providers: PluginInfo[];    // model-provider 类
  channels: PluginInfo[];     // channel 类
  loaded: boolean;

  getModels(providerId: string): ModelInfo[];
  getChannelTypes(): string[];
}
```

### 4.2 修改文件

| # | 文件 | 改动 |
|---|------|------|
| 1 | `hooks/useWebSocket.ts` | `_connected` 时发送 `list_plugins`；新增 `"plugins"` case 写入 pluginsStore |
| 2 | `lib/types.ts` | `WsStatePayload` 追加 `plugins` 字段；新增 `PluginInfo` 类型 |
| 3 | `agent/CreateAgentDialog.tsx` | **删除** `CATALOG_MODELS` 硬编码 (~73行)；provider 列表从 pluginsStore 读；models 从 `pluginInfo.models` 读 |
| 4 | `agent/AgentConfigTab.tsx` | **删除** `CATALOG_MODELS` 硬编码 (~37行)；同上 |
| 5 | `group/GroupMembersTab.tsx` | **删除** `CATALOG_MODELS` 硬编码 (~22行)；同上 |
| 6 | `settings/ProvidersSection.tsx` | `PRESETS` 保留作为快速填充模板；列表展示合并插件 providers + config providers；编辑/删除 走 `add_plugin_instance` / `remove_plugin_instance` 端点；API key 加密存储 |
| 7 | `settings/ChannelsSection.tsx` | `CHANNEL_PRESETS` 保留作为快速填充模板；类型下拉增加插件 Channel；编辑/删除 走 `add_plugin_instance` / `remove_plugin_instance` 端点 |
| 8 | `settings/SettingsView.tsx` | `MENU_SECTIONS` 尾部追加插件注册的 `settings-panel` 条目 |

### 4.3 前端影响的接口

- **Provider 选择器**（3 处统一）：从 `pluginsStore.providers` 获取列表，从 `pluginsStore.getModels(providerId)` 获取模型
- **Channel 类型选择**：从 `pluginsStore.channels` 获取可用类型
- **自定义实例**：Provider/Channel 编辑表单走 `add/remove/update_plugin_instance` WS 端点

### 4.4 未来扩展点

以下设计为插件注册但本次不实施渲染：
- **侧栏入口**：插件的 `NavBar` + `MainContent` 路由（后续）
- **仪表盘卡片**：插件注册的 `dashboard-card`（后续）
- **Chat 操作**：插件注册的 `chat-action`（后续）
- **主题注册**：插件提供的主题（后续）

---

## 5. PluginManifest 扩展

```typescript
// packages/plugin-sdk/src/types.ts

export interface PluginManifest {
  // ... 已有字段 ...
  id: string;
  name: string;
  kind: "model-provider" | "channel" | "tool" | "memory-backend" | "extension";
  version: string;
  main: string;
  models?: string;
  cobeingVersion?: string;

  // ── 新增 ──
  /** 用户可多次实例化，每个实例独立配置。实例存储在 instances/ 子目录 */
  multiInstance?: boolean;

  /** 实例配置字段定义。前端根据此 schema 渲染编辑表单 */
  configSchema?: PluginConfigSchema;

  /** 实例化时必须提供配置（无默认值） */
  configRequired?: boolean;
}

export interface PluginConfigSchema {
  fields: PluginConfigField[];
}

export interface PluginConfigField {
  key: string;
  label: string;
  type: "string" | "password" | "select" | "number";
  required?: boolean;
  placeholder?: string;
  hint?: string;
  defaultValue?: unknown;
  options?: Array<{ value: string; label: string }>;
}
```

---

## 6. 实施阶段

### Phase 1 — 版本修复 + 全局变量 (P0)
1. 10 个 package.json + tauri.conf.json → `1.4.0`
2. `ws-server.ts`: `__cobeingUIExtensions` → `__cobeing.uiExtensions`
- **验证**: `pnpm build` pass, `pnpm test` pass, 日志显示 `Plugins loaded: N > 0`

### Phase 2 — 后端 API (P1)
3. `ws-server.ts`: 新增 `list_plugins` 端点
4. `ws-server.ts`: 新增 `add/remove/update_plugin_instance` 端点
5. `ws-server.ts`: `get_state` 追加 `plugins` 字段
6. `ws-server.ts`: `get_config` 合并插件 provider/channel
- **验证**: `pnpm test` pass + WS 手动测试 `list_plugins` 返回正确数据

### Phase 3 — 自定义插件 (P1)
7. 创建 `data/plugins/providers/_custom/` 插件
8. 创建 `data/plugins/channels/_custom/` 插件
9. `registry.json` 注册两个 `_custom` 插件
- **验证**: 创建实例 JSON → 重启后 provider/channel 列表可见

### Phase 4 — 前端重构 (P2)
10. 新建 `stores/plugins.ts`
11. `useWebSocket.ts`: 处理 `plugins` 消息
12. `types.ts`: 新增 `PluginInfo` 类型
13-15. 删除 3 处 `CATALOG_MODELS` 硬编码，改用动态数据
16. `ProvidersSection`: 合并插件 providers，编辑走新端点
17. `ChannelsSection`: 合并插件 channels，编辑走新端点
18. `SettingsView`: 追加插件 settings-panel 条目
- **验证**: GUI 中 provider/channel 列表与 `list_plugins` 输出一致

### Phase 5 — UI 扩展 (P3)
19. `DashboardView`: 渲染插件 `dashboard-card` 扩展
20. `ChatView`: 渲染插件 `chat-action` 扩展
- **验证**: 插件注册的 UI 扩展在前端可见

---

## 7. 风险与测试

### 风险
- **旧用户升级**：`config/default.json` providers 清理后，旧用户自定义条目丢失。需提供从 config → instances JSON 的迁移路径。
- **`_custom` 目录与原生混合**：`data/plugins/` 下原生插件和用户实例混合，需确保 `.gitignore` 覆盖 `instances/`。

### 测试要点
- `list_plugins` 返回数量 = `registry.json` 中 enabled 数量 + `_custom` instances
- 插件 provider 的 models 从 `models.json` 或 `listModels()` 正确读取
- 前端下拉框不再出现 openai / anthropic / gemini / grok / siliconflow
- 自定义 provider 实例增删改后重启保留
- `cobeingVersion >= 1.4.0` 校验通过，所有 enabled 插件被加载
