# 沙箱核心功能重设计 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复沙箱功能的 8 个核心问题，实现 Docker 容器池化、文件系统隔离、流式输出、多运行时检测

**Architecture:** 集中式 DockerSandbox 管理器，内嵌 ContainerPool 管理 Agent 级长驻容器。各工具通过 ToolContext.sandboxRunner 委托执行，不再自行拼装 docker 命令。

**Tech Stack:** TypeScript, Docker CLI (child_process), Vitest

---

## File Structure

```
cobeing/sandbox/Dockerfile                    # 新建 — 沙箱镜像定义
scripts/build-sandbox.sh                      # 新建 — 镜像构建脚本
packages/shared/src/types.ts                  # 修改 — SandboxConfig 扩展
packages/core/src/config/schema.ts            # 修改 — AgentSelfConfig.sandbox 扩展
packages/core/src/tools/sandbox/runtime-detector.ts  # 新建 — 多运行时检测
packages/core/src/tools/sandbox/container-pool.ts    # 新建 — 容器池
packages/core/src/tools/sandbox/docker-sandbox.ts    # 新建 — 沙箱主类
packages/core/src/tools/sandbox/index.ts             # 新建 — 统一导出
packages/core/src/tools/sandbox/container-pool.test.ts  # 新建 — 测试
packages/core/src/tools/sandbox/runtime-detector.test.ts # 新建 — 测试
packages/core/src/tools/executor.ts           # 修改 — 读取配置 + 传入 sandboxRunner
packages/core/src/tools/executor.test.ts      # 修改 — 更新测试
packages/core/src/tools/bash.ts               # 修改 — 删除内联沙箱，委托执行
packages/core/src/tools/sandbox.ts            # 删除 — 旧版 DockerSandbox
packages/core/src/agent/agent.ts              # 修改 — 创建 DockerSandbox 实例
packages/core/src/agent/spawner.ts            # 修改 — 继承父配置
packages/core/src/agent/butler.ts             # 修改 — 传递沙箱配置
packages/core/src/api/ws-server.ts            # 修改 — 读取前端沙箱配置
packages/core/src/conversation/conversation-loop.ts  # 修改 — 传递 sandboxConfig
packages/core/src/group/group.ts              # 修改 — addMember 时挂载群组目录
gui-v2/src/components/agent/AgentConfigTab.tsx    # 修改 — 资源配置 UI
gui-v2/src/components/agent/CreateAgentDialog.tsx # 修改 — 资源配置 UI
```

---

## Task 1: Dockerfile + 构建脚本

**Files:**
- Create: `cobeing/sandbox/Dockerfile`
- Create: `scripts/build-sandbox.sh`

- [ ] **Step 1: 创建 Dockerfile**

```bash
mkdir -p cobeing/sandbox
```

写入 `cobeing/sandbox/Dockerfile`:

```dockerfile
FROM node:20-bookworm

# Python 3.11
RUN apt-get update && \
    apt-get install -y python3 python3-pip python3-venv && \
    rm -rf /var/lib/apt/lists/*

# Go 1.22
RUN wget -q https://go.dev/dl/go1.22.4.linux-amd64.tar.gz && \
    tar -C /usr/local -xzf go1.22.4.linux-amd64.tar.gz && \
    rm go1.22.4.linux-amd64.tar.gz
ENV PATH=$PATH:/usr/local/go/bin

# 常用工具
RUN apt-get update && \
    apt-get install -y git curl jq make && \
    rm -rf /var/lib/apt/lists/*

# 非 root 用户
RUN useradd -m -u 1000 cobeing && \
    mkdir -p /workspace && chown cobeing:cobeing /workspace

USER cobeing
WORKDIR /workspace

CMD ["bash"]
```

- [ ] **Step 2: 创建构建脚本**

写入 `scripts/build-sandbox.sh`:

```bash
#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "Building cobeing-sandbox image..."
docker build -t cobeing-sandbox:latest "$PROJECT_ROOT/cobeing/sandbox/"

echo "Done. Image: cobeing-sandbox:latest"
docker images cobeing-sandbox:latest
```

```bash
chmod +x scripts/build-sandbox.sh
```

- [ ] **Step 3: 提交**

```bash
git add cobeing/sandbox/Dockerfile scripts/build-sandbox.sh
git commit -m "feat(sandbox): add Dockerfile and build script for cobeing-sandbox image"
```

---

## Task 2: SandboxConfig 类型扩展

**Files:**
- Modify: `packages/shared/src/types.ts:157-164`
- Modify: `packages/core/src/config/schema.ts:110-115`

- [ ] **Step 1: 扩展 SandboxConfig**

修改 `packages/shared/src/types.ts` 中的 `SandboxConfig`：

