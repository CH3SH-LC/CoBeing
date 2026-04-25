const STATUS_STYLES: Record<string, string> = {
  pending: "bg-accent/15 text-accent",
  completed: "bg-success/15 text-success",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "待完成",
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
