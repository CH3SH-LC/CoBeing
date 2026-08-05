import { useState, useMemo } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/button";
import type { GroupInfo } from "@/lib/types";
import { useAgentsStore } from "@/stores/agents";
import { getWsClient } from "@/hooks/useWebSocket";
import { useConfigStore } from "@/stores/config";
import { usePluginsStore } from "@/stores/plugins";
import { getVisibleUserAgents } from "@/lib/coreAgents";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";

interface GroupMembersTabProps {
  group: GroupInfo;
}

export function GroupMembersTab({ group }: GroupMembersTabProps) {
  const agents = useAgentsStore((s) => s.agents);
  const configProviders = useConfigStore((s) => s.providers);
  const pluginProviders = usePluginsStore((s) => s.providers);
  const getModels = usePluginsStore((s) => s.getModels);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [editMember, setEditMember] = useState<{ agentId: string; provider: string; model: string } | null>(null);
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);

  const hostId = group.members[0];
  const nonMemberAgents = getVisibleUserAgents(agents).filter(
    (a) => !group.members.includes(a.id)
  );

  const handleRemove = (agentId: string) => {
    if (agentId === hostId) return;
    getWsClient()?.send({
      type: "remove_group_member",
      payload: { groupId: group.id, agentId },
    });
  };

  const handleConfirmRemove = () => {
    if (removeTarget) handleRemove(removeTarget);
    setRemoveTarget(null);
  };

  const handleAdd = (agentId: string) => {
    getWsClient()?.send({
      type: "add_group_member",
      payload: { groupId: group.id, agentId },
    });
    setShowAddMenu(false);
  };

  const handleEditModel = (agentId: string, currentProvider: string, currentModel: string) => {
    setEditMember({ agentId, provider: currentProvider, model: currentModel });
  };

  const handleSaveModel = () => {
    if (!editMember) return;
    getWsClient()?.send({
      type: "update_agent",
      payload: {
        agentId: editMember.agentId,
        config: { provider: editMember.provider, model: editMember.model },
      },
    });
    setEditMember(null);
  };

  const allProviders = useMemo(() => {
    const pluginIds = pluginProviders.map(p => p.id);
    const configIds = Object.keys(configProviders);
    const merged = new Set([...pluginIds, ...configIds]);
    return [...merged].sort();
  }, [pluginProviders, configProviders]);
  const editModels = editMember ? (getModels(editMember.provider) || []) : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {group.members.map((memberId) => {
          const agent = agents.find((a) => a.id === memberId);
          const isHost = memberId === hostId;
          return (
            <div
              key={memberId}
              className="flex items-center gap-3 rounded-xl bg-elevated border border-bdr/30"
              style={{ padding: "14px 20px" }}
            >
              <div className="w-9 h-9 rounded-lg bg-surface-solid border border-bdr/30 flex items-center justify-center text-sm text-txt">
                {agent?.name?.[0] ?? "?"}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-txt">{agent?.name ?? memberId}</div>
                <button
                  type="button"
                  className="text-sm text-txt-muted hover:text-accent transition-colors cursor-pointer"
                  onClick={() => agent && handleEditModel(agent.id, agent.provider, agent.model)}
                  title="点击切换模型"
                  style={{ background: "none", border: "none", padding: 0, textAlign: "left" }}
                >
                  {agent?.provider}/{agent?.model} ✎
                </button>
              </div>
              {isHost ? (
                <span className="text-sm px-2 py-0.5 rounded-full bg-accent/10 text-accent">
                  主持人
                </span>
              ) : (
                <button
                  onClick={() => setRemoveTarget(memberId)}
                  className="text-sm text-danger/70 hover:text-danger transition-colors rounded-lg hover:bg-danger/10" style={{ padding: "6px 10px" }}
                >
                  移除
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* 添加成员 */}
      <div className="relative" style={{ paddingTop: 4 }}>
        <button
          onClick={() => setShowAddMenu(!showAddMenu)}
          className="w-full h-11 rounded-xl border border-dashed border-bdr text-sm text-txt-muted hover:text-txt hover:border-accent/30 transition-colors"
        >
          + 添加成员
        </button>

        {showAddMenu && nonMemberAgents.length > 0 && (
          <div className="absolute z-10 left-0 right-0 mt-2 rounded-xl bg-elevated border border-bdr/40 max-h-56 overflow-y-auto" style={{ boxShadow: "var(--shadow-surface)" }}>
            {nonMemberAgents.map((agent) => (
              <button
                key={agent.id}
                onClick={() => handleAdd(agent.id)}
                className="w-full flex items-center gap-3 hover:bg-hover transition-colors text-left"
                style={{ padding: "12px 20px" }}
              >
                <div className="w-7 h-7 rounded-lg bg-surface-solid flex items-center justify-center text-sm text-txt">
                  {agent.name[0]}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-txt">{agent.name}</div>
                  <div className="text-sm text-txt-muted">{agent.role}</div>
                </div>
              </button>
            ))}
          </div>
        )}
        {showAddMenu && nonMemberAgents.length === 0 && (
          <div className="absolute z-10 left-0 right-0 mt-2 rounded-xl bg-elevated border border-bdr/40 text-sm text-txt-muted text-center" style={{ padding: 20 }}>
            所有 Agent 已在群组中
          </div>
        )}
      </div>

      {/* 模型切换弹窗 */}
      <Dialog open={!!editMember} onOpenChange={(open) => { if (!open) setEditMember(null); }}>
        <DialogContent className="sm:max-w-[380px]">
          <DialogHeader>
            <DialogTitle>切换模型</DialogTitle>
          </DialogHeader>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-txt-sub mb-1 block">Provider</label>
                <Select value={editMember?.provider || ""} onValueChange={(v) => {
                  if (!editMember) return;
                  const m = getModels(v);
                  setEditMember({ ...editMember, provider: v, model: m?.[0]?.id || editMember.model });
                }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {allProviders.map((p) => (
                      <SelectItem key={p} value={p}>{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm text-txt-sub mb-1 block">Model</label>
                {editModels.length > 0 ? (
                  <Select value={editMember?.model || ""} onValueChange={(v) => {
                    if (editMember) setEditMember({ ...editMember, model: v });
                  }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {editModels.map((m) => (
                        <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <input
                    value={editMember?.model || ""}
                    onChange={(e) => { if (editMember) setEditMember({ ...editMember, model: e.target.value }); }}
                    className="w-full h-9 px-3 rounded-lg bg-input border border-bdr text-sm text-txt focus:outline-none focus:border-accent/50"
                    placeholder="模型 ID"
                  />
                )}
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={() => setEditMember(null)} className="h-10 px-4 rounded-lg text-sm text-txt-sub bg-hover hover:bg-elevated transition-colors">取消</button>
              <button onClick={handleSaveModel} className="h-10 px-4 rounded-lg text-sm font-medium bg-accent text-white hover:bg-accent/90 transition-colors">确认</button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!removeTarget}
        onOpenChange={(open) => { if (!open) setRemoveTarget(null); }}
        title="移除成员"
        description={`确定要将 ${removeTarget ? (agents.find((a) => a.id === removeTarget)?.name ?? removeTarget) : ""} 移出群组吗？此操作会移除其工作区访问权限。`}
        confirmLabel="移除"
        variant="danger"
        onConfirm={handleConfirmRemove}
      />
    </div>
  );
}
