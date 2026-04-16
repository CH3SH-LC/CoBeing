# Channel-Group 绑定 + Group 角色模型设计

> 日期：2026-04-16

## 目标

建立 Channel（通讯平台）与 Group（多 Agent 讨论）之间的连接机制，使 Channel 用户能参与和管控 Group 讨论。同时重构 Group 角色模型，引入 user / owner / member 三种身份。

## 设计原则

- Channel 无自主性，仅作为远程文本收发工具
- Group 拥有完整角色和权限体系
- 静态配置（YAML）作为默认绑定，运行时可通过 Butler 动态调整
- 不改动 `channels/` 包和 `providers/` 包

---

## 1. Group 角色模型

### 角色

| 角色 | 身份 | 权限 |
|------|------|------|
| `user` | 人类用户 | 发言、创建/解散 Talk、添加/移除组员、终止讨论、分配任务 |
| `owner` | 群主 Agent | 调度组员、创建 Talk、总结讨论、执行 user 的指令 |
| `member` | 普通 Agent | 发言、参与 Talk |

### 类型定义

`GroupConfig` 新增字段：

```ts
interface GroupConfig {
  id: string;
  name: string;
  members: string[];      // 普通 Agent 组员 ID
  owner?: string;          // 群主 Agent ID（可选，未指定时由 Butler 充当）
  protocol: "round-robin" | "free-form" | "moderated";
  moderator?: string;
  maxRounds?: number;
}
```

新增 `group/roles.ts`：

```ts
type GroupRole = "user" | "owner" | "member";

function getRole(agentId: string, config: GroupConfig): GroupRole {
  if (agentId === "user") return "user";
  if (agentId === config.owner) return "owner";
  return "member";
}
```

### 权限检查

`GroupRole` 对应可执行操作的检查函数，用于 owner 工具和 user 指令的权限校验。Member 只能发言和参与 Talk，不能管理群组。

---

## 2. Channel 绑定模型

### 配置格式

Channel 配置新增 `bindTo` 字段：

```yaml
channels:
  qq:
    enabled: true
    type: onebot
    wsUrl: ws://localhost:3001
    botQQ: ""
    bindTo:
      type: group           # "agent" | "group"
      groupId: debate-01    # group 类型时必填
      role: user            # "user" | "owner"

  discord:
    enabled: true
    type: discord
    discordBotToken: ""
    bindTo:
      type: group
      groupId: debate-01
      role: owner

  wecom:
    enabled: false
    type: wecom
    # 无 bindTo → 默认走 Butler main 入口（保持现有行为）
```

### 配置 Schema 变更

```ts
interface ChannelConfig {
  // ...existing fields...
  bindTo?: {
    type: "agent" | "group";
    agentId?: string;       // type=agent 时
    groupId?: string;       // type=group 时
    role?: "user" | "owner"; // type=group 时，默认 "user"
  };
}
```

### 两种绑定模式

**User 模式 (`role: user`)**：
- Channel 用户消息直接注入 `GroupContext.speakToMain("user", message)`
- Channel 接收 Group main 频道的所有对话输出，实时推送回通讯平台
- 用户以实时发言方式融入讨论

**Owner 模式 (`role: owner`)**：
- 绑定时创建一个持久 Talk（ID 格式 `talk:channel:{channelId}`）
- Channel 用户消息注入该 Talk，触发 Owner Agent 处理
- Owner 根据用户指令在 Group 内调度（发布计划、分配任务、创建子 Talk 等）
- Channel 接收 Owner 的回复
- 绑定期间复用同一个 Talk，保持上下文连续

**无绑定**：
- 走现有默认行为 → `ButlerAgent.handleIncomingMessage()`

---

## 3. 消息路由

### ChannelRouter

新增 `group/router.ts`（~80 行），职责单一：根据绑定配置分发 Channel 消息。

```
Channel 消息到达
  → ChannelRouter.route(channelId, message)
    → 无 bindTo?       → ButlerAgent.handleIncomingMessage()
    → bindTo=agent?    → 目标 Agent.handleIncomingMessage()
    → bindTo=group + role=user?
        → GroupContext.speakToMain("user", msg)
        → 返回 mainHistory 最近 N 条给 Channel
    → bindTo=group + role=owner?
        → Talk.speak("channel-user", msg)
        → 触发 Owner Agent 处理
        → 返回 Owner 回复给 Channel
```

### 订阅机制

`GroupContext` 新增订阅回调：

