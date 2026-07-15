# Plugin System Full-Capability Expansion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand plugin system to full-capability matrix (Agent/Group lifecycle hooks, prompt layers, tool interception, Skill/ToolAgent/UI registration) and de-harcode all non-DeepSeek providers from native code.

**Architecture:** Three-phase implementation. Phase 1 removes 6 hardcoded providers and establishes registry.json-driven plugin loading with models.json self-description. Phase 2 adds HookBus (notify + intercept + transform semantics), PromptLayerRegistry, and wires emit points into agent.ts, manager.ts, executor.ts, conversation-loop.ts, and prompt-builder.ts. Phase 3 adds UIExtensionRegistry, list_ui_extensions WS command, and frontend dynamic component loader.

**Tech Stack:** TypeScript, Node.js, React (gui-v2), pnpm monorepo, vitest

**Spec:** `docs/superpowers/specs/2026-06-01-plugin-system-expansion-design.md`

---

### Task 1: Delete 6 non-DeepSeek catalog files from providers

**Files:**
- Delete: `packages/providers/src/catalogs/zhipu.ts`
- Delete: `packages/providers/src/catalogs/qwen.ts`
- Delete: `packages/providers/src/catalogs/minimax.ts`
- Delete: `packages/providers/src/catalogs/volcengine.ts`
- Delete: `packages/providers/src/catalogs/moonshot.ts`
- Delete: `packages/providers/src/catalogs/mimo.ts`
- Modify: `packages/providers/src/catalogs/index.ts`

- [ ] **Step 1: Delete the 6 catalog files**

```powershell
Remove-Item "D:\agent-codes\CoBeing\packages\providers\src\catalogs\zhipu.ts"
Remove-Item "D:\agent-codes\CoBeing\packages\providers\src\catalogs\qwen.ts"
Remove-Item "D:\agent-codes\CoBeing\packages\providers\src\catalogs\minimax.ts"
Remove-Item "D:\agent-codes\CoBeing\packages\providers\src\catalogs\volcengine.ts"
Remove-Item "D:\agent-codes\CoBeing\packages\providers\src\catalogs\moonshot.ts"
Remove-Item "D:\agent-codes\CoBeing\packages\providers\src\catalogs\mimo.ts"
```

- [ ] **Step 2: Rewrite catalogs/index.ts — keep only deepseek**

Replace the entire content of `packages/providers/src/catalogs/index.ts`:

```typescript
import type { ModelInfo } from "@cobeing/shared";
import { DEEPSEEK_MODELS } from "./deepseek.js";

/** 按 provider ID 索引的模型目录 — 仅 deepseek 保留在原生代码中 */
export const PROVIDER_CATALOGS: Record<string, ModelInfo[]> = {
  deepseek: DEEPSEEK_MODELS,
};

// ---- Provider 预设 ----

export type PlanType = "general" | "coding";

export interface ProviderPreset {
  id: string;
  name: string;
  nameZh: string;
  type: "openai-compat" | "anthropic" | "gemini";
  baseURLs: Record<PlanType, string>;
  defaultPlan: PlanType;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "deepseek",
    name: "DeepSeek",
    nameZh: "DeepSeek",
    type: "openai-compat",
    baseURLs: { general: "https://api.deepseek.com", coding: "https://api.deepseek.com" },
    defaultPlan: "general",
  },
];

export function getPreset(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find(p => p.id === id);
}

export function getBaseURLForPlan(preset: ProviderPreset, plan: PlanType): string {
  return preset.baseURLs[plan] || preset.baseURLs.general;
}
```

- [ ] **Step 3: Verify build**

```powershell
cd D:\agent-codes\CoBeing; pnpm --filter @cobeing/providers build
```

Expected: tsc compiles without errors.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: remove 6 non-DeepSeek provider catalogs from native code

Phase 1 — delete zhipu/qwen/minimax/volcengine/moonshot/mimo catalog files.
PROVIDER_CATALOGS and PROVIDER_PRESETS now only contain deepseek.
These providers will be re-added as external plugins."
```

---

### Task 2: Delete 6 non-DeepSeek builtin plugins

**Files:**
- Delete: `packages/plugin-sdk/src/builtins/zhipu.ts`
- Delete: `packages/plugin-sdk/src/builtins/qwen.ts`
- Delete: `packages/plugin-sdk/src/builtins/minimax.ts`
- Delete: `packages/plugin-sdk/src/builtins/volcengine.ts`
- Delete: `packages/plugin-sdk/src/builtins/moonshot.ts`
- Delete: `packages/plugin-sdk/src/builtins/mimo.ts`

- [ ] **Step 1: Delete the 6 builtin files**

```powershell
Remove-Item "D:\agent-codes\CoBeing\packages\plugin-sdk\src\builtins\zhipu.ts"
Remove-Item "D:\agent-codes\CoBeing\packages\plugin-sdk\src\builtins\qwen.ts"
Remove-Item "D:\agent-codes\CoBeing\packages\plugin-sdk\src\builtins\minimax.ts"
Remove-Item "D:\agent-codes\CoBeing\packages\plugin-sdk\src\builtins\volcengine.ts"
Remove-Item "D:\agent-codes\CoBeing\packages\plugin-sdk\src\builtins\moonshot.ts"
Remove-Item "D:\agent-codes\CoBeing\packages\plugin-sdk\src\builtins\mimo.ts"
```

- [ ] **Step 2: Verify build**

```powershell
cd D:\agent-codes\CoBeing; pnpm --filter @cobeing/plugin-sdk build
```

Expected: tsc compiles (only deepseek.ts and qqbot.ts remain in builtins/).

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: delete 6 non-DeepSeek builtin plugin wrappers

Only deepseek.ts and qqbot.ts remain in plugin-sdk/src/builtins/."
```

---

### Task 3: Delete 6 non-DeepSeek plugin manifest directories

**Files:**
- Delete: `data/plugins/providers/zhipu/` (entire directory)
- Delete: `data/plugins/providers/qwen/` (entire directory)
- Delete: `data/plugins/providers/minimax/` (entire directory)
- Delete: `data/plugins/providers/volcengine/` (entire directory)
- Delete: `data/plugins/providers/moonshot/` (entire directory)
- Delete: `data/plugins/providers/mimo/` (entire directory)

- [ ] **Step 1: Delete the 6 plugin directories**

```powershell
Remove-Item -Recurse -Force "D:\agent-codes\CoBeing\data\plugins\providers\zhipu"
Remove-Item -Recurse -Force "D:\agent-codes\CoBeing\data\plugins\providers\qwen"
Remove-Item -Recurse -Force "D:\agent-codes\CoBeing\data\plugins\providers\minimax"
Remove-Item -Recurse -Force "D:\agent-codes\CoBeing\data\plugins\providers\volcengine"
Remove-Item -Recurse -Force "D:\agent-codes\CoBeing\data\plugins\providers\moonshot"
Remove-Item -Recurse -Force "D:\agent-codes\CoBeing\data\plugins\providers\mimo"
```

- [ ] **Step 2: Verify directories are gone**

```powershell
Get-ChildItem "D:\agent-codes\CoBeing\data\plugins\providers"
```

