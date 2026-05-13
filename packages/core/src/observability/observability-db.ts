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

  getLLMStats(opts?: { agentId?: string; groupId?: string; since?: number; limit?: number }): { calls: LLMCallRecord[]; total: number } {
    const limit = Math.min(opts?.limit ?? 50, 200);
    const since = opts?.since ?? 0;
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
    try { this.db.close(); } catch { /* ignore */ }
  }
}
