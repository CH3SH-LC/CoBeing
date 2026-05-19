# 群组模块化接口系统设计

> 日期：2026-05-19
> 状态：设计稿

---

## 1. 问题

多 Agent 协作时，各 Agent 独立工作但联系很弱，产出难以整合。Agent 不知道别人提供了什么、怎么接入。

## 2. 设计目标

- 每个群组一个 `INTERFACE.md`，Agent 各占一个 `##` 章节
- Agent 工作完成后被提示更新自己的章节
- Agent 工作前自动看到 INTERFACE.md 全文
- 每条一行，格式：`位置/标识 — 关键参数 — 具体用途`

## 3. 文件格式

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

**格式规则**：
- 每个 Agent 一个 `## Agent名` 章节，内部用 `### 分类` 分组
- 每条仅一行：`位置/标识 — 关键参数 — 具体用途`
- 不写"用途"、"调用方式"等前缀词，所有内容直接可操作
- 位置可以是文件路径、函数签名、资源位置

## 4. 生命周期

| 事件 | 行为 |
|------|------|
| 群组创建 | 自动生成 INTERFACE.md，含所有初始成员的 `##` 空章节 |
| 新增成员 | INTERFACE.md 追加该成员的 `##` 空章节 |
| 删除成员 | 不删除其章节（保留遗留接口供参考） |
| 群组销毁 | 随群组目录一起删除 |

## 5. 注入机制

在 `prompt-builder.ts` 的群组上下文段中，与 TASK.md / PLAN.md / PROGRESS.md 并列注入 INTERFACE.md 内容：

```
--- 群组接口 ---
{INTERFACE.md 全文}
```

Agent 在 system prompt 末尾附加写作提示：

> "工作完成后，若产生可供其他成员使用的接口、数据、资源或需求，请在群组 INTERFACE.md 你的章节下按 ### 分类 → - 位置 参数 用途 格式记录。每条仅一行。"

## 6. 改动范围

### 新增/修改文件

| 文件 | 操作 | 内容 |
|------|------|------|
| `packages/core/src/group/workspace.ts` | Modify | 新增 `readInterface()` / `writeInterface()` / `appendMemberSection()` 方法 |
| `packages/core/src/group/group.ts` | Modify | `addMember()` 中调用 `workspace.appendMemberSection()` |
| `packages/core/src/group/manager.ts` | Modify | `create()` 中调用 `workspace.writeInterface()` 生成初始文件 |
| `packages/core/src/conversation/prompt-builder.ts` | Modify | 群组上下文段新增 INTERFACE.md 注入 + 追加写作提示 |

### 不需要改动
- 不需要新增工具（复用 write-file / edit-file）
- 不需要前端改动（INTERFACE.md 是 Agent 内部协作文档）
- 不需要类型定义改动

## 7. 边界情况

| 场景 | 行为 |
|------|------|
| INTERFACE.md 不存在 | prompt 注入时跳过，不阻断 Agent 运行 |
| Agent 无 interface 产出 | 不强制要求，章节保持空白 |
| 两个 Agent 同时写 INTERFACE.md | 文件级原子写入，后写覆盖前写（与现有文件操作行为一致） |
| Agent 名含特殊字符（`#`） | 章节名用 Agent 的 displayName，已有 `##` 转义 |