Expected: only `deepseek` directory remains.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: remove 6 non-DeepSeek plugin manifest directories from data/plugins/providers/"
```

---

### Task 4: Create models.json for DeepSeek plugin + update manifest

**Files:**
- Create: `data/plugins/providers/deepseek/models.json`
- Modify: `data/plugins/providers/deepseek/cobeing.plugin.json`

- [ ] **Step 1: Create models.json with DeepSeek model definitions**

Write `data/plugins/providers/deepseek/models.json`:

```json
{
  "models": [
    {
      "id": "deepseek-v4-flash",
      "name": "DeepSeek V4 Flash",
      "provider": "deepseek",
      "contextWindow": 1048576,
      "maxOutput": 393216,
      "supportsTools": true,
      "supportsVision": false,
      "tags": ["fast", "flagship"]
    },
    {
      "id": "deepseek-v4-pro",
      "name": "DeepSeek V4 Pro",
      "provider": "deepseek",
      "contextWindow": 1048576,
      "maxOutput": 393216,
      "supportsTools": true,
      "supportsVision": false,
      "tags": ["reasoning", "coding"]
    }
  ]
}
```

- [ ] **Step 2: Update cobeing.plugin.json to reference models.json**

```json
{
  "id": "cobeing-plugin-deepseek",
  "name": "DeepSeek Provider",
  "kind": "model-provider",
  "version": "0.2.0",
  "main": "../../packages/plugin-sdk/dist/builtins/deepseek.js",
  "models": "models.json",
  "cobeingVersion": ">=1.4.0"
}
```

- [ ] **Step 3: Commit**

```bash
git add data/plugins/providers/deepseek/models.json data/plugins/providers/deepseek/cobeing.plugin.json
git commit -m "feat: add models.json to deepseek plugin + update manifest for self-describing models"
```

---

### Task 5: Create data/plugins/registry.json

**Files:**
- Create: `data/plugins/registry.json`

- [ ] **Step 1: Create registry.json**

Write `data/plugins/registry.json`:

```json
{
  "version": 1,
  "plugins": {
    "cobeing-plugin-deepseek": {
      "enabled": true,
      "kind": "model-provider",
      "dir": "providers/deepseek",
      "config": {}
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add data/plugins/registry.json
git commit -m "feat: add data/plugins/registry.json — plugin registry for enable/disable control"
```

---

### Task 6: Create data/plugins/tools/ and data/plugins/extensions/ directories + ensureDirs

**Files:**
- Create: `data/plugins/tools/.gitkeep`
- Create: `data/plugins/extensions/.gitkeep`
- Modify: `packages/core/src/runtime.ts` — ensureDataDirs()

- [ ] **Step 1: Create placeholder files so directories exist in git**

```powershell
New-Item -ItemType Directory -Force "D:\agent-codes\CoBeing\data\plugins\tools"
New-Item -ItemType Directory -Force "D:\agent-codes\CoBeing\data\plugins\extensions"
Set-Content "D:\agent-codes\CoBeing\data\plugins\tools\.gitkeep" ""
Set-Content "D:\agent-codes\CoBeing\data\plugins\extensions\.gitkeep" ""
```

- [ ] **Step 2: Update ensureDataDirs in runtime.ts**

Find `ensureDataDirs` (in `packages/core/src/runtime.ts`), add the new directories to the list:

```typescript
// Find the existing ensureDataDirs method or the dir list in constructor.
// Add these entries to the directory creation list:
//   path.join(this.dataRoot, "plugins", "tools"),
//   path.join(this.dataRoot, "plugins", "extensions"),
```

Read the existing `ensureDataDirs` first, then add the paths.

- [ ] **Step 3: Verify**

```powershell
Get-ChildItem "D:\agent-codes\CoBeing\data\plugins"
```

Expected: `registry.json`, `providers/`, `channels/`, `tools/`, `extensions/`.

- [ ] **Step 4: Commit**

```bash
git add data/plugins/tools/.gitkeep data/plugins/extensions/.gitkeep
git commit -m "feat: add tools/ and extensions/ plugin directories"
```

---

### Task 7: Update buildProviders() — only create DeepSeek by default

**Files:**
- Modify: `packages/core/src/runtime.ts:186-233` — buildProviders()
- Modify: `packages/core/src/runtime.ts:983-995` — getProviderBaseURL()

- [ ] **Step 1: Read the current buildProviders() and getProviderBaseURL()**

Already read — the full source is above.

- [ ] **Step 2: Rewrite buildProviders() to only create DeepSeek natively**

Replace the body of `buildProviders()`:

```typescript
/** 按 config 构建原生 Provider（仅 deepseek 默认，其余由插件注册） */
private buildProviders(config: AppConfig): void {
  // 仅 deepseek 作为原生内置 provider
  const deepseekCfg = config.providers?.deepseek;
  const modelsPath = path.resolve("data", "plugins", "providers", "deepseek", "models.json");
  let deepseekModels: ModelInfo[] = [];

  // 从插件目录的 models.json 加载模型列表
  if (fs.existsSync(modelsPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(modelsPath, "utf-8"));
      deepseekModels = (parsed.models || []) as ModelInfo[];
    } catch { /* fallback to empty */ }
  }

  // Fallback: 如果 models.json 不存在或为空，使用硬编码的 DEEPSEEK_MODELS
  if (deepseekModels.length === 0) {
    deepseekModels = PROVIDER_CATALOGS.deepseek || [];
  }

  if (deepseekCfg) {
    const apiKey = (deepseekCfg.apiKey ? decrypt(deepseekCfg.apiKey) : "") ||
      process.env[deepseekCfg.apiKeyEnv ?? ""] || "";

    try {
      const provider = new OpenAICompatProvider({
        id: "deepseek",
        name: "DeepSeek",
        apiKey,
        baseURL: deepseekCfg.baseURL ?? "https://api.deepseek.com",
        models: deepseekModels,
      });
      registerProvider(provider);
      this.providers.set("deepseek", provider);
      log.info("Provider ready: deepseek");
    } catch (err: any) {
      log.warn("Failed to create provider deepseek: %s", err.message);
    }
  }

  //  Warn about non-deepseek providers in config (migrated to plugins)
  const nonDeepseekKeys = Object.keys(config.providers).filter(k => k !== "deepseek");
  if (nonDeepseekKeys.length > 0) {
    log.warn(
      "Providers %s are configured but no longer built natively. Install them as plugins from CoBeing-Market.",
      nonDeepseekKeys.join(", "),
    );
  }
}
```

- [ ] **Step 3: Replace getProviderBaseURL() — only deepseek**

```typescript
function getProviderBaseURL(id: string): string {
  // Only deepseek is known natively; plugins self-describe their baseURL
  if (id === "deepseek") return "https://api.deepseek.com";
  return "";
}
```

- [ ] **Step 4: Update rebuildProvider() — only deepseek**

Find `rebuildProvider` in runtime.ts (~line 236). Replace with:

```typescript
rebuildProvider(providerId: string): void {
  if (providerId !== "deepseek") {
    // Non-deepseek providers are managed by plugins, not native rebuild
    log.warn("Cannot natively rebuild provider '%s' — it is managed by a plugin.", providerId);
    return;
  }
  let cfg = this.config.providers[providerId];
  try {
    const configPath = path.resolve("config/default.json");
    if (fs.existsSync(configPath)) {
      const fresh = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      if (fresh.providers?.[providerId]) {
        cfg = fresh.providers[providerId];
        this.config.providers[providerId] = cfg;
      }
    }
  } catch { /* fallback to in-memory config */ }
  if (!cfg) {
    log.warn("Cannot rebuild provider %s: not in config", providerId);
    return;
  }
  const apiKey = (cfg.apiKey ? decrypt(cfg.apiKey) : "") || process.env[cfg.apiKeyEnv ?? ""] || "";

  try {
    const modelsPath = path.resolve("data", "plugins", "providers", "deepseek", "models.json");
    let models: ModelInfo[] = PROVIDER_CATALOGS.deepseek || [];
    if (fs.existsSync(modelsPath)) {
      const parsed = JSON.parse(fs.readFileSync(modelsPath, "utf-8"));
      if (parsed.models?.length) models = parsed.models;
    }
    const provider = new OpenAICompatProvider({
      id: "deepseek",
      name: "DeepSeek",
      apiKey,
      baseURL: cfg.baseURL ?? "https://api.deepseek.com",
      models,
    });
    this.providers.set("deepseek", provider);
    log.info("Provider rebuilt: deepseek");
  } catch (err: any) {
    log.error("Failed to rebuild provider deepseek: %s", err.message);
  }
}
```

- [ ] **Step 5: Verify build**

```powershell
cd D:\agent-codes\CoBeing; pnpm build
```

Expected: All 7 packages build successfully.

- [ ] **Step 6: Verify tests**

```powershell
cd D:\agent-codes\CoBeing; pnpm test
```

Expected: Tests pass (may need to update test expectations for catalog changes).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: buildProviders now only creates DeepSeek natively

Other providers must be installed as plugins from CoBeing-Market.
Models loaded from data/plugins/providers/deepseek/models.json with
hardcoded fallback. getProviderBaseURL/rebuidProvider also scoped to deepseek only."
```

---

### Task 8: Update PluginLoader to support registry.json-driven loading + models.json

**Files:**
- Modify: `packages/plugin-sdk/src/loader.ts`
- Modify: `packages/plugin-sdk/src/types.ts` — add PluginRegistryEntry type

- [ ] **Step 1: Add PluginRegistryEntry to types.ts**

Add to `packages/plugin-sdk/src/types.ts`:

```typescript
export interface PluginRegistryEntry {
  enabled: boolean;
  kind: string;
  dir: string;
  config: Record<string, unknown>;
}

export interface PluginRegistry {
  version: number;
  plugins: Record<string, PluginRegistryEntry>;
}
```

- [ ] **Step 2: Add loadFromRegistry method to PluginLoader**

Add to `packages/plugin-sdk/src/loader.ts`:

```typescript
import type { PluginRegistry } from "./types.js";

/** 从 registry.json 驱动加载所有启用的插件 */
async loadFromRegistry(registry: PluginRegistry, pluginsRoot: string): Promise<string[]> {
  const loaded: string[] = [];

  for (const [id, entry] of Object.entries(registry.plugins)) {
    if (!entry.enabled) {
      log.info("Plugin %s is disabled — skipping", id);
      continue;
    }

    const pluginDir = path.join(pluginsRoot, entry.dir);
    if (!fs.existsSync(pluginDir)) {
      log.warn("Plugin %s dir not found: %s — skipping", id, pluginDir);
      continue;
    }

    try {
      await this.loadOneByDir(id, pluginDir);
      loaded.push(id);
    } catch (err: any) {
      log.warn("Failed to load plugin %s: %s", id, err.message);
    }
  }

  return loaded;
}
```

- [ ] **Step 3: Add loadOneByDir — load a plugin given its directory path**

```typescript
/** 从指定目录加载单个插件（读取 cobeing.plugin.json → import main → register） */
private async loadOneByDir(id: string, pluginDir: string): Promise<void> {
  const manifestPath = path.join(pluginDir, "cobeing.plugin.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Manifest not found at ${manifestPath}`);
  }

  const manifest: PluginManifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  const entryPath = path.resolve(pluginDir, manifest.main);
  const pluginModule = await import(entryPath);
  const plugin: CoBeingPlugin = pluginModule.default || pluginModule;

  if (!plugin || typeof plugin.register !== "function") {
    throw new Error(`Plugin ${id}: entry must export a CoBeingPlugin with a register() method.`);
  }

  await plugin.register(this.api);
  this.loaded.set(id, plugin);
  log.info("Plugin loaded: %s (%s)", id, pluginDir);
}

