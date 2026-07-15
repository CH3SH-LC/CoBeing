# Phase 3: MCP + Skills + SubAgents 设计

> 日期：2026-04-15
> 状态：已批准

## 概述

为 MyAgents 添加 MCP 客户端支持（连接外部工具服务器）、技能系统（可复用的提示+工具模板）和子 Agent 生成能力。

## 架构

```
Agent
  ├── ToolRegistry（内置工具 + MCP 工具 + Skill 工具）
  ├── MCPManager
  │   ├── MCPClient[stdio] → 外部 MCP 服务器（如 filesystem、git、web）
  │   └── MCPClient[http]  → 远程 MCP 服务
  ├── SkillLoader → 从 skills/ 目录加载技能定义
  └── SubAgentSpawner → 动态创建子 Agent（继承工具+权限）
```

## 1. MCP Transport 层

### 基类：`packages/core/src/mcp/transport.ts`

```typescript
export interface MCPTransport {
  start(): Promise<void>;
  send(message: JSONRPCMessage): Promise<void>;
  onMessage(handler: (message: JSONRPCMessage) => void): void;
  close(): Promise<void>;
}
```

### StdioTransport — 启动子进程，stdin/stdout 交换 JSON-RPC

- 启动 `command args...` 子进程
- 每行一个 JSON-RPC 消息（newline-delimited）
- stderr 转发到日志

### HTTPTransport — Streamable HTTP

- POST JSON-RPC 到 endpoint URL
- 响应为 JSON 或 SSE 流
- 支持 MCP-Session-Id 和 MCP-Protocol-Version 头

## 2. MCP Client

### `packages/core/src/mcp/client.ts`

JSON-RPC 2.0 消息处理：
- 递增 ID 计数器
- pending requests Map（id → { resolve, reject, timer }）
- 请求超时（默认 30s）

生命周期：
```
connect() → send initialize → 验证版本+能力 → send initialized notification → 就绪
```

方法：
- `connect()` — 初始化握手
- `listTools()` → Tool[]
- `callTool(name, args)` → ToolResult
- `listResources()` → Resource[]
- `readResource(uri)` → ResourceContent
- `ping()` → boolean
- `close()` — 关闭连接

## 3. MCP Manager

### `packages/core/src/mcp/manager.ts`

管理多个 MCP 连接，将 MCP 工具桥接为 Tool 接口：

```typescript
export class MCPManager {
  private clients = new Map<string, MCPClient>();

  async connect(id: string, config: MCPServerConfig): Promise<void>;
  async disconnect(id: string): Promise<void>;
  getTools(): Tool[];  // 所有 MCP 服务器的工具，桥接为 Tool 接口
  close(): Promise<void>;
}
```

桥接：每个 MCP 工具包装为 Tool 接口对象，execute() 调用 client.callTool()。

### 配置

```yaml
mcpServers:
  filesystem:
    transport: stdio
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/path"]
  github:
    transport: http
    url: https://mcp.github.com/sse
    headers:
      Authorization: Bearer ${GITHUB_TOKEN}
```

## 4. Skill 系统

### `packages/core/src/skills/loader.ts`

技能定义文件放在 `skills/` 目录，每个是一个 YAML/JSON 文件：

```yaml
name: code-review
description: 代码审查技能
trigger: "当用户要求审查代码时"
tools: [read-file, glob, grep]
prompt: |
  你是一个代码审查专家。请按照以下步骤审查代码：
  1. 使用 glob 找到相关文件
  2. 使用 read-file 阅读代码
  3. 使用 grep 搜索相关模式
  4. 给出审查意见
parameters:
  - name: language
    description: 编程语言
    type: string
    default: auto-detect
```

SkillLoader：
- 扫描 skills/ 目录
- 每个技能注册为 Tool（name=`skill:{name}`）
- execute() 时将 prompt 注入 system prompt + 调用 LLM

## 5. SubAgent Spawner

### `packages/core/src/agent/spawner.ts`

```typescript
export class SubAgentSpawner {
  constructor(
    private parentAgent: Agent,
    private agentRegistry?: AgentRegistry,
  ) {}

  async spawn(config: {
    name: string;
    role: string;
    task: string;
    tools?: string[];
    parentContext?: boolean;  // 是否继承父 Agent 的对话上下文
  }): Promise<{ agentId: string; response: AgentResponse }>;
}
```

- 创建临时 Agent，使用相同的 Provider
- 可选择继承父 Agent 的工具集
- 执行完任务后可保留或销毁

## 6. 新增文件结构

```
packages/core/src/
  mcp/
    transport.ts       # MCPTransport 接口 + StdioTransport + HTTPTransport
    client.ts          # MCPClient（JSON-RPC + 生命周期）
    manager.ts         # MCPManager（多服务器管理 + 工具桥接）
    client.test.ts     # 测试
  skills/
    loader.ts          # SkillLoader
    loader.test.ts     # 测试
  agent/
    spawner.ts         # SubAgentSpawner
    spawner.test.ts    # 测试
skills/                # 技能定义目录
  code-review.yaml     # 示例技能
```

修改的文件：
- `packages/shared/src/types.ts` — MCP 相关类型
- `packages/core/src/agent/agent.ts` — 集成 MCPManager + SkillLoader
- `packages/core/src/config/schema.ts` — MCP 服务器配置
- `config/default.yaml` — MCP 服务器配置示例

## 7. 实现顺序

1. MCP types (shared)
2. Transport 层 (stdio + HTTP)
3. MCP Client (JSON-RPC + 生命周期)
4. MCP Manager (多服务器 + 工具桥接)
5. Skill Loader
6. SubAgent Spawner
7. 集成到 Agent + Config
