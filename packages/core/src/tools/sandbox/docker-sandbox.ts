import path from "node:path";
import { exec } from "node:child_process";
import { createLogger } from "@cobeing/shared";
import type { SandboxConfig, SandboxRunner, SandboxRunOptions, SandboxRunResult } from "@cobeing/shared";
import { ContainerPool, type ContainerConfig } from "./container-pool.js";
import { buildRunCommand } from "./runtime-detector.js";

const log = createLogger("docker-sandbox");

export class DockerSandbox implements SandboxRunner {
  private pool: ContainerPool;
  private agentDir: string;
  private destroyed = false;

  constructor(
    private agentId: string,
    private config: SandboxConfig,
    agentDir: string,
  ) {
    this.agentDir = path.resolve(agentDir);
    this.pool = new ContainerPool(
      agentId,
      config.image ?? "cobeing-sandbox:latest",
      this.buildContainerConfig(),
      this.agentDir,
    );
  }

  /** 执行命令 */
  async run(command: string, opts: SandboxRunOptions = {}): Promise<SandboxRunResult> {
    if (this.destroyed) throw new Error("Sandbox has been destroyed");
    return this.pool.exec(command, opts);
  }

  /** 执行文件（自动检测运行时） */
  async runFile(filePath: string, opts: SandboxRunOptions = {}): Promise<SandboxRunResult> {
    const command = buildRunCommand(filePath);
    if (!command) {
      return { stdout: "", stderr: `无法检测文件运行时: ${filePath}`, exitCode: 1 };
    }
    return this.run(command, opts);
  }

  /** 追加挂载目录（群组加入时调用） */
  async addMount(hostPath: string, containerPath: string): Promise<void> {
    const resolved = path.resolve(hostPath);
    const binding = `${resolved}:${containerPath}`;
    if (!this.config.bindings?.includes(binding)) {
      this.config.bindings = this.config.bindings ?? [];
      this.config.bindings.push(binding);
      this.rebuildPool();
      await this.pool.recreate();
      log.info("Mount added: %s → %s", resolved, containerPath);
    }
  }

  /** 移除挂载 */
  async removeMount(containerPath: string): Promise<void> {
    if (!this.config.bindings) return;
    const idx = this.config.bindings.findIndex(b => b.includes(`:${containerPath}`));
    if (idx >= 0) {
      this.config.bindings.splice(idx, 1);
      this.rebuildPool();
      await this.pool.recreate();
      log.info("Mount removed: %s", containerPath);
    }
  }

  /** 销毁沙箱 */
  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    await this.pool.destroy();
    log.info("Sandbox destroyed for agent %s", this.agentId);
  }

  /** 获取状态 */
  getStatus(): { containerId: string | null; running: boolean } {
    return this.pool.getStatus();
  }

  /** 检测 Docker 是否可用 */
  static async checkDockerAvailable(): Promise<{ available: boolean; error?: string }> {
    return new Promise((resolve) => {
      exec("docker info", { timeout: 10000 }, (error, _stdout, stderr) => {
        if (error) {
          resolve({ available: false, error: stderr || error.message });
        } else {
          resolve({ available: true });
        }
      });
    });
  }

  private rebuildPool(): void {
    this.pool = new ContainerPool(
      this.agentId,
      this.config.image ?? "cobeing-sandbox:latest",
      this.buildContainerConfig(),
      this.agentDir,
    );
  }

  private buildContainerConfig(): ContainerConfig {
    return {
      memory: this.config.resources?.memory ?? "512m",
      cpus: this.config.resources?.cpus ?? 1,
      network: this.config.network ?? { enabled: true, mode: "all" },
      bindings: this.config.bindings ?? [],
      timeout: this.config.resources?.timeout ?? 30,
      disk: this.config.resources?.disk,
      security: this.config.security,
    };
  }
}
