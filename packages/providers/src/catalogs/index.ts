import type { ModelInfo } from "@cobeing/shared";
import { DEEPSEEK_MODELS } from "./deepseek.js";
import { ZHIPU_MODELS } from "./zhipu.js";
import { QWEN_MODELS } from "./qwen.js";
import { MINIMAX_MODELS } from "./minimax.js";
import { VOLCENGINE_MODELS } from "./volcengine.js";
import { MOONSHOT_MODELS } from "./moonshot.js";
import { MIMO_MODELS } from "./mimo.js";

/** 按 provider ID 索引的模型目录 */
export const PROVIDER_CATALOGS: Record<string, ModelInfo[]> = {
  deepseek: DEEPSEEK_MODELS,
  zhipu: ZHIPU_MODELS,
  qwen: QWEN_MODELS,
  minimax: MINIMAX_MODELS,
  volcengine: VOLCENGINE_MODELS,
  moonshot: MOONSHOT_MODELS,
  mimo: MIMO_MODELS,
};

// ---- Provider 预设 ----

export type PlanType = "general" | "coding";

export interface ProviderPreset {
  id: string;
  name: string;
  nameZh: string;
  type: "openai-compat" | "anthropic" | "gemini";
  baseURLs: Record<PlanType, string>;
  defaultPlan: PlanType;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "deepseek",
    name: "DeepSeek",
    nameZh: "DeepSeek",
    type: "openai-compat",
    baseURLs: { general: "https://api.deepseek.com", coding: "https://api.deepseek.com" },
    defaultPlan: "general",
  },
  {
    id: "zhipu",
    name: "Zhipu / GLM",
    nameZh: "智谱 / GLM",
    type: "openai-compat",
    baseURLs: { general: "https://open.bigmodel.cn/api/paas/v4", coding: "https://open.bigmodel.cn/api/coding/paas/v4" },
    defaultPlan: "general",
  },
  {
    id: "qwen",
    name: "Qwen",
    nameZh: "通义千问",
    type: "openai-compat",
    baseURLs: { general: "https://dashscope.aliyuncs.com/compatible-mode/v1", coding: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
    defaultPlan: "general",
  },
  {
    id: "minimax",
    name: "MiniMax",
    nameZh: "MiniMax",
    type: "openai-compat",
    baseURLs: { general: "https://api.minimaxi.com/v1", coding: "https://api.minimaxi.com/v1" },
    defaultPlan: "general",
  },
  {
    id: "volcengine",
    name: "Volcengine",
    nameZh: "火山引擎 / 豆包",
    type: "openai-compat",
    baseURLs: { general: "https://ark.cn-beijing.volces.com/api/v3", coding: "https://ark.cn-beijing.volces.com/api/v3" },
    defaultPlan: "general",
  },
  {
    id: "moonshot",
    name: "Moonshot / Kimi",
    nameZh: "月之暗面 / Kimi",
    type: "openai-compat",
    baseURLs: { general: "https://api.moonshot.cn/v1", coding: "https://api.moonshot.cn/v1" },
    defaultPlan: "general",
  },
  {
    id: "mimo",
    name: "MiMo",
    nameZh: "小米 MiMo",
    type: "openai-compat",
    baseURLs: { general: "https://api.xiaomimimo.com/v1", coding: "https://api.xiaomimimo.com/v1" },
    defaultPlan: "general",
  },
];

/** 获取预设（按 ID） */
export function getPreset(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find(p => p.id === id);
}

/** 根据 plan 类型获取 baseURL */
export function getBaseURLForPlan(preset: ProviderPreset, plan: PlanType): string {
  return preset.baseURLs[plan] || preset.baseURLs.general;
}
