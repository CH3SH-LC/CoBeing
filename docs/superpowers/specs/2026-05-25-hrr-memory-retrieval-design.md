# 方案 8 — HRR 多策略记忆检索 设计规格

> 来源: `docs/调研/综合调研-可执行改进方案.txt` 方案 8
> P2, 复杂度中高

## 概述

增强 CoBeing 的记忆检索系统，从单一 FTS5 排名升级为三策略融合评分（FTS5 + Jaccard 相似度 + 信任衰减），并预留阶段 2 的 HRR 相位向量接口。

## Phase 1: FTS5 + Jaccard + 信任衰减

### 1.1 Schema 变更

`entries` 表新增列（`ALTER TABLE ADD COLUMN IF NOT EXISTS` 自动迁移）：

| 列 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `trust` | REAL | 0.5 | 信任分数，范围 [0.0, 1.0] |
| `half_life_days` | INTEGER | 30 | 该条目的时间衰减半衰期（天） |
| `helpful_count` | INTEGER | 0 | 被标记为有用的次数 |
| `unhelpful_count` | INTEGER | 0 | 被标记为无用的次数 |
| `last_accessed_at` | INTEGER | NULL | 最后被检索命中的时间戳（毫秒） |
| `hrr_vector` | BLOB | NULL | 阶段 2 预留：1024 维 Float64Array 序列化 |

### 1.2 配置项

`MemoryStoreConfig` 新增字段：

```typescript
interface MemoryStoreConfig {
  // 已有
  charLimits?: Partial<Record<MemoryTarget, number>>;
  // 新增
  defaultHalfLifeDays?: number;    // 默认 30
  trustHelpfulDelta?: number;      // 默认 +0.1
  trustUnhelpfulDelta?: number;    // 默认 -0.15
  trustDuplicatePenalty?: number;  // 默认 -0.05
  minTrust?: number;               // 默认 0.0
  maxTrust?: number;               // 默认 1.0
}
```

### 1.3 多策略评分公式

搜索流程：FTS5 粗筛 50 条候选 → 逐条计算评分 → 按 `final_score` 降序 → 取 top N。

**FTS5 归一化：**
```
fts_score = 1 / (1 + rank)
```
rank 为 SQLite FTS5 内置排名（越小越好），归一化到 (0, 1]。

**Jaccard 相似度：**
```
jaccard_sim = |Q ∩ E| / |Q ∪ E|
```
用 `Intl.Segmenter("zh-CN", { granularity: "word" })` 对查询词 Q 和条目内容 E 分别分词，计算交集/并集。

**相关性融合（Phase 1）：**
```
relevance = 0.5 * fts_score + 0.5 * jaccard_sim
```
Phase 2 将调整为 `0.4 * fts + 0.3 * jaccard + 0.3 * hrr`。

**时间衰减：**
```
temporal_decay = 0.5^(age_days / half_life_days)
```
- `age_days = (Date.now() - created_at) / 86400000`
- `half_life_days` 默认为 30，可由条目独立配置

**最终得分：**
```
final_score = relevance * trust * temporal_decay
```

### 1.4 信任反馈

**手动反馈 — `memory-feedback` 工具：**

新增工具，Agent 通过搜索词指定目标条目并标记：
- 参数：`query` (搜索词), `target?` (目标类型), `action` ("helpful" | "unhelpful")
- 流程：`searchEntries(query, target, 1)` → 取第一条 → `adjustTrust(id, delta)`

**自动推断：**

1. `reflectFromHistory()` 成功提取经验时 → 搜索相关旧条目 → 自动 `adjustTrust(id, +0.1)`
2. `add()` 去重检测到相同内容 → 匹配到的旧条目自动 `adjustTrust(id, -0.05)`

**信任调整方法：**

```typescript
// MemoryStore 新增
adjustTrust(id: number, delta: number): void    // trust = clamp(trust + delta, min, max)
markHelpful(id: number): void                   // adjustTrust(id, +0.1), helpful_count++
markUnhelpful(id: number): void                 // adjustTrust(id, -0.15), unhelpful_count++
```

**`entry_access` 追踪：** `searchEntries` 每次命中条目时更新该条目的 `last_accessed_at`，用于后续淘汰/排序参考。

### 1.5 搜索流程改动

```
searchEntries(query, target?, limit)
  1. FTS5/LIKE 粗筛 50 条候选
  2. 对每条候选:
     a. 计算 fts_score（FTS5 路径有 rank，LIKE 路径 rank = 估算值）
     b. 计算 jaccard_sim（逐条分词 + 集合运算）
     c. 计算 temporal_decay（基于 created_at 和 half_life_days）
     d. final_score = (0.5*fts + 0.5*jaccard) * trust * decay
     e. 更新 last_accessed_at = Date.now()
  3. 按 final_score 降序排列
  4. 取前 limit 条
  5. 为每条生成 snippet（已有逻辑保持不变）
```

