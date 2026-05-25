# 记忆系统重构设计

> 日期：2026-04-24 | 子系统：A 记忆系统 | 参考：Hermes memory_tool.py + session_search_tool.py

---

## 目标

将当前散落在 MemoryWriter / MemoryReader / MemoryIndexer / ExperienceWriter 四个类中的记忆逻辑，合并为统一的 `MemoryStore` 引擎，实现：

1. Agent 通过 `memory` 工具自主管理记忆（add / replace / remove / read）
2. 冻结快照保证会话内 system prompt 稳定
3. 原子文件操作 + 安全扫描 + 字符上限
4. SQLite FTS5 全文搜索替代逐行 grep
5. 双写（SQLite + Markdown）+ 启动时 md 优先同步
6. 四个目标的字符上限可在配置文件中修改

---

## 数据架构

### 双存储

每个 Agent 维护两个存储：

| 存储 | 路径 | 用途 |
|------|------|------|
| Markdown 文件 | `data/agents/{id}/MEMORY.md` 等 | 人类可读写、版本控制友好、权威来源 |
| SQLite 数据库 | `data/agents/{id}/memory.db` | FTS5 全文搜索、快速查询 |

**权威来源是 Markdown**。启动时对比 md 和 SQLite，以 md 为准同步到 SQLite。

### 四个目标

| 目标 | 文件 | 语义 | 默认上限 | 加载规则 |
|------|------|------|---------|---------|
| `memory` | MEMORY.md | 事件记录，Agent 的个人笔记 | 3000 字符 | 仅主会话加载 |
| `experience` | EXPERIENCE.md | 工作经验（领域+协作） | 5000 字符 | 所有会话加载 |
| `user` | USER.md | 用户画像、偏好、习惯 | 2000 字符 | 最高优先级 |
| `tools` | TOOLS.md | 工具调用策略、场景映射 | 3000 字符 | 所有会话加载 |

### 对话历史

对话历史（每日 .md 文件中的记录）也写入 SQLite 的 `history` 表，支持跨天全文搜索。

---

## SQLite Schema

```sql
-- 记忆条目（对应四个 md 文件）
CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target TEXT NOT NULL,        -- memory / experience / user / tools
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
  content, target,
  content='entries', content_rowid='id'
);

-- 对话历史（对应 memory/YYYY-MM-DD.md）
CREATE TABLE IF NOT EXISTS history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session TEXT NOT NULL,       -- main / group:xxx:main / group:xxx:talk:yyy
  role TEXT NOT NULL,          -- user / assistant / system / tool
  content TEXT NOT NULL,
  tool_name TEXT,
  timestamp INTEGER NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS history_fts USING fts5(
  content, session,
  content='history', content_rowid='id'
);

-- 同步标记（记录 md 文件的最后修改时间）
CREATE TABLE IF NOT EXISTS sync_state (
  target TEXT PRIMARY KEY,     -- memory / experience / user / tools / history:{date}
  mtime INTEGER NOT NULL       -- md 文件的最后修改时间戳
);
```

---

## 核心类：MemoryStore

```
MemoryStore
├── 构造(agentId, dataDir, config, provider?)
│   ├── 读取配置中的字符上限（或使用默认值）
│   ├── 打开/创建 SQLite 数据库
│   ├── 从 Markdown 同步到 SQLite（md 为权威）
│   └── 生成冻结快照
│
├── 工具接口（Agent 通过 memory 工具调用）
│   ├── add(target, content) → 检查安全+容量+重复 → 双写(md+SQLite) → 返回结果
│   ├── replace(target, oldText, newContent) → 子串匹配 → 检查安全+容量 → 双写
│   ├── remove(target, oldText) → 子串匹配 → 双写
│   └── read(target?) → 返回指定或全部目标的当前条目
│
├── 快照接口（prompt-builder 使用）
│   ├── formatForSystemPrompt(target) → 返回冻结快照块（带用量指示器）
│   └── snapshotForSystemPrompt() → 返回四个目标的拼接快照
│
├── 搜索接口
│   ├── searchEntries(query, target?, limit?) → FTS5 搜索记忆条目
│   └── searchHistory(query, session?, limit?) → FTS5 搜索对话历史
│
├── 对话历史接口
│   └── appendHistory(entry) → 双写(md 每日文件 + SQLite)
│
├── 经验反思接口
│   └── reflectFromHistory(task, history) → LLM 总结 → add("experience", ...)
│
└── 私有方法
    ├── syncFromMarkdown() → 启动时 md → SQLite 同步
    ├── atomicWrite(filePath, content) → 临时文件 + rename
    ├── scanContent(content) → 安全扫描（注入/泄露/隐形字符）
    ├── parseEntries(mdContent) → 将 md 内容解析为条目数组
    ├── renderEntries(entries) → 将条目数组渲染回 md 格式
    └── checkCapacity(target, delta) → 检查字符上限
```

