/**
 * DockerSandbox — Docker 容器沙箱执行
 */
import type { SandboxConfig } from "@myagents/shared";

export class DockerSandbox {
  constructor(private config: SandboxConfig, private workingDir: string) {}

  async run(command: string, timeout = 30000): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const { spawn } = await import("node:child_process");
    const path = await import("node:path");

    const args = ["run", "--rm", "--memory=512m", "--cpus=1"];

    if (!this.config.network) {
      args.push("--network=none");
    }

    const resolvedWorking = path.resolve(this.workingDir);
    args.push("-v", `${resolvedWorking}:/workspace`);

    if (this.config.bindings) {
      for (const binding of this.config.bindings) {
        args.push("-v", binding);
      }
    }

    args.push("myagents-sandbox", "bash", "-c", command);

    return new Promise((resolve) => {
      const proc = spawn("docker", args, { cwd: this.workingDir });
      let stdout = "";
      let stderr = "";

      const timer = setTimeout(() => {
        proc.kill("SIGKILL");
        resolve({ stdout: "", stderr: "命令超时", exitCode: -1 });
      }, timeout);

      proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
      proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
      proc.on("close", (code) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, exitCode: code ?? -1 });
      });
      proc.on("error", (err) => {
        clearTimeout(timer);
        resolve({ stdout: "", stderr: err.message, exitCode: -1 });
      });
    });
  }
}
