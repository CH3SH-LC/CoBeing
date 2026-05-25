import type { ModelInfo } from "@cobeing/shared";

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
    contextWindow: 131072,
    maxOutput: 4096,
    supportsTools: true,
    supportsVision: false,
    tags: ["flagship"],
  },
  {
    id: "doubao-1.5-pro-256k",
    name: "Doubao 1.5 Pro 256K",
    provider: "volcengine",
    contextWindow: 262144,
    maxOutput: 8192,
    supportsTools: true,
    supportsVision: false,
    tags: ["long-context"],
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
