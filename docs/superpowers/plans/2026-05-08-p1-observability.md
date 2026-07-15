# P1.4 可观测性 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 CoBeing 添加完整的可观测性基础设施：LLM 调用日志、工具调用审计、Token 消耗聚合、响应时间监控。

**Architecture:** 新建 `ObservabilityDB`（better-sqlite3）→ ConversationLoop / ToolExecutor 埋点写入 → Agent / Runtime 注入共享实例 → 3 个新 WS 命令 → 前端 Dashboard 页面。

**Tech Stack:** TypeScript, better-sqlite3, ws, React 19, Zustand, Tailwind CSS

**构建:** 后端 .ts 变更需 `pnpm build`；前端 `cd gui-v2 && npm run build`

---

## 文件变动总览

| 操作 | 文件 | 职责 |
|------|------|------|
| Create | `packages/core/src/observability/observability-db.ts` | SQLite 建表、写入、聚合查询 |
| Modify | `packages/core/src/conversation/conversation-loop.ts` | 注入 DB，LLM 调用计时+写入 |
| Modify | `packages/core/src/tools/executor.ts` | 注入 DB，工具调用计时+写入 |
| Modify | `packages/core/src/agent/agent.ts` | 接收 DB，传入 loop 和 executor |
| Modify | `packages/core/src/runtime.ts` | 创建单例 DB，注入 butler/agents，dispose 关闭 |
| Modify | `packages/core/src/api/ws-server.ts` | 注册 get_dashboard / get_llm_stats / get_tool_stats |
| Create | `gui-v2/src/stores/observability.ts` | Zustand store |
| Modify | `gui-v2/src/lib/types.ts` | ViewType 加 "dashboard"，DashboardData 类型 |
| Modify | `gui-v2/src/components/layout/NavBar.tsx` | 导航加 📊 |
| Modify | `gui-v2/src/components/layout/MainContent.tsx` | 路由 dashboard |
| Create | `gui-v2/src/components/observability/DashboardView.tsx` | 主页面 |
| Create | `gui-v2/src/components/observability/TokenCard.tsx` | Token 卡片 |
| Create | `gui-v2/src/components/observability/LatencyCard.tsx` | 延迟卡片 |
| Create | `gui-v2/src/components/observability/ToolRankCard.tsx` | 工具排行卡片 |
| Create | `gui-v2/src/components/observability/AgentActivityCard.tsx` | Agent 活跃度卡片 |
| Modify | `gui-v2/src/hooks/useWebSocket.ts` | 处理 dashboard / llm_stats / tool_stats 响应 |

---

### Task 1: 创建 ObservabilityDB

**Files:** Create: `packages/core/src/observability/observability-db.ts`

- [ ] **Step 1: 创建 ObservabilityDB 类**

