# Phase 4: Multi-Agent + 群组 + 管家 设计

> 日期：2026-04-15
> 状态：待批准

## 概述

让多个 Agent 协同工作：AgentRegistry 管理所有 Agent 实例，GroupManager 编排群组对话，ButlerAgent 作为管家动态创建 Agent 和群组，agent-message 工具实现 Agent 间直接通信。

## 架构

```
MyAgentsRuntime（顶层运行时）
  ├── AgentRegistry — 所有 Agent 的注册中心
  ├── GroupManager  — 群组生命周期管理
  │   └── Group[]   — 群组实例
  │       ├── members: Agent[]
  │       ├── protocol: round-robin | free-form | moderated
  │       └── history: GroupMessage[]
  ├── ButlerAgent   — 管家 Agent（特权，可创建/销毁 Agent 和群组）
  └── CoreWSServer  — GUI 接口
```

## 1. AgentRegistry

路径：`packages/core/src/agent/registry.ts`

全局 Agent 注册中心。所有 Agent（包括动态创建的）必须注册。

```typescript
export class AgentRegistry {
  private agents = new Map<string, Agent>();

  register(agent: Agent): void;
  unregister(agentId: string): void;
  get(agentId: string): Agent | undefined;
  list(): Agent[];
  findByChannel(channelId: string): Agent[];
}
```

**关键设计：**
- register 时检查 ID 唯一性
- 提供只读访问给工具（agent-message 需要通过 registry 找到目标 Agent）
- 以回调或 getter 方式暴露给 ToolContext，避免循环依赖

## 2. GroupManager + Group

### GroupConfig 扩展

在 `packages/shared/src/types.ts` 扩展：

```typescript
export interface GroupConfig {
  id: string;
  name: string;
  members: string[];      // agent IDs
  protocol: GroupProtocol;
  moderator?: string;     // agent ID（moderated 模式的主持人）
  maxRounds?: number;     // 最大轮数，默认 10
  topic?: string;         // 群组讨论主题
}
```

### Group 类

路径：`packages/core/src/group/group.ts`

```typescript
export class Group {
  readonly id: string;
  readonly config: GroupConfig;
  private members: Agent[];           // 通过 AgentRegistry 解析
  private history: GroupMessage[] = [];
  private events: EventEmitter;

  constructor(config: GroupConfig, registry: AgentRegistry, events?: EventEmitter);

  /** 运行群组对话 */
  async run(topic: string): Promise<GroupMessage[]>;

  /** 向群组发送消息（来自外部/channel） */
  async injectMessage(fromAgentId: string, content: string): Promise<void>;

  /** 获取群组历史 */
  getHistory(): GroupMessage[];

  /** 添加/移除成员 */
  addMember(agentId: string): void;
  removeMember(agentId: string): void;
}
```

### 群组协议

#### round-robin（轮流发言）

```
topic → Agent[0] 回复 → Agent[1] 回复 → ... → Agent[N] 回复 → 主持人总结（可选）
```

每个 Agent 收到的话题包含之前所有成员的回复。固定顺序，每轮所有成员各发一次。

#### free-form（自由讨论）

```
topic → 广播给所有成员 → 任一 Agent 先回复 → 广播回复给其他 → 继续 N 轮
```

使用 LLM 判断"谁应该发言"。每轮选一个 Agent，选择依据：
1. 谁还没发过言优先
2. 如果都发过，选择与话题最相关的

简化实现：按顺序轮流，但允许跳过（Agent 可以选择不回复）。

#### moderated（主持人模式）

```
topic → Moderator 分配任务 → 成员回复 → Moderator 汇总 → 下一轮或结束
```

Moderator Agent 有特殊权限，决定每轮谁发言、何时结束。

**统一实现：** 三种协议共享同一个 `run()` 循环框架，区别在 `pickSpeaker()` 策略：

```typescript
abstract class GroupProtocol {
  abstract pickSpeaker(members: Agent[], history: GroupMessage[], round: number): Agent | null;
  abstract shouldContinue(history: GroupMessage[], round: number): boolean;
}

class RoundRobinProtocol extends GroupProtocol { ... }
class FreeFormProtocol extends GroupProtocol { ... }
class ModeratedProtocol extends GroupProtocol { ... }
```

### GroupManager

路径：`packages/core/src/group/manager.ts`

```typescript
export class GroupManager {
  private groups = new Map<string, Group>();
  private registry: AgentRegistry;

  constructor(registry: AgentRegistry, events?: EventEmitter);

  create(config: GroupConfig): Group;
  get(groupId: string): Group | undefined;
  list(): Group[];
  delete(groupId: string): void;
}
```

## 3. Agent 间通信 — agent-message 工具激活

路径：修改 `packages/core/src/tools/agent-message.ts`

Phase 4 激活 agent-message 工具。需要：

1. **AgentRegistry 只读引用** — 通过 ToolContext 传入
2. **循环检测** — 同一次对话中 A→B→A 最多出现 2 次（maxLoopDepth）
3. **超时保护** — 默认 60 秒

### 扩展 ToolContext

在 `packages/shared/src/types.ts`：

```typescript
export interface ToolContext {
  agentId: string;
  sessionId: string;
  workingDir: string;
  sandbox: SandboxConfig;
  permissions: PermissionPolicy;
  callDepth?: number;      // 新增：当前调用深度
}
```

### agent-message 执行流程

```
Agent A 调用 agent-message(target: "B", message: "...")
  → 检查 callDepth < maxLoopDepth (默认 2)
  → 从 AgentRegistry 找到 Agent B
  → Agent B.run(message, { callDepth: callDepth + 1 })
  → 返回 Agent B 的回复内容给 Agent A
```

