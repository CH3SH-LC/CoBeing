import { useState, useEffect } from "react";
import { getWsClient } from "../../hooks/useWebSocket";
import { useAgentsStore } from "../../stores/agents";

interface TimelineEvent {
  agent_id: string;
  agent_name: string;
  tool_name: string;
  timestamp: number;
  is_error: number;
  latency_ms: number;
  param_chars: number;
  result_chars: number;
}

export function AgentTimeline({ agentId }: { agentId: string }) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const agents = useAgentsStore((s) => s.agents);
  const agentName = agents.find((a) => a.id === agentId)?.name ?? agentId;

  useEffect(() => {
    if (!agentId) return;
    const ws = getWsClient();
    ws?.send({ type: "get_agent_timeline", payload: { agentId, limit: 50 } });
  }, [agentId]);

  useEffect(() => {
    const handler = (e: Event) => {
      const msg = (e as CustomEvent).detail;
      if (msg?.type === "agent_timeline" && msg?.payload?.agentId === agentId) {
        setEvents(msg.payload.events || []);
        setLoading(false);
      }
    };
    window.addEventListener("ws-agent-timeline", handler);
    return () => window.removeEventListener("ws-agent-timeline", handler);
  }, [agentId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center" style={{ padding: 32 }}>
        <span className="text-sm text-txt-muted">加载时间线...</span>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="flex items-center justify-center" style={{ padding: 32 }}>
        <span className="text-sm text-txt-muted">{agentName} 暂无活动记录</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col" style={{ gap: 0 }}>
      <h4 className="text-sm font-semibold text-txt-muted tracking-wider mb-3">
        {agentName} · 最近 {events.length} 条活动
      </h4>
      <div className="relative" style={{ paddingLeft: 24 }}>
        {/* 竖线 */}
        <div className="absolute rounded-full" style={{ left: 7, top: 8, bottom: 8, width: 2, backgroundColor: "var(--color-divider)" }} />

        {events.map((e, i) => {
          const duration = `${e.latency_ms}ms`;
          const isError = !!e.is_error;
          const time = new Date(e.timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

          return (
            <div key={i} className="relative" style={{ paddingBottom: i < events.length - 1 ? 16 : 0 }}>
              {/* 圆点 */}
              <div
                className="absolute w-3 h-3 rounded-full border-2 border-surface"
                style={{
                  left: -18, top: 4,
                  backgroundColor: isError ? "var(--color-danger)" : "var(--color-warning)",
                }}
              />
              <div className="rounded-lg bg-elevated" style={{ padding: "14px 20px" }}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-txt">{e.tool_name}</span>
                  <span className={`text-xs ${isError ? "text-danger" : "text-txt-muted"}`}>
                    {duration}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-txt-muted">{time}</span>
                  {e.is_error ? (
                    <span className="text-xs text-danger font-medium">失败</span>
                  ) : (
                    <span className="text-xs text-success">成功</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
