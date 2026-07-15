import { useState } from "react";
import type { TaskReceipt } from "@/lib/types";

interface TaskReceiptCardProps {
  receipt: TaskReceipt;
}

const statusConfig: Record<TaskReceipt["status"], { label: string; className: string }> = {
  running: { label: "运行中", className: "bg-accent/10 text-accent" },
  waiting_user: { label: "待确认", className: "bg-warning/10 text-warning" },
  completed: { label: "已完成", className: "bg-success/10 text-success" },
  failed: { label: "失败", className: "bg-danger/10 text-danger" },
  cancelled: { label: "已取消", className: "bg-txt-muted/10 text-txt-muted" },
};

export function TaskReceiptCard({ receipt }: TaskReceiptCardProps) {
  const [expanded, setExpanded] = useState(false);
  const cfg = statusConfig[receipt.status];

  return (
    <div className="rounded-xl bg-msg-tool" style={{ padding: "12px 16px", marginTop: 12 }}>
      {/* Collapsed view */}
      <div
        className="flex items-center gap-3 cursor-pointer select-none"
        onClick={() => setExpanded(!expanded)}
      >
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cfg.className}`}>
          {cfg.label}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-txt font-medium truncate">
            {receipt.title}
          </p>
          <p className="text-xs text-txt-muted truncate">
            {receipt.assigneeType === "group" ? "群组" : "Agent"}：{receipt.assigneeName}
          </p>
        </div>
        <span className="text-xs text-txt-muted">
          {expanded ? "收起 ▲" : "展开 ▼"}
        </span>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="mt-3 pt-3 border-t border-bdr" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {receipt.summary && (
            <div>
              <p className="text-xs text-txt-muted font-medium" style={{ marginBottom: 4 }}>摘要</p>
              <p className="text-sm text-txt leading-relaxed">{receipt.summary}</p>
            </div>
          )}

          {receipt.nextAction && (
            <div className="rounded-lg bg-surface-solid" style={{ padding: "10px 14px" }}>
              <p className="text-xs text-txt-muted" style={{ marginBottom: 2 }}>下一步</p>
              <p className="text-sm text-txt">{receipt.nextAction}</p>
            </div>
          )}

          {receipt.artifacts && receipt.artifacts.length > 0 && (
            <div>
              <p className="text-xs text-txt-muted font-medium" style={{ marginBottom: 6 }}>产物</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {receipt.artifacts.map((a, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm text-txt-sub">
                    <span>📄</span>
                    <span>{a.name}</span>
                    {a.path && <span className="text-xs text-txt-muted font-mono">{a.path}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
