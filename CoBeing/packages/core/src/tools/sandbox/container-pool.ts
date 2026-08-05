import { spawn, exec } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createLogger } from "@cobeing/shared";
import type { NetworkConfig, SandboxRunOptions, SandboxRunResult, SecurityConfig } from "@cobeing/shared";
import { buildNetworkArgs, buildWhitelistRules } from "./network-whitelist.js";
import { buildSecurityArgs } from "./security.js";

const log = createLogger("container-pool");

/** 定位沙箱 Dockerfile 目录（依次尝试：项目根 cwd/sandbox、相对本模块的 5 级上溯） */
function resolveSandboxDir(): string {
  const fromCwd = path.resolve(process.cwd(), "sandbox");
  if (fs.existsSync(path.join(fromCwd, "Dockerfile.base"))) return fromCwd;
  const fromModule = path.resolve(__dirname, "../../../../../sandbox");
  if (fs.existsSync(path.join(fromModule, "Dockerfile.base"))) return fromModule;
  log.warn("Sandbox dir not found (cwd=%s), falling back to cwd/sandbox", process.cwd());
  return fromCwd;
}

/** 按镜像名选择对应 Dockerfile（base/python/full，默认 full） */
function sandboxDockerfileFor(image: string): string {
  if (image.endsWith(":base")) return "Dockerfile.base";
  if (image.endsWith(":python")) return "Dockerfile.python";
  return "Dockerfile.full";
}

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

/** 容器实时指标（docker stats 采集） */
export interface ContainerStats {
  uptime: number;
  memoryUsage: number;
  memoryLimit: number;
  cpuPercent: number;
}

const BYTE_UNITS: Record<string, number> = {
  B: 1,
  KiB: 1024,
  MiB: 1024 ** 2,
  GiB: 1024 ** 3,
  TiB: 1024 ** 4,
};

/** 解析 docker stats --no-stream 单行输出 "12.34%|14.2MiB / 512MiB|2.77%" */
export function parseDockerStats(line: string): Pick<ContainerStats, "memoryUsage" | "memoryLimit" | "cpuPercent"> | null {
  const parts = line.trim().split("|");
  if (parts.length < 2) return null;

  const cpuMatch = /^([\d.]+)%$/.exec(parts[0]?.trim() ?? "");
  const memMatch = /^([\d.]+)([A-Za-z]+) \/ ([\d.]+)([A-Za-z]+)$/.exec(parts[1]?.trim() ?? "");
  if (!cpuMatch || !memMatch) return null;

  const unitOf = (u: string) => BYTE_UNITS[u] ?? 1;
  const memoryUsage = parseFloat(memMatch[1]) * unitOf(memMatch[2]);
  const memoryLimit = parseFloat(memMatch[3]) * unitOf(memMatch[4]);
  if (!Number.isFinite(memoryUsage) || !Number.isFinite(memoryLimit)) return null;

  return {
    memoryUsage,
    memoryLimit,
    cpuPercent: parseFloat(cpuMatch[1]),
  };
}

export class ContainerPool {
  private container: PoolContainer | null = null;

  /** Docker 可用性缓存（避免重复检测） */
  private static _dockerAvailable: boolean | null = null;
  /** 镜像构建锁 — 按镜像名隔离，防止并发构建同一镜像 */
  private static _buildPromises = new Map<string, Promise<void>>();

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

