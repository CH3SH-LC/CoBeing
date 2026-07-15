import { useState, useEffect, useCallback } from "react";
import { getWsClient } from "@/hooks/useWebSocket";

interface SandboxStatusInfo {
  agentId: string;
  agentName: string;
  containerId: string | null;
  running: boolean;
  uptime: number;
  memoryUsage: number;
  memoryLimit: number;
  cpuPercent: number;
  diskUsage?: number;
  diskLimit?: number;
}

export function SandboxMonitor() {
  const [statuses, setStatuses] = useState<SandboxStatusInfo[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(() => {
    setLoading(true);
    getWsClient()?.send({ type: "get_sandbox_status" });
    setTimeout(() => setLoading(false), 500);
  }, []);

  useEffect(() => {
    const handler = (ev: Event) => {
      const ce = ev as CustomEvent;
      const msg = ce.detail;
      if (msg.type === "sandbox_status") {
        setStatuses(msg.payload);
        setLoading(false);
      }
    };

    window.addEventListener("ws-sandbox-status", handler);
    refresh();

    return () => { window.removeEventListener("ws-sandbox-status", handler); };
  }, [refresh]);

  const handleAction = (agentId: string, action: string) => {
    getWsClient()?.send({ type: "sandbox_action", payload: { agentId, action } });
    setTimeout(refresh, 500);
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const formatUptime = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-txt">沙箱状态监控</h3>
        <button onClick={refresh} disabled={loading}
          className="h-8 px-4 rounded-lg text-sm bg-accent text-white hover:bg-accent/90 disabled:opacity-50">
          {loading ? "刷新中..." : "刷新"}
        </button>
      </div>

      {statuses.length === 0 ? (
        <div className="text-center py-8 text-txt-sub">暂无运行中的沙箱</div>
      ) : (
        <div className="space-y-3">
          {statuses.map((status) => (
            <div key={status.agentId} className="rounded-xl bg-elevated p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium text-txt">{status.agentName}</span>
                  <span className="text-xs text-txt-sub ml-2">({status.agentId})</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${status.running ? "bg-success" : "bg-txt-muted"}`} />
                  <span className="text-xs text-txt-sub">{status.running ? "运行中" : "已停止"}</span>
                </div>
              </div>

              {status.containerId && (
                <div className="text-xs text-txt-sub">
                  容器ID: <code className="bg-surface-solid px-1 rounded">{status.containerId.slice(0, 12)}</code>
                </div>
              )}

              {status.running && (
                <>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-txt-sub">运行时间:</span>
                      <span className="text-txt ml-1">{formatUptime(status.uptime)}</span>
                    </div>
                    <div>
                      <span className="text-txt-sub">CPU:</span>
                      <span className="text-txt ml-1">{status.cpuPercent.toFixed(1)}%</span>
                    </div>
                    <div>
                      <span className="text-txt-sub">内存:</span>
                      <span className="text-txt ml-1">{formatBytes(status.memoryUsage)} / {formatBytes(status.memoryLimit)}</span>
                    </div>
                    {status.diskUsage !== undefined && (
                      <div>
                        <span className="text-txt-sub">磁盘:</span>
                        <span className="text-txt ml-1">{formatBytes(status.diskUsage)} / {formatBytes(status.diskLimit ?? 0)}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2 pt-2">
                    <button onClick={() => handleAction(status.agentId, "restart")}
                      className="h-7 px-3 rounded text-xs bg-hover text-txt-sub hover:bg-elevated">
                      重启
                    </button>
                    <button onClick={() => handleAction(status.agentId, "stop")}
                      className="h-7 px-3 rounded text-xs bg-danger/10 text-danger hover:bg-danger/20">
                      停止
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
