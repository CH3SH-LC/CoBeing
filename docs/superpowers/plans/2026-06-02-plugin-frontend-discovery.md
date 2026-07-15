# Plugin → Frontend Dynamic Discovery 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dynamic discovery pipeline so any plugin (provider/channel/tool/extension) automatically appears in the frontend without manual hardcoding.

**Architecture:** Add a `list_plugins` WS endpoint as single source of truth for all loaded plugin capabilities. Create `_custom` wrapper plugins that scan `instances/` directories for user-defined providers/channels. Replace all frontend hardcoded lists (CATALOG_MODELS ×3, CHANNEL_PRESETS, PRESETS) with dynamic data from a new `pluginsStore`.

**Tech Stack:** TypeScript (Node.js backend), React + Zustand (frontend), WebSocket protocol

---

### Task 1: Bump all versions to 1.4.0

**Files:**
- Modify: `package.json:3`
- Modify: `gui-v2/package.json:4`
- Modify: `packages/core/package.json:3`
- Modify: `packages/providers/package.json:3`
- Modify: `packages/shared/package.json:3`
- Modify: `packages/channels/package.json:3`
- Modify: `packages/plugin-sdk/package.json:3`
- Modify: `packages/mcp-servers/office/package.json:3`
- Modify: `packages/mcp-servers/qqbot/package.json:3`
- Modify: `gui-v2/src-tauri/tauri.conf.json:4`

- [ ] **Step 1: Bump all 10 files**

Run this PowerShell command to replace `"version": "1.3.1"` with `"version": "1.4.0"` in all workspace files:

```powershell
$files = @(
    "D:\agent-codes\CoBeing\package.json",
    "D:\agent-codes\CoBeing\gui-v2\package.json",
    "D:\agent-codes\CoBeing\packages\core\package.json",
    "D:\agent-codes\CoBeing\packages\providers\package.json",
    "D:\agent-codes\CoBeing\packages\shared\package.json",
    "D:\agent-codes\CoBeing\packages\channels\package.json",
    "D:\agent-codes\CoBeing\packages\plugin-sdk\package.json",
    "D:\agent-codes\CoBeing\packages\mcp-servers\office\package.json",
    "D:\agent-codes\CoBeing\packages\mcp-servers\qqbot\package.json",
    "D:\agent-codes\CoBeing\gui-v2\src-tauri\tauri.conf.json"
)
foreach ($f in $files) {
    $content = Get-Content $f -Raw -Encoding UTF8
    $updated = $content -replace '"version": "1\.3\.1"', '"version": "1.4.0"'
    if ($updated -ne $content) {
        Set-Content $f -Value $updated -Encoding UTF8 -NoNewline
        Write-Host "Updated: $f"
    }
}
```

- [ ] **Step 2: Build and test**

```powershell
cd D:\agent-codes\CoBeing; pnpm build
```

Expected: 7 packages build successfully.

```powershell
cd D:\agent-codes\CoBeing; pnpm test
```

Expected: 417 tests pass (43 files).

- [ ] **Step 3: Verify version check in loadAllPlugins**

Start the app and check the log output. Expected: `Plugins loaded: N` where N > 0 (was 0 before because all plugins failed version check).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: bump version to 1.4.0 across all packages

All 10 version files unified to 1.4.0 so plugin cobeingVersion >=1.4.0
check passes in loadAllPlugins(). Plugin manifests unchanged.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Fix __cobeingUIExtensions global variable mismatch

**Files:**
- Modify: `packages/core/src/api/ws-server.ts:329-331`

- [ ] **Step 1: Fix the global variable reference**

In `packages/core/src/api/ws-server.ts`, the `list_ui_extensions` case reads from the wrong global name:

```typescript
// Before (line 329-331):
case "list_ui_extensions": {
    const registry = (globalThis as any).__cobeingUIExtensions;
    const exts = registry && typeof registry.list === "function" ? registry.list() : [];

// After:
case "list_ui_extensions": {
    const registry = (globalThis as any).__cobeing?.uiExtensions;
    const exts = registry && typeof registry.list === "function" ? registry.list() : [];
```

Use the Edit tool:
- `old_string`: `const registry = (globalThis as any).__cobeingUIExtensions;`
- `new_string`: `const registry = (globalThis as any).__cobeing?.uiExtensions;`

- [ ] **Step 2: Build and verify**

```powershell
cd D:\agent-codes\CoBeing; pnpm build
```

Expected: 7 packages build successfully.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/api/ws-server.ts
git commit -m "fix: list_ui_extensions reads from __cobeing.uiExtensions

Was reading from __cobeingUIExtensions (missing dot, wrong name).
Runtime stores UI extensions at __cobeing.uiExtensions.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Add list_plugins WS endpoint

**Files:**
- Modify: `packages/core/src/api/ws-server.ts` (add case in handleMessage + helper method)
- Reference: `packages/plugin-sdk/src/types.ts` (PluginInfo type)
- Reference: `packages/providers/src/index.ts` (getAllProviders export)
- Reference: `packages/channels/src/index.ts` (getAllChannels export)

- [ ] **Step 1: Read the current ws-server.ts structure to find insertion points**

Read `packages/core/src/api/ws-server.ts` to locate:
- The existing `list_ui_extensions` case (for new case placement nearby)
- The `getState()` method (for reference on pattern)

- [ ] **Step 2: Add the list_plugins case in handleMessage switch**

Insert after the `list_ui_extensions` case block (after line ~336):

```typescript
case "list_plugins": {
    const plugins = this.listPlugins();
    this.sendToClient(ws, { type: "plugins", payload: plugins });
    break;
}
```

- [ ] **Step 3: Add the listPlugins() private method**

Add to the CoreWSServer class (near `getState()`):

