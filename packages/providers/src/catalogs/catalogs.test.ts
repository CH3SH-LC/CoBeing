import { describe, it, expect } from "vitest";
import { PROVIDER_CATALOGS } from "./index.js";

describe("Provider Catalogs", () => {
  const expectedProviders = ["deepseek", "zhipu", "qwen", "minimax", "volcengine", "openai", "grok"];

  it("has all expected providers", () => {
    for (const p of expectedProviders) {
      expect(PROVIDER_CATALOGS[p]).toBeDefined();
      expect(PROVIDER_CATALOGS[p].length).toBeGreaterThan(0);
    }
  });

  it("each model has correct provider field", () => {
    for (const [_providerId, models] of Object.entries(PROVIDER_CATALOGS)) {
      for (const model of models) {
        expect(model.provider).toBe(_providerId);
        expect(model.id).toBeTruthy();
        expect(model.name).toBeTruthy();
        expect(model.contextWindow).toBeGreaterThan(0);
        expect(model.maxOutput).toBeGreaterThan(0);
      }
    }
  });

  it("coding models are tagged correctly", () => {
    const codingModels = Object.values(PROVIDER_CATALOGS)
      .flat()
      .filter(m => m.tags?.includes("coding"));

    expect(codingModels.length).toBeGreaterThanOrEqual(4);
    const codingIds = codingModels.map(m => m.id);
    expect(codingIds).toContain("deepseek-v4-pro");
    expect(codingIds).toContain("codegeex-4");
    expect(codingIds).toContain("qwen-coder-plus");
    expect(codingIds).toContain("o4-mini");
  });

  it("reasoning models are tagged", () => {
    const reasoning = Object.values(PROVIDER_CATALOGS)
      .flat()
      .filter(m => m.tags?.includes("reasoning"));
    expect(reasoning.length).toBeGreaterThanOrEqual(3);
  });

  it("fast models are tagged", () => {
    const fast = Object.values(PROVIDER_CATALOGS)
      .flat()
      .filter(m => m.tags?.includes("fast"));
    expect(fast.length).toBeGreaterThanOrEqual(4);
  });

  it("all models have unique IDs within their provider", () => {
    for (const [_providerId, models] of Object.entries(PROVIDER_CATALOGS)) {
      const ids = models.map(m => m.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});
