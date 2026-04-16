# Phase 2: Tool System + Permissions + Sandbox 设计

> 日期：2026-04-14
> 状态：已批准

## 概述

为 MyAgents 添加工具系统，让 Agent 能通过 LLM 工具调用执行操作（文件读写、bash 命令、网络请求、Agent 间通信）。包含权限系统和 Docker 沙箱。

## 架构：集中式 ToolRegistry

```
Agent
  ├── ToolRegistry（注册已启用的工具）
  ├── ToolExecutor（统一执行入口）
  │   ├── PermissionEnforcer（配置驱动的权限检查）
  │   └── DockerSandbox（仅 bash 使用）
  └── ConversationLoop（工具调用循环）
```

---

## 1. Tool 接口

新增到 `packages/shared/src/types.ts`：

```typescript
export interface Tool {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;  // JSON Schema
  execute(params: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;
}

export interface ToolContext {
  agentId: string;
  sessionId: string;
  workingDir: string;
  sandbox: SandboxConfig;
  permissions: PermissionPolicy;
}

// ToolResult 已存在于 types.ts，保持不变
// ToolDefinition 已存在于 types.ts，保持不变
```

## 2. ToolRegistry

路径：`packages/core/src/tools/registry.ts`

```typescript
export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void;
  get(name: string): Tool | undefined;
  has(name: string): boolean;
  listDefinitions(): ToolDefinition[];   // 给 LLM 的 tools 参数
  listAll(): Tool[];
  unregister(name: string): void;
}
```

- Agent 构造时根据配置创建 ToolRegistry，注册 `tools.enabled` 中列出的工具
- `listDefinitions()` 返回的工具列表传给 Provider 的 `chat()` 方法

## 3. PermissionEnforcer

路径：`packages/core/src/tools/permission.ts`

配置驱动的权限检查，不硬编码工具-权限映射。

### 配置结构（JSON 格式）

```json
{
  "tools": {
    "defaultPermission": "workspace-write",
    "enabled": ["bash", "read-file", "write-file", "edit-file", "glob", "grep", "web-fetch", "agent-message"],
    "permissions": {
      "bash": {
        "workspace-write": "allow",
        "read-only": "deny"
      },
      "write-file": {
        "read-only": "deny",
        "workspace-write": "allow"
      },
      "agent-message": {
        "workspace-write": "allow",
        "maxLoopDepth": 2
      }
    }
  }
}
```

### 检查逻辑

```typescript
export class PermissionEnforcer {
  constructor(
    private policy: PermissionPolicy,     // Agent 级别的 permissions 配置
    private toolConfig: ToolsConfig,      // Agent 级别的 tools 配置
    private workingDir: string
  ) {}

  check(toolName: string, params: Record<string, unknown>): PermissionResult {
    const mode = this.policy.mode;

    // full-access: 全部允许
    if (mode === 'full-access') return { allowed: true };

    // 查工具级映射
    const toolPerm = this.toolConfig.permissions[toolName];
    const verdict = toolPerm?.[mode];
    if (verdict === 'deny') return { allowed: false, reason: `工具 ${toolName} 在 ${mode} 模式下被拒绝` };

    // ask 模式：deny 列表优先 → allow 列表 → 默认拒绝
    if (mode === 'ask') {
      if (this.policy.deny?.includes(toolName)) return { allowed: false, reason: '在 deny 列表中' };
      if (this.policy.allow?.includes(toolName)) return { allowed: true };
      return { allowed: false, reason: '未在 allow 列表中' };
    }

    // workspace-write + 写操作：路径检查
    if (mode === 'workspace-write' && isWriteTool(toolName)) {
      const targetPath = extractPath(params);
      if (targetPath && !isWithinWorkingDir(targetPath, this.workingDir)) {
        return { allowed: false, reason: `路径 ${targetPath} 超出工作目录 ${this.workingDir}` };
      }
    }

    return { allowed: true };
  }
}
```

**每个 Agent 独立配置权限**，不同 Agent 可有不同的 tool/permission 设置。

## 4. ToolExecutor

路径：`packages/core/src/tools/executor.ts`

