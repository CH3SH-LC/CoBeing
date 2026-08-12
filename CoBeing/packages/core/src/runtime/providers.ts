/**
 * Provider 构建辅助模块（从 runtime.ts 提取，行为不变）
 *
 * 职责：按 config 构建原生 Provider（仅 deepseek 内置，其余由插件注册）、
 * 热重载单个 Provider（从磁盘重读 config + 插件 models.json + 全局注册表回落）。
 */
import path from "node:path";
import fs from "node:fs";
import type { AppConfig } from "../config/schema.js";
import { OpenAICompatProvider, PROVIDER_CATALOGS, registerProvider, getProvider } from "@cobeing/providers";
import type { LLMProvider } from "@cobeing/providers";
import type { ModelInfo } from "@cobeing/shared";
import { decrypt } from "../config/secret-store.js";
import { createLogger } from "@cobeing/shared";

const log = createLogger("runtime");

/** Provider 构建域所需依赖（由 CoBeingRuntime 提供） */
export interface ProviderBuildDeps {
  dataRoot: string;
  rootDir: string;
  config: AppConfig;
  providers: Map<string, LLMProvider>;
}

/** 从插件目录或内置 catalog 解析某 provider 的模型列表 */
export function resolveProviderModels(dataRoot: string, providerId: string): ModelInfo[] {
  const modelsPath = path.resolve(dataRoot, "plugins", "providers", providerId, "models.json");
  let models: ModelInfo[] = [];
  if (fs.existsSync(modelsPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(modelsPath, "utf-8"));
      models = (parsed.models || []) as ModelInfo[];
    } catch { /* fallback to hardcoded */ }
  }
  if (models.length === 0) {
    models = (PROVIDER_CATALOGS as any)[providerId] || [];
  }
  return models;
}

/** 解析 provider 的 API key（config 解密 → env 回落） */
export function resolveApiKey(cfg: { apiKey?: string; apiKeyEnv?: string }): string {
  return (cfg.apiKey ? decrypt(cfg.apiKey) : "") || process.env[cfg.apiKeyEnv ?? ""] || "";
}

/** 按 config 构建原生 Provider（仅 deepseek 默认，其余由插件注册） */
export function buildProviders(deps: ProviderBuildDeps): void {
  const { config, dataRoot, providers } = deps;
  // 仅 deepseek 作为原生内置 provider
  const deepseekCfg = config.providers?.deepseek;
  const deepseekModels = resolveProviderModels(dataRoot, "deepseek");

  if (deepseekCfg) {
    const apiKey = resolveApiKey(deepseekCfg);

    try {
      const provider = new OpenAICompatProvider({
        id: "deepseek",
        name: "DeepSeek",
        apiKey,
        baseURL: deepseekCfg.baseURL ?? "https://api.deepseek.com",
        models: deepseekModels,
      });
      registerProvider(provider);
      providers.set("deepseek", provider);
      log.info("Provider ready: deepseek");
    } catch (err: any) {
      log.warn("Failed to create provider deepseek: %s", err.message);
    }
  }

  // 警告非 deepseek provider（已迁移为插件）
  const nonDeepseekKeys = Object.keys(config.providers).filter(k => k !== "deepseek");
  if (nonDeepseekKeys.length > 0) {
    log.warn(
      "Providers %s are configured but no longer built natively. Install them as plugins from CoBeing-Market.",
      nonDeepseekKeys.join(", "),
    );
  }
}

/** 热重载单个 Provider（支持原生 deepseek 及插件注册的 provider） */
export function rebuildProvider(deps: ProviderBuildDeps, providerId: string): void {
  const { config, dataRoot, rootDir, providers } = deps;
  // Read fresh config from disk
  let cfg = config.providers?.[providerId];
  try {
    const configPath = path.resolve(rootDir, "config/default.json");
    if (fs.existsSync(configPath)) {
      const fresh = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      if (fresh.providers?.[providerId]) {
        cfg = fresh.providers[providerId];
        if (!config.providers) config.providers = {};
        config.providers[providerId] = cfg;
      }
    }
  } catch { /* fallback to in-memory config */ }

  // For providers with config entries (native like deepseek), reconstruct from config
  if (cfg) {
    const apiKey = resolveApiKey(cfg);

    try {
      // Try loading models from plugin directory if it exists
      const models = resolveProviderModels(dataRoot, providerId);

      const provider = new OpenAICompatProvider({
        id: providerId,
        name: (cfg as any).name || providerId,
        apiKey,
        baseURL: cfg.baseURL ?? "https://api.deepseek.com",
        models,
      });
      registerProvider(provider);
      providers.set(providerId, provider);
      log.info("Provider rebuilt: %s", providerId);
      return;
    } catch (err: any) {
      log.error("Failed to rebuild provider %s: %s", providerId, err.message);
      return;
    }
  }

  // For plugin-managed providers without config entries, try refresh via global registry
  const globalProvider = getProvider(providerId);
  if (globalProvider) {
    providers.set(providerId, globalProvider);
    log.info("Provider refreshed from global registry: %s", providerId);
  } else {
    log.warn("Cannot rebuild provider '%s': no config entry and not in global registry", providerId);
  }
}
