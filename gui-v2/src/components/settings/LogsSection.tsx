import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useActivityStore, type ActivityEntry, type ToolCallGroup, type FileChangeEntry, type TodoChangeEntry } from "@/stores/activity";
import { useAgentsStore } from "@/stores/agents";

type FilterType = "all" | "message" | "tool" | "file" | "todo" | "system";
type UnifiedEntry = {
  type: "activity" | "tool_group" | "file_change" | "todo_change";
  timestamp: number;
  data: ActivityEntry | ToolCallGroup | FileChangeEntry | TodoChangeEntry;
};

/** 相对时间 */
function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 10_000) return "刚刚";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}秒前`;
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}分钟前`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}小时前`;
  return new Date(ts).toLocaleDateString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** 渲染活动文本 — 使用结构化字段精确加粗/斜体 */
function renderActivityText(entry: ActivityEntry): React.ReactNode {
  const { text, agentName, groupName, fileName, mentionTargets } = entry;
  // 如果没有结构化字段，降级到纯文本
  if (!agentName && !groupName && !fileName && (!mentionTargets || mentionTargets.length === 0)) {
    return renderHighlightedText(text);
  }
  // 用结构化字段做文本替换
  let result: React.ReactNode[] = [text];
  const replaceInNodes = (search: string, replacement: React.ReactNode) => {
    const next: React.ReactNode[] = [];
    for (const node of result) {
      if (typeof node !== "string") { next.push(node); continue; }
      const idx = node.indexOf(search);
      if (idx === -1) { next.push(node); continue; }
      if (idx > 0) next.push(node.slice(0, idx));
      next.push(replacement);
      if (idx + search.length < node.length) next.push(node.slice(idx + search.length));
    }
    result = next;
  };
  if (agentName) replaceInNodes(agentName, <strong key="an" className="font-semibold text-txt">{agentName}</strong>);
  if (groupName) replaceInNodes(groupName, <strong key="gn" className="font-semibold text-accent">{groupName}</strong>);
  if (fileName) replaceInNodes(fileName, <em key="fn" className="italic text-purple">{fileName}</em>);
  if (mentionTargets) {
    for (const m of mentionTargets) {
      replaceInNodes(`@${m}`, <strong key={`mt-${m}`} className="font-semibold text-warning">@{m}</strong>);
    }
  }
  return result;
}

/** 降级渲染 — 匹配引号内容和 @mention */
function renderHighlightedText(text: string): React.ReactNode {
  const parts = text.split(/("[^"]*"|@[\w-]+)/g);
  return parts.map((part, i) => {
    if (!part) return null;
    if (part.startsWith('"') && part.endsWith('"')) {
      return <strong key={i} className="font-semibold text-txt">{part}</strong>;
    }
    if (part.startsWith("@")) {
      return <strong key={i} className="font-semibold text-warning">{part}</strong>;
    }
    return part;
  });
}

/** 工具调用组组件 */
function ToolGroupView({ group }: { group: ToolCallGroup }) {
  const [expanded, setExpanded] = useState(false);
  const callCount = group.calls.length;
  const uniqueTools = [...new Set(group.calls.map(c => c.toolName))];
  const agentName = useAgentsStore((s) => s.agents.find(a => a.id === group.agentId)?.name || group.agentId);

  return (
    <div className="rounded-lg bg-elevated/50 border border-bdr/30 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center hover:bg-hover transition-colors"
        style={{ padding: "10px 14px", gap: 12 }}
      >
        <span className="text-base shrink-0 w-6 text-center">🔧</span>
        <span className="flex-1 text-sm text-left">
          <strong className="font-semibold text-txt">{agentName}</strong>
          <span className="text-txt-muted"> 执行了 </span>
          <strong className="font-semibold text-accent">{uniqueTools.join(", ")}</strong>
          <span className="text-txt-muted"> ({callCount} 次调用)</span>
        </span>
        <span className="text-xs text-txt-muted shrink-0 font-mono">{relativeTime(group.startTime)}</span>
        <svg
          className={`w-4 h-4 shrink-0 text-txt-muted transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {expanded && (
        <div className="border-t border-bdr/30" style={{ padding: "8px 14px 8px 52px" }}>
          <div className="flex flex-col" style={{ gap: 4 }}>
            {group.calls.map((call) => (
              <div key={call.id} className="flex items-center text-sm" style={{ gap: 8 }}>
                <span className={call.status === "complete" ? "text-success" : "text-txt-muted"}>
                  {call.status === "complete" ? "✓" : "…"}
                </span>
                <span className="text-txt font-mono text-xs">{call.toolName}</span>
                {call.params && (
                  <span className="text-txt-muted text-xs truncate" style={{ maxWidth: 300 }}>
                    {JSON.stringify(call.params).slice(0, 80)}
                  </span>
                )}
                {call.result && (
                  <span className="text-txt-muted text-xs truncate" style={{ maxWidth: 200 }}>
                    → {call.result.slice(0, 60)}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** 文件变更组件 */
function FileChangeView({ change }: { change: FileChangeEntry }) {
  const actionMap = { created: "创建", modified: "修改", deleted: "删除" };
  const actionIcon = { created: "📄", modified: "✏️", deleted: "🗑️" };
  const actionColor = { created: "text-success", modified: "text-accent", deleted: "text-danger" };
  const agentName = useAgentsStore((s) => s.agents.find(a => a.id === change.agentId)?.name || change.agentId);

  return (
    <div className="flex items-center rounded-lg hover:bg-hover transition-colors" style={{ padding: "10px 14px", gap: 12 }}>
      <span className="text-base shrink-0 w-6 text-center">{actionIcon[change.action]}</span>
      <span className="flex-1 text-sm">
        <strong className="font-semibold text-txt">{agentName}</strong>
        <span className={`mx-1 ${actionColor[change.action]}`}>{actionMap[change.action]}</span>
        <em className="italic text-purple">{change.filename}</em>
      </span>
      <span className="text-xs text-txt-muted shrink-0 font-mono">{relativeTime(change.timestamp)}</span>
    </div>
  );
}

/** TODO 变更组件 */
function TodoChangeView({ change }: { change: TodoChangeEntry }) {
  const actionMap = { added: "添加", completed: "完成", removed: "移除" };
  const actionIcon = { added: "📝", completed: "✅", removed: "🗑️" };
  const actionColor = { added: "text-accent", completed: "text-success", removed: "text-danger" };

  return (
    <div className="flex items-center rounded-lg hover:bg-hover transition-colors" style={{ padding: "10px 14px", gap: 12 }}>
      <span className="text-base shrink-0 w-6 text-center">{actionIcon[change.action]}</span>
      <span className="flex-1 text-sm">
        <span className={actionColor[change.action]}>{actionMap[change.action]} TODO</span>
        <strong className="font-semibold text-txt mx-1">"{change.title}"</strong>
        {change.agentId && (
          <span className="text-txt-muted"> — {change.agentId}</span>
        )}
      </span>
      <span className="text-xs text-txt-muted shrink-0 font-mono">{relativeTime(change.timestamp)}</span>
    </div>
  );
}

/** 普通活动组件 */
function ActivityEntryView({ entry }: { entry: ActivityEntry }) {
  return (
    <div
      className={`flex items-center rounded-lg transition-colors hover:bg-hover ${
        entry.level === "error" ? "bg-danger/5" : ""
      }`}
      style={{ padding: "10px 14px", gap: 12 }}
    >
      <span className="text-base shrink-0 w-6 text-center">{entry.icon}</span>
      <span className={`flex-1 text-sm ${entry.level === "error" ? "text-danger" : "text-txt"}`}>
        {renderActivityText(entry)}
      </span>
      <span className="text-xs text-txt-muted shrink-0 font-mono">{relativeTime(entry.timestamp)}</span>
    </div>
  );
}

export function LogsSection() {
  const entries = useActivityStore((s) => s.entries);
  const toolGroups = useActivityStore((s) => s.toolGroups);
  const fileChanges = useActivityStore((s) => s.fileChanges);
  const todoChanges = useActivityStore((s) => s.todoChanges);
  const clearAll = useActivityStore((s) => s.clear);
  const [filter, setFilter] = useState<FilterType>("all");
  const [autoScroll, setAutoScroll] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 合并所有条目并按时间排序
  const unified = useMemo(() => {
    const items: UnifiedEntry[] = [];

    for (const e of entries) {
      items.push({ type: "activity", timestamp: e.timestamp, data: e });
    }
    for (const g of toolGroups) {
      items.push({ type: "tool_group", timestamp: g.startTime, data: g });
    }
    for (const f of fileChanges) {
      items.push({ type: "file_change", timestamp: f.timestamp, data: f });
    }
    for (const t of todoChanges) {
      items.push({ type: "todo_change", timestamp: t.timestamp, data: t });
    }

    items.sort((a, b) => a.timestamp - b.timestamp);
    return items;
  }, [entries, toolGroups, fileChanges, todoChanges]);

  // 过滤
  const filtered = useMemo(() => {
    if (filter === "all") return unified;
    return unified.filter((item) => {
      if (item.type === "tool_group") return filter === "tool";
      if (item.type === "file_change") return filter === "file";
      if (item.type === "todo_change") return filter === "todo";
      return (item.data as ActivityEntry).category === filter;
    });
  }, [unified, filter]);

  // 自动滚动
  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [filtered.length, autoScroll]);

  // 检测手动滚动
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    setAutoScroll(atBottom);
  }, []);

  const filters: { key: FilterType; label: string; icon: string }[] = [
    { key: "all", label: "全部", icon: "📋" },
    { key: "message", label: "消息", icon: "💬" },
    { key: "tool", label: "工具", icon: "🔧" },
    { key: "file", label: "文件", icon: "📁" },
    { key: "todo", label: "TODO", icon: "📝" },
    { key: "system", label: "系统", icon: "⚙️" },
  ];

  return (
    <div className="flex flex-col h-[calc(100vh-200px)]">
      {/* 头部 */}
      <div className="flex items-center justify-between" style={{ marginBottom: 16 }}>
        <div>
          <h2 className="text-lg font-semibold text-txt">活动日志</h2>
          <p className="text-sm text-txt-muted">{filtered.length} 条记录</p>
        </div>
        <div className="flex items-center" style={{ gap: 8 }}>
          {filters.map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                filter === f.key
                  ? "bg-accent/10 text-accent font-medium"
                  : "text-txt-muted hover:text-txt hover:bg-hover"
              }`}
            >
              <span className="mr-1">{f.icon}</span>{f.label}
            </button>
          ))}
          <button
            onClick={clearAll}
            className="ml-2 px-3 py-1.5 rounded-lg text-sm text-txt-muted hover:text-danger transition-colors"
          >
            清空
          </button>
        </div>
      </div>

      {/* 活动列表 */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto rounded-xl bg-elevated border border-bdr/40"
        style={{ padding: 16, boxShadow: "var(--shadow-surface)" }}
      >
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-txt-muted">暂无活动</p>
          </div>
        ) : (
          <div className="flex flex-col" style={{ gap: 2 }}>
            {filtered.map((item) => {
              switch (item.type) {
                case "tool_group":
                  return <ToolGroupView key={item.data.id} group={item.data as ToolCallGroup} />;
                case "file_change":
                  return <FileChangeView key={item.data.id} change={item.data as FileChangeEntry} />;
                case "todo_change":
                  return <TodoChangeView key={item.data.id} change={item.data as TodoChangeEntry} />;
                default:
                  return <ActivityEntryView key={item.data.id} entry={item.data as ActivityEntry} />;
              }
            })}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* 跳到底部按钮 */}
      {!autoScroll && (
        <div className="flex justify-center" style={{ marginTop: 12 }}>
          <button
            onClick={() => {
              setAutoScroll(true);
              bottomRef.current?.scrollIntoView({ behavior: "smooth" });
            }}
            className="px-4 py-2 rounded-xl text-sm bg-accent text-white hover:bg-accent/90 transition-colors"
          >
            跳到底部
          </button>
        </div>
      )}
    </div>
  );
}