```typescript
export class ToolExecutor {
  constructor(
    private registry: ToolRegistry,
    private permission: PermissionEnforcer,
    private sandbox?: DockerSandbox,
    private events?: EventEmitter<CoreEvents>
  ) {}

  async execute(toolCall: ToolCall, context: ToolContext): Promise<ToolResult> {
    // 1. 查找工具
    const tool = this.registry.get(toolCall.function.name);
    if (!tool) return errorResult(toolCall.id, `未知工具: ${toolCall.function.name}`);

    // 2. 权限检查
    const params = JSON.parse(toolCall.function.arguments);
    const permResult = this.permission.check(tool.name, params);
    if (!permResult.allowed) {
      this.events?.emit('tool:denied', { agentId: context.agentId, toolName: tool.name, reason: permResult.reason! });
      return errorResult(toolCall.id, `权限不足: ${permResult.reason}`);
    }

    // 3. 执行（bash 走沙箱，其他直接执行）
    this.events?.emit('tool:call', { agentId: context.agentId, toolName: tool.name, params });
    const result = await tool.execute(params, context);
    this.events?.emit('tool:result', { agentId: context.agentId, toolName: tool.name, result: result.content, isError: result.isError });
    return result;
  }
}
```

## 5. DockerSandbox

路径：`packages/core/src/tools/sandbox.ts`

仅 bash 工具使用，其他工具在主机执行但受路径检查限制。

### SandboxConfig 扩展

```typescript
export interface SandboxConfig {
  enabled: boolean;
  filesystem: "off" | "workspace-only" | "allowlist";
  network: boolean;
  allowPaths?: string[];
  blockPaths?: string[];
  bindings?: string[];  // 额外挂载，格式 "hostPath:containerPath[:ro]"
}
```

### 执行逻辑

```
enabled: true → 默认挂载 workingDir:/workspace
  + bindings 中的额外目录
  filesystem: workspace-only → 仅 workspace + bindings
  filesystem: allowlist      → workspace + allowPaths + bindings
  network: false             → --network=none
  资源限制: --memory=512m --cpus=1
```

### Docker 命令示例

```bash
docker run --rm \
  -v /workspace:/workspace \
  -v /data/models:/models:ro \
  --network=none \
  --memory=512m --cpus=1 \
  myagents-sandbox \
  bash -c "用户命令"
```

### 沙箱镜像

基于 Alpine，预装 git、curl、python3、node。提供 Dockerfile 在 `docker/sandbox.Dockerfile`，用户构建一次。

## 6. 对话循环集成

### 新流程

```
用户消息 → ConversationLoop.run() → LLM →
  ├─ 文本回复 → 结束
  └─ tool_calls → 循环 {
       ToolExecutor.execute(call) → ToolResult
       → appendToolResult → LLM →
         ├─ 文本回复 → 结束
         └─ 更多 tool_calls → 继续
     }
```

### 修改点

- `ConversationLoop.run()` 改为循环模式，处理 tool_calls 后自动继续 LLM 调用
- 新增 `maxToolRounds` 配置（默认 10），防止无限循环
- `ToolDefinition[]` 从 ToolRegistry 获取，传给 Provider

### 新增事件

```typescript
"tool:call": { agentId: string; toolName: string; params: unknown };
"tool:result": { agentId: string; toolName: string; result: string; isError: boolean };
"tool:denied": { agentId: string; toolName: string; reason: string };
```

## 7. 内置工具（8 个）

### bash

```typescript
{
  name: "bash",
  description: "执行 bash 命令",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "要执行的命令" },
      timeout: { type: "number", description: "超时秒数，默认 30" }
    },
    required: ["command"]
  }
}
```
- sandbox.enabled=true → DockerSandbox.run(command, timeout)
- sandbox.enabled=false → 主机执行（child_process.exec）
- 超时后 kill 进程

### read-file

```typescript
{
  name: "read-file",
  description: "读取文件内容",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "文件路径" },
      offset: { type: "number", description: "起始行号（从 0 开始）" },
      limit: { type: "number", description: "读取行数" }
    },
    required: ["path"]
  }
}
```

### write-file

```typescript
{
  name: "write-file",
  description: "写入文件（覆盖或创建）",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "文件路径" },
      content: { type: "string", description: "文件内容" }
    },
    required: ["path", "content"]
  }
}
```

### edit-file

```typescript
{
  name: "edit-file",
  description: "编辑文件（字符串替换）",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "文件路径" },
      old_string: { type: "string", description: "要替换的文本" },
      new_string: { type: "string", description: "替换后的文本" }
    },
    required: ["path", "old_string", "new_string"]
  }
}
```
- old_string 必须在文件中唯一匹配，否则报错

### glob

```typescript
{
  name: "glob",
  description: "按模式搜索文件",
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "glob 模式，如 **/*.ts" },
      path: { type: "string", description: "搜索目录" }
    },
    required: ["pattern"]
  }
}
```

### grep

```typescript
{
  name: "grep",
  description: "搜索文件内容（正则）",
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "正则表达式" },
      path: { type: "string", description: "搜索目录" },
      include: { type: "string", description: "文件名模式，如 *.ts" }
    },
    required: ["pattern"]
  }
}
```

