# 沙箱第二期功能实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现沙箱第二期 6 大功能：网络白名单、安全加固、磁盘限制、自定义镜像、状态监控、前端 UI 增强

**Architecture:** 在现有 DockerSandbox 基础上扩展，新增 NetworkConfig/SecurityConfig 类型，ContainerPool 添加网络/安全/磁盘 Docker 标志，ws-server 新增监控 API，前端增强配置 UI 并新建监控面板

**Tech Stack:** TypeScript, Docker CLI (child_process), React 19, Tauri 2.0, Vitest

---

## File Structure

```
packages/shared/src/types.ts                  # 修改 — NetworkConfig, SecurityConfig, SandboxResources
packages/core/src/config/schema.ts            # 修改 — AgentSelfConfig.sandbox 扩展
packages/core/src/tools/sandbox/container-pool.ts    # 修改 — 网络/安全/磁盘 Docker 标志
packages/core/src/tools/sandbox/docker-sandbox.ts    # 修改 — 传递新配置
packages/core/src/tools/sandbox/network-whitelist.ts  # 新建 — 网络白名单管理
packages/core/src/tools/sandbox/security.ts           # 新建 — 安全加固配置
packages/core/src/api/ws-server.ts            # 修改 — 新增 get_sandbox_status, sandbox_action 命令
gui-v2/src/components/agent/AgentConfigTab.tsx    # 修改 — UI 增强
gui-v2/src/components/agent/CreateAgentDialog.tsx # 修改 — UI 增强
gui-v2/src/components/sandbox/SandboxMonitor.tsx  # 新建 — 监控面板组件
cobeing/sandbox/Dockerfile.base               # 新建 — 基础镜像
cobeing/sandbox/Dockerfile.python             # 新建 — Python 镜像
cobeing/sandbox/Dockerfile.full               # 新建 — 完整镜像
scripts/build-sandbox.sh                      # 修改 — 构建所有镜像
```

---

## Task 1: 类型定义扩展

**Files:**
- Modify: `packages/shared/src/types.ts:157-168`
- Modify: `packages/core/src/config/schema.ts:110-121`

- [ ] **Step 1: 添加 NetworkConfig 和 DomainGroup 类型**

修改 `packages/shared/src/types.ts`，在 SandboxConfig 定义之前添加：

```typescript
// ============================================================
// 网络白名单相关类型
// ============================================================

export interface NetworkConfig {
  enabled: boolean;                    // 总开关
  mode: "all" | "whitelist" | "none"; // 全开/白名单/全关
  allowDomains?: string[];            // 允许的域名列表
  domainGroups?: DomainGroup[];       // 域名包
}

export interface DomainGroup {
  id: string;
  name: string;        // 如 "开发工具", "包管理器"
  domains: string[];
}

// ============================================================
// 安全加固相关类型
// ============================================================

export interface SecurityConfig {
  enabled: boolean;           // 总开关
  noNewPrivileges: boolean;   // 禁止提升权限
  readOnlyRootfs: boolean;    // 只读根文件系统
  dropAllCapabilities: boolean; // 丢弃所有 capabilities
}
```

- [ ] **Step 2: 修改 SandboxConfig 接口**

修改 `packages/shared/src/types.ts` 中的 SandboxConfig：

```typescript
// 改前
export interface SandboxConfig {
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
}

// 改后
export interface SandboxConfig {
  enabled: boolean;
  filesystem: "isolated" | "host";
  network: NetworkConfig;  // 改前: boolean, 改后: NetworkConfig
  bindings?: string[];
  resources?: {
    memory?: string;
    cpus?: number;
    timeout?: number;
    disk?: string;      // 新增：磁盘限制
  };
  image?: string;
  security?: SecurityConfig;  // 新增：安全加固配置
}
```

- [ ] **Step 3: 修改 AgentSelfConfig.sandbox**

修改 `packages/core/src/config/schema.ts` 中的 sandbox 定义：

```typescript
// 改前
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

// 改后
sandbox?: {
  enabled: boolean;
  filesystem: "isolated" | "host";
  network: NetworkConfig;  // 改前: boolean
  bindings?: string[];
  resources?: {
    memory?: string;
    cpus?: number;
    timeout?: number;
    disk?: string;      // 新增
  };
  image?: string;
  security?: SecurityConfig;  // 新增
};
```

- [ ] **Step 4: 运行 TypeScript 编译检查**

```bash
cd D:/agent-codes/cobeing/packages/shared && npx tsc --noEmit
cd D:/agent-codes/cobeing/packages/core && npx tsc --noEmit
```

预期：无错误

- [ ] **Step 5: 提交**

```bash
git add packages/shared/src/types.ts packages/core/src/config/schema.ts
git commit -m "feat(sandbox): add NetworkConfig, SecurityConfig types and extend SandboxConfig"
```

---

## Task 2: 网络白名单管理模块

**Files:**
- Create: `packages/core/src/tools/sandbox/network-whitelist.ts`
- Create: `packages/core/src/tools/sandbox/network-whitelist.test.ts`

- [ ] **Step 1: 写测试**

