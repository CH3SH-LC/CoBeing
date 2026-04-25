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

  /** Docker 可用性缓存（避免重复检测） */
  private static _dockerAvailable: boolean | null = null;
  /** 镜像构建锁（防止并发构建同一镜像） */
  private static _buildingImage: string | null = null;
  private static _buildPromise: Promise<void> | null = null;

  /** 设置 Docker 可用性（由外部调用，如 runtime 启动时） */
  static setDockerAvailable(available: boolean): void {
    ContainerPool._dockerAvailable = available;
  }

  /** 检查 Docker 是否可用（带缓存） */
  static async checkDockerAvailable(): Promise<boolean> {
    if (ContainerPool._dockerAvailable !== null) return ContainerPool._dockerAvailable;
    return new Promise((resolve) => {
      exec("docker info", { timeout: 5000 }, (error) => {
        ContainerPool._dockerAvailable = !error;
        resolve(!error);
      });
    });
  }

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
    // 快速检查：Docker 是否可用
    const dockerOk = await ContainerPool.checkDockerAvailable();
    if (!dockerOk) {
      throw new Error(
        `Docker 不可用，无法运行沙箱。请确保 Docker Desktop 已启动。\n` +
        `运行 docker info 检查 Docker 状态`
      );
    }

    try {
      await this.dockerCmd(["image", "inspect", this.image]);
      // 镜像存在，清除构建锁
      ContainerPool._buildingImage = null;
      ContainerPool._buildPromise = null;
    } catch (inspectErr: any) {
      // 区分 "image not found" 和 "Docker daemon 错误"
      const errMsg = inspectErr.message || "";
      if (errMsg.includes("No such image") || errMsg.includes("Error: No such image")) {
        // 镜像确实不存在，需要构建
        await this.buildImage();
      } else if (errMsg.includes("Cannot connect") || errMsg.includes("error during connect") || errMsg.includes("pipe")) {
        // Docker daemon 不可用
        throw new Error(
          `Docker daemon 不可达: ${errMsg}\n` +
          `请确保 Docker Desktop 已启动`
        );
      } else {
        // 其他错误，尝试构建
        log.warn("Image inspect failed (%s), attempting build...", errMsg.slice(0, 100));
        await this.buildImage();
      }
    }
  }

  /** 构建镜像（带去重锁，防止并发构建） */
  private async buildImage(): Promise<void> {
    // 如果已有构建任务在进行中，等待它完成
    if (ContainerPool._buildingImage === this.image && ContainerPool._buildPromise) {
      log.info("Waiting for ongoing build of %s...", this.image);
      await ContainerPool._buildPromise;
      // 构建完成后验证镜像是否存在
      try {
        await this.dockerCmd(["image", "inspect", this.image]);
        return;
      } catch {
        throw new Error(`镜像 ${this.image} 构建完成但仍不可用`);
      }
    }

    // 设置构建锁
    ContainerPool._buildingImage = this.image;
    ContainerPool._buildPromise = this.doBuild();

    try {
      await ContainerPool._buildPromise;
    } finally {
      ContainerPool._buildingImage = null;
      ContainerPool._buildPromise = null;
    }
  }

  /** 实际执行构建 */
  private async doBuild(): Promise<void> {
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
