import { useEffect, useState } from "react";
import { useAgentEnhancementStore } from "@/stores/agentEnhancement";
import type { AgentTaskStatus } from "@/lib/types";

const STATUS_LABELS: Record<AgentTaskStatus, { text: string; color: string }> = {
  pending: { text: "待处理", color: "bg-accent/10 text-accent" },
  running: { text: "执行中", color: "bg-success/10 text-success" },
  blocked: { text: "阻塞", color: "bg-warning/10 text-warning" },
  waiting_user: { text: "等待用户", color: "bg-warning/10 text-warning" },
  waiting_dependency: { text: "等待依赖", color: "bg-purple/10 text-purple" },
  completed: { text: "已完成", color: "bg-success/10 text-success" },
  failed: { text: "失败", color: "bg-danger/10 text-danger" },
  cancelled: { text: "已取消", color: "bg-elevated text-txt-muted" },
};

type FilterType = "all" | "active" | "completed" | "blocked";

export function TaskInboxTab({ agentId }: { agentId: string }) {
  const inboxData = useAgentEnhancementStore((s) => s.inboxes[agentId]);
  const loading = useAgentEnhancementStore((s) => s.loading[`inbox_${agentId}`]);
  const fetchInbox = useAgentEnhancementStore((s) => s.fetchInbox);
  const [filter, setFilter] = useState<FilterType>("active");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    fetchInbox(agentId);
  }, [agentId, fetchInbox]);

  if (loading) {
    return <div className="p-4 text-txt-muted text-sm">加载中...</div>;
  }

  const allItems = [...(inboxData?.active ?? []), ...(inboxData?.archived ?? [])];

  const filtered = allItems.filter((item) => {
    switch (filter) {
      case "active": return !["completed", "cancelled"].includes(item.status);
      case "completed": return ["completed", "cancelled"].includes(item.status);
      case "blocked": return item.status === "blocked";
      default: return true;
    }
  });

  return (
    <div style={{ padding: "16px 0" }}>
      <div className="flex flex-wrap gap-2 mb-4">
        {(["all", "active", "completed", "blocked"] as FilterType[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-lg text-sm font-medium transition-colors ${
              filter === f ? "bg-accent text-white" : "bg-elevated text-txt-muted hover:bg-hover hover:text-txt"
            }`}
            style={{ padding: "8px 12px" }}
          >
            {f === "all" ? "全部" : f === "active" ? "活跃" : f === "completed" ? "已完成" : "阻塞"}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-xl bg-elevated text-txt-muted text-sm text-center" style={{ padding: 24 }}>无任务</p>
      ) : (
        <div className="space-y-3">
          {filtered.map((item) => {
            const sl = STATUS_LABELS[item.status] ?? STATUS_LABELS.pending;
            const isExpanded = expandedId === item.id;
            return (
              <div key={item.id} className="border border-bdr/40 rounded-xl bg-elevated text-sm" style={{ padding: "14px 20px" }}>
                <div
                  className="flex items-center justify-between cursor-pointer gap-3"
                  onClick={() => setExpandedId(isExpanded ? null : item.id)}
                >
                  <span className="font-medium text-txt truncate flex-1 mr-2">{item.title}</span>
                  <span className={`px-2.5 py-1 rounded-lg text-xs font-medium ${sl.color}`}>{sl.text}</span>
                </div>
                {isExpanded && (
                  <div className="mt-3 pt-3 border-t border-bdr/40 space-y-3 text-txt-muted">
                    <p><strong>目标:</strong> {item.goal}</p>
                    {item.acceptance && <p><strong>验收:</strong> {item.acceptance}</p>}
                    {item.blockerReason && <p><strong>阻塞原因:</strong> {item.blockerReason}</p>}
                    {item.failureSummary && <p><strong>失败摘要:</strong> {item.failureSummary}</p>}
                    {item.dependencyRefs && item.dependencyRefs.length > 0 && (
                      <p><strong>依赖:</strong> {item.dependencyRefs.map(d => `${d.agentId}${d.todoId ? ` (${d.todoId})` : ""}`).join(", ")}</p>
                    )}
                    {item.artifacts && item.artifacts.length > 0 && (
                      <p><strong>交付物:</strong> {item.artifacts.map(a => a.name).join(", ")}</p>
                    )}
                    <p><strong>来源:</strong> {item.sourceType}/{item.sourceId}</p>
                    <p><strong>创建:</strong> {new Date(item.createdAt).toLocaleString()} · <strong>更新:</strong> {new Date(item.updatedAt).toLocaleString()}</p>
                    {item.globalTodoId && <p>🔗 全局 TODO: {item.globalTodoId}</p>}
                    {item.agentTodoId && <p>🔗 Agent TODO: {item.agentTodoId}</p>}
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
