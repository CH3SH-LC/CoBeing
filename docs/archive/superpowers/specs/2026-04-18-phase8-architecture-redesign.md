# MyAgents 架构重构设计 — Phase 8

> 日期: 2026-04-18
> 状态: Draft
> 范围: Skill 仓库重构 / 异步协作引擎 / 经验系统修复 / 配置架构重设计 / Agent 自治文件系统

---

## 1. 设计目标

解决当前系统的六个核心问题：

1. **Skill 架构**：技能分散、Agent 无法动态创建/发现技能
2. **异步协作**：讨论是同步 for 循环，非真正异步
3. **经验系统**：写了不用、反思上下文薄、噪声多
4. **配置架构**：Agent 配置全部堆在根配置里，不够自治
5. **Agent 核心文件丢失**：IDENTITY.md / SOUL.md / USER.md / BOOTSTRAP.md / AGENTS.md 未完整集成
6. **群主智能不足**：硬编码讨论逻辑，缺少双模型初筛和预置管理技能

---

## 2. Agent 自治文件系统

### 2.1 Agent 核心文件

每个 Agent 目录 (`data/agents/{id}/`) 包含以下核心文件：

| 文件 | 用途 | 读写方 |
|------|------|--------|
| `IDENTITY.md` | Agent 身份：名称、角色、个性特征 | Agent 自我更新 / 管家创建时写入 |
| `SOUL.md` | Agent 灵魂/人格描述，追加到 system prompt 最前面 | Agent 自我更新 |
| `USER.md` | 用户偏好和画像（用户对 Agent 的要求、沟通风格偏好等） | 用户编辑 / Agent 学习 |
| `BOOTSTRAP.md` | 启动引导：首次激活时的初始化指令、自我认知任务。完成后删除 | 管家创建时写入 / Agent 自我完善 |
| `AGENTS.md` | Agent 工作空间指南：启动流程、记忆管理、行为准则 | 框架模板 + Agent 自我完善 |
| `EXPERIENCE.md` | 经验积累（问题-解决方案对） | 自动反思写入 |
| `MEMORY.md` | 记忆索引（LLM 总结的历史摘要） | MemoryIndexer 写入 |
| `config.json` | 运行时配置（permissions, skills, sandbox, provider, model） | 管家创建 / 用户编辑 |
| `TOOLS.md` | 工具本地笔记（环境特定配置、设备名、别名等） | Agent 维护 |
| `memory/` | 每日对话原始记录 | MemoryWriter 自动写入 |
| `workspace/` | 工作目录 | Agent 工具操作 |

### 2.2 AgentPaths 扩展

```typescript
class AgentPaths {
  // 现有
  get identityPath()   { return path.join(this.baseDir, "IDENTITY.md"); }
  get soulPath()       { return path.join(this.baseDir, "SOUL.md"); }
  get agentsPath()     { return path.join(this.baseDir, "AGENTS.md"); }
  get experiencePath() { return path.join(this.baseDir, "EXPERIENCE.md"); }
  get memoryIndexPath(){ return path.join(this.baseDir, "MEMORY.md"); }
  get memoryDir()      { return path.join(this.baseDir, "memory"); }
  get workspaceDir()   { return path.join(this.baseDir, "workspace"); }
  get configPath()     { return path.join(this.baseDir, "config.json"); }

  // 新增
  get userPath()       { return path.join(this.baseDir, "USER.md"); }
  get bootstrapPath()  { return path.join(this.baseDir, "BOOTSTRAP.md"); }
  get toolsPath()      { return path.join(this.baseDir, "TOOLS.md"); }
}
```

### 2.3 System Prompt 构建链

所有 prompt 从 .md 文件读取，不硬编码。不需要 system.md——prompt 完全由以下文件组合构成：

```
1. SOUL.md       → 如果存在，作为最前置（人格基底）
2. BOOTSTRAP.md  → 如果存在，追加（启动引导；完成后删除此文件）
3. config.json   → role + name 生成角色描述作为主体 prompt
4. AGENTS.md     → 如果存在，追加（工作空间指南与自我认知）
5. USER.md       → 如果存在，追加（用户偏好）
6. EXPERIENCE.md  → 检索相关经验追加（见第 6 节）
7. MEMORY.md     → 如果存在，追加（历史记忆索引）
```

---

## 3. 配置架构重设计

### 3.1 原则

Agent 是自治单元。根配置只声明"有哪些 Agent 和 Group"，Agent 自己的配置放在自己的目录里。

