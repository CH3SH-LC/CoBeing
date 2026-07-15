import { useState } from "react";
import { useAgentsStore } from "@/stores/agents";
import { getWsClient } from "@/hooks/useWebSocket";

interface Props {
  agentId: string;
}

export function WorkspaceBindingSection({ agentId }: Props) {
  const agents = useAgentsStore((s) => s.agents);
  const agent = agents.find((a) => a.id === agentId);
  const bindings = agent?.bindings ?? [];
  const [showAdd, setShowAdd] = useState(false);
  const [path, setPath] = useState("");
  const [mode, setMode] = useState<"readonly" | "readwrite">("readwrite");
  const [adding, setAdding] = useState(false);

  const handleAdd = () => {
    if (!path.trim()) return;
    setAdding(true);
    getWsClient()?.send({ type: "add_binding", payload: { agentId, workspacePath: path.trim(), mode } });
    setPath("");
    setMode("readwrite");
    setShowAdd(false);
    setTimeout(() => setAdding(false), 500);
  };

  const handleRemove = (bindingPath: string) => {
    getWsClient()?.send({ type: "remove_binding", payload: { agentId, workspacePath: bindingPath } });
  };

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-bold text-txt">工作区绑定</h3>

      {/* 原始工作区 — 只读展示 */}
      <div className="flex items-center gap-2 text-sm text-txt-muted">
        <span className="w-16 shrink-0">默认</span>
        <code className="flex-1 truncate rounded bg-hover px-2 py-1 text-xs">
          data/agents/{agentId}/workspace/
        </code>
        <span className="shrink-0 text-xs px-1.5 py-0.5 rounded bg-success/10 text-success">读写</span>
      </div>

      {/* 用户绑定列表 */}
      {bindings.map((b) => (
        <div key={b.path} className="flex items-center gap-2 text-sm">
          <span className="w-16 shrink-0 text-txt-muted">{b.label || "绑定"}</span>
          <code className="flex-1 truncate rounded bg-hover px-2 py-1 text-xs">{b.path}</code>
          <span className={`shrink-0 text-xs px-1.5 py-0.5 rounded ${
            b.mode === "readwrite" ? "bg-success/10 text-success" : "bg-warning/10 text-warning"
          }`}>
            {b.mode === "readwrite" ? "读写" : "只读"}
          </span>
          <button
            className="shrink-0 text-txt-muted hover:text-danger transition-colors px-1"
            onClick={() => handleRemove(b.path)}
            title="移除绑定"
          >
            ×
          </button>
        </div>
      ))}

      {/* 空状态 */}
      {bindings.length === 0 && (
        <p className="text-sm text-txt-muted">未绑定外部目录</p>
      )}

      {/* 添加绑定 */}
      {showAdd ? (
        <div className="space-y-2 rounded-lg border border-bdr/40 p-3 bg-surface">
          <input
            type="text"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="输入要绑定的目录路径..."
            className="w-full rounded bg-hover px-2 py-1 text-sm text-txt outline-none"
          />
          <div className="flex items-center gap-2">
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as "readonly" | "readwrite")}
              className="rounded bg-hover px-2 py-1 text-sm text-txt outline-none"
            >
              <option value="readwrite">读写</option>
              <option value="readonly">只读</option>
            </select>
            <button
              className="rounded bg-accent px-3 py-1 text-sm text-white disabled:opacity-40"
              onClick={handleAdd}
              disabled={!path.trim() || adding}
            >
              确认
            </button>
            <button
              className="rounded px-2 py-1 text-sm text-txt-muted hover:text-txt"
              onClick={() => setShowAdd(false)}
            >
              取消
            </button>
          </div>
        </div>
      ) : (
        <button
          className="text-sm text-accent hover:underline"
          onClick={() => setShowAdd(true)}
        >
          + 添加绑定
        </button>
      )}
    </div>
  );
}
