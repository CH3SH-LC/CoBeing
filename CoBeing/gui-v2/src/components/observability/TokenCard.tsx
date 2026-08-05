import type { DashboardData } from "@/lib/types";

function MiniBars({ daily }: { daily: DashboardData["tokens"]["daily"] }) {
  if (daily.length === 0) return (
    <div className="flex flex-col items-center text-center mt-3" style={{ gap: 4 }}>
      <div className="text-2xl leading-none">📊</div>
      <p className="text-sm text-txt-muted">暂无数据</p>
    </div>
  );
  const maxVal = Math.max(...daily.map(d => d.input + d.output), 1);
  return (
    <div className="flex items-end gap-1 mt-2" style={{ height: 40 }}>
      {daily.map((d) => (
        <div key={d.date} className="flex-1 flex flex-col items-center gap-0.5">
          <div className="w-full rounded-sm" style={{
            height: `${Math.max(4, ((d.input + d.output) / maxVal) * 36)}px`,
            background: "var(--color-accent)", opacity: 0.7 }} />
          <span className="text-xs text-txt-muted">{d.date.slice(5)}</span>
        </div>
      ))}
    </div>
  );
}

export function TokenCard({ data }: { data: DashboardData }) {
  const fmt = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}K` : String(n);
  return (
    <div className="rounded-xl bg-surface border border-bdr/40"
         style={{ boxShadow: "var(--shadow-surface)", padding: 20 }}>
      <h3 className="text-sm font-medium text-txt">Token 消耗</h3>
      <div className="flex gap-6 mt-3">
        <div><p className="text-sm text-txt-muted">今日</p><p className="text-xl font-bold text-accent">{fmt(data.tokens.today)}</p></div>
        <div><p className="text-sm text-txt-muted">累计</p><p className="text-xl font-bold text-txt">{fmt(data.tokens.total)}</p></div>
      </div>
      <MiniBars daily={data.tokens.daily} />
    </div>
  );
}
