import { useEffect } from "react";
import { useWakeQueueStore, type WakeQueueEntry } from "@/stores/wakeQueue";
import { useAgentsStore } from "@/stores/agents";
import { getWsClient } from "@/hooks/useWebSocket";

function resolveAgentName(agentId: string): string {
  const agents = useAgentsStore.getState().agents;
  return agents.find(a => a.id === agentId)?.name || agentId;
}

function QueueEntryView({ entry }: { entry: WakeQueueEntry }) {
  const agentName = resolveAgentName(entry.targetAgentId);
  const triggerCount = entry.triggerContents.length;

  return (
    <div className="flex items-center rounded-lg bg-elevated/50 border border-bdr/30" style={{ padding: "14px 20px", gap: 12 }}>
      <span className="text-base shrink-0 w-6 text-center">⏳</span>
      <span className="flex-1 text-sm">
        <strong className="font-semibold text-txt">{agentName}</strong>
        <span className="text-txt-muted"> 正在排队</span>
        {triggerCount > 1 && (
          <span className="text-xs text-txt-muted ml-2">（{triggerCount} 条触发消息合并）</span>
        )}
      </span>
      <span className="text-xs text-txt-muted shrink-0 font-mono">{entry.triggerTag}</span>
    </div>
  );
}

function ProcessingView({ agentId }: { agentId: string }) {
  const agentName = resolveAgentName(agentId);

  return (
    <div className="flex items-center rounded-lg bg-accent/5 border border-accent/30" style={{ padding: "14px 20px", gap: 12 }}>
      <span className="text-base shrink-0 w-6 text-center inline-flex items-center justify-center">
        <span className="inline-block w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </span>
      <span className="flex-1 text-sm">
        <strong className="font-semibold text-txt">{agentName}</strong>
        <span className="text-accent ml-2 font-medium">正在回答…</span>
      </span>
    </div>
  );
}

export function WakeQueueSection() {
  const queues = useWakeQueueStore((s) => s.queues);

  // 轮询更新
  useEffect(() => {
    const fetch = () => {
      const ws = getWsClient();
      if (ws) ws.send({ type: "get_wake_queue" });
    };
    fetch();
    const interval = setInterval(fetch, 3000);
    return () => clearInterval(interval);
  }, []);

  // 无数据兜底：连接就绪后立即拉取一次（getWsClient 在 useWebSocket 连接前为 null）
  useEffect(() => {
    const t = setTimeout(() => {
      const ws = getWsClient();
      if (ws && Object.keys(useWakeQueueStore.getState().queues).length === 0) {
        ws.send({ type: "get_wake_queue" });
      }
    }, 1500);
    return () => clearTimeout(t);
  }, []);

  const groupIds = Object.keys(queues);
  const totalQueued = groupIds.reduce((sum, gid) => sum + queues[gid].queue.length, 0);
  const totalProcessing = groupIds.reduce((sum, gid) => sum + (queues[gid].processing ? 1 : 0), 0);
  const isEmpty = groupIds.length === 0 || (totalQueued === 0 && totalProcessing === 0);

  return (
    <div className="flex flex-col">
      {/* 头部 */}
      <div className="flex items-center justify-between" style={{ marginBottom: 16 }}>
        <div>
          <h2 className="text-lg font-semibold text-txt">唤醒队列</h2>
          <p className="text-sm text-txt-muted">
            {isEmpty
              ? "当前没有等待唤醒或正在回答的智能体"
              : totalProcessing > 0 && totalQueued > 0
                ? `${totalProcessing} 个正在回答，${totalQueued} 个等待唤醒`
                : totalProcessing > 0
                  ? `${totalProcessing} 个智能体正在回答`
                  : `${totalQueued} 个智能体正在等待唤醒`}
          </p>
        </div>
      </div>

      {/* 队列列表 */}
      <div
        className="overflow-y-auto rounded-xl bg-elevated border border-bdr/40"
        style={{ padding: 20, boxShadow: "var(--shadow-surface)", maxHeight: 480, minHeight: 120 }}
      >
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center text-center h-full" style={{ gap: 8 }}>
            <div className="text-3xl">💤</div>
            <p className="text-sm text-txt-muted">当前没有等待唤醒或正在回答的智能体</p>
          </div>
        ) : (
          <div className="flex flex-col" style={{ gap: 16 }}>
            {groupIds.map((gid) => {
              const groupQueue = queues[gid];
              const hasItems = groupQueue.queue.length > 0 || groupQueue.processing;
              if (!hasItems) return null;
              return (
                <div key={gid} className="flex flex-col" style={{ gap: 6 }}>
                  <div className="flex items-center" style={{ gap: 8 }}>
                    <span className="text-sm font-medium text-accent">👥 {groupQueue.groupName}</span>
                    <span className="text-xs text-txt-muted">
                      {groupQueue.queue.length > 0 ? `${groupQueue.queue.length} 排队` : ""}
                      {groupQueue.queue.length > 0 && groupQueue.processing ? " · " : ""}
                      {groupQueue.processing ? "1 回答中" : ""}
                    </span>
                  </div>
                  <div className="flex flex-col" style={{ gap: 4 }}>
                    {groupQueue.processing && (
                      <ProcessingView agentId={groupQueue.processing} />
                    )}
                    {groupQueue.queue.map((entry, idx) => (
                      <QueueEntryView key={`${entry.targetAgentId}-${idx}`} entry={entry} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
