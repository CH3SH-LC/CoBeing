const STATUS_STYLES: Record<string, string> = {
  pending: "bg-accent/15 text-accent",
  "in-progress": "bg-warning/15 text-warning",
  review: "bg-purple/15 text-purple",
  completed: "bg-success/15 text-success",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "待处理",
  "in-progress": "进行中",
  review: "审核中",
  completed: "已完成",
};

export function TodoStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full text-xs font-medium ${STATUS_STYLES[status] || ""}`}
      style={{ padding: "3px 10px", flexShrink: 0 }}
    >
      {STATUS_LABELS[status] || status}
    </span>
  );
}