```ts
// 改前
export interface SandboxConfig {
  enabled: boolean;
  filesystem: "off" | "workspace-only" | "allowlist";
  network: boolean;
  allowPaths?: string[];
  blockPaths?: string[];
  bindings?: string[];  // extra mounts "hostPath:containerPath[:ro]"
}

// 改后
export interface SandboxConfig {
  enabled: boolean;
  filesystem: "isolated" | "host";
  network: boolean;
  bindings?: string[];  // extra mounts "hostPath:containerPath[:ro]"
  resources?: {
    memory?: string;    // 如 "512m", "1g"，默认 "512m"
    cpus?: number;      // 如 1, 2，默认 1
    timeout?: number;   // 单次命令超时秒数，默认 30
  };
  image?: string;       // 自定义镜像，默认 "cobeing-sandbox:latest"
}
```

- [ ] **Step 2: 扩展 ToolContext**

在 `packages/shared/src/types.ts` 的 `ToolContext` 中添加 `sandboxRunner` 字段：

```ts
// 改前
export interface ToolContext {
  agentId: string;
  sessionId: string;
  workingDir: string;
  sandbox: SandboxConfig;
  permissions: PermissionPolicy;
  callDepth?: number;
}

// 改后
export interface ToolContext {
  agentId: string;
  sessionId: string;
  workingDir: string;
  sandbox: SandboxConfig;
  sandboxRunner?: SandboxRunner;
  permissions: PermissionPolicy;
  callDepth?: number;
}
```

在 `packages/shared/src/types.ts` 的 `SandboxConfig` 定义之后、`Tool` 定义之前，添加沙箱执行器接口：

```ts
// ============================================================
// SandboxRunner 接口 — 沙箱执行器抽象（定义在 shared 包避免循环依赖）
// ============================================================

export interface SandboxRunOptions {
  timeout?: number;
  cwd?: string;
  env?: Record<string, string>;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

export interface SandboxRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface SandboxRunner {
  run(command: string, opts?: SandboxRunOptions): Promise<SandboxRunResult>;
  runFile(filePath: string, opts?: SandboxRunOptions): Promise<SandboxRunResult>;
  addMount(hostPath: string, containerPath: string): Promise<void>;
  removeMount(containerPath: string): Promise<void>;
  destroy(): Promise<void>;
  getStatus(): { containerId: string | null; running: boolean };
}
```

- [ ] **Step 3: 扩展 AgentSelfConfig**

修改 `packages/core/src/config/schema.ts` 中的 `AgentSelfConfig.sandbox`：

```ts
// 改前
sandbox?: {
  enabled: boolean;
  filesystem: string;
  network: boolean;
  bindings?: string[];
};

// 改后
sandbox?: {
  enabled: boolean;
  filesystem: "isolated" | "host";
  network: boolean;
  bindings?: string[];
  resources?: {
    memory?: string;
    cpus?: number;
    timeout?: number;
  };
  image?: string;
};
```

- [ ] **Step 4: 提交**

```bash
git add packages/shared/src/types.ts packages/core/src/config/schema.ts
git commit -m "feat(sandbox): extend SandboxConfig with resources, image, filesystem modes"
```

---

## Task 3: 多运行时检测器

**Files:**
- Create: `packages/core/src/tools/sandbox/runtime-detector.ts`
- Create: `packages/core/src/tools/sandbox/runtime-detector.test.ts`

- [ ] **Step 1: 写测试**

```bash
mkdir -p packages/core/src/tools/sandbox
```

写入 `packages/core/src/tools/sandbox/runtime-detector.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { detectRuntime, buildRunCommand } from "./runtime-detector.js";

describe("runtime-detector", () => {
  describe("detectRuntime", () => {
    it("detects Python files", () => {
      expect(detectRuntime("script.py")).toBe("python3");
      expect(detectRuntime("/path/to/main.py")).toBe("python3");
    });

    it("detects JavaScript files", () => {
      expect(detectRuntime("app.js")).toBe("node");
    });

    it("detects TypeScript files", () => {
      expect(detectRuntime("index.ts")).toBe("npx tsx");
    });

    it("detects Go files", () => {
      expect(detectRuntime("main.go")).toBe("go run");
    });

    it("detects shell scripts", () => {
      expect(detectRuntime("deploy.sh")).toBe("bash");
    });

    it("returns null for unknown extensions", () => {
      expect(detectRuntime("data.txt")).toBeNull();
      expect(detectRuntime("README.md")).toBeNull();
      expect(detectRuntime("Makefile")).toBeNull();
    });
  });

  describe("buildRunCommand", () => {
    it("builds python command", () => {
      expect(buildRunCommand("script.py")).toBe("python3 script.py");
    });

    it("builds node command", () => {
      expect(buildRunCommand("/abs/path/app.js")).toBe("node /abs/path/app.js");
    });

    it("builds tsx command", () => {
      expect(buildRunCommand("index.ts")).toBe("npx tsx index.ts");
    });

    it("returns null for unknown file", () => {
      expect(buildRunCommand("data.bin")).toBeNull();
    });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd D:/agent-codes/cobeing && npx vitest run packages/core/src/tools/sandbox/runtime-detector.test.ts
```

预期：FAIL — 模块不存在

- [ ] **Step 3: 实现**

