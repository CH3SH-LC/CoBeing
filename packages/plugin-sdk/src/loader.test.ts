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
