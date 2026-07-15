import Database from "better-sqlite3";
import type { Database as BetterSqlite3Database } from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { createLogger } from "@cobeing/shared";

const log = createLogger("observability-db");
let fallbackWarningShown = false;

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

interface StoredLLMCallRecord extends LLMCallRecord {
  id: number;
}

interface StoredToolCallRecord extends ToolCallRecord {
  id: number;
}

interface FallbackObservabilityStore {
  llmCalls: StoredLLMCallRecord[];
  toolCalls: StoredToolCallRecord[];
  nextLLMCallId: number;
  nextToolCallId: number;
}

export class ObservabilityDB {
  private db: BetterSqlite3Database | null = null;
  private fallback: FallbackObservabilityStore | null = null;
  private dbPath: string;
  private fallbackPath: string;

  constructor(dataRoot: string = "data") {
    const dbDir = path.join(dataRoot, "observability");
    fs.mkdirSync(dbDir, { recursive: true });
    this.dbPath = path.join(dbDir, "observability.db");
    this.fallbackPath = `${this.dbPath}.fallback.json`;
    try {
      this.db = new Database(this.dbPath);
      this.db.pragma("journal_mode = WAL");
      this.initTables();
      log.info("ObservabilityDB opened at %s", this.dbPath);
    } catch (error) {
      this.db = null;
      this.fallback = this.loadFallbackStore();
      const reason = (error instanceof Error ? error.message : String(error))
        .split("\n")[0]
        .replace(/\s*Tried:\s*$/, "");
      if (!fallbackWarningShown) {
        fallbackWarningShown = true;
        log.warn("SQLite observability database unavailable, using file-backed fallback: %s", reason);
      } else {
        log.debug("SQLite observability database unavailable for %s, using file-backed fallback", this.dbPath);
      }
    }
  }

  private loadFallbackStore(): FallbackObservabilityStore {
    try {
      if (fs.existsSync(this.fallbackPath)) {
        const parsed = JSON.parse(fs.readFileSync(this.fallbackPath, "utf-8")) as Partial<FallbackObservabilityStore>;
        const llmCalls = Array.isArray(parsed.llmCalls) ? parsed.llmCalls : [];
        const toolCalls = Array.isArray(parsed.toolCalls) ? parsed.toolCalls : [];
        return {
          llmCalls,
          toolCalls,
          nextLLMCallId: parsed.nextLLMCallId ?? (llmCalls.reduce((max, row) => Math.max(max, row.id), 0) + 1),
          nextToolCallId: parsed.nextToolCallId ?? (toolCalls.reduce((max, row) => Math.max(max, row.id), 0) + 1),
        };
      }
    } catch (error) {
      log.warn("Failed to load fallback observability database %s: %s", this.fallbackPath, error);
    }
    return { llmCalls: [], toolCalls: [], nextLLMCallId: 1, nextToolCallId: 1 };
  }

  private saveFallbackStore(): void {
    if (!this.fallback) return;
    fs.writeFileSync(this.fallbackPath, JSON.stringify(this.fallback, null, 2) + "\n", "utf-8");
  }

