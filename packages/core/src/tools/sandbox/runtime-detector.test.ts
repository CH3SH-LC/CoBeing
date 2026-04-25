import { describe, it, expect } from "vitest";
import { detectRuntime, buildRunCommand } from "./runtime-detector.js";

describe("runtime-detector", () => {
  describe("detectRuntime", () => {
    it("detects Python files", () => {
      expect(detectRuntime("script.py")).toBe("python3");
      expect(detectRuntime("/path/to/main.py")).toBe("python3");
    });

    it("detects JavaScript files", () => {
      expect(detectRuntime("app.js")).toBe("node");
    });

    it("detects TypeScript files", () => {
      expect(detectRuntime("index.ts")).toBe("npx tsx");
    });

    it("detects Go files", () => {
      expect(detectRuntime("main.go")).toBe("go run");
    });

    it("detects shell scripts", () => {
      expect(detectRuntime("deploy.sh")).toBe("bash");
    });

    it("returns null for unknown extensions", () => {
      expect(detectRuntime("data.txt")).toBeNull();
      expect(detectRuntime("README.md")).toBeNull();
      expect(detectRuntime("Makefile")).toBeNull();
    });
  });

  describe("buildRunCommand", () => {
    it("builds python command", () => {
      expect(buildRunCommand("script.py")).toBe("python3 script.py");
    });

    it("builds node command", () => {
      expect(buildRunCommand("/abs/path/app.js")).toBe("node /abs/path/app.js");
    });

    it("builds tsx command", () => {
      expect(buildRunCommand("index.ts")).toBe("npx tsx index.ts");
    });

    it("returns null for unknown file", () => {
      expect(buildRunCommand("data.bin")).toBeNull();
    });
  });
});
