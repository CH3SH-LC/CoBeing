import { useState, useRef, useEffect } from "react";
import { getWsClient } from "@/hooks/useWebSocket";

interface LogEntry {
  timestamp: number;
  direction: string;
  content: string;
}

type LogLevel = "all" | "in" | "out" | "system";

export function LogsSection() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState<LogLevel>("all");
  const [autoScroll, setAutoScroll] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 订阅日志
  useEffect(() => {
    getWsClient()?.send({ type: "subscribe_log" });
  }, []);

  // 监听 WS 日志消息（通过 custom event 桥接）
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.type === "log") {
        setLogs(detail.payload as LogEntry[]);
      } else if (detail?.type === "log_entry") {
        setLogs(prev => {
          const next = [...prev, detail.payload as LogEntry];
          return next.length > 500 ? next.slice(-500) : next;
        });
      }
    };
    window.addEventListener("ws-log", handler);
    return () => window.removeEventListener("ws-log", handler);
  }, []);

  // 自动滚动
  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs, autoScroll]);

  // 检测手动滚动
  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    setAutoScroll(atBottom);
  };

  const filtered = filter === "all" ? logs : logs.filter(l => l.direction === filter);

  const dirColors: Record<string, string> = {
    in: "text-accent",
    out: "text-success",
    system: "text-accent-warm",
  };

  return (
    <div className="flex flex-col h-[calc(100vh-200px)]">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-lg font-semibold text-txt">日志</h2>
          <p className="text-sm text-txt-muted">{filtered.length} 条记录</p>
        </div>
        <div className="flex items-center gap-2">
          {(["all", "in", "out", "system"] as LogLevel[]).map(l => (
            <button key={l} onClick={() => setFilter(l)} className={`px-2 py-1 rounded text-xs ${filter === l ? "bg-accent/10 text-accent font-medium" : "text-txt-muted hover:text-txt"}`}>
              {l === "all" ? "全部" : l}
            </button>
          ))}
          <button onClick={() => setLogs([])} className="ml-2 px-2 py-1 rounded text-xs text-txt-muted hover:text-danger">清空</button>
        </div>
      </div>

      <div ref={containerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto rounded-lg bg-elevated border border-bdr p-3 font-mono text-xs space-y-1">
        {filtered.length === 0 ? (
          <div className="text-txt-muted text-center py-8">暂无日志</div>
        ) : (
          filtered.map((log, i) => (
            <div key={i} className="flex gap-2">
              <span className="text-txt-muted shrink-0">{new Date(log.timestamp).toLocaleTimeString()}</span>
              <span className={`shrink-0 w-12 ${dirColors[log.direction] || "text-txt-muted"}`}>[{log.direction}]</span>
              <span className="text-txt break-all">{log.content}</span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
      {!autoScroll && (
        <button onClick={() => { setAutoScroll(true); bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }} className="mt-2 mx-auto px-3 py-1.5 rounded-lg text-xs bg-accent text-white hover:bg-accent/90">跳到底部</button>
      )}
    </div>
  );
}
