# 方案 10: 插件系统设计

> 来源: `docs/调研/综合调研-可执行改进方案.txt` 方案 10
> 日期: 2026-05-25

## 概述

新建 `@cobeing/plugin-sdk` 轻量包，定义插件接口和加载器。将现有 7 个 provider 和 1 个 channel 包装为内置插件。插件发现机制：配置文件声明 + `plugins/` 目录扫描，扫描到的新插件自动写入配置。

## 包结构

```
packages/plugin-sdk/           # 新建 @cobeing/plugin-sdk
├── package.json               # 仅依赖 @cobeing/shared (types)
├── tsconfig.json
└── src/
    ├── types.ts               # CoBeingPlugin, CoBeingPluginApi, ModelProviderPlugin, ChannelPlugin
    ├── loader.ts              # PluginLoader 类: discover() + loadAll()
    ├── index.ts               # 公共导出
    └── loader.test.ts

plugins/                       # 内置插件目录（项目根目录）
├── providers/
│   ├── deepseek/cobeing.plugin.json + index.ts
│   ├── zhipu/        "
│   ├── qwen/         "
│   ├── minimax/      "
│   ├── volcengine/   "
│   ├── moonshot/     "
│   └── mimo/         "
└── channels/
    └── qqbot/cobeing.plugin.json + index.ts
```

## 核心接口

### CoBeingPlugin
每个插件是一个 `CoBeingPlugin` 对象，通过 `register(api)` 向宿主注册自己的功能。

```typescript
interface CoBeingPlugin {
  id: string;
  name: string;
  kind: "model-provider" | "channel" | "tool" | "memory-backend";
  register(api: CoBeingPluginApi): void | Promise<void>;
}
```

### CoBeingPluginApi
宿主注入给插件的 API 对象，插件通过它注册 provider/channel/tool/memory-backend。

```typescript
interface CoBeingPluginApi {
  registerModelProvider(p: ModelProviderPlugin): void;
  registerChannel(c: ChannelPlugin): void;
  registerTool(t: ToolPlugin): void;
  registerMemoryBackend(b: MemoryBackendPlugin): void;
}
```

### ModelProviderPlugin / ChannelPlugin
与现有 `LLMProvider` / `ChannelAdapter` 接口对齐，但从接口改为插件注册模式：

```typescript
interface ModelProviderPlugin {
  id: string;
  models: string[];
  chat(params: ChatParams): AsyncIterable<ChatChunk>;
  chatComplete?(params: ChatParams): Promise<string>;
  listModels?(): Promise<ModelInfo[]>;
  capabilities?(model: string): ModelCapabilities;
}

interface ChannelPlugin {
  id: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  send(msg: OutboundMessage): Promise<void>;
  onMessage(handler: (msg: InboundMessage) => void): void;
  capabilities(): ChannelCapabilities;
  isConnected(): boolean;
}
```

### ToolPlugin / MemoryBackendPlugin（预留）
仅定义接口签名，不做实现适配。

## 插件清单 (`cobeing.plugin.json`)

```json
{
  "id": "cobeing-plugin-deepseek",
  "name": "DeepSeek Provider",
  "kind": "model-provider",
  "version": "0.1.0",
  "main": "index.js",
  "cobeingVersion": ">=1.2.0"
}
```

`main` 字段指向插件入口文件的相对路径（相对于清单所在目录）。入口文件默认导出 `CoBeingPlugin` 实例。

## 加载引擎 (`loader.ts`)

### PluginLoader 类

```typescript
class PluginLoader {
  private api: CoBeingPluginApi;
  private loaded: Map<string, CoBeingPlugin>;

  constructor(api: CoBeingPluginApi);

  // 扫描 plugins/ 目录，返回发现的插件清单列表
  // 对比 config.plugins，新发现的自动追加到 config
  discover(rootDir: string, configPlugins: string[]): Promise<string[]>;

  // 按插件 ID 列表加载（import + register）
  loadAll(pluginIds: string[], rootDir: string): Promise<void>;

  // 获取已加载的插件
  getLoaded(): ReadonlyMap<string, CoBeingPlugin>;
}
```

### 加载流程

1. `discover("plugins/")` → 递归扫描 `cobeing.plugin.json` → 对比 `config.plugins` 列表 → 新发现的 ID 追加到 `config.default.json` → 返回合并后的 ID 列表
2. `loadAll(mergedList)` → 每个 ID: 找到插件目录 → `import(entry)` → `plugin.register(api)` → 插件通过 api 注册 provider/channel 到全局注册表
3. `runtime.buildProviders()` → 改为从全局注册表读取，不再直接 `new`。保留热重载能力（`rebuildProvider`）

## runtime.ts 改动

`buildProviders()` 从"直接 `new OpenAICompatProvider()`"改为"从注册表读取 + 配置热重载"：

- 移除 `new OpenAICompatProvider(...)` 调用
- `providers` Map 的填充移到内置插件的 `register()` 中完成
- `rebuildProvider()` 保留热重载逻辑（配置变更时重建实例并重新注册）
- `createChannel()` 同样改为从注册表获取

## 内置插件包装器

每个 provider 插件目录包含：
1. `cobeing.plugin.json` — 清单
2. `index.ts` — 薄包装：读取 `config.json` → `new OpenAICompatProvider({...})` → `api.registerModelProvider(instance)`

Channel 同理。

## 不做（YAGNI）

- 热加载/热卸载插件（需重启）
- 插件间依赖声明
- 远程插件仓库/市场
- tool / memory-backend 实现适配（仅定义接口）

## 文件变更

| 操作 | 文件 |
|------|------|
| Create | `packages/plugin-sdk/package.json` |
| Create | `packages/plugin-sdk/tsconfig.json` |
| Create | `packages/plugin-sdk/src/types.ts` |
| Create | `packages/plugin-sdk/src/loader.ts` |
| Create | `packages/plugin-sdk/src/index.ts` |
| Create | `packages/plugin-sdk/src/loader.test.ts` |
| Create | `plugins/providers/{deepseek,zhipu,qwen,minimax,volcengine,moonshot,mimo}/cobeing.plugin.json` |
| Create | `plugins/providers/{deepseek,zhipu,qwen,minimax,volcengine,moonshot,mimo}/index.ts` |
| Create | `plugins/channels/qqbot/cobeing.plugin.json` |
| Create | `plugins/channels/qqbot/index.ts` |
| Modify | `packages/core/src/runtime.ts` — buildProviders()/createChannel() 改为注册表获取 |
| Modify | `packages/core/src/index.ts` — 可选导出 |
| Modify | `STRUCTURE.md` |
| Modify | `PROGRESS.md` / `PROGRESS-LITE.md` / `PLAN-STATUS.md` |

## 验证

- `pnpm build` 所有包通过
- `pnpm test` 所有测试通过（含新增 loader.test.ts）
- 新增的 loader.test.ts：测试 discover 扫描 + loadAll 注册流程
