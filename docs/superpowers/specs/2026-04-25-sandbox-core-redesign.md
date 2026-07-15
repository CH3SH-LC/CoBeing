# 沙箱核心功能重设计

> 日期：2026-04-25
> 状态：设计完成，待实现
> 范围：第一期 — 核心修复与基础增强

---

## 1. 问题陈述

CoBeing 的沙箱功能存在以下核心问题：

1. **执行器硬编码沙箱关闭** — `executor.ts:48` 写死 `sandbox: { enabled: false }`，工具执行永远不走沙箱
2. **DockerSandbox 类未被使用** — `sandbox.ts` 中的 `DockerSandbox` 类没有被任何地方引用，bash.ts 自己实现了类似的 docker 执行逻辑
3. **无 Dockerfile** — 项目中没有 `cobeing-sandbox` 镜像的构建文件
4. **文件系统隔离未实现** — `SandboxConfig.filesystem` 字段定义了但没有被代码使用，所有 Agent 共享宿主目录
5. **子 Agent 硬编码沙箱关闭** — `butler.ts`、`ws-server.ts`、`spawner.ts` 创建 Agent 时全部写死 `sandbox: { enabled: false }`
6. **无容器复用** — 每次命令都 `--rm` 创建销毁容器，冷启动开销大
7. **无流式输出** — 大输出完全阻塞直到命令结束
8. **前端 UI 极简** — 只有 Docker 沙箱开关和网络开关，无资源配置

## 2. 架构设计

### 2.1 整体架构

```
ToolExecutor (从 AgentConfig.sandbox 读取配置)
  │
  ▼
bash.ts / web-fetch.ts (检查 context.sandbox.enabled → 委托执行)
  │
  ▼
DockerSandbox (singleton per Agent，内嵌 ContainerPool)
  ├─ ContainerPool: Agent 级长驻容器管理
  ├─ 流式输出: stdout/stderr 实时回调
  ├─ 资源限制: memory/cpu 配置
  ├─ 文件挂载: Agent 目录 + 群组目录
  └─ 多运行时: 根据扩展名选择 python/node/go
  │
  ▼
Docker Engine
  └─ cobeing-sandbox:latest 镜像
```

### 2.2 核心原则

- `DockerSandbox` 是沙箱操作的**唯一入口**，各工具通过它执行命令
- 每个 Agent 持有一个 `DockerSandbox` 实例，容器在 Agent 生命周期内复用
- 配置从 `AgentConfig.sandbox` 读取，不再硬编码

## 3. 组件设计

### 3.1 DockerSandbox 类

文件：`packages/core/src/tools/sandbox/docker-sandbox.ts`

```ts
class DockerSandbox {
  private pool: ContainerPool;

  constructor(agentId: string, config: SandboxConfig, agentDir: string);

  /** 执行命令（阻塞，返回完整输出） */
  async run(command: string, opts?: ExecOptions): Promise<ExecResult>;

  /** 执行命令（流式，通过回调实时返回输出） */
  async runStream(command: string, opts: StreamExecOptions): Promise<ExecResult>;

  /** 执行文件（自动检测运行时） */
  async runFile(filePath: string, opts?: ExecOptions): Promise<ExecResult>;

  /** 追加挂载目录（群组加入时调用） */
  async addMount(hostPath: string, containerPath: string): Promise<void>;

  /** 移除挂载（群组退出时调用） */
  async removeMount(containerPath: string): Promise<void>;

  /** 销毁容器（Agent 销毁时调用） */
  async destroy(): Promise<void>;

  /** 获取沙箱状态 */
  getStatus(): SandboxStatus;
}

interface ExecOptions {
  timeout?: number;
  cwd?: string;
  env?: Record<string, string>;
}

interface StreamExecOptions extends ExecOptions {
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface SandboxStatus {
  containerId: string | null;
  running: boolean;
  uptime: number;
  memoryUsage?: number;
  cpuUsage?: number;
}
```

### 3.2 ContainerPool 类

文件：`packages/core/src/tools/sandbox/container-pool.ts`