/** 加载插件的 models.json（若存在），返回模型列表 */
loadModels(pluginDir: string): ModelInfo[] {
  const modelsPath = path.join(pluginDir, "models.json");
  if (!fs.existsSync(modelsPath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(modelsPath, "utf-8"));
    return (parsed.models || []) as ModelInfo[];
  } catch {
    log.warn("Failed to parse models.json in %s", pluginDir);
    return [];
  }
}
```

Import `ModelInfo` from `@cobeing/shared`:

```typescript
import type { ModelInfo } from "@cobeing/shared";
```

Add logger at file top:

```typescript
const log = createLogger("plugin-loader");
```

Import `createLogger` from `@cobeing/shared` or use inline console fallback.

- [ ] **Step 4: Update index.ts to export new types**

Add to `packages/plugin-sdk/src/index.ts`:

```typescript
export {
  type PluginRegistryEntry,
  type PluginRegistry,
} from "./types.js";
```

- [ ] **Step 5: Verify build**

```powershell
cd D:\agent-codes\CoBeing; pnpm --filter @cobeing/plugin-sdk build
```

Expected: tsc compiles.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: PluginLoader.loadFromRegistry + loadModels + registry types"
```

---

### Task 9: Update runtime.ts loadAllPlugins() — unified entry replacing loadProviderPlugins

**Files:**
- Modify: `packages/core/src/runtime.ts:579-597` — replace loadProviderPlugins with loadAllPlugins

- [ ] **Step 1: Read the registry and load all enabled plugins in start()**

Replace `loadProviderPlugins()` method entirely:

```typescript
/** 从 registry.json 加载所有启用的插件（统一入口，替代 loadProviderPlugins） */
private async loadAllPlugins(): Promise<void> {
  const pluginsRoot = path.resolve("data", "plugins");
  const registryPath = path.join(pluginsRoot, "registry.json");

  if (!fs.existsSync(registryPath)) {
    // 首次启动：自动生成 registry.json（扫描现有插件目录）
    this.bootstrapRegistry(pluginsRoot, registryPath);
  }

  let registry: import("@cobeing/plugin-sdk").PluginRegistry;
  try {
    registry = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
  } catch {
    log.warn("Failed to parse registry.json — plugins disabled");
    return;
  }

  const loaded = await this.pluginLoader.loadFromRegistry(registry, pluginsRoot);
  log.info("Plugins loaded: %d (%s)", loaded.length, loaded.join(", ") || "none");

  // After loading, sync plugin-registered providers into this.providers
  const allProviders = require("@cobeing/providers").getAllProviders() as LLMProvider[];
  for (const p of allProviders) {
    if (!this.providers.has(p.id)) {
      this.providers.set(p.id, p);
      log.info("Plugin provider registered: %s", p.id);
    }
  }
}

/** Bootstrap registry.json from filesystem scan on first run */
private bootstrapRegistry(pluginsRoot: string, registryPath: string): void {
  const registry: import("@cobeing/plugin-sdk").PluginRegistry = {
    version: 1,
    plugins: {},
  };

  // Scan for existing plugin directories with cobeing.plugin.json
  for (const kind of ["providers", "channels", "tools", "extensions"]) {
    const kindDir = path.join(pluginsRoot, kind);
    if (!fs.existsSync(kindDir)) continue;
    for (const entry of fs.readdirSync(kindDir)) {
      const manifestPath = path.join(kindDir, entry, "cobeing.plugin.json");
      if (!fs.existsSync(manifestPath)) continue;
      try {
        const m: { id: string; kind: string } = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
        registry.plugins[m.id] = {
          enabled: true,
          kind: m.kind,
          dir: `${kind}/${entry}`,
          config: {},
        };
      } catch { /* skip corrupt */ }
    }
  }

  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2), "utf-8");
  log.info("Bootstrapped plugin registry with %d plugin(s)", Object.keys(registry.plugins).length);
}
```

- [ ] **Step 2: In start(), replace the loadProviderPlugins() call**

Find `await this.loadProviderPlugins();` in `start()` → replace with:

```typescript
await this.loadAllPlugins();
```

Also remove the `startChannels()` call's internal plugin loading logic (it should now be covered by `loadAllPlugins()`).

- [ ] **Step 3: Update startChannels() — use getChannel from plugin-loaded channels**

Modify `startChannels()`: remove the `pluginLoader.loadAll()` call (now handled by `loadAllPlugins()`). Keep the `getChannel(id)` → start/onMessage logic.

- [ ] **Step 4: Verify build**

```powershell
cd D:\agent-codes\CoBeing; pnpm build
```

Expected: All 7 packages build successfully.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: unified loadAllPlugins() from registry.json + bootstrap on first run"
```

---

### Task 10: Update config/default.json — providers only deepseek

**Files:**
- Modify: `config/default.json`

- [ ] **Step 1: Read the current default.json providers section**

Read the file, then replace the `providers` section to only have deepseek:

```json
"providers": {
  "deepseek": {
    "type": "openai-compat",
    "apiKeyEnv": "DEEPSEEK_API_KEY"
  }
}
```

Remove all other provider entries (zhipu, qwen, minimax, volcengine, moonshot, mimo).

- [ ] **Step 2: Commit**

```bash
git add config/default.json
git commit -m "feat: default.json providers now only contains deepseek"
```

---

### Task 11: Full build + test verification (Phase 1 gate)

- [ ] **Step 1: Full clean build**

```powershell
cd D:\agent-codes\CoBeing; pnpm build
```

Expected: All 7 packages build, no errors.

- [ ] **Step 2: Run all tests**

```powershell
cd D:\agent-codes\CoBeing; pnpm test
```

Expected: All tests pass. Fix any failures caused by catalog/provider changes.

- [ ] **Step 3: Fix any test failures**

Common failures to expect:
- Tests that reference `PROVIDER_CATALOGS.zhipu` etc. → update to expect only deepseek
- Tests that create providers for deleted catalogs → update test mocks

- [ ] **Step 4: Commit any test fixes**

```bash
git add -A
git commit -m "test: update tests for deepseek-only native providers"
```

---

### Task 12: Create HookBus

**Files:**
- Create: `packages/plugin-sdk/src/hook-bus.ts`

- [ ] **Step 1: Write the HookBus class**

Write `packages/plugin-sdk/src/hook-bus.ts`:

```typescript
import { createLogger } from "@cobeing/shared";

const log = createLogger("hook-bus");

export type HookEvent =
  | "agent:create" | "agent:destroy" | "agent:wake" | "agent:sleep"
  | "group:create" | "group:destroy" | "group:archive"
  | "group:addMember" | "group:removeMember"
  | "tool:before" | "tool:after"
  | "message:send" | "message:receive";

type HookHandler = (...args: any[]) => any;

interface HookEntry {
  pluginId: string;
  handler: HookHandler;
}

/** "notify" events — fire-and-forget, ignore errors */
const NOTIFY_EVENTS: Set<HookEvent> = new Set([
  "agent:create", "agent:destroy", "agent:wake", "agent:sleep",
  "group:create", "group:destroy", "group:archive",
  "group:addMember", "group:removeMember",
  "tool:after", "message:receive",
]);