---

## 详细设计

### 1. 条目格式

条目之间使用 `§` 分隔符（与 Hermes 一致）：

```markdown
这是第一条记忆内容

§

这是第二条记忆内容，可以多行

§

第三条记忆
```

**解析规则**：
- `parseEntries(mdContent)` 去掉文件头（`# MEMORY.md` 等标题行），按 `\n§\n` 分割，trim 后过滤空条目
- `renderEntries(entries)` 生成文件头 + 条目列表 + 分隔符

### 2. 冻结快照

```typescript
interface Snapshot {
  memory: string;
  experience: string;
  user: string;
  tools: string;
}
```

- `MemoryStore` 构造时读取四个 md 文件，解析为条目，生成快照
- `formatForSystemPrompt(target)` 返回格式化块：
  ```
  ══════════════════════════════════════════════════
  MEMORY (你的个人笔记) [45% — 1,350/3,000 chars]
  ══════════════════════════════════════════════════
  {条目内容}
  ```
- 会话内通过 `memory` 工具的写入只更新磁盘和 SQLite，不更新快照
- 快照在下次会话（新 MemoryStore 实例）时刷新

### 3. 原子文件操作

```typescript
private atomicWrite(filePath: string, content: string): void {
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, content, 'utf-8');
  fs.renameSync(tmpPath, filePath);
}
```

所有写入（md 文件）都通过 `atomicWrite`，替代 `appendFileSync` 和 `writeFileSync`。

### 4. 安全扫描

```typescript
private static THREAT_PATTERNS = [
  { pattern: /ignore\s+(previous|all|above)\s+instructions/i, id: 'prompt_injection' },
  { pattern: /you\s+are\s+now\s+/i, id: 'role_hijack' },
  { pattern: /system\s+prompt\s+override/i, id: 'sys_prompt_override' },
  { pattern: /curl\s+.*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD)/i, id: 'exfil_curl' },
  { pattern: /wget\s+.*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD)/i, id: 'exfil_wget' },
];

private static INVISIBLE_CHARS = ['\u200b', '\u200c', '\u200d', '\u2060', '\ufeff'];
```

`add()` / `replace()` 前调用 `scanContent(content)`，命中则返回错误：
```json
{ "success": false, "error": "Blocked: content matches threat pattern 'prompt_injection'." }
```

### 5. 启动同步（md → SQLite）

```typescript
private syncFromMarkdown(): void {
  for (const target of ['memory', 'experience', 'user', 'tools']) {
    const mdPath = this.pathFor(target);
    const mdMtime = this.getMtime(mdPath);
    const lastSync = this.getLastSync(target);

    if (mdMtime > lastSync) {
      // md 有更新，重新解析并同步到 SQLite
      const content = this.readFile(mdPath);
      const entries = this.parseEntries(content, target);
      this.replaceSqliteEntries(target, entries);
      this.updateSyncState(target, mdMtime);
    }
  }

  // 对话历史：扫描 memory/ 目录下的 .md 文件
  this.syncHistoryFromFiles();
}
```

**同步历史文件**：扫描 `memory/YYYY-MM-DD.md`，对比文件修改时间，将新文件或修改过的文件内容解析后插入 SQLite `history` 表。

### 6. memory 工具 Schema

```json
{
  "name": "memory",
  "description": "管理你的持久化记忆。记忆会在未来会话中加载，保持简洁聚焦。\n\n四个目标：\n- memory: 你的个人笔记（环境事实、项目约定、工具经验）\n- experience: 工作经验（领域+协作经验、教训总结）\n- user: 用户画像（偏好、习惯、沟通风格）\n- tools: 工具策略（场景→工具映射）\n\n操作：add（新增）、replace（替换，用 old_text 定位）、remove（删除）、read（查看）。\n\n写入前会检查安全性和容量。超限时需要合并旧条目或删除过时信息。",
  "parameters": {
    "type": "object",
    "properties": {
      "action": {
        "type": "string",
        "enum": ["add", "replace", "remove", "read"],
        "description": "操作类型"
      },
      "target": {
        "type": "string",
        "enum": ["memory", "experience", "user", "tools"],
        "description": "目标存储"
      },
      "content": {
        "type": "string",
        "description": "条目内容（add 和 replace 必填）"
      },
      "old_text": {
        "type": "string",
        "description": "定位已有条目的短子串（replace 和 remove 必填）"
      }
    },
    "required": ["action", "target"]
  }
}
```

