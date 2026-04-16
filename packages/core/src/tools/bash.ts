/**
 * Bash 工具 — 执行 shell 命令
 */
import { exec } from "node:child_process";
import type { Tool, ToolContext, ToolResult } from "@myagents/shared";

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

    if (context.sandbox.enabled) {
      return executeInSandbox(command, timeout, context);
    }
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

async function executeInSandbox(command: string, timeout: number, context: ToolContext): Promise<ToolResult> {
  const { spawn } = await import("node:child_process");
  const path = await import("node:path");

  const args = ["run", "--rm", `--memory=512m`, `--cpus=1`];

  if (!context.sandbox.network) {
    args.push("--network=none");
  }

  // Mount working dir
  const resolvedWorking = path.resolve(context.workingDir);
  args.push("-v", `${resolvedWorking}:/workspace`);

  // Extra bindings
  if (context.sandbox.bindings) {
    for (const binding of context.sandbox.bindings) {
      args.push("-v", binding);
    }
  }

  args.push("myagents-sandbox", "bash", "-c", command);

  return new Promise((resolve) => {
    const proc = spawn("docker", args, { cwd: context.workingDir });
    let stdout = "";
    let stderr = "";

    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      resolve({ toolCallId: "", content: "命令超时", isError: true });
    }, timeout);

    proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        resolve({ toolCallId: "", content: stderr || `Exit code: ${code}`, isError: true });
      } else {
        resolve({ toolCallId: "", content: stdout || "(no output)" });
      }
    });
    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve({ toolCallId: "", content: err.message, isError: true });
    });
  });
}
