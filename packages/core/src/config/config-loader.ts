/**
 * 配置加载器 — 从 JSON/YAML 文件和环境变量加载配置
 */
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { createLogger } from "@cobeing/shared";
import type { AppConfig } from "./schema.js";

const log = createLogger("config");

const DEFAULT_CONFIG: AppConfig = {
  core: {
    logLevel: "info",
    dataDir: "./data",
    skillsDir: "./skills",
    promptsDir: "./prompts",
    maxToolRounds: Infinity,
    butlerMaxToolRounds: Infinity,
  },
  agents: ["butler", "host"],
  providers: {
    anthropic: { apiKeyEnv: "ANTHROPIC_API_KEY", type: "anthropic" },
    openai: { apiKeyEnv: "OPENAI_API_KEY", baseURL: "https://api.openai.com/v1" },
    deepseek: { apiKeyEnv: "DEEPSEEK_API_KEY", baseURL: "https://api.deepseek.com/v1" },
    zhipu: { apiKeyEnv: "ZHIPU_API_KEY", baseURL: "https://open.bigmodel.cn/api/paas/v4" },
    qwen: { apiKeyEnv: "QWEN_API_KEY", baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
    minimax: { apiKeyEnv: "MINIMAX_API_KEY", baseURL: "https://api.minimax.chat/v1" },
    volcengine: { apiKeyEnv: "VOLCENGINE_API_KEY", baseURL: "https://ark.cn-beijing.volces.com/api/v3" },
    gemini: { apiKeyEnv: "GEMINI_API_KEY", type: "gemini" },
    grok: { apiKeyEnv: "XAI_API_KEY", baseURL: "https://api.x.ai/v1" },
    moonshot: { apiKeyEnv: "MOONSHOT_API_KEY", baseURL: "https://api.moonshot.ai/v1" },
    siliconflow: { apiKeyEnv: "SILICONFLOW_API_KEY", baseURL: "https://api.siliconflow.cn/v1" },
  },
  channels: {},
  gui: { enabled: true, wsPort: 18765 },
};

export function loadConfig(configPath?: string): AppConfig {
  let config: AppConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));

  // 自动检测配置文件（优先 JSON，回退 YAML）
  let resolvedPath: string | undefined;
  if (configPath) {
    resolvedPath = configPath;
  } else {
    const jsonPath = path.resolve("config/default.json");
    const yamlPath = path.resolve("config/default.yaml");
    if (fs.existsSync(jsonPath)) {
      resolvedPath = jsonPath;
    } else if (fs.existsSync(yamlPath)) {
      resolvedPath = yamlPath;
    }
  }

  if (resolvedPath && fs.existsSync(resolvedPath)) {
    try {
      const raw = fs.readFileSync(resolvedPath, "utf-8");
      const ext = path.extname(resolvedPath);
      const parsed = ext === ".json"
        ? JSON.parse(raw) as Partial<AppConfig>
        : yaml.load(raw) as Partial<AppConfig>;
      config = deepMerge(config as unknown as Record<string, unknown>, parsed as Record<string, unknown>) as unknown as AppConfig;
      log.info("Config loaded from %s", resolvedPath);
    } catch (err) {
      log.warn("Failed to load config file %s: %s", resolvedPath, err);
    }
  } else {
    log.info("No config file found, using defaults");
  }

  // 从环境变量覆盖
  if (process.env.LOG_LEVEL) config.core.logLevel = process.env.LOG_LEVEL;
  if (process.env.DATA_DIR) config.core.dataDir = process.env.DATA_DIR;

  return config;
}

/** 简易深度合并（null 值表示删除 key） */
function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const sv = source[key];
    const tv = result[key];
    if (sv === null) {
      delete result[key];
    } else if (sv && typeof sv === "object" && !Array.isArray(sv) && tv && typeof tv === "object" && !Array.isArray(tv)) {
      result[key] = deepMerge(
        tv as Record<string, unknown>,
        sv as Record<string, unknown>,
      );
    } else if (sv !== undefined) {
      result[key] = sv;
    }
  }
  return result;
}
