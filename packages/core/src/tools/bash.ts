/**
 * Bash 工具 — 执行 shell 命令
 */
import { exec } from "node:child_process";
import type { Tool, ToolContext, ToolResult } from "@cobeing/shared";

export const bashTool: Tool = {
  name: "bash",
  description: "执行 bash 命令",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "要执行的命令" },
      timeout: { type: "number", description: "超时秒数，默认 30" },
    },
    required: ["command"],
  },
  async execute(params, context: ToolContext): Promise<ToolResult> {
    const command = params.command as string;
    const timeout = ((params.timeout as number) ?? 30) * 1000;

    // 沙箱模式：委托给 sandboxRunner
    if (context.sandbox.enabled && context.sandboxRunner) {
      const result = await context.sandboxRunner.run(command, {
        timeout: (params.timeout as number) ?? 30,
      });
      if (result.exitCode !== 0) {
        return {
          toolCallId: "",
          content: result.stderr || `Exit code: ${result.exitCode}`,
          isError: true,
        };
      }
      return { toolCallId: "", content: result.stdout || "(no output)" };
    }

    // 本地模式
    return executeLocal(command, timeout, context.workingDir);
  },
};

function executeLocal(command: string, timeout: number, cwd: string): Promise<ToolResult> {
  return new Promise((resolve) => {
    exec(command, { cwd, timeout, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        resolve({
          toolCallId: "",
          content: stderr || error.message,
          isError: true,
        });
        return;
      }
      resolve({
        toolCallId: "",
        content: stdout || "(no output)",
      });
    });
  });
}