```typescript
private listPlugins(): Array<{
    id: string; name: string; kind: string; version: string; enabled: boolean;
    models?: any[]; channelType?: string; toolDefs?: any[]; extensions?: any[];
}> {
    const result: any[] = [];

    // Get plugin registry metadata from runtime
    const runtime = (globalThis as any).__cobeing?.runtime;
    const pluginRegistry = runtime?.pluginRegistry;
    if (!pluginRegistry) return result;

    // Provider plugins
    const { getAllProviders } = require("@cobeing/providers");
    const allProviders = getAllProviders();
    const providerIds = new Set(allProviders.map((p: any) => p.id));

    for (const [pluginId, entry] of Object.entries(pluginRegistry.plugins as Record<string, any>)) {
        const info: any = {
            id: pluginId,
            name: pluginId,
            kind: entry.kind || "unknown",
            version: "0.0.0",
            enabled: entry.enabled === true,
        };

        // Try reading manifest for name/version
        try {
            const manifestPath = path.join(
                path.resolve("data", "plugins"),
                entry.dir || "",
                "cobeing.plugin.json"
            );
            if (fs.existsSync(manifestPath)) {
                const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
                info.name = manifest.name || info.name;
                info.version = manifest.version || info.version;
            }
        } catch { /* keep defaults */ }

        // Kind-specific data
        if (entry.kind === "model-provider") {
            info.models = [];
            const pluginDir = path.join(path.resolve("data", "plugins"), entry.dir || "");
            const modelsPath = path.join(pluginDir, "models.json");
            if (fs.existsSync(modelsPath)) {
                try {
                    const parsed = JSON.parse(fs.readFileSync(modelsPath, "utf-8"));
                    info.models = parsed.models || [];
                } catch { /* skip */ }
            }
            // Also include _custom instances
            const instancesDir = path.join(pluginDir, "instances");
            if (fs.existsSync(instancesDir)) {
                try {
                    for (const file of fs.readdirSync(instancesDir)) {
                        if (!file.endsWith(".json")) continue;
                        const inst = JSON.parse(fs.readFileSync(path.join(instancesDir, file), "utf-8"));
                        result.push({
                            id: `custom:${inst.id}`,
                            name: inst.name || inst.id,
                            kind: "model-provider",
                            version: "custom",
                            enabled: true,
                            models: inst.models || [],
                            isCustomInstance: true,
                            pluginId: pluginId,
                            instanceId: inst.id,
                            config: inst,
                        });
                    }
                } catch { /* skip */ }
            }
        } else if (entry.kind === "channel") {
            const pluginDir = path.join(path.resolve("data", "plugins"), entry.dir || "");
            const types: string[] = [];
            // Channels from getAllChannels that match this plugin
            const { getAllChannels } = require("@cobeing/channels");
            for (const ch of getAllChannels()) {
                if (!providerIds.has(ch.id) && !types.includes(ch.id)) {
                    types.push(ch.id);
                }
            }
            info.channelType = entry.dir?.split("/").pop() || "unknown";
            // Also include _custom instances
            const instancesDir = path.join(pluginDir, "instances");
            if (fs.existsSync(instancesDir)) {
                try {
                    for (const file of fs.readdirSync(instancesDir)) {
                        if (!file.endsWith(".json")) continue;
                        const inst = JSON.parse(fs.readFileSync(path.join(instancesDir, file), "utf-8"));
                        result.push({
                            id: `custom:${inst.id}`,
                            name: inst.name || inst.id,
                            kind: "channel",
                            version: "custom",
                            enabled: true,
                            channelType: inst.type || "custom",
                            isCustomInstance: true,
                            pluginId: pluginId,
                            instanceId: inst.id,
                            config: inst,
                        });
                    }
                } catch { /* skip */ }
            }
        } else if (entry.kind === "tool") {
            const toolMap: Map<string, any> = (globalThis as any).__cobeing?.pluginTools ?? new Map();
            info.toolDefs = [];
            for (const [, toolPlugin] of toolMap) {
                info.toolDefs.push(...(toolPlugin.tools || []));
            }
        } else if (entry.kind === "extension") {
            const extRegistry = (globalThis as any).__cobeing?.uiExtensions;
            info.extensions = extRegistry && typeof extRegistry.list === "function"
                ? extRegistry.list() : [];
        }

        result.push(info);
    }

    return result;
}
```

- [ ] **Step 4: Add necessary imports**

Ensure these imports exist at the top of ws-server.ts:
- `fs` and `path` (should already be imported — verify)
- If not already imported: `import fs from "node:fs";` and `import path from "node:path";`

- [ ] **Step 5: Build and test**

```powershell
cd D:\agent-codes\CoBeing; pnpm build
```

Expected: 7 packages build successfully (no TypeScript errors).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/api/ws-server.ts
git commit -m "feat: add list_plugins WS endpoint

Returns all loaded plugins with kind-specific data:
models for providers, channelType for channels, toolDefs for tools,
extensions for extensions. Also scans _custom plugin instances/.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Add instance management WS endpoints

**Files:**
- Modify: `packages/core/src/api/ws-server.ts`

- [ ] **Step 1: Add add_plugin_instance case**

Insert in the handleMessage switch (after `list_plugins` case):

```typescript
case "add_plugin_instance": {
    const { pluginId, instanceId, config } = msg.payload as {
        pluginId: string; instanceId: string; config: Record<string, unknown>;
    };
    try {
        // Find the plugin directory
        const runtime = (globalThis as any).__cobeing?.runtime;
        const pluginRegistry = runtime?.pluginRegistry;
        if (!pluginRegistry || !pluginRegistry.plugins[pluginId]) {
            this.sendToClient(ws, { type: "error", payload: { message: `Plugin not found: ${pluginId}` } });
            break;
        }
        const entry = pluginRegistry.plugins[pluginId];
        const pluginDir = path.join(path.resolve("data", "plugins"), entry.dir || "");
        const instancesDir = path.join(pluginDir, "instances");
        fs.mkdirSync(instancesDir, { recursive: true });

        // Write instance JSON
        const instancePath = path.join(instancesDir, `${instanceId}.json`);
        const instanceData = { id: instanceId, ...config };
        fs.writeFileSync(instancePath, JSON.stringify(instanceData, null, 2), "utf-8");

        // Trigger hot reload
        if (entry.kind === "model-provider") {
            if (typeof (runtime as any).rebuildProvider === "function") {
                (runtime as any).rebuildProvider(instanceId);
            }
        }

        this.sendToClient(ws, {
            type: "plugin_instance_added",
            payload: { pluginId, instanceId, config: instanceData },
        });
        log.info("Plugin instance added: %s/%s", pluginId, instanceId);
    } catch (err: any) {
        this.sendToClient(ws, { type: "error", payload: { message: err.message } });
    }
    break;
}
```