### 7. 配置

字符上限在 `config/default.json` 中配置：

```json
{
  "memory": {
    "charLimits": {
      "memory": 3000,
      "experience": 5000,
      "user": 2000,
      "tools": 3000
    }
  }
}
```

`MemoryStore` 构造时读取配置，未配置的 key 使用默认值。

### 8. prompt-builder 改造

`buildSystemPromptFromFiles()` 签名变为：

```typescript
export function buildSystemPromptFromFiles(
  files: AgentFiles,
  memoryStore: MemoryStore,
  config: PromptConfig
): string
```

加载顺序不变：SOUL → CHARACTER → BOOTSTRAP → systemPrompt(role) → JOB → AGENTS → **MemoryStore 快照（USER → TOOLS → EXPERIENCE → MEMORY）**

其中 USER / TOOLS / EXPERIENCE / MEMORY 从 `memoryStore.formatForSystemPrompt(target)` 获取（带用量指示器），而非直接 `files.readXxx()`。

### 9. Agent 集成

```typescript
// Agent 构造中
this.memoryStore = new MemoryStore(config.id, paths, memoryConfig, provider);
this.paths.ensureDirs();

// 注册 memory 工具
this.toolRegistry.register(makeMemoryTool(this.memoryStore));

// 构建 system prompt
const enhancedPrompt = buildSystemPromptFromFiles(this.files, this.memoryStore, { ... });

// run() 中用 memoryStore.appendHistory() 替代 memoryWriter.append()
await this.memoryStore.appendHistory({ session: "main", role: "user", content: input });

// reflectInBackground 中用 memoryStore.reflectFromHistory()
```

### 10. 搜索结果智能截断

搜索对话历史时，如果匹配的会话内容超过 100K 字符，使用以匹配位置为中心的窗口截断：

1. 先找完整短语匹配位置
2. 无短语则找所有搜索词 200 字符内共现位置
3. 兜底用单个词位置
4. 选择覆盖最多匹配位置的窗口（25% 前置，75% 后置）

---

## 文件清单

| 操作 | 文件 |
|------|------|
| 新建 | `packages/core/src/memory/memory-store.ts` — 统一存储引擎 |
| 新建 | `packages/core/src/memory/memory-tool.ts` — memory 工具定义 |
| 新建 | `packages/core/src/memory/security-scan.ts` — 安全扫描 |
| 新建 | `packages/core/src/memory/sqlite-adapter.ts` — SQLite 封装 |
| 修改 | `packages/core/src/agent/agent.ts` — 集成 MemoryStore + 注册工具 |
| 修改 | `packages/core/src/conversation/prompt-builder.ts` — 接收 MemoryStore |
| 修改 | `config/default.json` — 添加 memory.charLimits 配置 |
| 修改 | `packages/core/src/index.ts` — 导出 MemoryStore |
| 废弃 | `packages/core/src/memory/writer.ts` — 被 MemoryStore 取代 |
| 废弃 | `packages/core/src/memory/reader.ts` — 被 MemoryStore 取代 |
| 废弃 | `packages/core/src/memory/indexer.ts` — 被 MemoryStore 取代 |
| 依赖 | `better-sqlite3` + `@types/better-sqlite3` |

---

## 兼容性

- 现有 `ExperienceWriter.appendExperience()` / `AgentFiles.appendExperience()` 保留为兼容方法，内部委托给 `MemoryStore.add("experience", ...)`
- `MemoryWriter.append()` 保留签名，内部委托给 `MemoryStore.appendHistory()`
- 群组系统（Group / Screener）中如有直接读取记忆的逻辑，改为通过 `MemoryStore` 快照

---

## 风险

| 风险 | 缓解 |
|------|------|
| better-sqlite3 在 Windows 上需要编译 | 使用 prebuild 版本；如编译失败可降级到纯文件模式 |
| md → SQLite 同步在大量历史时启动慢 | 只同步修改时间变化的文件；首次全量后增量 |
| 条目格式解析边界情况 | 保留 Hermes 验证过的 § 分隔符方案 |