写入 `packages/core/src/tools/sandbox/runtime-detector.ts`:

```ts
import path from "node:path";

const RUNTIME_MAP: Record<string, string> = {
  ".py": "python3",
  ".js": "node",
  ".ts": "npx tsx",
  ".go": "go run",
  ".sh": "bash",
  ".rb": "ruby",
};

/** 根据文件扩展名检测运行时，未知返回 null */
export function detectRuntime(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  return RUNTIME_MAP[ext] ?? null;
}

/** 构建运行命令，未知扩展名返回 null */
export function buildRunCommand(filePath: string): string | null {
  const runtime = detectRuntime(filePath);
  if (!runtime) return null;
  return `${runtime} ${filePath}`;
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd D:/agent-codes/cobeing && npx vitest run packages/core/src/tools/sandbox/runtime-detector.test.ts
```

预期：PASS

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/tools/sandbox/runtime-detector.ts packages/core/src/tools/sandbox/runtime-detector.test.ts
git commit -m "feat(sandbox): add multi-runtime detector for .py/.js/.ts/.go/.sh"
```

---

## Task 4: ContainerPool 容器池

**Files:**
- Create: `packages/core/src/tools/sandbox/container-pool.ts`
- Create: `packages/core/src/tools/sandbox/container-pool.test.ts`

- [ ] **Step 1: 写测试**

写入 `packages/core/src/tools/sandbox/container-pool.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ContainerPool } from "./container-pool.js";

// Mock child_process
vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