- [ ] **Step 2: Add remove_plugin_instance case**

```typescript
case "remove_plugin_instance": {
    const { pluginId, instanceId } = msg.payload as { pluginId: string; instanceId: string };
    try {
        const runtime = (globalThis as any).__cobeing?.runtime;
        const pluginRegistry = runtime?.pluginRegistry;
        if (!pluginRegistry || !pluginRegistry.plugins[pluginId]) {
            this.sendToClient(ws, { type: "error", payload: { message: `Plugin not found: ${pluginId}` } });
            break;
        }
        const entry = pluginRegistry.plugins[pluginId];
        const instancesDir = path.join(
            path.resolve("data", "plugins"), entry.dir || "", "instances"
        );
        const instancePath = path.join(instancesDir, `${instanceId}.json`);
        if (fs.existsSync(instancePath)) {
            fs.rmSync(instancePath);
        }

        this.sendToClient(ws, {
            type: "plugin_instance_removed",
            payload: { pluginId, instanceId },
        });
        log.info("Plugin instance removed: %s/%s", pluginId, instanceId);
    } catch (err: any) {
        this.sendToClient(ws, { type: "error", payload: { message: err.message } });
    }
    break;
}
```

- [ ] **Step 3: Add update_plugin_instance case**

```typescript
case "update_plugin_instance": {
    const { pluginId, instanceId, config } = msg.payload as {
        pluginId: string; instanceId: string; config: Record<string, unknown>;
    };
    try {
        const runtime = (globalThis as any).__cobeing?.runtime;
        const pluginRegistry = runtime?.pluginRegistry;
        if (!pluginRegistry || !pluginRegistry.plugins[pluginId]) {
            this.sendToClient(ws, { type: "error", payload: { message: `Plugin not found: ${pluginId}` } });
            break;
        }
        const entry = pluginRegistry.plugins[pluginId];
        const instancesDir = path.join(
            path.resolve("data", "plugins"), entry.dir || "", "instances"
        );
        const instancePath = path.join(instancesDir, `${instanceId}.json`);

        // Read existing config and merge
        let existing: Record<string, unknown> = { id: instanceId };
        if (fs.existsSync(instancePath)) {
            try {
                existing = JSON.parse(fs.readFileSync(instancePath, "utf-8"));
            } catch { /* use default */ }
        }
        const merged = { ...existing, ...config, id: instanceId };
        fs.mkdirSync(instancesDir, { recursive: true });
        fs.writeFileSync(instancePath, JSON.stringify(merged, null, 2), "utf-8");

        // Trigger hot reload
        if (entry.kind === "model-provider") {
            if (typeof (runtime as any).rebuildProvider === "function") {
                (runtime as any).rebuildProvider(instanceId);
            }
        }

        this.sendToClient(ws, {
            type: "plugin_instance_updated",
            payload: { pluginId, instanceId, config: merged },
        });
        log.info("Plugin instance updated: %s/%s", pluginId, instanceId);
    } catch (err: any) {
        this.sendToClient(ws, { type: "error", payload: { message: err.message } });
    }
    break;
}
```

- [ ] **Step 4: Build and test**

```powershell
cd D:\agent-codes\CoBeing; pnpm build
```

Expected: 7 packages build successfully.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/api/ws-server.ts
git commit -m "feat: add add/remove/update_plugin_instance WS endpoints

Manage _custom plugin instances stored as JSON files in
instances/ subdirectories. Triggers provider hot reload on change.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Expand get_state and get_config with plugin data

**Files:**
- Modify: `packages/core/src/api/ws-server.ts` (getState method and get_config case)

- [ ] **Step 1: Add plugins field to getState()**

Locate the `getState()` method return statement (around line 2055). Add `plugins` field:

```typescript
private getState() {
    const agents = /* ... existing ... */;
    const groups = /* ... existing ... */;

    // Build plugin summary
    const runtime = (globalThis as any).__cobeing?.runtime;
    const pluginRegistry = runtime?.pluginRegistry;
    const plugins: Array<{ id: string; kind: string; enabled: boolean }> = [];
    if (pluginRegistry) {
        for (const [pluginId, entry] of Object.entries(pluginRegistry.plugins as Record<string, any>)) {
            plugins.push({
                id: pluginId,
                kind: entry.kind || "unknown",
                enabled: entry.enabled === true,
            });
        }
    }

    return {
        agents,
        groups,
        channels: [] as string[],
        plugins,
        timestamp: Date.now(),
    };
}
```

- [ ] **Step 2: Expand get_config to merge plugin data**

In the `get_config` case, after reading the config file and decrypting keys, merge plugin providers/channels into the response:

```typescript
case "get_config": {
    const configFilePath = this.configPath || path.resolve("config/default.json");
    try {
        const raw = fs.readFileSync(configFilePath, "utf-8");
        const config = JSON.parse(raw);
        // ... existing decrypt + resolveProviderApiKeys logic ...

        // Merge plugin-loaded providers into config response
        const { getAllProviders } = require("@cobeing/providers");
        const allProviders = getAllProviders();
        if (!config.providers) config.providers = {};
        for (const p of allProviders) {
            if (!config.providers[p.id]) {
                config.providers[p.id] = {
                    name: p.id,
                    type: "openai-compat",
                    _pluginManaged: true,
                };
            }
        }

        // Merge plugin-loaded channels
        const { getAllChannels } = require("@cobeing/channels");
        const allChannels = getAllChannels();
        if (!config.channels) config.channels = {};
        for (const ch of allChannels) {
            if (!config.channels[ch.id]) {
                config.channels[ch.id] = {
                    name: ch.id,
                    enabled: true,
                    type: ch.id,
                    _pluginManaged: true,
                };
            }
        }

        this.sendToClient(ws, { type: "config", payload: config });
    } catch (err) {
        this.sendToClient(ws, { type: "error", payload: { message: `Failed to read config: ${err}` } });
    }
    break;
}
```

