# 方案 10: 插件系统 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新建 `@cobeing/plugin-sdk` 轻量包，定义插件接口和加载器，将现有 7 provider + 1 channel 包装为内置插件，修改 runtime.ts 加载流程。

**Architecture:** 插件接口和内置包装器代码放在 `plugin-sdk` 包内一起编译（`src/builtins/` → `dist/builtins/`）。清单文件 `cobeing.plugin.json` 放在 `plugins/` 目录下，`main` 相对路径指向编译产物。PluginLoader 扫描 → import → register。runtime.ts 改为从插件注册表获取实例。

**Tech Stack:** TypeScript, Node.js fs/path, dynamic import()

---

## 文件职责

| 文件 | 职责 |
|------|------|
| `packages/plugin-sdk/src/types.ts` | 所有插件相关类型定义 |
| `packages/plugin-sdk/src/loader.ts` | PluginLoader 类：discoverSync + loadAll |
| `packages/plugin-sdk/src/index.ts` | 公共导出 |
| `packages/plugin-sdk/src/builtins/deepseek.ts` 等 7 个 | 内置 provider 插件（导出 CoBeingPlugin） |
| `packages/plugin-sdk/src/builtins/qqbot.ts` | 内置 channel 插件 |
| `plugins/providers/{id}/cobeing.plugin.json` | 清单文件（7 个），main 指向 dist/builtins/ |
| `plugins/channels/qqbot/cobeing.plugin.json` | QQ Bot 清单文件 |
| `packages/core/src/runtime.ts` | buildProviders/createChannel 改为注册表模式 |

---

### Task 1: 创建 plugin-sdk 包脚手架

**Files:**
- Create: `packages/plugin-sdk/package.json`
- Create: `packages/plugin-sdk/tsconfig.json`

- [ ] **Step 1: 创建 package.json**

```json
{
  "name": "@cobeing/plugin-sdk",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest --run"
  },
  "dependencies": {
    "@cobeing/shared": "workspace:*",
    "@cobeing/providers": "workspace:*",
    "@cobeing/channels": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "vitest": "^3.2.0"
  }
}
```

- [ ] **Step 2: 创建 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "declaration": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: 创建占位 index.ts 并安装验证**

创建 `packages/plugin-sdk/src/index.ts`（占位）:
```typescript
// placeholder
```

运行:
```bash
cd D:\agent-codes\CoBeing && pnpm install && pnpm --filter @cobeing/plugin-sdk build
```

Expected: 编译通过。

- [ ] **Step 4: 提交**

```bash
git add packages/plugin-sdk/package.json packages/plugin-sdk/tsconfig.json packages/plugin-sdk/src/index.ts pnpm-lock.yaml
git commit -m "feat: scaffold @cobeing/plugin-sdk package"
```

---

### Task 2: 定义插件类型 (types.ts)

**Files:**
- Create: `packages/plugin-sdk/src/types.ts`

- [ ] **Step 1: 写入完整类型定义**

