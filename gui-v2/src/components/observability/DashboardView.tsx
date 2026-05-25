import { useEffect } from "react";
import { getWsClient } from "@/hooks/useWebSocket";
import { useObservabilityStore } from "@/stores/observability";
import { useGroupsStore } from "@/stores/groups";
import { TokenCard } from "./TokenCard";
import { LatencyCard } from "./LatencyCard";
import { ToolRankCard } from "./ToolRankCard";
import { AgentActivityCard } from "./AgentActivityCard";
import { ActiveAgentsPanel } from "./ActiveAgentsPanel";

export function DashboardView() {
  const { dashboard, groupFilter, setGroupFilter, loading, setLoading } = useObservabilityStore();
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
      <p className="text-txt-muted text-sm">{loading ? "加载中..." : "暂无数据"}</p>
    </div>
  );

  const e = dashboard.errors;
  return (
    <main className="flex-1 h-full flex flex-col min-w-0 min-h-0 overflow-y-auto" style={{ padding: 20, gap: 20 }}>
      <div className="flex items-center gap-4">
        <h2 className="text-lg font-semibold text-txt">仪表盘</h2>
        <select className="rounded-lg text-sm border border-bdr/40 focus:outline-none focus:border-accent/50"
                style={{ padding: "8px 12px", backgroundColor: "var(--color-surface-solid)" }}
                value={groupFilter ?? ""} onChange={ev => setGroupFilter(ev.target.value || undefined)}>
          <option value="">全部群组</option>
          {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
        <TokenCard data={dashboard} />
        <LatencyCard data={dashboard} />
        <div className="rounded-xl bg-surface border border-bdr/40"
             style={{ boxShadow: "var(--shadow-surface)", padding: 20 }}>
          <h3 className="text-sm font-medium text-txt mb-3">错误 & 降级</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div className="flex justify-between text-sm">
              <span className="text-txt-sub">LLM 错误率</span>
              <span className={e.llmErrorRate > 5 ? "text-danger font-semibold" : "text-txt-muted"}>{e.llmErrorRate}% ({e.llmErrors}/{e.llmTotal})</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-txt-sub">工具错误率</span>
              <span className={e.toolErrorRate > 5 ? "text-danger font-semibold" : "text-txt-muted"}>{e.toolErrorRate}% ({e.toolErrors}/{e.toolTotal})</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-txt-sub">Provider 降级</span>
              <span className={e.fallbackCount > 0 ? "text-warning font-semibold" : "text-txt-muted"}>{e.fallbackCount} 次</span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 2fr" }}>
        <ToolRankCard data={dashboard} />
        <AgentActivityCard data={dashboard} />
      </div>

      <ActiveAgentsPanel />
    </main>
  );
}