```ts
class GroupContext {
  private mainListeners: ((msg: ChannelMessage) => void)[] = [];

  onMainMessage(listener: (msg: ChannelMessage) => void): void {
    this.mainListeners.push(listener);
  }

  speakToMain(fromAgentId: string, content: string): ChannelMessage {
    const msg = ...; // existing logic
    for (const listener of this.mainListeners) listener(msg);
    return msg;
  }
}
```

Channel 在 user 模式下注册 listener，main 频道有新消息时自动推送到通讯平台。

---

## 4. Group 讨论输出

### 当前问题

`Group.run()` 的讨论结果只存在内存 `history[]` 中，不写入 `GroupContext`，外部不可见。

### 改动

`Group.run()` 每个 Agent 发言后，调用 `ctx.speakToMain(agentId, content)` 将消息写入 GroupContext main 频道。这样：

1. Channel (user 模式) 通过订阅收到实时输出
2. GUI 通过 WS 收到实时输出
3. 讨论记录自动持久化到 `data/groups/{groupId}/main.md`

### Group 构造变更

Group 构造时需要接收 `GroupContext` 引用：

```ts
class Group {
  constructor(config: GroupConfig, registry: AgentRegistry, private ctx?: GroupContext) { ... }

  async run(topic: string): Promise<GroupMessage[]> {
    // ...existing logic...
    // 每次 Agent 发言后：
    if (this.ctx) this.ctx.speakToMain(speaker.id, response.content);
  }
}
```

---

## 5. Butler 动态管理

Butler 新增两个工具用于运行时动态绑定：

### `channel-bind`

```ts
{
  name: "channel-bind",
  description: "将 Channel 绑定到 Group（动态）",
  parameters: {
    channelId: string,      // Channel 标识
    groupId: string,        // 目标 Group
    role: "user" | "owner"  // 绑定角色
  }
}
```

执行：调用 `ChannelRouter.bind(channelId, groupId, role)`

### `channel-unbind`

```ts
{
  name: "channel-unbind",
  description: "解除 Channel 绑定",
  parameters: {
    channelId: string
  }
}
```

执行：调用 `ChannelRouter.unbind(channelId)`，Owner 模式时关闭对应 Talk。

---

## 6. 数据流

### User 模式示例

```
QQ 用户: "大家讨论下 React vs Vue"
  → ChannelRouter → GroupContext.speakToMain("user", msg)
  → main 频道触发 Owner 响应
  → Owner 调用 group-plan 制定计划
  → Member 按协议轮流发言 → speakToMain 记录
  → Channel 通过 listener 收到每条消息 → 推回 QQ 群
```

### Owner 模式示例

```
Discord 用户: "让 react-expert 先发言"
  → ChannelRouter → Talk("channel-user" → owner)
  → Owner 处理 → group-assign-task(react-expert, ...)
  → Owner 回复 "已安排" → 推回 Discord

Discord 用户: "讨论进展如何？"
  → Talk → Owner → group-summarize → 回复总结
```

---

## 7. 改动文件清单

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `packages/shared/src/types.ts` | 修改 | `GroupConfig` 新增 `owner` 字段 |
| `packages/core/src/config/schema.ts` | 修改 | Channel 配置新增 `bindTo` |
| `packages/core/src/config/config-loader.ts` | 修改 | 默认配置更新 |
| `config/default.yaml` | 修改 | 示例绑定配置 |
| `packages/core/src/group/roles.ts` | **新增** | 角色枚举 + 权限检查 |
| `packages/core/src/group/router.ts` | **新增** | ChannelRouter 消息路由 |
| `packages/core/src/group/context.ts` | 修改 | 新增订阅回调机制 |
| `packages/core/src/group/group.ts` | 修改 | `run()` 写入 GroupContext，构造接收 ctx |
| `packages/core/src/group/manager.ts` | 修改 | 创建 Group 时传入 GroupContext |
| `packages/core/src/agent/butler.ts` | 修改 | 新增 channel-bind / channel-unbind 工具 |
| `packages/core/src/runtime.ts` | 修改 | 集成 ChannelRouter，替代 startChannels 简单绑定 |

**不改动**：`channels/` 包、`providers/` 包、`ConversationLoop`、工具系统。

---

## 8. 测试计划

- `group/roles.test.ts` — 角色识别、权限检查
- `group/router.test.ts` — 路由分发、user/owner/无绑定三种路径
- `group/context.test.ts` — 新增订阅回调测试
- `group/group.test.ts` — `run()` 输出到 GroupContext 验证
- 集成测试 — Channel → Router → Group 全链路
