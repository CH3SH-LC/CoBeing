import { useEffect, type ReactNode } from "react";
import { getWsClient } from "@/hooks/useWebSocket";
import { useObservabilityStore } from "@/stores/observability";
import { useGroupsStore } from "@/stores/groups";
import { ActiveAgentsPanel } from "./ActiveAgentsPanel";

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
      <p className="text-txt-muted text-sm">{loading ? "加载中..." : "暂无数据"}</p>
    </div>
  );

  const e = dashboard.errors;

  return (
    <main className="flex-1 h-full flex flex-col min-w-0 min-h-0 overflow-y-auto" style={{ gap: 16 }}>
      <div className="flex items-center gap-4">
        <h2 className="text-lg font-semibold text-txt">仪表盘</h2>
        <select
          className="rounded-lg text-sm border border-bdr/40 focus:outline-none focus:border-accent/50"
          style={{ padding: "8px 12px", backgroundColor: "var(--color-surface-solid)" }}
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

      {/* Row 2: Agent activity */}
      {dashboard.agents && dashboard.agents.length > 0 && (
        <CenteredCard icon="🤖" label="Agent 活跃度（7 天）" wide
          value={
            <div className="flex justify-center gap-10">
              {dashboard.agents.slice(0, 4).map((a) => (
                <StatItem key={a.agentId} label={a.agentName} value={String(a.callCount)} />
              ))}
              <StatItem label="总调用" value={String(dashboard.agents.reduce((s, a) => s + a.callCount, 0))} />
            </div>
          } />
      )}

      {/* Row 4: Active agents */}
      <div className="rounded-xl bg-elevated border border-bdr/30"
           style={{ padding: 20 }}>
        <ActiveAgentsPanel />
      </div>
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
    <div className="rounded-xl bg-elevated border border-bdr/30 text-center"
         style={{ padding: wide ? "20px 24px" : "16px 20px" }}>
      <div className="text-xs text-txt-muted mb-2">{icon} {label}</div>
      {typeof value === "string" ? (
        <div className="text-2xl font-bold text-txt">{value}</div>
      ) : (
        <div>{value}</div>
      )}
      {sub && <div className="text-xs text-txt-muted mt-2">{sub}</div>}
    </div>
  );
}

function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <div className="text-xl font-bold text-txt">{value}</div>
      <div className="text-xs text-txt-muted">{label}</div>
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
