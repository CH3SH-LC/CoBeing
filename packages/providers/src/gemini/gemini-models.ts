import type { ModelInfo } from "@cobeing/shared";

export const GEMINI_MODELS: ModelInfo[] = [
  {
    id: "gemini-2.0-flash",
    name: "Gemini 2.0 Flash",
    provider: "gemini",
    contextWindow: 1048576,
    maxOutput: 8192,
    supportsTools: true,
    supportsVision: true,
    tags: ["fast", "vision"],
  },
  {
    id: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    provider: "gemini",
    contextWindow: 1048576,
    maxOutput: 65536,
    supportsTools: true,
    supportsVision: true,
    tags: ["flagship", "reasoning", "vision"],
  },
];
