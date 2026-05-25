import { useUsageStore } from "@/stores/usage";
import { cn } from "@/lib/utils";

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

function fmtCost(n: number): string {
  if (n < 0.01) return "<0.01";
  return n.toFixed(2);
}

export function UsageMonitor() {
  const totals = useUsageStore((s) => s.totals);
  const byAgent = useUsageStore((s) => s.byAgent);
  const records = useUsageStore((s) => s.records);
  const clear = useUsageStore((s) => s.clear);

  const totalInput = totals.cacheHitTokens + totals.cacheMissTokens;
  const hitRate = totalInput > 0 ? Math.round((totals.cacheHitTokens / totalInput) * 100) : 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-txt mb-1">用量监控</h2>
          <p className="text-sm text-txt-muted">Token 使用量与缓存命中统计（DeepSeek 定价）</p>
        </div>
        <button
          onClick={clear}
          className="text-xs text-txt-muted hover:text-txt px-3 py-1.5 rounded-lg hover:bg-hover transition-colors"
        >
          清除统计
        </button>
      </div>

      {/* 总览卡片 */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        <StatCard
          label="输入 Tokens"
          value={fmt(totals.inputTokens)}
          sub={`读取 ${fmt(totals.cacheMissTokens)} / 命中 ${fmt(totals.cacheHitTokens)}`}
        />
        <StatCard
          label="输出 Tokens"
          value={fmt(totals.outputTokens)}
          sub="生成内容"
        />
        <StatCard
          label="缓存命中率"
          value={`${hitRate}%`}
          sub={hitRate >= 30 ? "良好" : hitRate >= 10 ? "一般" : "偏低"}
          highlight={hitRate >= 30 ? "good" : hitRate >= 10 ? "warn" : "bad"}
        />
        <StatCard
          label="累计费用"
          value={`¥${fmtCost(totals.totalCost)}`}
          sub="按 DeepSeek 定价估算"
        />
      </div>

      {/* 定价参考 */}
      <div className="p-4 rounded-xl bg-elevated mb-6">
        <div className="text-xs text-txt-muted mb-2 font-medium">定价参考（RMB / 百万 tokens）</div>
        <div className="flex gap-6 text-sm">
          <span className="text-txt-sub">读取（未命中）: <span className="text-txt font-medium">¥1.00</span></span>
          <span className="text-txt-sub">命中（缓存）: <span className="text-success font-medium">¥0.02</span></span>
          <span className="text-txt-sub">输出: <span className="text-txt font-medium">¥2.00</span></span>
        </div>
      </div>

      {/* 按 Agent 汇总 */}
      {Object.keys(byAgent).length > 0 && (
        <div className="mb-6">
          <div className="text-sm font-medium text-txt mb-3">按 Agent 汇总</div>
          <div className="rounded-xl border border-bdr/40 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-elevated text-txt-muted text-xs">
                  <th className="text-left px-4 py-2.5 font-medium">Agent</th>
                  <th className="text-right px-4 py-2.5 font-medium">请求次数</th>
                  <th className="text-right px-4 py-2.5 font-medium">读取</th>
                  <th className="text-right px-4 py-2.5 font-medium">命中</th>
                  <th className="text-right px-4 py-2.5 font-medium">输出</th>
                  <th className="text-right px-4 py-2.5 font-medium">命中率</th>
                  <th className="text-right px-4 py-2.5 font-medium">费用</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(byAgent).map(([agentId, stat]) => {
                  const agentInput = stat.cacheHitTokens + stat.cacheMissTokens;
                  const agentHitRate = agentInput > 0 ? Math.round((stat.cacheHitTokens / agentInput) * 100) : 0;
                  return (
                    <tr key={agentId} className="border-t border-bdr/20 hover:bg-hover/50">
                      <td className="px-4 py-2 text-txt font-medium">{agentId}</td>
                      <td className="px-4 py-2 text-right text-txt-sub">{stat.requestCount}</td>
                      <td className="px-4 py-2 text-right text-txt-sub">{fmt(stat.cacheMissTokens)}</td>
                      <td className="px-4 py-2 text-right text-success">{fmt(stat.cacheHitTokens)}</td>
                      <td className="px-4 py-2 text-right text-txt-sub">{fmt(stat.outputTokens)}</td>
                      <td className={cn("px-4 py-2 text-right font-medium",
                        agentHitRate >= 30 ? "text-success" : agentHitRate >= 10 ? "text-warning" : "text-danger"
                      )}>{agentHitRate}%</td>
                      <td className="px-4 py-2 text-right text-txt">¥{fmtCost(stat.cost)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 最近请求记录 */}
      {records.length > 0 && (
        <div>
          <div className="text-sm font-medium text-txt mb-3">最近请求</div>
          <div className="rounded-xl border border-bdr/40 overflow-hidden max-h-80 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0">
                <tr className="bg-elevated text-txt-muted text-xs">
                  <th className="text-left px-4 py-2.5 font-medium">时间</th>
                  <th className="text-left px-4 py-2.5 font-medium">Agent</th>
                  <th className="text-right px-4 py-2.5 font-medium">读取</th>
                  <th className="text-right px-4 py-2.5 font-medium">命中</th>
                  <th className="text-right px-4 py-2.5 font-medium">输出</th>
                  <th className="text-right px-4 py-2.5 font-medium">费用</th>
                </tr>
              </thead>
              <tbody>
                {records.slice(0, 50).map((r, i) => (
                  <tr key={i} className="border-t border-bdr/20 hover:bg-hover/50">
                    <td className="px-4 py-1.5 text-txt-sub text-xs">
                      {new Date(r.timestamp).toLocaleTimeString("zh-CN")}
                    </td>
                    <td className="px-4 py-1.5 text-txt">{r.agentId}</td>
                    <td className="px-4 py-1.5 text-right text-txt-sub">{fmt(r.cacheMissTokens)}</td>
                    <td className="px-4 py-1.5 text-right text-success">{fmt(r.cacheHitTokens)}</td>
                    <td className="px-4 py-1.5 text-right text-txt-sub">{fmt(r.outputTokens)}</td>
                    <td className="px-4 py-1.5 text-right text-txt">¥{fmtCost(r.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {records.length === 0 && (
        <div className="text-center text-txt-muted text-sm py-12">
          暂无用量数据。发送消息后将自动统计。
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, sub, highlight }: {
  label: string;
  value: string;
  sub: string;
  highlight?: "good" | "warn" | "bad";
}) {
  const colorMap = { good: "text-success", warn: "text-warning", bad: "text-danger" };
  return (
    <div className="p-4 rounded-xl bg-elevated">
      <div className="text-xs text-txt-muted mb-1">{label}</div>
      <div className={cn("text-2xl font-bold", highlight ? colorMap[highlight] : "text-txt")}>
        {value}
      </div>
      <div className="text-xs text-txt-sub mt-1">{sub}</div>
    </div>
  );
}
