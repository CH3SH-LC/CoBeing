import type { ModelInfo } from "@cobeing/shared";

export const GROK_MODELS: ModelInfo[] = [
  {
    id: "grok-3",
    name: "Grok 3",
    provider: "grok",
    contextWindow: 131072,
    maxOutput: 16384,
    supportsTools: true,
    supportsVision: false,
    tags: ["flagship"],
  },
  {
    id: "grok-3-fast",
    name: "Grok 3 Fast",
    provider: "grok",
    contextWindow: 131072,
    maxOutput: 16384,
    supportsTools: true,
    supportsVision: false,
    tags: ["fast"],
  },
  {
    id: "grok-3-mini",
    name: "Grok 3 Mini",
    provider: "grok",
    contextWindow: 131072,
    maxOutput: 16384,
    supportsTools: true,
    supportsVision: false,
    tags: ["fast", "reasoning"],
  },
];