  private initTables(): void {
    if (!this.db) return;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS llm_calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL,
        agent_name TEXT NOT NULL,
        group_id TEXT,
        model TEXT NOT NULL,
        provider TEXT NOT NULL,
        latency_ms INTEGER NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cache_hit_tokens INTEGER DEFAULT 0,
        cache_miss_tokens INTEGER DEFAULT 0,
        is_error INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        fallback_used INTEGER NOT NULL DEFAULT 0,
        round INTEGER NOT NULL DEFAULT 1,
        timestamp INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_llm_agent ON llm_calls(agent_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_llm_group ON llm_calls(group_id, timestamp);
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tool_calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL,
        agent_name TEXT NOT NULL,
        group_id TEXT,
        tool_name TEXT NOT NULL,
        is_error INTEGER NOT NULL DEFAULT 0,
        latency_ms INTEGER NOT NULL,
        param_chars INTEGER NOT NULL DEFAULT 0,
        result_chars INTEGER NOT NULL DEFAULT 0,
        timestamp INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tool_agent ON tool_calls(agent_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_tool_group ON tool_calls(group_id, timestamp);
    `);
  }

  insertLLMCall(r: LLMCallRecord): void {
    if (this.fallback) {
      this.fallback.llmCalls.push({ id: this.fallback.nextLLMCallId++, ...r });
      this.saveFallbackStore();
      return;
    }
    if (!this.db) return;
    this.db.prepare(
      `INSERT INTO llm_calls (agent_id, agent_name, group_id, model, provider,
        latency_ms, input_tokens, output_tokens, cache_hit_tokens, cache_miss_tokens,
        is_error, error_message, fallback_used, round, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      r.agent_id, r.agent_name, r.group_id ?? null, r.model, r.provider, r.latency_ms,
      r.input_tokens, r.output_tokens, r.cache_hit_tokens, r.cache_miss_tokens,
      r.is_error, r.error_message ?? null, r.fallback_used, r.round, r.timestamp,
    );
  }

  insertToolCall(r: ToolCallRecord): void {
    if (this.fallback) {
      this.fallback.toolCalls.push({ id: this.fallback.nextToolCallId++, ...r });
      this.saveFallbackStore();
      return;
    }
    if (!this.db) return;
    this.db.prepare(
      `INSERT INTO tool_calls (agent_id, agent_name, group_id, tool_name,
        is_error, latency_ms, param_chars, result_chars, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      r.agent_id, r.agent_name, r.group_id ?? null, r.tool_name,
      r.is_error, r.latency_ms, r.param_chars, r.result_chars, r.timestamp,
    );
  }

  getDashboard(groupId?: string): DashboardData {
    if (this.fallback) return this.getFallbackDashboard(groupId);
    if (!this.db) return this.emptyDashboard();

    const gf = groupId ? "AND group_id = ?" : "";
    const gp: string[] = groupId ? [groupId] : [];
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
       FROM llm_calls WHERE timestamp >= ? AND is_error = 0 ${gf}
       GROUP BY d ORDER BY d ASC`
    ).all(sevenDaysAgo, ...gp) as { d: number; i: number; o: number }[];

    const allLat = this.db.prepare(
      `SELECT latency_ms FROM llm_calls
       WHERE timestamp >= ? AND is_error = 0 ${gf}
       ORDER BY latency_ms ASC`
    ).all(twentyFourHoursAgo, ...gp) as { latency_ms: number }[];

    let p50 = 0, p95 = 0;
    if (allLat.length > 0) {
      p50 = allLat[Math.floor(allLat.length * 0.5)].latency_ms;
      p95 = allLat[Math.floor(allLat.length * 0.95)].latency_ms;
    }

    const hourly = this.db.prepare(
      `SELECT (timestamp / 3600000) * 3600000 as h, COALESCE(AVG(latency_ms),0) as a
       FROM llm_calls WHERE timestamp >= ? AND is_error = 0 ${gf}
       GROUP BY h ORDER BY h ASC`
    ).all(twentyFourHoursAgo, ...gp) as { h: number; a: number }[];

    const topTools = this.db.prepare(
      `SELECT tool_name as n, COUNT(*) as c,
              CAST(SUM(CASE WHEN is_error=1 THEN 1 ELSE 0 END) AS REAL) / COUNT(*) as e
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
      `SELECT COUNT(*) as c FROM llm_calls WHERE fallback_used = 1 ${gf}`
    ).get(...gp) as { c: number };

    const agents = this.db.prepare(
      `SELECT agent_id as aid, agent_name as an, COUNT(*) as cc,
              COALESCE(SUM(input_tokens+output_tokens),0) as tt
       FROM llm_calls WHERE timestamp >= ? ${gf}
       GROUP BY agent_id, agent_name ORDER BY cc DESC`
    ).all(sevenDaysAgo, ...gp) as { aid: string; an: string; cc: number; tt: number }[];

    return {
      tokens: {
        today: todayTokens.i + todayTokens.o,
        total: totalTokens.i + totalTokens.o,
        daily: daily.map(d => ({ date: new Date(d.d).toISOString().split("T")[0], input: d.i, output: d.o })),
      },
      latency: {
        p50: Math.round(p50),
        p95: Math.round(p95),
        hourly: hourly.map(h => ({ hour: new Date(h.h).toISOString().slice(11, 16), avg: Math.round(h.a) })),
      },
      tools: topTools.map(t => ({ name: t.n, count: t.c, errorRate: Math.round(t.e * 1000) / 10 })),
      errors: {
        llmErrorRate: llmErr.t > 0 ? Math.round((llmErr.e / llmErr.t) * 1000) / 10 : 0,
        llmErrors: llmErr.e, llmTotal: llmErr.t,
        toolErrorRate: toolErr.t > 0 ? Math.round((toolErr.e / toolErr.t) * 1000) / 10 : 0,
        toolErrors: toolErr.e, toolTotal: toolErr.t,
        fallbackCount: fb.c,
      },
      agents: agents.map(a => ({ agentId: a.aid, agentName: a.an, callCount: a.cc, totalTokens: a.tt })),
    };
  }

  private emptyDashboard(): DashboardData {
    return {
      tokens: { today: 0, total: 0, daily: [] },
      latency: { p50: 0, p95: 0, hourly: [] },
      tools: [],
      errors: {
        llmErrorRate: 0,
        llmErrors: 0,
        llmTotal: 0,
        toolErrorRate: 0,
        toolErrors: 0,
        toolTotal: 0,
        fallbackCount: 0,
      },
      agents: [],
    };
  }

  private getFallbackDashboard(groupId?: string): DashboardData {
    if (!this.fallback) return this.emptyDashboard();

    const now = Date.now();
    const dayMs = 86400000;
    const todayStart = now - (now % dayMs);
    const sevenDaysAgo = todayStart - 7 * dayMs;
    const twentyFourHoursAgo = now - dayMs;

    const llmCalls = this.fallback.llmCalls.filter(call => !groupId || call.group_id === groupId);
    const toolCalls = this.fallback.toolCalls.filter(call => !groupId || call.group_id === groupId);
    const successfulLLMCalls = llmCalls.filter(call => call.is_error === 0);

    const todayTokens = successfulLLMCalls
      .filter(call => call.timestamp >= todayStart)
      .reduce((total, call) => total + call.input_tokens + call.output_tokens, 0);
    const totalTokens = successfulLLMCalls
      .reduce((total, call) => total + call.input_tokens + call.output_tokens, 0);

    const dailyBuckets = new Map<number, { input: number; output: number }>();
    for (const call of successfulLLMCalls) {
      if (call.timestamp < sevenDaysAgo) continue;
      const day = Math.floor(call.timestamp / dayMs) * dayMs;
      const bucket = dailyBuckets.get(day) ?? { input: 0, output: 0 };
      bucket.input += call.input_tokens;
      bucket.output += call.output_tokens;
      dailyBuckets.set(day, bucket);
    }

    const latencies = successfulLLMCalls
      .filter(call => call.timestamp >= twentyFourHoursAgo)
      .map(call => call.latency_ms)
      .sort((left, right) => left - right);
    const p50 = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.5)] : 0;
    const p95 = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.95)] : 0;

    const hourlyBuckets = new Map<number, { sum: number; count: number }>();
    for (const call of successfulLLMCalls) {
      if (call.timestamp < twentyFourHoursAgo) continue;
      const hour = Math.floor(call.timestamp / 3600000) * 3600000;
      const bucket = hourlyBuckets.get(hour) ?? { sum: 0, count: 0 };
      bucket.sum += call.latency_ms;
      bucket.count += 1;
      hourlyBuckets.set(hour, bucket);
    }

    const toolBuckets = new Map<string, { count: number; errors: number }>();
    for (const call of toolCalls) {
      const bucket = toolBuckets.get(call.tool_name) ?? { count: 0, errors: 0 };
      bucket.count += 1;
      if (call.is_error === 1) bucket.errors += 1;
      toolBuckets.set(call.tool_name, bucket);
    }

    const llmErrors = llmCalls.filter(call => call.is_error === 1).length;
    const toolErrors = toolCalls.filter(call => call.is_error === 1).length;
    const fallbackCount = llmCalls.filter(call => call.fallback_used === 1).length;

    const agentBuckets = new Map<string, { agentId: string; agentName: string; callCount: number; totalTokens: number }>();
    for (const call of llmCalls) {
      if (call.timestamp < sevenDaysAgo) continue;
      const bucket = agentBuckets.get(call.agent_id) ?? {
        agentId: call.agent_id,
        agentName: call.agent_name,
        callCount: 0,
        totalTokens: 0,
      };
      bucket.callCount += 1;
      bucket.totalTokens += call.input_tokens + call.output_tokens;
      agentBuckets.set(call.agent_id, bucket);
    }

    return {
      tokens: {
        today: todayTokens,
        total: totalTokens,
        daily: [...dailyBuckets.entries()]
          .sort(([left], [right]) => left - right)
          .map(([day, tokens]) => ({
            date: new Date(day).toISOString().split("T")[0],
            input: tokens.input,
            output: tokens.output,
          })),
      },
      latency: {
        p50: Math.round(p50),
        p95: Math.round(p95),
        hourly: [...hourlyBuckets.entries()]
          .sort(([left], [right]) => left - right)
          .map(([hour, bucket]) => ({
            hour: new Date(hour).toISOString().slice(11, 16),
            avg: Math.round(bucket.sum / bucket.count),
          })),
      },
      tools: [...toolBuckets.entries()]
        .map(([name, bucket]) => ({
          name,
          count: bucket.count,
          errorRate: Math.round((bucket.errors / bucket.count) * 1000) / 10,
        }))
        .sort((left, right) => right.count - left.count)
        .slice(0, 10),
      errors: {
        llmErrorRate: llmCalls.length > 0 ? Math.round((llmErrors / llmCalls.length) * 1000) / 10 : 0,
        llmErrors,
        llmTotal: llmCalls.length,
        toolErrorRate: toolCalls.length > 0 ? Math.round((toolErrors / toolCalls.length) * 1000) / 10 : 0,
        toolErrors,
        toolTotal: toolCalls.length,
        fallbackCount,
      },
      agents: [...agentBuckets.values()].sort((left, right) => right.callCount - left.callCount),
    };
  }

  getLLMStats(opts?: { agentId?: string; groupId?: string; since?: number; limit?: number }): { calls: LLMCallRecord[]; total: number } {
    const limit = Math.min(opts?.limit ?? 50, 200);
    const since = opts?.since ?? 0;
    if (this.fallback) {
      const calls = this.fallback.llmCalls
        .filter(call =>
          call.timestamp >= since &&
          (!opts?.agentId || call.agent_id === opts.agentId) &&
          (!opts?.groupId || call.group_id === opts.groupId)
        )
        .sort((left, right) => right.timestamp - left.timestamp || right.id - left.id);
      return { calls: calls.slice(0, limit), total: calls.length };
    }
    if (!this.db) return { calls: [], total: 0 };
    const conds = ["timestamp >= ?"];
    const params: (string | number)[] = [since];
    if (opts?.agentId) { conds.push("agent_id = ?"); params.push(opts.agentId); }
    if (opts?.groupId) { conds.push("group_id = ?"); params.push(opts.groupId); }
    const w = conds.join(" AND ");
    const calls = this.db.prepare(
      `SELECT * FROM llm_calls WHERE ${w} ORDER BY timestamp DESC LIMIT ?`
    ).all(...params, limit) as LLMCallRecord[];
    const cnt = this.db.prepare(
      `SELECT COUNT(*) as c FROM llm_calls WHERE ${w}`
    ).get(...params) as { c: number };
    return { calls, total: cnt.c };
  }

  getToolStats(opts?: { agentId?: string; groupId?: string; since?: number; limit?: number }): { calls: ToolCallRecord[]; total: number } {
    const limit = Math.min(opts?.limit ?? 50, 200);
    const since = opts?.since ?? 0;
    if (this.fallback) {
      const calls = this.fallback.toolCalls
        .filter(call =>
          call.timestamp >= since &&
          (!opts?.agentId || call.agent_id === opts.agentId) &&
          (!opts?.groupId || call.group_id === opts.groupId)
        )
        .sort((left, right) => right.timestamp - left.timestamp || right.id - left.id);
      return { calls: calls.slice(0, limit), total: calls.length };
    }
    if (!this.db) return { calls: [], total: 0 };
    const conds = ["timestamp >= ?"];
    const params: (string | number)[] = [since];
    if (opts?.agentId) { conds.push("agent_id = ?"); params.push(opts.agentId); }
    if (opts?.groupId) { conds.push("group_id = ?"); params.push(opts.groupId); }
    const w = conds.join(" AND ");
    const calls = this.db.prepare(
      `SELECT * FROM tool_calls WHERE ${w} ORDER BY timestamp DESC LIMIT ?`
    ).all(...params, limit) as ToolCallRecord[];
    const cnt = this.db.prepare(
      `SELECT COUNT(*) as c FROM tool_calls WHERE ${w}`
    ).get(...params) as { c: number };
    return { calls, total: cnt.c };
  }

  close(): void {
    if (this.fallback) {
      this.saveFallbackStore();
      return;
    }
    if (!this.db) return;
    try {
      this.db.pragma("wal_checkpoint(TRUNCATE)");
      this.db.pragma("journal_mode = DELETE");
      this.db.close();
    } catch { /* ignore */ }
  }
}
