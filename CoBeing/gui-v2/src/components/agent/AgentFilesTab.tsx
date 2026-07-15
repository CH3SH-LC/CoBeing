import { useState, useEffect } from "react";
import { getWsClient } from "@/hooks/useWebSocket";
import type { AgentFileInfo } from "@/lib/types";

const AGENT_FILES = [
  { name: "CHARACTER.md", icon: "\u{1F4C4}", desc: "人物形象" },
  { name: "JOB.md", icon: "\u{1F4CB}", desc: "工作范式" },
  { name: "AGENTS.md", icon: "\u{1F4D1}", desc: "工作空间指南" },
  { name: "MEMORY.md", icon: "\u{1F9E9}", desc: "事件记录" },
  { name: "EXPERIENCE.md", icon: "\u{1F4A1}", desc: "工作经验" },
  { name: "config.json", icon: "\u2699\uFE0F", desc: "运行时配置" },
];

interface AgentFilesTabProps {
  agentId: string;
}

export function AgentFilesTab({ agentId }: AgentFilesTabProps) {
  const [viewingFile, setViewingFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [files, setFiles] = useState<AgentFileInfo[]>([]);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail.payload?.agentId === agentId) {
        setFiles(detail.payload.files || []);
      }
    };
    window.addEventListener("ws-agent-files", handler);
    getWsClient()?.send({ type: "get_agent_files", payload: { agentId } });
    return () => window.removeEventListener("ws-agent-files", handler);
  }, [agentId]);

  const handleView = (filename: string) => {
    setViewingFile(filename);
    setLoading(true);
    setDirty(false);

    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail.payload?.agentId === agentId && detail.payload?.filename === filename) {
        setFileContent(detail.payload.content ?? "");
        setLoading(false);
        window.removeEventListener("ws-agent-file-content", handler);
      }
    };
    window.addEventListener("ws-agent-file-content", handler);
    getWsClient()?.send({ type: "read_agent_file", payload: { agentId, filename } });
  };

  const handleSave = () => {
    if (!viewingFile) return;
    setSaving(true);

    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail.payload?.agentId === agentId && detail.payload?.filename === viewingFile) {
        setSaving(false);
        setDirty(false);
        window.removeEventListener("ws-file-saved", handler);
      }
    };
    window.addEventListener("ws-file-saved", handler);
    getWsClient()?.send({
      type: "write_agent_file",
      payload: { agentId, filename: viewingFile, content: fileContent },
    });
  };

  if (viewingFile) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="flex items-center justify-between">
          <button
            onClick={() => setViewingFile(null)}
            className="text-sm text-accent hover:text-accent/80 rounded-lg hover:bg-hover" style={{ padding: "6px 10px" }}
          >
            {"\u2190"} 返回文件列表
          </button>
          <span className="text-sm text-txt-muted font-mono">{viewingFile}</span>
        </div>
        {loading ? (
          <div className="text-center py-8 text-sm text-txt-muted">加载中...</div>
        ) : (
          <>
            <textarea
              value={fileContent}
              onChange={(e) => { setFileContent(e.target.value); setDirty(true); }}
              className="w-full h-72 rounded-xl bg-surface-solid border border-bdr/40 text-sm text-txt font-mono resize-none focus:outline-none focus:border-accent/50" style={{ padding: "14px 16px" }}
            />
            <button
              onClick={handleSave}
              disabled={saving || !dirty}
              className="w-full h-10 rounded-lg text-sm font-medium bg-accent text-white hover:bg-accent/90 transition-colors disabled:opacity-40"
            >
              {saving ? "保存中..." : dirty ? "保存" : "未修改"}
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {AGENT_FILES.map((file) => {
        const exists = files.some((f) => f.name === file.name);
        return (
          <button
            key={file.name}
            onClick={() => handleView(file.name)}
            className="w-full flex items-center gap-3 rounded-xl border border-transparent hover:border-bdr/30 hover:bg-hover transition-colors text-left"
            style={{ padding: "14px 16px" }}
          >
            <span className="text-base">{file.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="text-sm text-txt">{file.name}</div>
              <div className="text-sm text-txt-muted">{file.desc}</div>
            </div>
            {exists ? (
              <span className="text-xs text-accent">编辑</span>
            ) : (
              <span className="text-xs text-txt-muted">空</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
