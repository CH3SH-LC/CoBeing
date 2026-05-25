import type { ModelInfo } from "@cobeing/shared";

export const MINIMAX_MODELS: ModelInfo[] = [
  {
    id: "MiniMax-Text-01",
    name: "MiniMax Text 01",
    provider: "minimax",
    contextWindow: 1000000,
    maxOutput: 16384,
    supportsTools: true,
    supportsVision: false,
    tags: ["flagship"],
  },
  {
    id: "MiniMax-M1",
    name: "MiniMax M1",
    provider: "minimax",
    contextWindow: 1000000,
    maxOutput: 16384,
    supportsTools: true,
    supportsVision: false,
    tags: ["flagship", "coding"],
  },
  {
    id: "abab6.5s-chat",
    name: "ABAB 6.5s Chat",
    provider: "minimax",
    contextWindow: 128000,
    maxOutput: 4096,
    supportsTools: true,
    supportsVision: false,
    tags: ["fast"],
  },
];