describe("ContainerPool", () => {
  const defaultConfig = {
    memory: "512m",
    cpus: 1,
    network: true,
    bindings: [],
    timeout: 30,
  };

  it("constructs with correct defaults", () => {
    const pool = new ContainerPool("agent-1", "cobeing-sandbox:latest", defaultConfig);
    expect(pool.getStatus().containerId).toBeNull();
    expect(pool.getStatus().running).toBe(false);
  });

  it("builds correct docker create args", () => {
    const pool = new ContainerPool("agent-1", "cobeing-sandbox:latest", {
      ...defaultConfig,
      memory: "1g",
      cpus: 2,
      network: false,
      bindings: ["/host/path:/container/path"],
    });

    // Access private method for testing
    const args = (pool as any).buildCreateArgs("/workspace");
    expect(args).toContain("--memory=1g");
    expect(args).toContain("--cpus=2");
    expect(args).toContain("--network=none");
    expect(args).toContain("-v");
    expect(args).toContain("/host/path:/container/path");
  });

  it("builds args without --network=none when network is true", () => {
    const pool = new ContainerPool("agent-1", "cobeing-sandbox:latest", {
      ...defaultConfig,
      network: true,
    });
    const args = (pool as any).buildCreateArgs("/workspace");
    expect(args).not.toContain("--network=none");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd D:/agent-codes/cobeing && npx vitest run packages/core/src/tools/sandbox/container-pool.test.ts
```

预期：FAIL — 模块不存在

- [ ] **Step 3: 实现 ContainerPool**

写入 `packages/core/src/tools/sandbox/container-pool.ts`:

```ts
import { spawn, exec } from "node:child_process";
import path from "node:path";
import { createLogger } from "@cobeing/shared";
import type { SandboxRunOptions, SandboxRunResult } from "@cobeing/shared";

const log = createLogger("container-pool");

export interface ContainerConfig {
  memory: string;
  cpus: number;
  network: boolean;
  bindings: string[];
  timeout: number;
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
  ) {}

  getStatus(): { containerId: string | null; running: boolean } {
    return {
      containerId: this.container?.id ?? null,
      running: this.container?.status === "running",
    };
  }

  /** 获取或创建容器 */
  async acquire(agentDir: string): Promise<PoolContainer> {
    if (this.container && this.container.status === "running") {
      // 健康检查
      const healthy = await this.healthCheck();
      if (healthy) return this.container;
      log.warn("Container %s unhealthy, recreating", this.container.id);
      await this.destroy();
    }

    // 检查镜像存在性
    await this.ensureImage();

    // 创建容器
    const args = this.buildCreateArgs(agentDir);
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
    const container = await this.acquire(opts.cwd ?? "/workspace");
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
  async recreate(agentDir: string): Promise<void> {
    await this.destroy();
    await this.acquire(agentDir);
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

    if (!this.config.network) {
      args.push("--network=none");
    }

    // 挂载 agent 目录
    const resolvedAgent = path.resolve(agentDir);
    args.push("-v", `${resolvedAgent}:/workspace`);

    // 额外挂载
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
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd D:/agent-codes/cobeing && npx vitest run packages/core/src/tools/sandbox/container-pool.test.ts
```

预期：PASS

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/tools/sandbox/container-pool.ts packages/core/src/tools/sandbox/container-pool.test.ts
git commit -m "feat(sandbox): implement ContainerPool with agent-level container reuse"
```

---

## Task 5: DockerSandbox 主类

**Files:**
- Create: `packages/core/src/tools/sandbox/docker-sandbox.ts`

- [ ] **Step 1: 实现 DockerSandbox**

写入 `packages/core/src/tools/sandbox/docker-sandbox.ts`:

```ts
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
    );
  }

  /** 执行命令 */
  async run(command: string, opts: SandboxRunOptions = {}): Promise<SandboxRunResult> {
    if (this.destroyed) throw new Error("Sandbox has been destroyed");
    return this.pool.exec(command, { ...opts, cwd: opts.cwd ?? "/workspace" });
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
      // 更新 pool 配置
      this.pool = new ContainerPool(
        this.agentId,
        this.config.image ?? "cobeing-sandbox:latest",
        this.buildContainerConfig(),
      );
      // 重建容器
      await this.pool.recreate(this.agentDir);
      log.info("Mount added: %s → %s", resolved, containerPath);
    }
  }

  /** 移除挂载 */
  async removeMount(containerPath: string): Promise<void> {
    if (!this.config.bindings) return;
    const idx = this.config.bindings.findIndex(b => b.includes(`:${containerPath}`));
    if (idx >= 0) {
      this.config.bindings.splice(idx, 1);
      this.pool = new ContainerPool(
        this.agentId,
        this.config.image ?? "cobeing-sandbox:latest",
        this.buildContainerConfig(),
      );
      await this.pool.recreate(this.agentDir);
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

  private buildContainerConfig(): ContainerConfig {
    return {
      memory: this.config.resources?.memory ?? "512m",
      cpus: this.config.resources?.cpus ?? 1,
      network: this.config.network ?? true,
      bindings: this.config.bindings ?? [],
      timeout: this.config.resources?.timeout ?? 30,
    };
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add packages/core/src/tools/sandbox/docker-sandbox.ts
git commit -m "feat(sandbox): implement DockerSandbox with mount management and runtime detection"
```

---

## Task 6: Barrel 导出 + 删除旧文件

**Files:**
- Create: `packages/core/src/tools/sandbox/index.ts`
- Delete: `packages/core/src/tools/sandbox.ts`

- [ ] **Step 1: 创建 barrel 导出**

写入 `packages/core/src/tools/sandbox/index.ts`:

```ts
export { DockerSandbox } from "./docker-sandbox.js";
export { ContainerPool } from "./container-pool.js";
export { detectRuntime, buildRunCommand } from "./runtime-detector.js";
```

- [ ] **Step 2: 删除旧 sandbox.ts**

```bash
rm packages/core/src/tools/sandbox.ts
```

- [ ] **Step 3: 检查旧文件无其他引用**

```bash
cd D:/agent-codes/cobeing && grep -r "from.*\./sandbox" packages/core/src --include="*.ts" | grep -v "sandbox/" | grep -v node_modules
```

预期：无输出（旧文件无引用）。如有引用，更新为新路径。

- [ ] **Step 4: 提交**

```bash
git add packages/core/src/tools/sandbox/index.ts
git add packages/core/src/tools/sandbox.ts
git commit -m "refactor(sandbox): add barrel export, remove old DockerSandbox file"
```

---

## Task 7: ToolExecutor 修复 — 读取配置 + 传入 sandboxRunner

**Files:**
- Modify: `packages/core/src/tools/executor.ts`
- Modify: `packages/core/src/tools/executor.test.ts`

- [ ] **Step 1: 修改 ToolExecutor**

修改 `packages/core/src/tools/executor.ts`：

```ts
/**
 * ToolExecutor — 统一工具执行入口
 */
import type { ToolCall, ToolResult, SandboxConfig, SandboxRunner } from "@cobeing/shared";
import { EventEmitter, createLogger } from "@cobeing/shared";
import { ToolRegistry } from "./registry.js";
import { PermissionEnforcer } from "./permission.js";

const log = createLogger("tool-executor");

export class ToolExecutor {
  constructor(
    private registry: ToolRegistry,
    private permission: PermissionEnforcer,
    private events?: EventEmitter,
    private sandboxConfig?: SandboxConfig,
    private sandboxRunner?: SandboxRunner,
  ) {}

  async execute(toolCall: ToolCall, agentId: string, sessionId: string, workingDir: string, callDepth = 0): Promise<ToolResult> {
    // 1. 查找工具
    const tool = this.registry.get(toolCall.function.name);
    if (!tool) {
      return { toolCallId: toolCall.id, content: `未知工具: ${toolCall.function.name}`, isError: true };
    }

    // 2. 解析参数
    let params: Record<string, unknown>;
    try {
      params = JSON.parse(toolCall.function.arguments);
    } catch {
      return { toolCallId: toolCall.id, content: `工具参数 JSON 解析失败`, isError: true };
    }

    // 3. 权限检查
    const permResult = this.permission.check(tool.name, params);
    if (!permResult.allowed) {
      log.warn("[DENIED] %s — %s", tool.name, permResult.reason);
      this.events?.emit("tool:denied", { agentId, toolName: tool.name, reason: permResult.reason! });
      return { toolCallId: toolCall.id, content: `权限不足: ${permResult.reason}`, isError: true };
    }

    // 4. 执行
    log.info("[CALL] %s(%s)", tool.name, toolCall.function.arguments);
    this.events?.emit("tool:call", { agentId, toolName: tool.name, params });
    const result = await tool.execute(params, {
      agentId,
      sessionId,
      workingDir,
      sandbox: this.sandboxConfig ?? { enabled: false, filesystem: "isolated", network: true },
      sandboxRunner: this.sandboxRunner,
      permissions: { mode: "full-access" },
      callDepth,
    });
    result.toolCallId = toolCall.id;

    log.info("[RESULT] %s — %s%s", tool.name, result.isError ? "ERROR: " : "", (result.content as string).slice(0, 200));
    this.events?.emit("tool:result", {
      agentId,
      toolName: tool.name,
      result: result.content,
      isError: result.isError ?? false,
    });

    return result;
  }
}
```

- [ ] **Step 2: 更新测试**

修改 `packages/core/src/tools/executor.test.ts`，更新 `makeExecutor` 函数：

```ts
// 改前
function makeExecutor(mode: string = "full-access") {
  const registry = new ToolRegistry();
  registry.register(echoTool);
  registry.register(failTool);
  const permission = new PermissionEnforcer({ mode: mode as any }, undefined, "/workspace");
  return new ToolExecutor(registry, permission);
}

// 改后
function makeExecutor(mode: string = "full-access") {
  const registry = new ToolRegistry();
  registry.register(echoTool);
  registry.register(failTool);
  const permission = new PermissionEnforcer({ mode: mode as any }, undefined, "/workspace");
  return new ToolExecutor(registry, permission, undefined, { enabled: false, filesystem: "isolated", network: true });
}
```

- [ ] **Step 3: 运行测试**

```bash
cd D:/agent-codes/cobeing && npx vitest run packages/core/src/tools/executor.test.ts
```

预期：PASS

- [ ] **Step 4: 提交**

```bash
git add packages/core/src/tools/executor.ts packages/core/src/tools/executor.test.ts
git commit -m "fix(sandbox): ToolExecutor reads sandbox config instead of hardcoding enabled:false"
```

---

## Task 8: bash.ts 重构 — 删除内联沙箱，委托执行

**Files:**
- Modify: `packages/core/src/tools/bash.ts`

- [ ] **Step 1: 重写 bash.ts**

```ts
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
```

- [ ] **Step 2: 提交**

```bash
git add packages/core/src/tools/bash.ts
git commit -m "refactor(sandbox): bash.ts delegates to sandboxRunner, remove inline docker logic"
```

---

## Task 9: Agent 集成 — 创建 DockerSandbox 实例

**Files:**
- Modify: `packages/core/src/agent/agent.ts`

- [ ] **Step 1: 在 Agent 中创建 DockerSandbox**

修改 `packages/core/src/agent/agent.ts`：

在 import 区域添加：

```ts
import { DockerSandbox } from "../tools/sandbox/docker-sandbox.js";
```

在 Agent 类中添加属性：

```ts
private _sandbox: DockerSandbox | null = null;
```

修改构造函数中的 `ToolExecutor` 创建（约第 152 行）：

```ts
// 改前
const toolExecutor = new ToolExecutor(this.toolRegistry, permission);

// 改后
// 创建沙箱（如果启用）
if (mergedConfig.sandbox?.enabled) {
  this._sandbox = new DockerSandbox(
    config.id,
    mergedConfig.sandbox,
    this.paths.directory,  // 使用 agent 根目录作为 workspace
  );
}

const toolExecutor = new ToolExecutor(
  this.toolRegistry,
  permission,
  undefined,  // events
  mergedConfig.sandbox,
  this._sandbox ?? undefined,
);
```

在 `injectSkillRepository` 方法中（约第 206 行），同样更新 ToolExecutor 创建：

```ts
// 改前
const executor = new ToolExecutor(this.toolRegistry, perm);

// 改后
const executor = new ToolExecutor(
  this.toolRegistry,
  perm,
  undefined,
  this.config.sandbox,
  this._sandbox ?? undefined,
);
```

在 `handleIncomingMessage` 方法中（约第 241 行），更新 ToolExecutor 创建：

```ts
// 改前
const toolExecutor = new ToolExecutor(this.toolRegistry, permission);

// 改后
const toolExecutor = new ToolExecutor(
  this.toolRegistry,
  permission,
  undefined,
  this.config.sandbox,
  this._sandbox ?? undefined,
);
```

在 `connectMCPServer` 方法中（约第 355 行），更新 ToolExecutor 创建：

```ts
// 改前
new ToolExecutor(
  this.toolRegistry,
  new PermissionEnforcer(this.config.permissions ?? { mode: "ask" }, this.config.toolsConfig, this.paths.workspaceDir),
)

// 改后
new ToolExecutor(
  this.toolRegistry,
  new PermissionEnforcer(this.config.permissions ?? { mode: "ask" }, this.config.toolsConfig, this.paths.workspaceDir),
  undefined,
  this.config.sandbox,
  this._sandbox ?? undefined,
)
```

在 `dispose` 方法中添加沙箱销毁：

```ts
// 改前
async dispose(): Promise<void> {
  this.eventBusUnsub?.();
  this.memoryStore.close();
  await this.mcpManager.close();
}

// 改后
async dispose(): Promise<void> {
  this.eventBusUnsub?.();
  this.memoryStore.close();
  await this.mcpManager.close();
  if (this._sandbox) {
    await this._sandbox.destroy();
    this._sandbox = null;
  }
}
```

添加公开方法供外部访问沙箱（用于群组挂载）：

```ts
/** 获取沙箱实例（用于群组挂载等） */
get sandboxRunner(): DockerSandbox | null {
  return this._sandbox;
}
```

- [ ] **Step 2: 运行全量测试**

```bash
cd D:/agent-codes/cobeing && npx vitest run
```

预期：所有测试通过

- [ ] **Step 3: 提交**

```bash
git add packages/core/src/agent/agent.ts
git commit -m "feat(sandbox): Agent creates DockerSandbox instance and passes to ToolExecutor"
```

---

## Task 10: 子 Agent 沙箱继承

**Files:**
- Modify: `packages/core/src/agent/spawner.ts:46-57`
- Modify: `packages/core/src/agent/butler.ts:91-97,111-117`
- Modify: `packages/core/src/api/ws-server.ts:367-373,383-385`

- [ ] **Step 1: 修改 spawner.ts — 继承父配置**

修改 `packages/core/src/agent/spawner.ts` 中 `spawn` 方法的 `subConfig`（约第 46 行）：

```ts
// 改前
sandbox: this.parentConfig.sandbox,

// 已正确继承，无需修改。但需确认 spawnForJSON 也继承（约第 98 行）：
// 改前
sandbox: this.parentConfig.sandbox,

// 已正确。两个位置都继承了父配置。
```

确认 spawner.ts 无需修改（已正确继承）。

- [ ] **Step 2: 修改 butler.ts — 传递用户配置**

修改 `packages/core/src/agent/butler.ts` 中创建 Agent 的两处（约第 91 行和第 111 行）：

```ts
// 改前（第 96 行）
sandbox: { enabled: false, filesystem: "workspace-only", network: true },

// 改后
sandbox: (params.sandbox as any) || { enabled: false, filesystem: "isolated", network: true },
```

```ts
// 改前（第 115 行）
sandbox: { enabled: false, filesystem: "workspace-only", network: true },

// 改后
sandbox: (params.sandbox as any) || { enabled: false, filesystem: "isolated", network: true },
```

- [ ] **Step 3: 修改 ws-server.ts — create_agent 读取前端配置**

修改 `packages/core/src/api/ws-server.ts` 中 `create_agent` case（约第 367 行）：

```ts
// 改前
sandbox: { enabled: false, filesystem: "workspace-only", network: true },

// 改后（从 payload 读取）
sandbox: (msg.payload as any).sandbox || { enabled: false, filesystem: "isolated", network: true },
```

同样修改写入 config.json 的位置（约第 383 行）：

```ts
// 改前
sandbox: { enabled: false, filesystem: "workspace-only", network: true },

// 改后
sandbox: (msg.payload as any).sandbox || { enabled: false, filesystem: "isolated", network: true },
```

- [ ] **Step 4: 修改 runtime.ts — 保持兼容**

修改 `packages/core/src/runtime.ts` 中所有硬编码的 sandbox 配置（约第 104、221、494 行）：

将所有 `filesystem: "workspace-only"` 改为 `filesystem: "isolated"`。

- [ ] **Step 5: 运行全量测试**

```bash
cd D:/agent-codes/cobeing && npx vitest run
```

预期：所有测试通过

- [ ] **Step 6: 提交**

```bash
git add packages/core/src/agent/butler.ts packages/core/src/api/ws-server.ts packages/core/src/runtime.ts
git commit -m "fix(sandbox): agents inherit sandbox config from parent/frontend, not hardcoded"
```

---

## Task 11: 群组挂载集成

**Files:**
- Modify: `packages/core/src/group/group.ts`
- Modify: `packages/core/src/api/ws-server.ts`

- [ ] **Step 1: 修改 group.ts — addMember 时挂载群组目录**

修改 `packages/core/src/group/group.ts` 的 `addMember` 方法：

在文件顶部添加 import：

```ts
import path from "node:path";
```

修改 `addMember` 方法（约第 221 行），在成员添加后挂载群组目录：

```ts
addMember(agentId: string): void {
  if (!this.config.members.includes(agentId)) {
    this.config.members.push(agentId);

    // 挂载群组 workspace 到 agent 的沙箱
    this.mountGroupForAgent(agentId);

    // 硬编码激发 BOOTSTRAP：在群组上下文中注入 BOOTSTRAP 内容
    // ... 保持现有代码不变 ...
  }
}
```

添加新方法：

```ts
/** 将群组 workspace 挂载到 agent 的沙箱容器 */
private async mountGroupForAgent(agentId: string): Promise<void> {
  try {
    const agent = this.registry.get(agentId);
    const sandboxRunner = (agent as any)?.sandboxRunner;
    if (sandboxRunner) {
      const groupDir = path.join(this._dataRoot, "groups", this.config.id);
      await sandboxRunner.addMount(groupDir, `/workspace/groups/${this.config.id}`);
    }
  } catch (err: any) {
    console.warn(`Failed to mount group ${this.config.id} for agent ${agentId}: ${err.message}`);
  }
}

/** 从 agent 的沙箱容器卸载群组 workspace */
private async unmountGroupForAgent(agentId: string): Promise<void> {
  try {
    const agent = this.registry.get(agentId);
    const sandboxRunner = (agent as any)?.sandboxRunner;
    if (sandboxRunner) {
      await sandboxRunner.removeMount(`/workspace/groups/${this.config.id}`);
    }
  } catch (err: any) {
    console.warn(`Failed to unmount group ${this.config.id} for agent ${agentId}: ${err.message}`);
  }
}
```

- [ ] **Step 2: 修改群组创建 — 初始成员也挂载**

修改 `packages/core/src/group/group.ts` 的构造函数，在初始化成员时挂载：

在构造函数末尾（约第 71 行 `this.workspace.initialize(...)` 之后）添加：

```ts
// 为初始成员挂载群组目录
for (const memberId of config.members) {
  this.mountGroupForAgent(memberId);
}
```

- [ ] **Step 3: 修改 ws-server.ts — add_to_group 触发挂载**

`ws-server.ts` 中 `add_to_group` case 调用 `addGroup.addMember(addAId)`，已在 group.ts 中处理挂载。无需额外修改。

- [ ] **Step 4: 提交**

```bash
git add packages/core/src/group/group.ts
git commit -m "feat(sandbox): mount group workspace to agent sandbox on join"
```

---

## Task 12: 前端配置 UI 扩展

**Files:**
- Modify: `gui-v2/src/components/agent/AgentConfigTab.tsx:88-89,129`
- Modify: `gui-v2/src/components/agent/CreateAgentDialog.tsx:101-102`

- [ ] **Step 1: 修改 AgentConfigTab — 添加资源配置**

修改 `gui-v2/src/components/agent/AgentConfigTab.tsx`：

在 state 声明处（约第 88 行）添加资源状态：

```ts
// 改前
const [sandboxEnabled, setSandboxEnabled] = useState(false);
const [networkEnabled, setNetworkEnabled] = useState(true);

// 改后
const [sandboxEnabled, setSandboxEnabled] = useState(false);
const [networkEnabled, setNetworkEnabled] = useState(true);
const [memoryLimit, setMemoryLimit] = useState("512m");
const [cpuLimit, setCpuLimit] = useState(1);
const [commandTimeout, setCommandTimeout] = useState(30);
```

修改 `handleSave` 中的 sandbox 配置（约第 129 行）：

```ts
// 改前
sandbox: { enabled: sandboxEnabled, filesystem: "workspace-only", network: networkEnabled },

// 改后
sandbox: {
  enabled: sandboxEnabled,
  filesystem: "isolated",
  network: networkEnabled,
  resources: {
    memory: memoryLimit,
    cpus: cpuLimit,
    timeout: commandTimeout,
  },
},
```

修改沙箱配置区域的 UI（约第 203 行），在现有 Switch 后添加资源配置：

```tsx
<div className="rounded-xl bg-elevated" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
  <div className="flex items-center justify-between">
    <span className="text-sm text-txt">Docker 沙箱</span>
    <Switch checked={sandboxEnabled} onCheckedChange={(v) => { setSandboxEnabled(v); setSaved(false); }} />
  </div>
  {sandboxEnabled && (
    <>
      <div className="flex items-center justify-between">
        <span className="text-sm text-txt">网络访问</span>
        <Switch checked={networkEnabled} onCheckedChange={(v) => { setNetworkEnabled(v); setSaved(false); }} />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="text-xs text-txt-sub mb-1 block">内存限制</label>
          <select value={memoryLimit} onChange={(e) => { setMemoryLimit(e.target.value); setSaved(false); }}
            className="w-full h-8 px-2 rounded-lg bg-input border border-bdr text-sm text-txt">
            <option value="256m">256MB</option>
            <option value="512m">512MB</option>
            <option value="1g">1GB</option>
            <option value="2g">2GB</option>
            <option value="4g">4GB</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-txt-sub mb-1 block">CPU 核数</label>
          <select value={cpuLimit} onChange={(e) => { setCpuLimit(Number(e.target.value)); setSaved(false); }}
            className="w-full h-8 px-2 rounded-lg bg-input border border-bdr text-sm text-txt">
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={4}>4</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-txt-sub mb-1 block">超时(秒)</label>
          <input type="number" value={commandTimeout} min={5} max={300}
            onChange={(e) => { setCommandTimeout(Number(e.target.value)); setSaved(false); }}
            className="w-full h-8 px-2 rounded-lg bg-input border border-bdr text-sm text-txt" />
        </div>
      </div>
    </>
  )}
  {!sandboxEnabled && (
    <div className="flex items-center justify-between">
      <span className="text-sm text-txt">网络访问</span>
      <Switch checked={networkEnabled} onCheckedChange={(v) => { setNetworkEnabled(v); setSaved(false); }} />
    </div>
  )}
</div>
```

- [ ] **Step 2: 修改 CreateAgentDialog — 同样添加资源配置**

修改 `gui-v2/src/components/agent/CreateAgentDialog.tsx`：

添加 state（约第 101 行）：

```ts
const [memoryLimit, setMemoryLimit] = useState("512m");
const [cpuLimit, setCpuLimit] = useState(1);
const [commandTimeout, setCommandTimeout] = useState(30);
```

在创建 Agent 的 payload 中添加资源配置（找到 `sandbox` 字段传递处）：

```ts
sandbox: {
  enabled: sandboxEnabled,
  filesystem: "isolated",
  network: networkEnabled,
  resources: {
    memory: memoryLimit,
    cpus: cpuLimit,
    timeout: commandTimeout,
  },
},
```

在沙箱 Switch 后添加与 AgentConfigTab 相同的资源配置 UI。

- [ ] **Step 3: 构建前端确认无报错**

```bash
cd D:/agent-codes/cobeing/gui-v2 && npx tsc --noEmit
```

预期：无错误

- [ ] **Step 4: 提交**

```bash
git add gui-v2/src/components/agent/AgentConfigTab.tsx gui-v2/src/components/agent/CreateAgentDialog.tsx
git commit -m "feat(sandbox): add resource config UI (memory, CPU, timeout) to agent settings"
```

---

## Task 13: ConversationLoop 传递 sandboxConfig

**Files:**
- Modify: `packages/core/src/conversation/conversation-loop.ts`

- [ ] **Step 1: 修改 ConversationLoop 配置**

在 `packages/core/src/conversation/conversation-loop.ts` 的配置接口中添加字段：

```ts
// 在 ConversationLoopConfig 接口中添加
sandboxConfig?: import("@cobeing/shared").SandboxConfig;
sandboxRunner?: import("@cobeing/shared").SandboxRunner;
```

在 `executeToolCalls` 方法中（使用 `workingDir` 的地方），更新 `ToolExecutor.execute()` 调用：

```ts
// conversation-loop.ts 中调用 toolExecutor.execute 时，workingDir 已正确传递
// ToolExecutor 内部已使用自身的 sandboxConfig/sandboxRunner
// 因此 conversation-loop.ts 无需额外修改 — sandbox 配置在 ToolExecutor 构造时已注入
```

确认：由于 Task 7 中 ToolExecutor 已在构造时接收 sandboxConfig/sandboxRunner，ConversationLoop 传递 workingDir 即可，无需修改。

- [ ] **Step 2: 提交（如无修改则跳过）**

无需修改，跳过此步骤。

---

## Task 14: 全量验证

- [ ] **Step 1: 运行全量测试**

```bash
cd D:/agent-codes/cobeing && npx vitest run
```

预期：所有测试通过

- [ ] **Step 2: TypeScript 编译检查**

```bash
cd D:/agent-codes/cobeing/packages/core && npx tsc --noEmit
cd D:/agent-codes/cobeing/packages/shared && npx tsc --noEmit
```

预期：无错误

- [ ] **Step 3: 构建验证**

```bash
cd D:/agent-codes/cobeing && pnpm build
```

预期：构建成功

- [ ] **Step 4: 更新 STRUCTURE.md**

如果 `STRUCTURE.md` 中列出了 `tools/sandbox.ts`，更新为新的 `tools/sandbox/` 目录结构。

- [ ] **Step 5: 最终提交**

```bash
git add -A
git commit -m "chore: update STRUCTURE.md for sandbox directory restructure"
```

---

## Summary

| Task | 内容 | 新建/修改/删除 |
|------|------|---------------|
| 1 | Dockerfile + 构建脚本 | 2 新建 |
| 2 | SandboxConfig 类型扩展 | 2 修改 |
| 3 | 多运行时检测器 | 2 新建 |
| 4 | ContainerPool 容器池 | 2 新建 |
| 5 | DockerSandbox 主类 | 1 新建 |
| 6 | Barrel 导出 + 删除旧文件 | 1 新建 + 1 删除 |
| 7 | ToolExecutor 修复 | 2 修改 |
| 8 | bash.ts 重构 | 1 修改 |
| 9 | Agent 集成 | 1 修改 |
| 10 | 子 Agent 沙箱继承 | 3 修改 |
| 11 | 群组挂载集成 | 1 修改 |
| 12 | 前端配置 UI | 2 修改 |
| 13 | ConversationLoop | 无需修改 |
| 14 | 全量验证 | 1 修改 |