```typescript
import type {
  ChatParams,
  ChatChunk,
  ModelInfo,
  ModelCapabilities,
  InboundMessage,
  OutboundMessage,
  ChannelCapabilities,
} from "@cobeing/shared";

// ── 插件自身 ──

export interface CoBeingPlugin {
  id: string;
  name: string;
  kind: "model-provider" | "channel" | "tool" | "memory-backend";
  register(api: CoBeingPluginApi): void | Promise<void>;
}

// ── 宿主注入给插件的 API ──

export interface CoBeingPluginApi {
  registerModelProvider(provider: ModelProviderPlugin): void;
  registerChannel(channel: ChannelPlugin): void;
  registerTool(tool: ToolPlugin): void;
  registerMemoryBackend(backend: MemoryBackendPlugin): void;
}

// ── 四种插件类型 ──

export interface ModelProviderPlugin {
  id: string;
  models: ModelInfo[];
  chat(params: ChatParams): AsyncIterable<ChatChunk>;
  chatComplete?(params: ChatParams): Promise<string>;
  listModels?(): Promise<ModelInfo[]>;
  capabilities?(model: string): ModelCapabilities;
}

export interface ChannelPlugin {
  id: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  send(msg: OutboundMessage): Promise<void>;
  onMessage(handler: (msg: InboundMessage) => void | Promise<void>): void;
  capabilities(): ChannelCapabilities;
  isConnected(): boolean;
}

export interface ToolPlugin {
  id: string;
  tools: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    execute(params: Record<string, unknown>): Promise<{ content: string; isError?: boolean }>;
  }>;
}

export interface MemoryBackendPlugin {
  id: string;
  store(key: string, value: unknown): Promise<void>;
  search(query: string, opts?: { limit?: number }): Promise<Array<{ key: string; score: number }>>;
}

// ── 插件清单（cobeing.plugin.json） ──

export interface PluginManifest {
  id: string;
  name: string;
  kind: "model-provider" | "channel" | "tool" | "memory-backend";
  version: string;
  main: string;
  cobeingVersion?: string;
}
```

- [ ] **Step 2: 更新 index.ts 导出 types**

将 `packages/plugin-sdk/src/index.ts` 替换为:
```typescript
export {
  type CoBeingPlugin,
  type CoBeingPluginApi,
  type ModelProviderPlugin,
  type ChannelPlugin,
  type ToolPlugin,
  type MemoryBackendPlugin,
  type PluginManifest,
} from "./types.js";
export { PluginLoader } from "./loader.js";
```

- [ ] **Step 3: 构建验证**

```bash
cd D:\agent-codes\CoBeing && pnpm --filter @cobeing/plugin-sdk build
```

Expected: tsc 编译通过（loader.ts 尚未创建，先注释掉 index.ts 中的 loader 导出）。

注意：index.ts 中先不导出 loader（文件还不存在）:
```typescript
export {
  type CoBeingPlugin,
  type CoBeingPluginApi,
  type ModelProviderPlugin,
  type ChannelPlugin,
  type ToolPlugin,
  type MemoryBackendPlugin,
  type PluginManifest,
} from "./types.js";
// export { PluginLoader } from "./loader.js"; // Task 3
```

- [ ] **Step 4: 提交**

```bash
git add packages/plugin-sdk/src/types.ts packages/plugin-sdk/src/index.ts
git commit -m "feat: add plugin SDK type definitions"
```

---

### Task 3: 实现 PluginLoader (TDD)

**Files:**
- Create: `packages/plugin-sdk/src/loader.ts`
- Create: `packages/plugin-sdk/src/loader.test.ts`

- [ ] **Step 1: 编写 loader 测试（先写测试）**