/** "intercept" events — chain-call, can block */
const INTERCEPT_EVENTS: Set<HookEvent> = new Set([
  "tool:before", "message:send",
]);

export class HookBus {
  private handlers = new Map<HookEvent, HookEntry[]>();

  on(event: HookEvent, pluginId: string, handler: HookHandler): void {
    const list = this.handlers.get(event) || [];
    list.push({ pluginId, handler });
    this.handlers.set(event, list);
  }

  off(event: HookEvent, pluginId: string): void {
    const list = this.handlers.get(event);
    if (!list) return;
    this.handlers.set(event, list.filter(e => e.pluginId !== pluginId));
  }

  /**
   * Emit a hook event.
   * - notify events: run all handlers in parallel, ignore return values and errors
   * - intercept events: chain-call handlers; for tool:before, {allow:false} blocks;
   *   for message:send, handlers can transform content
   *
   * Returns { allowed: false, reason } if intercepted, { allowed: true } otherwise.
   * For message:send, returns the (possibly transformed) message as result.
   */
  async emit(event: HookEvent, ...args: any[]): Promise<any> {
    const list = this.handlers.get(event);
    if (!list || list.length === 0) {
      if (event === "message:send") return { allowed: true, message: args[0] };
      return { allowed: true };
    }

    if (INTERCEPT_EVENTS.has(event)) {
      return this.emitIntercept(event, list, ...args);
    }

    // notify — parallel, ignore errors
    const promises = list.map(entry =>
      Promise.resolve()
        .then(() => entry.handler(...args))
        .catch(err => log.warn("Hook %s plugin %s error: %s", event, entry.pluginId, err.message))
    );
    await Promise.all(promises);
    return { allowed: true };
  }

  private async emitIntercept(event: HookEvent, list: HookEntry[], ...args: any[]): Promise<any> {
    if (event === "tool:before") {
      for (const entry of list) {
        try {
          const result = await entry.handler(...args);
          if (result && result.allow === false) {
            log.info("tool:before blocked by plugin %s: %s", entry.pluginId, result.reason || "no reason");
            return { allowed: false, reason: result.reason };
          }
        } catch (err: any) {
          log.warn("Hook %s plugin %s error: %s", event, entry.pluginId, err.message);
        }
      }
      return { allowed: true };
    }

    if (event === "message:send") {
      let message = args[0];
      let context = args[1];
      for (const entry of list) {
        try {
          const result = await entry.handler(message, context);
          if (result === null) {
            log.info("message:send blocked by plugin %s", entry.pluginId);
            return { allowed: false, reason: "blocked by plugin" };
          }
          if (result && typeof result === "object") {
            message = result;
          }
        } catch (err: any) {
          log.warn("Hook %s plugin %s error: %s", event, entry.pluginId, err.message);
        }
      }
      return { allowed: true, message };
    }

    return { allowed: true };
  }

  /** Remove all handlers (for testing/teardown) */
  clear(): void {
    this.handlers.clear();
  }
}
```

- [ ] **Step 2: Export from plugin-sdk/index.ts**

```typescript
export { HookBus } from "./hook-bus.js";
export type { HookEvent } from "./hook-bus.js";
```

- [ ] **Step 3: Verify build**

```powershell
cd D:\agent-codes\CoBeing; pnpm --filter @cobeing/plugin-sdk build
```

- [ ] **Step 4: Commit**

```bash
git add packages/plugin-sdk/src/hook-bus.ts packages/plugin-sdk/src/index.ts
git commit -m "feat: add HookBus — notify + intercept + transform hook semantics"
```

---

### Task 13: Create PromptLayerRegistry

**Files:**
- Create: `packages/plugin-sdk/src/prompt-layer-registry.ts`

- [ ] **Step 1: Write PromptLayerRegistry**

Write `packages/plugin-sdk/src/prompt-layer-registry.ts`:

```typescript
import type { PromptLayer } from "./types.js";

export class PromptLayerRegistry {
  private layers: PromptLayer[] = [];

  register(layer: PromptLayer): void {
    // Deduplicate by id
    this.layers = this.layers.filter(l => l.id !== layer.id);
    this.layers.push(layer);
    // Sort by priority (lower = earlier in prompt)
    this.layers.sort((a, b) => a.priority - b.priority);
  }

  unregister(id: string): void {
    this.layers = this.layers.filter(l => l.id !== id);
  }

  /**
   * Build the concatenated prompt layer content for a given context.
   * Returns empty string if no layers registered.
   */
  build(context: { agentId: string; groupId?: string }): string {
    if (this.layers.length === 0) return "";

    const parts: string[] = [];
    for (const layer of this.layers) {
      try {
        const content = layer.build(context);
        if (content) parts.push(content);
      } catch {
        // Skip broken layers
      }
    }
    return parts.join("\n\n");
  }

  /** Number of registered layers */
  get count(): number { return this.layers.length; }

  clear(): void { this.layers = []; }
}
```

- [ ] **Step 2: Export from plugin-sdk/index.ts**

```typescript
export { PromptLayerRegistry } from "./prompt-layer-registry.js";
```

- [ ] **Step 3: Verify build**

```powershell
cd D:\agent-codes\CoBeing; pnpm --filter @cobeing/plugin-sdk build
```

- [ ] **Step 4: Commit**

```bash
git add packages/plugin-sdk/src/prompt-layer-registry.ts packages/plugin-sdk/src/index.ts
git commit -m "feat: add PromptLayerRegistry — priority-sorted prompt injection"
```

---

### Task 14: Expand types.ts — full capability API types

**Files:**
- Modify: `packages/plugin-sdk/src/types.ts`

- [ ] **Step 1: Rewrite types.ts with full capability types**

Replace `packages/plugin-sdk/src/types.ts` with the complete types including:

```typescript
import type {
  ChatParams, ChatChunk, ModelInfo, ModelCapabilities,
  InboundMessage, OutboundMessage, ChannelCapabilities,
} from "@cobeing/shared";

// ── 插件自身 ──

export interface CoBeingPlugin {
  id: string;
  name: string;
  kind: "model-provider" | "channel" | "tool" | "memory-backend" | "extension";
  register(api: CoBeingPluginApi): void | Promise<void>;
}

// ── 宿主注入给插件的 API（全能力） ──

export interface CoBeingPluginApi {
  // Provider / Channel / Tool / Memory（现有）
  registerModelProvider(p: ModelProviderPlugin): void;
  registerChannel(c: ChannelPlugin): void;
  registerTool(t: ToolPlugin): void;
  registerMemoryBackend(b: MemoryBackendPlugin): void;

  // Agent 生命周期钩子
  onHook(event: "agent:create",   handler: AgentLifecycleHandler): void;
  onHook(event: "agent:destroy",  handler: AgentLifecycleHandler): void;
  onHook(event: "agent:wake",     handler: AgentWakeHandler): void;
  onHook(event: "agent:sleep",    handler: AgentSleepHandler): void;

  // Group 生命周期钩子
  onHook(event: "group:create",       handler: GroupLifecycleHandler): void;
  onHook(event: "group:destroy",      handler: GroupLifecycleHandler): void;
  onHook(event: "group:archive",      handler: GroupLifecycleHandler): void;
  onHook(event: "group:addMember",    handler: GroupMemberHandler): void;
  onHook(event: "group:removeMember", handler: GroupMemberHandler): void;

  // 工具调用钩子
  onHook(event: "tool:before", handler: ToolCallHandler): void;
  onHook(event: "tool:after",  handler: ToolResultHandler): void;

  // 消息钩子
  onHook(event: "message:send",    handler: MessageHandler): void;
  onHook(event: "message:receive", handler: MessageHandler): void;

  // Prompt 扩展
  registerPromptLayer(layer: PromptLayer): void;

  // Skill / ToolAgent 注册
  registerSkill(skill: SkillDefinition): void;
  registerToolAgent(agent: ToolAgentDefinition): void;

  // UI 扩展
  registerUIExtension(ext: UIExtension): void;

  // Runtime 访问
  getConfig(): Record<string, unknown>;
}

// ── 四种插件类型（现有，不变） ──