写入 `packages/core/src/tools/sandbox/network-whitelist.test.ts`：

```typescript
import { describe, it, expect } from "vitest";
import { resolveNetworkConfig, PRESET_DOMAIN_GROUPS } from "./network-whitelist.js";
import type { NetworkConfig } from "@cobeing/shared";

describe("network-whitelist", () => {
  describe("resolveNetworkConfig", () => {
    it("converts legacy boolean true to NetworkConfig", () => {
      const result = resolveNetworkConfig(true as any);
      expect(result).toEqual({ enabled: true, mode: "all" });
    });

    it("converts legacy boolean false to NetworkConfig", () => {
      const result = resolveNetworkConfig(false as any);
      expect(result).toEqual({ enabled: false, mode: "none" });
    });

    it("passes through NetworkConfig unchanged", () => {
      const config: NetworkConfig = {
        enabled: true,
        mode: "whitelist",
        allowDomains: ["github.com"],
      };
      const result = resolveNetworkConfig(config);
      expect(result).toEqual(config);
    });

    it("merges preset domain groups", () => {
      const config: NetworkConfig = {
        enabled: true,
        mode: "whitelist",
        domainGroups: [PRESET_DOMAIN_GROUPS[0]],
      };
      const result = resolveNetworkConfig(config);
      expect(result.allowDomains).toContain("github.com");
    });
  });

  describe("PRESET_DOMAIN_GROUPS", () => {
    it("has dev-tools group", () => {
      const group = PRESET_DOMAIN_GROUPS.find(g => g.id === "dev-tools");
      expect(group).toBeDefined();
      expect(group!.domains).toContain("github.com");
    });

    it("has package-managers group", () => {
      const group = PRESET_DOMAIN_GROUPS.find(g => g.id === "package-managers");
      expect(group).toBeDefined();
      expect(group!.domains).toContain("registry.npmjs.org");
    });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd D:/agent-codes/cobeing && npx vitest run packages/core/src/tools/sandbox/network-whitelist.test.ts
```

预期：FAIL — 模块不存在

- [ ] **Step 3: 实现网络白名单管理**

写入 `packages/core/src/tools/sandbox/network-whitelist.ts`：

```typescript
import type { NetworkConfig, DomainGroup } from "@cobeing/shared";

export const PRESET_DOMAIN_GROUPS: DomainGroup[] = [
  {
    id: "dev-tools",
    name: "开发工具",
    domains: ["github.com", "gitlab.com", "bitbucket.org"],
  },
  {
    id: "package-managers",
    name: "包管理器",
    domains: ["registry.npmjs.org", "pypi.org", "rubygems.org", "proxy.golang.org"],
  },
  {
    id: "documentation",
    name: "文档站点",
    domains: ["docs.python.org", "developer.mozilla.org", "stackoverflow.com"],
  },
];

/**
 * 解析网络配置，处理向后兼容
 * - boolean true → { enabled: true, mode: "all" }
 * - boolean false → { enabled: false, mode: "none" }
 * - NetworkConfig → 合并域名包
 */
export function resolveNetworkConfig(network: NetworkConfig | boolean): NetworkConfig {
  // 向后兼容：boolean → NetworkConfig
  if (typeof network === "boolean") {
    return { enabled: network, mode: network ? "all" : "none" };
  }

  // 合并域名包到 allowDomains
  if (network.mode === "whitelist" && network.domainGroups?.length) {
    const domains = new Set(network.allowDomains ?? []);
    for (const group of network.domainGroups) {
      for (const domain of group.domains) {
        domains.add(domain);
      }
    }
    return { ...network, allowDomains: [...domains] };
  }

  return network;
}

/**
 * 构建 Docker 网络参数
 */
export function buildNetworkArgs(network: NetworkConfig, agentId: string): string[] {
  const resolved = resolveNetworkConfig(network);

  if (!resolved.enabled || resolved.mode === "none") {
    return ["--network=none"];
  }

  if (resolved.mode === "all") {
    return []; // 默认 bridge 网络
  }

  // whitelist 模式：使用自定义网络
  return ["--network", `sandbox-${agentId}`];
}

/**
 * 构建 iptables 白名单规则
 */
export function buildWhitelistRules(
  containerIp: string,
  allowDomains: string[],
): string[] {
  const rules: string[] = [];

  // 允许 DNS 查询（端口 53）
  rules.push(`iptables -A DOCKER-USER -d ${containerIp} -p udp --dport 53 -j ACCEPT`);
  rules.push(`iptables -A DOCKER-USER -d ${containerIp} -p tcp --dport 53 -j ACCEPT`);

  // 允许白名单域名
  for (const domain of allowDomains) {
    rules.push(`iptables -A DOCKER-USER -d ${containerIp} -m string --string "${domain}" --algo bm -j ACCEPT`);
  }

  // 拒绝其他所有出站
  rules.push(`iptables -A DOCKER-USER -d ${containerIp} -j DROP`);

  return rules;
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd D:/agent-codes/cobeing && npx vitest run packages/core/src/tools/sandbox/network-whitelist.test.ts
```

