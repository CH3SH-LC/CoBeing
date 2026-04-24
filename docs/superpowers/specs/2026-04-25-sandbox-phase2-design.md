# 沙箱第二期功能设计

> 日期：2026-04-25
> 状态：设计完成，待实现
> 范围：第二期 — 高级功能增强

---

## 1. 问题陈述

沙箱核心功能（第一期）已完成，包括 DockerSandbox、ContainerPool、文件系统隔离、流式输出等。本期需要增强以下 6 个功能：

1. **网络白名单域名** — 从全开/全关升级到域名级别控制
2. **前端沙箱配置 UI 增强** — 资源限制、挂载目录配置
3. **沙箱状态监控面板** — 运行中容器列表、资源占用
4. **安全加固** — 禁止特权操作、只读根文件系统
5. **磁盘限制** — 容器磁盘配额
6. **自定义镜像选择 UI** — 预设镜像模板 + 自定义输入

## 2. 架构方案

采用**渐进增强方案**，在现有 DockerSandbox 基础上逐步扩展：

- 网络白名单：Docker 自定义网络 + iptables 规则
- 安全加固：Docker 原生标志组合
- 磁盘限制：Docker `--storage-opt size=X`
- 监控：`docker stats` API 定期轮询
- 镜像模板：预构建 3 个镜像（base, python, full）
- 挂载配置：结构化 mount 对象 + 前端文件选择器

## 3. 组件设计

### 3.1 网络白名单域名

#### 类型定义

```typescript
// packages/shared/src/types.ts

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
```

#### SandboxConfig 修改

```typescript
export interface SandboxConfig {
  enabled: boolean;
  filesystem: "isolated" | "host";
  network: NetworkConfig;  // 改前: boolean, 改后: NetworkConfig
  bindings?: string[];
  resources?: SandboxResources;
  image?: string;
  security?: SecurityConfig;  // 新增
}
```

#### 预设域名包

```typescript
const PRESET_DOMAIN_GROUPS: DomainGroup[] = [
  {
    id: "dev-tools",
    name: "开发工具",
    domains: ["github.com", "gitlab.com", "bitbucket.org"]
  },
  {
    id: "package-managers",
    name: "包管理器",
    domains: ["registry.npmjs.org", "pypi.org", "rubygems.org", "proxy.golang.org"]
  },
  {
    id: "documentation",
    name: "文档站点",
    domains: ["docs.python.org", "developer.mozilla.org", "stackoverflow.com"]
  }
];
```

#### 实现方式

1. **Docker 网络配置**：
   - `mode: "none"` → `--network=none`
   - `mode: "all"` → 默认 bridge 网络
   - `mode: "whitelist"` → 自定义网络 + iptables OUTPUT 规则

2. **iptables 规则生成**：
   ```bash
   # 创建自定义网络
   docker network create sandbox-{agentId}

   # 容器启动后添加规则
   iptables -I DOCKER-USER -d {domain} -j ACCEPT
   iptables -I DOCKER-USER -j DROP
   ```

3. **域名解析**：使用 `--dns` 指定 DNS 服务器

### 3.2 安全加固

#### 类型定义

```typescript
export interface SecurityConfig {
  enabled: boolean;           // 总开关
  noNewPrivileges: boolean;   // 禁止提升权限
  readOnlyRootfs: boolean;    // 只读根文件系统
  dropAllCapabilities: boolean; // 丢弃所有 capabilities
}
```

#### Docker 标志组合

当 `security.enabled = true` 时，添加以下 Docker 标志：

```bash
docker create \
  --security-opt=no-new-privileges:true \
  --read-only \
  --cap-drop=ALL \
  --tmpfs /tmp:rw,noexec,nosuid \
  --tmpfs /var/tmp:rw,noexec,nosuid \
  ...
```

#### 临时文件系统

由于 `--read-only` 会阻止写入，需要添加可写的 tmpfs：

- `/tmp` — 临时文件
- `/var/tmp` — 持久临时文件
- `/workspace` — 工作目录（通过 volume mount，不受 read-only 影响）

### 3.3 磁盘限制

#### 类型定义

```typescript
export interface SandboxResources {
  memory?: string;    // 如 "512m", "1g"
  cpus?: number;      // 如 1, 2
  timeout?: number;   // 秒
  disk?: string;      // 新增：如 "1g", "2g"
}
```

#### Docker 实现

使用 Docker 的 `--storage-opt` 标志：

```bash
docker create \
  --storage-opt size=1G \
  ...
```

**前提条件**：
- Docker daemon 使用 overlay2 存储驱动
- Docker daemon 配置 `--storage-opt size` 支持

**降级方案**：
- 如果 Docker 不支持 `--storage-opt`，在容器内使用 `du` 监控磁盘使用
- 超限时记录警告日志，但不强制限制

### 3.4 自定义镜像选择

#### 预设镜像模板

1. **cobeing-sandbox:base** — 基础镜像
   - Node.js 20
   - git, curl, jq, make
   - 非 root 用户

2. **cobeing-sandbox:python** — Python 开发镜像
   - 包含 base 所有内容
   - Python 3.11 + pip + venv
   - 常用 Python 工具（black, pytest, mypy）

3. **cobeing-sandbox:full** — 完整开发镜像
   - 包含 python 所有内容
   - Go 1.22
   - Ruby
   - 更多开发工具

#### Dockerfile 设计

