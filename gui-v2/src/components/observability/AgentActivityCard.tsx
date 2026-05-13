import type { DashboardData } from "@/lib/types";

export function AgentActivityCard({ data }: { data: DashboardData }) {
  if (data.agents.length === 0) return (
    <div className="rounded-xl bg-surface border border-bdr/40 col-span-2"
         style={{ boxShadow: "var(--shadow-surface)", padding: 20 }}>
      <h3 className="text-sm font-medium text-txt">Agent 活跃度（近 7 天）</h3>
      <p className="text-xs text-txt-muted mt-2">暂无数据</p>
    </div>
  );
  const maxCount = Math.max(...data.agents.map(a => a.callCount), 1);
  return (
    <div className="rounded-xl bg-surface border border-bdr/40 col-span-2"
         style={{ boxShadow: "var(--shadow-surface)", padding: 20 }}>
      <h3 className="text-sm font-medium text-txt">Agent 活跃度（近 7 天）</h3>
      <div className="mt-2 flex flex-col gap-2">
        {data.agents.map((a) => (
          <div key={a.agentId} className="flex items-center gap-2">
            <span className="text-xs w-24 truncate" title={a.agentName}>{a.agentName}</span>
            <div className="flex-1 h-4 rounded-sm bg-surface-solid overflow-hidden">
              <div className="h-full rounded-sm bg-accent/60 flex items-center justify-end pr-1"
                   style={{ width: `${Math.max(5, (a.callCount / maxCount) * 100)}%` }}>
                <span className="text-xs text-white font-semibold">{a.callCount} 次</span>
              </div>
            </div>
            <span className="text-xs text-txt-muted w-16 text-right">{a.totalTokens >= 1000 ? `${(a.totalTokens / 1000).toFixed(0)}K` : a.totalTokens} tok</span>
          </div>
        ))}
      </div>
    </div>
  );
}
