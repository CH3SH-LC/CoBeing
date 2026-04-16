import type { ModelInfo } from "@myagents/shared";

export const DEEPSEEK_MODELS: ModelInfo[] = [
  {
    id: "deepseek-chat",
    name: "DeepSeek Chat",
    provider: "deepseek",
    contextWindow: 128000,
    maxOutput: 8192,
    supportsTools: true,
    supportsVision: false,
    tags: ["fast"],
  },
  {
    id: "deepseek-reasoner",
    name: "DeepSeek Reasoner",
    provider: "deepseek",
    contextWindow: 128000,
    maxOutput: 8192,
    supportsTools: true,
    supportsVision: false,
    tags: ["reasoning", "coding"],
  },
];
