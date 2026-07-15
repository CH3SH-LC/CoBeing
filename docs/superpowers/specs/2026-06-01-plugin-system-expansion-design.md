# 插件系统全能力扩展 + Provider 原生去硬编码

## 目标

1. 插件系统从 4 个注册方法扩展为全能力矩阵（Agent/Group 生命周期钩子、System Prompt 层、工具管道拦截、Skill/ToolAgent 注册、前端 UI 动态加载）
2. 原生代码仅保留 DeepSeek provider，其余 6 家全部移除，通过插件形式接入
3. DeepSeek 本身也是插件（预装在 `builtins/deepseek.ts`），与其他 provider 地位相同
4. 插件注册表 `data/plugins/registry.json` 控制启用/禁用
5. 插件目录自带 `models.json` + `ui.js`，所有能力自描述

## 核心架构

### 目录结构（变更后）

```
packages/
├── providers/src/
│   ├── base/provider-interface.ts    # LLMProvider 接口（不变）
│   └── openai-compat/openai-provider.ts  # OpenAICompatProvider 基类（不变）
│   └── catalogs/                     # [删除] 全部 7 个模型定义文件
│
├── plugin-sdk/src/
│   ├── types.ts                      # [大幅扩展] 全能力类型
│   ├── loader.ts                     # [增强] 新目录结构 + 注册表
│   ├── hook-bus.ts                   # [新增] 钩子事件总线
│   ├── prompt-layer-registry.ts      # [新增] Prompt 层注册表
│   ├── ui-extension-registry.ts      # [新增] UI 扩展注册表
│   └── builtins/
│       └── deepseek.ts               # [保留] 唯一预装插件
│       ├── (删除 zhipu/qwen/minimax/volcengine/moonshot/mimo/qqbot)
│
├── core/src/
│   ├── runtime.ts                    # [修改] 去硬编码 + 构造 HookBus 等
│   ├── agent/agent.ts                # [修改] emit 生命周期钩子
│   ├── group/manager.ts              # [修改] emit 生命周期钩子
│   ├── tools/executor.ts             # [修改] emit tool:before/after
│   ├── conversation/prompt-builder.ts # [修改] 注入 promptLayers
│   ├── conversation/conversation-loop.ts # [修改] emit message:send/receive
│   └── api/ws-server.ts              # [修改] list_ui_extensions 命令
│
├── gui-v2/src/
│   ├── hooks/useWebSocket.ts         # [修改] 处理 ui_extensions 事件
│   ├── components/plugins/           # [新增] 动态组件加载器
│   └── stores/plugins.ts             # [新增] 插件 UI store
│
data/
├── plugins/
│   ├── registry.json                 # [新增] 插件注册表
│   ├── providers/
│   │   └── deepseek/                 # [保留] 预装
│   │       ├── cobeing.plugin.json
│   │       ├── models.json           # [新增] 模型目录
│   │       └── (index.js → builtins/deepseek.ts)
│   │   ├── (删除 zhipu/qwen/minimax/volcengine/moonshot/mimo)
│   ├── channels/
│   │   └── qqbot/                    # [保留]
│   ├── tools/                        # [预创建]
│   └── extensions/                   # [预创建]
```

### 插件注册表

`data/plugins/registry.json`:
```json
{
  "version": 1,
  "plugins": {
    "cobeing-plugin-deepseek": {
      "enabled": true,
      "kind": "model-provider",
      "dir": "providers/deepseek",
      "config": {}
    },
    "cobeing-plugin-qqbot": {
      "enabled": false,
      "kind": "channel",
      "dir": "channels/qqbot",
      "config": {}
    }
  }
}
```

- `enabled: false` 的插件跳过加载
- 用户从 CoBeing-Market 下载插件 → 解压到对应目录 → 在 registry.json 中添加条目并 enable
- `cobeing.plugin.json` 只声明能力（manifest），不再用于发现；发现由 registry.json 驱动

---

## 全能力接口（CoBeingPluginApi 完整版）

