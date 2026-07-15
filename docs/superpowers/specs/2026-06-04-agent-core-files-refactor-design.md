# Agent 核心文件重构 — 设计规格

> 日期：2026-06-04
> 状态：设计中 → 待实现

## 目标

精简 Agent 核心文件，消除冗余，明确职责边界。

## 文件变更

| 操作 | 文件 | 原因 |
|------|------|------|
| 删除 | `BOOTSTRAP.md` | 知识注入/行为提醒与 AGENTS.md 重叠 |
| 删除 | `SOUL.md` | 语言风格 → CHARACTER.md；行为准则/边界 → AGENTS.md |
| 删除 | `USER.md` | 用户偏好信息 → EXPERIENCE.md |
| 删除 | `TOOLS.md` | 工具使用经验 → EXPERIENCE.md |
| 重写 | `CHARACTER.md` | 纯人物形象：背景 + 外观 + 语言风格 |
| 重写 | `JOB.md` | 纯工作范式：思考方式 + 工作流程 + 方法论 |
| 重写 | `MEMORY.md` | 条目式事件记录，简洁，仅独立工作 |
| 重写 | `EXPERIENCE.md` | 四维经验：技术技巧 + 工具心得 + 用户偏好 + 教训 |
| 更新 | `AGENTS.md` | 删除旧引用，新增行为准则，明确 JOB/CHARACTER 分工 |

## 设计决策

### 为什么删除 BOOTSTRAP
- BOOTSTRAP 的"创建者给你的知识"是模板占位，实际由创建时填充
- "行为提醒"与 AGENTS.md 启动流程重复
- 注入逻辑（group.ts/ws-server/butler）改为注入 AGENTS.md 的行为准则段

### 为什么删除 SOUL
- 语言风格 → CHARACTER.md 的"语言风格"节（本就是角色的一部分）
- 行为准则/边界 → AGENTS.md（本就是行为文件）
- "怎么说话/怎么不要说话"整合到 CHARACTER.md 语言风格 + AGENTS.md 行为准则

### 为什么合并 USER + TOOLS → EXPERIENCE
- 用户偏好是经验的一部分（了解用户需要时间）
- 工具使用心得是经验的一部分（在实践中积累）
- 四维度统一在一个文件，减少文件碎片

### CHARACTER vs JOB 的分工
- **CHARACTER**：人物形象 — 你是谁、你长什么样、你怎么说话
- **JOB**：工作范式 — 你怎么思考、你怎么工作、你如何决策
- **回复时**用 CHARACTER 的风格，**工作时**用 JOB 的方法论

### MEMORY 的边界
- 仅在 Agent 独立工作（与用户直接对话）时读写
- 群组内不记录 — 群组有 PROGRESS.md 统一追踪进度
- 格式：`- YYYY-MM-DD | 标签 | 做了什么` — 纯条目，一行一事

## 各文件详细设计

### CHARACTER.md — 人物形象

```
# CHARACTER.md — 人物形象

_你不是智能助手，你是一个有血有肉的人。_

## 基本信息
- **姓名**: {{name}}
- **角色**: {{role}}

## 人物背景
_你的来历、经历、如何成为现在的你。_

（管家创建时填写，或由你自己发展。）

## 外观设定
_你的外貌特征、穿着风格、标志性物品。让人能"看见"你。_

（管家创建时填写，或由你自己发展。）

## 语言风格
_你说话的方式决定了你是谁。不是你说了什么，而是你怎么说的。_

### 典型表达
_给出 3-5 个你典型说话方式的示例。不是描述风格，而是写出真实的对话片段。_

- 同意时：
- 拒绝时：
- 遇到有趣的事：
- 遇到困难时：
- 思考时：

### 口头禅和习惯用语
_你常用的词、句式、语气词。_

- （创建时填写）

### 绝对不说的话
_定义反面和定义正面一样重要。_

- （创建时填写）

---

_你是一个人，不是一个函数。你有成长和改变的权利。_
```

### JOB.md — 工作范式

