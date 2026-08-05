/**
 * system 域 WS 命令 handler — 从 ws-server.ts 的 switch 迁移
 * _ping / get_state / get_log / get_config / update_config / subscribe_log
 */
import fs from "node:fs";
import path from "node:path";
import { createLogger } from "@cobeing/shared";
import { decrypt, encrypt } from "../../config/secret-store.js";
import { cloneForClient, resolveProviderApiKeys, isSafeConfigPath, setNestedValue } from "../security.js";
import type { HandlerRegistrar } from "./types.js";

const log = createLogger("ws-server");

export function registerSystemHandlers(register: HandlerRegistrar): void {
  register("_ping", function (_ws, _msg) {
    // 前端应用层心跳（辅助 WebView2 窗口失焦时连接保持）
    this.sendToClient(_ws, { type: "_pong" });
  });

  register("get_state", function (ws, _msg) {
    this.sendToClient(ws, { type: "state", payload: this.getState() });
  });

  register("get_log", function (ws, _msg) {
    this.sendToClient(ws, { type: "log", payload: this.messageLog });
  });

  register("get_config", async function (ws, _msg) {
    const configFilePath = this.configPath || path.resolve("config/default.json");
    try {
      const raw = fs.readFileSync(configFilePath, "utf-8");
      const config = JSON.parse(raw);
      // 解密所有 provider 的 apiKey（用于解析环境变量，但不返回明文）
      if (config.providers) {
        for (const prov of Object.values(config.providers) as Array<Record<string, unknown>>) {
          if (typeof prov.apiKey === "string") {
            const decrypted = decrypt(prov.apiKey);
            prov.apiKey = decrypted;
          }
        }
        resolveProviderApiKeys(config.providers as Record<string, Record<string, unknown>>);
        // 移除明文 apiKey，只保留掩码值 _apiKeyResolved
        for (const prov of Object.values(config.providers) as Array<Record<string, unknown>>) {
          delete prov.apiKey;
        }
      }
      // Merge plugin-loaded providers into config response (async import)
      try {
        const { getAllProviders } = await import("@cobeing/providers");
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
      } catch (err: any) {
        log.warn("Failed to merge plugin providers into config: %s", err.message);
      }
      // Merge plugin-loaded channels (async import)
      try {
        const { getAllChannels } = await import("@cobeing/channels");
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
      } catch (err: any) {
        log.warn("Failed to merge plugin channels into config: %s", err.message);
      }
      this.sendToClient(ws, { type: "config", payload: cloneForClient(config) });
    } catch (err) {
      this.sendToClient(ws, { type: "error", payload: { message: `Failed to read config: ${err}` } });
    }
  });

  register("update_config", async function (ws, msg) {
    const { path: cfgPath, value } = msg.payload as { path: string; value: unknown };
    const configFilePath = this.configPath || path.resolve("config/default.json");
    try {
      if (!isSafeConfigPath(cfgPath)) {
        this.sendToClient(ws, { type: "error", payload: { message: "Invalid config path" } });
        return;
      }
      const raw = fs.readFileSync(configFilePath, "utf-8");
      const config = JSON.parse(raw);

      // 如果更新的是 provider 的 apiKey，加密后存储
      let storedValue = value;
      if (cfgPath.match(/^providers\.[^.]+\.apiKey$/) && typeof value === "string" && value) {
        // 防止前端将掩码值（含 ****）回传导致加密损坏
        if (value.includes("****")) {
          // 跳过更新 apiKey，保留现有加密值
          this.sendToClient(ws, { type: "config_updated", payload: { path: cfgPath, success: true } });
          return;
        }
        storedValue = encrypt(value);
      }
      // 如果更新的是整个 provider 对象且含 apiKey，加密其中的 apiKey
      if (cfgPath.match(/^providers\.[^.]+$/) && typeof value === "object" && value !== null) {
        const obj = value as Record<string, unknown>;
        if (typeof obj.apiKey === "string" && obj.apiKey) {
          if (obj.apiKey.includes("****")) {
            // 掩码值，使用现有加密 key
            const existing = config.providers?.[cfgPath.split(".").pop()!] as Record<string, unknown> | undefined;
            storedValue = { ...obj, apiKey: existing?.apiKey ?? obj.apiKey };
          } else {
            storedValue = { ...obj, apiKey: encrypt(obj.apiKey) };
          }
        } else if (!("apiKey" in obj) || obj.apiKey === undefined || obj.apiKey === "") {
          // 未传 apiKey：保留现有加密值，防止误删
          const existing = config.providers?.[cfgPath.split(".").pop()!] as Record<string, unknown> | undefined;
          if (existing?.apiKey) {
            storedValue = { ...obj, apiKey: existing.apiKey };
          }
        }
      }

      setNestedValue(config, cfgPath, storedValue);
      fs.writeFileSync(configFilePath, JSON.stringify(config, null, 2) + "\n", "utf-8");
      this.sendToClient(ws, { type: "config_updated", payload: { path: cfgPath, success: true } });

      // 广播配置时解密 apiKey + 解析环境变量（但不返回明文）
      const broadcastConfig = JSON.parse(JSON.stringify(config));
      if (broadcastConfig.providers) {
        for (const prov of Object.values(broadcastConfig.providers) as Array<Record<string, unknown>>) {
          if (typeof prov.apiKey === "string") {
            prov.apiKey = decrypt(prov.apiKey);
          }
        }
        resolveProviderApiKeys(broadcastConfig.providers as Record<string, Record<string, unknown>>);
        for (const prov of Object.values(broadcastConfig.providers) as Array<Record<string, unknown>>) {
          delete prov.apiKey;
        }
      }
      this.broadcast({ type: "config", payload: cloneForClient(broadcastConfig) });

      // Provider 变更时触发热重载
      const providerMatch = cfgPath.match(/^providers\.([^.]+)/);
      if (providerMatch && this.onProviderChange) {
        // Don't allow overwriting plugin-managed providers via config update
        const targetProvider = (config.providers as any)?.[providerMatch[1]];
        if ((targetProvider as any)?._pluginManaged) {
          this.sendToClient(ws, { type: "error", payload: { message: `Provider '${providerMatch[1]}' is managed by a plugin and cannot be modified via config` } });
          return;
        }
        this.onProviderChange(providerMatch[1]);
      }

      // MCP 服务器配置变更时触发热重载
      if (cfgPath.startsWith("mcpServers.") && this.onMcpConfigChange) {
        const serverId = cfgPath.split(".")[1];
        const serverConfig = (config.mcpServers as any)?.[serverId] ?? null;
        this.onMcpConfigChange(serverId, serverConfig).catch(err => {
          log.warn("MCP config change handler error: %s", String(err));
        });
      }
    } catch (err) {
      this.sendToClient(ws, { type: "error", payload: { message: `Failed to update config: ${err}` } });
    }
  });

  register("subscribe_log", function (ws, _msg) {
    this.sendToClient(ws, { type: "log", payload: this.messageLog });
    (ws as any).__subscribedLog = true;
  });
}
