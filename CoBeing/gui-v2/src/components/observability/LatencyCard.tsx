import type { DashboardData } from "@/lib/types";

export function LatencyCard({ data }: { data: DashboardData }) {
  const hourly = data.latency.hourly;
  const maxLat = Math.max(...hourly.map(h => h.avg), 1);
  return (
    <div className="rounded-xl bg-surface border border-bdr/40"
         style={{ boxShadow: "var(--shadow-surface)", padding: 20 }}>
      <h3 className="text-sm font-medium text-txt">响应时间（24h）</h3>
      <div className="flex gap-6 mt-3">
        <div><p className="text-sm text-txt-muted">P50</p><p className="text-xl font-bold text-accent">{(data.latency.p50 / 1000).toFixed(1)}s</p></div>
        <div><p className="text-sm text-txt-muted">P95</p><p className="text-xl font-bold text-txt">{(data.latency.p95 / 1000).toFixed(1)}s</p></div>
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