创建 `packages/plugin-sdk/src/loader.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { PluginLoader } from "./loader.js";
import type { CoBeingPluginApi, PluginManifest } from "./types.js";

describe("PluginLoader", () => {
  let tmpDir: string;
  let pluginsDir: string;
  let api: CoBeingPluginApi;
  let registeredProviders: string[];
  let registeredChannels: string[];

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cobeing-plugin-test-"));
    pluginsDir = path.join(tmpDir, "plugins");
    fs.mkdirSync(pluginsDir, { recursive: true });
    registeredProviders = [];
    registeredChannels = [];

    api = {
      registerModelProvider(p) { registeredProviders.push(p.id); },
      registerChannel(c) { registeredChannels.push(c.id); },
      registerTool() {},
      registerMemoryBackend() {},
    };
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it("discovers no plugins in empty directory", () => {
    const loader = new PluginLoader(api);
    const result = loader.discoverSync(pluginsDir, []);
    expect(result).toEqual([]);
  });

  it("discovers a plugin from cobeing.plugin.json", () => {
    const pluginDir = path.join(pluginsDir, "test-provider");
    fs.mkdirSync(pluginDir, { recursive: true });
    const manifest: PluginManifest = {
      id: "test-plugin",
      name: "Test Plugin",
      kind: "model-provider",
      version: "1.0.0",
      main: "index.js",
    };
    fs.writeFileSync(path.join(pluginDir, "cobeing.plugin.json"), JSON.stringify(manifest));

    const loader = new PluginLoader(api);
    const result = loader.discoverSync(pluginsDir, []);
    expect(result).toContain("test-plugin");
  });

  it("filters out already-configured plugins from discover", () => {
    const pluginDir = path.join(pluginsDir, "existing");
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.writeFileSync(path.join(pluginDir, "cobeing.plugin.json"), JSON.stringify({
      id: "existing-plugin", name: "X", kind: "model-provider", version: "1.0.0", main: "index.js",
    }));

    const loader = new PluginLoader(api);
    const result = loader.discoverSync(pluginsDir, ["existing-plugin"]);
    expect(result).toEqual([]);
  });

  it("loads a plugin and calls register", async () => {
    const pluginDir = path.join(pluginsDir, "loadable");
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.writeFileSync(path.join(pluginDir, "cobeing.plugin.json"), JSON.stringify({
      id: "loadable", name: "Loadable", kind: "model-provider", version: "1.0.0", main: "index.js",
    }));
    fs.writeFileSync(path.join(pluginDir, "index.js"), `
      export default {
        id: "loadable",
        name: "Loadable",
        kind: "model-provider",
        register(api) {
          api.registerModelProvider({ id: "loadable", models: [], chat: async function*() {} });
        }
      };
    `);

    const loader = new PluginLoader(api);
    await loader.loadAll(["loadable"], pluginsDir);

    expect(registeredProviders).toContain("loadable");
  });

  it("throws for missing plugin directory", async () => {
    const loader = new PluginLoader(api);
    await expect(loader.loadAll(["nonexistent"], pluginsDir)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
cd D:\agent-codes\CoBeing && pnpm --filter @cobeing/plugin-sdk test -- --run loader.test.ts
```

Expected: 全部 FAIL。

- [ ] **Step 3: 实现 PluginLoader**

创建 `packages/plugin-sdk/src/loader.ts`:

```typescript
import fs from "node:fs";
import path from "node:path";
import type { CoBeingPlugin, CoBeingPluginApi, PluginManifest } from "./types.js";

export class PluginLoader {
  private api: CoBeingPluginApi;
  private loaded = new Map<string, CoBeingPlugin>();

  constructor(api: CoBeingPluginApi) {
    this.api = api;
  }

  /** 同步扫描目录，返回发现的插件 ID 列表（排除已配置的） */
  discoverSync(rootDir: string, configuredIds: string[]): string[] {
    const configured = new Set(configuredIds);
    const found: string[] = [];

    if (!fs.existsSync(rootDir)) return found;

    for (const entry of fs.readdirSync(rootDir)) {
      const manifestPath = path.join(rootDir, entry, "cobeing.plugin.json");
      if (!fs.existsSync(manifestPath)) continue;

      try {
        const raw = fs.readFileSync(manifestPath, "utf-8");
        const manifest: PluginManifest = JSON.parse(raw);
        if (manifest.id && !configured.has(manifest.id)) {
          found.push(manifest.id);
        }
      } catch {
        // 跳过损坏的清单
      }
    }

    return found;
  }

  /** 按 ID 列表加载插件（每个插件 import + register） */
  async loadAll(pluginIds: string[], rootDir: string): Promise<void> {
    for (const id of pluginIds) {
      await this.loadOne(id, rootDir);
    }
  }

  private async loadOne(id: string, rootDir: string): Promise<void> {
    const entries = fs.existsSync(rootDir) ? fs.readdirSync(rootDir) : [];
    let pluginDir = "";
    let manifest: PluginManifest | null = null;

    for (const entry of entries) {
      const manifestPath = path.join(rootDir, entry, "cobeing.plugin.json");
      if (!fs.existsSync(manifestPath)) continue;
      try {
        const m: PluginManifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
        if (m.id === id) {
          pluginDir = path.join(rootDir, entry);
          manifest = m;
          break;
        }
      } catch { /* skip */ }
    }

    if (!pluginDir || !manifest) {
      throw new Error(`Plugin not found: ${id}. No cobeing.plugin.json matches this ID in ${rootDir}.`);
    }

    const entryPath = path.resolve(pluginDir, manifest.main);
    const pluginModule = await import(entryPath);
    const plugin: CoBeingPlugin = pluginModule.default || pluginModule;

    if (!plugin || typeof plugin.register !== "function") {
      throw new Error(`Plugin ${id}: entry must export a CoBeingPlugin with a register() method.`);
    }

    await plugin.register(this.api);
    this.loaded.set(id, plugin);
  }

  getLoaded(): ReadonlyMap<string, CoBeingPlugin> {
    return this.loaded;
  }
}
```

