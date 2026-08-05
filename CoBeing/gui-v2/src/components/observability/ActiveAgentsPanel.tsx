import { useEffect } from "react";
import { useWakeQueueStore, type WakeQueueEntry } from "@/stores/wakeQueue";
import { useAgentsStore } from "@/stores/agents";
import { useGroupsStore } from "@/stores/groups";
import { getWsClient } from "@/hooks/useWebSocket";

function resolveAgentName(agentId: string): string {
  return useAgentsStore.getState().agents.find(a => a.id === agentId)?.name || agentId;
}

function resolveGroupName(groupId: string): string {
  return useGroupsStore.getState().groups.find(g => g.id === groupId)?.name || groupId;
}

function ProcessingItem({ agentId, source }: { agentId: string; source?: string }) {
  const handleStop = () => {
    const ws = getWsClient();
    if (ws) ws.send({ type: "stop_agent", payload: { agentId } });
  };
  return (
    <div className="flex items-center rounded-lg bg-accent/8 border border-accent/25" style={{ padding: "14px 20px", gap: 10 }}>
      <span className="inline-block w-3.5 h-3.5 border-2 border-accent border-t-transparent rounded-full animate-spin shrink-0" />
      <span className="flex-1 text-sm text-txt min-w-0 truncate">
        <strong>{resolveAgentName(agentId)}</strong>
        <span className="text-accent ml-1.5 font-medium text-xs">执行中</span>
        {source && <span className="text-txt-muted text-xs ml-1.5">{source}</span>}
      </span>
      <button
        className="rounded-lg bg-danger/15 text-danger text-sm font-medium transition-colors hover:bg-danger/25 shrink-0"
        style={{ padding: "6px 12px" }}
        onClick={handleStop}
      >
        停止
      </button>
    </div>
  );
}

function QueuedItem({ entry }: { entry: WakeQueueEntry }) {
  const name = resolveAgentName(entry.targetAgentId);
  return (
    <div className="flex items-center rounded-lg bg-elevated/60 border border-bdr/25" style={{ padding: "14px 20px", gap: 10 }}>
      <span className="shrink-0 text-sm">⏳</span>
      <span className="flex-1 text-sm text-txt-sub min-w-0 truncate">
        <strong className="text-txt">{name}</strong>
        <span className="ml-1.5 text-xs">等待唤醒</span>
        <span className="text-txt-muted text-xs ml-1">{entry.triggerTag}</span>
      </span>
    </div>
  );
}

function TruncatedText({ text, maxLen = 120 }: { text: string; maxLen?: number }) {
  const needsTruncation = text.length > maxLen;
  if (!needsTruncation) return <span className="break-all">{text}</span>;
  return (
    <details className="inline cursor-pointer">
      <summary className="list-none text-txt-sub hover:text-txt transition-colors">
        {text.slice(0, maxLen)}...
        <span className="text-accent text-xs ml-1 font-medium">展开</span>
      </summary>
      <span className="break-all">{text}</span>
    </details>
  );
}

export function ActiveAgentsPanel() {
  const { queues, activeAgents } = useWakeQueueStore();

  useEffect(() => {
    const fetch = () => {
      const ws = getWsClient();
      if (ws) ws.send({ type: "get_wake_queue" });
    };
    fetch();
    const interval = setInterval(fetch, 3000);
    return () => clearInterval(interval);
  }, []);

  const groupIds = Object.keys(queues);
  const totalQueued = groupIds.reduce((sum, gid) => sum + queues[gid].queue.length, 0);

  // 活跃 agents 分为两类：有 groupId（群组触发）和 无 groupId（独立对话/TODO触发）
  const groupActive = activeAgents.filter(a => a.groupId);
  const independentActive = activeAgents.filter(a => !a.groupId);

  const hasAny = totalQueued > 0 || groupActive.length > 0 || independentActive.length > 0;

  return (
    <div className="flex flex-col rounded-xl bg-surface border border-bdr/40" style={{ padding: 20, boxShadow: "var(--shadow-surface)", minHeight: 200 }}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-txt">活跃 Agent</h3>
        <span className="text-xs text-txt-muted">
          {hasAny
            ? `队列 ${totalQueued} · 执行中 ${groupActive.length + independentActive.length}`
            : "空闲"}
        </span>
      </div>

      {!hasAny ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center" style={{ gap: 8 }}>
          <div className="text-3xl">💤</div>
          <p className="text-sm text-txt-muted">所有 Agent 空闲，等待任务唤醒</p>
        </div>
      ) : (
        <div className="flex flex-col overflow-y-auto" style={{ gap: 10, maxHeight: 300 }}>
          {/* 群组活跃 Agent（从 activeAgents 中携带 groupId 的） */}
          {groupActive.map((a) => {
            const source = a.groupId ? `群组 ${resolveGroupName(a.groupId)}` : "群组任务";
            return <ProcessingItem key={a.agentId} agentId={a.agentId} source={source} />;
          })}
          {/* 独立活跃 Agent（直接对话/TODO触发） */}
          {independentActive.map((a) => (
            <ProcessingItem key={a.agentId} agentId={a.agentId} source="独立任务" />
          ))}
          {/* 群组唤醒队列（排队中的） */}
          {groupIds.map((gid) => {
            const gq = queues[gid];
            return (
              <div key={gid} className="flex flex-col" style={{ gap: 4 }}>
                {gq.queue.map((entry, idx) => (
                  <QueuedItem key={`${entry.targetAgentId}-${idx}`} entry={entry} />
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export { TruncatedText };