```typescript
import Database from "better-sqlite3";
import type { Database as BetterSqlite3Database } from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { createLogger } from "@cobeing/shared";

const log = createLogger("observability-db");

export interface LLMCallRecord {
  agent_id: string; agent_name: string; group_id?: string;
  model: string; provider: string; latency_ms: number;
  input_tokens: number; output_tokens: number;
  cache_hit_tokens: number; cache_miss_tokens: number;
  is_error: number; error_message?: string; fallback_used: number;
  round: number; timestamp: number;
}

export interface ToolCallRecord {
  agent_id: string; agent_name: string; group_id?: string;
  tool_name: string; is_error: number; latency_ms: number;
  param_chars: number; result_chars: number; timestamp: number;
}

export interface DashboardData {
  tokens: { today: number; total: number; daily: { date: string; input: number; output: number }[] };
  latency: { p50: number; p95: number; hourly: { hour: string; avg: number }[] };
  tools: { name: string; count: number; errorRate: number }[];
  errors: { llmErrorRate: number; llmErrors: number; llmTotal: number;
            toolErrorRate: number; toolErrors: number; toolTotal: number; fallbackCount: number };
  agents: { agentId: string; agentName: string; callCount: number; totalTokens: number }[];
}

export class ObservabilityDB {
  private db: BetterSqlite3Database;

  constructor(dataRoot: string = "data") {
    const dbDir = path.join(dataRoot, "observability");
    fs.mkdirSync(dbDir, { recursive: true });
    const dbPath = path.join(dbDir, "observability.db");
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.initTables();
    log.info("ObservabilityDB opened at %s", dbPath);
  }

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS llm_calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL, agent_name TEXT NOT NULL, group_id TEXT,
        model TEXT NOT NULL, provider TEXT NOT NULL, latency_ms INTEGER NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
        cache_hit_tokens INTEGER DEFAULT 0, cache_miss_tokens INTEGER DEFAULT 0,
        is_error INTEGER NOT NULL DEFAULT 0, error_message TEXT,
        fallback_used INTEGER NOT NULL DEFAULT 0, round INTEGER NOT NULL DEFAULT 1,
        timestamp INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_llm_agent ON llm_calls(agent_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_llm_group ON llm_calls(group_id, timestamp);
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tool_calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL, agent_name TEXT NOT NULL, group_id TEXT,
        tool_name TEXT NOT NULL, is_error INTEGER NOT NULL DEFAULT 0,
        latency_ms INTEGER NOT NULL, param_chars INTEGER NOT NULL DEFAULT 0,
        result_chars INTEGER NOT NULL DEFAULT 0, timestamp INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tool_agent ON tool_calls(agent_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_tool_group ON tool_calls(group_id, timestamp);
    `);
  }

  insertLLMCall(r: LLMCallRecord): void {
    this.db.prepare(`INSERT INTO llm_calls (agent_id, agent_name, group_id, model, provider,
      latency_ms, input_tokens, output_tokens, cache_hit_tokens, cache_miss_tokens,
      is_error, error_message, fallback_used, round, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      r.agent_id, r.agent_name, r.group_id ?? null, r.model, r.provider, r.latency_ms,
      r.input_tokens, r.output_tokens, r.cache_hit_tokens, r.cache_miss_tokens,
      r.is_error, r.error_message ?? null, r.fallback_used, r.round, r.timestamp);
  }

  insertToolCall(r: ToolCallRecord): void {
    this.db.prepare(`INSERT INTO tool_calls (agent_id, agent_name, group_id, tool_name,
      is_error, latency_ms, param_chars, result_chars, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      r.agent_id, r.agent_name, r.group_id ?? null, r.tool_name, r.is_error,
      r.latency_ms, r.param_chars, r.result_chars, r.timestamp);
  }

  getDashboard(groupId?: string): DashboardData {
    const gf = groupId ? "AND group_id = ?" : "";
    const gp = groupId ? [groupId] : [];
    const now = Date.now();
    const dayMs = 86400000;
    const todayStart = now - (now % dayMs);
    const sevenDaysAgo = todayStart - 7 * dayMs;
    const twentyFourHoursAgo = now - dayMs;

    const todayTokens = this.db.prepare(
      `SELECT COALESCE(SUM(input_tokens),0) as i, COALESCE(SUM(output_tokens),0) as o
       FROM llm_calls WHERE timestamp >= ? AND is_error = 0 ${gf}`
    ).get(todayStart, ...gp) as { i: number; o: number };
    const totalTokens = this.db.prepare(
      `SELECT COALESCE(SUM(input_tokens),0) as i, COALESCE(SUM(output_tokens),0) as o
       FROM llm_calls WHERE is_error = 0 ${gf}`
    ).get(...gp) as { i: number; o: number };
    const daily = this.db.prepare(
      `SELECT (timestamp / 86400000) * 86400000 as d,
              COALESCE(SUM(input_tokens),0) as i, COALESCE(SUM(output_tokens),0) as o
       FROM llm_calls WHERE timestamp >= ? AND is_error = 0 ${gf} GROUP BY d ORDER BY d`
    ).all(sevenDaysAgo, ...gp) as { d: number; i: number; o: number }[];

    const allLat = this.db.prepare(
      `SELECT latency_ms FROM llm_calls WHERE timestamp >= ? AND is_error = 0 ${gf} ORDER BY latency_ms`
    ).all(twentyFourHoursAgo, ...gp) as { latency_ms: number }[];
    let p50 = 0, p95 = 0;
    if (allLat.length > 0) {
      p50 = allLat[Math.floor(allLat.length * 0.5)].latency_ms;
      p95 = allLat[Math.floor(allLat.length * 0.95)].latency_ms;
    }
    const hourly = this.db.prepare(
      `SELECT (timestamp / 3600000) * 3600000 as h, COALESCE(AVG(latency_ms),0) as a
       FROM llm_calls WHERE timestamp >= ? AND is_error = 0 ${gf} GROUP BY h ORDER BY h`
    ).all(twentyFourHoursAgo, ...gp) as { h: number; a: number }[];

    const topTools = this.db.prepare(
      `SELECT tool_name as n, COUNT(*) as c,
              CAST(SUM(CASE WHEN is_error=1 THEN 1 ELSE 0 END) AS REAL)/COUNT(*) as e
       FROM tool_calls WHERE 1=1 ${gf} GROUP BY tool_name ORDER BY c DESC LIMIT 10`
    ).all(...gp) as { n: string; c: number; e: number }[];

    const llmErr = this.db.prepare(
      `SELECT COUNT(*) as t, SUM(CASE WHEN is_error=1 THEN 1 ELSE 0 END) as e
       FROM llm_calls WHERE 1=1 ${gf}`
    ).get(...gp) as { t: number; e: number };
    const toolErr = this.db.prepare(
      `SELECT COUNT(*) as t, SUM(CASE WHEN is_error=1 THEN 1 ELSE 0 END) as e
       FROM tool_calls WHERE 1=1 ${gf}`
    ).get(...gp) as { t: number; e: number };
    const fb = this.db.prepare(
      `SELECT COUNT(*) as c FROM llm_calls WHERE fallback_used=1 ${gf}`
    ).get(...gp) as { c: number };

    const agents = this.db.prepare(
      `SELECT agent_id as aid, agent_name as an, COUNT(*) as cc,
              COALESCE(SUM(input_tokens+output_tokens),0) as tt
       FROM llm_calls WHERE timestamp >= ? ${gf} GROUP BY agent_id, agent_name ORDER BY cc DESC`
    ).all(sevenDaysAgo, ...gp) as { aid: string; an: string; cc: number; tt: number }[];

    return {
      tokens: {
        today: todayTokens.i + todayTokens.o,
        total: totalTokens.i + totalTokens.o,
        daily: daily.map(d => ({ date: new Date(d.d).toISOString().split("T")[0], input: d.i, output: d.o })),
      },
      latency: {
        p50: Math.round(p50), p95: Math.round(p95),
        hourly: hourly.map(h => ({ hour: new Date(h.h).toISOString().slice(11, 16), avg: Math.round(h.a) })),
      },
      tools: topTools.map(t => ({ name: t.n, count: t.c, errorRate: Math.round(t.e * 1000) / 10 })),
      errors: {
        llmErrorRate: llmErr.t > 0 ? Math.round((llmErr.e / llmErr.t) * 1000) / 10 : 0,
        llmErrors: llmErr.e, llmTotal: llmErr.t,
        toolErrorRate: toolErr.t > 0 ? Math.round((toolErr.e / toolErr.t) * 1000) / 10 : 0,
        toolErrors: toolErr.e, toolTotal: toolErr.t, fallbackCount: fb.c,
      },
      agents: agents.map(a => ({ agentId: a.aid, agentName: a.an, callCount: a.cc, totalTokens: a.tt })),
    };
  }

  getLLMStats(opts?: { agentId?: string; groupId?: string; since?: number; limit?: number }) {
    const limit = Math.min(opts?.limit ?? 50, 200);
    const since = opts?.since ?? 0;
    const conds = ["timestamp >= ?"]; const params: (string|number)[] = [since];
    if (opts?.agentId) { conds.push("agent_id = ?"); params.push(opts.agentId); }
    if (opts?.groupId) { conds.push("group_id = ?"); params.push(opts.groupId); }
    const w = conds.join(" AND ");
    const calls = this.db.prepare(`SELECT * FROM llm_calls WHERE ${w} ORDER BY timestamp DESC LIMIT ?`).all(...params, limit) as LLMCallRecord[];
    const cnt = this.db.prepare(`SELECT COUNT(*) as c FROM llm_calls WHERE ${w}`).get(...params) as { c: number };
    return { calls, total: cnt.c };
  }

  getToolStats(opts?: { agentId?: string; groupId?: string; since?: number; limit?: number }) {
    const limit = Math.min(opts?.limit ?? 50, 200);
    const since = opts?.since ?? 0;
    const conds = ["timestamp >= ?"]; const params: (string|number)[] = [since];
    if (opts?.agentId) { conds.push("agent_id = ?"); params.push(opts.agentId); }
    if (opts?.groupId) { conds.push("group_id = ?"); params.push(opts.groupId); }
    const w = conds.join(" AND ");
    const calls = this.db.prepare(`SELECT * FROM tool_calls WHERE ${w} ORDER BY timestamp DESC LIMIT ?`).all(...params, limit) as ToolCallRecord[];
    const cnt = this.db.prepare(`SELECT COUNT(*) as c FROM tool_calls WHERE ${w}`).get(...params) as { c: number };
    return { calls, total: cnt.c };
  }

  close(): void { try { this.db.close(); } catch { /* ignore */ } }
}
```

- [ ] **Step 2: 验证编译** — Run: `cd D:\agent-codes\CoBeing && pnpm build`. Expected: packages/core 编译通过。

---

### Task 2: ConversationLoop 埋点

**Files:** Modify: `packages/core/src/conversation/conversation-loop.ts`

- [ ] **Step 1: Config 加 observabilityDB 可选字段**

In `ConversationLoopConfig` interface (after `fallbackProviders` line):
```typescript
  observabilityDB?: import("../observability/observability-db.js").ObservabilityDB;
