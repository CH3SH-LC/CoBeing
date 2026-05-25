import { describe, it, expect } from "vitest";
import { StubHrrEncoder } from "./hrr.js";

describe("StubHrrEncoder", () => {
  const encoder = new StubHrrEncoder();

  it("has 1024 dimensions", () => {
    expect(encoder.dim).toBe(1024);
  });

  it("encodeAtom throws 'not implemented'", () => {
    expect(() => encoder.encodeAtom("test")).toThrow("not implemented");
  });

  it("bind throws 'not implemented'", () => {
    const v = new Float64Array(1024);
    expect(() => encoder.bind(v, v)).toThrow("not implemented");
  });

  it("unbind throws 'not implemented'", () => {
    const v = new Float64Array(1024);
    expect(() => encoder.unbind(v, v)).toThrow("not implemented");
  });

  it("bundle throws 'not implemented'", () => {
    const v = new Float64Array(1024);
    expect(() => encoder.bundle(v, v)).toThrow("not implemented");
  });

  it("similarity throws 'not implemented'", () => {
    const v = new Float64Array(1024);
    expect(() => encoder.similarity(v, v)).toThrow("not implemented");
  });
});
