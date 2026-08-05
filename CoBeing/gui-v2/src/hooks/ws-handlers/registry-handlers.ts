import type { WsStatePayload } from "@/lib/types";
import { useAgentsStore } from "@/stores/agents";
import { useGroupsStore } from "@/stores/groups";
import { useSettingsStore } from "@/stores/settings";
import { useActivityStore } from "@/stores/activity";
import { emitActivity } from "./helpers";
import type { WsHandlerContext, WsMessageHandler } from "./types";

export function buildRegistryHandlers(ctx: WsHandlerContext): Record<string, WsMessageHandler> {
  const {
    stateRetryCount,
    stateRetryTimer,
    setAgents,
    setGroups,
    clearMessages,
    send,
  } = ctx;

  return {
    state: (msg) => {
      const p = msg.payload as WsStatePayload;
      setAgents(p.agents);
      setGroups(p.groups);
      // 后端可能还在初始化，空状态时自动重试（最多 5 次，间隔 2 秒）
      if (p.agents.length === 0 && p.groups.length === 0 && stateRetryCount.current < 5) {
        stateRetryCount.current++;
        if (stateRetryTimer.current) clearTimeout(stateRetryTimer.current);
        stateRetryTimer.current = setTimeout(() => {
          send({ type: "get_state" });
        }, 2000);
      }
    },

    agent_updated: () => {
      send({ type: "get_state" });
    },

    agent_created: (msg) => {
      const ac = msg.payload as { id: string; name: string };
      emitActivity("📦", `Agent ${ac.name} 已创建`, "info", "system", ac.id, undefined, { agentName: ac.name });
      send({ type: "get_state" });
    },

    agent_destroyed: (msg) => {
      const d = msg.payload as { agentId: string };
      const destroyedName = useAgentsStore.getState().agents.find(a => a.id === d.agentId)?.name || d.agentId;
      emitActivity("🗑️", `Agent ${destroyedName} 已删除`, "info", "system", d.agentId, undefined, { agentName: destroyedName });
      clearMessages(d.agentId);
      useAgentsStore.getState().selectAgent(null);
      useSettingsStore.getState().setDetailPanelOpen(false);
      send({ type: "get_state" });
    },

    group_created: (msg) => {
      const gc = msg.payload as { id: string; name: string };
      emitActivity("👥", `群组 ${gc.name} 已创建`, "info", "system", undefined, gc.id, { groupName: gc.name });
      send({ type: "get_state" });
    },

    group_destroyed: (msg) => {
      const d = msg.payload as { groupId: string };
      const destroyedGroupName = useGroupsStore.getState().groups.find(g => g.id === d.groupId)?.name || d.groupId;
      emitActivity("👥", `群组 ${destroyedGroupName} 已解散`, "info", "system", undefined, d.groupId, { groupName: destroyedGroupName });
      clearMessages(d.groupId);
      useGroupsStore.getState().selectGroup(null);
      useSettingsStore.getState().setDetailPanelOpen(false);
      send({ type: "get_state" });
    },

    member_added: (msg) => {
      const ma = msg.payload as { groupId: string; agentId: string };
      const maAgentName = useAgentsStore.getState().agents.find(a => a.id === ma.agentId)?.name || ma.agentId;
      const maGroupName = useGroupsStore.getState().groups.find(g => g.id === ma.groupId)?.name || ma.groupId;
      emitActivity("➕", `${maAgentName} 加入了群组 ${maGroupName}`, "info", "system", ma.agentId, ma.groupId, { agentName: maAgentName, groupName: maGroupName });
      send({ type: "get_state" });
    },

    member_removed: (msg) => {
      const mr = msg.payload as { groupId: string; agentId: string };
      const mrAgentName = useAgentsStore.getState().agents.find(a => a.id === mr.agentId)?.name || mr.agentId;
      const mrGroupName = useGroupsStore.getState().groups.find(g => g.id === mr.groupId)?.name || mr.groupId;
      emitActivity("➖", `${mrAgentName} 离开了群组 ${mrGroupName}`, "info", "system", mr.agentId, mr.groupId, { agentName: mrAgentName, groupName: mrGroupName });
      send({ type: "get_state" });
    },

    agent_files: (msg) => {
      window.dispatchEvent(new CustomEvent("ws-agent-files", { detail: msg }));
    },

    agent_file_content: (msg) => {
      window.dispatchEvent(new CustomEvent("ws-agent-file-content", { detail: msg }));
    },

    file_saved: (msg) => {
      const fs = msg.payload as { agentId: string; filename: string };
      useActivityStore.getState().addFileChange({
        agentId: fs.agentId,
        action: "modified",
        filename: fs.filename,
      });
      window.dispatchEvent(new CustomEvent("ws-file-saved", { detail: msg }));
    },
  };
}