```typescript
interface CoBeingPluginApi {
  // ── 现有：注册 Provider / Channel / Tool / Memory ──
  registerModelProvider(p: ModelProviderPlugin): void;
  registerChannel(c: ChannelPlugin): void;
  registerTool(t: ToolPlugin): void;
  registerMemoryBackend(b: MemoryBackendPlugin): void;

  // ── 新增：Agent 生命周期钩子 ──
  onHook(event: "agent:create",   handler: AgentLifecycleHandler): void;
  onHook(event: "agent:destroy",  handler: AgentLifecycleHandler): void;
  onHook(event: "agent:wake",     handler: AgentWakeHandler): void;
  onHook(event: "agent:sleep",    handler: AgentSleepHandler): void;

  // ── 新增：Group 生命周期钩子 ──
  onHook(event: "group:create",       handler: GroupLifecycleHandler): void;
  onHook(event: "group:destroy",      handler: GroupLifecycleHandler): void;
  onHook(event: "group:archive",      handler: GroupLifecycleHandler): void;
  onHook(event: "group:addMember",    handler: GroupMemberHandler): void;
  onHook(event: "group:removeMember", handler: GroupMemberHandler): void;

  // ── 新增：工具调用钩子（支持拦截） ──
  onHook(event: "tool:before", handler: ToolCallHandler): void;
  onHook(event: "tool:after",  handler: ToolResultHandler): void;

  // ── 新增：消息钩子（支持修改/拦截） ──
  onHook(event: "message:send",    handler: MessageHandler): void;
  onHook(event: "message:receive", handler: MessageHandler): void;

  // ── 新增：System Prompt 扩展 ──
  registerPromptLayer(layer: PromptLayer): void;

  // ── 新增：Skill / ToolAgent 注册 ──
  registerSkill(skill: SkillDefinition): void;
  registerToolAgent(agent: ToolAgentDefinition): void;

  // ── 新增：前端 UI 扩展 ──
  registerUIExtension(ext: UIExtension): void;

  // ── 新增：Runtime 访问 ──
  getConfig(): AppConfig;
  getLogger(name: string): Logger;
}
```

### 新类型定义

```typescript
type AgentLifecycleHandler = (agent: {
  id: string; name: string; role: string;
}) => void | Promise<void>;

type AgentWakeHandler = (agent: {
  id: string; name: string;
}, context: {
  groupId?: string; trigger: "mention" | "manual" | "todo" | "channel";
}) => void | Promise<void>;

type AgentSleepHandler = (agent: {
  id: string; name: string;
}, context: {
  activeSessions: string[];
}) => void | Promise<void>;

type GroupLifecycleHandler = (group: {
  id: string; name: string; ownerId: string; memberCount: number;
}) => void | Promise<void>;

type GroupMemberHandler = (
  groupId: string, agentId: string, agentName: string
) => void | Promise<void>;

type ToolCallHandler = (
  toolName: string,
  params: Record<string, unknown>,
  context: { agentId: string; groupId?: string }
) => { allow: boolean; reason?: string } | void; // void = 允许

type ToolResultHandler = (
  toolName: string,
  result: { content: string; isError?: boolean },
  context: { agentId: string; groupId?: string }
) => void | Promise<void>;

type MessageHandler = (
  message: { content: string; metadata?: Record<string, unknown> },
  context: { agentId: string; groupId?: string }
) => { content: string; metadata?: Record<string, unknown> } | null | void;
// null = 拦截（不发），void = 原样通过，返回对象 = 修改后发送

interface PromptLayer {
  id: string;
  priority: number; // 数字越小越靠前
  build(context: { agentId: string; groupId?: string }): string;
}

interface UIExtension {
  id: string;
  type: "settings-panel" | "dashboard-card" | "chat-action";
  label: string;
  componentPath: string; // 相对于插件目录的 ui.js 导出名
  icon?: string;
}

interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  template: string;
  tools?: string[];
}

interface ToolAgentDefinition {
  id: string;
  name: string;
  description: string;
  prompt: string;
  maxIterations?: number;
}
```

### PluginManifest 扩展