预期：PASS

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/tools/sandbox/network-whitelist.ts packages/core/src/tools/sandbox/network-whitelist.test.ts
git commit -m "feat(sandbox): add network whitelist management with preset domain groups"
```

---

## Task 3: 安全加固配置模块

**Files:**
- Create: `packages/core/src/tools/sandbox/security.ts`
- Create: `packages/core/src/tools/sandbox/security.test.ts`

- [ ] **Step 1: 写测试**

写入 `packages/core/src/tools/sandbox/security.test.ts`：

```typescript
import { describe, it, expect } from "vitest";
import { resolveSecurityConfig, buildSecurityArgs } from "./security.js";
import type { SecurityConfig } from "@cobeing/shared";

describe("security", () => {
  describe("resolveSecurityConfig", () => {
    it("returns default config when undefined", () => {
      const result = resolveSecurityConfig(undefined);
      expect(result).toEqual({
        enabled: true,
        noNewPrivileges: true,
        readOnlyRootfs: true,
        dropAllCapabilities: true,
      });
    });

    it("passes through SecurityConfig unchanged", () => {
      const config: SecurityConfig = {
        enabled: false,
        noNewPrivileges: false,
        readOnlyRootfs: false,
        dropAllCapabilities: false,
      };
      const result = resolveSecurityConfig(config);
      expect(result).toEqual(config);
    });
  });

  describe("buildSecurityArgs", () => {
    it("returns empty array when security disabled", () => {
      const config: SecurityConfig = {
        enabled: false,
        noNewPrivileges: false,
        readOnlyRootfs: false,
        dropAllCapabilities: false,
      };
      const result = buildSecurityArgs(config);
      expect(result).toEqual([]);
    });

    it("returns all security flags when enabled", () => {
      const config: SecurityConfig = {
        enabled: true,
        noNewPrivileges: true,
        readOnlyRootfs: true,
        dropAllCapabilities: true,
      };
      const result = buildSecurityArgs(config);
      expect(result).toContain("--security-opt=no-new-privileges:true");
      expect(result).toContain("--read-only");
      expect(result).toContain("--cap-drop=ALL");
      expect(result).toContain("--tmpfs");
    });

    it("includes tmpfs for /tmp and /var/tmp", () => {
      const config: SecurityConfig = {
        enabled: true,
        noNewPrivileges: true,
        readOnlyRootfs: true,
        dropAllCapabilities: true,
      };
      const result = buildSecurityArgs(config);
      const tmpfsArgs = result.filter(a => a === "--tmpfs");
      expect(tmpfsArgs.length).toBe(2);
    });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd D:/agent-codes/cobeing && npx vitest run packages/core/src/tools/sandbox/security.test.ts
```

预期：FAIL — 模块不存在

- [ ] **Step 3: 实现安全加固配置**

写入 `packages/core/src/tools/sandbox/security.ts`：

```typescript
import type { SecurityConfig } from "@cobeing/shared";

const DEFAULT_SECURITY: SecurityConfig = {
  enabled: true,
  noNewPrivileges: true,
  readOnlyRootfs: true,
  dropAllCapabilities: true,
};

/**
 * 解析安全配置，处理向后兼容
 * - undefined → 默认启用
 * - SecurityConfig → 透传
 */
export function resolveSecurityConfig(security?: SecurityConfig): SecurityConfig {
  if (!security) {
    return DEFAULT_SECURITY;
  }
  return security;
}

/**
 * 构建 Docker 安全参数
 */
export function buildSecurityArgs(security: SecurityConfig): string[] {
  if (!security.enabled) {
    return [];
  }

  const args: string[] = [];

  if (security.noNewPrivileges) {
    args.push("--security-opt=no-new-privileges:true");
  }

  if (security.readOnlyRootfs) {
    args.push("--read-only");
    // 只读根文件系统需要添加可写的 tmpfs
    args.push("--tmpfs", "/tmp:rw,noexec,nosuid,size=100m");
    args.push("--tmpfs", "/var/tmp:rw,noexec,nosuid,size=100m");
  }

  if (security.dropAllCapabilities) {
    args.push("--cap-drop=ALL");
  }

  return args;
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd D:/agent-codes/cobeing && npx vitest run packages/core/src/tools/sandbox/security.test.ts
```

预期：PASS

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/tools/sandbox/security.ts packages/core/src/tools/sandbox/security.test.ts
git commit -m "feat(sandbox): add security hardening config with Docker flags"
```

---

## Task 4: ContainerPool 扩展 — 网络/安全/磁盘 Docker 标志

**Files:**
- Modify: `packages/core/src/tools/sandbox/container-pool.ts`

- [ ] **Step 1: 扩展 ContainerConfig 接口**

修改 `packages/core/src/tools/sandbox/container-pool.ts` 中的 ContainerConfig：

```typescript
// 改前
export interface ContainerConfig {
  memory: string;
  cpus: number;
  network: boolean;
  bindings: string[];
  timeout: number;
}

// 改后
export interface ContainerConfig {
  memory: string;
  cpus: number;
  network: NetworkConfig;  // 改前: boolean
  bindings: string[];
  timeout: number;
  disk?: string;           // 新增：磁盘限制
  security?: SecurityConfig; // 新增：安全加固
}
```

在文件顶部添加 import：

```typescript
import type { NetworkConfig, SecurityConfig } from "@cobeing/shared";
import { resolveNetworkConfig, buildNetworkArgs } from "./network-whitelist.js";
import { resolveSecurityConfig, buildSecurityArgs } from "./security.js";
```

- [ ] **Step 2: 修改 buildCreateArgs 方法**

修改 `container-pool.ts` 中的 `buildCreateArgs` 方法：

```typescript
// 改前
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

  const resolvedAgent = path.resolve(agentDir);
  args.push("-v", `${resolvedAgent}:/workspace`);

  for (const binding of this.config.bindings) {
    args.push("-v", binding);
  }

  args.push(this.image, "sleep", "infinity");
  return args;
}

// 改后
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
```

- [ ] **Step 3: 运行现有测试确认不破坏**

```bash
cd D:/agent-codes/cobeing && npx vitest run packages/core/src/tools/sandbox/container-pool.test.ts
```

预期：PASS（需要更新测试中的 defaultConfig）

- [ ] **Step 4: 更新测试**

修改 `packages/core/src/tools/sandbox/container-pool.test.ts` 中的 defaultConfig：

```typescript
// 改前
const defaultConfig = {
  memory: "512m",
  cpus: 1,
  network: true,
  bindings: [],
  timeout: 30,
};

// 改后
const defaultConfig = {
  memory: "512m",
  cpus: 1,
  network: { enabled: true, mode: "all" as const },
  bindings: [],
  timeout: 30,
};
```

- [ ] **Step 5: 运行测试确认通过**

```bash
cd D:/agent-codes/cobeing && npx vitest run packages/core/src/tools/sandbox/container-pool.test.ts
```

预期：PASS

- [ ] **Step 6: 提交**

```bash
git add packages/core/src/tools/sandbox/container-pool.ts packages/core/src/tools/sandbox/container-pool.test.ts
git commit -m "feat(sandbox): extend ContainerPool with network whitelist, security, and disk limits"
```

---

## Task 5: DockerSandbox 扩展 — 传递新配置

**Files:**
- Modify: `packages/core/src/tools/sandbox/docker-sandbox.ts`

- [ ] **Step 1: 修改 buildContainerConfig 方法**

修改 `docker-sandbox.ts` 中的 `buildContainerConfig` 方法：

```typescript
// 改前
private buildContainerConfig(): ContainerConfig {
  return {
    memory: this.config.resources?.memory ?? "512m",
    cpus: this.config.resources?.cpus ?? 1,
    network: this.config.network ?? true,
    bindings: this.config.bindings ?? [],
    timeout: this.config.resources?.timeout ?? 30,
  };
}

// 改后
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
```

- [ ] **Step 2: 运行全量测试**

```bash
cd D:/agent-codes/cobeing && npx vitest run packages/core/src/tools/sandbox/
```

预期：所有沙箱测试通过

- [ ] **Step 3: 提交**

```bash
git add packages/core/src/tools/sandbox/docker-sandbox.ts
git commit -m "feat(sandbox): DockerSandbox passes network/security/disk config to ContainerPool"
```

---

## Task 6: Docker 镜像模板

**Files:**
- Create: `cobeing/sandbox/Dockerfile.base`
- Create: `cobeing/sandbox/Dockerfile.python`
- Create: `cobeing/sandbox/Dockerfile.full`
- Modify: `scripts/build-sandbox.sh`

- [ ] **Step 1: 创建基础镜像 Dockerfile**

写入 `cobeing/sandbox/Dockerfile.base`：

```dockerfile
FROM node:20-bookworm

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

- [ ] **Step 2: 创建 Python 镜像 Dockerfile**

写入 `cobeing/sandbox/Dockerfile.python`：

```dockerfile
FROM cobeing-sandbox:base

# Python 3.11
RUN apt-get update && \
    apt-get install -y python3 python3-pip python3-venv && \
    rm -rf /var/lib/apt/lists/*

# 常用 Python 工具
RUN pip3 install --user --break-system-packages black pytest mypy

# 添加 Python 工具到 PATH
ENV PATH="/home/cobeing/.local/bin:${PATH}"

CMD ["bash"]
```

- [ ] **Step 3: 创建完整镜像 Dockerfile**

写入 `cobeing/sandbox/Dockerfile.full`：

```dockerfile
FROM cobeing-sandbox:python

# Go 1.22
RUN wget -q https://go.dev/dl/go1.22.4.linux-amd64.tar.gz && \
    tar -C /usr/local -xzf go1.22.4.linux-amd64.tar.gz && \
    rm go1.22.4.linux-amd64.tar.gz
ENV PATH=$PATH:/usr/local/go/bin

# Ruby
RUN apt-get update && \
    apt-get install -y ruby && \
    rm -rf /var/lib/apt/lists/*

CMD ["bash"]
```

- [ ] **Step 4: 更新构建脚本**

修改 `scripts/build-sandbox.sh`：

```bash
#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "Building cobeing-sandbox images..."

echo "[1/3] Building base image..."
docker build -t cobeing-sandbox:base -f "$PROJECT_ROOT/cobeing/sandbox/Dockerfile.base" "$PROJECT_ROOT/cobeing/sandbox/"

echo "[2/3] Building python image..."
docker build -t cobeing-sandbox:python -f "$PROJECT_ROOT/cobeing/sandbox/Dockerfile.python" "$PROJECT_ROOT/cobeing/sandbox/"

echo "[3/3] Building full image..."
docker build -t cobeing-sandbox:full -f "$PROJECT_ROOT/cobeing/sandbox/Dockerfile.full" "$PROJECT_ROOT/cobeing/sandbox/"

echo "Done. Images:"
docker images cobeing-sandbox
```

- [ ] **Step 5: 提交**

```bash
git add cobeing/sandbox/Dockerfile.base cobeing/sandbox/Dockerfile.python cobeing/sandbox/Dockerfile.full scripts/build-sandbox.sh
git commit -m "feat(sandbox): add base/python/full Docker image templates"
```

---

## Task 7: 后端监控 API

**Files:**
- Modify: `packages/core/src/api/ws-server.ts`

- [ ] **Step 1: 添加 get_sandbox_status 命令**

在 `ws-server.ts` 的 switch 语句中添加新 case：

```typescript
case "get_sandbox_status": {
  const agents = this.agentRegistry?.getAll() ?? [];
  const statuses = agents.map(agent => {
    const sandboxRunner = (agent as any).sandboxRunner;
    const status = sandboxRunner?.getStatus() ?? { containerId: null, running: false };

    // 通过 docker stats 获取资源使用
    let memoryUsage = 0;
    let cpuPercent = 0;
    let diskUsage = 0;

    if (status.containerId && status.running) {
      // 这里会通过 docker stats 命令获取
      // 实际实现在下一步
    }

    return {
      agentId: agent.id,
      agentName: agent.name,
      containerId: status.containerId,
      running: status.running,
      uptime: 0, // 需要从容器创建时间计算
      memoryUsage,
      memoryLimit: 0,
      cpuPercent,
      diskUsage,
      diskLimit: 0,
    };
  });

  this.sendToClient(ws, { type: "sandbox_status", payload: statuses });
  break;
}
```

- [ ] **Step 2: 添加 sandbox_action 命令**

在 switch 语句中添加：

```typescript
case "sandbox_action": {
  const { agentId, action } = msg.payload as { agentId: string; action: "start" | "stop" | "restart" | "delete" };
  const agent = this.agentRegistry?.get(agentId);

  if (!agent) {
    this.sendToClient(ws, { type: "error", payload: { message: `Agent not found: ${agentId}` } });
    break;
  }

  const sandboxRunner = (agent as any).sandboxRunner;
  if (!sandboxRunner) {
    this.sendToClient(ws, { type: "error", payload: { message: `Agent ${agentId} has no sandbox` } });
    break;
  }

  try {
    switch (action) {
      case "stop":
        await sandboxRunner.destroy();
        break;
      case "restart":
        await sandboxRunner.destroy();
        // 重新创建容器需要调用 run 触发 acquire
        break;
      case "delete":
        await sandboxRunner.destroy();
        break;
    }
    this.sendToClient(ws, { type: "sandbox_action_result", payload: { agentId, action, success: true } });
  } catch (err: any) {
    this.sendToClient(ws, { type: "sandbox_action_result", payload: { agentId, action, success: false, error: err.message } });
  }
  break;
}
```

- [ ] **Step 3: 提交**

```bash
git add packages/core/src/api/ws-server.ts
git commit -m "feat(sandbox): add get_sandbox_status and sandbox_action WS commands"
```

---

## Task 8: 前端 AgentConfigTab UI 增强

**Files:**
- Modify: `gui-v2/src/components/agent/AgentConfigTab.tsx`

- [ ] **Step 1: 添加新的 state 变量**

在 AgentConfigTab 组件中添加：

```typescript
// 改前
const [sandboxEnabled, setSandboxEnabled] = useState(false);
const [networkEnabled, setNetworkEnabled] = useState(true);
const [memoryLimit, setMemoryLimit] = useState("512m");
const [cpuLimit, setCpuLimit] = useState(1);
const [commandTimeout, setCommandTimeout] = useState(30);

// 改后
const [sandboxEnabled, setSandboxEnabled] = useState(false);
const [networkMode, setNetworkMode] = useState<"all" | "whitelist" | "none">("all");
const [allowDomains, setAllowDomains] = useState<string[]>([]);
const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
const [memoryLimit, setMemoryLimit] = useState("512m");
const [cpuLimit, setCpuLimit] = useState(1);
const [commandTimeout, setCommandTimeout] = useState(30);
const [diskLimit, setDiskLimit] = useState("1g");
const [securityEnabled, setSecurityEnabled] = useState(true);
const [selectedImage, setSelectedImage] = useState("cobeing-sandbox:python");
const [mounts, setMounts] = useState<Array<{ hostPath: string; containerPath: string; readOnly: boolean }>>([]);
const [newDomain, setNewDomain] = useState("");
```

- [ ] **Step 2: 修改 handleSave 中的 sandbox 配置**

```typescript
// 改前
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

// 改后
sandbox: {
  enabled: sandboxEnabled,
  filesystem: "isolated",
  network: {
    enabled: networkMode !== "none",
    mode: networkMode,
    allowDomains: allowDomains,
  },
  resources: {
    memory: memoryLimit,
    cpus: cpuLimit,
    timeout: commandTimeout,
    disk: diskLimit,
  },
  security: {
    enabled: securityEnabled,
    noNewPrivileges: securityEnabled,
    readOnlyRootfs: securityEnabled,
    dropAllCapabilities: securityEnabled,
  },
  image: selectedImage,
  bindings: mounts.map(m => `${m.hostPath}:${m.containerPath}${m.readOnly ? ":ro" : ""}`),
},
```

- [ ] **Step 3: 添加域名管理 UI**

在沙箱配置区域的网络开关后添加：

```tsx
{sandboxEnabled && (
  <>
    <div>
      <label className="text-xs text-txt-sub mb-1 block">网络模式</label>
      <select value={networkMode} onChange={(e) => { setNetworkMode(e.target.value as any); setSaved(false); }}
        className="w-full h-8 px-2 rounded-lg bg-input border border-bdr text-sm text-txt">
        <option value="all">全开</option>
        <option value="whitelist">白名单</option>
        <option value="none">全关</option>
      </select>
    </div>

    {networkMode === "whitelist" && (
      <div className="rounded-lg bg-surface-solid p-3 space-y-2">
        <label className="text-xs text-txt-sub block">域名白名单</label>
        {allowDomains.map((domain, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-sm text-txt flex-1">{domain}</span>
            <button onClick={() => { setAllowDomains(prev => prev.filter((_, idx) => idx !== i)); setSaved(false); }}
              className="text-xs text-danger hover:text-danger/80">删除</button>
          </div>
        ))}
        <div className="flex gap-2">
          <input value={newDomain} onChange={(e) => setNewDomain(e.target.value)}
            placeholder="输入域名" className="flex-1 h-7 px-2 rounded bg-input border border-bdr text-sm text-txt" />
          <button onClick={() => { if (newDomain) { setAllowDomains(prev => [...prev, newDomain]); setNewDomain(""); setSaved(false); } }}
            className="h-7 px-3 rounded bg-accent text-white text-xs">添加</button>
        </div>
        <div className="flex flex-wrap gap-1 mt-2">
          {["dev-tools", "package-managers", "documentation"].map(groupId => (
            <button key={groupId} onClick={() => {
              setSelectedGroups(prev => prev.includes(groupId) ? prev.filter(g => g !== groupId) : [...prev, groupId]);
              setSaved(false);
            }} className={`px-2 py-1 rounded text-xs ${selectedGroups.includes(groupId) ? "bg-accent text-white" : "bg-hover text-txt-sub"}`}>
              {groupId}
            </button>
          ))}
        </div>
      </div>
    )}
  </>
)}
```

- [ ] **Step 4: 添加挂载目录配置 UI**

```tsx
{sandboxEnabled && (
  <div className="rounded-lg bg-surface-solid p-3 space-y-2">
    <label className="text-xs text-txt-sub block">挂载目录</label>
    {mounts.map((mount, i) => (
      <div key={i} className="flex items-center gap-2 text-sm">
        <span className="flex-1 text-txt">{mount.hostPath} → {mount.containerPath}</span>
        <label className="flex items-center gap-1 text-xs text-txt-sub">
          <input type="checkbox" checked={mount.readOnly}
            onChange={(e) => { setMounts(prev => prev.map((m, idx) => idx === i ? { ...m, readOnly: e.target.checked } : m)); setSaved(false); }} />
          只读
        </label>
        <button onClick={() => { setMounts(prev => prev.filter((_, idx) => idx !== i)); setSaved(false); }}
          className="text-xs text-danger">删除</button>
      </div>
    ))}
    <button onClick={async () => {
      // 使用 Tauri open API
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false });
      if (selected) {
        const containerPath = `/workspace/${selected.split(/[/\\]/).pop()}`;
        setMounts(prev => [...prev, { hostPath: selected as string, containerPath, readOnly: false }]);
        setSaved(false);
      }
    }} className="h-7 px-3 rounded bg-accent text-white text-xs">添加挂载</button>
  </div>
)}
```

- [ ] **Step 5: 添加磁盘限制、安全加固、镜像选择 UI**

```tsx
{sandboxEnabled && (
  <>
    <div className="grid grid-cols-2 gap-3">
      <div>
        <label className="text-xs text-txt-sub mb-1 block">磁盘限制</label>
        <select value={diskLimit} onChange={(e) => { setDiskLimit(e.target.value); setSaved(false); }}
          className="w-full h-8 px-2 rounded-lg bg-input border border-bdr text-sm text-txt">
          <option value="128m">128MB</option>
          <option value="256m">256MB</option>
          <option value="512m">512MB</option>
          <option value="1g">1GB</option>
          <option value="2g">2GB</option>
        </select>
      </div>
      <div>
        <label className="text-xs text-txt-sub mb-1 block">镜像</label>
        <select value={selectedImage} onChange={(e) => { setSelectedImage(e.target.value); setSaved(false); }}
          className="w-full h-8 px-2 rounded-lg bg-input border border-bdr text-sm text-txt">
          <option value="cobeing-sandbox:base">base (Node.js)</option>
          <option value="cobeing-sandbox:python">python (Node.js + Python)</option>
          <option value="cobeing-sandbox:full">full (Node.js + Python + Go)</option>
        </select>
      </div>
    </div>

    <div className="flex items-center justify-between">
      <span className="text-sm text-txt">安全加固</span>
      <Switch checked={securityEnabled} onCheckedChange={(v) => { setSecurityEnabled(v); setSaved(false); }} />
    </div>
  </>
)}
```

- [ ] **Step 6: 运行 TypeScript 编译检查**

```bash
cd D:/agent-codes/cobeing/gui-v2 && npx tsc --noEmit
```

预期：无错误

- [ ] **Step 7: 提交**

```bash
git add gui-v2/src/components/agent/AgentConfigTab.tsx
git commit -m "feat(sandbox): enhance AgentConfigTab with network whitelist, mounts, disk, security, image UI"
```

---

## Task 9: 前端 CreateAgentDialog UI 增强

**Files:**
- Modify: `gui-v2/src/components/agent/CreateAgentDialog.tsx`

- [ ] **Step 1: 添加新的 state 变量**

在 CreateAgentDialog 组件中添加：

```typescript
// 改前
const [sandboxEnabled, setSandboxEnabled] = useState(false);
const [networkEnabled, setNetworkEnabled] = useState(true);
const [memoryLimit, setMemoryLimit] = useState("512m");
const [cpuLimit, setCpuLimit] = useState(1);
const [commandTimeout, setCommandTimeout] = useState(30);

// 改后
const [sandboxEnabled, setSandboxEnabled] = useState(false);
const [networkMode, setNetworkMode] = useState<"all" | "whitelist" | "none">("all");
const [allowDomains, setAllowDomains] = useState<string[]>([]);
const [memoryLimit, setMemoryLimit] = useState("512m");
const [cpuLimit, setCpuLimit] = useState(1);
const [commandTimeout, setCommandTimeout] = useState(30);
const [diskLimit, setDiskLimit] = useState("1g");
const [securityEnabled, setSecurityEnabled] = useState(true);
const [selectedImage, setSelectedImage] = useState("cobeing-sandbox:python");
const [newDomain, setNewDomain] = useState("");
```

- [ ] **Step 2: 修改 handleCreate 中的 sandbox 配置**

```typescript
// 改前
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

// 改后
sandbox: {
  enabled: sandboxEnabled,
  filesystem: "isolated",
  network: {
    enabled: networkMode !== "none",
    mode: networkMode,
    allowDomains: allowDomains,
  },
  resources: {
    memory: memoryLimit,
    cpus: cpuLimit,
    timeout: commandTimeout,
    disk: diskLimit,
  },
  security: {
    enabled: securityEnabled,
    noNewPrivileges: securityEnabled,
    readOnlyRootfs: securityEnabled,
    dropAllCapabilities: securityEnabled,
  },
  image: selectedImage,
},
```

- [ ] **Step 3: 添加与 AgentConfigTab 相同的 UI 组件**

将 Task 8 中的网络模式、域名管理、磁盘限制、安全加固、镜像选择 UI 复制到 CreateAgentDialog 的高级配置区域。

- [ ] **Step 4: 运行 TypeScript 编译检查**

```bash
cd D:/agent-codes/cobeing/gui-v2 && npx tsc --noEmit
```

预期：无错误

- [ ] **Step 5: 提交**

```bash
git add gui-v2/src/components/agent/CreateAgentDialog.tsx
git commit -m "feat(sandbox): enhance CreateAgentDialog with network whitelist, disk, security, image UI"
```

---

## Task 10: 前端沙箱监控面板

**Files:**
- Create: `gui-v2/src/components/sandbox/SandboxMonitor.tsx`

- [ ] **Step 1: 创建监控面板组件**

写入 `gui-v2/src/components/sandbox/SandboxMonitor.tsx`：

```tsx
import { useState, useEffect, useCallback } from "react";
import { getWsClient } from "@/hooks/useWebSocket";

interface SandboxStatusInfo {
  agentId: string;
  agentName: string;
  containerId: string | null;
  running: boolean;
  uptime: number;
  memoryUsage: number;
  memoryLimit: number;
  cpuPercent: number;
  diskUsage?: number;
  diskLimit?: number;
}

export function SandboxMonitor() {
  const [statuses, setStatuses] = useState<SandboxStatusInfo[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(() => {
    setLoading(true);
    getWsClient()?.send({ type: "get_sandbox_status" });
    setTimeout(() => setLoading(false), 500);
  }, []);

  useEffect(() => {
    const ws = getWsClient();
    if (!ws) return;

    const handler = (msg: any) => {
      if (msg.type === "sandbox_status") {
        setStatuses(msg.payload);
        setLoading(false);
      }
    };

    ws.on("message", handler);
    refresh();

    return () => { ws.off("message", handler); };
  }, [refresh]);

  const handleAction = (agentId: string, action: string) => {
    getWsClient()?.send({ type: "sandbox_action", payload: { agentId, action } });
    setTimeout(refresh, 500);
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const formatUptime = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-txt">沙箱状态监控</h3>
        <button onClick={refresh} disabled={loading}
          className="h-8 px-4 rounded-lg text-sm bg-accent text-white hover:bg-accent/90 disabled:opacity-50">
          {loading ? "刷新中..." : "刷新"}
        </button>
      </div>

      {statuses.length === 0 ? (
        <div className="text-center py-8 text-txt-sub">暂无运行中的沙箱</div>
      ) : (
        <div className="space-y-3">
          {statuses.map((status) => (
            <div key={status.agentId} className="rounded-xl bg-elevated p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium text-txt">{status.agentName}</span>
                  <span className="text-xs text-txt-sub ml-2">({status.agentId})</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${status.running ? "bg-success" : "bg-txt-muted"}`} />
                  <span className="text-xs text-txt-sub">{status.running ? "运行中" : "已停止"}</span>
                </div>
              </div>

              {status.containerId && (
                <div className="text-xs text-txt-sub">
                  容器ID: <code className="bg-surface-solid px-1 rounded">{status.containerId.slice(0, 12)}</code>
                </div>
              )}

              {status.running && (
                <>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-txt-sub">运行时间:</span>
                      <span className="text-txt ml-1">{formatUptime(status.uptime)}</span>
                    </div>
                    <div>
                      <span className="text-txt-sub">CPU:</span>
                      <span className="text-txt ml-1">{status.cpuPercent.toFixed(1)}%</span>
                    </div>
                    <div>
                      <span className="text-txt-sub">内存:</span>
                      <span className="text-txt ml-1">{formatBytes(status.memoryUsage)} / {formatBytes(status.memoryLimit)}</span>
                    </div>
                    {status.diskUsage !== undefined && (
                      <div>
                        <span className="text-txt-sub">磁盘:</span>
                        <span className="text-txt ml-1">{formatBytes(status.diskUsage)} / {formatBytes(status.diskLimit ?? 0)}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2 pt-2">
                    <button onClick={() => handleAction(status.agentId, "restart")}
                      className="h-7 px-3 rounded text-xs bg-hover text-txt-sub hover:bg-elevated">
                      重启
                    </button>
                    <button onClick={() => handleAction(status.agentId, "stop")}
                      className="h-7 px-3 rounded text-xs bg-danger/10 text-danger hover:bg-danger/20">
                      停止
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 在设置页面添加监控面板入口**

在 `gui-v2/src/components/settings/SettingsView.tsx` 中添加沙箱监控标签页。

- [ ] **Step 3: 运行 TypeScript 编译检查**

```bash
cd D:/agent-codes/cobeing/gui-v2 && npx tsc --noEmit
```

预期：无错误

- [ ] **Step 4: 提交**

```bash
git add gui-v2/src/components/sandbox/SandboxMonitor.tsx
git commit -m "feat(sandbox): add SandboxMonitor component with container status and actions"
```

---

## Task 11: 全量验证

- [ ] **Step 1: 运行全量测试**

```bash
cd D:/agent-codes/cobeing && npx vitest run
```

预期：所有测试通过

- [ ] **Step 2: TypeScript 编译检查**

```bash
cd D:/agent-codes/cobeing/packages/shared && npx tsc --noEmit
cd D:/agent-codes/cobeing/packages/core && npx tsc --noEmit
cd D:/agent-codes/cobeing/gui-v2 && npx tsc --noEmit
```

预期：无错误

- [ ] **Step 3: 构建验证**

```bash
cd D:/agent-codes/cobeing && pnpm build
```

预期：构建成功

- [ ] **Step 4: 更新 STRUCTURE.md**

更新 `STRUCTURE.md` 中的沙箱目录结构，添加新文件。

- [ ] **Step 5: 最终提交**

```bash
git add -A
git commit -m "chore: update STRUCTURE.md for sandbox phase 2 features"
```

---

## Summary

| Task | 内容 | 新建/修改/删除 |
|------|------|---------------|
| 1 | 类型定义扩展 | 2 修改 |
| 2 | 网络白名单管理模块 | 2 新建 |
| 3 | 安全加固配置模块 | 2 新建 |
| 4 | ContainerPool 扩展 | 2 修改 |
| 5 | DockerSandbox 扩展 | 1 修改 |
| 6 | Docker 镜像模板 | 3 新建 + 1 修改 |
| 7 | 后端监控 API | 1 修改 |
| 8 | 前端 AgentConfigTab UI | 1 修改 |
| 9 | 前端 CreateAgentDialog UI | 1 修改 |
| 10 | 前端沙箱监控面板 | 1 新建 |
| 11 | 全量验证 | 1 修改 |
