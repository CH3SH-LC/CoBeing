import type { ModelInfo } from "@cobeing/shared";

export const MIMO_MODELS: ModelInfo[] = [
  {
    id: "mimo-v2.5-pro",
    name: "MiMo V2.5 Pro",
    provider: "mimo",
    contextWindow: 262144,
    maxOutput: 16384,
    supportsTools: true,
    supportsVision: true,
    tags: ["flagship", "agent"],
  },
  {
    id: "mimo-v2-pro",
    name: "MiMo V2 Pro",
    provider: "mimo",
    contextWindow: 1000000,
    maxOutput: 16384,
    supportsTools: true,
    supportsVision: true,
    tags: ["flagship", "long-context"],
  },
  {
    id: "mimo-v2-flash",
    name: "MiMo V2 Flash",
    provider: "mimo",
    contextWindow: 262144,
    maxOutput: 16384,
    supportsTools: true,
    supportsVision: false,
    tags: ["fast"],
  },
  {
    id: "mimo-v2-omni",
    name: "MiMo V2 Omni",
    provider: "mimo",
    contextWindow: 262144,
    maxOutput: 16384,
    supportsTools: true,
    supportsVision: true,
    tags: ["vision", "reasoning"],
  },
];
