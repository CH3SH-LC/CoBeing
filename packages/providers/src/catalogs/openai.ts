import type { ModelInfo } from "@myagents/shared";

export const OPENAI_MODELS: ModelInfo[] = [
  {
    id: "gpt-4o",
    name: "GPT-4o",
    provider: "openai",
    contextWindow: 128000,
    maxOutput: 16384,
    supportsTools: true,
    supportsVision: true,
    tags: ["flagship", "vision"],
  },
  {
    id: "gpt-4o-mini",
    name: "GPT-4o Mini",
    provider: "openai",
    contextWindow: 128000,
    maxOutput: 16384,
    supportsTools: true,
    supportsVision: true,
    tags: ["fast", "vision"],
  },
  {
    id: "o1",
    name: "O1",
    provider: "openai",
    contextWindow: 200000,
    maxOutput: 100000,
    supportsTools: true,
    supportsVision: true,
    tags: ["reasoning", "coding", "vision"],
  },
  {
    id: "o3-mini",
    name: "O3 Mini",
    provider: "openai",
    contextWindow: 200000,
    maxOutput: 100000,
    supportsTools: true,
    supportsVision: false,
    tags: ["reasoning", "coding"],
  },
];