- [ ] **Step 4: 更新 index.ts 取消 loader 导出注释**

```typescript
export {
  type CoBeingPlugin,
  type CoBeingPluginApi,
  type ModelProviderPlugin,
  type ChannelPlugin,
  type ToolPlugin,
  type MemoryBackendPlugin,
  type PluginManifest,
} from "./types.js";
export { PluginLoader } from "./loader.js";
```

- [ ] **Step 5: 运行测试验证通过**

```bash
cd D:\agent-codes\CoBeing && pnpm --filter @cobeing/plugin-sdk test -- --run loader.test.ts
```

Expected: 5/5 PASS。

- [ ] **Step 6: 提交**

```bash
git add packages/plugin-sdk/src/loader.ts packages/plugin-sdk/src/loader.test.ts packages/plugin-sdk/src/index.ts
git commit -m "feat: add PluginLoader with discover + loadAll"
```

---

### Task 4: 编写内置 Provider 插件包装器（7 个）

**Files:**
- Create: `packages/plugin-sdk/src/builtins/deepseek.ts`
- Create: `packages/plugin-sdk/src/builtins/zhipu.ts`
- Create: `packages/plugin-sdk/src/builtins/qwen.ts`
- Create: `packages/plugin-sdk/src/builtins/minimax.ts`
- Create: `packages/plugin-sdk/src/builtins/volcengine.ts`
- Create: `packages/plugin-sdk/src/builtins/moonshot.ts`
- Create: `packages/plugin-sdk/src/builtins/mimo.ts`

- [ ] **Step 1: 创建 deepseek.ts 作为模板**

```typescript
/**
 * DeepSeek Provider — 内置插件
 */
import { OpenAICompatProvider, PROVIDER_CATALOGS } from "@cobeing/providers";
import type { CoBeingPlugin, CoBeingPluginApi } from "../types.js";

const plugin: CoBeingPlugin = {
  id: "cobeing-plugin-deepseek",
  name: "DeepSeek Provider",
  kind: "model-provider",

  register(api: CoBeingPluginApi): void {
    const apiKey = process.env.DEEPSEEK_API_KEY || "";
    const provider = new OpenAICompatProvider({
      id: "deepseek",
      name: "DeepSeek",
      apiKey,
      baseURL: "https://api.deepseek.com",
      models: PROVIDER_CATALOGS.deepseek,
    });
    api.registerModelProvider(provider);
  },
};

export default plugin;
```

- [ ] **Step 2: 创建其余 6 个**

按以下映射创建，只替换 id/name/apiKey env var/baseURL/catalog key:

| 文件 | 插件 ID | name | env var | baseURL | catalog |
|------|---------|------|---------|---------|---------|
| `zhipu.ts` | `cobeing-plugin-zhipu` | Zhipu / GLM | `ZHIPU_API_KEY` | `https://open.bigmodel.cn/api/paas/v4` | `zhipu` |
| `qwen.ts` | `cobeing-plugin-qwen` | Qwen | `QWEN_API_KEY` | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen` |
| `minimax.ts` | `cobeing-plugin-minimax` | MiniMax | `MINIMAX_API_KEY` | `https://api.minimaxi.com/v1` | `minimax` |
| `volcengine.ts` | `cobeing-plugin-volcengine` | Volcengine / Doubao | `VOLCENGINE_API_KEY` | `https://ark.cn-beijing.volces.com/api/v3` | `volcengine` |
| `moonshot.ts` | `cobeing-plugin-moonshot` | Moonshot / Kimi | `MOONSHOT_API_KEY` | `https://api.moonshot.cn/v1` | `moonshot` |
| `mimo.ts` | `cobeing-plugin-mimo` | MiMo | `MIMO_API_KEY` | `https://api.xiaomimimo.com/v1` | `mimo` |