### web-fetch

```typescript
{
  name: "web-fetch",
  description: "获取网页内容",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "URL 地址" },
      method: { type: "string", enum: ["GET", "POST"], default: "GET" },
      headers: { type: "object", description: "请求头" },
      body: { type: "string", description: "请求体" }
    },
    required: ["url"]
  }
}
```
- 受 sandbox.network 控制，network=false 时拒绝

### agent-message

```typescript
{
  name: "agent-message",
  description: "向其他 Agent 发送消息并获取回复",
  parameters: {
    type: "object",
    properties: {
      target: { type: "string", description: "目标，格式 agentId:groupId" },
      message: { type: "string", description: "发送内容" },
      timeout: { type: "number", description: "超时秒数，默认 60" }
    },
    required: ["target", "message"]
  }
}
```
- 持有 AgentRegistry 只读引用
- 循环检测：同一 (callerAgentId, targetAgentId, groupId) 出现 2 次时拒绝（maxLoopDepth 可配置，默认 2）
- 超时保护

## 8. 配置文件扩展

每个 Agent 独立配置工具和权限。配置文件使用 JSON 格式（`config/default.json`）：

```json
{
  "agents": [
    {
      "name": "coder",
      "role": "编程助手",
      "provider": "deepseek",
      "model": "deepseek-chat",
      "permissions": {
        "mode": "workspace-write",
        "allow": [],
        "deny": []
      },
      "tools": {
        "defaultPermission": "workspace-write",
        "enabled": ["bash", "read-file", "write-file", "edit-file", "glob", "grep", "web-fetch", "agent-message"],
        "permissions": {
          "bash": { "workspace-write": "allow" },
          "write-file": { "workspace-write": "allow" },
          "edit-file": { "workspace-write": "allow" },
          "agent-message": { "workspace-write": "allow", "maxLoopDepth": 2 }
        }
      },
      "sandbox": {
        "enabled": true,
        "filesystem": "workspace-only",
        "network": true,
        "bindings": ["/data/models:/models:ro"]
      }
    },
    {
      "name": "reader",
      "role": "阅读助手",
      "provider": "deepseek",
      "model": "deepseek-chat",
      "permissions": {
        "mode": "read-only",
        "allow": ["read-file", "glob", "grep"],
        "deny": ["bash"]
      },
      "tools": {
        "defaultPermission": "read-only",
        "enabled": ["read-file", "glob", "grep", "web-fetch"],
        "permissions": {
          "bash": { "read-only": "deny" }
        }
      },
      "sandbox": {
        "enabled": false,
        "filesystem": "workspace-only",
        "network": true
      }
    }
  ]
}
```

## 9. 新增文件结构

```
packages/core/src/tools/
├── types.ts              # Tool 接口、ToolContext、ToolsConfig 类型
├── registry.ts           # ToolRegistry 类
├── executor.ts           # ToolExecutor 类
├── permission.ts         # PermissionEnforcer 类
├── sandbox.ts            # DockerSandbox 类
└── builtin/
    ├── bash.ts           # BashTool
    ├── read-file.ts      # ReadFileTool
    ├── write-file.ts     # WriteFileTool
    ├── edit-file.ts      # EditFileTool
    ├── glob.ts           # GlobTool
    ├── grep.ts           # GrepTool
    ├── web-fetch.ts      # WebFetchTool
    └── agent-message.ts  # AgentMessageTool

docker/
└── sandbox.Dockerfile    # 沙箱 Docker 镜像
```

修改的现有文件：
- `packages/shared/src/types.ts` — 新增 Tool、ToolContext、ToolsConfig，更新 SandboxConfig（bindings）
- `packages/shared/src/events.ts` — 新增 tool:call、tool:result、tool:denied 事件
- `packages/core/src/conversation/loop.ts` — 工具调用循环逻辑
- `packages/core/src/agent/agent.ts` — 持有 ToolRegistry/ToolExecutor
- `packages/core/src/config/loader.ts` — 解析新配置字段
- `config/default.yaml` → 改为 `config/default.json` — 配置文件从 YAML 迁移到 JSON 格式

## 10. 测试策略

- 每个 Tool 类单元测试（mock 文件系统/子进程/网络）
- PermissionEnforcer 单元测试（各权限模式 × 各工具）
- ToolExecutor 集成测试（权限拒绝/允许 → 执行/跳过）
- DockerSandbox 集成测试（需要 Docker 环境，标记为 optional）
- ConversationLoop 工具循环测试（mock Provider 返回 tool_calls）
- 端到端测试：Agent.run() → LLM 返回工具调用 → 执行 → 回复
