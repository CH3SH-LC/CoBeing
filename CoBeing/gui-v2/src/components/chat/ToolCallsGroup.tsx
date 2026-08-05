import { useState, useMemo } from "react";

export function ToolCallsGroup({ toolCalls }: { toolCalls: import("@/lib/types").ToolEvent[] }) {
  const [expanded, setExpanded] = useState(false);
  const [expandedTool, setExpandedTool] = useState<number | null>(null);

  // Deduplicate: prefer "complete" over "start" for same toolName, dedup by toolCallId
  const deduped = useMemo(() => {
    const seen = new Map<string, import("@/lib/types").ToolEvent>();
    for (const tc of toolCalls) {
      const key = tc.toolCallId || `${tc.toolName}-${tc.status}`;
      const existing = seen.get(key);
      if (!existing || (tc.status !== "start" && existing.status === "start")) {
        seen.set(key, tc);
      }
    }
    // Also merge: for "start" entries without toolCallId, if a "complete" with same toolName exists, replace
    const result = [...seen.values()];
    const byName = new Map<string, number>();
    for (let i = 0; i < result.length; i++) {
      const tc = result[i];
      if (tc.toolCallId) continue;
      const prev = byName.get(tc.toolName);
      if (prev !== undefined && result[prev].status === "start" && tc.status !== "start") {
        result[prev] = tc;
      } else if (prev === undefined) {
        byName.set(tc.toolName, i);
      }
    }
    return result;
  }, [toolCalls]);

  const completed = deduped.filter(t => t.status !== "start").length;
  const running = deduped.filter(t => t.status === "start").length;

  return (
    <div className="rounded-xl bg-msg-tool mb-4" style={{ padding: "10px 14px" }}>
      <div
        className="flex items-center gap-2 cursor-pointer select-none rounded-lg -mx-1 px-1 transition-colors hover:bg-hover"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="text-sm">{running > 0 ? "🔄" : "✅"}</span>
        <span className="text-xs font-medium text-success">
          {completed}/{deduped.length} 次工具调用
        </span>
        {running > 0 && (
          <span className="text-xs text-txt-muted">({running} 执行中)</span>
        )}
        <span className="text-xs text-txt-muted ml-auto">
          {expanded ? "收起 ▲" : "展开 ▼"}
        </span>
      </div>
      {expanded && (
        <div className="mt-3 pt-3 border-t border-bdr" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {deduped.map((tc, i) => {
            const icon = tc.status === "start" ? "🔄" : tc.status === "error" ? "❌" : "✅";
            const isToolExpanded = expandedTool === i;
            return (
              <div key={i} className="text-xs">
                <div
                  className="flex items-center gap-2 cursor-pointer rounded-lg font-mono text-success transition-colors hover:bg-hover"
                  style={{ padding: "2px 6px", margin: "0 -6px" }}
                  onClick={() => setExpandedTool(isToolExpanded ? null : i)}
                >
                  <span>{icon}</span>
                  <span className="font-medium">{tc.toolName}</span>
                  <span className="text-txt-muted">
                    {tc.status === "start" ? "执行中..." : tc.status === "error" ? "失败" : "完成"}
                  </span>
                </div>
                {isToolExpanded && (
                  <div className="mt-2 ml-6 p-4 rounded-lg bg-surface-solid font-mono text-txt-sub">
                    {tc.params && Object.keys(tc.params).length > 0 && (
                      <div className="mb-2">
                        <div className="text-txt-muted mb-1">参数:</div>
                        <pre className="whitespace-pre-wrap break-all">{JSON.stringify(tc.params, null, 2)}</pre>
                      </div>
                    )}
                    {tc.result && (
                      <div>
                        <div className="text-txt-muted mb-1">结果:</div>
                        <pre className="whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
                          {tc.result.length > 300 ? tc.result.slice(0, 300) + "\n..." : tc.result}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