- [ ] **Step 3: Build and verify**

```powershell
cd D:\agent-codes\CoBeing; pnpm build
```

Expected: 7 packages build successfully.

- [ ] **Step 4: Test get_state via ws-client or manual test**

Start app. Connect via WebSocket client. Send `{ type: "get_state" }`. Expected response includes `plugins` array with entries.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/api/ws-server.ts
git commit -m "feat: expand get_state and get_config with plugin data

get_state now includes plugins summary (id, kind, enabled).
get_config merges plugin-loaded providers and channels into
the config response, marked with _pluginManaged: true.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Create _custom provider plugin

**Files:**
- Create: `data/plugins/providers/_custom/cobeing.plugin.json`
- Create: `data/plugins/providers/_custom/index.js`
- Create: `data/plugins/providers/_custom/instances/.gitkeep`
- Modify: `data/plugins/registry.json`

- [ ] **Step 1: Create the manifest**

Write `data/plugins/providers/_custom/cobeing.plugin.json`:

```json
{
  "id": "cobeing-plugin-custom-provider",
  "name": "Custom Provider Loader",
  "kind": "model-provider",
  "version": "0.1.0",
  "main": "index.js",
  "cobeingVersion": ">=1.4.0",
  "multiInstance": true,
  "configSchema": {
    "fields": [
      { "key": "name", "label": "名称", "type": "string", "required": true, "placeholder": "e.g. 我的自部署模型" },
      { "key": "apiKeyEnv", "label": "API Key 环境变量", "type": "string", "required": false, "placeholder": "e.g. MY_LLM_KEY", "hint": "留空则无需认证" },
      { "key": "baseURL", "label": "Base URL", "type": "string", "required": true, "placeholder": "https://api.example.com/v1" }
    ]
  }
}
```

- [ ] **Step 2: Create the plugin entry**

Write `data/plugins/providers/_custom/index.js`:

```javascript
// Custom Provider Loader — scans instances/ directory and registers OpenAI-compatible providers
import path from "node:path";
import fs from "node:fs";
import { OpenAICompatProvider } from "../../../../packages/providers/dist/index.js";

export default {
  id: "cobeing-plugin-custom-provider",
  name: "Custom Provider Loader",
  kind: "model-provider",

  async register(api) {
    const pluginDir = import.meta.dirname;
    const instancesDir = path.join(pluginDir, "instances");

    if (!fs.existsSync(instancesDir)) {
      fs.mkdirSync(instancesDir, { recursive: true });
      return;
    }

    const entries = fs.readdirSync(instancesDir);
    let count = 0;

    for (const file of entries) {
      if (!file.endsWith(".json") || file === ".gitkeep") continue;

      let cfg;
      try {
        cfg = JSON.parse(fs.readFileSync(path.join(instancesDir, file), "utf-8"));
      } catch {
        console.warn("[custom-provider] Failed to parse instance:", file);
        continue;
      }

      if (!cfg.id || !cfg.baseURL) {
        console.warn("[custom-provider] Skipping instance %s: missing id or baseURL", file);
        continue;
      }

      const apiKey = process.env[cfg.apiKeyEnv] || "";

      try {
        const provider = new OpenAICompatProvider({
          id: cfg.id,
          name: cfg.name || cfg.id,
          apiKey,
          baseURL: cfg.baseURL,
          models: cfg.models || [],
        });
        api.registerModelProvider(provider);
        count++;
        console.log("[custom-provider] Registered:", cfg.id);
      } catch (err) {
        console.warn("[custom-provider] Failed to create provider for %s:", cfg.id, err.message);
      }
    }

    console.log("[custom-provider] Loaded %d custom provider(s)", count);
  },
};
```

- [ ] **Step 3: Create instances directory**

```powershell
New-Item -ItemType Directory -Force -Path "D:\agent-codes\CoBeing\data\plugins\providers\_custom\instances"
Set-Content -Path "D:\agent-codes\CoBeing\data\plugins\providers\_custom\instances\.gitkeep" -Value ""
```

- [ ] **Step 4: Register in registry.json**

Read `data/plugins/registry.json`. Add the `cobeing-plugin-custom-provider` entry:

```json
"cobeing-plugin-custom-provider": {
    "enabled": true,
    "kind": "model-provider",
    "dir": "providers/_custom",
    "config": {}
}
```

Insert alphabetically among existing entries.

- [ ] **Step 5: Build and verify**

```powershell
cd D:\agent-codes\CoBeing; pnpm build
```

Expected: 7 packages build successfully.

- [ ] **Step 6: Commit**

```bash
git add data/plugins/providers/_custom/ data/plugins/registry.json
git commit -m "feat: add _custom provider plugin

Scans instances/ directory for user-defined OpenAI-compatible
providers. Each instance is a JSON file with id, name, apiKeyEnv,
baseURL, and optional models. Registered at startup via the
plugin system.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Create _custom channel plugin

**Files:**
- Create: `data/plugins/channels/_custom/cobeing.plugin.json`
- Create: `data/plugins/channels/_custom/index.js`
- Create: `data/plugins/channels/_custom/instances/.gitkeep`
- Modify: `data/plugins/registry.json`

- [ ] **Step 1: Create the manifest**

Write `data/plugins/channels/_custom/cobeing.plugin.json`:

```json
{
  "id": "cobeing-plugin-custom-channel",
  "name": "Custom Channel Loader",
  "kind": "channel",
  "version": "0.1.0",
  "main": "index.js",
  "cobeingVersion": ">=1.4.0",
  "multiInstance": true,
  "configSchema": {
    "fields": [
      { "key": "name", "label": "名称", "type": "string", "required": true, "placeholder": "e.g. 我的自定义渠道" },
      { "key": "type", "label": "渠道类型", "type": "string", "required": true, "placeholder": "e.g. discord" }
    ]
  }
}
```

- [ ] **Step 2: Create the plugin entry**

Write `data/plugins/channels/_custom/index.js`:

```javascript
// Custom Channel Loader — scans instances/ and registers user-defined channels
import path from "node:path";
import fs from "node:fs";

