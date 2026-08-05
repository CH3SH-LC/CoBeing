import { useState, useEffect } from "react";
import { getWsClient } from "../../hooks/useWebSocket";

interface MemberActivity {
  agentId: string;
  name: string;
  messageCount: number;
  lastActive: string | null;
}

interface TodoStats {
  total: number;
  completed: number;
  completionRate: number;
}

interface GroupHealthData {
  groupId: string;
  status: string;
  createdAt: string;
  memberCount: number;
  memberActivity: MemberActivity[];
  todoStats: TodoStats;
  longestPendingHours: number;
}

export function GroupHealthPanel({ groupId }: { groupId: string }) {
  const [data, setData] = useState<GroupHealthData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!groupId) return;
    const ws = getWsClient();
    ws?.send({ type: "get_group_health", payload: { groupId } });
  }, [groupId]);

  useEffect(() => {
    const handler = (e: Event) => {
      const msg = (e as CustomEvent).detail;
      if (msg?.type === "group_health" && msg?.payload?.groupId === groupId) {
        setData(msg.payload);
        setLoading(false);
      }
    };
    window.addEventListener("ws-group-health", handler);
    return () => window.removeEventListener("ws-group-health", handler);
  }, [groupId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center" style={{ padding: 32 }}>
        <span className="text-sm text-txt-muted">加载中...</span>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center" style={{ padding: 32 }}>
        <span className="text-sm text-txt-muted">无法加载群组健康数据</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col" style={{ gap: 16 }}>
      {/* 任务完成率卡片 */}
      <div className="rounded-xl bg-elevated" style={{ padding: "18px 20px" }}>
        <h4 className="text-sm font-semibold text-txt-muted" style={{ marginBottom: 12 }}>
          任务完成率
        </h4>
        <div className="flex items-end" style={{ gap: 8 }}>
          <span className="text-2xl font-bold text-txt">{data.todoStats.completionRate}%</span>
          <span className="text-sm text-txt-muted">
            {data.todoStats.completed}/{data.todoStats.total} 已完成
          </span>
        </div>
        {data.todoStats.total > 0 && (
          <div className="w-full rounded-full bg-surface mt-3" style={{ height: 6 }}>
            <div
              className="h-full rounded-full bg-success transition-all"
              style={{ width: `${data.todoStats.completionRate}%` }}
            />
          </div>
        )}
      </div>

      {/* 成员活跃度 */}
      <div className="rounded-xl bg-elevated" style={{ padding: "18px 20px" }}>
        <h4 className="text-sm font-semibold text-txt-muted" style={{ marginBottom: 14 }}>
          成员活跃度 · {data.memberCount} 人
        </h4>
        <div className="flex flex-col" style={{ gap: 8 }}>
          {data.memberActivity.map((m) => (
            <div key={m.agentId} className="flex items-center justify-between">
              <div className="flex items-center" style={{ gap: 8 }}>
                <div
                  className="w-2 h-2 rounded-full"
                  style={{
                    backgroundColor: m.messageCount > 0 ? "var(--color-success)" : "var(--color-divider)",
                  }}
                />
                <span className="text-sm text-txt">{m.name}</span>
              </div>
              <div className="flex items-center" style={{ gap: 12 }}>
                <span className="text-xs text-txt-muted">{m.messageCount} 条消息</span>
                {m.lastActive && (
                  <span className="text-xs text-txt-muted">
                    {new Date(m.lastActive).toLocaleDateString("zh-CN")}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 阻塞时间 */}
      {data.longestPendingHours > 0 && (
        <div className="rounded-xl bg-elevated" style={{ padding: "18px 20px" }}>
          <h4 className="text-sm font-semibold text-txt-muted" style={{ marginBottom: 12 }}>
            最长阻塞
          </h4>
          <div className="flex items-end" style={{ gap: 8 }}>
            <span className={`text-2xl font-bold ${
              data.longestPendingHours > 24 ? "text-danger" : "text-warning"
            }`}>
              {data.longestPendingHours}h
            </span>
            <span className="text-sm text-txt-muted">最早待处理 TODO 已等待</span>
          </div>
        </div>
      )}
    </div>
  );
}
