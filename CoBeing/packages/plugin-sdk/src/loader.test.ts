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
      registerModelProvider(p: any) { registeredProviders.push(p.id); },
      registerChannel(c: any) { registeredChannels.push(c.id); },
      registerTool() {},
      registerMemoryBackend() {},
      onHook() {},
      registerPromptLayer() {},
      registerSkill() {},
      registerToolAgent() {},
      registerUIExtension() {},
      getConfig() { return {}; },
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

  it("skips registry entries whose dir escapes plugins root", async () => {
    const loader = new PluginLoader(api);
    const loaded = await loader.loadFromRegistry({
      version: 1,
      plugins: {
        evil: { enabled: true, kind: "tool", dir: "../evil", config: {} },
      },
    }, pluginsDir);

    expect(loaded).toEqual([]);
  });

  it("rejects plugin main paths that escape plugin directory", async () => {
    const pluginDir = path.join(pluginsDir, "bad-main");
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.writeFileSync(path.join(pluginDir, "cobeing.plugin.json"), JSON.stringify({
      id: "bad-main",
      name: "Bad Main",
      kind: "tool",
      version: "1.0.0",
      main: "../outside.js",
    }));

    const loader = new PluginLoader(api);
    await expect(loader.loadAll(["bad-main"], pluginsDir)).rejects.toThrow(/escapes plugin directory/);
  });

  it("allows trusted built-in plugin entries outside the plugin directory", async () => {
    const repoTmpDir = fs.mkdtempSync(path.join(process.cwd(), ".plugin-loader-test-"));
    const repoPluginsDir = path.join(repoTmpDir, "plugins");
    const pluginDir = path.join(repoPluginsDir, "builtin-main");
    const builtinsDir = path.join(process.cwd(), "packages", "plugin-sdk", "dist", "builtins");
    const builtinEntry = path.join(builtinsDir, `test-builtin-loader-${Date.now()}.js`);

    try {
      fs.mkdirSync(pluginDir, { recursive: true });
      fs.mkdirSync(builtinsDir, { recursive: true });
      fs.writeFileSync(path.join(pluginDir, "cobeing.plugin.json"), JSON.stringify({
        id: "builtin-main",
        name: "Builtin Main",
        kind: "model-provider",
        version: "1.0.0",
        main: path.relative(pluginDir, builtinEntry),
      }));
      fs.writeFileSync(builtinEntry, `
        export default {
          id: "builtin-main",
          name: "Builtin Main",
          kind: "model-provider",
          register(api) {
            api.registerModelProvider({ id: "builtin-main", models: [], chat: async function*() {} });
          }
        };
      `);

      const loader = new PluginLoader(api);
      await loader.loadAll(["builtin-main"], repoPluginsDir);
      expect(registeredProviders).toContain("builtin-main");
    } finally {
      fs.rmSync(builtinEntry, { force: true });
      fs.rmSync(repoTmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});
