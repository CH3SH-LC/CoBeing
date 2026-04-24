import { spawn, exec } from "node:child_process";
import path from "node:path";
import { createLogger } from "@cobeing/shared";
import type { NetworkConfig, SandboxRunOptions, SandboxRunResult, SecurityConfig } from "@cobeing/shared";
import { buildNetworkArgs } from "./network-whitelist.js";
import { buildSecurityArgs } from "./security.js";

const log = createLogger("container-pool");

export interface ContainerConfig {
  memory: string;
  cpus: number;
  network: NetworkConfig;
  bindings: string[];
  timeout: number;
  disk?: string;
  security?: SecurityConfig;
}

export interface PoolContainer {
  id: string;
  status: "running" | "stopped" | "creating";
  createdAt: number;
}

export class ContainerPool {
  private container: PoolContainer | null = null;

  constructor(
    private agentId: string,
    private image: string,
    private config: ContainerConfig,
    private agentDir: string,
  ) {}

  getStatus(): { containerId: string | null; running: boolean } {
    return {
      containerId: this.container?.id ?? null,
      running: this.container?.status === "running",
    };
  }

  /** 获取或创建容器 */
  async acquire(): Promise<PoolContainer> {
    if (this.container && this.container.status === "running") {
      const healthy = await this.healthCheck();
      if (healthy) return this.container;
      log.warn("Container %s unhealthy, recreating", this.container.id);
      await this.destroy();
    }

    await this.ensureImage();

    const args = this.buildCreateArgs(this.agentDir);
    const containerId = await this.dockerCreate(args);

    this.container = {
      id: containerId,
      status: "running",
      createdAt: Date.now(),
    };

    log.info("Container created: %s for agent %s", containerId, this.agentId);
    return this.container;
  }

  /** 在容器内执行命令 */
  async exec(command: string, opts: SandboxRunOptions = {}): Promise<SandboxRunResult> {
    const container = await this.acquire();
    const timeout = (opts.timeout ?? this.config.timeout) * 1000;

    return new Promise((resolve) => {
      const args = ["exec", container.id, "bash", "-c", command];
      const proc = spawn("docker", args);
      let stdout = "";
      let stderr = "";

      const timer = setTimeout(() => {
        proc.kill("SIGKILL");
        resolve({ stdout: "", stderr: "命令超时", exitCode: -1 });
      }, timeout);

      proc.stdout.on("data", (d: Buffer) => {
        const chunk = d.toString();
        stdout += chunk;
        opts.onStdout?.(chunk);
      });
      proc.stderr.on("data", (d: Buffer) => {
        const chunk = d.toString();
        stderr += chunk;
        opts.onStderr?.(chunk);
      });
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

  /** 释放（保持容器运行） */
  release(): void {
    // 不销毁，容器保持运行以供复用
  }

  /** 销毁容器 */
  async destroy(): Promise<void> {
    if (!this.container) return;

    const id = this.container.id;
    try {
      await this.dockerCmd(["stop", "-t", "5", id]);
      await this.dockerCmd(["rm", "-f", id]);
      log.info("Container destroyed: %s", id);
    } catch (err: any) {
      log.warn("Failed to destroy container %s: %s", id, err.message);
    }
    this.container = null;
  }

  /** 重建容器（挂载变更时使用） */
  async recreate(): Promise<void> {
    await this.destroy();
    await this.acquire();
  }

  /** 健康检查 */
  async healthCheck(): Promise<boolean> {
    if (!this.container) return false;
    try {
      const result = await this.dockerCmd(["inspect", "--format", "{{.State.Running}}", this.container.id]);
      return result.trim() === "true";
    } catch {
      return false;
    }
  }

  /** 构建 docker create 参数 */
  private buildCreateArgs(agentDir: string): string[] {
    const args = [
      "create",
      "--rm=false",
      `--memory=${this.config.memory}`,
      `--cpus=${this.config.cpus}`,
      "-i",
    ];

    // 网络配置
    const networkArgs = buildNetworkArgs(this.config.network, this.agentId);
    args.push(...networkArgs);

    // 磁盘限制
    if (this.config.disk) {
      args.push("--storage-opt", `size=${this.config.disk}`);
    }

    // 安全加固
    if (this.config.security) {
      const securityArgs = buildSecurityArgs(this.config.security);
      args.push(...securityArgs);
    }

    const resolvedAgent = path.resolve(agentDir);
    args.push("-v", `${resolvedAgent}:/workspace`);

    for (const binding of this.config.bindings) {
      args.push("-v", binding);
    }

    args.push(this.image, "sleep", "infinity");
    return args;
  }

  /** 检查镜像存在性，不存在时尝试构建 */
  private async ensureImage(): Promise<void> {
    try {
      await this.dockerCmd(["image", "inspect", this.image]);
    } catch {
      log.warn("Image %s not found, attempting to build...", this.image);
      try {
        await this.dockerCmd(["build", "-t", this.image, "cobeing/sandbox/"]);
        log.info("Image %s built successfully", this.image);
      } catch (buildErr: any) {
        throw new Error(
          `沙箱镜像 ${this.image} 不存在且构建失败: ${buildErr.message}\n` +
          `请运行: scripts/build-sandbox.sh`
        );
      }
    }
  }

  /** docker create 并返回容器 ID */
  private dockerCreate(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn("docker", args);
      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
      proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
      proc.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`docker create failed (${code}): ${stderr}`));
        } else {
          resolve(stdout.trim());
        }
      });
      proc.on("error", reject);
    });
  }

  /** 执行 docker 命令并返回 stdout */
  private dockerCmd(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      exec(`docker ${args.join(" ")}`, { timeout: 30000 }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
        } else {
          resolve(stdout);
        }
      });
    });
  }
}