- [ ] **Step 3: 构建验证**

```bash
cd D:\agent-codes\CoBeing && pnpm --filter @cobeing/plugin-sdk build
```

Expected: 编译通过，dist/builtins/ 下有 7 个 .js 文件。

- [ ] **Step 4: 提交**

```bash
git add packages/plugin-sdk/src/builtins/
git commit -m "feat: add 7 built-in provider plugin wrappers"
```

---

### Task 5: 编写内置 Channel 插件包装器 (QQ Bot)

**Files:**
- Create: `packages/plugin-sdk/src/builtins/qqbot.ts`

- [ ] **Step 1: 创建 qqbot.ts**

```typescript
/**
 * QQ Bot Channel — 内置插件
 */
import { QQBotChannel } from "@cobeing/channels";
import type { CoBeingPlugin, CoBeingPluginApi } from "../types.js";

const plugin: CoBeingPlugin = {
  id: "cobeing-plugin-qqbot",
  name: "QQ Bot Channel",
  kind: "channel",

  register(api: CoBeingPluginApi): void {
    const appId = process.env.QQBOT_APP_ID || "";
    const appSecret = process.env.QQBOT_APP_SECRET || "";
    const channel = new QQBotChannel({
      appId,
      appSecret,
      intents: 0,
    });
    api.registerChannel(channel);
  },
};

export default plugin;
```

- [ ] **Step 2: 构建验证**

```bash
cd D:\agent-codes\CoBeing && pnpm --filter @cobeing/plugin-sdk build
```

Expected: 编译通过。

- [ ] **Step 3: 提交**

```bash
git add packages/plugin-sdk/src/builtins/qqbot.ts
git commit -m "feat: add built-in QQ Bot channel plugin wrapper"
```

---

### Task 6: 创建插件清单文件 (plugins/)

**Files:**
- Create: `plugins/providers/deepseek/cobeing.plugin.json` (等 7 个)
- Create: `plugins/channels/qqbot/cobeing.plugin.json`

- [ ] **Step 1: 创建 8 个 cobeing.plugin.json**

每个文件内容（替换 id 和 name）:

`plugins/providers/deepseek/cobeing.plugin.json`:
```json
{
  "id": "cobeing-plugin-deepseek",
  "name": "DeepSeek Provider",
  "kind": "model-provider",
  "version": "0.1.0",
  "main": "../../packages/plugin-sdk/dist/builtins/deepseek.js",
  "cobeingVersion": ">=1.2.0"
}
```

其他 6 个 provider 的清单同理，替换 id 和 name。

`plugins/channels/qqbot/cobeing.plugin.json`:
```json
{
  "id": "cobeing-plugin-qqbot",
  "name": "QQ Bot Channel",
  "kind": "channel",
  "version": "0.1.0",
  "main": "../../packages/plugin-sdk/dist/builtins/qqbot.js",
  "cobeingVersion": ">=1.2.0"
}
```

- [ ] **Step 2: 提交**

```bash
git add plugins/
git commit -m "feat: add cobeing.plugin.json manifests for 7 providers + 1 channel"
```

---

### Task 7: 修改 runtime.ts — buildProviders 改为注册表模式

**Files:**
- Modify: `packages/core/src/runtime.ts`

- [ ] **Step 1: 修改 runtime.ts 头部导入**

当前第 13 行:
```typescript
import { OpenAICompatProvider, PROVIDER_CATALOGS } from "@cobeing/providers";
```