export default {
  id: "cobeing-plugin-custom-channel",
  name: "Custom Channel Loader",
  kind: "channel",

  async register(api) {
    const pluginDir = import.meta.dirname;
    const instancesDir = path.join(pluginDir, "instances");

    if (!fs.existsSync(instancesDir)) {
      fs.mkdirSync(instancesDir, { recursive: true });
      return;
    }

    const entries = fs.readdirSync(instancesDir);
    let count = 0;

    for (const file of entries) {
      if (!file.endsWith(".json") || file === ".gitkeep") continue;

      let cfg;
      try {
        cfg = JSON.parse(fs.readFileSync(path.join(instancesDir, file), "utf-8"));
      } catch {
        console.warn("[custom-channel] Failed to parse instance:", file);
        continue;
      }

      if (!cfg.id) {
        console.warn("[custom-channel] Skipping instance %s: missing id", file);
        continue;
      }

      try {
        // Custom channels are registered as a stub that can be configured
        // through the channel config system. For now, register as a
        // minimal channel adapter that the user configures credentials for.
        api.registerChannel({
          id: cfg.id,
          start: async () => { console.log("[custom-channel] Started:", cfg.id); },
          stop: async () => { console.log("[custom-channel] Stopped:", cfg.id); },
          send: async (_msg) => { /* no-op: channel type not implemented */ },
          onMessage: (_handler) => { /* no-op */ },
          capabilities: () => ({ sendText: true, receiveText: true }),
          isConnected: () => false,
        });
        count++;
        console.log("[custom-channel] Registered:", cfg.id);
      } catch (err) {
        console.warn("[custom-channel] Failed to create channel for %s:", cfg.id, err.message);
      }
    }

    console.log("[custom-channel] Loaded %d custom channel(s)", count);
  },
};
```

- [ ] **Step 3: Create instances directory**

```powershell
New-Item -ItemType Directory -Force -Path "D:\agent-codes\CoBeing\data\plugins\channels\_custom\instances"
Set-Content -Path "D:\agent-codes\CoBeing\data\plugins\channels\_custom\instances\.gitkeep" -Value ""
```

- [ ] **Step 4: Register in registry.json**

Read `data/plugins/registry.json`. Add the `cobeing-plugin-custom-channel` entry:

```json
"cobeing-plugin-custom-channel": {
    "enabled": true,
    "kind": "channel",
    "dir": "channels/_custom",
    "config": {}
}
```

- [ ] **Step 5: Build and verify**

```powershell
cd D:\agent-codes\CoBeing; pnpm build
```

Expected: 7 packages build successfully.

- [ ] **Step 6: Commit**

```bash
git add data/plugins/channels/_custom/ data/plugins/registry.json
git commit -m "feat: add _custom channel plugin

Scans instances/ directory for user-defined channels.
Each instance is a JSON file with id, name, and type.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Create frontend pluginsStore

**Files:**
- Create: `gui-v2/src/stores/plugins.ts`

- [ ] **Step 1: Create the store**

Write `gui-v2/src/stores/plugins.ts`:

```typescript
import { create } from "zustand";

export interface PluginModelInfo {
  id: string;
  name: string;
  provider?: string;
  contextWindow?: number;
  maxOutput?: number;
  supportsTools?: boolean;
  supportsVision?: boolean;
  tags?: string[];
}

export interface PluginInfo {
  id: string;
  name: string;
  kind: string;
  version: string;
  enabled: boolean;
  models?: PluginModelInfo[];
  channelType?: string;
  toolDefs?: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }>;
  extensions?: Array<{
    id: string;
    type: string;
    label: string;
    componentPath: string;
    icon?: string;
  }>;
  isCustomInstance?: boolean;
  pluginId?: string;
  instanceId?: string;
  config?: Record<string, unknown>;
}

interface PluginsStore {
  plugins: PluginInfo[];
  loaded: boolean;

  setPlugins: (plugins: PluginInfo[]) => void;

  /** Get model-provider plugins only */
  getProviders: () => PluginInfo[];

  /** Get channel plugins only */
  getChannels: () => PluginInfo[];

  /** Get models for a specific provider ID */
  getModels: (providerId: string) => PluginModelInfo[];

  /** Get available channel types */
  getChannelTypes: () => string[];

  /** Get plugins with kind=extension */
  getExtensions: () => PluginInfo[];

  /** Get extension entries by type (settings-panel, dashboard-card, chat-action) */
  getExtensionsByType: (type: string) => Array<{
    id: string;
    type: string;
    label: string;
    componentPath: string;
    icon?: string;
  }>;
}

export const usePluginsStore = create<PluginsStore>((set, get) => ({
  plugins: [],
  loaded: false,

  setPlugins: (plugins) => set({ plugins, loaded: true }),

  getProviders: () => {
    return get().plugins.filter(
      (p) => p.kind === "model-provider" && p.enabled
    );
  },

  getChannels: () => {
    return get().plugins.filter(
      (p) => p.kind === "channel" && p.enabled
    );
  },

  getModels: (providerId) => {
    const plugin = get().plugins.find(
      (p) => p.id === providerId || p.id === `custom:${providerId}`
    );
    return plugin?.models || [];
  },

  getChannelTypes: () => {
    return get()
      .getChannels()
      .map((p) => p.channelType || p.id)
      .filter(Boolean) as string[];
  },

  getExtensions: () => {
    return get().plugins.filter(
      (p) => p.kind === "extension" && p.enabled
    );
  },

  getExtensionsByType: (type) => {
    const exts: Array<{
      id: string;
      type: string;
      label: string;
      componentPath: string;
      icon?: string;
    }> = [];
    for (const plugin of get().getExtensions()) {
      if (plugin.extensions) {
        for (const ext of plugin.extensions) {
          if (ext.type === type) {
            exts.push(ext);
          }
        }
      }
    }
    return exts;
  },
}));
```