```typescript
interface PluginManifest {
  id: string;
  name: string;
  kind: "model-provider" | "channel" | "tool" | "memory-backend" | "extension";
  version: string;
  main: string;          // 入口 JS（相对于插件目录）
  models?: string;       // 模型目录文件（provider 插件）
  ui?: string;           // UI 入口（前端动态加载）
  extensions?: string[]; // 前端扩展点类型列表
  cobeingVersion?: string;
}
```

---

## HookBus 设计

```typescript
// hook-bus.ts

type HookEvent = 
  | "agent:create" | "agent:destroy" | "agent:wake" | "agent:sleep"
  | "group:create" | "group:destroy" | "group:archive"
  | "group:addMember" | "group:removeMember"
  | "tool:before" | "tool:after"
  | "message:send" | "message:receive";

type HookHandler = (...args: any[]) => any;

class HookBus {
  private handlers = new Map<HookEvent, Array<{ pluginId: string; handler: HookHandler }>>();

  /** 注册处理器（追加到链末端） */
  on(event: HookEvent, pluginId: string, handler: HookHandler): void;

  /**
   * 触发钩子。
   * - "intercept" 语义（tool:before, message:send）：
   *   链式调用，handler 返回 {allow:false} 或 null 则停止链并返回拦截信号
   * - "notify" 语义（其余）：
   *   并行调用所有 handler，忽略返回值和异常
   */
  emit(event: HookEvent, ...args: any[]): Promise<{ allowed: boolean; reason?: string }>;
}
```

**emit 语义分两类**：
| 事件 | 语义 | 行为 |
|---|---|---|
| agent:* / group:* / tool:after / message:receive | notify | 并行通知，忽略返回值，异常不阻断 |
| tool:before | intercept | 链式调用，`{allow:false}` 立即拦截 |
| message:send | intercept+transform | 链式调用，handler 可修改 content；`null` 拦截 |

---

## PromptLayer 注入

```typescript
// prompt-layer-registry.ts

class PromptLayerRegistry {
  private layers: PromptLayer[] = [];

  register(layer: PromptLayer): void;
  unregister(id: string): void;

  /** 按 priority 排序后返回所有 layer 的拼接内容 */
  build(context: { agentId: string; groupId?: string }): string;
}
```

在 `prompt-builder.ts` 中：
```typescript
function buildSystemPromptFromFiles(...) {
  // ... 现有逻辑 ...
  if (groupId) parts.push(GROUP_MECHANICS_NOTICE);
  // 插件 prompt 层（在所有 Agent 内容之后，volatile 之前）
  parts.push(pluginPromptLayers.build({ agentId, groupId }));
  // ... 继续现有逻辑 ...
}
```

---

## 数据流：启动

```
1. CoBeingRuntime constructor
   ├─ cleanupPendingDeletions(dataRoot)
   ├─ new HookBus()
   ├─ new PromptLayerRegistry()
   ├─ new UIExtensionRegistry()
   ├─ 构造 CoBeingPluginApi，注入上述 registry
   ├─ new PluginLoader(pluginApi)
   │
   ├─ buildProviders(config):         ← [变更] 只创建 deepseek
   │   └─ 如果有 config.providers.deepseek
   │        → new OpenAICompatProvider({id:"deepseek", ...})
   │        → models 从 data/plugins/providers/deepseek/models.json 读取
   │     否则
   │        → 从 registry.json 中找第一个 enabled provider
   │
   ├─ new ButlerAgent(...)
   ├─ restoreAgents()
   │
2. start()
   ├─ loadAllPlugins():               ← [变更] 统一插件加载入口
   │   ├─ 读取 data/plugins/registry.json
   │   ├─ 遍历 enabled=true 的插件
   │   ├─ PluginLoader.loadOne(id, dir)
   │   │   ├─ import(index.js) → plugin.register(api)
   │   │   │   ├─ registerModelProvider(provider) → providers Map
   │   │   │   ├─ onHook("tool:before", ...) → HookBus
   │   │   │   ├─ registerPromptLayer(...) → PromptLayerRegistry
   │   │   │   ├─ registerUIExtension(...) → UIExtensionRegistry
   │   │   │   └─ ...
   │   │   └─ 加载 models.json（如有）
   │   └─ 加载失败 → log.warn，继续
   │
   ├─ restoreAgents() / restoreGroups() / startChannels()
   └─ wsServer → broadcast UI extensions
```