```

- [ ] **Step 2: 类添加字段并在构造函数赋值**

Add after `private fallbackProviders` line:
```typescript
  private observabilityDB?: import("../observability/observability-db.js").ObservabilityDB;
```

In constructor, after `this.fallbackProviders = ...`:
```typescript
    this.observabilityDB = config.observabilityDB;
```

- [ ] **Step 3: run() 方法添加计时和写入**

At line 117, after `let totalUsage: TokenUsage = ...`:
```typescript
    const runStartTime = Date.now();
```

At line 131, replace `const fallbackList = [this.provider, ...this.fallbackProviders];` with:
```typescript
      const roundStart = Date.now();
      const fallbackList = [this.provider, ...this.fallbackProviders];
```

At line 132, after `let chatSucceeded = false;` add:
```typescript
      let usedProviderName = fallbackList[0].constructor.name;
```

At line 159, after `this.provider = chatProvider;` add:
```typescript
            usedProviderName = chatProvider.constructor.name;
```

After the `events?.onUsage?.({ ...totalUsage });` line (currently ~line 189), add:
```typescript
      if (this.observabilityDB) {
        this.observabilityDB.insertLLMCall({
          agent_id: this.config.agentId ?? "unknown",
          agent_name: this.config.agentConfig.name,
          group_id: this.config.sessionId?.startsWith("group:") ? this.config.sessionId.slice(6) : undefined,
          model: this.config.agentConfig.model,
          provider: usedProviderName,
          latency_ms: Date.now() - roundStart,
          input_tokens: totalUsage.inputTokens,
          output_tokens: totalUsage.outputTokens,
          cache_hit_tokens: totalUsage.cacheHitTokens ?? 0,
          cache_miss_tokens: totalUsage.cacheMissTokens ?? 0,
          is_error: providerError ? 1 : 0,
          error_message: providerError ?? undefined,
          fallback_used: fallbackList[0] !== this.provider ? 1 : 0,
          round: round + 1,
          timestamp: Date.now(),
        });
      }
