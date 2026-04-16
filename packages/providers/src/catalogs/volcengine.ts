import type { ModelInfo } from "@myagents/shared";

export const VOLCENGINE_MODELS: ModelInfo[] = [
  {
    id: "doubao-pro-32k",
    name: "Doubao Pro 32K",
    provider: "volcengine",
    contextWindow: 32000,
    maxOutput: 4096,
    supportsTools: true,
    supportsVision: false,
    tags: ["fast"],
  },
  {
    id: "doubao-pro-128k",
    name: "Doubao Pro 128K",
    provider: "volcengine",
    contextWindow: 128000,
    maxOutput: 4096,
    supportsTools: true,
    supportsVision: false,
    tags: ["flagship"],
  },
  {
    id: "doubao-lite-32k",
    name: "Doubao Lite 32K",
    provider: "volcengine",
    contextWindow: 32000,
    maxOutput: 4096,
    supportsTools: true,
    supportsVision: false,
    tags: ["fast"],
  },
];