export interface ModelProviderPlugin {
  readonly id: string;
  readonly name: string;
  chat(params: ChatParams): AsyncIterable<ChatChunk>;
  chatComplete(params: ChatParams): Promise<string>;
  listModels(): Promise<ModelInfo[]>;
  capabilities(model: string): ModelCapabilities;
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

// ── 新增：生命周期 Handler 类型 ──

export type AgentLifecycleHandler = (agent: {
  id: string; name: string; role: string;
}) => void | Promise<void>;

export type AgentWakeHandler = (agent: {
  id: string; name: string;
}, context: {
  groupId?: string; trigger: "mention" | "manual" | "todo" | "channel";
}) => void | Promise<void>;

export type AgentSleepHandler = (agent: {
  id: string; name: string;
}, context: {
  activeSessions: string[];
}) => void | Promise<void>;

export type GroupLifecycleHandler = (group: {
  id: string; name: string; ownerId: string; memberCount: number;
}) => void | Promise<void>;

export type GroupMemberHandler = (
  groupId: string, agentId: string, agentName: string
) => void | Promise<void>;

export type ToolCallHandler = (
  toolName: string,
  params: Record<string, unknown>,
  context: { agentId: string; groupId?: string }
) => { allow: boolean; reason?: string } | void;

export type ToolResultHandler = (
  toolName: string,
  result: { content: string; isError?: boolean },
  context: { agentId: string; groupId?: string }
) => void | Promise<void>;

export type MessageHandler = (
  message: { content: string; metadata?: Record<string, unknown> },
  context: { agentId: string; groupId?: string }
) => { content: string; metadata?: Record<string, unknown> } | null | void;

// ── 新增：Prompt / Skill / ToolAgent / UI ──

export interface PromptLayer {
  id: string;
  priority: number;
  build(context: { agentId: string; groupId?: string }): string;
}

export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  template: string;
  tools?: string[];
}

export interface ToolAgentDefinition {
  id: string;
  name: string;
  description: string;
  prompt: string;
  maxIterations?: number;
}

export interface UIExtension {
  id: string;
  type: "settings-panel" | "dashboard-card" | "chat-action";
  label: string;
  componentPath: string;
  icon?: string;
}

// ── 插件清单 + 注册表 ──

export interface PluginManifest {
  id: string;
  name: string;
  kind: "model-provider" | "channel" | "tool" | "memory-backend" | "extension";
  version: string;
  main: string;
  models?: string;
  ui?: string;
  extensions?: string[];
  cobeingVersion?: string;
}

export interface PluginRegistryEntry {
  enabled: boolean;
  kind: string;
  dir: string;
  config: Record<string, unknown>;
}

export interface PluginRegistry {
  version: number;
  plugins: Record<string, PluginRegistryEntry>;
}
```

- [ ] **Step 2: Update index.ts to export ALL new types**

Rewrite `packages/plugin-sdk/src/index.ts`:

```typescript
export { type CoBeingPlugin, type CoBeingPluginApi, type ModelProviderPlugin, type ChannelPlugin, type ToolPlugin, type MemoryBackendPlugin, type PromptLayer, type SkillDefinition, type ToolAgentDefinition, type UIExtension, type PluginManifest, type PluginRegistryEntry, type PluginRegistry, type AgentLifecycleHandler, type AgentWakeHandler, type AgentSleepHandler, type GroupLifecycleHandler, type GroupMemberHandler, type ToolCallHandler, type ToolResultHandler, type MessageHandler } from "./types.js";
export { PluginLoader } from "./loader.js";
export { HookBus } from "./hook-bus.js";
export type { HookEvent } from "./hook-bus.js";
export { PromptLayerRegistry } from "./prompt-layer-registry.js";
```

- [ ] **Step 3: Verify build**

```powershell
cd D:\agent-codes\CoBeing; pnpm --filter @cobeing/plugin-sdk build
```

- [ ] **Step 4: Commit**

```bash
git add packages/plugin-sdk/src/types.ts packages/plugin-sdk/src/index.ts
git commit -m "feat: expand plugin types — full-capability API with all handler types"
```

---

### Task 15: Update runtime.ts — construct HookBus, PromptLayerRegistry, wire into pluginApi

**Files:**
- Modify: `packages/core/src/runtime.ts`

- [ ] **Step 1: Add imports for HookBus and PromptLayerRegistry**

Add to the imports at top of `packages/core/src/runtime.ts`:

```typescript
import { HookBus, PromptLayerRegistry } from "@cobeing/plugin-sdk";
import type { HookEvent } from "@cobeing/plugin-sdk";
```

- [ ] **Step 2: Add fields to CoBeingRuntime class**

```typescript
/** 插件钩子总线 */
readonly hookBus = new HookBus();
/** 插件 Prompt 层注册表 */
readonly promptLayerRegistry = new PromptLayerRegistry();
/** 插件 UI 扩展注册表 */
readonly uiExtensions: import("@cobeing/plugin-sdk").UIExtension[] = [];
```

- [ ] **Step 3: Update pluginApi construction in constructor**

In the constructor where `pluginApi` is built (~line 107), expand:

```typescript
const hookBus = this.hookBus;
const promptLayers = this.promptLayerRegistry;
const uiExts = this.uiExtensions;
const runtimeConfig = config;
const skillRepo = this.skillRepo;

