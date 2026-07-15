# 群组模块化接口系统设计

> 日期：2026-05-19
> 状态：设计稿

---

## 1. 问题

多智能体协作中，不同 Agent 产出之间联系弱，缺乏结构化的接口文档让彼此知道"你有什么可以用"和"我产出的是什么"。

## 2. 设计目标

- 群组新增 `INTERFACE.md`，Agent 各占一个 `##` 章节
- Agent 工作后自动被提示更新自己的接口段落
- Agent 工作前自动看到完整的 INTERFACE.md
- 简洁可操作：一行一个接口，格式 `位置 — 参数 — 具体用途`

## 3. 文件格式

### 3.1 模板

```markdown
# 群组接口

## {Agent-Name-1}

## {Agent-Name-2}
```

### 3.2 示例

```markdown
# 群组接口

## 算法专家

### 推荐结果
- `data/recommendations.json` — `[{user_id, items:[{id,score}]}]` — 渲染首页推荐卡片列表

### recommend() 函数
- `scripts/recommend.py` → `recommend(user_id, top_k=10)` — 按需获取单个用户推荐

## 美术

### 首页横幅
- `assets/banner.png` (1920×600) — 首页顶部主视觉

### 卡片背景
- `assets/card-bg.png` (400×300) — 推荐卡片底图，需叠加文字和评分

## 演讲稿写作

### 需要PPT
- 封面页 ×1 — 标题+演讲人
- 数据摘要页 ×2 — 第2章"市场分析"的图表数据
- 总结页 ×1 — 三点核心结论
```

### 3.3 接口条目格式

```
- 位置/标识 — 关键参数 — 具体用途
```

每条一行，不写"用途："等模板前缀，每条都是可直接操作的有效信息。

## 4. 生命周期

### 4.1 创建

群组创建时，`GroupManager.create()` 生成 INTERFACE.md，含所有初始成员的 `##` 空章节。

### 4.2 新增成员

`Group.addMember()` 调用 `GroupWorkspace.appendInterfaceSection(agentName)`，在 INTERFACE.md 末尾追加该成员的 `##` 空章节。

### 4.3 删除成员

不删除其章节。旧成员的接口信息保留供后人参考。

### 4.4 群组销毁

随群组目录一并删除。

## 5. GroupWorkspace 新增方法

```typescript
interface GroupWorkspace {
  // 现有方法...
  
  readInterface(): string
  writeInterface(content: string): void
  appendInterfaceSection(agentName: string): void
}
```

- `readInterface()` — 读取 `data/groups/{id}/INTERFACE.md`
- `writeInterface(content)` — 写入完整内容
- `appendInterfaceSection(agentName)` — 在末尾追加 `## {agentName}\n\n`，幂等：该 Agent 已有章节则跳过

## 6. 上下文注入

### 6.1 prompt-builder.ts

在群组上下文段（GROUP_CONTEXT）紧跟 PROGRESS.md 之后注入：

```
---
群组接口

{INTERFACE.md 全文}
```

Agent 每次群组唤醒时自动看到完整的 INTERFACE.md。

### 6.2 Agent 写作提示

在 Agent 的 system prompt 中（BOOTSTRAP.md 或 prompt-builder.ts 末尾）追加一行：

> 如有可供其他成员使用的产出（数据、函数、资源、需求），在群组 INTERFACE.md 你的章节下按 `- 位置/标识 — 关键参数 — 具体用途` 格式追加一行。已有条目勿重复。

## 7. 与现有工作区文件的关系

| 文件 | 谁写 | 谁读 | 用途 |
|------|------|------|------|
| TASK.md | Host | 全员 | 任务分解 |
| PLAN.md | Host | 全员 | 执行计划 |
| PROGRESS.md | Host | 全员 | 进度追踪 |
| INTERFACE.md | **全员** | 全员 | 接口对接 |
| MEMBERS.md | 系统 | 全员 | 成员清单 |
| EXPERIENCE.md | 系统 | 全员 | 经验沉淀 |
| STRUCTURE.md | 系统 | 全员 | 目录结构 |

## 8. 改动清单

| 文件 | 改动 |
|------|------|
| `packages/core/src/group/workspace.ts` | 新增 `readInterface()` / `writeInterface()` / `appendInterfaceSection()` |
| `packages/core/src/group/group.ts` | `addMember()` 调用 `appendInterfaceSection()` |
| `packages/core/src/group/manager.ts` | `create()` 中生成初始 INTERFACE.md |
| `packages/core/src/conversation/prompt-builder.ts` | GROUP_CONTEXT 段注入 INTERFACE.md |
| `config/templates/BOOTSTRAP.md` | 追加接口更新提示 |
