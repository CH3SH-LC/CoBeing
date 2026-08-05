import type { DashboardData } from "@/lib/types";

export function ToolRankCard({ data }: { data: DashboardData }) {
  if (data.tools.length === 0) return (
    <div className="rounded-xl bg-surface border border-bdr/40"
         style={{ boxShadow: "var(--shadow-surface)", padding: 20 }}>
      <h3 className="text-sm font-medium text-txt">工具调用排行</h3>
      <div className="flex flex-col items-center text-center mt-3" style={{ gap: 4 }}>
        <div className="text-2xl leading-none">🔧</div>
        <p className="text-sm text-txt-muted">暂无数据</p>
      </div>
    </div>
  );
  const maxCount = Math.max(...data.tools.map(t => t.count), 1);
  return (
    <div className="rounded-xl bg-surface border border-bdr/40"
         style={{ boxShadow: "var(--shadow-surface)", padding: 20 }}>
      <h3 className="text-sm font-medium text-txt">工具调用排行</h3>
      <div className="mt-2 flex flex-col gap-1.5">
        {data.tools.slice(0, 8).map((t) => (
          <div key={t.name} className="flex items-center gap-2">
            <span className="text-sm w-20 truncate" title={t.name}>{t.name}</span>
            <div className="flex-1 h-3 rounded-sm bg-elevated overflow-hidden">
              <div className="h-full rounded-sm bg-accent/60" style={{ width: `${(t.count / maxCount) * 100}%` }} />
            </div>
            <span className="text-sm text-txt-muted w-10 text-right">{t.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
