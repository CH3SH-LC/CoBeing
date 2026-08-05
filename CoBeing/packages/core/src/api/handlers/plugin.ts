/**
 * plugin 域 WS 命令 handler — 从 ws-server.ts 的 switch 迁移
 * list_ui_extensions / list_plugins / add_plugin_instance / remove_plugin_instance
 * update_plugin_instance / toggle_plugin / update_plugin_config
 */
import fs from "node:fs";
import path from "node:path";
import type { HandlerRegistrar } from "./types.js";

export function registerPluginHandlers(register: HandlerRegistrar): void {
  register("list_ui_extensions", function (ws, msg) {
    const registry = (globalThis as any).__cobeing?.uiExtensions;
    const exts = registry && typeof registry.list === "function" ? registry.list() : [];
    this.sendToClient(ws, {
      type: "ui_extensions",
      payload: { extensions: exts.map((e: any) => ({ id: e.id, type: e.type, label: e.label, componentPath: e.componentPath, icon: e.icon })) },
    });
  });

  register("list_plugins", function (ws, msg) {
    const plugins = this.listPlugins();
    this.sendToClient(ws, { type: "plugins", payload: plugins });
  });

  register("add_plugin_instance", function (ws, msg) {
    const { pluginId, instanceId, config } = msg.payload as {
      pluginId: string; instanceId: string; config: Record<string, unknown>;
    };
    // Validate instanceId: only allow alphanumeric, hyphens, underscores
    if (!instanceId || !/^[\w][\w\-]*$/.test(instanceId)) {
      this.sendToClient(ws, { type: "error", payload: { message: "Invalid instanceId: must be alphanumeric with hyphens/underscores only" } });
      return;
    }
    try {
      const runtime = (globalThis as any).__cobeing?.runtime;
      const pluginRegistry = runtime?.pluginRegistry;
      if (!pluginRegistry || !pluginRegistry.plugins[pluginId]) {
        this.sendToClient(ws, { type: "error", payload: { message: `Plugin not found: ${pluginId}` } });
        return;
      }
      const entry = pluginRegistry.plugins[pluginId];
      if (entry.dir && (entry.dir.includes("..") || path.isAbsolute(entry.dir))) {
        this.sendToClient(ws, { type: "error", payload: { message: "Invalid plugin directory" } });
        return;
      }
      const pluginDir = path.join(this.dataRoot, "plugins", entry.dir || "");
      const instancesDir = path.join(pluginDir, "instances");
      fs.mkdirSync(instancesDir, { recursive: true });
      const instancePath = path.join(instancesDir, `${instanceId}.json`);
      // Defense-in-depth: verify resolved path is within instances directory
      const resolved = path.resolve(instancePath);
      if (!resolved.startsWith(path.resolve(instancesDir))) {
        this.sendToClient(ws, { type: "error", payload: { message: "Path traversal denied" } });
        return;
      }
      const instanceData = { id: instanceId, ...config };
      fs.writeFileSync(instancePath, JSON.stringify(instanceData, null, 2), "utf-8");
      if (entry.kind === "model-provider" && typeof (runtime as any).rebuildProvider === "function") {
        (runtime as any).rebuildProvider(instanceId);
      }
      this.sendToClient(ws, {
        type: "plugin_instance_added",
        payload: { pluginId, instanceId, config: instanceData },
      });
    } catch (err: any) {
      this.sendToClient(ws, { type: "error", payload: { message: err.message } });
    }
  });

  register("remove_plugin_instance", function (ws, msg) {
    const { pluginId, instanceId } = msg.payload as { pluginId: string; instanceId: string };
    // Validate instanceId: only allow alphanumeric, hyphens, underscores
    if (!instanceId || !/^[\w][\w\-]*$/.test(instanceId)) {
      this.sendToClient(ws, { type: "error", payload: { message: "Invalid instanceId: must be alphanumeric with hyphens/underscores only" } });
      return;
    }
    try {
      const runtime = (globalThis as any).__cobeing?.runtime;
      const pluginRegistry = runtime?.pluginRegistry;
      if (!pluginRegistry || !pluginRegistry.plugins[pluginId]) {
        this.sendToClient(ws, { type: "error", payload: { message: `Plugin not found: ${pluginId}` } });
        return;
      }
      const entry = pluginRegistry.plugins[pluginId];
      if (entry.dir && (entry.dir.includes("..") || path.isAbsolute(entry.dir))) {
        this.sendToClient(ws, { type: "error", payload: { message: "Invalid plugin directory" } });
        return;
      }
      const instancesDir = path.join(this.dataRoot, "plugins", entry.dir || "", "instances");
      const instancePath = path.join(instancesDir, `${instanceId}.json`);
      // Defense-in-depth: verify resolved path is within instances directory
      const resolved = path.resolve(instancePath);
      if (!resolved.startsWith(path.resolve(instancesDir))) {
        this.sendToClient(ws, { type: "error", payload: { message: "Path traversal denied" } });
        return;
      }
      if (fs.existsSync(instancePath)) fs.rmSync(instancePath);
      this.sendToClient(ws, {
        type: "plugin_instance_removed",
        payload: { pluginId, instanceId },
      });
    } catch (err: any) {
      this.sendToClient(ws, { type: "error", payload: { message: err.message } });
    }
  });

  register("update_plugin_instance", function (ws, msg) {
    const { pluginId, instanceId, config } = msg.payload as {
      pluginId: string; instanceId: string; config: Record<string, unknown>;
    };
    // Validate instanceId: only allow alphanumeric, hyphens, underscores
    if (!instanceId || !/^[\w][\w\-]*$/.test(instanceId)) {
      this.sendToClient(ws, { type: "error", payload: { message: "Invalid instanceId: must be alphanumeric with hyphens/underscores only" } });
      return;
    }
    try {
      const runtime = (globalThis as any).__cobeing?.runtime;
      const pluginRegistry = runtime?.pluginRegistry;
      if (!pluginRegistry || !pluginRegistry.plugins[pluginId]) {
        this.sendToClient(ws, { type: "error", payload: { message: `Plugin not found: ${pluginId}` } });
        return;
      }
      const entry = pluginRegistry.plugins[pluginId];
      if (entry.dir && (entry.dir.includes("..") || path.isAbsolute(entry.dir))) {
        this.sendToClient(ws, { type: "error", payload: { message: "Invalid plugin directory" } });
        return;
      }
      const instancesDir = path.join(this.dataRoot, "plugins", entry.dir || "", "instances");
      const instancePath = path.join(instancesDir, `${instanceId}.json`);
      // Defense-in-depth: verify resolved path is within instances directory
      const resolved = path.resolve(instancePath);
      if (!resolved.startsWith(path.resolve(instancesDir))) {
        this.sendToClient(ws, { type: "error", payload: { message: "Path traversal denied" } });
        return;
      }
      let existing: Record<string, unknown> = { id: instanceId };
      if (fs.existsSync(instancePath)) {
        try { existing = JSON.parse(fs.readFileSync(instancePath, "utf-8")); } catch { /* use default */ }
      }
      const merged = { ...existing, ...config, id: instanceId };
      fs.mkdirSync(instancesDir, { recursive: true });
      fs.writeFileSync(instancePath, JSON.stringify(merged, null, 2), "utf-8");
      if (entry.kind === "model-provider" && typeof (runtime as any).rebuildProvider === "function") {
        (runtime as any).rebuildProvider(instanceId);
      }
      this.sendToClient(ws, {
        type: "plugin_instance_updated",
        payload: { pluginId, instanceId, config: merged },
      });
    } catch (err: any) {
      this.sendToClient(ws, { type: "error", payload: { message: err.message } });
    }
  });

  register("toggle_plugin", function (ws, msg) {
    const { pluginId, enabled } = msg.payload as { pluginId: string; enabled: boolean };
    if (!pluginId || typeof pluginId !== "string" || !/^[\w][\w\-]*$/.test(pluginId) || pluginId.length > 64) {
      this.sendToClient(ws, { type: "error", payload: { message: "无效的 pluginId" } });
      return;
    }
    if (typeof enabled !== "boolean") {
      this.sendToClient(ws, { type: "error", payload: { message: "缺少 pluginId 或 enabled" } });
      return;
    }
    const registryPath = path.join(this.dataRoot, "plugins", "registry.json");
    try {
      let registry = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
      if (!registry.plugins[pluginId]) {
        this.sendToClient(ws, { type: "error", payload: { message: `插件 ${pluginId} 不存在` } });
        return;
      }
      registry.plugins[pluginId].enabled = enabled;
      const tmpPath = registryPath + ".tmp." + Date.now();
      fs.writeFileSync(tmpPath, JSON.stringify(registry, null, 2), "utf-8");
      fs.renameSync(tmpPath, registryPath);
      // Sync runtime state
      const rt = (globalThis as any).__cobeing?.runtime;
      if (rt && rt.pluginRegistry && rt.pluginRegistry.plugins[pluginId]) {
        rt.pluginRegistry.plugins[pluginId].enabled = enabled;
      }
      this.broadcastState();
      this.sendToClient(ws, { type: "plugin_toggled", payload: { pluginId, enabled } });
    } catch (err) {
      this.sendToClient(ws, { type: "error", payload: { message: `操作失败: ${(err as Error).message}` } });
    }
  });

  register("update_plugin_config", function (ws, msg) {
    const { pluginId: upcPluginId, config } = msg.payload as { pluginId: string; config: Record<string, unknown> };
    if (!upcPluginId || typeof upcPluginId !== "string" || !/^[\w][\w\-]*$/.test(upcPluginId) || upcPluginId.length > 64) {
      this.sendToClient(ws, { type: "error", payload: { message: "无效的 pluginId" } });
      return;
    }
    if (!config) {
      this.sendToClient(ws, { type: "error", payload: { message: "缺少 pluginId 或 config" } });
      return;
    }
    if (typeof config !== "object" || Array.isArray(config)) {
      this.sendToClient(ws, { type: "error", payload: { message: "config 必须是对象" } });
      return;
    }
    const upcRegistryPath = path.join(this.dataRoot, "plugins", "registry.json");
    try {
      let upcRegistry = JSON.parse(fs.readFileSync(upcRegistryPath, "utf-8"));
      if (!upcRegistry.plugins[upcPluginId]) {
        this.sendToClient(ws, { type: "error", payload: { message: `插件 ${upcPluginId} 不存在` } });
        return;
      }
      upcRegistry.plugins[upcPluginId].config = config;
      const tmpPath = upcRegistryPath + ".tmp." + Date.now();
      fs.writeFileSync(tmpPath, JSON.stringify(upcRegistry, null, 2), "utf-8");
      fs.renameSync(tmpPath, upcRegistryPath);
      // Sync runtime state
      const rt = (globalThis as any).__cobeing?.runtime;
      if (rt && rt.pluginRegistry && rt.pluginRegistry.plugins[upcPluginId]) {
        rt.pluginRegistry.plugins[upcPluginId].config = config;
      }
      this.broadcastState();
      this.sendToClient(ws, { type: "plugin_config_updated", payload: { pluginId: upcPluginId, config } });
    } catch (err) {
      this.sendToClient(ws, { type: "error", payload: { message: `操作失败: ${(err as Error).message}` } });
    }
  });
}