- [ ] **Step 2: Verify TypeScript compiles**

```powershell
cd D:\agent-codes\CoBeing\gui-v2; npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add gui-v2/src/stores/plugins.ts
git commit -m "feat: add pluginsStore for dynamic plugin discovery

Zustand store that holds plugin capability data from list_plugins
WS endpoint. Provides filtered accessors: getProviders, getChannels,
getModels, getChannelTypes, getExtensions, getExtensionsByType.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: Wire plugins data into useWebSocket and types

**Files:**
- Modify: `gui-v2/src/hooks/useWebSocket.ts`
- Modify: `gui-v2/src/lib/types.ts`

- [ ] **Step 1: Add PluginInfo and update WsStatePayload in types.ts**

In `gui-v2/src/lib/types.ts`, add:

```typescript
// After existing imports/types, add:

export interface PluginModelInfo {
  id: string;
  name: string;
  provider?: string;
  contextWindow?: number;
  maxOutput?: number;
  supportsTools?: boolean;
  supportsVision?: boolean;
  tags?: string[];
}

export interface PluginInfo {
  id: string;
  name: string;
  kind: string;
  version: string;
  enabled: boolean;
  models?: PluginModelInfo[];
  channelType?: string;
  isCustomInstance?: boolean;
  pluginId?: string;
  instanceId?: string;
  config?: Record<string, unknown>;
}
```

And update `WsStatePayload`:

```typescript
export interface WsStatePayload {
  agents: AgentInfo[];
  groups: GroupInfo[];
  channels: string[];
  plugins: Array<{ id: string; kind: string; enabled: boolean }>;
  timestamp: number;
}
```

- [ ] **Step 2: Add plugin handling to useWebSocket.ts**

In `gui-v2/src/hooks/useWebSocket.ts`:

**Import the plugins store** (add after existing store imports):

```typescript
import { usePluginsStore } from "@/stores/plugins";
```

**Add `list_plugins` dispatch** inside the `_connected` case (after the existing `get_config` line):

```typescript
case "_connected":
    setConnected(true);
    stateRetryCount.current = 0;
    wsClient?.send({ type: "get_state" });
    wsClient?.send({ type: "get_config" });
    wsClient?.send({ type: "list_plugins" });   // <-- ADD THIS
    wsClient?.send({ type: "get_chat_current" });
    // ... rest stays the same
```

**Add `"plugins"` case handler** (after the `"config"` case block):

```typescript
case "plugins": {
    const p = msg.payload as PluginInfo[];
    usePluginsStore.getState().setPlugins(p);
    break;
}
```

Also destructure `PluginInfo` from the import: add to the type import from `@/lib/types`:

```typescript
import type { WsMessage, WsStatePayload, WsMessagePayload, ToolEvent, WorkspaceBinding, PluginInfo } from "@/lib/types";
```

- [ ] **Step 3: Verify TypeScript compiles**

```powershell
cd D:\agent-codes\CoBeing\gui-v2; npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Build full project**

```powershell
cd D:\agent-codes\CoBeing; pnpm build
```

Expected: 7 packages + gui-v2 build pass.

- [ ] **Step 5: Commit**

```bash
git add gui-v2/src/hooks/useWebSocket.ts gui-v2/src/lib/types.ts
git commit -m "feat: wire list_plugins data into frontend

useWebSocket now sends list_plugins on connect and populates
pluginsStore. WsStatePayload extended with plugins summary.
PluginInfo type added to shared frontend types.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 10: Replace hardcoded CATALOG_MODELS in CreateAgentDialog

**Files:**
- Modify: `gui-v2/src/components/agent/CreateAgentDialog.tsx`

- [ ] **Step 1: Remove hardcoded CATALOG_MODELS and use pluginsStore**

In `gui-v2/src/components/agent/CreateAgentDialog.tsx`:

**Remove** the entire `CATALOG_MODELS` constant (lines ~11-73) and `BUILTIN_PROVIDERS` (line ~75).

**Add import**:
```typescript
import { usePluginsStore } from "@/stores/plugins";
```

**Replace provider/model list logic**:

```typescript
// Before:
const configProviders = useConfigStore((s) => s.providers);
// ...
const models = CATALOG_MODELS[provider] || [];

// After:
const pluginProviders = usePluginsStore((s) => s.getProviders());
const getModels = usePluginsStore((s) => s.getModels);

// Build dynamic provider list from plugins
const allProviders = useMemo(() => {
    return pluginProviders.map(p => p.id);
}, [pluginProviders]);

const models = useMemo(() => getModels(provider), [provider, getModels]);
```

**Update provider Select** to use dynamic IDs. Replace the hardcoded `BUILTIN_PROVIDERS` map with `allProviders`.

- [ ] **Step 2: Verify TypeScript**

```powershell
cd D:\agent-codes\CoBeing\gui-v2; npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add gui-v2/src/components/agent/CreateAgentDialog.tsx
git commit -m "refactor: replace hardcoded CATALOG_MODELS in CreateAgentDialog

Provider list and model catalog now come from pluginsStore
dynamically instead of the 73-line static CATALOG_MODELS constant.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 11: Replace hardcoded CATALOG_MODELS in AgentConfigTab

**Files:**
- Modify: `gui-v2/src/components/agent/AgentConfigTab.tsx`

- [ ] **Step 1: Remove hardcoded CATALOG_MODELS and use pluginsStore**

In `gui-v2/src/components/agent/AgentConfigTab.tsx`:

**Remove** the `CATALOG_MODELS` constant (lines ~16-53).

**Add import**:
```typescript
import { usePluginsStore } from "@/stores/plugins";
```

**Update provider list** — in the `allProviders` useMemo (around line 116):

```typescript
// Before:
const allProviders = useMemo(() => {
    const merged = new Set([...Object.keys(CATALOG_MODELS), ...Object.keys(configProviders)]);
    return [...merged].sort();
}, [configProviders]);

// After:
const pluginProviders = usePluginsStore((s) => s.getProviders());
const getModels = usePluginsStore((s) => s.getModels);

const allProviders = useMemo(() => {
    const pluginIds = pluginProviders.map(p => p.id);
    const configIds = Object.keys(configProviders);
    const merged = new Set([...pluginIds, ...configIds]);
    return [...merged].sort();
}, [pluginProviders, configProviders]);
```

**Update models list** (around line 121):

```typescript
// Before:
const models = CATALOG_MODELS[provider] || [];

// After:
const models = useMemo(() => getModels(provider), [provider, getModels]);
```

**Update provider change handler** (around line 195-197):

```typescript
// Before:
const m = CATALOG_MODELS[v];

// After:
const m = getModels(v);
```

- [ ] **Step 2: Verify TypeScript**

```powershell
cd D:\agent-codes\CoBeing\gui-v2; npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add gui-v2/src/components/agent/AgentConfigTab.tsx
git commit -m "refactor: replace hardcoded CATALOG_MODELS in AgentConfigTab

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 12: Replace hardcoded CATALOG_MODELS in GroupMembersTab

**Files:**
- Modify: `gui-v2/src/components/group/GroupMembersTab.tsx`

- [ ] **Step 1: Remove hardcoded CATALOG_MODELS and use pluginsStore**

In `gui-v2/src/components/group/GroupMembersTab.tsx`:

**Remove** the `CATALOG_MODELS` constant (lines ~10-22) and `ALL_PROVIDERS` (line ~24).

**Add import**:
```typescript
import { usePluginsStore } from "@/stores/plugins";
```

**Update models lookup** (around line 72):

```typescript
// Before:
const editModels = editMember ? (CATALOG_MODELS[editMember.provider] || []) : [];

// After:
const getModels = usePluginsStore((s) => s.getModels);
const editModels = editMember ? (getModels(editMember.provider) || []) : [];
```

- [ ] **Step 2: Verify TypeScript**

```powershell
cd D:\agent-codes\CoBeing\gui-v2; npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add gui-v2/src/components/group/GroupMembersTab.tsx
git commit -m "refactor: replace hardcoded CATALOG_MODELS in GroupMembersTab

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 13: Update ProvidersSection for dynamic plugin data

**Files:**
- Modify: `gui-v2/src/components/settings/ProvidersSection.tsx`

- [ ] **Step 1: Merge plugin providers into the display list**

In `gui-v2/src/components/settings/ProvidersSection.tsx`:

**Add import**:
```typescript
import { usePluginsStore } from "@/stores/plugins";
```

**In the component**, read plugin providers and merge with config providers:

```typescript
const pluginProviders = usePluginsStore((s) => s.getProviders());
```

**Build merged entries** for display:

```typescript
// Merge config providers with plugin providers
const entries = useMemo(() => {
    const result: Array<[string, ProviderEntry]> = [];
    const added = new Set<string>();

    // Config providers first (with API key info)
    for (const [key, p] of Object.entries(providers)) {
        result.push([key, p as ProviderEntry]);
        added.add(key);
    }

    // Plugin providers not in config (marked as plugin-managed)
    for (const pp of pluginProviders) {
        // Strip custom: prefix for display
        const displayId = pp.id.startsWith("custom:") ? pp.id.slice(7) : pp.id;
        if (!added.has(displayId) && !added.has(pp.id)) {
            result.push([pp.id, {
                name: pp.name || pp.id,
                apiKeyEnv: "",
                _apiKeyResolved: "Plugin 管理",
                type: "openai-compat",
                baseURL: "",
            } as ProviderEntry]);
            added.add(pp.id);
        }
    }

    return result;
}, [providers, pluginProviders]);
```

**Update add button** to also show available plugin provider templates (the `_custom` plugin). Keep existing `handleAdd` for direct input, but add a "从插件添加" section.

- [ ] **Step 2: Preserve PRESETS for quick-fill in forms**

The `PRESETS` constant stays as-is — it's used only to fill the edit form fields quickly when user selects a known vendor. No change needed.

- [ ] **Step 3: Verify TypeScript**

```powershell
cd D:\agent-codes\CoBeing\gui-v2; npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add gui-v2/src/components/settings/ProvidersSection.tsx
git commit -m "feat: merge plugin providers into ProvidersSection display

Plugin-managed providers now appear alongside config providers.
PRESETS kept for quick-fill convenience.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 14: Update ChannelsSection for dynamic plugin data

**Files:**
- Modify: `gui-v2/src/components/settings/ChannelsSection.tsx`

- [ ] **Step 1: Merge plugin channels into the display and type selector**

In `gui-v2/src/components/settings/ChannelsSection.tsx`:

**Add import**:
```typescript
import { usePluginsStore } from "@/stores/plugins";
```

**Read plugin channels**:

```typescript
const pluginChannels = usePluginsStore((s) => s.getChannels());
```

**Merge for display** (similar pattern to ProvidersSection):

```typescript
const entries = useMemo(() => {
    const result: Array<[string, ChannelEntry]> = [];
    const added = new Set<string>();

    for (const [key, ch] of Object.entries(channels)) {
        if (ch != null) {
            result.push([key, ch as ChannelEntry]);
            added.add(key);
        }
    }

    for (const pc of pluginChannels) {
        const displayId = pc.id.startsWith("custom:") ? pc.id.slice(7) : pc.id;
        if (!added.has(displayId) && !added.has(pc.id)) {
            result.push([pc.id, {
                name: pc.name || pc.id,
                enabled: true,
                type: pc.channelType || "custom",
                _pluginManaged: true,
            } as ChannelEntry]);
            added.add(pc.id);
        }
    }

    return result;
}, [channels, pluginChannels]);
```

**Add plugin channel types to the type selector** in the edit dialog. The `CHANNEL_PRESETS` stays, but also append plugin channel types.

- [ ] **Step 2: Verify TypeScript**

```powershell
cd D:\agent-codes\CoBeing\gui-v2; npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add gui-v2/src/components/settings/ChannelsSection.tsx
git commit -m "feat: merge plugin channels into ChannelsSection display

