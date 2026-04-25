import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/button";
import type { GroupInfo } from "@/lib/types";
import { useAgentsStore } from "@/stores/agents";
import { getWsClient } from "@/hooks/useWebSocket";

const CATALOG_MODELS: Record<string, Array<{ id: string; name: string }>> = {
  deepseek: [{ id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" }, { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" }],
  zhipu: [{ id: "glm-4-plus", name: "GLM-4 Plus" }, { id: "glm-4-air", name: "GLM-4 Air" }, { id: "glm-4-flash", name: "GLM-4 Flash" }, { id: "codegeex-4", name: "CodeGeeX 4" }],
  qwen: [{ id: "qwen-max", name: "Qwen Max" }, { id: "qwen-plus", name: "Qwen Plus" }, { id: "qwen-coder-plus", name: "Qwen Coder Plus" }, { id: "qwq-32b", name: "QwQ 32B" }],
  minimax: [{ id: "MiniMax-Text-01", name: "MiniMax Text 01" }, { id: "MiniMax-M1", name: "MiniMax M1" }],
  volcengine: [{ id: "doubao-pro-32k", name: "Doubao Pro 32K" }, { id: "doubao-pro-128k", name: "Doubao Pro 128K" }],
  moonshot: [{ id: "moonshot-v1-8k", name: "Moonshot V1 8K" }, { id: "moonshot-v1-128k", name: "Moonshot V1 128K" }, { id: "kimi-k2", name: "Kimi K2" }],
  siliconflow: [{ id: "deepseek-ai/DeepSeek-V3", name: "DeepSeek V3 (SF)" }, { id: "Qwen/Qwen3-235B-A22B", name: "Qwen3 235B (SF)" }],
  openai: [{ id: "gpt-4o", name: "GPT-4o" }, { id: "gpt-4.1", name: "GPT-4.1" }, { id: "o3-mini", name: "O3 Mini" }],
  anthropic: [{ id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4" }, { id: "claude-haiku-4-20250414", name: "Claude Haiku 4" }],
  gemini: [{ id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" }, { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" }],
  grok: [{ id: "grok-3", name: "Grok 3" }, { id: "grok-3-fast", name: "Grok 3 Fast" }],
};

const ALL_PROVIDERS = Object.keys(CATALOG_MODELS).sort();

interface GroupMembersTabProps {
  group: GroupInfo;
}

export function GroupMembersTab({ group }: GroupMembersTabProps) {
  const agents = useAgentsStore((s) => s.agents);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [editMember, setEditMember] = useState<{ agentId: string; provider: string; model: string } | null>(null);

  const hostId = group.members[0];
  const nonMemberAgents = agents.filter(
    (a) => !group.members.includes(a.id) && a.id !== "butler"
  );

  const handleRemove = (agentId: string) => {
    if (agentId === hostId) return;
    getWsClient()?.send({
      type: "remove_group_member",
      payload: { groupId: group.id, agentId },
    });
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

  const editModels = editMember ? (CATALOG_MODELS[editMember.provider] || []) : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {group.members.map((memberId) => {
          const agent = agents.find((a) => a.id === memberId);
          const isHost = memberId === hostId;
          return (
            <div
              key={memberId}
              className="flex items-center gap-3 rounded-xl bg-elevated"
              style={{ padding: "14px 20px" }}
            >
              <div className="w-8 h-8 rounded-lg bg-surface-solid flex items-center justify-center text-xs text-txt">
                {agent?.name?.[0] ?? "?"}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-txt">{agent?.name ?? memberId}</div>
                <div
                  className="text-sm text-txt-muted cursor-pointer hover:text-accent transition-colors"
                  onClick={() => agent && handleEditModel(agent.id, agent.provider, agent.model)}
                  title="点击切换模型"
                >
                  {agent?.provider}/{agent?.model} ✎
                </div>
              </div>
              {isHost ? (
                <span className="text-sm px-2 py-0.5 rounded-full bg-accent/10 text-accent">
                  主持人
                </span>
              ) : (
                <button
                  onClick={() => handleRemove(memberId)}
                  className="text-xs text-danger/60 hover:text-danger transition-colors"
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
          className="w-full h-10 rounded-xl border border-dashed border-bdr text-xs text-txt-muted hover:text-txt hover:border-accent/30 transition-colors"
        >
          + 添加成员
        </button>

        {showAddMenu && nonMemberAgents.length > 0 && (
          <div className="absolute z-10 left-0 right-0 mt-1 rounded-xl bg-elevated border border-bdr shadow-lg max-h-48 overflow-y-auto">
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
          <div className="absolute z-10 left-0 right-0 mt-1 rounded-xl bg-elevated border border-bdr text-xs text-txt-muted text-center" style={{ padding: 20 }}>
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
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm text-txt-sub mb-1 block">Provider</label>
                <Select value={editMember?.provider || ""} onValueChange={(v) => {
                  if (!editMember) return;
                  const m = CATALOG_MODELS[v];
                  setEditMember({ ...editMember, provider: v, model: m?.[0]?.id || editMember.model });
                }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ALL_PROVIDERS.map((p) => (
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
            <div className="flex justify-end gap-2">
              <button onClick={() => setEditMember(null)} className="h-9 px-4 rounded-lg text-sm text-txt-sub bg-hover hover:bg-elevated transition-colors">取消</button>
              <button onClick={handleSaveModel} className="h-9 px-4 rounded-lg text-sm font-medium bg-accent text-white hover:bg-accent/90 transition-colors">确认</button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