```dockerfile
# cobeing/sandbox/Dockerfile.base
FROM node:20-bookworm
RUN apt-get update && apt-get install -y git curl jq make && rm -rf /var/lib/apt/lists/*
RUN useradd -m -u 1000 cobeing && mkdir -p /workspace && chown cobeing:cobeing /workspace
USER cobeing
WORKDIR /workspace
CMD ["bash"]

# cobeing/sandbox/Dockerfile.python
FROM cobeing-sandbox:base
RUN apt-get update && apt-get install -y python3 python3-pip python3-venv && rm -rf /var/lib/apt/lists/*
RUN pip3 install --user black pytest mypy

# cobeing/sandbox/Dockerfile.full
FROM cobeing-sandbox:python
RUN wget -q https://go.dev/dl/go1.22.4.linux-amd64.tar.gz && \
    tar -C /usr/local -xzf go1.22.4.linux-amd64.tar.gz && \
    rm go1.22.4.linux-amd64.tar.gz
ENV PATH=$PATH:/usr/local/go/bin
RUN apt-get update && apt-get install -y ruby && rm -rf /var/lib/apt/lists/*
```

#### 构建脚本

更新 `scripts/build-sandbox.sh` 构建所有镜像：

```bash
#!/bin/bash
set -e
docker build -t cobeing-sandbox:base -f cobeing/sandbox/Dockerfile.base cobeing/sandbox/
docker build -t cobeing-sandbox:python -f cobeing/sandbox/Dockerfile.python cobeing/sandbox/
docker build -t cobeing-sandbox:full -f cobeing/sandbox/Dockerfile.full cobeing/sandbox/
```

### 3.5 沙箱状态监控

#### 后端 API

新增 WS 命令：

- `get_sandbox_status`：返回所有 Agent 的沙箱状态
- `sandbox_action`：执行停止/重启/启动/删除操作

#### 数据结构

```typescript
interface SandboxStatusInfo {
  agentId: string;
  agentName: string;
  containerId: string | null;
  running: boolean;
  uptime: number;           // 毫秒
  memoryUsage: number;      // 字节
  memoryLimit: number;      // 字节
  cpuPercent: number;       // 0-100
  diskUsage?: number;       // 字节
  diskLimit?: number;       // 字节
}
```

#### 前端组件

新建 `gui-v2/src/components/sandbox/SandboxMonitor.tsx`：

- 显示在设置页面或独立标签页
- 手动刷新按钮触发 `get_sandbox_status`
- 显示容器列表、资源占用、操作按钮

### 3.6 前端配置 UI 增强

#### AgentConfigTab 增强

在沙箱配置区域添加：

1. **网络模式选择**（替换现有网络开关）
   - 全开 / 白名单 / 全关 三选一
   - 白名单模式下显示域名管理区域

2. **域名管理**（白名单模式时显示）
   - 域名列表（可增删）
   - 域名包选择（预设包 + 自定义包）

3. **挂载目录配置**
   - 挂载列表表格（主机路径、容器路径、只读开关）
   - 添加挂载按钮（打开文件选择器）
   - 删除挂载按钮

4. **磁盘限制**
   - 磁盘配额选择（128MB / 256MB / 512MB / 1GB / 2GB）

5. **安全加固开关**
   - 启用/禁用安全加固（默认启用）

6. **自定义镜像选择**
   - 预设镜像下拉（base, python, full）
   - 支持手动输入自定义镜像名

## 4. 文件变更清单

| 操作 | 文件 |
|------|------|
| 修改 | `packages/shared/src/types.ts` — NetworkConfig, SecurityConfig, SandboxResources 扩展 |
| 修改 | `packages/core/src/tools/sandbox/container-pool.ts` — 网络/安全/磁盘 Docker 标志 |
| 修改 | `packages/core/src/tools/sandbox/docker-sandbox.ts` — 传递新配置 |
| 修改 | `packages/core/src/api/ws-server.ts` — 新增 get_sandbox_status, sandbox_action 命令 |
| 修改 | `gui-v2/src/components/agent/AgentConfigTab.tsx` — UI 增强 |
| 修改 | `gui-v2/src/components/agent/CreateAgentDialog.tsx` — UI 增强 |
| 新建 | `gui-v2/src/components/sandbox/SandboxMonitor.tsx` — 监控面板组件 |
| 新建 | `cobeing/sandbox/Dockerfile.base` — 基础镜像 |
| 新建 | `cobeing/sandbox/Dockerfile.python` — Python 镜像 |
| 新建 | `cobeing/sandbox/Dockerfile.full` — 完整镜像 |
| 修改 | `scripts/build-sandbox.sh` — 构建所有镜像 |
| 修改 | `packages/core/src/config/schema.ts` — SandboxConfig 扩展 |

## 5. 测试计划

### 后端测试

- 网络白名单：测试 iptables 规则生成
- 安全加固：测试 Docker 标志组合
- 磁盘限制：测试 `--storage-opt` 参数
- 监控 API：测试 `get_sandbox_status` 响应

### 前端测试

- 网络模式切换：测试 UI 状态变化
- 域名管理：测试增删域名
- 挂载配置：测试添加/删除挂载
- 监控面板：测试数据展示

### 集成测试

- 创建带白名单的 Agent，验证网络访问
- 创建带安全加固的 Agent，验证权限限制
- 创建带磁盘限制的 Agent，验证配额生效

## 6. 不在本期范围

- seccomp/apparmor profile（高级安全功能）
- 网络流量监控和日志
- 容器内进程监控
- 镜像自动更新机制
