import { useState } from "react";
import { getWsClient } from "@/hooks/useWebSocket";

const WORKSPACE_DOCS = [
  { name: "MEMBERS.md", icon: "\u{1F465}", desc: "成员列表" },
  { name: "STRUCTURE.md", icon: "\u{1F3D7}\uFE0F", desc: "项目结构" },
  { name: "TASK.md", icon: "\u{1F4CB}", desc: "任务列表" },
  { name: "PROGRESS.md", icon: "\u{1F4CA}", desc: "进度跟踪" },
  { name: "PLAN.md", icon: "\u{1F5ED}\uFE0F", desc: "执行计划" },
];

interface GroupWorkspaceTabProps {
  groupId: string;
}

export function GroupWorkspaceTab({ groupId }: GroupWorkspaceTabProps) {
  const [viewingDoc, setViewingDoc] = useState<string | null>(null);
  const [docContent, setDocContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const handleView = (docName: string) => {
    setViewingDoc(docName);
    setLoading(true);
    setDirty(false);

    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail.payload?.groupId === groupId && detail.payload?.filename === docName) {
        setDocContent(detail.payload.content ?? "");
        setLoading(false);
        window.removeEventListener("ws-group-workspace-file", handler);
      }
    };
    window.addEventListener("ws-group-workspace-file", handler);
    getWsClient()?.send({
      type: "get_group_workspace_file",
      payload: { groupId, filename: docName },
    });
  };

  const handleSave = () => {
    if (!viewingDoc) return;
    setSaving(true);

    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail.payload?.groupId === groupId && detail.payload?.filename === viewingDoc) {
        setSaving(false);
        setDirty(false);
        window.removeEventListener("ws-group-workspace-file-saved", handler);
      }
    };
    window.addEventListener("ws-group-workspace-file-saved", handler);
    getWsClient()?.send({
      type: "save_group_workspace_file",
      payload: { groupId, filename: viewingDoc, content: docContent },
    });
  };

  if (viewingDoc) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="flex items-center justify-between">
          <button
            onClick={() => setViewingDoc(null)}
            className="text-xs text-accent hover:text-accent/80"
          >
            {"\u2190"} 返回文档列表
          </button>
          <span className="text-xs text-txt-muted font-mono">{viewingDoc}</span>
        </div>
        {loading ? (
          <div className="text-center py-8 text-xs text-txt-muted">加载中...</div>
        ) : (
          <>
            <textarea
              value={docContent}
              onChange={(e) => { setDocContent(e.target.value); setDirty(true); }}
              className="w-full h-64 px-3 py-2 rounded-lg bg-surface-solid border border-bdr text-xs text-txt font-mono resize-none focus:outline-none focus:border-accent/50"
            />
            <button
              onClick={handleSave}
              disabled={saving || !dirty}
              className="w-full h-9 rounded-lg text-xs font-medium bg-accent text-white hover:bg-accent/90 transition-colors disabled:opacity-40"
            >
              {saving ? "保存中..." : dirty ? "保存" : "未修改"}
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="text-sm text-txt-muted font-medium">Workspace 文档</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {WORKSPACE_DOCS.map((doc) => (
          <button
            key={doc.name}
            onClick={() => handleView(doc.name)}
            className="w-full flex items-center gap-3 rounded-lg hover:bg-hover transition-colors text-left"
            style={{ padding: "12px 16px" }}
          >
            <span className="text-base">{doc.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="text-sm text-txt">{doc.name}</div>
              <div className="text-sm text-txt-muted">{doc.desc}</div>
            </div>
            <span className="text-xs text-accent">编辑</span>
          </button>
        ))}
      </div>
    </div>
  );
}
