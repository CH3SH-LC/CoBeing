import { useState } from "react";

interface ToolCallMessageProps {
  toolName: string;
  params: Record<string, unknown>;
  result?: string;
  status: "start" | "complete" | "error";
}

export function ToolCallMessage({ toolName, params, result, status }: ToolCallMessageProps) {
  const [expanded, setExpanded] = useState(false);

  const statusIcon = {
    start: "🔄",
    complete: "✅",
    error: "❌",
  }[status];

  const safeParams = params ?? {};
  const paramStr = Object.entries(safeParams)
    .map(([k, v]) => {
      const val = typeof v === "string" ? v : JSON.stringify(v);
      return `${k}: ${val.length > 60 ? val.slice(0, 60) + "..." : val}`;
    })
    .join(", ");

  return (
    <div className="flex justify-start" style={{ paddingLeft: 60 }}>
      <div
        className="max-w-[70%] rounded-xl rounded-bl-sm bg-msg-tool px-5 py-4 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2 mb-2">
          <span className="text-sm">{statusIcon}</span>
          <span className="text-xs font-medium text-purple">Tool: {toolName}</span>
          <span className="text-xs text-txt-muted">
            {status === "start" ? "执行中..." : status === "complete" ? "完成" : "失败"}
          </span>
        </div>
        <div className="text-xs text-txt-sub font-mono">
          {expanded ? (
            <pre className="whitespace-pre-wrap break-all">{JSON.stringify(params, null, 2)}</pre>
          ) : (
            <span className="truncate block">{paramStr}</span>
          )}
        </div>
        {result && expanded && (
          <div className="mt-3 pt-3 border-t border-bdr">
            <div className="text-xs text-txt-muted mb-2">结果:</div>
            <pre className="text-xs text-txt-sub font-mono whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
              {result.length > 500 ? result.slice(0, 500) + "\n..." : result}
            </pre>
          </div>
        )}
        <div className="text-xs text-txt-muted mt-2">
          {expanded ? "点击收起 ▲" : "点击展开 ▼"}
        </div>
      </div>
    </div>
  );
}
