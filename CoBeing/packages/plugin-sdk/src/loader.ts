import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ModelInfo } from "@cobeing/shared";
import { getAllProviders } from "@cobeing/providers";
import { getAllChannels } from "@cobeing/channels";
import type { CoBeingPlugin, CoBeingPluginApi, PluginManifest, PluginRegistry } from "./types.js";

const log = {
  info(...args: any[]) { console.log("[plugin-loader]", ...args); },
  warn(...args: any[]) { console.warn("[plugin-loader]", ...args); },
  error(...args: any[]) { console.error("[plugin-loader]", ...args); },
};

export class PluginLoader {
  private api: CoBeingPluginApi;
  private loaded = new Map<string, CoBeingPlugin>();

  constructor(api: CoBeingPluginApi) {
    this.api = api;
  }

  /**
   * 同步扫描目录，返回发现的插件 ID 列表（排除已配置的）
   * @deprecated Not used by runtime — only retained for tests. Prefer loadFromRegistry().
   */
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

  /** 从 registry.json 驱动加载所有启用的插件 */
  async loadFromRegistry(registry: PluginRegistry, pluginsRoot: string): Promise<string[]> {
    const loaded: string[] = [];
    const root = safeRealpath(pluginsRoot);

    for (const [id, entry] of Object.entries(registry.plugins)) {
      if (!entry.enabled) {
        log.info("Plugin %s is disabled — skipping", id);
        continue;
      }

      if (!isSafeRelativePath(entry.dir)) {
        log.warn("Plugin %s has invalid dir '%s' - skipping", id, entry.dir);
        continue;
      }
      const pluginDir = path.resolve(root, entry.dir);
      if (!isPathWithin(root, pluginDir)) {
        log.warn("Plugin %s dir escapes plugins root - skipping", id);
        continue;
      }
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

  getLoaded(): ReadonlyMap<string, CoBeingPlugin> {
    return this.loaded;
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
          pluginDir = path.resolve(rootDir, entry);
          manifest = m;
          break;
        }
      } catch { /* skip */ }
    }

    if (!pluginDir || !manifest) {
      throw new Error(`Plugin not found: ${id}. No cobeing.plugin.json matches this ID in ${rootDir}.`);
    }

    const entryPath = resolvePluginEntry(pluginDir, manifest.main);
    await this._loadPlugin(id, entryPath);
    if (!this.loaded.has(id)) {
      throw new Error(`Plugin ${id}: failed to load (see warnings above)`);
    }
  }

  /** 从指定目录加载单个插件 */
  private async loadOneByDir(id: string, pluginDir: string): Promise<void> {
    const manifestPath = path.join(pluginDir, "cobeing.plugin.json");
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`Manifest not found at ${manifestPath}`);
    }

    const manifest: PluginManifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    const entryPath = resolvePluginEntry(pluginDir, manifest.main);
    await this._loadPlugin(id, entryPath);
    if (this.loaded.has(id)) {
      log.info("Plugin loaded: %s (%s)", id, pluginDir);
    } else {
      log.warn("Plugin %s failed to load (check earlier warnings for import/register errors)", id);
    }
  }

  /** Extract shared logic: import entry, wrap api with pluginId, call register */
  private async _loadPlugin(id: string, entryPath: string): Promise<void> {
    let pluginModule: any;
    try {
      pluginModule = await import(pathToFileURL(entryPath).href);
    } catch (err: any) {
      log.warn("Failed to import plugin %s from %s: %s — skipping", id, entryPath, err.message);
      return;
    }

    const plugin: CoBeingPlugin = pluginModule.default || pluginModule;

    if (!plugin || typeof plugin.register !== "function") {
      log.warn("Plugin %s: entry must export a CoBeingPlugin with a register() method — skipping", id);
      return;
    }

    // Wrap api.onHook to auto-inject pluginId
    const baseApi = this.api;
    const pluginApi: CoBeingPluginApi = {
      ...baseApi,
      onHook(event: any, handler: any) {
        const hookBus = (baseApi as any)._hookBus;
        if (hookBus && typeof hookBus.on === "function") {
          hookBus.on(event, id, handler);
        }
      },
    };

    // Snapshot registries before register() so we can report partial effects on failure
    const preProviderIds = new Set(getAllProviders().map(p => p.id));
    const preChannelIds = new Set(getAllChannels().map(c => c.id));

    // Timeout for register(): prevent hung plugins from blocking startup
    const REGISTER_TIMEOUT_MS = 30_000;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    try {
      await Promise.race([
        plugin.register(pluginApi),
        new Promise<void>((_, reject) => {
          timerId = setTimeout(() => reject(new Error("register() timeout after 30s")), REGISTER_TIMEOUT_MS);
        }),
      ]);
    } catch (err: any) {
      const newProviders = getAllProviders().map(p => p.id).filter(id => !preProviderIds.has(id));
      const newChannels = getAllChannels().map(c => c.id).filter(id => !preChannelIds.has(id));
      log.warn(
        "Plugin %s register() failed: %s",
        id,
        err.message,
      );
      if (newProviders.length > 0 || newChannels.length > 0) {
        log.warn(
          "Plugin %s partially registered: providers=%o channels=%o — these registrations remain active",
          id,
          newProviders,
          newChannels,
        );
      }
      return;
    } finally {
      if (timerId) clearTimeout(timerId);
    }

    this.loaded.set(id, plugin);
  }
}

function isSafeRelativePath(p: string): boolean {
  if (!p || path.isAbsolute(p)) return false;
  const parts = p.split(/[\\/]+/);
  return parts.every(part => part && part !== "." && part !== "..");
}

function safeRealpath(p: string): string {
  const resolved = path.resolve(p);
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function isPathWithin(baseDir: string, targetPath: string): boolean {
  const base = safeRealpath(baseDir);
  const target = safeRealpath(targetPath);
  const rel = path.relative(base, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function resolvePluginEntry(pluginDir: string, main: string): string {
  if (!isSafePluginEntryPath(main)) {
    throw new Error(`Invalid plugin main path: ${main}`);
  }
  const entryPath = path.resolve(pluginDir, main);
  if (!isPathWithin(pluginDir, entryPath) && !isPathWithin(getTrustedBuiltinsDir(), entryPath)) {
    throw new Error(`Plugin main escapes plugin directory: ${main}`);
  }
  return entryPath;
}

function isSafePluginEntryPath(p: string): boolean {
  if (!p || path.isAbsolute(p) || p.includes("\0")) return false;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(p)) return false;
  const parts = p.split(/[\\/]+/);
  return parts.every(part => part && part !== ".");
}

function getTrustedBuiltinsDir(): string {
  return path.resolve(process.cwd(), "packages", "plugin-sdk", "dist", "builtins");
}
