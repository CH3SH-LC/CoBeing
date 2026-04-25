import type { ModelInfo } from "@cobeing/shared";

export const SILICONFLOW_MODELS: ModelInfo[] = [
  {
    id: "deepseek-ai/DeepSeek-V3",
    name: "DeepSeek V3 (SF)",
    provider: "siliconflow",
    contextWindow: 131072,
    maxOutput: 8192,
    supportsTools: true,
    supportsVision: false,
    tags: ["flagship"],
  },
  {
    id: "deepseek-ai/DeepSeek-R1",
    name: "DeepSeek R1 (SF)",
    provider: "siliconflow",
    contextWindow: 131072,
    maxOutput: 8192,
    supportsTools: true,
    supportsVision: false,
    tags: ["reasoning"],
  },
  {
    id: "Qwen/Qwen3-235B-A22B",
    name: "Qwen3 235B (SF)",
    provider: "siliconflow",
    contextWindow: 131072,
    maxOutput: 16384,
    supportsTools: true,
    supportsVision: false,
    tags: ["flagship", "reasoning"],
  },
  {
    id: "THUDM/GLM-4-32B-0414",
    name: "GLM-4 32B (SF)",
    provider: "siliconflow",
    contextWindow: 131072,
    maxOutput: 8192,
    supportsTools: true,
    supportsVision: false,
    tags: ["coding"],
  },
];
