import type { ModelInfo } from "@cobeing/shared";

export const MOONSHOT_MODELS: ModelInfo[] = [
  {
    id: "moonshot-v1-8k",
    name: "Moonshot V1 8K",
    provider: "moonshot",
    contextWindow: 8192,
    maxOutput: 4096,
    supportsTools: true,
    supportsVision: false,
    tags: ["fast"],
  },
  {
    id: "moonshot-v1-32k",
    name: "Moonshot V1 32K",
    provider: "moonshot",
    contextWindow: 32768,
    maxOutput: 4096,
    supportsTools: true,
    supportsVision: false,
  },
  {
    id: "moonshot-v1-128k",
    name: "Moonshot V1 128K",
    provider: "moonshot",
    contextWindow: 131072,
    maxOutput: 4096,
    supportsTools: true,
    supportsVision: false,
    tags: ["long-context"],
  },
  {
    id: "kimi-k2",
    name: "Kimi K2",
    provider: "moonshot",
    contextWindow: 262144,
    maxOutput: 16384,
    supportsTools: true,
    supportsVision: true,
    tags: ["flagship", "coding", "vision"],
  },
];