---

## UI 扩展前端流

```
GUI 连接 → WS "list_ui_extensions"
         ← [{id, type, label, componentPath, icon}, ...]

前端 PluginLoader:
  for each extension:
    const module = await import(/* plugin dir */ ui.js)
    const Component = module[componentPath]
    按 type 渲染:
      "settings-panel"   → 设置页新 tab
      "dashboard-card"   → 仪表盘卡片网格
      "chat-action"      → 聊天输入框工具栏
```

动态 import 路径为插件目录的绝对路径（runtime 启动时计算好，通过 WS 传给前端）。

---

## Phase 划分

### Phase 1 — Provider 去硬编码
1. 删除 `packages/providers/src/catalogs/` 除 deepseek 外的 6 个文件
2. 修改 `catalogs/index.ts` — 移除除 deepseek 外的 PROVIDER_CATALOGS/PROVIDER_PRESETS/getProviderBaseURL
3. 删除 `packages/plugin-sdk/src/builtins/` 除 deepseek 外的 6 个 provider
4. 删除 `data/plugins/providers/` 除 deepseek 外的 6 个 manifest 目录
5. 新增 `data/plugins/registry.json` — 初始仅 deepseek enabled
6. 新增 `data/plugins/providers/deepseek/models.json` — 模型列表
7. 修改 `runtime.ts` buildProviders() — 仅 deepseek 默认
8. 修改 `runtime.ts` — 新增 loadAllPlugins() 统一入口
9. 修改 `PluginLoader` — 适配 registry.json + models.json
10. 新增 `data/plugins/tools/` + `data/plugins/extensions/` 目录（ensureDirs）
11. 更新 `default.json` — providers 默认仅 deepseek

### Phase 2 — 全能力接口 + HookBus
1. 新增 `packages/plugin-sdk/src/hook-bus.ts`
2. 新增 `packages/plugin-sdk/src/prompt-layer-registry.ts`
3. 扩展 `packages/plugin-sdk/src/types.ts` — 全能力类型
4. 修改 `runtime.ts` — 构造 HookBus/PromptLayerRegistry/UIExtensionRegistry
5. 修改 `agent/agent.ts` — emit create/destroy/wake/sleep
6. 修改 `group/manager.ts` — emit create/destroy/archive/addMember/removeMember
7. 修改 `tools/executor.ts` — emit tool:before/after
8. 修改 `conversation/prompt-builder.ts` — 注入 promptLayers
9. 修改 `conversation/conversation-loop.ts` — emit message:send/receive
10. 更新 `plugin-sdk/src/index.ts` 导出

### Phase 3 — UI 扩展 + 前端
1. 扩展 `PluginManifest` + `CoBeingPluginApi`（ui/extensions 字段）
2. 新增 `packages/plugin-sdk/src/ui-extension-registry.ts`
3. 新增 `ws-server.ts` — `list_ui_extensions` 命令
4. 新增 `gui-v2/src/components/plugins/PluginComponentLoader.tsx`
5. 新增 `gui-v2/src/stores/plugins.ts`
6. 修改 `gui-v2/src/hooks/useWebSocket.ts` — 处理 ui_extensions
7. 修改设置页/仪表盘/聊天输入框 — 渲染插件组件

---

## 向后兼容

- 旧 `config/default.json` 中有 6 家非 deepseek provider 配置 → runtime 忽略（log.warn 提示迁移为插件）
- 旧 `data/plugins/providers/` 下无 `models.json` 或 `registry.json` → PluginLoader 自动生成 registry.json
- `OpenAICompatProvider` 不变，外部插件可继续使用

## 测试策略

- HookBus 单元测试：notify 语义、intercept 语义、transform 语义、异常隔离
- PromptLayerRegistry 单元测试：priority 排序、空 context
- PluginLoader 更新：registry.json 驱动加载、models.json 解析
- catalogs 删除后确认构建通过
