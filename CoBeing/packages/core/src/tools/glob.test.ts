import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { globTool } from "./glob.js";

let workingDir: string;

beforeEach(() => {
  workingDir = fs.mkdtempSync(path.join(os.tmpdir(), "cobeing-test-glob-"));
  fs.writeFileSync(path.join(workingDir, "a.ts"), "export const a = 1;\n");
});

afterEach(() => {
  fs.rmSync(workingDir, { recursive: true, force: true });
});

function ctx() {
  return {
    agentId: "test-agent",
    sessionId: "s1",
    workingDir,
    sandbox: { enabled: false, filesystem: "isolated" as const, network: { enabled: false, mode: "all" as const } },
    permissions: { mode: "full-access" as const },
  };
}

describe("globTool", () => {
  it("finds files inside workingDir", async () => {
    const result = await globTool.execute({ pattern: "*.ts" }, ctx());
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain("a.ts");
  });

  it("returns a tool error when path escapes workingDir", async () => {
    const result = await globTool.execute({ pattern: "*", path: ".." }, ctx());
    expect(result.isError).toBe(true);
    expect(result.content).toContain("path escapes working directory");
  });
});
