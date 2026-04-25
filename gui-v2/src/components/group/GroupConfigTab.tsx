import { useState } from "react";
import { getWsClient } from "@/hooks/useWebSocket";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { useSettingsStore } from "@/stores/settings";
import type { GroupInfo } from "@/lib/types";

interface GroupConfigTabProps {
  group: GroupInfo;
}

export function GroupConfigTab({ group }: GroupConfigTabProps) {
  const [topic, setTopic] = useState(group.topic ?? "");
  const [destroyOpen, setDestroyOpen] = useState(false);
  const setDetailPanelOpen = useSettingsStore((s) => s.setDetailPanelOpen);

  const handleStartDiscussion = () => {
    getWsClient()?.send({
      type: "send_message",
      payload: {
        agentId: "host",
        content: `启动群组 ${group.name} 的协作${topic ? `，目标：${topic}` : ""}`,
      },
    });
  };

  const handleDestroyGroup = () => {
    getWsClient()?.send({
      type: "destroy_group",
      payload: { groupId: group.id },
    });
    setDestroyOpen(false);
    setDetailPanelOpen(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Topic */}
      <div className="rounded-xl bg-elevated" style={{ padding: 20 }}>
        <label className="text-sm text-txt-sub mb-2 block">协作目标</label>
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="输入协作目标..."
          className="w-full h-9 px-3 rounded-lg bg-input border border-bdr text-sm text-txt placeholder:text-txt-muted focus:outline-none focus:border-accent/50"
        />
      </div>

      {/* Actions */}
      <button
        onClick={handleStartDiscussion}
        className="w-full h-10 rounded-xl text-sm font-medium bg-accent text-white hover:bg-accent/90 transition-colors"
      >
        启动协作
      </button>

      <div className="pt-2">
        <button
          onClick={() => setDestroyOpen(true)}
          className="w-full h-10 rounded-xl text-sm text-danger border border-danger/30 hover:bg-danger/10 transition-colors"
        >
          销毁群组
        </button>
      </div>

      <ConfirmDialog
        open={destroyOpen}
        onOpenChange={setDestroyOpen}
        title="销毁群组"
        description={`确定要销毁群组 "${group.name}" 吗？此操作不可撤销。`}
        confirmLabel="销毁"
        variant="danger"
        onConfirm={handleDestroyGroup}
      />
    </div>
  );
}
