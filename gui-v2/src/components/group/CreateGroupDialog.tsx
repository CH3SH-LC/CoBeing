import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { useAgentsStore } from "@/stores/agents";
import { getWsClient } from "@/hooks/useWebSocket";
import { cn } from "@/lib/utils";

interface CreateGroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateGroupDialog({ open, onOpenChange }: CreateGroupDialogProps) {
  const agents = useAgentsStore((s) => s.agents);
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);

  const canCreate = name.trim() && selectedMembers.length > 0;

  const toggleMember = (id: string) => {
    setSelectedMembers((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleCreate = () => {
    if (!canCreate) return;

    getWsClient()?.send({
      type: "create_group",
      payload: {
        name: name.trim(),
        members: selectedMembers,
        topic: topic.trim() || undefined,
      },
    });

    setName("");
    setTopic("");
    setSelectedMembers([]);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>创建协作组</DialogTitle>
          <DialogDescription>选择成员组成协作组</DialogDescription>
        </DialogHeader>

        <div style={{ display: "flex", flexDirection: "column", gap: 20, marginTop: 8 }}>
          {/* Name */}
          <div>
            <label className="text-sm text-txt-sub mb-1 block">群组名称 *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：前端开发组"
              className="w-full h-9 px-3 rounded-lg bg-input border border-bdr text-sm text-txt placeholder:text-txt-muted focus:outline-none focus:border-accent/50"
            />
          </div>

          {/* Topic */}
          <div>
            <label className="text-sm text-txt-sub mb-1 block">协作目标 (可选)</label>
            <input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="例如：完成首页重构"
              className="w-full h-9 px-3 rounded-lg bg-input border border-bdr text-sm text-txt placeholder:text-txt-muted focus:outline-none focus:border-accent/50"
            />
          </div>

          {/* Member selection */}
          <div>
            <label className="text-sm text-txt-sub mb-2 block">选择成员 *</label>
            {agents.length === 0 ? (
              <p className="text-xs text-txt-muted text-center py-4">暂无 Agent，请先创建</p>
            ) : (
              <div className="max-h-[200px] overflow-y-auto" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {agents.filter(a => a.id !== "butler" && a.id !== "host").map((agent) => {
                  const selected = selectedMembers.includes(agent.id);
                  return (
                    <button
                      key={agent.id}
                      onClick={() => toggleMember(agent.id)}
                      className={cn(
                        "w-full flex items-center gap-3 rounded-lg transition-colors text-left",
                        selected
                          ? "bg-accent/10"
                          : "hover:bg-hover"
                      )}
                      style={{ padding: "12px 16px" }}
                    >
                      <span className={cn("text-sm", selected ? "text-accent" : "text-txt-muted")}>
                        {selected ? "\u25CF" : "\u25CB"}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-txt font-medium">{agent.name}</div>
                        <div className="text-sm text-txt-muted">{agent.provider}/{agent.model}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Selected preview */}
          {selectedMembers.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap">
              <span className="text-sm text-txt-sub">已选:</span>
              {selectedMembers.map((id) => {
                const agent = agents.find((a) => a.id === id);
                return (
                  <span key={id} className="text-sm text-accent">
                    {agent?.name ?? id}
                  </span>
                );
              })}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={() => onOpenChange(false)}
              className="h-10 px-4 rounded-lg text-sm text-txt-sub bg-hover hover:bg-elevated transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleCreate}
              disabled={!canCreate}
              className="h-10 px-4 rounded-lg text-sm font-medium bg-accent text-white hover:bg-accent/90 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              创建
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