```

- [ ] **Step 4: 验证编译** — `pnpm build`

---

### Task 3: ToolExecutor 埋点

**Files:** Modify: `packages/core/src/tools/executor.ts`

- [ ] **Step 1: 添加 import 和构造参数**

Add import:
```typescript
import type { ObservabilityDB } from "../observability/observability-db.js";
```

Modify constructor to add new params at end:
```typescript
export class ToolExecutor {
  private agentName: string;
  constructor(
    private registry: ToolRegistry,
    private permission: PermissionEnforcer,
    private events?: EventEmitter,
    private sandboxConfig?: SandboxConfig,
    private sandboxRunner?: SandboxRunner,
    private observabilityDB?: ObservabilityDB,
    agentName?: string,
  ) {
    this.agentName = agentName ?? "unknown";
  }
```

- [ ] **Step 2: execute() 添加计时和写入**

Add `const startTime = Date.now();` at the very beginning of the `execute()` method body.

Before `return result;` at end, add:
```typescript
    if (this.observabilityDB) {
      const paramStr = JSON.stringify(params);
      const resultStr = typeof result.content === "string" ? result.content : JSON.stringify(result.content);
      this.observabilityDB.insertToolCall({
        agent_id: agentId, agent_name: this.agentName, tool_name: toolCall.function.name,
        is_error: result.isError ? 1 : 0, latency_ms: Date.now() - startTime,
        param_chars: paramStr.length, result_chars: resultStr.length, timestamp: Date.now(),
      });
    }
```

- [ ] **Step 3: 验证编译** — `pnpm build`

---

### Task 4: Agent 传递 ObservabilityDB

**Files:** Modify: `packages/core/src/agent/agent.ts`

- [ ] **Step 1: 添加 import 和字段**

Add import:
```typescript
import type { ObservabilityDB } from "../observability/observability-db.js";
```

Add field after `private _allProviders`:
```typescript
  private observabilityDB?: ObservabilityDB;
```

- [ ] **Step 2: 添加 setter 方法**

Add method to Agent class:
```typescript
  setObservabilityDB(db: ObservabilityDB): void {
    this.observabilityDB = db;
    if (this._toolExecutor) {
      (this._toolExecutor as any).observabilityDB = db;
    }
  }
```

- [ ] **Step 3: 在 createLoop 和 createGroupLoop 中传入**

In `createLoop()` config object, add after `fallbackProviders: this.buildFallbackList(),`:
```typescript
      observabilityDB: this.observabilityDB,
```

In `createGroupLoop()` config object, add same line after `fallbackProviders`.

- [ ] **Step 4: 构造函数中 ToolExecutor 传入 agentName**

In constructor `new ToolExecutor(...)` call (~line 222), add params at end:
```typescript
      undefined, // observabilityDB (set later via setObservabilityDB)
      this.name,
```

- [ ] **Step 5: getGroupLoop 中 ToolExecutor 传入 observabilityDB**

In `getGroupLoop()` `new ToolExecutor(...)` call (~line 335), add at end:
```typescript
      this.observabilityDB,
      this.name,
```

- [ ] **Step 6: 验证编译** — `pnpm build`

---

### Task 5: Runtime 单例注入

**Files:** Modify: `packages/core/src/runtime.ts`

- [ ] **Step 1: 添加 import 和字段**

```typescript
import { ObservabilityDB } from "./observability/observability-db.js";
```

Add after `private dockerAvailable = false;`:
```typescript
  readonly observabilityDB: ObservabilityDB;
```

- [ ] **Step 2: 构造函数中创建**

After `(globalThis as any).__cobeingConfig = config;`:
```typescript
    this.observabilityDB = new ObservabilityDB(this.dataRoot);
```

- [ ] **Step 3: 注入 butler**

After `this.butler.setAllProviders(this.providers);`:
```typescript
    this.butler.setObservabilityDB(this.observabilityDB);
```

- [ ] **Step 4: 注入 restored agents**

In `restoreAgents()`, find each `agent.setAllProviders(this.providers)` and add after:
```typescript
      agent.setObservabilityDB(this.observabilityDB);
```

- [ ] **Step 5: 注入 prebuilt agents**

In `registerPrebuiltAgents()`, same pattern — after each agent creation/setup, add:
```typescript
      agent.setObservabilityDB(this.observabilityDB);
```

- [ ] **Step 6: dispose 时关闭**

In the stop/dispose method, add:
```typescript
    this.observabilityDB.close();
```

- [ ] **Step 7: 验证编译 + 测试** — `pnpm build && pnpm test`. Expected: 281 tests pass.

---

### Task 6: WS 命令注册

**Files:** Modify: `packages/core/src/api/ws-server.ts`

- [ ] **Step 1: 在 handleMessage switch 中添加 3 个 case**

After `case "get_group_history"` block (around line 1122+), add:

```typescript
      case "get_dashboard": {
        const { groupId } = (msg.payload as { groupId?: string }) ?? {};
        const rt = (globalThis as any).__cobeingRuntime;
        if (!rt?.observabilityDB) { this.sendToClient(ws, { type: "dashboard", payload: { error: "N/A" } }); break; }
        this.sendToClient(ws, { type: "dashboard", payload: rt.observabilityDB.getDashboard(groupId) });
        break;
      }
      case "get_llm_stats": {
        const { agentId, groupId, since, limit } = (msg.payload as any) ?? {};
        const rt = (globalThis as any).__cobeingRuntime;
        if (!rt?.observabilityDB) { this.sendToClient(ws, { type: "llm_stats", payload: { error: "N/A" } }); break; }
        this.sendToClient(ws, { type: "llm_stats", payload: rt.observabilityDB.getLLMStats({ agentId, groupId, since, limit }) });
        break;
      }
      case "get_tool_stats": {
        const { agentId, groupId, since, limit } = (msg.payload as any) ?? {};
        const rt = (globalThis as any).__cobeingRuntime;
        if (!rt?.observabilityDB) { this.sendToClient(ws, { type: "tool_stats", payload: { error: "N/A" } }); break; }
        this.sendToClient(ws, { type: "tool_stats", payload: rt.observabilityDB.getToolStats({ agentId, groupId, since, limit }) });
        break;
      }
```

- [ ] **Step 2: 验证编译** — `pnpm build`

---

### Task 7: 前端类型 + 导航 + 路由

**Files:** Modify: `gui-v2/src/lib/types.ts`, `gui-v2/src/components/layout/NavBar.tsx`, `gui-v2/src/components/layout/MainContent.tsx`

- [ ] **Step 1: ViewType 加 "dashboard"**

In `types.ts` line 3:
```typescript
export type ViewType = "butler" | "agents" | "groups" | "skills" | "settings" | "dashboard";
```

Add at end of `types.ts`:
```typescript
export interface DashboardData {
  tokens: { today: number; total: number; daily: { date: string; input: number; output: number }[] };
  latency: { p50: number; p95: number; hourly: { hour: string; avg: number }[] };
  tools: { name: string; count: number; errorRate: number }[];
  errors: { llmErrorRate: number; llmErrors: number; llmTotal: number;
            toolErrorRate: number; toolErrors: number; toolTotal: number; fallbackCount: number };
  agents: { agentId: string; agentName: string; callCount: number; totalTokens: number }[];
}
```

- [ ] **Step 2: NavBar 加导航项**

In `NAV_ITEMS` array, add:
```typescript
  { icon: "📊", view: "dashboard", label: "仪表盘" },
```

- [ ] **Step 3: MainContent 加 dashboard 路由**

Add import:
```typescript
import { DashboardView } from "@/components/observability/DashboardView";
```

Add in the final switch section (before `{activeView === "skills" ...}`):
```typescript
      {activeView === "dashboard" && <DashboardView />}
```

- [ ] **Step 4: 验证前端编译** — `cd gui-v2 && npx tsc --noEmit`

---

### Task 8: 前端 Zustand Store

**Files:** Create: `gui-v2/src/stores/observability.ts`

```typescript
import { create } from "zustand";
import type { DashboardData } from "@/lib/types";

interface ObservabilityStore {
  dashboard: DashboardData | null;
  groupFilter: string | undefined;
  loading: boolean;
  setDashboard: (data: DashboardData) => void;
  setGroupFilter: (groupId: string | undefined) => void;
  setLoading: (v: boolean) => void;
}

export const useObservabilityStore = create<ObservabilityStore>((set) => ({
  dashboard: null, groupFilter: undefined, loading: false,
  setDashboard: (data) => set({ dashboard: data, loading: false }),
  setGroupFilter: (groupId) => set({ groupFilter: groupId }),
  setLoading: (v) => set({ loading: v }),
}));
```

---

### Task 9: 前端仪表盘组件

**Files:** Create 5 files in `gui-v2/src/components/observability/`

- [ ] **Step 1: TokenCard**

`TokenCard.tsx`:
```typescript
import type { DashboardData } from "@/lib/types";

function MiniBars({ daily }: { daily: DashboardData["tokens"]["daily"] }) {
  if (daily.length === 0) return <p className="text-xs text-txt-muted mt-2">暂无数据</p>;
  const maxVal = Math.max(...daily.map(d => d.input + d.output), 1);
  return (
    <div className="flex items-end gap-1 mt-2" style={{ height: 40 }}>
      {daily.map((d) => (
        <div key={d.date} className="flex-1 flex flex-col items-center gap-0.5">
          <div className="w-full rounded-sm" style={{
            height: `${Math.max(4, ((d.input + d.output) / maxVal) * 36)}px`,
            background: "var(--color-accent)", opacity: 0.7 }} />
          <span className="text-[9px] text-txt-muted">{d.date.slice(5)}</span>
        </div>
      ))}
    </div>
  );
}

export function TokenCard({ data }: { data: DashboardData }) {
  const fmt = (n: number) => n >= 1_000_000 ? `${(n/1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n/1_000).toFixed(1)}K` : String(n);
  return (
    <div className="rounded-xl p-4 bg-surface-elevated shadow-sm border border-bdr/20">
      <h3 className="text-sm font-semibold">Token 消耗</h3>
      <div className="flex gap-6 mt-2">
        <div><p className="text-[10px] text-txt-muted uppercase">今日</p><p className="text-xl font-bold text-accent">{fmt(data.tokens.today)}</p></div>
        <div><p className="text-[10px] text-txt-muted uppercase">累计</p><p className="text-xl font-bold">{fmt(data.tokens.total)}</p></div>
      </div>
      <MiniBars daily={data.tokens.daily} />
    </div>
  );
}
```

- [ ] **Step 2: LatencyCard**

`LatencyCard.tsx`:
```typescript
import type { DashboardData } from "@/lib/types";

export function LatencyCard({ data }: { data: DashboardData }) {
  const hourly = data.latency.hourly;
  const maxLat = Math.max(...hourly.map(h => h.avg), 1);
  return (
    <div className="rounded-xl p-4 bg-surface-elevated shadow-sm border border-bdr/20">
      <h3 className="text-sm font-semibold">响应时间（24h）</h3>
      <div className="flex gap-6 mt-2">
        <div><p className="text-[10px] text-txt-muted uppercase">P50</p><p className="text-xl font-bold text-accent">{(data.latency.p50/1000).toFixed(1)}s</p></div>
        <div><p className="text-[10px] text-txt-muted uppercase">P95</p><p className="text-xl font-bold">{(data.latency.p95/1000).toFixed(1)}s</p></div>
      </div>
      {hourly.length > 0 && (
        <svg className="mt-2" width="100%" height="40" viewBox={`0 0 ${hourly.length * 10} 40`} preserveAspectRatio="none">
          <polyline fill="none" stroke="var(--color-accent)" strokeWidth="1.5"
            points={hourly.map((h, i) => `${i * 10 + 5},${40 - (h.avg / maxLat) * 36}`).join(" ")} />
        </svg>
      )}
    </div>
  );
}
```

- [ ] **Step 3: ToolRankCard**

`ToolRankCard.tsx`:
```typescript
import type { DashboardData } from "@/lib/types";

export function ToolRankCard({ data }: { data: DashboardData }) {
  if (data.tools.length === 0) return (
    <div className="rounded-xl p-4 bg-surface-elevated shadow-sm border border-bdr/20">
      <h3 className="text-sm font-semibold">工具调用排行</h3>
      <p className="text-xs text-txt-muted mt-2">暂无数据</p>
    </div>
  );
  const maxCount = Math.max(...data.tools.map(t => t.count), 1);
  return (
    <div className="rounded-xl p-4 bg-surface-elevated shadow-sm border border-bdr/20">
      <h3 className="text-sm font-semibold">工具调用排行</h3>
      <div className="mt-2 flex flex-col gap-1.5">
        {data.tools.slice(0, 8).map((t) => (
          <div key={t.name} className="flex items-center gap-2">
            <span className="text-xs w-20 truncate" title={t.name}>{t.name}</span>
            <div className="flex-1 h-3 rounded-sm bg-surface-solid overflow-hidden">
              <div className="h-full rounded-sm bg-accent/60" style={{ width: `${(t.count/maxCount)*100}%` }} />
            </div>
            <span className="text-xs text-txt-muted w-8 text-right">{t.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: AgentActivityCard**

`AgentActivityCard.tsx`:
```typescript
import type { DashboardData } from "@/lib/types";

export function AgentActivityCard({ data }: { data: DashboardData }) {
  if (data.agents.length === 0) return (
    <div className="rounded-xl p-4 bg-surface-elevated shadow-sm border border-bdr/20 col-span-2">
      <h3 className="text-sm font-semibold">Agent 活跃度（近 7 天）</h3>
      <p className="text-xs text-txt-muted mt-2">暂无数据</p>
    </div>
  );
  const maxCount = Math.max(...data.agents.map(a => a.callCount), 1);
  return (
    <div className="rounded-xl p-4 bg-surface-elevated shadow-sm border border-bdr/20 col-span-2">
      <h3 className="text-sm font-semibold">Agent 活跃度（近 7 天）</h3>
      <div className="mt-2 flex flex-col gap-2">
        {data.agents.map((a) => (
          <div key={a.agentId} className="flex items-center gap-2">
            <span className="text-xs w-24 truncate" title={a.agentName}>{a.agentName}</span>
            <div className="flex-1 h-4 rounded-sm bg-surface-solid overflow-hidden">
              <div className="h-full rounded-sm bg-accent/60 flex items-center justify-end pr-1"
                   style={{ width: `${Math.max(5, (a.callCount/maxCount)*100)}%` }}>
                <span className="text-[9px] text-white font-semibold">{a.callCount} 次</span>
              </div>
            </div>
            <span className="text-[10px] text-txt-muted w-16 text-right">{a.totalTokens >= 1000 ? `${(a.totalTokens/1000).toFixed(0)}K` : a.totalTokens} tok</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: DashboardView 主页面**

`DashboardView.tsx`:
```typescript
import { useEffect } from "react";
import { getWsClient } from "@/hooks/useWebSocket";
import { useObservabilityStore } from "@/stores/observability";
import { useGroupsStore } from "@/stores/groups";
import { TokenCard } from "./TokenCard";
import { LatencyCard } from "./LatencyCard";
import { ToolRankCard } from "./ToolRankCard";
import { AgentActivityCard } from "./AgentActivityCard";

export function DashboardView() {
  const { dashboard, groupFilter, setDashboard, setGroupFilter, loading, setLoading } = useObservabilityStore();
  const groups = useGroupsStore((s) => s.groups);

  useEffect(() => {
    setLoading(true);
    const client = getWsClient();
    if (!client) return;
    const fetch = () => client.send({ type: "get_dashboard", payload: groupFilter ? { groupId: groupFilter } : {} });
    fetch();
    const interval = setInterval(fetch, 30000);
    return () => clearInterval(interval);
  }, [groupFilter]);

  if (!dashboard) return (
    <div className="flex-1 h-full flex items-center justify-center">
      <p className="text-txt-muted">{loading ? "加载中..." : "暂无数据"}</p>
    </div>
  );

  const e = dashboard.errors;
  return (
    <main className="flex-1 h-full flex flex-col min-w-0 min-h-0 overflow-y-auto p-5">
      <div className="flex items-center gap-4 mb-4">
        <h2 className="text-lg font-bold">仪表盘</h2>
        <select className="rounded-lg px-3 py-1.5 text-sm bg-surface-solid border border-bdr/30"
                value={groupFilter ?? ""} onChange={ev => setGroupFilter(ev.target.value || undefined)}>
          <option value="">全部群组</option>
          {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </div>

      <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
        <TokenCard data={dashboard} />
        <LatencyCard data={dashboard} />
        <div className="rounded-xl p-4 bg-surface-elevated shadow-sm border border-bdr/20">
          <h3 className="text-sm font-semibold">错误 & 降级</h3>
          <div className="mt-2 flex flex-col gap-1.5 text-xs">
            <div className="flex justify-between"><span>LLM 错误率</span>
              <span className={e.llmErrorRate > 5 ? "text-danger font-semibold" : "text-txt-muted"}>{e.llmErrorRate}% ({e.llmErrors}/{e.llmTotal})</span></div>
            <div className="flex justify-between"><span>工具错误率</span>
              <span className={e.toolErrorRate > 5 ? "text-danger font-semibold" : "text-txt-muted"}>{e.toolErrorRate}% ({e.toolErrors}/{e.toolTotal})</span></div>
            <div className="flex justify-between"><span>Provider 降级</span>
              <span className={e.fallbackCount > 0 ? "text-warning font-semibold" : "text-txt-muted"}>{e.fallbackCount} 次</span></div>
          </div>
        </div>
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 2fr" }}>
        <ToolRankCard data={dashboard} />
        <AgentActivityCard data={dashboard} />
      </div>
    </main>
  );
}
```

- [ ] **Step 6: 验证编译** — `cd gui-v2 && npx tsc --noEmit && npm run build`

---

### Task 10: WS 事件处理 + 最终验证

**Files:** Modify: `gui-v2/src/hooks/useWebSocket.ts`

- [ ] **Step 1: 在 switch 中添加 dashboard / llm_stats / tool_stats 处理**

In the `wsClient = new WsClient(url, (msg: WsMessage) => { switch (msg.type) {` block, add these cases:

```typescript
        case "dashboard": {
          const store = useObservabilityStore.getState();
          const p = msg.payload as import("@/lib/types").DashboardData;
          if (p && !(p as any).error) store.setDashboard(p);
          break;
        }
```

Add import at top of file:
```typescript
import { useObservabilityStore } from "@/stores/observability";
```

- [ ] **Step 2: 全部编译 + 测试**

```bash
cd D:\agent-codes\CoBeing && pnpm build
```

Expected: 6 packages all pass.

```bash
cd D:\agent-codes\CoBeing && pnpm test
```

Expected: 281 tests pass.

```bash
cd D:\agent-codes\CoBeing\gui-v2 && npm run build
```

Expected: tsc + vite build pass.

- [ ] **Step 3: 手动验证** — 启动 `start.bat` → 进入 GUI → 点击 📊 仪表盘图标 → 确认页面加载无报错（首次为空状态占位）。发送一条消息给管家 → 回到仪表盘 → 确认有数据。

---

### Task 11: 更新 PROGRESS.md + 文档

- [ ] **Step 1: 更新 PROGRESS.md**

在 PROGRESS.md 顶部追加:
```
### P1.4 可观测性 — 已完成

**变更原因**: P1 首个模块，添加 LLM 调用日志、工具审计、Token 聚合、响应时间监控。

**修改文件**:
- Create: packages/core/src/observability/observability-db.ts
- Modify: conversation-loop.ts, executor.ts, agent.ts, runtime.ts, ws-server.ts
- Create: gui-v2/src/stores/observability.ts
- Create: gui-v2/src/components/observability/{DashboardView,TokenCard,LatencyCard,ToolRankCard,AgentActivityCard}.tsx
- Modify: gui-v2/src/lib/types.ts, NavBar.tsx, MainContent.tsx, useWebSocket.ts
```

- [ ] **Step 2: 更新 docs/待办新.md**

将 1.4 节 4 个子项标记为 ✅:
```
| ✅ **LLM 调用日志** | ...
| ✅ **工具调用审计** | ...
| ✅ **Token 消耗按群组聚合** | ...
| ✅ **Agent 响应时间监控** | ...
```