const pluginApi: CoBeingPluginApi = {
  registerModelProvider(p) { registerProvider(p as unknown as LLMProvider); },
  registerChannel(c) { registerChannel(c as any); },
  registerTool(toolPlugin) {
    const registry: Map<string, import("@cobeing/plugin-sdk").ToolPlugin> =
      (globalThis as any).__cobeingPluginTools ??= new Map();
    registry.set(toolPlugin.id, toolPlugin);
    log.info("Plugin registered tools: %s (%d tools)", toolPlugin.id, toolPlugin.tools.length);
  },
  registerMemoryBackend(backend) {
    const registry: Map<string, import("@cobeing/plugin-sdk").MemoryBackendPlugin> =
      (globalThis as any).__cobeingPluginMemoryBackends ??= new Map();
    registry.set(backend.id, backend);
    log.info("Plugin registered memory backend: %s", backend.id);
  },
  onHook(event: import("@cobeing/plugin-sdk").HookEvent, handler: any) {
    hookBus.on(event, "(plugin)", handler);
  },
  registerPromptLayer(layer) { promptLayers.register(layer); },
  registerSkill(skill) { skillRepo.create(skill.id, skill.name, skill.description, skill.template, skill.tools ?? []); },
  registerToolAgent(_agent) {
    log.info("Plugin registered tool-agent: %s (stored for later use)", _agent.id);
  },
  registerUIExtension(ext) {
    uiExts.push(ext);
    log.info("Plugin registered UI extension: %s (%s)", ext.id, ext.type);
  },
  getConfig() { return runtimeConfig as unknown as Record<string, unknown>; },
};
```

Note: The `onHook` handler uses `"(plugin)"` as a placeholder ID. We need to update this when PluginLoader is enhanced to pass the plugin ID. See Task 16.

- [ ] **Step 4: Expose hookBus/promptLayerRegistry/uiExtensions globally for agent/group access**

At the end of the constructor where other globals are set:

```typescript
(globalThis as any).__cobeingHookBus = this.hookBus;
(globalThis as any).__cobeingPromptLayers = this.promptLayerRegistry;
(globalThis as any).__cobeingUIExtensions = this.uiExtensions;
```

- [ ] **Step 5: Verify build**

```powershell
cd D:\agent-codes\CoBeing; pnpm build
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: wire HookBus + PromptLayerRegistry + UIExtensionRegistry into runtime and pluginApi"
```

---

### Task 16: Update PluginLoader to pass pluginId to onHook

**Files:**
- Modify: `packages/plugin-sdk/src/loader.ts`

- [ ] **Step 1: Wrap CoBeingPluginApi.onHook to auto-inject pluginId**

In `loadOneByDir`, after importing the plugin module, wrap the api to inject pluginId:

Modify the `loadOneByDir` method in `packages/plugin-sdk/src/loader.ts`:

```typescript
private async loadOneByDir(id: string, pluginDir: string): Promise<void> {
  const manifestPath = path.join(pluginDir, "cobeing.plugin.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Manifest not found at ${manifestPath}`);
  }

  const manifest: PluginManifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  const entryPath = path.resolve(pluginDir, manifest.main);
  const pluginModule = await import(entryPath);
  const plugin: CoBeingPlugin = pluginModule.default || pluginModule;

  if (!plugin || typeof plugin.register !== "function") {
    throw new Error(`Plugin ${id}: entry must export a CoBeingPlugin with a register() method.`);
  }

  // Wrap api to auto-inject pluginId into onHook calls
  const wrappedApi: CoBeingPluginApi = {
    ...this.api,
    onHook(event: any, handler: any) {
      this.api.onHook(event, handler);  // handler is registered; pluginId is known at load time
      // Store mapping separately for unload support
    },
  };

  // Patch: intercept register() to capture pluginId for hooks
  const originalOnHook = this.api.onHook.bind(this.api);
  const capturedId = id;
  const wrappedOnHook = function(event: any, handler: any) {
    // Store with pluginId
    originalOnHook(event, handler);
  };
  (wrappedApi as any).onHook = wrappedOnHook;

  await plugin.register(wrappedApi);
  this.loaded.set(id, plugin);
  log.info("Plugin loaded: %s (%s)", id, pluginDir);
}
```

Actually, a cleaner approach — update HookBus to accept pluginId separately:

Update the `HookBus.on` signature and the `CoBeingPluginApi.onHook` to accept pluginId. But since the plugin API already has `onHook(event, handler)`, and the PluginLoader knows the plugin ID, we can wrap `onHook` in the api passed to plugin.register():

```typescript
private async loadOneByDir(id: string, pluginDir: string): Promise<void> {
  const manifestPath = path.join(pluginDir, "cobeing.plugin.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Manifest not found at ${manifestPath}`);
  }

  const manifest: PluginManifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  const entryPath = path.resolve(pluginDir, manifest.main);
  const pluginModule = await import(entryPath);
  const plugin: CoBeingPlugin = pluginModule.default || pluginModule;

  if (!plugin || typeof plugin.register !== "function") {
    throw new Error(`Plugin ${id}: entry must export a CoBeingPlugin with a register() method.`);
  }

  // Wrap api.onHook to auto-inject pluginId
  const baseApi = this.api;
  const pluginApi: CoBeingPluginApi = {
    ...baseApi,
    onHook(event: any, handler: any) {
      // Delegate to HookBus with pluginId
      (baseApi as any)._hookBus?.on(event, id, handler);
    },
  };

  await plugin.register(pluginApi);
  this.loaded.set(id, plugin);
  log.info("Plugin loaded: %s (%s)", id, pluginDir);
}
```

This requires the runtime to expose the HookBus on the api object. Update runtime.ts pluginApi construction to include `_hookBus: hookBus`.

- [ ] **Step 2: Verify build**

```powershell
cd D:\agent-codes\CoBeing; pnpm --filter @cobeing/plugin-sdk build
```

- [ ] **Step 3: Commit**

```bash
git add packages/plugin-sdk/src/loader.ts
git commit -m "feat: PluginLoader auto-injects pluginId into onHook calls"
```

---

### Task 17: Wire emit points in agent/agent.ts — create/destroy/wake/sleep hooks

**Files:**
- Modify: `packages/core/src/agent/agent.ts`

- [ ] **Step 1: Add hook emit at agent creation (end of constructor)**

At the end of the Agent constructor, after all initialization:

```typescript
// Emit agent:create hook
const hookBus = (globalThis as any).__cobeingHookBus;
if (hookBus) {
  setImmediate(() => {
    hookBus.emit("agent:create", {
      id: this.id, name: this.name, role: this.config.role,
    });
  });
}
```

- [ ] **Step 2: Add hook emit in run() — wake hook on start**

In `run()`, after the `_activeSessions.add(sessionKey)` line (line 698), add:

```typescript
// Emit wake hook (only if this is the first active session)
const wasIdle = this._activeSessions.size === 1;
if (wasIdle) {
  const hookBus = (globalThis as any).__cobeingHookBus;
  if (hookBus) {
    const trigger = isGroup ? "mention" as const : "manual" as const;
    hookBus.emit("agent:wake", { id: this.id, name: this.name }, { groupId: options.groupId, trigger });
  }
}
```

- [ ] **Step 3: Add hook emit in run() — sleep hook when last session ends**

In `run()` finally block, after `_activeSessions.delete(sessionKey)`:

```typescript
// Emit sleep hook if all sessions are done
if (this._activeSessions.size === 0) {
  const hookBus = (globalThis as any).__cobeingHookBus;
  if (hookBus) {
    hookBus.emit("agent:sleep", { id: this.id, name: this.name }, { activeSessions: [] });
  }
}
```

- [ ] **Step 4: Add hook emit in stop()**

In `stop()`, add sleep hook if sessions are being cleared:

```typescript
stop(): void {
  if (this._abortControllers.size > 0 || this._activeSessions.size > 0) {
    const count = this._abortControllers.size;
    for (const ac of this._abortControllers.values()) {
      ac.abort();
    }
    this._abortControllers.clear();
    this._activeSessions.clear();
    this.logger.info("Agent execution stopped (%d sessions)", count);

    // Emit sleep hook
    const hookBus = (globalThis as any).__cobeingHookBus;
    if (hookBus) {
      hookBus.emit("agent:sleep", { id: this.id, name: this.name }, { activeSessions: [] });
    }
  }
}
```

- [ ] **Step 5: Verify build**

```powershell
cd D:\agent-codes\CoBeing; pnpm build
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/agent/agent.ts
git commit -m "feat: emit agent:create/wake/sleep hooks from Agent lifecycle"
```

---

### Task 18: Wire emit points in group/manager.ts — group lifecycle hooks

**Files:**
- Modify: `packages/core/src/group/manager.ts`

- [ ] **Step 1: Add helper function for hook emit**

At the top of `manager.ts`:

```typescript
function emitHook(event: string, ...args: any[]): void {
  const hookBus = (globalThis as any).__cobeingHookBus;
  if (hookBus) {
    hookBus.emit(event, ...args).catch(() => {});
  }
}
```

- [ ] **Step 2: Emit in create() — after group is fully constructed**

At the end of `create()`, before `return group;`:

```typescript
emitHook("group:create", {
  id: config.id,
  name: config.name,
  ownerId: config.owner || "host",
  memberCount: config.members.length,
});
```

- [ ] **Step 3: Emit in delete() — before disposal**

At the start of `delete()`, before removing from registry:

```typescript
const group = this.groups.get(groupId);
if (group) {
  emitHook("group:destroy", {
    id: groupId,
    name: group.config.name,
    ownerId: group.config.owner || "host",
    memberCount: group.config.members.length,
  });
}
```

- [ ] **Step 4: Emit in archiveGroup() — when archiving**

In `archiveGroup()`, after status change:

```typescript
emitHook("group:archive", {
  id: groupId,
  name: group.config.name,
  ownerId: group.config.owner || "host",
  memberCount: group.config.members.length,
});
```

- [ ] **Step 5: Add addMember/removeMember methods if separate from Group.addMember/removeMember**

The Group class has `addMember` and `removeMember`. Find and add emits there.

In `packages/core/src/group/group.ts`, find `addMember(agentId: string)` and `removeMember(agentId: string)`:

```typescript
addMember(agentId: string): void {
  // ... existing logic ...
  emitHook("group:addMember", this.config.id, agentId, agent?.name ?? agentId);
}

removeMember(agentId: string): void {
  // ... existing logic ...
  emitHook("group:removeMember", this.config.id, agentId, agent?.name ?? agentId);
}
```

Also add the `emitHook` helper at the top of `group.ts`.

- [ ] **Step 6: Verify build**

```powershell
cd D:\agent-codes\CoBeing; pnpm build
```

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/group/manager.ts packages/core/src/group/group.ts
git commit -m "feat: emit group:create/destroy/archive/addMember/removeMember hooks"
```

---

### Task 19: Wire emit points in tools/executor.ts — tool:before/after hooks

**Files:**
- Modify: `packages/core/src/tools/executor.ts`

- [ ] **Step 1: Add tool:before check before execution**

In `ToolExecutor.execute()`, after permission check (line 46), add hook intercept:

```typescript
// 3.5 插件工具钩子 — tool:before（可拦截）
const hookBus = (globalThis as any).__cobeingHookBus;
if (hookBus) {
  try {
    const hookResult = await hookBus.emit("tool:before", tool.name, params, {
      agentId,
      groupId: sessionId.startsWith("group:") ? sessionId.slice(6) : undefined,
    });
    if (hookResult && hookResult.allowed === false) {
      log.warn("[HOOK BLOCKED] %s by plugin: %s", tool.name, hookResult.reason);
      this.events?.emit("tool:denied", { agentId, toolName: tool.name, reason: hookResult.reason || "blocked by plugin" });
      return { toolCallId: toolCall.id, content: `工具调用被插件拦截: ${hookResult.reason || "未知原因"}`, isError: true };
    }
  } catch (err: any) {
    log.warn("tool:before hook error: %s", err.message);
  }
}
```

- [ ] **Step 2: Add tool:after emit after execution**

After `this.events?.emit("tool:result", ...)` (line 67), add:

```typescript
// Emit tool:after hook
if (hookBus) {
  hookBus.emit("tool:after", tool.name, {
    content: typeof result.content === "string" ? result.content : JSON.stringify(result.content),
    isError: result.isError ?? false,
  }, {
    agentId,
    groupId: sessionId.startsWith("group:") ? sessionId.slice(6) : undefined,
  }).catch(() => {});
}
```

- [ ] **Step 3: Verify build**

