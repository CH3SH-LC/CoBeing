import type { ModelInfo } from "@cobeing/shared";

export const DEEPSEEK_MODELS: ModelInfo[] = [
  {
    id: "deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    provider: "deepseek",
    contextWindow: 1048576, // 1M
    maxOutput: 393216,     // 384K
    supportsTools: true,
    supportsVision: false,
    tags: ["fast", "flagship"],
  },
  {
    id: "deepseek-v4-pro",
    name: "DeepSeek V4 Pro",
    provider: "deepseek",
    contextWindow: 1048576, // 1M
    maxOutput: 393216,     // 384K
    supportsTools: true,
    supportsVision: false,
    tags: ["reasoning", "coding"],
  },
];
