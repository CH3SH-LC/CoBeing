# GUIDE.md + EXPERIENCE.md 概要机制

## 目标

新增 GUIDE.md 作为群组级规则文件，为 EXPERIENCE.md 新增概要机制使 System Prompt 只注入概要而非全量内容，减少 token 浪费。

## Part A: GUIDE.md 群组规则系统

### 定位

- **AGENTS.md** = 智能体自身的行为规则（个人规则，已存在）
- **GUIDE.md** = 群组的协作规则（群组规则，新增）

两者互不替代，各自服务于不同层级。

### 文件位置与发现链

```
data/groups/{groupId}/workspace/GUIDE.md   ← 群组专属规则（优先）
data/GUIDE.md                              ← 全局默认规则（回退）
```

发现逻辑：先查群组 workspace，找不到则用 data/ 根目录，都找不到则不注入（GUIDE.md 非必需文件）。

### 注入规则

- **仅群组 loop 注入**（`createGroupLoop`），非群组 Agent 不读 GUIDE.md
- **注入位置**：Layer 3（volatile），在群组协作上下文之前
- **注入方式**：读取文件内容 → 截断（上限 4000 字符）→ 拼入 volatile

### 模板文件

`config/templates/groups/GUIDE.md`（新建）：

```markdown
# {groupName} 群组规则

## 协作约定
- 修改共享文件前先检查是否有其他成员正在编辑。
- 重要决策需 @mention 群主确认后再执行。

## 工作流约束
- （根据群组需求自定义）

## 沟通规范
- （根据群组需求自定义）
```

### Prompt 组装变更（agent.ts createGroupLoop）

```
parts = [_sharedPrefix, GROUP_MECHANICS_NOTICE, _agentPrefix, volatile]
```

volatile 内部顺序：GUIDE.md 内容 → 记忆快照 → 群组协作上下文

---

## Part B: EXPERIENCE.md 概要机制

### 文件结构调整

在 EXPERIENCE.md 头部新增概要区，用 HTML 注释标记分隔：

```markdown
# EXPERIENCE.md — 工作经验

<!-- EXPERIENCE_SUMMARY_START -->
## 经验概要
- [2026-05-25] 工具发现：Windows 上 bash 编码问题需 chcp 65001
- [2026-05-25] 用户偏好：用户希望回复使用中文而非英文
<!-- EXPERIENCE_SUMMARY_END -->

## 详细经验

### 2026-05-25
...
```

### System Prompt 注入变更

**当前**：`MemoryStore.snapshotForSystemPrompt()` 注入 EXPERIENCE.md 全部内容（上限 5000 字符）。

**改为**：对 experience 目标，从 EXPERIENCE.md 文件中提取概要区内容（标记之间的文本），替代全量注入。其他目标（memory/user/tools）保持不变。

```typescript
// memory-store.ts snapshotForSystemPrompt 中 experience 的处理:
// 从 EXPERIENCE.md 文件中提取 <!-- EXPERIENCE_SUMMARY_START --> 到 <!-- EXPERIENCE_SUMMARY_END --> 之间的内容
// 若文件不存在或无概要标记 → 回退到全量内容（兼容旧文件）
// 概要超过 1500 字符 → 倒序截断取最近条目
```

Agent 需要详细经验时通过 `read_file` 工具按需读取 EXPERIENCE.md 正文。

### 概要维护规则

- **文件不删条目**：EXPERIENCE.md 所有条目（概要 + 正文）永久保留在文件中
- **注入截断**：概要区超过 1500 字符时，注入只取最近 N 条（倒序截断）
- **每行限制**：每行摘要不超过 120 字符
- **位置**：新概要条目插入到概要区最前面（倒序，最新在前）

### 写入时维护概要区

`AgentFiles.appendExperience()` 写入详细经验到正文区的同时，在概要区最前面插入一行摘要。`MemoryStore.add("experience", ...)` 同样需要维护概要区。

提取函数 `maintainExperienceSummary(filePath: string, summaryLine: string)`：
1. 读取 EXPERIENCE.md
2. 找到 `<!-- EXPERIENCE_SUMMARY_START -->` 和 `<!-- EXPERIENCE_SUMMARY_END -->`
3. 在概要区最前面插入新行
4. 写回文件

---

## 改动范围

| 文件 | 变更 |
|------|------|
| `packages/core/src/agent/paths.ts` | 新增 `guidePath` getter（群组 workspace 下） |
| `packages/core/src/agent/agent.ts` | `createGroupLoop` 的 promptBuilder 读取 GUIDE.md 注入 volatile |
| `packages/core/src/conversation/prompt-builder.ts` | 新增 `extractExperienceSummary()` 工具函数；`buildCacheablePrompt` volatile 中 EXPERIENCE 改用概要 |
| `packages/core/src/memory/memory-store.ts` | `snapshotForSystemPrompt` 对 experience 目标提取概要 |
| `packages/core/src/memory/writer.ts` | `appendExperience` 写入时同步维护概要区 |
| `config/templates/EXPERIENCE.md` | 新增概要区标记 |
| `config/templates/groups/GUIDE.md` | **新建** — 群组规则模板 |

## 测试策略

- 单元测试：`extractExperienceSummary()` — 有概要标记返回概要，无标记返回全量，空文件返回空字符串
- 单元测试：概要超过 1500 字符时倒序截断
- 单元测试：`maintainExperienceSummary()` — 写入后概要区正确更新
- 集成测试：群组 Agent prompt 包含 GUIDE.md 内容，非群组 Agent 不包含
- 回归测试：现有 290 tests 全部通过

## 不变更

- AGENTS.md 内容和行为完全不变
- MEMORY.md / USER.md / TOOLS.md 注入逻辑不变
- GUIDE.md 非必需 — 文件不存在时不影响 Agent 正常运行
