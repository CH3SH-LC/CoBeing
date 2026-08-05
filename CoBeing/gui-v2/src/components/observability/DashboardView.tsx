import { useEffect, type ReactNode } from "react";
import { getWsClient } from "@/hooks/useWebSocket";
import { useObservabilityStore } from "@/stores/observability";
import { useGroupsStore } from "@/stores/groups";
import { ActiveAgentsPanel } from "./ActiveAgentsPanel";
import { AgentActivityCard } from "./AgentActivityCard";
import { LatencyCard } from "./LatencyCard";
import { TokenCard } from "./TokenCard";
import { ToolRankCard } from "./ToolRankCard";

export function DashboardView() {
  const { dashboard, groupFilter, setGroupFilter, loading } = useObservabilityStore();
  const groups = useGroupsStore((s) => s.groups);

  useEffect(() => {
    const client = getWsClient();
    if (!client) return;
    const fetch = () => client.send({ type: "get_dashboard", payload: groupFilter ? { groupId: groupFilter } : {} });
    fetch();
    const interval = setInterval(fetch, 30000);
    return () => clearInterval(interval);
  }, [groupFilter]);

  if (!dashboard) return (
    <div className="flex-1 h-full flex items-center justify-center">
      <div className="text-center">
        <div className="text-3xl mb-2">{loading ? "⏳" : "📊"}</div>
        <p className="text-sm text-txt-muted">
          {loading ? "正在加载运行数据…" : "暂无运行数据，等待 Agent 活动…"}
        </p>
      </div>
    </div>
  );

  const e = dashboard.errors;

  return (
    <main className="flex-1 h-full flex flex-col min-w-0 min-h-0 overflow-y-auto" style={{ gap: 16 }}>
      <div className="flex items-center gap-4">
        <select
          className="rounded-lg bg-input text-sm border border-bdr/40 focus:outline-none focus:border-accent/50"
          style={{ padding: "8px 12px" }}
          value={groupFilter ?? ""}
          onChange={ev => setGroupFilter(ev.target.value || undefined)}
        >
          <option value="">全部群组</option>
          {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </div>

      {/* Row 1: 3 centered stat cards */}
      <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
        <CenteredCard icon="⚡" label="今日 Token" value={formatNum(dashboard.tokens?.today ?? 0)}
          sub={`总计 ${formatNum(dashboard.tokens?.total ?? 0)} · 日均 ${formatNum(dashboard.tokens?.daily?.length ? Math.round(dashboard.tokens.total / dashboard.tokens.daily.length) : 0)}`} />
        <CenteredCard icon="⏱️" label="响应延迟" value={formatMs(dashboard.latency?.p50)}
          sub={`P50 ${formatMs(dashboard.latency?.p50)} · P95 ${formatMs(dashboard.latency?.p95)}`} />
        <CenteredCard icon="❌" label="错误率" value={`${e.llmErrorRate ?? 0}%`}
          sub={`LLM ${e.llmErrorRate ?? 0}% · 工具 ${e.toolErrorRate ?? 0}%`} />
      </div>

      {/* Row 2: Agent activity (bar chart) */}
      {dashboard.agents && dashboard.agents.length > 0 && (
        <AgentActivityCard data={dashboard} />
      )}

      {/* Row 3: latency / token / tool rank */}
      <div className="grid gap-4 grid-cols-1 md:grid-cols-3">
        <LatencyCard data={dashboard} />
        <TokenCard data={dashboard} />
        <ToolRankCard data={dashboard} />
      </div>

      {/* Row 4: Active agents */}
      <ActiveAgentsPanel />
    </main>
  );
}

function CenteredCard({ icon, label, value, sub, wide }: {
  icon: string; label: string;
  value: ReactNode;
  sub?: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="rounded-xl bg-surface border border-bdr/40 text-center"
         style={{ padding: wide ? "20px 24px" : "20px 24px", boxShadow: "var(--shadow-surface)" }}>
      <div className="text-sm text-txt-muted mb-2">{icon} {label}</div>
      {typeof value === "string" ? (
        <div className="text-2xl font-bold text-txt">{value}</div>
      ) : (
        <div>{value}</div>
      )}
      {sub && <div className="text-sm text-txt-muted mt-2">{sub}</div>}
    </div>
  );
}

function formatNum(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return String(Math.round(n));
}

function formatMs(ms?: number): string {
  if (!ms) return "-";
  if (ms >= 1000) return (ms / 1000).toFixed(1) + "s";
  return Math.round(ms) + "ms";
}