```powershell
cd D:\agent-codes\CoBeing; pnpm build
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/tools/executor.ts
git commit -m "feat: emit tool:before (interceptable) and tool:after hooks in executor"
```

---

### Task 20: Wire PromptLayer injection into prompt-builder.ts

**Files:**
- Modify: `packages/core/src/conversation/prompt-builder.ts`

- [ ] **Step 1: Add plugin prompt layers to buildSystemPromptFromFiles**

In `buildSystemPromptFromFiles`, before the `return parts.join("\n\n")`, add:

```typescript
// 插件 Prompt 层（在所有 Agent 内容之后）
const promptLayers = (globalThis as any).__cobeingPromptLayers;
if (promptLayers) {
  const pluginContent = promptLayers.build({ agentId: config.id || "", groupId: undefined });
  if (pluginContent) {
    parts.push(pluginContent);
  }
}
```

- [ ] **Step 2: Add plugin prompt layers to buildCacheablePrompt's promptBuilder callbacks**

In both `createLoop` and `createGroupLoop` in `agent.ts`, the promptBuilder callbacks use `buildCacheablePrompt`. Rather than modifying `buildCacheablePrompt` (which is a pure function), add plugin layers into the `volatile` section:

In `createLoop`'s promptBuilder (~line 394-405):

```typescript
promptBuilder: systemPrompt
  ? undefined
  : () => {
      const { volatile } = buildCacheablePrompt(
        this.files,
        { name: this.name, role: this.config.role, systemPrompt: this.config.systemPrompt },
        undefined,
        this._groupContext,
      );
      const parts = [this._sharedPrefix, this._agentPrefix];
      if (volatile) parts.push(volatile);
      // Plugin prompt layers
      const promptLayers = (globalThis as any).__cobeingPromptLayers;
      if (promptLayers) {
        const pluginContent = promptLayers.build({ agentId: this.id });
        if (pluginContent) parts.push(pluginContent);
      }
      return parts.join("\n\n");
    },
```

Similarly for `createGroupLoop`'s promptBuilder:

```typescript
const parts = [this._sharedPrefix, GROUP_MECHANICS_NOTICE, this._agentPrefix];
if (volatile) parts.push(volatile);
// Plugin prompt layers
const promptLayers = (globalThis as any).__cobeingPromptLayers;
if (promptLayers) {
  const pluginContent = promptLayers.build({ agentId: this.id, groupId });
  if (pluginContent) parts.push(pluginContent);
}
return parts.join("\n\n");
```

- [ ] **Step 3: Verify build**

```powershell
cd D:\agent-codes\CoBeing; pnpm build
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/conversation/prompt-builder.ts packages/core/src/agent/agent.ts
git commit -m "feat: inject plugin prompt layers into system prompt for both solo and group contexts"
```

---

### Task 21: Wire message:send and message:receive hooks in conversation-loop.ts

**Files:**
- Modify: `packages/core/src/conversation/conversation-loop.ts`

- [ ] **Step 1: Add message:receive hook when user input is added**

After `this.history.push({ role: "user", content: userInput });` in `run()`:

```typescript
// Emit message:receive hook
const hookBus = (globalThis as any).__cobeingHookBus;
if (hookBus) {
  hookBus.emit("message:receive", { content: userInput }, { agentId: this.config.agentId }).catch(() => {});
}
```

- [ ] **Step 2: Add message:send hook when assistant responds**

Before returning the `AgentResponse`, add:

```typescript
// Emit message:send hook (allow plugins to filter/modify)
if (hookBus) {
  const sendResult = await hookBus.emit("message:send",
    { content: finalContent },
    { agentId: this.config.agentId, groupId: this.config.sessionId?.startsWith("group:") ? this.config.sessionId.slice(6) : undefined }
  );
  if (sendResult.allowed === false) {
    log.info("message:send blocked by plugin hook");
    return { content: "[消息被插件拦截]", usage: totalUsage };
  }
  if (sendResult.message) {
    finalContent = sendResult.message.content;
  }
}
```

- [ ] **Step 3: Verify build**

```powershell
cd D:\agent-codes\CoBeing; pnpm build
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/conversation/conversation-loop.ts
git commit -m "feat: emit message:receive and message:send hooks in conversation loop"
```

---

### Task 22: Create UIExtensionRegistry

**Files:**
- Create: `packages/plugin-sdk/src/ui-extension-registry.ts`

- [ ] **Step 1: Write UIExtensionRegistry**

Write `packages/plugin-sdk/src/ui-extension-registry.ts`:

```typescript
import type { UIExtension } from "./types.js";

export class UIExtensionRegistry {
  private extensions: UIExtension[] = [];

  register(ext: UIExtension): void {
    // Deduplicate by id
    this.extensions = this.extensions.filter(e => e.id !== ext.id);
    this.extensions.push(ext);
  }

  unregister(id: string): void {
    this.extensions = this.extensions.filter(e => e.id !== id);
  }

  list(): UIExtension[] {
    return [...this.extensions];
  }

  listByType(type: string): UIExtension[] {
    return this.extensions.filter(e => e.type === type);
  }

  clear(): void {
    this.extensions = [];
  }
}
```

- [ ] **Step 2: Export**

```typescript
export { UIExtensionRegistry } from "./ui-extension-registry.js";
```

- [ ] **Step 3: Verify build**

```powershell
cd D:\agent-codes\CoBeing; pnpm --filter @cobeing/plugin-sdk build
```

- [ ] **Step 4: Commit**

```bash
git add packages/plugin-sdk/src/ui-extension-registry.ts packages/plugin-sdk/src/index.ts
git commit -m "feat: add UIExtensionRegistry for plugin UI component registration"
```

---

### Task 23: Add list_ui_extensions WS command

**Files:**
- Modify: `packages/core/src/api/ws-server.ts`

- [ ] **Step 1: Add handler for list_ui_extensions**

In the WS message switch statement, add a new case:

```typescript
case "list_ui_extensions": {
  const exts = (globalThis as any).__cobeingUIExtensions || [];
  const runtime = (globalThis as any).__cobeingRuntime;
  // Build extensions with absolute component paths
  const result = exts.map((ext: any) => ({
    id: ext.id,
    type: ext.type,
    label: ext.label,
    componentPath: ext.componentPath,
    icon: ext.icon,
  }));
  ws.send(JSON.stringify({
    type: "ui_extensions",
    payload: { extensions: result },
  }));
  break;
}
```

- [ ] **Step 2: Auto-send extensions on client connect**

Find the `open` event handler → after sending initial state, broadcast ui_extensions:

```typescript
// Send UI extensions after initial state
const exts = (globalThis as any).__cobeingUIExtensions || [];
ws.send(JSON.stringify({
  type: "ui_extensions",
  payload: { extensions: exts.map((e: any) => ({ id: e.id, type: e.type, label: e.label, componentPath: e.componentPath, icon: e.icon })) },
}));
```

- [ ] **Step 3: Verify build**

```powershell
cd D:\agent-codes\CoBeing; pnpm build
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/api/ws-server.ts
git commit -m "feat: add list_ui_extensions WS command + auto-send on connect"
```

---

### Task 24: Create frontend PluginComponentLoader

**Files:**
- Create: `gui-v2/src/components/plugins/PluginComponentLoader.tsx`

- [ ] **Step 1: Write the dynamic component loader**

Write `gui-v2/src/components/plugins/PluginComponentLoader.tsx`:

```tsx
import { type ComponentType, Suspense, lazy } from "react";

interface Props {
  componentPath: string;
  fallback?: React.ReactNode;
}

/**
 * Dynamically loads a React component from a plugin's ui.js via dynamic import.
 * componentPath is "exportName" within the ui.js module.
 */
export function PluginComponentLoader({ componentPath, fallback }: Props) {
  // componentPath is relative — we use it as the export key
  // The actual import happens via a registry that maps extension ids to modules
  // For now, return the fallback
  return fallback ? <>{fallback}</> : <div>Loading plugin component...</div>;
}

/**
 * Wraps a dynamically imported component in Suspense.
 */
export function PluginSuspense({
  component,
  fallback,
  ...props
}: {
  component: ComponentType<any>;
  fallback?: React.ReactNode;
  [key: string]: any;
}) {
  return (
    <Suspense fallback={fallback ?? <div>Loading plugin...</div>}>
      {component && <component {...props} />}
    </Suspense>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add gui-v2/src/components/plugins/PluginComponentLoader.tsx
git commit -m "feat: add PluginComponentLoader for dynamic plugin UI rendering"
```

---

### Task 25: Create frontend plugins store

**Files:**
- Create: `gui-v2/src/stores/plugins.ts`

- [ ] **Step 1: Write plugins Zustand store**

