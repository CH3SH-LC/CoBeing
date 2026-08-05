import { Send, Plus, BarChart3 } from "lucide-react";
import { useAgentsStore } from "@/stores/agents";
import { useGroupsStore } from "@/stores/groups";
import { getVisibleUserAgents } from "@/lib/coreAgents";
import { getWsClient } from "@/hooks/useWebSocket";
import { useState, useRef, useEffect } from "react";

interface ChatInputActionsProps {
  view: "butler" | "agent" | "group";
  onInsertText?: (text: string) => void;
}

type DispatchTarget = { type: "agent" | "group"; id: string; name: string };

export function ChatInputActions({ view, onInsertText }: ChatInputActionsProps) {
  const [showDispatchMenu, setShowDispatchMenu] = useState(false);
  const [showCreateMenu, setShowCreateMenu] = useState(false);
  const agents = useAgentsStore((s) => s.agents);
  const groups = useGroupsStore((s) => s.groups);
  const dispatchRef = useRef<HTMLDivElement>(null);
  const createRef = useRef<HTMLDivElement>(null);

  /**
   * 读取当前输入框文本。
   * ChatInputActions 渲染在 ChatInput 的输入容器内,与 textarea 同容器,
   * 沿祖级向上查找最近的 textarea 取 value(ChatInput 不在本任务可修改范围)。
   */
  const readInputText = (): string => {
    const el = dispatchRef.current;
    if (!el) return "";
    let parent: HTMLElement | null = el.parentElement;
    while (parent && parent !== document.body) {
      const ta = parent.querySelector("textarea");
      if (ta) return ta.value;
      parent = parent.parentElement;
    }
    return "";
  };

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

  /** 结构化派发:title=输入文本首行或「任务」,goal=输入文本;结果回执由 WS 层插入本地提示消息 */
  const dispatchTask = (target: DispatchTarget) => {
    const inputText = readInputText().trim();
    const title = inputText.split("\n")[0].trim() || "任务";
    const payload =
      target.type === "agent"
        ? { agentId: target.id, targetType: "agent" as const, title, goal: inputText }
        : { groupId: target.id, targetType: "group" as const, title, goal: inputText };
    getWsClient()?.send({ type: "dispatch_task", payload });
    setShowDispatchMenu(false);
  };

  const btnClass = "text-sm text-txt-sub hover:text-txt hover:bg-hover rounded-lg transition-colors flex items-center gap-1.5";
  const btnStyle = { padding: "8px 12px" };

  if (view === "butler") {
    return (
      <div className="flex items-center" style={{ gap: 8 }}>
        {/* 派发 */}
        <div ref={dispatchRef} className="relative">
          <button
            onClick={() => { setShowDispatchMenu(!showDispatchMenu); setShowCreateMenu(false); }}
            className={btnClass}
            style={btnStyle}
          >
            <Send size={14} /> 派发
          </button>
          {showDispatchMenu && (
            <div className="absolute bottom-full left-0 rounded-lg bg-elevated border border-bdr shadow-lg z-20 overflow-y-auto"
                 style={{ marginBottom: 4, width: 200, maxHeight: 160 }}>
              <p className="text-xs text-txt-muted font-medium" style={{ padding: "8px 12px 4px" }}>选择目标</p>
              {visibleAgents.map((a) => (
                <button key={a.id} onClick={() => dispatchTask({ type: "agent", id: a.id, name: a.name })}
                  className="w-full text-left text-sm text-txt hover:bg-hover transition-colors truncate"
                  style={{ padding: "10px 14px" }}>
                  <span>🤖 {a.name}</span>
                </button>
              ))}
              {groups.map((g) => (
                <button key={g.id} onClick={() => dispatchTask({ type: "group", id: g.id, name: g.name })}
                  className="w-full text-left text-sm text-txt hover:bg-hover transition-colors truncate"
                  style={{ padding: "10px 14px" }}>
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
            <Plus size={14} /> 创建
          </button>
          {showCreateMenu && (
            <div className="absolute bottom-full left-0 rounded-lg bg-elevated border border-bdr shadow-lg z-20"
                 style={{ marginBottom: 4, width: 160 }}>
              <button onClick={() => { onInsertText?.("/new "); setShowCreateMenu(false); }}
                className="w-full text-left text-sm text-txt hover:bg-hover transition-colors"
                style={{ padding: "10px 14px" }}>
                🤖 新建 Agent
              </button>
              <button onClick={() => { onInsertText?.("/new-group "); setShowCreateMenu(false); }}
                className="w-full text-left text-sm text-txt hover:bg-hover transition-colors"
                style={{ padding: "10px 14px" }}>
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
          <BarChart3 size={14} /> 摘要
        </button>
      </div>
    );
  }

  return null;
}
