# MyAgents 功能总览

> 最后更新：2026-04-15 | Phase 0-4 已完成 | 35/35 测试通过

---

## 一、整体架构

```
MyAgentsRuntime（顶层运行时）
  ├── ButlerAgent（管家 Agent，full-access 权限，自动创建）
  │   ├── 内置工具：bash, read-file, write-file, edit-file, glob, grep, web-fetch, agent-message
  │   ├── 管家工具：butler-create-agent, butler-destroy-agent,
  │   │             butler-create-group, butler-destroy-group,
  │   │             butler-list, butler-run-group
  │   ├── Skill 工具：来自 skills/*.yaml（如 skill:code-review）
  │   └── MCP 工具：来自 mcpServers 配置，按需连接
  ├── AgentRegistry（全局 Agent 注册中心）
  ├── GroupManager（群组管理）
  └── CoreWSServer（GUI WebSocket 接口，端口 18765）
```

启动：`npx tsx scripts/dev.ts` → 创建 Runtime → 创建 ButlerAgent → 启动 WS → GUI 连接。

---

## 二、Agent

### 2.1 普通 Agent

| 能力 | 说明 |
|------|------|
| 身份 | id, name, role, systemPrompt |
| LLM | 支持 DeepSeek / Anthropic / 任意 OpenAI 兼容 API |
| 工具 | 从 8 个内置工具中按配置启用，加上 MCP 工具和 Skill 工具 |
| 权限 | `full-access` / `workspace-write` / `read-only` / `ask` |
| 会话 | 每个 channel+sender 独立 ConversationLoop 和历史 |
| MCP | 可动态连接 MCP 服务器，外部工具自动注册为 Tool |
| Skill | 启动时扫描 skills/ 目录，技能自动注册为工具 |
| 子 Agent | SubAgentSpawner 创建临时子 Agent，继承 provider/工具/权限 |
| Channel | 可绑定 QQ (OneBot v11) 等通讯渠道 |

### 2.2 管家 Agent (ButlerAgent)

继承 Agent，额外拥有 6 个管理工具：

| 工具 | 功能 |
|------|------|
| `butler-create-agent` | 创建新 Agent（name, role, systemPrompt），自动注册 |
| `butler-destroy-agent` | 销毁指定 Agent |
| `butler-create-group` | 创建群组（name, members[], protocol） |
| `butler-destroy-group` | 销毁群组 |
| `butler-list` | 列出所有 Agent 和群组状态 |
| `butler-run-group` | 启动群组讨论（groupId, topic），返回讨论记录 |

典型交互：
```
用户: "帮我创建一个 React 专家和一个 Vue 专家，让他们讨论哪个更好"
ButlerAgent 自动:
  → butler-create-agent(react-expert)
  → butler-create-agent(vue-expert)
  → butler-create-group(framework-debate, [react-expert, vue-expert], round-robin)
  → butler-run-group(framework-debate, "React vs Vue 哪个更好？")
  → 返回完整讨论记录
```

### 2.3 Agent 间通信 (agent-message)

任何 Agent 可调用 `agent-message(target, message)` 向另一个 Agent 发消息并获取回复。

- **查找**：通过 AgentRegistry 定位目标 Agent
- **循环检测**：callDepth 跟踪嵌套深度，超过 2 层拒绝（防 A→B→A→B 循环）
- **超时**：默认 60 秒

### 2.4 AgentRegistry

全局注册中心。`register()` / `get()` / `list()` / `unregister()`。注册时检查 ID 唯一性。

---

## 三、Skill（技能系统）

### 3.1 定义方式

在 `skills/` 目录放 YAML 或 JSON 文件：

```yaml
name: code-review           # 技能名
description: 代码审查技能     # 描述（LLM 看到的工具说明）
trigger: "当用户要求审查代码时"
tools: [read-file, glob, grep]
prompt: |                    # 完整提示词模板，支持 {{参数}} 替换
  你是一个代码审查专家。请按步骤审查代码：
  1. 使用 glob 找到相关文件
  2. 使用 read-file 阅读代码
  3. 使用 grep 搜索问题
  语言: {{language}}
parameters:
  - name: language
    description: 编程语言
    type: string
    default: auto-detect
```

### 3.2 运行机制

1. Agent 构造时，SkillLoader 扫描 `skills/` 目录
2. 每个技能包装为 Tool，名称 `skill:{name}`
3. LLM 决定调用 `skill:code-review`
4. 模板变量替换（`{{language}}` → 实际值）
5. 以技能 prompt 为 system prompt，task 为 user message，调用 LLM
6. 结果返回主对话循环

### 3.3 新增技能

在 `skills/` 目录新增 YAML 文件，重启即生效。已有：`skills/code-review.yaml`。

---

## 四、Group（群组讨论）

### 4.1 Group 类

- **成员**：一组 Agent ID，通过 AgentRegistry 解析
- **协议**：决定发言顺序
- **历史**：所有讨论消息记录
- **方法**：`run(topic)`, `injectMessage()`, `addMember()`, `removeMember()`

### 4.2 三种讨论协议

| 协议 | 行为 | 适用场景 |
|------|------|---------|
| `round-robin` | 固定顺序轮流，每轮每人一次 | 结构化辩论 |
| `free-form` | 未发言者优先 | 开放式头脑风暴 |
| `moderated` | 主持人分配→成员回复→主持人总结 | 有引导的讨论 |

### 4.3 讨论流程示例