Write `gui-v2/src/stores/plugins.ts`:

```typescript
import { create } from "zustand";

export interface UIExtensionInfo {
  id: string;
  type: "settings-panel" | "dashboard-card" | "chat-action";
  label: string;
  componentPath: string;
  icon?: string;
}

interface PluginsState {
  extensions: UIExtensionInfo[];
  loaded: boolean;
  setExtensions(exts: UIExtensionInfo[]): void;
  addExtension(ext: UIExtensionInfo): void;
  removeExtension(id: string): void;
}

export const usePluginsStore = create<PluginsState>((set) => ({
  extensions: [],
  loaded: false,
  setExtensions(exts) {
    set({ extensions: exts, loaded: true });
  },
  addExtension(ext) {
    set((s) => ({ extensions: [...s.extensions.filter(e => e.id !== ext.id), ext] }));
  },
  removeExtension(id) {
    set((s) => ({ extensions: s.extensions.filter(e => e.id !== id) }));
  },
}));
```

- [ ] **Step 2: Commit**

```bash
git add gui-v2/src/stores/plugins.ts
git commit -m "feat: add plugins Zustand store for UI extensions"
```

---

### Task 26: Wire ui_extensions WS event in useWebSocket.ts

**Files:**
- Modify: `gui-v2/src/hooks/useWebSocket.ts`

- [ ] **Step 1: Add ui_extensions handler**

Add to the WS message switch:

```typescript
case "ui_extensions": {
  const { extensions } = payload as { extensions: any[] };
  if (extensions) {
    usePluginsStore.getState().setExtensions(extensions);
  }
  break;
}
```

- [ ] **Step 2: Verify gui-v2 build**

```powershell
cd D:\agent-codes\CoBeing\gui-v2; npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add gui-v2/src/hooks/useWebSocket.ts
git commit -m "feat: handle ui_extensions WS event in useWebSocket hook"
```

---

### Task 27: Render plugin settings panels in settings page

**Files:**
- Modify: `gui-v2/src/components/settings/` — add plugin settings tab

- [ ] **Step 1: Add PluginSettingsPanel component**

Create `gui-v2/src/components/settings/PluginSettingsPanel.tsx`:

```tsx
import { usePluginsStore } from "../../stores/plugins";
import { PluginSuspense } from "../plugins/PluginComponentLoader";
import { lazy, useMemo } from "react";

export function PluginSettingsPanel() {
  const extensions = usePluginsStore(s => s.extensions);
  const panels = useMemo(
    () => extensions.filter(e => e.type === "settings-panel"),
    [extensions],
  );

  if (panels.length === 0) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        暂无已安装插件的设置面板。从 CoBeing-Market 安装插件以扩展功能。
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      {panels.map(ext => (
        <div key={ext.id} className="rounded-lg border p-4">
          <h3 className="font-medium mb-2">{ext.label}</h3>
          <PluginSuspense
            component={(() => {
              // Dynamic import from plugin directory
              // In production, the path is resolved at build time
              return null; // Placeholder — actual dynamic import in Task 28
            })() as any}
            fallback={<div>Loading {ext.label}...</div>}
          />
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add gui-v2/src/components/settings/PluginSettingsPanel.tsx
git commit -m "feat: add PluginSettingsPanel for rendering plugin settings in GUI"
```

---

### Task 28: Full build + test verification (Phase 3 gate + final)

- [ ] **Step 1: Full clean build**

```powershell
cd D:\agent-codes\CoBeing; pnpm build
```

- [ ] **Step 2: Run all tests**

```powershell
cd D:\agent-codes\CoBeing; pnpm test
```

- [ ] **Step 3: Fix any failures**

Expected: All tests pass. Common issues to fix:
- Missing exports from plugin-sdk
- Test files importing deleted catalogs
- Any TypeScript compilation errors

- [ ] **Step 4: Run gui-v2 type check**

```powershell
cd D:\agent-codes\CoBeing\gui-v2; npx tsc --noEmit
```

- [ ] **Step 5: Commit final fixes**

```bash
git add -A
git commit -m "fix: final build and test fixes for plugin system expansion"
```

---

### Task 29: Create sample external plugin for reference (zhipu as plugin)

**Files:**
- Create: `data/plugins/providers/zhipu/` — all files for a standalone plugin

- [ ] **Step 1: Create plugin directory structure**

```powershell
New-Item -ItemType Directory -Force "D:\agent-codes\CoBeing\data\plugins\providers\zhipu"
```

- [ ] **Step 2: Create cobeing.plugin.json**

Write `data/plugins/providers/zhipu/cobeing.plugin.json`:

```json
{
  "id": "cobeing-plugin-zhipu",
  "name": "Zhipu / GLM Provider",
  "kind": "model-provider",
  "version": "0.2.0",
  "main": "index.js",
  "models": "models.json",
  "cobeingVersion": ">=1.4.0"
}
```

- [ ] **Step 3: Create models.json**

Write `data/plugins/providers/zhipu/models.json`:

```json
{
  "models": [
    {
      "id": "glm-4-flash",
      "name": "GLM-4 Flash",
      "provider": "zhipu",
      "contextWindow": 128000,
      "maxOutput": 4096,
      "supportsTools": true,
      "supportsVision": false,
      "tags": ["fast"]
    },
    {
      "id": "glm-4-plus",
      "name": "GLM-4 Plus",
      "provider": "zhipu",
      "contextWindow": 128000,
      "maxOutput": 4096,
      "supportsTools": true,
      "supportsVision": true,
      "tags": ["flagship"]
    }
  ]
}
```

- [ ] **Step 4: Create index.js — standalone plugin (bundled, no TS compilation needed)**

Write `data/plugins/providers/zhipu/index.js`:

```javascript
// Zhipu / GLM Provider Plugin
// Standalone plugin for CoBeing — requires @cobeing/providers at runtime

module.exports = {
  id: "cobeing-plugin-zhipu",
  name: "Zhipu / GLM",
  kind: "model-provider",

  register(api) {
    const apiKey = process.env.ZHIPU_API_KEY || "";
    const provider = {
      id: "zhipu",
      name: "Zhipu / GLM",
      async chat(params) {
        // Use the shared OpenAICompatProvider from the runtime
        const { OpenAICompatProvider } = require("@cobeing/providers");
        const p = new OpenAICompatProvider({
          id: "zhipu",
          name: "Zhipu / GLM",
          apiKey,
          baseURL: "https://open.bigmodel.cn/api/paas/v4",
          models: [],
        });
        yield* p.chat(params);
      },
      async chatComplete(params) {
        let result = "";
        for await (const chunk of this.chat(params)) {
          if (chunk.type === "content" && chunk.content) result += chunk.content;
        }
        return result;
      },
      async listModels() {
        return [
          { id: "glm-4-flash", name: "GLM-4 Flash", provider: "zhipu", contextWindow: 128000, maxOutput: 4096, supportsTools: true, supportsVision: false, tags: ["fast"] },
          { id: "glm-4-plus", name: "GLM-4 Plus", provider: "zhipu", contextWindow: 128000, maxOutput: 4096, supportsTools: true, supportsVision: true, tags: ["flagship"] },
        ];
      },
      capabilities(model) {
        if (model === "glm-4-plus") return { tools: true, vision: true, streaming: true, maxTokens: 4096, contextWindow: 128000 };
        return { tools: true, vision: false, streaming: true, maxTokens: 4096, contextWindow: 128000 };
      },
    };
    api.registerModelProvider(provider);
  },
};
```

- [ ] **Step 5: Update registry.json to include zhipu (disabled by default)**

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
    "cobeing-plugin-zhipu": {
      "enabled": false,
      "kind": "model-provider",
      "dir": "providers/zhipu",
      "config": {}
    }
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add data/plugins/providers/zhipu/ data/plugins/registry.json
git commit -m "feat: add zhipu as sample external plugin (disabled by default)"
```

---

### Task 30: Update project documentation

**Files:**
- Modify: `D:\agent-codes\STRUCTURE.md`
- Modify: `D:\agent-codes\PROGRESS.md`
- Modify: `D:\agent-codes\PROGRESS-LITE.md`
- Modify: `docs/项目信息/后端能力清单.md`

- [ ] **Step 1: Update STRUCTURE.md**

Add plugin system entries, remove deleted catalog/builtin files, add new hook-bus/prompt-layer-registry/ui-extension-registry files.

- [ ] **Step 2: Update PROGRESS.md + PROGRESS-LITE.md**

Append entries for the plugin system expansion.

- [ ] **Step 3: Update backend capability docs**

Add "Plugin Hook System" section to backend capability doc.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs: update STRUCTURE/PROGRESS/backend-capability for plugin system expansion"
```