替换为:
```typescript
import { registerProvider, getProvider, getAllProviders } from "@cobeing/providers";
import { PluginLoader } from "@cobeing/plugin-sdk";
import type { CoBeingPluginApi } from "@cobeing/plugin-sdk";
```

- [ ] **Step 2: 在 CoBeingRuntime 类中添加 PluginLoader 字段**

在类字段区新增:
```typescript
private pluginLoader: PluginLoader;
```

在构造函数末尾添加:
```typescript
// 构建插件宿主 API — 桥接到现有全局注册表
const pluginApi: CoBeingPluginApi = {
  registerModelProvider(p) { registerProvider(p as any); },
  registerChannel(c) { registerChannel(c as any); },
  registerTool() {},
  registerMemoryBackend() {},
};
this.pluginLoader = new PluginLoader(pluginApi);
```

注意 `registerChannel` 需要从 `@cobeing/channels` 导入。在导入区新增:
```typescript
import { registerChannel, getChannel, getAllChannels } from "@cobeing/channels";
```

- [ ] **Step 3: 重写 buildProviders()**

将当前 `buildProviders()` 方法（第 160-179 行）替换为:

```typescript
private async buildProviders(config: AppConfig): Promise<void> {
  // 1. 扫描内置插件目录 + 对比 config，发现新插件自动追加到 config
  const builtinsDir = path.resolve("plugins/providers");
  const configuredProviderIds = Object.keys(config.providers);
  const discovered = this.pluginLoader.discoverSync(builtinsDir, configuredProviderIds);

  if (discovered.length > 0) {
    // 追加新发现的插件到 config（不覆盖已有配置）
    for (const id of discovered) {
      if (!config.providers[id]) {
        config.providers[id] = { type: "openai-compat" };
      }
    }
    log.info("Auto-registered %d new provider plugin(s): %s", discovered.length, discovered.join(", "));
  }

  // 2. 加载所有已配置的插件（内置 + 外部）
  const allProviderIds = Object.keys(config.providers);
  await this.pluginLoader.loadAll(allProviderIds, builtinsDir);

  // 3. 用 config 中的 apiKey 覆盖内置插件中从 env 读取的 key
  for (const [id, cfg] of Object.entries(config.providers)) {
    const provider = getProvider(id);
    if (!provider) {
      log.warn("Provider '%s' configured but plugin not loaded", id);
      continue;
    }

    // 如果 config 中有 apiKey，用 config 的值（支持加密存储）
    if (cfg.apiKey || cfg.apiKeyEnv) {
      const apiKey = (cfg.apiKey ? decrypt(cfg.apiKey) : "") || process.env[cfg.apiKeyEnv ?? ""] || "";
      if (apiKey) {
        // 重建 provider 实例（apiKey 可能在 config 中而非 env）
        try {
          const { OpenAICompatProvider, PROVIDER_CATALOGS } = await import("@cobeing/providers");
          const baseURL = cfg.baseURL ?? getProviderBaseURL(id);
          const newProvider = new OpenAICompatProvider({
            id,
            name: id,
            apiKey,
            baseURL,
            models: PROVIDER_CATALOGS[id] || [],
          });
          registerProvider(newProvider);
        } catch (err: any) {
          log.warn("Failed to rebuild provider %s with config apiKey: %s", id, err.message);
        }
      }
    }

    this.providers.set(id, getProvider(id)!);
    log.info("Provider ready: %s", id);
  }
}

/** 获取 provider 的默认 baseURL */
function getProviderBaseURL(id: string): string {
  const defaults: Record<string, string> = {
    deepseek: "https://api.deepseek.com",
    zhipu: "https://open.bigmodel.cn/api/paas/v4",
    qwen: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    minimax: "https://api.minimaxi.com/v1",
    volcengine: "https://ark.cn-beijing.volces.com/api/v3",
    moonshot: "https://api.moonshot.cn/v1",
    mimo: "https://api.xiaomimimo.com/v1",
  };
  return defaults[id] || "https://api.deepseek.com";
}
```