### 3.2 目录结构

```
myagents/
├── config/
│   └── default.json           # 最小化：provider + agent ID 列表 + group 定义
├── skills/                     # 全局 Skill 仓库（唯一）
│   ├── code-review/SKILL.md
│   ├── project-planning/SKILL.md
│   ├── group-coordination/SKILL.md
│   └── <运行中动态创建的技能>/SKILL.md
├── prompts/                    # 所有 prompt 模板（备用）
│   ├── butler.md               # 管家默认 prompt（被 data/agents/butler/config.json 的 systemPrompt 覆盖）
│   └── experience-reflect.md   # 经验反思 prompt
├── data/
│   ├── agents/
│   │   ├── butler/
│   │   │   ├── config.json
│   │   │   ├── IDENTITY.md / SOUL.md / USER.md / BOOTSTRAP.md / AGENTS.md
│   │   │   ├── EXPERIENCE.md / MEMORY.md
│   │   │   └── memory/
│   │   ├── react-expert/
│   │   │   ├── config.json
│   │   │   └── ...
│   └── groups/
│       └── frontend-team/
│           ├── config.json     # { members, owner, ... }
│           └── context.jsonl   # 群组上下文消息持久化（每行一条消息）
```

### 3.3 default.json 新格式

```json
{
  "core": {
    "logLevel": "info",
    "dataDir": "./data",
    "skillsDir": "./skills",
    "promptsDir": "./prompts"
  },
  "providers": {
    "deepseek": {
      "apiKeyEnv": "DEEPSEEK_API_KEY",
      "baseURL": "https://api.deepseek.com/v1"
    }
  },
  "agents": ["butler"],
  "groups": []
}
```

### 3.4 Agent config.json 格式

```json
{
  "name": "管家",
  "role": "MyAgents 管家",
  "provider": "deepseek",
  "model": "deepseek-chat",
  "permissions": { "mode": "full-access" },
  "sandbox": { "enabled": false, "filesystem": "workspace-only", "network": true },
  "skills": ["group-coordination", "project-planning"],
  "tools": ["bash", "read-file", "write-file", "glob", "grep", "web-fetch"]
}
```

---

## 4. Skill 仓库架构

### 4.1 统一仓库

- 唯一技能目录：`skills/`（由 `config.core.skillsDir` 指定）
- 技能格式统一为 SKILL.md（frontmatter + markdown body）
- 移除 `data/agents/{id}/skills/` 私有目录
- 移除 `SkillLoader`（YAML/JSON 加载器），`SkillMdLoader` 重构为 `SkillRepository`

### 4.2 SkillRepository

```typescript
class SkillRepository {
  constructor(skillsDir: string, providerGetter: () => LLMProvider)
  list(): SkillInfo[]
  get(name: string): SkillDefinition
  create(name: string, description: string, prompt: string): void
  search(keyword: string): SkillInfo[]
}
```

### 4.3 Agent Skill 工具

所有 Agent 注册三个统一工具（不再按 skill 名注册独立 tool）：

| 工具名 | 参数 | 说明 |
|--------|------|------|
| `skill-execute` | `name, task, params?` | 执行指定技能。受 config.json 的 skills 白名单限制 |
| `skill-list` | 无 | 列出当前 Agent 可用的技能（白名单过滤后） |
| `skill-create` | `name, description, prompt` | 在仓库中创建新技能。创建后不会自动获得使用权 |

### 4.4 构造变更

```
旧：Agent 构造时 → SkillLoader 加载全局 YAML → SkillMdLoader 加载私有目录 → 注册 skill-xxx 工具
新：Agent 构造时 → 注入 SkillRepository 引用 → 注册 skill-execute / skill-list / skill-create → 运行时按需调用
```

---

## 5. 异步协作引擎

### 5.1 统一上下文窗口

整个群组共用一个 `GroupMessage[]` 数组。每条消息有一个 `tag` 标识：

```typescript
interface GroupMessage {
  id: string;
  tag: "main" | string;    // "main" 或 "talk-001", "talk-002" ...
  fromAgentId: string;
  content: string;
  timestamp: number;
  mentions: string[];       // 解析出的 @mention 目标列表
}
```

### 5.2 上下文构建

为 Agent X 构建上下文时：

```
过滤条件：msg.tag === "main" || msg.tag 在 Agent X 参与的 talk 列表中

格式化规则：
- main 消息：原样呈现
- talk 消息：加前缀 "[Talk: talk-001 成员: A, B] content"
```

