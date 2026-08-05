import { useState, useEffect } from "react";
import type { SkillInfo } from "@/lib/types";
import { useChatStore } from "@/stores/chat";
import { useAgentsStore } from "@/stores/agents";
import { useGroupsStore } from "@/stores/groups";
import { useSettingsStore } from "@/stores/settings";
import { getWsClient } from "@/hooks/useWebSocket";
import { ChatInputActions } from "./ChatInputActions";

const SLASH_COMMANDS = [
  { cmd: "/new", label: "新建对话", desc: "开始一个新的对话会话" },
  { cmd: "/clear", label: "清空上下文", desc: "清除当前对话的上下文记忆" },
  { cmd: "/bind", label: "绑定工作目录", desc: "绑定当前 Agent 到外部项目文件夹" },
  { cmd: "/unbind", label: "解绑工作目录", desc: "恢复默认工作区" },
  { cmd: "/skills", label: "查看技能列表", desc: "列出当前可用的技能" },
] as const;

export function ChatInput({ disabled, targetConvId }: { disabled: boolean; targetConvId?: string | null }) {
  const [text, setText] = useState("");
  const [showSkillMenu, setShowSkillMenu] = useState(false);
  const [showMentionMenu, setShowMentionMenu] = useState(false);
  const [slashIdx, setSlashIdx] = useState(-1);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const activeConv = useChatStore((s) => s.activeConversation);
  const waitingForResponse = useChatStore((s) => s.waitingForResponse);
  const startWaiting = useChatStore((s) => s.startWaiting);
  const addMessage = useChatStore((s) => s.addMessage);
  const agents = useAgentsStore((s) => s.agents);
  const groups = useGroupsStore((s) => s.groups);
  const activeView = useSettingsStore((s) => s.activeView);
  const [skills, setSkills] = useState<SkillInfo[]>([]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.payload?.skills) setSkills(detail.payload.skills);
    };
    window.addEventListener("ws-skill-list", handler);
    getWsClient()?.send({ type: "get_skills", payload: {} });
    return () => window.removeEventListener("ws-skill-list", handler);
  }, []);
  const convId = targetConvId || activeConv;
  const isGroupChat = !!groups.find((g) => g.id === convId);

  const canSend = !disabled && !waitingForResponse;

  const handleSend = () => {
    const content = text.trim();
    if (!content || !convId || disabled || waitingForResponse) return;
    // Defocus before state changes to prevent WebView2 auto-scroll on value change
    const activeEl = document.activeElement as HTMLElement | null;
    activeEl?.blur();
    addMessage({ direction: "in", content, timestamp: Date.now(), status: "sending" }, convId);
    startWaiting(convId);
    setText("");
    getWsClient()?.send({ type: "send_message", payload: { agentId: convId, content } });
    // Refocus for next message
    requestAnimationFrame(() => activeEl?.focus());
  };

  const handleSlashSelect = (cmd: string) => {
    setText(cmd + " ");
    setShowSlashMenu(false);
    setSlashIdx(-1);
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    setText(v);
    // 检测斜杠命令：第一个字符为 /
    if (v.length === 1 && v[0] === "/") {
      setShowSlashMenu(true);
      setSlashIdx(0);
    } else if (!v.startsWith("/")) {
      setShowSlashMenu(false);
      setSlashIdx(-1);
    } else if (v.startsWith("/")) {
      // 保持菜单开启，匹配过滤
      setShowSlashMenu(true);
    }
  };

  const filteredCmds = SLASH_COMMANDS.filter((c) =>
    text.startsWith("/") ? c.cmd.startsWith(text.split(" ")[0]) : true
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showSlashMenu) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSlashIdx((i) => Math.min(i + 1, filteredCmds.length - 1)); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setSlashIdx((i) => Math.max(i - 1, 0)); return; }
      if (e.key === "Tab" || e.key === "Enter") {
        e.preventDefault();
        if (filteredCmds[slashIdx]) handleSlashSelect(filteredCmds[slashIdx].cmd);
        return;
      }
      if (e.key === "Escape") { setShowSlashMenu(false); setSlashIdx(-1); return; }
    }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
    if (e.key === "Escape") { setShowSkillMenu(false); setShowMentionMenu(false); setShowSlashMenu(false); }
  };

  const insertSkill = (skillName: string) => { setText((t) => t + `{{skill:${skillName}}} `); setShowSkillMenu(false); };
  const insertMention = (agentId: string) => { setText((t) => t.replace(/@$/, "") + `@${agentId} `); setShowMentionMenu(false); };

  return (
    <div className="relative">
        {/* overflow-visible: 技能/@提及弹窗 absolute bottom-full 需要向上弹出不被裁剪（背景与圆角由 border-radius 自身裁切） */}
        <div className="flex min-h-[132px] flex-col rounded-xl bg-input border border-bdr/30 overflow-visible" style={{ padding: 20 }}>
        <textarea
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="输入消息...（输入 / 打开命令菜单）"
          disabled={disabled}
          rows={4}
          className="resize-none rounded-lg bg-input border-none text-sm text-txt placeholder:text-txt-muted focus:outline-none transition-colors disabled:opacity-50"
          style={{ padding: "12px 16px", minHeight: 80, maxHeight: 160, overflowY: "auto" }}
        />
        <div className="flex items-center justify-between" style={{ marginTop: 12 }}>
          <div className="flex items-center" style={{ gap: 12 }}>
            {activeView === "butler" && (
              <ChatInputActions view="butler" onInsertText={(t) => setText((prev) => prev + t)} />
            )}
            <div className="relative">
              <button
                onClick={() => { setShowSkillMenu(!showSkillMenu); setShowMentionMenu(false); }}
                disabled={disabled || skills.length === 0}
                className="text-sm text-txt-sub hover:text-accent transition-colors disabled:opacity-30 rounded-lg hover:bg-hover"
                style={{ padding: "8px 12px" }}
              >
                {"\u26A1"} 技能
              </button>
              {showSkillMenu && skills.length > 0 && (
                <div className="absolute bottom-full left-0 rounded-lg bg-elevated border border-bdr shadow-lg z-50 overflow-y-auto"
                     style={{ marginBottom: 8, width: 200, maxHeight: 160 }}>
                  {skills.map((s) => (
                    <button key={s.name} onClick={() => insertSkill(s.name)}
                      className="w-full text-left text-sm text-txt hover:bg-hover transition-colors truncate"
                      style={{ padding: "10px 14px" }}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {isGroupChat && (
              <div className="relative">
                <button
                  onClick={() => { setShowMentionMenu(!showMentionMenu); setShowSkillMenu(false); }}
                  disabled={disabled}
                  className="text-sm text-txt-sub hover:text-purple transition-colors disabled:opacity-30 rounded-lg hover:bg-hover"
                  style={{ padding: "8px 12px" }}
                >
                  @ 提及
                </button>
                {showMentionMenu && (
                  <div className="absolute bottom-full left-0 rounded-lg bg-elevated border border-bdr shadow-lg z-50 overflow-y-auto"
                       style={{ marginBottom: 8, width: 200, maxHeight: 160 }}>
                    {agents.filter((a) => a.id !== "butler").map((a) => (
                      <button key={a.id} onClick={() => insertMention(a.id)}
                        className="w-full text-left text-sm text-txt hover:bg-hover transition-colors truncate"
                        style={{ padding: "10px 14px" }}
                      >
                        {a.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <span className="text-xs text-txt-muted">Enter 发送 · Shift+Enter 换行</span>
          </div>
          <button
            onClick={handleSend}
            disabled={!canSend || !text.trim()}
            className="rounded-lg text-sm font-medium transition-colors shrink-0 disabled:opacity-30 disabled:cursor-not-allowed bg-accent text-white hover:bg-accent/90"
            style={{ padding: "10px 24px" }}
          >
            发送
          </button>
        </div>
        </div>
        {/* 斜杠命令菜单 — 在外层 relative 容器中，不受 overflow-hidden 裁剪 */}
        {showSlashMenu && !isGroupChat && filteredCmds.length > 0 && (
          <div className="absolute rounded-lg bg-elevated border border-bdr shadow-lg z-50 overflow-hidden"
               style={{ bottom: "100%", left: 20, marginBottom: 4, width: 260 }}>
            {filteredCmds.map((c, i) => (
              <button key={c.cmd}
                onClick={() => handleSlashSelect(c.cmd)}
                onMouseEnter={() => setSlashIdx(i)}
                className={`w-full text-left transition-colors ${i === slashIdx ? "bg-accent/10" : "hover:bg-hover"}`}
                style={{ padding: "10px 14px" }}
              >
                <div className="text-sm font-medium text-txt">{c.cmd}</div>
                <div className="text-xs text-txt-muted mt-0.5">{c.desc}</div>
              </button>
            ))}
          </div>
        )}
    </div>
  );
}
