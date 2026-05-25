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