注意需要导入 `decrypt`:
```typescript
import { decrypt } from "./config/secret-store.js";
```

- [ ] **Step 4: 修改 start() 中 buildProviders 调用**

找到 `start()` 方法中 `this.buildProviders(config)` 的调用，改为 `await this.buildProviders(config)`。

- [ ] **Step 5: 重写 rebuildProvider()**

保留热重载逻辑（`rebuildProvider` 方法）以支持前端修改 apiKey 后即时生效。

- [ ] **Step 6: 构建 + 测试**

```bash
cd D:\agent-codes\CoBeing && pnpm --filter @cobeing/core build && pnpm test
```

Expected: 构建通过，335+ 测试通过。

- [ ] **Step 7: 提交**

```bash
git add packages/core/src/runtime.ts
git commit -m "feat: switch runtime provider loading to plugin-based architecture"
```

---

### Task 8: 修改 runtime.ts — createChannel 改为注册表模式

**Files:**
- Modify: `packages/core/src/runtime.ts`

- [ ] **Step 1: 修改 startChannels()**

在 `startChannels()` 开头（第 513 行前）添加插件扫描:

```typescript
private async startChannels(): Promise<void> {
  // 扫描 channel 插件目录
  const channelsDir = path.resolve("plugins/channels");
  const configuredChannelIds = Object.keys(this.config.channels).filter(k => this.config.channels[k]?.enabled);
  const discovered = this.pluginLoader.discoverSync(channelsDir, configuredChannelIds);

  if (discovered.length > 0) {
    for (const id of discovered) {
      if (!this.config.channels[id]) {
        this.config.channels[id] = { enabled: true, type: "qqbot" as const };
      }
    }
    log.info("Auto-registered %d new channel plugin(s): %s", discovered.length, discovered.join(", "));
  }

  // 加载所有 channel 插件
  const allChannels = Object.keys(this.config.channels).filter(k => this.config.channels[k]?.enabled);
  await this.pluginLoader.loadAll(allChannels, channelsDir);

  // 从注册表获取实例并启动
  for (const [id, cfg] of Object.entries(this.config.channels)) {
    if (!cfg || !cfg.enabled) continue;

    try {
      const channel = getChannel(id);
      if (!channel) {
        log.warn("Channel '%s' configured but plugin not loaded", id);
        continue;
      }
      // ... 原有的 onMessage 等逻辑保持不变
```

- [ ] **Step 2: 删除私有 createChannel() 方法**

移除 `private createChannel()` 方法（第 592 行），channel 实例现在由插件注册。

- [ ] **Step 3: 构建 + 测试**

```bash
cd D:\agent-codes\CoBeing && pnpm build && pnpm test
```

Expected: 全部通过。

- [ ] **Step 4: 提交**

```bash
git add packages/core/src/runtime.ts
git commit -m "feat: switch runtime channel loading to plugin-based architecture"
```

---

### Task 9: 更新文档

- [ ] **Step 1: 更新 PROGRESS.md 和 PROGRESS-LITE.md**

在顶部追加方案 10 完成记录。

- [ ] **Step 2: 更新 PLAN-STATUS.md**

将方案 10 移到已完成区。

- [ ] **Step 3: 更新 STRUCTURE.md**

新增 `packages/plugin-sdk/` 和 `plugins/` 目录。

- [ ] **Step 4: 提交**

```bash
git add PROGRESS.md PROGRESS-LITE.md PLAN-STATUS.md STRUCTURE.md
git commit -m "docs: add Plan 10 (plugin system) completion summary"
```

---

### Task 10: 全量验证

- [ ] **Step 1: 全量构建**

```bash
cd D:\agent-codes\CoBeing && pnpm build
```

Expected: 所有包通过。

- [ ] **Step 2: 全量测试**

```bash
cd D:\agent-codes\CoBeing && pnpm test
```

Expected: 所有测试通过。