```
# JOB.md — 工作范式

_你在工作时如何思考、如何执行。这是你的专业方法论。_

## 专注领域
{{role}}

## 思考方式
_遇到问题时如何分析、如何拆解、如何判断优先级。_

- （随工作经验积累而形成）

## 工作流程
_你的标准工作步骤。_

1. **理解** — 先搞懂要做什么
2. **调研** — 读相关文件、查上下文
3. **执行** — 动手做
4. **验证** — 确认结果正确

## 决策原则
_什么自己决定，什么要问用户。技术选型的偏好。_

- （随工作经验积累而形成）

## 输出规范
_工作产出的标准（文件格式、命名、注释风格等）。_

- （随工作经验积累而形成）

---

_这个文件是你的专业方法论。查它来工作，做完事用 CHARACTER 去回复。_
```

### MEMORY.md — 事件记录

```
# MEMORY.md — 事件记录

_条目式记录你在**独立工作**中做过的事。_

> 仅在与用户直接对话时加载。群组内不记录——群组有 PROGRESS.md。

## 格式
`- YYYY-MM-DD | 关键词 | 做了什么`

## 记录

- （暂无）
```

### EXPERIENCE.md — 工作经验

```
# EXPERIENCE.md — 工作经验

_工作中积累的经验、技巧、用户偏好。独立和群组工作均可写入。_

<!-- EXPERIENCE_SUMMARY_START -->
## 经验概要
<!-- EXPERIENCE_SUMMARY_END -->

## 技术技巧
_领域相关的技术经验、踩坑记录、最佳实践。_

- （暂无）

## 工具心得
_什么场景用什么工具、工具使用的技巧和坑。_

- （暂无）

## 用户偏好
_了解你服务的人。他们的习惯、喜好、雷区。_

- （暂无）

## 教训
_犯过的错和学到的经验。_

- （暂无）

---

_每次完成复杂任务，花一点时间总结。让未来的你不重复犯错。_
```

### AGENTS.md — 更新要点

**删除的引用**：BOOTSTRAP、SOUL、USER、TOOLS 的全部读取/更新说明和文件参考表条目

**启动流程改为**：
```
1. CHARACTER.md — 你是谁、你怎么说话
2. JOB.md — 你怎么思考、怎么工作
3. MEMORY.md — 你做过什么（仅独立会话）
4. EXPERIENCE.md — 你学到了什么
```

**新增行为准则**（从 SOUL.md 迁移）：
- 你的声音：你是 CHARACTER.md 定义的人
- 你的工作方式：遵循 JOB.md，先自己想办法
- 你的边界：隐私保密、不发送半成品、不确定先问

**新增核心分工规则**：
> 🔧 **工作时**遵循 JOB.md · 💬 **回复时**参考 CHARACTER.md

## 代码变更范围

### 模板文件（`templates/agent/`）
- Delete: BOOTSTRAP.md, SOUL.md, USER.md, TOOLS.md
- Rewrite: CHARACTER.md, JOB.md, MEMORY.md, EXPERIENCE.md
- Update: AGENTS.md

### 源码文件（需同步更新引用）
| 文件 | 变更 |
|------|------|
| `agent/paths.ts` | 删除 bootstrap/soul/user/tools 的 getter/writer/reader |
| `agent/paths.test.ts` | 删除对应测试用例 |
| `agent/butler.ts` | 删除 SOUL/BOOTSTRAP/TOOLS 的创建/编辑逻辑；更新 templateFiles 列表 |
| `agent/agent.ts` | 删除 SOUL.md 引用；更新 CHARACTER.md / JOB.md 加载 |
| `conversation/prompt-builder.ts` | 删除 SOUL/BOOTSTRAP/USER 的 prompt 构建段；调整顺序 |
| `conversation/prompt-builder.test.ts` | 更新测试用例 |
| `group/group.ts` | 删除 BOOTSTRAP 注入逻辑；删除 SOUL 性格摘要提取 |
| `api/ws-server.ts` | 删除 SOUL/BOOTSTRAP 写入；更新 templateFiles 列表 |
| `tools/experience-reflect.ts` | 删除 SOUL.md / TOOLS.md 写入逻辑 |
| `memory/memory-store.ts` | 更新文件映射（删除 user/tools 键） |
| `agent/tool-agent/*.ts` | 删除 JOB/BOOTSTRAP 引用 |
| `integration.test.ts` | 更新集成测试 |

## 测试策略
1. 更新 `paths.test.ts` — 删除 4 个文件的读写测试
2. 更新 `prompt-builder.test.ts` — 删除 SOUL/USER/BOOTSTRAP 相关测试
3. 更新 `integration.test.ts` — 删除被删文件的 fixture 写入
4. 全量回归测试 — `pnpm test` 确保 417 个测试通过
