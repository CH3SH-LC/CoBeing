/**
 * Bash 工具 — 执行 shell 命令（跨平台）
 */
import { exec, execFile } from "node:child_process";
import os from "node:os";
import type { Tool, ToolContext, ToolResult } from "@cobeing/shared";
import { MAX_BASH_OUTPUT } from "@cobeing/shared";

const isWindows = os.platform() === "win32";
const MAX_OUTPUT = MAX_BASH_OUTPUT;

export const bashTool: Tool = {
  name: "bash",
  description: "执行 shell 命令（Windows 自动使用 PowerShell）",
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

/** 轻量 Unix → Windows 命令映射 */
function translateCommand(cmd: string): string {
  if (!isWindows) return cmd;

  // 常见 Unix 命令 → PowerShell 等价
  const replacements: [RegExp, string][] = [
    [/\bls\s+-la\b/g, "Get-ChildItem -Force"],
    [/\bls\s+-l\b/g, "Get-ChildItem"],
    [/\bls\b/g, "Get-ChildItem"],
    [/\bpwd\b/g, "Get-Location"],
    [/\bcat\s+/g, "Get-Content "],
    [/\bmkdir\s+-p\s+/g, "New-Item -ItemType Directory -Force -Path "],
    [/\brm\s+-rf\s+/g, "Remove-Item -Recurse -Force "],
    [/\brm\s+/g, "Remove-Item "],
    [/\bcp\s+-r\s+/g, "Copy-Item -Recurse "],
    [/\bcp\s+/g, "Copy-Item "],
    [/\bmv\s+/g, "Move-Item "],
    [/\becho\s+/g, "Write-Output "],
    [/\bhead\s+-n\s+(\d+)\s+/g, "Get-Content -TotalCount $1 "],
    [/\btail\s+-n\s+(\d+)\s+/g, "Get-Content -Tail $1 "],
    [/\bgrep\s+/g, "Select-String "],
    [/\bfind\s+\.\s+-name\s+/g, "Get-ChildItem -Recurse -Filter "],
    [/\b&&\b/g, ";"],
    [/\b\|\b/g, "|"],
  ];

  let translated = cmd;
  for (const [pattern, replacement] of replacements) {
    translated = translated.replace(pattern, replacement);
  }
  return translated;
}

function executeLocal(command: string, timeout: number, cwd: string): Promise<ToolResult> {
  const finalCmd = translateCommand(command);

  return new Promise((resolve) => {
    const callback = (error: Error | null, stdout: string, stderr: string) => {
      if (error) {
        const errContent = stderr || error.message;
        if (errContent.length > MAX_OUTPUT) {
          resolve({
            toolCallId: "",
            content: errContent.slice(0, MAX_OUTPUT) + `\n[output truncated — exceeded ${MAX_OUTPUT} bytes]`,
            isError: true,
          });
        } else {
          resolve({ toolCallId: "", content: errContent, isError: true });
        }
        return;
      }
      const output = stdout || "(no output)";
      if (output.length > MAX_OUTPUT) {
        resolve({
          toolCallId: "",
          content: output.slice(0, MAX_OUTPUT) + `\n[output truncated — exceeded ${MAX_OUTPUT} bytes]`,
        });
      } else {
        resolve({ toolCallId: "", content: output });
      }
    };

    if (isWindows) {
      execFile(
        "powershell.exe",
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", finalCmd],
        { cwd, timeout, maxBuffer: 1024 * 1024, windowsHide: true },
        callback,
      );
      return;
    }

    exec(finalCmd, { cwd, timeout, maxBuffer: 1024 * 1024 }, callback);
  });
}