```ts
class ContainerPool {
  private container: Container | null = null;

  constructor(
    private agentId: string,
    private image: string,
    private config: ContainerConfig,
  );

  /** 获取或创建容器 */
  async acquire(): Promise<Container>;

  /** 在容器内执行命令 */
  async exec(command: string, opts: ExecOptions): Promise<ExecResult>;

  /** 流式执行 */
  async execStream(command: string, opts: StreamExecOptions): Promise<ExecResult>;

  /** 释放（不销毁，保持运行） */
  release(): void;

  /** 销毁容器 */
  async destroy(): Promise<void>;

  /** 健康检查 */
  async healthCheck(): Promise<boolean>;
}

interface ContainerConfig {
  memory: string;      // "512m"
  cpus: number;        // 1
  network: boolean;
  bindings: string[];  // ["hostPath:containerPath[:ro]"]
  timeout: number;     // 默认命令超时 30s
}

interface Container {
  id: string;
  status: "running" | "stopped" | "creating";
  createdAt: number;
}
```

### 3.3 多运行时检测

文件：`packages/core/src/tools/sandbox/runtime-detector.ts`

```ts
const RUNTIME_MAP: Record<string, string> = {
  ".py": "python3",
  ".js": "node",
  ".ts": "npx tsx",
  ".go": "go run",
  ".sh": "bash",
  ".rb": "ruby",
  ".rs": "rust-script",  // 需要预装 rust-script
};

function detectRuntime(filePath: string): string | null;
function buildRunCommand(filePath: string): string;
```

### 3.4 执行器修复

文件：`packages/core/src/tools/executor.ts`

修改 `ToolExecutor.execute()` 方法：

```ts
// 改前（硬编码）
sandbox: { enabled: false, filesystem: "workspace-only", network: true }

// 改后（从配置读取）
sandbox: agentSandboxConfig  // 由 Agent 构造时传入
```

`ToolExecutor` 构造函数新增 `sandboxConfig` 参数，或通过 `AgentConfig` 传入。

### 3.5 代码去重

**删除**：
- `packages/core/src/tools/sandbox.ts`（旧 DockerSandbox 类）
- `packages/core/src/tools/bash.ts` 中的 `executeInSandbox()` 函数

**新建**：
- `packages/core/src/tools/sandbox/docker-sandbox.ts`
- `packages/core/src/tools/sandbox/container-pool.ts`
- `packages/core/src/tools/sandbox/runtime-detector.ts`
- `packages/core/src/tools/sandbox/index.ts`（统一导出）

**修改**：
- `packages/core/src/tools/bash.ts` — 沙箱模式委托给 `context.sandboxRunner`
- `packages/core/src/tools/executor.ts` — 读取配置而非硬编码

### 3.6 ToolContext 扩展

```ts
interface ToolContext {
  agentId: string;
  sessionId: string;
  workingDir: string;
  sandbox: SandboxConfig;
  sandboxRunner?: DockerSandbox;  // 新增：沙箱执行器实例
  permissions: PermissionPolicy;
  callDepth?: number;
}
```

### 3.7 SandboxConfig 扩展

```ts
interface SandboxConfig {
  enabled: boolean;
  filesystem: "isolated" | "host";  // 简化为两个值
  network: boolean;
  bindings?: string[];
  // 新增
  resources?: {
    memory?: string;    // 默认 "512m"
    cpus?: number;      // 默认 1
    timeout?: number;   // 默认 30s
  };
  image?: string;       // 默认 "cobeing-sandbox:latest"
}
```

## 4. 文件系统隔离

### 4.1 挂载规则

- Agent workspace = `data/agents/{agentId}/`（不额外加子目录）
- 群组 workspace = `data/groups/{groupId}/`
- 容器内 `/workspace` → Agent 自身目录
- 容器内 `/workspace/groups/{groupId}` → 群组目录（加入时挂载）

### 4.2 挂载时机

1. Agent 启动沙箱 → `dockerSandbox = new DockerSandbox(agentId, config, agentDir)`，自动挂载 `data/agents/{id}/` → `/workspace`
2. Agent 加入群组 → `dockerSandbox.addMount(groupDir, "/workspace/groups/{groupId}")`
3. Agent 退出群组 → `dockerSandbox.removeMount("/workspace/groups/{groupId}")`
4. Agent 销毁 → `dockerSandbox.destroy()`

### 4.3 实现方式

`addMount` 需要重建容器（Docker 不支持运行时添加挂载），或使用符号链接。推荐重建容器：

```ts
async addMount(hostPath: string, containerPath: string): Promise<void> {
  this.config.bindings.push(`${hostPath}:${containerPath}`);
  await this.pool.recreate();  // 停止旧容器，用新配置创建
}
```