```
round-robin, 3 个 Agent, 2 轮:

Round 1:
  coder 发言 → designer 看到 coder 的回复后发言
  → judge 看到前两人的回复后发言

Round 2:
  coder 看到所有人的讨论后再次发言 → ...

每个 Agent 收到：讨论主题 + 最近 10 条历史消息。
```

### 4.4 GroupManager

`create(config)` / `get(id)` / `list()` / `delete(id)`。

---

## 五、内置工具

| 工具 | 功能 | 特点 |
|------|------|------|
| `bash` | 执行 shell 命令 | Docker 沙箱模式、超时控制 |
| `read-file` | 读取文件 | 带行号输出，offset/limit |
| `write-file` | 写入文件 | 自动创建目录 |
| `edit-file` | 编辑文件 | 字符串替换，唯一匹配检查 |
| `glob` | 按模式搜索文件 | `**` 递归、`*` 通配 |
| `grep` | 正则搜索内容 | 文件名过滤，输出 `文件:行号:内容` |
| `web-fetch` | HTTP 请求 | GET/POST，受 sandbox.network 控制 |
| `agent-message` | Agent 间通信 | 循环检测(maxDepth=2)，超时保护 |

---

## 六、MCP 集成

Agent 可连接外部 MCP 服务器，工具以 `mcp:{serverId}:{toolName}` 注册。

- **Stdio**：启动子进程，stdin/stdout 交换 JSON-RPC
- **HTTP**：POST 到 endpoint，支持 SSE 流式响应
- 自动 initialize 握手 → tools/list 发现 → 桥接为 Tool 接口

配置示例（config/default.yaml）：
```yaml
mcpServers:
  filesystem:
    transport: stdio
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "."]
```

---

## 七、GUI

Rust eframe/egui 原生窗口（`gui/` 目录）。

- 左侧 Agent 卡片列表（状态灯、模型信息）
- 中央气泡式消息（用户蓝调 / AI 绿调 / 系统暖黄调）
- 流式 token 实时推送 + Thinking 脉冲动画
- 底部输入框（Enter 发送 / Shift+Enter 换行）
- 通过 WebSocket 连接 Core

---

## 八、文件结构

```
myagents/
├── packages/
│   ├── shared/src/          # 全局类型、事件总线、日志
│   ├── providers/src/       # LLM Provider（Anthropic + OpenAI 兼容）
│   ├── channels/src/        # 渠道适配器（QQ OneBot v11）
│   └── core/src/
│       ├── agent/           # Agent, ButlerAgent, AgentRegistry, SubAgentSpawner
│       ├── conversation/    # ConversationLoop, ContextWindow, prompt-builder
│       ├── config/          # 配置加载（YAML）
│       ├── api/             # CoreWSServer
│       ├── tools/           # 8 内置工具 + ToolRegistry + ToolExecutor + PermissionEnforcer
│       ├── mcp/             # MCPClient, MCPManager, Transport(stdio/http)
│       ├── skills/          # SkillLoader
│       ├── group/           # Group, GroupManager, Protocol(3种策略)
│       └── runtime.ts       # MyAgentsRuntime 顶层组装
├── gui/src/                 # Rust eframe/egui 原生 GUI
├── skills/                  # 技能定义文件（YAML/JSON）
├── config/default.yaml      # 默认配置
├── scripts/dev.ts           # 启动入口
└── docs/                    # 设计规格 + 实现计划
```

## 九、测试

```
17 个测试文件，113 个测试用例，全部通过。

AgentRegistry       — 4 tests
GroupProtocol       — 7 tests
GroupManager        — 3 tests
GroupContext        — 16 tests
GroupRole           — 8 tests
ChannelRouter       — 9 tests
ToolRegistry        — 4 tests
PermissionEnforcer  — 6 tests
ToolExecutor        — 6 tests
ButlerAgent         — 2 tests
EventEmitter        — 3 tests
Catalogs            — tests
Integration         — 11 tests
```

---

## 十、Channel-Group 绑定

### 10.1 角色模型

| 角色 | 身份 | 权限 |
|------|------|------|
| `user` | 人类用户 | 发言、创建/解散 Talk、添加/移除组员、终止讨论 |
| `owner` | 群主 Agent | 调度组员、创建 Talk、总结讨论、执行 user 指令 |
| `member` | 普通 Agent | 发言、参与 Talk |

### 10.2 Channel 绑定模式

Channel 可绑定到 Group 的两种入口：

- **User 模式** (`role: user`)：消息直接注入 main 频道，用户实时融入讨论，接收所有群组对话
- **Owner 模式** (`role: owner`)：创建持久 Talk 与群主私聊，群主根据指令调度 Group

### 10.3 配置方式

静态绑定（YAML）：

```yaml
channels:
  qq:
    enabled: true
    type: onebot
    wsUrl: ws://localhost:3001
    bindTo:
      type: group
      groupId: debate-01
      role: user
```

动态绑定（Butler 工具）：
- `channel-bind(channelId, groupId, role)` — 绑定
- `channel-unbind(channelId)` — 解绑

### 10.4 消息路由

`ChannelRouter` 负责消息分发：

- 无绑定 → Butler 默认入口
- `bindTo.type=group` + `role=user` → GroupContext main 频道
- `bindTo.type=group` + `role=owner` → 持久 Talk → Owner Agent

---

## 十一、待实现

- **Phase 5 补充**：Ollama 本地模型 Provider、Telegram Channel
- **Phase 6**：GUI 完善（Agent 管理面板、群组可视化、配置编辑）、Tauri 集成
