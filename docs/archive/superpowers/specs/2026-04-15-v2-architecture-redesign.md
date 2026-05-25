# MyAgents v2 架构重构计划

> 日期：2026-04-15
> 状态：设计中

## 概述

基于 10 条用户需求，对 MyAgents 进行架构重构。核心变化：
1. Agent 拥有独立文件系统（identity/soul/memory/workspace）
2. 群组通信模型重构（main + private talk，@mention 机制）
3. 对话记忆持久化（按天存储 + LLM 索引）
4. Skill 改为 MD + 程序格式
5. LLM 调用网关（并发控制 + 队列）

---

## 1. Agent 独立文件系统

**参考 OpenClaw 的 workspace 模式**：每个 Agent 拥有独立目录。

### 目录结构

```
data/agents/{agentId}/
├── IDENTITY.md      # 身份：name, emoji, creature, vibe, avatar
├── SOUL.md          # 灵魂：system prompt 的详细版本，agent 的价值观、风格、知识背景
├── AGENTS.md        # 自我描述：角色、能力摘要（供其他 agent/管家阅读）
├── EXPERIENCE.md    # 经验索引（预留接口，后续实现）
├── MEMORY.md        # 记忆索引：LLM 总结的历史对话摘要
├── memory/          # 对话记录（按天存储）
│   ├── 2026-04-15.md
│   ├── 2026-04-16.md
│   └── ...
├── workspace/       # 工作目录（bash 等工具的工作目录）
├── config.json      # Agent 配置（tools, permissions, sandbox 等）
└── skills/          # Agent 私有技能（覆盖全局技能）
```

### IDENTITY.md 示例

```markdown
# IDENTITY.md

- Name: React 专家
- Emoji: ⚛️
- Creature: 一个精于 React 生态的资深工程师
- Vibe: 严谨、注重性能、喜欢函数式编程
- Avatar: (预留)
```

### SOUL.md 示例

```markdown
# SOUL.md

你是一位精通 React 全家桶的资深前端工程师。
你的核心原则：
- 组件设计遵循单一职责
- 状态管理优先 hooks，复杂场景用 zustand
- 性能优化是你的本能
- TypeScript 是你的母语
```

### AgentPaths 类

路径：`packages/core/src/agent/paths.ts`

```typescript
export class AgentPaths {
  constructor(private baseDir: string) {}
  
  get identityPath() { return path.join(this.baseDir, "IDENTITY.md"); }
  get soulPath() { return path.join(this.baseDir, "SOUL.md"); }
  get agentsPath() { return path.join(this.baseDir, "AGENTS.md"); }
  get experiencePath() { return path.join(this.baseDir, "EXPERIENCE.md"); }
  get memoryIndexPath() { return path.join(this.baseDir, "MEMORY.md"); }
  get memoryDir() { return path.join(this.baseDir, "memory"); }
  get workspaceDir() { return path.join(this.baseDir, "workspace"); }
  get configPath() { return path.join(this.baseDir, "config.json"); }
  get skillsDir() { return path.join(this.baseDir, "skills"); }
  
  static forAgent(agentId: string): AgentPaths {
    return new AgentPaths(path.resolve("data", "agents", agentId));
  }
}
```

### Agent 加载流程

```
Agent 构造 → AgentPaths.forAgent(id) → 
  读取 config.json → 
  读取 IDENTITY.md → 解析 name/emoji/vibe
  读取 SOUL.md → 作为 systemPrompt 的一部分
  读取 MEMORY.md → 注入到 systemPrompt
  确保 memory/ 和 workspace/ 目录存在
```

## 2. 对话记忆持久化

### 2.1 按天存储

每次对话结束后，**硬编码程序**（不通过 LLM 工具调用）自动保存：