  /** 采集容器实时指标（docker stats --no-stream）— 容器未运行或 Docker 不可用时返回 null */
  async stats(): Promise<ContainerStats | null> {
    if (!this.container || this.container.status !== "running") return null;
    try {
      const result = await this.dockerCmd([
        "stats", this.container.id, "--no-stream", "--format", "{{.CPUPerc}}|{{.MemUsage}}",
      ]);
      const parsed = parseDockerStats(result);
      if (!parsed) return null;
      return {
        ...parsed,
        uptime: Date.now() - this.container.createdAt,
      };
    } catch {
      return null;
    }
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

    // 启动容器
    await this.dockerCmd(["start", containerId]);

    this.container = {
      id: containerId,
      status: "running",
      createdAt: Date.now(),
    };

    // 如果网络模式是 whitelist，应用 iptables 规则
    if (this.config.network?.mode === "whitelist" && this.config.network.allowDomains?.length) {
      await this.applyWhitelistRules(containerId, this.config.network.allowDomains);
    }

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

  /** 构建镜像（带去重锁，防止并发构建同一镜像） */
  private async buildImage(): Promise<void> {
    // 如果已有同镜像的构建任务，等待它完成
    const existing = ContainerPool._buildPromises.get(this.image);
    if (existing) {
      log.info("Waiting for ongoing build of %s...", this.image);
      await existing;
      // 构建完成后验证镜像是否存在
      try {
        await this.dockerCmd(["image", "inspect", this.image]);
        return;
      } catch {
        throw new Error(`镜像 ${this.image} 构建完成但仍不可用`);
      }
    }

    // 设置构建锁
    const promise = this.doBuild();
    ContainerPool._buildPromises.set(this.image, promise);

    try {
      await promise;
    } finally {
      ContainerPool._buildPromises.delete(this.image);
    }
  }

  /** 检查镜像是否存在（不存在则构建） */
  private async ensureImageExists(image: string, dockerfile: string, sandboxDir: string): Promise<void> {
    try {
      await this.dockerCmd(["image", "inspect", image]);
      return;
    } catch {
      log.warn("Dependency image %s not found, building...", image);
      await this.dockerCmd(["build", "-t", image, "-f", path.join(sandboxDir, dockerfile), sandboxDir], 600000);
    }
  }

  /**
   * 实际执行构建（修复：构建上下文硬编码 "cobeing/sandbox/" 在项目根 CWD 下不存在；
   * 且 Dockerfile.full 依赖 cobeing-sandbox:python、:python 依赖 :base，需先构建依赖链）
   */
  private async doBuild(): Promise<void> {
    log.warn("Image %s not found, attempting to build...", this.image);
    try {
      const sandboxDir = resolveSandboxDir();
      const dockerfile = sandboxDockerfileFor(this.image);
      // 构建依赖链（base → python → 目标），跳过目标自身
      if (dockerfile !== "Dockerfile.base") {
        await this.ensureImageExists("cobeing-sandbox:base", "Dockerfile.base", sandboxDir);
      }
      if (dockerfile === "Dockerfile.full") {
        await this.ensureImageExists("cobeing-sandbox:python", "Dockerfile.python", sandboxDir);
      }
      await this.dockerCmd(["build", "-t", this.image, "-f", path.join(sandboxDir, dockerfile), sandboxDir], 600000);
      log.info("Image %s built successfully", this.image);
    } catch (buildErr: any) {
      throw new Error(
        `沙箱镜像 ${this.image} 不存在且构建失败: ${buildErr.message}\n` +
        `请运行: scripts/build-sandbox.sh`
      );
    }
  }

  /** 应用 iptables 白名单规则（容器网络 whitelist 模式） */
  private async applyWhitelistRules(containerId: string, allowDomains: string[]): Promise<void> {
    try {
      // 获取容器 IP
      const inspect = await this.dockerCmd([
        "inspect", "--format", "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}", containerId,
      ]);
      const containerIp = inspect.trim();
      if (!containerIp) {
        log.warn("Container %s has no IP, skipping iptables whitelist", containerId);
        return;
      }
      const rules = buildWhitelistRules(containerIp, allowDomains);
      // 在宿主机上执行 iptables 规则（DOCKER-USER 是宿主机链，非容器内链）
      const { spawn } = await import("node:child_process");
      for (const rule of rules) {
        try {
          await new Promise<void>((resolve, reject) => {
            const proc = spawn("iptables", rule.split(" ").slice(1), { timeout: 5000 });
            proc.on("close", (code) => {
              if (code === 0 || code === null) resolve();
              else reject(new Error(`iptables exit ${code}`));
            });
            proc.on("error", reject);
          });
        } catch {
          // iptables 不可用（如非 Linux 或无 root 权限），静默忽略
        }
      }
      log.info("Applied %d iptables whitelist rules to container %s", rules.length, containerId);
    } catch (err: any) {
      log.warn("Failed to apply iptables whitelist rules: %s", err.message);
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

  /** 执行 docker 命令并返回 stdout（使用 spawn 防注入） */
  private dockerCmd(args: string[], timeoutMs = 30000): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn("docker", args, { timeout: timeoutMs });
      let stdout = "";
      let stderr = "";
      proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
      proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
      proc.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(stderr || `exit code ${code}`));
        } else {
          resolve(stdout);
        }
      });
      proc.on("error", reject);
    });
  }
}
