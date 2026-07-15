import { Send, Plus, BarChart3 } from "lucide-react";
import { useAgentsStore } from "@/stores/agents";
import { useGroupsStore } from "@/stores/groups";
import { getVisibleUserAgents } from "@/lib/coreAgents";
import { useState, useRef, useEffect } from "react";

interface ChatInputActionsProps {
  view: "butler" | "agent" | "group";
  onInsertText?: (text: string) => void;
}

export function ChatInputActions({ view, onInsertText }: ChatInputActionsProps) {
  const [showDispatchMenu, setShowDispatchMenu] = useState(false);
  const [showCreateMenu, setShowCreateMenu] = useState(false);
  const agents = useAgentsStore((s) => s.agents);
  const groups = useGroupsStore((s) => s.groups);
  const dispatchRef = useRef<HTMLDivElement>(null);
  const createRef = useRef<HTMLDivElement>(null);

  // Close menus on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dispatchRef.current && !dispatchRef.current.contains(e.target as Node)) setShowDispatchMenu(false);
      if (createRef.current && !createRef.current.contains(e.target as Node)) setShowCreateMenu(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const visibleAgents = getVisibleUserAgents(agents);

  const btnClass = "text-xs text-txt-sub hover:text-txt hover:bg-hover rounded-md transition-colors flex items-center gap-1";
  const btnStyle = { padding: "4px 8px" };

  if (view === "butler") {
    return (
      <div className="flex items-center" style={{ gap: 4 }}>
        {/* 派发 */}
        <div ref={dispatchRef} className="relative">
          <button
            onClick={() => { setShowDispatchMenu(!showDispatchMenu); setShowCreateMenu(false); }}
            className={btnClass}
            style={btnStyle}
          >
            <Send size={12} /> 派发
          </button>
          {showDispatchMenu && (
            <div className="absolute bottom-full left-0 rounded-lg bg-elevated border border-bdr shadow-lg z-20 overflow-y-auto"
                 style={{ marginBottom: 4, width: 200, maxHeight: 160 }}>
              <p className="text-xs text-txt-muted font-medium" style={{ padding: "8px 12px 4px" }}>选择目标</p>
              {visibleAgents.map((a) => (
                <button key={a.id} onClick={() => { onInsertText?.(`@${a.id} `); setShowDispatchMenu(false); }}
                  className="w-full text-left text-xs text-txt hover:bg-hover transition-colors truncate"
                  style={{ padding: "8px 12px" }}>
                  <span>🤖 {a.name}</span>
                </button>
              ))}
              {groups.map((g) => (
                <button key={g.id} onClick={() => { onInsertText?.(`@${g.id} `); setShowDispatchMenu(false); }}
                  className="w-full text-left text-xs text-txt hover:bg-hover transition-colors truncate"
                  style={{ padding: "8px 12px" }}>
                  <span>👥 {g.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 创建 */}
        <div ref={createRef} className="relative">
          <button
            onClick={() => { setShowCreateMenu(!showCreateMenu); setShowDispatchMenu(false); }}
            className={btnClass}
            style={btnStyle}
          >
            <Plus size={12} /> 创建
          </button>
          {showCreateMenu && (
            <div className="absolute bottom-full left-0 rounded-lg bg-elevated border border-bdr shadow-lg z-20"
                 style={{ marginBottom: 4, width: 160 }}>
              <button onClick={() => { onInsertText?.("/new "); setShowCreateMenu(false); }}
                className="w-full text-left text-xs text-txt hover:bg-hover transition-colors"
                style={{ padding: "8px 12px" }}>
                🤖 新建 Agent
              </button>
              <button onClick={() => { onInsertText?.("/new-group "); setShowCreateMenu(false); }}
                className="w-full text-left text-xs text-txt hover:bg-hover transition-colors"
                style={{ padding: "8px 12px" }}>
                👥 新建群组
              </button>
            </div>
          )}
        </div>

        {/* 摘要 */}
        <button
          onClick={() => onInsertText?.("总结一下当前的托管状态")}
          className={btnClass}
          style={btnStyle}
        >
          <BarChart3 size={12} /> 摘要
        </button>
      </div>
    );
  }

  return null;
}
