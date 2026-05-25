import { describe, it, expect } from "vitest";
import { bashTool } from "./bash.js";
import os from "node:os";

const isWindows = os.platform() === "win32";

function ctx() {
  return {
    agentId: "test-agent",
    sessionId: "s1",
    workingDir: os.tmpdir(),
    sandbox: { enabled: false, filesystem: "isolated" as const, network: { enabled: false, mode: "all" as const } },
    permissions: { mode: "full-access" as const },
  };
}

describe("bashTool", () => {
  it("executes a simple command", async () => {
    const cmd = isWindows ? "echo hello" : "echo hello";
    const result = await bashTool.execute({ command: cmd, timeout: 10 }, ctx());
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain("hello");
  });

  it("returns error for failed command", async () => {
    const cmd = isWindows
      ? "Get-ChildItem __nonexistent_path_xyz__"
      : "ls __nonexistent_path_xyz__";
    const result = await bashTool.execute({ command: cmd, timeout: 10 }, ctx());
    expect(result).toHaveProperty("content");
  });

  it("truncates output exceeding 16384 bytes", async () => {
    const count = 2000;
    const cmd = isWindows
      ? `1..${count} | ForEach-Object { "line $_" }`
      : `for i in $(seq 1 ${count}); do echo "line $i"; done`;
    const result = await bashTool.execute({ command: cmd, timeout: 30 }, ctx());
    expect(result.content.length).toBeLessThanOrEqual(17000);
    expect(result.content).toContain("truncated");
  });

  it("does not truncate short output", async () => {
    const cmd = isWindows ? "echo short" : "echo short";
    const result = await bashTool.execute({ command: cmd, timeout: 10 }, ctx());
    expect(result.content).not.toContain("truncated");
  });
});