非参与者看不到 talk 消息。上传给 LLM 时自动过滤无关 talk。

### 5.3 唤醒系统（Wake System）

唤醒系统是**硬编码工具**，不是 skill。

**工作流程：**

```
1. 任何消息写入群组上下文
2. 扫描消息中的 @mentions → 加入唤醒队列（WakeQueue）
3. 队列更新 → 触发唤醒系统
4. 唤醒系统取出第一个未处理的 mention：
   a. 为目标 Agent 构建过滤后的上下文视图
   b. 调用目标 Agent.run(context)
   c. Agent 回复写回群组上下文（tag 继承来源消息的 tag）
   d. 等待 N 秒（可配置，默认 5s）
   e. 检查队列是否有新的未处理 mention
   f. 有 → 回到步骤 4a
   g. 无 → 唤醒系统进入休眠
5. 下次有新 @mention 时重新触发
```

**关键特性：**
- 无轮次概念，完全事件驱动
- Agent 回复中如果包含 @mention，自动加入队列触发下一轮
- 用户可以以群主身份直接发消息（触发唤醒起点）
- 用户也可以作为普通成员身份加入群组（消息带 userId）

### 5.4 群主双模型（Screener + Main）

群主拥有两个 LLM 处理进程：

**初筛模型（Screener）：**
- 轻量级模型（可配置为更便宜/更快的模型）
- 群组中每出现新消息都触发
- 不执行任何工具，只输出判断：
  ```
  是否需要唤醒主模型：是/否
  原因：简要说明（如 "成员报告了阻塞问题" / "讨论停滞需要引导" / "无需干预"）
  建议：如果需要唤醒，给出建议群主做什么
  ```
- Prompt 从文件读取，不硬编码

**主模型（Main）：**
- 群主的完整 LLM（当前使用的模型）
- 只在以下情况被唤醒：
  1. 被 @mention 直接唤起
  2. 初筛模型建议需要介入
- 唤醒后执行完整的对话循环（含工具调用、skill 使用等）

**数据流：**

```
新消息 → GroupContextV2.append()
       → WakeSystem 扫描 mentions → 处理 @mention 目标
       → 同时触发群主 Screener
       → Screener 输出 "需要介入" → 唤醒群主 Main LLM
                           或 "无需介入" → 不动作
```

### 5.5 Talk 机制

- 任何 Agent 通过 `talk-create <members> <topic>` 创建 talk
- Talk 中消息 tag 为 `talk-{id}`
- 新 talk 消息写入后，参与者 Agent 在等待 5 秒后被触发
- Talk 消息对 main 不可见，不污染主频道
- 上下文构建时，talk 消息前面标注 `[Talk: talk-001 成员: A, B]`，方便 LLM 理解
- Agent 可通过 `talk-summary` 将结论摘要发回 main

### 5.6 讨论方式非硬编码

- 移除 `GroupProtocol` 类型
- 群主根据当前状态自主判断是否 @mention 成员
- 群主的管理能力来自预置的 `group-coordination` skill（见第 7 节）
- 讨论节奏完全由群主的智能和 skill 决定，不由代码控制

---

## 6. 经验系统修复

### 6.1 Agent 主动总结（Tool 模式）

经验总结不再是自动触发，而是 Agent 通过调用 `experience-reflect` 工具主动完成。

```typescript
// tools/experience-reflect.ts
{
  name: "experience-reflect",
  description: "总结当前任务的经验并写入 EXPERIENCE.md。在完成复杂任务后调用。",
  parameters: {
    task: string;      // 任务描述
    problem: string;   // 核心问题
    solution: string;  // 解决方案
  }
}
```

### 6.2 经验检索与注入

Agent.run() 开始时搜索相关经验注入 system prompt（构建链第 6 步）。

### 6.3 质量过滤

- problem 或 solution 不足 10 字时拒绝写入
- Agent 自主判断是否值得总结

---

## 7. 群主管理 Skill（预置）

### 7.1 设计理念