```
data/agents/{agentId}/memory/2026-04-15.md

# 2026-04-15 对话记录

## Session: main (14:30)
**User:** 列出当前目录的文件
**Assistant:** [调用了 bash 工具] 当前目录包含以下文件...
**Tool: bash** `ls -la` → 输出: ...

## Session: group:react-vs-vue:main (15:00)
**Group Topic:** React vs Vue 哪个更好？
**[react-expert]:** 从性能角度看...
**[vue-expert]:** 从开发体验角度看...
```

### 2.2 MemoryWriter

路径：`packages/core/src/memory/writer.ts`

```typescript
export class MemoryWriter {
  constructor(private memoryDir: string) {}
  
  /** 追加一轮对话到当天文件 */
  async appendEntry(entry: {
    session: string;       // "main" / "group:{groupId}:main" / "group:{groupId}:talk:{talkId}"
    role: string;
    content: string;
    toolCalls?: any[];
  }): Promise<void> {
    const today = new Date().toISOString().split("T")[0]; // "2026-04-15"
    const filePath = path.join(this.memoryDir, `${today}.md");
    // 格式化并追加
  }
}
```

### 2.3 LLM 索引（MEMORY.md）

功能：定期或手动触发 LLM 总结历史对话，生成索引。

路径：`packages/core/src/memory/indexer.ts`

```typescript
export class MemoryIndexer {
  /** 总结指定天数的历史，更新 MEMORY.md */
  async index(agentId: string, days?: number): Promise<void> {
    // 1. 读取 memory/ 目录下的文件
    // 2. 调用 LLM 总结为索引条目
    // 3. 写入 MEMORY.md
  }
}
```

MEMORY.md 示例：
```markdown
# 记忆索引

## 2026-04-15
- 与用户讨论了项目结构，创建了 3 个新组件
- 在 group:react-vs-vue 中，与 vue-expert 讨论了状态管理
- 帮用户修复了 TypeScript 类型错误（packages/core/src/agent.ts）

## 2026-04-14
- 首次启动，完成了 MVP 开发
```

## 3. 群组通信模型重构

### 3.1 Agent ID 格式

```
{agentID}                    — 全局唯一 Agent 标识（如 "react-expert"）
```

### 3.2 Session Key 格式

```
main                         — Agent 自己的主窗口
group:{groupId}:main         — 群组公共频道
group:{groupId}:talk:{talkId} — 群组内私有讨论
```

### 3.3 群组通信方式

#### main（公共频道）

- 对群组内所有 Agent 可见
- `@react-expert` — 指定 Agent 必须响应
- `@all` — 所有 Agent 必须响应
- 不带 @ — Agent 可选响应，但内容作为上下文
- 记录在 `data/groups/{groupId}/main.md`

#### talk（私有讨论）

- 仅参与者可见
- 继承 main 的上下文（参与者能看到 main 频道内容）
- talk 结果只写入参与者的 memory，不影响其他 Agent
- 发起：Agent 调用 `talk-create(target1, target2, topic)`
- 使用 `talk-send(talkId, message)` / `talk-read(talkId)` 通信

### 3.4 GroupContext 类

路径：`packages/core/src/group/context.ts`

```typescript
export class GroupContext {
  // 管理 main 频道 + talk 频道
  // 每个频道有独立的消息历史
  // main 频道的内容对所有成员可见
  // talk 频道只对参与者可见
}
```

### 3.5 agent-message 工具改造

```typescript
// 旧：直接给任意 agent 发消息
agent-message(target: "react-expert", message: "...")

// 新：只能通过群组通信
// 在 main 频道发言（所有人可见）
group-speak(groupId: "g1", message: "@react-expert 你怎么看？")

// 创建私有讨论
talk-create(groupId: "g1", members: ["react-expert", "vue-expert"], topic: "接口设计")