## 4. ButlerAgent（管家）

路径：`packages/core/src/agent/butler.ts`

特殊的 Agent，拥有创建/销毁 Agent 和群组的特权。

```typescript
export class ButlerAgent extends Agent {
  private registry: AgentRegistry;
  private groupManager: GroupManager;

  constructor(config: AgentConfig, provider: LLMProvider, registry: AgentRegistry, groupManager: GroupManager);

  /** 创建新 Agent */
  createAgent(config: { name: string; role: string; systemPrompt?: string; tools?: string[] }): Agent;

  /** 创建群组 */
  createGroup(config: { name: string; members: string[]; protocol: GroupProtocol; topic?: string }): Group;

  /** 销毁 Agent */
  destroyAgent(agentId: string): void;

  /** 销毁群组 */
  destroyGroup(groupId: string): void;

  /** 列出所有 Agent 和群组状态 */
  getStatus(): { agents: AgentInfo[]; groups: GroupInfo[] };
}
```

### 管家工具（注册到 ButlerAgent 的 ToolRegistry）

```typescript
// 4 个管理工具
butler-create-agent: 创建新 Agent
butler-destroy-agent: 销毁 Agent
butler-create-group: 创建群组
butler-destroy-group: 销毁群组
butler-list: 列出所有 Agent 和群组
butler-run-group: 启动群组对话
```

### 管家行为

ButlerAgent 的 system prompt 包含管理指令模板：
```
你是 MyAgents 的管家。你可以：
- 创建新 Agent（指定名字、角色、工具）
- 创建 Agent 群组（指定成员、讨论协议）
- 启动群组讨论
- 查看所有 Agent 和群组状态

用户会通过自然语言告诉你需要什么，你调用合适的工具完成。
```

## 5. MyAgentsRuntime（顶层运行时）

路径：`packages/core/src/runtime.ts`

将所有组件组装在一起的顶层对象：

```typescript
export class MyAgentsRuntime {
  readonly registry: AgentRegistry;
  readonly groupManager: GroupManager;
  readonly wsServer: CoreWSServer;
  private butler: ButlerAgent;

  constructor(config: AppConfig);

  /** 初始化：创建 provider、agent、butler、MCP 连接 */
  async start(): Promise<void>;

  /** 关闭所有资源 */
  async stop(): Promise<void>;

  /** 通过管家处理用户请求 */
  async handleUserInput(input: string): Promise<string>;
}
```

## 6. 配置扩展

### config/default.yaml

```yaml
agents:
  - name: butler
    role: 管家
    systemPrompt: "你是 MyAgents 管家..."
    provider: deepseek
    model: deepseek-chat
    tools: [butler-create-agent, butler-destroy-agent, butler-create-group, butler-destroy-group, butler-list, butler-run-group]
    permissions:
      mode: full-access

groups: []
```

### AppConfig 扩展

```typescript
agents: AgentConfig[];     // 从单 agent 变为多 agent
groups: GroupConfig[];     // 预定义群组
```

**注意：** 现有 `agent` 单 Agent 配置保持兼容，运行时自动转为 `agents[0]`。

## 7. 新增文件结构

```
packages/core/src/
  agent/
    registry.ts        # AgentRegistry
    butler.ts          # ButlerAgent + 管家工具
    spawner.ts         # 已有 SubAgentSpawner（保留）
  group/
    group.ts           # Group 类
    manager.ts         # GroupManager
    protocol.ts        # GroupProtocol 抽象 + 三种实现
  runtime.ts           # MyAgentsRuntime 顶层组装
```

修改的文件：
- `packages/shared/src/types.ts` — ToolContext 增加 callDepth，GroupConfig 增加 topic/maxRounds
- `packages/core/src/tools/agent-message.ts` — 激活，使用 AgentRegistry
- `packages/core/src/config/schema.ts` — agents 数组 + groups
- `packages/core/src/agent/agent.ts` — 接受 AgentRegistry 引用
- `scripts/dev.ts` — 使用 Runtime 启动

## 8. 实现顺序

1. **types 扩展** — ToolContext.callDepth, GroupConfig 扩展
2. **AgentRegistry** — 注册/查找/列表
3. **GroupProtocol 抽象 + 三种实现** — pickSpeaker 策略
4. **Group 类** — 群组对话主循环
5. **GroupManager** — 创建/管理群组
6. **agent-message 激活** — 使用 AgentRegistry 实现真正的 Agent 间通信
7. **ButlerAgent + 管家工具** — 特权管理 Agent
8. **MyAgentsRuntime** — 顶层组装
9. **Config 迁移** — 单 agent → 多 agent 配置
10. **dev.ts 更新** — 使用 Runtime
11. **测试** — 各模块单元测试 + 集成测试

## 9. 核心交互流程

### 用户创建群组并讨论

```
用户: "创建一个三人讨论组，讨论 React vs Vue，用 round-robin"
  ↓
ButlerAgent 接收
  → butler-create-agent(coder, React 专家)
  → butler-create-agent(designer, Vue 专家)
  → butler-create-agent(judge, 技术评委)
  → butler-create-group(react-vs-vue, [coder, designer, judge], round-robin)
  → butler-run-group(react-vs-vue, "React vs Vue 哪个更好？")
  ↓
Group.run() 执行：
  Round 1: coder 回复 → designer 回复 → judge 回复
  Round 2: coder 回复 → designer 回复 → judge 回复
  ↓
返回完整讨论记录给用户
```

### Agent 间直接通信

```
Agent A 在处理任务时需要 B 的帮助
  → A 调用 agent-message(target: "B", message: "帮我分析这段代码")
  → B.run("帮我分析这段代码")
  → B 返回分析结果
  → A 继续处理自己的任务
```