## 5. Dockerfile

文件：`cobeing/sandbox/Dockerfile`

```dockerfile
FROM node:20-bookworm

# Python
RUN apt-get update && apt-get install -y python3 python3-pip && rm -rf /var/lib/apt/lists/*

# Go
RUN wget -q https://go.dev/dl/go1.22.4.linux-amd64.tar.gz && \
    tar -C /usr/local -xzf go1.22.4.linux-amd64.tar.gz && \
    rm go1.22.4.linux-amd64.tar.gz
ENV PATH=$PATH:/usr/local/go/bin

# 常用工具
RUN apt-get update && apt-get install -y git curl jq make && rm -rf /var/lib/apt/lists/*

# 非 root 用户
RUN useradd -m -u 1000 cobeing
USER cobeing
WORKDIR /workspace

CMD ["bash"]
```

构建脚本：`scripts/build-sandbox.sh`

```bash
#!/bin/bash
docker build -t cobeing-sandbox:latest cobeing/sandbox/
```

## 6. 子 Agent 沙箱继承

修改以下位置，从父 Agent 配置继承 sandbox：

- `packages/core/src/agent/spawner.ts` — `subConfig.sandbox = this.parentConfig.sandbox`
- `packages/core/src/agent/butler.ts` — 创建 Agent 时从用户传入的参数或 butler 自身配置继承
- `packages/core/src/api/ws-server.ts` — `create_agent` 和 `update_agent` 命令使用前端传入的 sandbox 配置

## 7. 涉及文件清单

| 操作 | 文件 |
|------|------|
| 新建 | `packages/core/src/tools/sandbox/docker-sandbox.ts` |
| 新建 | `packages/core/src/tools/sandbox/container-pool.ts` |
| 新建 | `packages/core/src/tools/sandbox/runtime-detector.ts` |
| 新建 | `packages/core/src/tools/sandbox/index.ts` |
| 新建 | `cobeing/sandbox/Dockerfile` |
| 新建 | `scripts/build-sandbox.sh` |
| 修改 | `packages/core/src/tools/executor.ts` — 读取配置 |
| 修改 | `packages/core/src/tools/bash.ts` — 删除内联沙箱，委托执行 |
| 修改 | `packages/core/src/tools/web-fetch.ts` — 无变化（已正确） |
| 修改 | `packages/shared/src/types.ts` — SandboxConfig 扩展 |
| 修改 | `packages/core/src/config/schema.ts` — AgentSelfConfig.sandbox 扩展 |
| 修改 | `packages/core/src/agent/spawner.ts` — 继承父配置 |
| 修改 | `packages/core/src/agent/butler.ts` — 传递沙箱配置 |
| 修改 | `packages/core/src/api/ws-server.ts` — 读取前端配置 |
| 修改 | `packages/core/src/runtime.ts` — Agent 创建时传递沙箱 |
| 删除 | `packages/core/src/tools/sandbox.ts`（旧版，功能迁移后删除） |

## 8. 错误处理

### 8.1 Docker 不可用

`sandbox.enabled=true` 但 Docker 未安装或未运行时：
- `DockerSandbox` 构造时检测 Docker 可用性（`docker info`）
- 不可用时抛出明确错误：`"沙箱启用但 Docker 不可用：{reason}"`
- 前端显示警告，建议关闭沙箱或安装 Docker

### 8.2 镜像不存在

`cobeing-sandbox:latest` 镜像未构建时：
- `ContainerPool.acquire()` 时检测镜像存在性（`docker image inspect`）
- 不存在时自动尝试构建（如果 Dockerfile 存在）
- 构建失败时提示用户运行 `scripts/build-sandbox.sh`

### 8.3 容器异常

- 容器 OOM → 捕获退出码 137，提示增加 memory 配置
- 容器超时 → SIGKILL 后重建容器
- 容器意外退出 → `healthCheck()` 检测后自动重建

## 9. 不在本期范围

以下功能属于第二期增强，不在本期实现：

- 网络白名单域名（当前只有全开/全关）
- 前端沙箱配置 UI 增强（资源限制、挂载目录配置）
- 沙箱状态监控面板（运行中容器列表、资源占用）
- 安全加固（seccomp/apparmor profile、特权操作禁止）
- 磁盘限制
- 自定义镜像选择 UI