// 在 talk 中发言
talk-send(talkId: "t1", message: "...")
```

### 3.6 群主 Agent（GroupOwner）

每个群组有一个群主 Agent，负责：
- 计划和发起讨论
- 判断当前讨论状态
- 组织轮次
- 决定何时需要创建 talk

群主 Agent 拥有特殊工具：
- `group-plan` — 制定讨论计划
- `group-invite-talk` — 邀请成员进入私有讨论
- `group-summarize` — 总结当前讨论状态
- `group-assign-task` — 给成员分配任务

## 4. 管家增强

### 4.1 Agent/Group 信息持久化

管家在 `data/butler/` 下维护：

```
data/butler/
├── AGENTS_REGISTRY.md    # 所有 Agent 的能力描述
├── GROUPS_REGISTRY.md    # 所有群组的状态和成果
└── TASK_LOG.md           # 任务执行日志
```

**AGENTS_REGISTRY.md 示例：**
```markdown
# Agent 注册表

## react-expert
- 角色：React 前端专家
- 能力：React 组件设计、性能优化、TypeScript
- 创建时间：2026-04-15
- 所属群组：framework-debate
- 状态：活跃

## vue-expert
- 角色：Vue 前端专家
- 能力：Vue3 组合式 API、Pinia、Nuxt
- 创建时间：2026-04-15
- 所属群组：framework-debate
- 状态：活跃
```

### 4.2 新增管家工具

| 工具 | 功能 |
|------|------|
| `butler-add-to-group` | 将已有 Agent 加入群组 |
| `butler-read-registry` | 阅读 Agent/Group 注册表（每次新任务前自动调用） |
| `butler-update-registry` | 更新 Agent/Group 信息 |
| `butler-analyze-task` | 分析任务需要什么类型的 Agent |

### 4.3 管家行为变更

```
用户: "帮我做一个前后端分离的项目"
ButlerAgent:
  1. 调用 butler-read-registry → 了解已有 agent
  2. 调用 butler-analyze-task → 判断需要前端+后端 agent
  3. 如果已有合适 agent → butler-add-to-group
  4. 如果没有 → butler-create-agent
  5. butler-create-group → 创建群组
  6. 设置群主（默认为管家自己或指定 agent）
```

## 5. Skill 系统重构

**参考 OpenClaw 的 SKILL.md 格式**：markdown frontmatter + 内容。

### 5.1 Skill 文件格式

```
skills/translation/SKILL.md
```

```markdown
---
name: translation
description: "翻译文本到指定语言"
metadata:
  tools: ["read-file", "write-file"]
  trigger: "当用户需要翻译时"
---

# Translation Skill

将文本翻译为 {{target_language}}。

## 步骤

1. 读取源文件
2. 逐段翻译，保持原文格式
3. 写入目标文件

## 规则

- 保持专业术语准确
- 保留代码块不翻译
- 上下文联系翻译，不直译
```

### 5.2 Skill + 程序

对于需要可执行代码的技能：

```
skills/code-review/
├── SKILL.md          # 技能描述和 prompt
├── run.ts            # 可选：程序入口（用于预处理/后处理）
└── templates/        # 可选：模板文件
```

### 5.3 SkillLoader 改造

```typescript
// 扫描 skills/ 目录
// 每个 SKILL.md 文件解析为 SkillDefinition
// 如果有 run.ts → 注册为带程序的 skill
// 如果没有 → 注册为纯 prompt skill（当前方式）
```

## 6. LLM 调用网关（LLMGateway）

### 6.1 问题

多个 Agent/群组同时运行时，并发 LLM 请求可能超过 API 限制。

### 6.2 解决方案

路径：`packages/core/src/gateway/llm-gateway.ts`

```typescript
export class LLMGateway {
  private queue: Array<{ resolve: Function; reject: Function; params: ChatParams }>;
  private activeCount = 0;
  private maxConcurrency: number;  // 用户配置，如 5
  private rpmLimit: number;        // 每分钟请求数限制
  
  /** 提交 LLM 请求（排队执行） */
  async chat(params: ChatParams): AsyncIterable<ChatChunk> {
    // 放入队列，等待调度
  }
  
