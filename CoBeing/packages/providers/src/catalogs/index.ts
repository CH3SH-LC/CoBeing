import type { ModelInfo } from "@cobeing/shared";
import { DEEPSEEK_MODELS } from "./deepseek.js";

export const PROVIDER_CATALOGS: Record<string, ModelInfo[]> = {
  deepseek: DEEPSEEK_MODELS,
};

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
];

export function getPreset(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find(p => p.id === id);
}

export function getBaseURLForPlan(preset: ProviderPreset, plan: PlanType): string {
  return preset.baseURLs[plan] || preset.baseURLs.general;
}