Plugin-managed channels appear alongside config channels.
CHANNEL_PRESETS kept for quick-fill.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 15: Append plugin settings-panel entries to SettingsView

**Files:**
- Modify: `gui-v2/src/components/settings/SettingsView.tsx`

- [ ] **Step 1: Add plugin extensions to MENU_SECTIONS**

In `gui-v2/src/components/settings/SettingsView.tsx`:

**Add import**:
```typescript
import { usePluginsStore } from "@/stores/plugins";
```

**Read plugin settings panels** inside the component:

```typescript
const pluginSettingsPanels = usePluginsStore((s) => s.getExtensionsByType("settings-panel"));
```

**Append to menu** — compute a dynamic menu array:

```typescript
const dynamicMenuSections = useMemo(() => {
    if (pluginSettingsPanels.length === 0) return MENU_SECTIONS;
    return [
        ...MENU_SECTIONS,
        ...pluginSettingsPanels.map(ext => ({
            id: `plugin:${ext.id}` as SettingsSection,
            label: ext.label,
            group: "插件",
        })),
    ];
}, [pluginSettingsPanels]);
```

Use `dynamicMenuSections` instead of `MENU_SECTIONS` in the render.

**Add rendering for plugin panels** in the content area. After the existing settingsSection checks, add:

```typescript
{/* Plugin settings panels */}
{pluginSettingsPanels.map(ext => (
    settingsSection === `plugin:${ext.id}` && (
        <div key={ext.id}>
            <h2 className="text-lg font-semibold text-txt mb-1">{ext.label}</h2>
            <p className="text-sm text-txt-muted mb-6">由插件提供</p>
            <div className="text-sm text-txt-muted">
                插件组件路径: {ext.componentPath}
            </div>
        </div>
    )
))}
```

**Update SettingsSection type** in `stores/settings.ts` to allow dynamic plugin IDs:

```typescript
// Before:
export type SettingsSection = "general" | "theme" | "providers" | "channels" | "mcp" | "sandbox" | "usage" | "logs" | "search" | "export" | "about";

// After:
export type SettingsSection = "general" | "theme" | "providers" | "channels" | "mcp" | "sandbox" | "usage" | "logs" | "search" | "export" | "about" | `plugin:${string}`;
```

- [ ] **Step 2: Verify TypeScript**

```powershell
cd D:\agent-codes\CoBeing\gui-v2; npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Build full project**

```powershell
cd D:\agent-codes\CoBeing; pnpm build
```

Expected: All packages build pass.

- [ ] **Step 4: Commit**

```bash
git add gui-v2/src/components/settings/SettingsView.tsx gui-v2/src/stores/settings.ts
git commit -m "feat: support plugin settings-panel extensions in SettingsView

Dynamic menu entries appended from plugins' registered UI extensions.
SettingsSection type extended with plugin:${string} template literal.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 16: End-to-end verification

**Files:** None (verification only)

- [ ] **Step 1: Full build**

```powershell
cd D:\agent-codes\CoBeing; pnpm build
```

Expected: 7 packages + gui-v2 build all pass.

- [ ] **Step 2: Full test suite**

```powershell
cd D:\agent-codes\CoBeing; pnpm test
```

Expected: 417 tests pass (43 files).

- [ ] **Step 3: Manual WS test**

Start the app. Connect via WebSocket client. Send these messages and verify:

```
→ { "type": "list_plugins" }
Expected response: plugins array with entries for deepseek, zhipu, qwen, minimax,
  volcengine, moonshot, mimo, qqbot, _custom-provider, _custom-channel
  (all enabled entries from registry.json)

→ { "type": "get_state" }
Expected response: includes plugins array in payload

→ { "type": "get_config" }
Expected response: providers includes plugin-managed entries with _pluginManaged: true
```

- [ ] **Step 4: Frontend verification checklist**

Launch GUI and verify:
- [ ] Settings → Providers: shows deepseek + plugin providers (zhipu, qwen, etc.)
- [ ] Settings → Channels: shows qqbot
- [ ] Create Agent dialog → Provider dropdown: dynamic list from plugins
- [ ] Create Agent dialog → Model dropdown: models for selected provider from plugin data
- [ ] Agent Config Tab → Provider/Model: same dynamic behavior
- [ ] Group Members Tab → Edit provider/model: dynamic
- [ ] Hardcoded providers (openai/anthropic/gemini/grok/siliconflow) are GONE from all dropdowns

- [ ] **Step 5: Test _custom instance flow**

Send via WS:
```
→ { "type": "add_plugin_instance", "payload": {
    "pluginId": "cobeing-plugin-custom-provider",
    "instanceId": "test-llm",
    "config": { "name": "Test LLM", "apiKeyEnv": "TEST_KEY", "baseURL": "https://test.example.com/v1" }
  }}
Expected response: { type: "plugin_instance_added", payload: { pluginId, instanceId, config } }
```

Verify: `data/plugins/providers/_custom/instances/test-llm.json` exists.

Send `list_plugins` again — expected: includes `custom:test-llm` in the list.

Clean up:
```
→ { "type": "remove_plugin_instance", "payload": {
    "pluginId": "cobeing-plugin-custom-provider",
    "instanceId": "test-llm"
  }}
```

- [ ] **Step 6: Final commit (if needed)**

```bash
git status
# If any uncommitted changes, commit them
```
