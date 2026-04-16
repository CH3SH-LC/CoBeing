import type { ModelInfo } from "@myagents/shared";
import { DEEPSEEK_MODELS } from "./deepseek.js";
import { ZHIPU_MODELS } from "./zhipu.js";
import { QWEN_MODELS } from "./qwen.js";
import { MINIMAX_MODELS } from "./minimax.js";
import { VOLCENGINE_MODELS } from "./volcengine.js";
import { OPENAI_MODELS } from "./openai.js";
import { GROK_MODELS } from "./grok.js";

/** 按 provider ID 索引的模型目录 */
export const PROVIDER_CATALOGS: Record<string, ModelInfo[]> = {
  deepseek: DEEPSEEK_MODELS,
  zhipu: ZHIPU_MODELS,
  qwen: QWEN_MODELS,
  minimax: MINIMAX_MODELS,
  volcengine: VOLCENGINE_MODELS,
  openai: OPENAI_MODELS,
  grok: GROK_MODELS,
};