  /** 内部调度：控制并发数和 RPM */
  private schedule(): void {
    // 从队列取出请求，控制并发 ≤ maxConcurrency
    // 跟踪 RPM，必要时等待
  }
}
```

### 6.3 配置

```yaml
gateway:
  maxConcurrency: 5
  rpmLimit: 60
  timeout: 120000
  retryAttempts: 3
```

### 6.4 Agent 使用 Gateway

所有 Agent 共享一个 LLMGateway 实例，通过它发起请求：

```typescript
// Agent 不直接调 provider.chat()
// 而是通过 gateway.chat()，自动排队
const gateway = new LLMGateway(provider, { maxConcurrency: 5, rpmLimit: 60 });
```

## 7. 数据目录结构总览

```
data/
├── agents/
│   ├── butler/
│   │   ├── IDENTITY.md
│   │   ├── SOUL.md
│   │   ├── AGENTS.md
│   │   ├── EXPERIENCE.md (预留)
│   │   ├── MEMORY.md
│   │   ├── memory/
│   │   ├── workspace/
│   │   └── config.json
│   ├── react-expert/
│   │   ├── IDENTITY.md
│   │   ├── SOUL.md
│   │   ├── ...
│   └── vue-expert/
│       └── ...
├── groups/
│   ├── framework-debate/
│   │   ├── config.json        # 群组配置
│   │   ├── main.md            # main 频道历史
│   │   ├── talks/
│   │   │   ├── talk-001.md    # 私有讨论记录
│   │   │   └── ...
│   │   └── summary.md        # 群组讨论总结
│   └── ...
├── butler/
│   ├── AGENTS_REGISTRY.md
│   ├── GROUPS_REGISTRY.md
│   └── TASK_LOG.md
└── runtime.json              # 运行时状态
```

## 8. 新增/修改文件清单

### 新增

```
packages/core/src/
  agent/paths.ts              # AgentPaths — Agent 文件路径管理
  agent/files.ts              # AgentFiles — 读写 IDENTITY/SOUL/AGENTS 等
  memory/writer.ts            # MemoryWriter — 按天写对话记录
  memory/indexer.ts           # MemoryIndexer — LLM 总结索引
  memory/reader.ts            # MemoryReader — 读取历史和索引
  group/context.ts            # GroupContext — main + talk 频道管理
  group/talk.ts               # Talk 频道
  group/owner.ts              # GroupOwner 工具
  gateway/llm-gateway.ts      # LLMGateway — 并发控制
  skills/md-loader.ts         # SKILL.md 格式加载器
```

### 修改

```
packages/core/src/agent/agent.ts     # 集成 AgentPaths, MemoryWriter
packages/core/src/agent/butler.ts    # 管家增强（registry, 分析任务）
packages/core/src/group/group.ts     # 重构为 main + talk 模型
packages/core/src/group/protocol.ts  # 适配新通信模型
packages/core/src/runtime.ts         # 集成 LLMGateway
packages/core/src/tools/agent-message.ts → 拆为 group-speak, talk-create, talk-send
```

## 9. 实现顺序

**阶段 A（基础设施）：**
1. AgentPaths + AgentFiles — Agent 文件系统
2. MemoryWriter — 对话记录存储
3. MemoryIndexer — LLM 索引
4. SKILL.md 格式 + 新加载器

**阶段 B（通信重构）：**
5. Session Key 新格式（main / group:xxx:main / group:xxx:talk:yyy）
6. GroupContext — main + talk 频道
7. 群组工具（group-speak, talk-create, talk-send, talk-read）
8. agent-message 改为群组内通信

**阶段 C（管家增强）：**
9. Agent/Group Registry 持久化
10. 管家新工具（add-to-group, read-registry, analyze-task）
11. 群主 Agent 工具

**阶段 D（网关）：**
12. LLMGateway 并发控制

**阶段 E（集成验证）：**
13. Runtime 重构
14. dev.ts 更新
15. 端到端测试