**返回类型扩展：**

```typescript
interface EntryRow {
  // 已有字段
  id: number;
  target: string;
  content: string;
  created_at: number;
  updated_at: number;
  snippet?: string;
  // 新增字段
  trust: number;
  helpful_count: number;
  unhelpful_count: number;
  last_accessed_at: number | null;
  // 评分详情（仅 search 时填充）
  fts_score?: number;
  jaccard_sim?: number;
  temporal_decay?: number;
  final_score?: number;
}
```

**降级策略：** FTS5 不可用时走 LIKE 粗筛（`content LIKE '%query%'`），仍计算 Jaccard + 信任 + 衰减。LIKE 路径的 `fts_score` 使用简单的子串匹配长度比例估算。

## Phase 2: HRR 框架预留

### 2.1 hrr.ts — 接口 + 桩实现

```typescript
// packages/core/src/memory/hrr.ts

export type HrrVector = Float64Array; // 1024 维

export interface HrrEncoder {
  readonly dim: number;
  encodeAtom(word: string): HrrVector;
  bind(a: HrrVector, b: HrrVector): HrrVector;
  unbind(memory: HrrVector, key: HrrVector): HrrVector;
  bundle(...vectors: HrrVector[]): HrrVector;
  similarity(a: HrrVector, b: HrrVector): number;
}

export class StubHrrEncoder implements HrrEncoder {
  readonly dim = 1024;
  encodeAtom(): HrrVector { throw new Error("HRR Phase 2 not implemented"); }
  bind(): HrrVector { throw new Error("HRR Phase 2 not implemented"); }
  unbind(): HrrVector { throw new Error("HRR Phase 2 not implemented"); }
  bundle(): HrrVector { throw new Error("HRR Phase 2 not implemented"); }
  similarity(): number { throw new Error("HRR Phase 2 not implemented"); }
}
```

### 2.2 预留集成点

- `entries.hrr_vector` 列已建，阶段 2 写入
- `relevance` 公式中 HRR 权重为 0，阶段 2 改为 0.3
- `hrr.ts` 导出 `StubHrrEncoder`，调用方按接口编程，阶段 2 替换为 `Sha256HrrEncoder` 即可

## Phase 2 完整规格（后续实现）

### HRR 核心操作

1. `encodeAtom(word)` — SHA-256 确定性 1024 维相位向量 [0, 2π)
2. `bind(a, b) = (a + b) % 2π` — 绑定两个向量
3. `unbind(memory, key) = (memory - key) % 2π` — 解出被绑定的值
4. `bundle(*vectors)` — 复数指数圆形均值叠加
5. `similarity(a, b) = mean(cos(a - b))` — 余弦相似度

### 三策略检索融合（完整版）

```
relevance = 0.4 * fts_score + 0.3 * jaccard_sim + 0.3 * hrr_sim
final_score = relevance * trust * temporal_decay
```

### 三种组合查询

- **probe:** 解出与查询相关的记忆片段
- **related:** 找到与给定记忆相似的条目
- **reason:** 组合推理：查询 + 上下文 → 推断关联记忆

### 实体提取

```
_CAPITALIZED = r'\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b'
_DOUBLE_QUOTE = r'"([^"]+)"'
_SINGLE_QUOTE = r"'([^']+)'"
_AKA = r'(\w+(?:\s+\w+)*)\s+(?:aka|also known as)\s+(\w+(?:\s+\w+)*)'
```

## 文件清单

| 操作 | 文件 | 说明 |
|------|------|------|
| Modify | `packages/core/src/memory/sqlite-adapter.ts` | Schema 迁移 + EntryRow 扩展 + 多策略 searchEntries + adjustTrust + last_accessed_at 更新 + Jaccard 计算 |
| Modify | `packages/core/src/memory/memory-store.ts` | MemoryStoreConfig 扩展 + markHelpful/markUnhelpful + reflectFromHistory 自动反馈 + add 去重自动降分 + searchEntries 传递评分详情 |
| Modify | `packages/core/src/memory/memory-tool.ts` | 新增 memory-feedback 工具 |
| Create | `packages/core/src/memory/hrr.ts` | HrrEncoder 接口 + StubHrrEncoder |
| Modify | `packages/core/src/memory/memory-store.test.ts` | 新增评分 + 反馈相关测试 |
| Modify | `packages/core/src/memory/sqlite-adapter.test.ts` | 新增 searchEntries 评分 + 列迁移测试 |
| Create | `packages/core/src/memory/hrr.test.ts` | StubHrrEncoder 接口验证测试 |

## 不涉及

- 前端 — 纯后端记忆检索增强
- `reader.ts` / `writer.ts` / `indexer.ts` — 这些文件使用 MemoryStore 接口，无需改动
- EXPERIENCE.md 概要机制 — 已在方案 4 中完成
- 安全扫描 — 已在方案 9 中完成
