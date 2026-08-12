/**
 * Plugin 加载辅助模块（从 runtime.ts 提取，行为不变）
 *
 * 职责：从 registry.json 加载启用插件（Provider/Channel/Tool/Extension）、
 * 首次启动扫描插件目录生成 registry、cobeingVersion 校验、孤儿条目清理、
 * 插件工具注入、插件 providers 同步。
 */
import path from "node:path";
import fs from "node:fs";
import { PluginLoader } from "@cobeing/plugin-sdk";
import type { PluginRegistry } from "@cobeing/plugin-sdk";
import type { LLMProvider } from "@cobeing/providers";
import { createLogger } from "@cobeing/shared";
import type { AgentRegistry } from "../agent/registry.js";

const log = createLogger("runtime");

/** Plugin 加载域所需依赖（由 CoBeingRuntime 提供） */
export interface PluginLoadDeps {
  dataRoot: string;
  rootDir: string;
  pluginLoader: PluginLoader;
  registry: AgentRegistry;
  providers: Map<string, LLMProvider>;
}

/**
 * 从 registry.json 加载所有启用的插件（统一入口，替代 loadProviderPlugins）。
 * 返回解析后的 pluginRegistry（供 startChannels 读取 bindTo）；解析失败返回 null。
 */
export async function loadAllPlugins(deps: PluginLoadDeps): Promise<PluginRegistry | null> {
  const { dataRoot, rootDir, pluginLoader, registry, providers } = deps;
  const pluginsRoot = path.resolve(dataRoot, "plugins");
  const registryPath = path.join(pluginsRoot, "registry.json");

  if (!fs.existsSync(registryPath)) {
    bootstrapRegistry(pluginsRoot, registryPath);
  }

  let registry2: PluginRegistry;
  try {
    registry2 = JSON.parse(fs.readFileSync(registryPath, "utf-8")) as PluginRegistry;
  } catch {
    log.warn("Failed to parse registry.json — plugins disabled");
    return null;
  }

  // Read current CoBeing version for cobeingVersion check
  let currentVersion = "0.0.0";
  try {
    const pkgJsonPath = path.resolve(rootDir, "package.json");
    if (fs.existsSync(pkgJsonPath)) {
      const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
      currentVersion = pkgJson.version || "0.0.0";
    }
  } catch { /* keep default */ }
  const [curMajor, curMinor] = currentVersion.split(".").map(Number);

  // cobeingVersion validation: skip plugins whose version requirement is not met
  let skippedVersionCheck = 0;
  for (const [pluginId, entry] of Object.entries(registry2.plugins)) {
    if (!entry.enabled) continue;
    const pluginDir = path.join(pluginsRoot, entry.dir || "");
    const manifestPath = path.join(pluginDir, "cobeing.plugin.json");
    if (fs.existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
        if (manifest.cobeingVersion) {
          const reqStr = String(manifest.cobeingVersion);
          // Simple semver: extract major.minor from requirement string (e.g. ">=1.4.0" → 1.4)
          const verMatch = reqStr.match(/(\d+)\.(\d+)/);
          if (verMatch) {
            const reqMajor = Number(verMatch[1]);
            const reqMinor = Number(verMatch[2]);
            const satisfied = curMajor > reqMajor || (curMajor === reqMajor && curMinor >= reqMinor);
            if (!satisfied) {
              log.warn(
                "Plugin '%s' requires CoBeing %s but current version is %s — skipping",
                pluginId, reqStr, currentVersion,
              );
              entry.enabled = false;
              skippedVersionCheck++;
            }
          }
        }
      } catch { /* skip version check on parse error */ }
    }
  }

  const loaded = await pluginLoader.loadFromRegistry(registry2, pluginsRoot);
  log.info("Plugins loaded: %d (%s)", loaded.length, loaded.join(", ") || "none");

  // Orphan registry entry cleanup: remove entries whose dir doesn't exist on disk
  const orphanIds: string[] = [];
  for (const [pluginId, entry] of Object.entries(registry2.plugins)) {
    const pluginDir = path.join(pluginsRoot, entry.dir || "");
    if (entry.dir && !fs.existsSync(pluginDir)) {
      orphanIds.push(pluginId);
      log.warn("Orphan plugin registry entry '%s': dir '%s' not found — removing", pluginId, entry.dir);
    }
  }
  if (orphanIds.length > 0) {
    for (const id of orphanIds) {
      delete registry2.plugins[id];
    }
    try {
      fs.writeFileSync(registryPath, JSON.stringify(registry2, null, 2), "utf-8");
      log.info("Cleaned %d orphan registry entr%s", orphanIds.length, orphanIds.length === 1 ? "y" : "ies");
    } catch (err: any) {
      log.warn("Failed to save cleaned registry: %s", err.message);
    }
  }

  // 同步插件注册的 providers 到 this.providers
  const { getAllProviders } = await import("@cobeing/providers");
  for (const p of getAllProviders()) {
    if (!providers.has(p.id)) {
      providers.set(p.id, p);
      log.info("Plugin provider registered: %s", p.id);
    }
  }

  // 注入插件工具到所有 Agent
  const pluginTools: Map<string, import("@cobeing/plugin-sdk").ToolPlugin> =
    (globalThis as any).__cobeing?.pluginTools ?? new Map();
  if (pluginTools.size > 0) {
    const allAgents = [...registry.list()];
    const seen = new Set<string>();
    for (const agent of allAgents) {
      if (seen.has(agent.id)) continue;
      seen.add(agent.id);
      for (const [, toolPlugin] of pluginTools) {
        for (const toolDef of toolPlugin.tools) {
          try {
            agent.registerTool({
              name: toolDef.name,
              description: toolDef.description,
              parameters: { type: "object", properties: toolDef.parameters as any, required: [] },
              execute: async (params: Record<string, unknown>, _ctx: any) => {
                const r = await toolDef.execute(params);
                return { content: r.content, isError: r.isError ?? false, toolCallId: "" };
              },
            });
          } catch (err: any) {
            log.warn("Failed to register plugin tool %s for %s: %s", toolDef.name, agent.id, err.message);
          }
        }
      }
    }
    log.info("Injected %d plugin tool(s) into %d agent(s)", pluginTools.size, seen.size);
  }

  return registry2;
}

/** 首次启动时扫描插件目录并生成 registry.json */
export function bootstrapRegistry(pluginsRoot: string, registryPath: string): void {
  const registry: PluginRegistry = {
    version: 1,
    plugins: {},
  };

  for (const kind of ["providers", "channels", "tools", "extensions"]) {
    const kindDir = path.join(pluginsRoot, kind);
    if (!fs.existsSync(kindDir)) continue;
    for (const entry of fs.readdirSync(kindDir)) {
      const entryPath = path.join(kindDir, entry);
      if (!fs.statSync(entryPath).isDirectory()) continue;
      const manifestPath = path.join(entryPath, "cobeing.plugin.json");
      if (!fs.existsSync(manifestPath)) continue;
      try {
        const m: { id: string; kind: string } = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
        if (registry.plugins[m.id]) {
          log.warn("Duplicate plugin ID '%s' in %s/%s — overwriting previous entry %s",
            m.id, kind, entry, registry.plugins[m.id].dir);
        }
        registry.plugins[m.id] = {
          enabled: false,
          kind: m.kind,
          dir: `${kind}/${entry}`,
          config: {},
        };
      } catch { /* skip corrupt */ }
    }
  }

  fs.mkdirSync(path.dirname(registryPath), { recursive: true });
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2), "utf-8");
  log.info("Bootstrapped plugin registry with %d plugin(s)", Object.keys(registry.plugins).length);
}
