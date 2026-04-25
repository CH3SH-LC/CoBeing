import { useState, useEffect } from "react";
import { getWsClient } from "@/hooks/useWebSocket";
import type { AgentFileInfo } from "@/lib/types";

const AGENT_FILES = [
  { name: "SOUL.md", icon: "\u{1F9E0}", desc: "人格内核" },
  { name: "CHARACTER.md", icon: "\u{1F4C4}", desc: "性格与风格" },
  { name: "JOB.md", icon: "\u{1F4CB}", desc: "职责定义" },
  { name: "USER.md", icon: "\u{1F464}", desc: "用户偏好" },
  { name: "AGENTS.md", icon: "\u{1F4D1}", desc: "工作空间指南" },
  { name: "EXPERIENCE.md", icon: "\u{1F4A1}", desc: "经验积累" },
  { name: "TOOLS.md", icon: "\u{1F527}", desc: "工具笔记" },
  { name: "MEMORY.md", icon: "\u{1F9E9}", desc: "记忆索引" },
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
            className="text-xs text-accent hover:text-accent/80"
          >
            {"\u2190"} 返回文件列表
          </button>
          <span className="text-xs text-txt-muted font-mono">{viewingFile}</span>
        </div>
        {loading ? (
          <div className="text-center py-8 text-xs text-txt-muted">加载中...</div>
        ) : (
          <>
            <textarea
              value={fileContent}
              onChange={(e) => { setFileContent(e.target.value); setDirty(true); }}
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
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {AGENT_FILES.map((file) => {
        const exists = files.some((f) => f.name === file.name);
        return (
          <button
            key={file.name}
            onClick={() => handleView(file.name)}
            className="w-full flex items-center gap-3 rounded-lg hover:bg-hover transition-colors text-left"
            style={{ padding: "12px 16px" }}
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
