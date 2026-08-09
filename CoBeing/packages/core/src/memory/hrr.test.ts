import { describe, it, expect } from "vitest";
import { HrrEncoder } from "./hrr.js";

describe("HrrEncoder (HRR Phase 2 — SHA-256 确定性相位向量)", () => {
  const encoder = new HrrEncoder();

  it("has 1024 dimensions", () => {
    expect(encoder.dim).toBe(1024);
  });

  it("encodeAtom produces deterministic phase vectors in [0, 2π)", () => {
    const a = encoder.encodeAtom("cat");
    const b = encoder.encodeAtom("cat");
    const c = encoder.encodeAtom("dog");
    expect(a).toHaveLength(1024);
    expect(a).toEqual(b); // 确定性
    expect(a).not.toEqual(c);
    for (let i = 0; i < 1024; i++) {
      expect(a[i]).toBeGreaterThanOrEqual(0);
      expect(a[i]).toBeLessThan(2 * Math.PI);
    }
  });

  it("bind is commutative and unbind recovers the partner", () => {
    const cat = encoder.encodeAtom("cat");
    const hat = encoder.encodeAtom("hat");
    const mem = encoder.bind(cat, hat);
    // 解绑恢复 "cat"：unbind(bind(cat, hat), hat) ≈ cat（模 2π 精确）
    const recovered = encoder.unbind(mem, hat);
    for (let i = 0; i < 1024; i++) {
      const diff = Math.abs(recovered[i] - cat[i]);
      expect(Math.min(diff, 2 * Math.PI - diff)).toBeLessThan(1e-9);
    }
  });

  it("bundle averages circularly and stays in range", () => {
    const a = encoder.encodeAtom("apple");
    const b = encoder.encodeAtom("banana");
    const mem = encoder.bundle(a, b);
    for (let i = 0; i < 1024; i++) {
      expect(mem[i]).toBeGreaterThanOrEqual(0);
      expect(mem[i]).toBeLessThan(2 * Math.PI);
    }
  });

  it("similarity is 1 for identical vectors and lower for different ones", () => {
    const a = encoder.encodeAtom("sun");
    const b = encoder.encodeAtom("sun");
    const c = encoder.encodeAtom("moon");
    expect(encoder.similarity(a, b)).toBeCloseTo(1, 10);
    expect(encoder.similarity(a, c)).toBeLessThan(0.99);
  });

  it("unbind after bind recovers high similarity (HRR retrieval works)", () => {
    const cat = encoder.encodeAtom("cat");
    const hat = encoder.encodeAtom("hat");
    const mem = encoder.bind(cat, hat);
    const recovered = encoder.unbind(mem, hat);
    const unrelated = encoder.encodeAtom("dog");
    expect(encoder.similarity(recovered, cat)).toBeGreaterThan(0.99);
    expect(encoder.similarity(recovered, unrelated)).toBeLessThan(0.6);
  });
});