群主的组织管理能力**不是运行时搜索**获得的，而是预先编码在 `skills/group-coordination/SKILL.md` 中。基于以下来源总结：
- 会议引导技术（[Community Tool Box, U. Kansas](https://ctb.ku.edu/en/table-of-contents/leadership/group-facilitation/group-discussions/main)）
- 敏捷 Scrum Master 实践（[Scrum.org 委托框架](https://www.scrum.org/resources/decision-rules-delegation)）
- Liberating Structures（[The Liberators](https://medium.com/the-liberators/how-to-lead-scrum-masters-with-liberating-structures-9caf7764f0ad)）
- Tuckman 团队发展阶段模型（Forming → Storming → Norming → Performing）

### 7.2 Skill 内容框架

`skills/group-coordination/SKILL.md` 包含以下模块：

**模块一：讨论引导规则**
- 开场：明确议题、目标、时间预期
- 过程中：确保所有成员有机会发言；如果连续 2 条消息没有新观点，主动 @mention 未发言的成员
- 阻塞处理：当讨论陷入僵局（重复相同论点），重述各方立场，引导寻找共同点
- 共识检测：当 3+ 成员同意某个观点时，明确标记为共识，推进到下一议题
- 收束：讨论结束前总结结论、分配行动项、确认负责人和截止时间

**模块二：任务委托规则**
- 匹配任务与成员专长（参考成员的 role 和 capabilities）
- 任务描述使用 SMART 原则（具体、可衡量、可达成、相关、有时限）
- 委托后跟踪：如果 N 条消息后任务未更新状态，主动 @mention 询问进度
- 阻塞升级：成员报告阻塞时，评估是否需要其他成员协助，创建 talk 进行协调

**模块三：初筛决策规则**
- 何时主动介入：讨论偏离主题、成员间冲突升级、长时间无进展、任务阻塞报告
- 何时保持沉默：成员正在有效协作、讨论正常推进、只是信息分享
- 介入方式优先级：引导提问 → 重述归纳 → @mention 相关专家 → 直接给出建议

**模块四：冲突处理**
- 意见分歧：先确保双方观点被完整理解，然后引导分析各自优劣
- 进度延迟：了解原因 → 评估影响 → 协调资源支持或调整计划
- 质量问题：具体指出问题 → 提供建议 → 安排协作改进

**模块五：进度监控**
- 定期检查各成员任务状态
- 更新工作空间文档（PLAN.md / TASK.md / PROGRESS.md）
- 里程碑达成时确认并庆祝

---

## 8. 文件变更清单

| 操作 | 文件 | 说明 |
|------|------|------|
| 创建 | `packages/core/src/skills/repository.ts` | SkillRepository 替代 SkillLoader + SkillMdLoader |
| 创建 | `packages/core/src/group/wake-system.ts` | 唤醒系统（硬编码调度工具） |
| 创建 | `packages/core/src/group/group-context-v2.ts` | 统一上下文窗口 + tag |
| 创建 | `packages/core/src/group/screener.ts` | 群主初筛模型 |
| 创建 | `packages/core/src/tools/skill-tools.ts` | skill-execute / skill-list / skill-create |
| 创建 | `prompts/experience-reflect.md` | 经验反思 prompt |
| 创建 | `prompts/screener.md` | 初筛模型 prompt |
| 创建 | `skills/group-coordination/SKILL.md` | 预置群主管理技能 |
| 创建 | `data/agents/_templates/` | 中文版核心文件模板（IDENTITY/SOUL/USER/BOOTSTRAP/AGENTS） |
| 重构 | `packages/core/src/agent/agent.ts` | 文件系统增强、skill 统一工具、经验注入 |
| 重构 | `packages/core/src/agent/paths.ts` | 添加 USER.md / BOOTSTRAP.md / TOOLS.md 路径 |
| 重构 | `packages/core/src/agent/butler.ts` | 双模型 + skill 工具 |
| 重构 | `packages/core/src/group/group.ts` | 使用 v2 上下文 + 唤醒系统 |
| 修改 | `packages/core/src/runtime.ts` | 配置重设计、SkillRepository、双模型初始化 |
| 修改 | `config/default.json` | JSON 格式最小化配置（替代 default.yaml） |
| 修改 | `packages/shared/src/types.ts` | GroupMessage 新格式、移除 GroupProtocol |

---

## 9. 数据流总览

```
新消息写入 GroupContextV2
  ├── 扫描 @mentions → WakeQueue → 逐个唤醒目标 Agent
  └── 触发群主 Screener
        ├── "需要介入" → 唤醒群主 Main LLM → 执行对话循环（含 skill 调用）
        └── "无需介入" → 不动作

Agent.run(task)
  ├── 构建 system prompt（SOUL → BOOTSTRAP → role+name → AGENTS → USER → EXPERIENCE → MEMORY）
  ├── ConversationLoop.run()
  │     └── 工具调用 → skill-execute → SkillRepository → 执行
  └── 对话完成 → 有工具调用 → reflect(完整历史) → EXPERIENCE.md
```
