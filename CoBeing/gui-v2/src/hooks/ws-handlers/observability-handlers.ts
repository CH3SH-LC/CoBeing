import type { DashboardData, WorkspaceBinding } from "@/lib/types";
import { useAgentsStore } from "@/stores/agents";
import { useGroupsStore } from "@/stores/groups";
import { useWakeQueueStore } from "@/stores/wakeQueue";
import { useObservabilityStore } from "@/stores/observability";
import { emitActivity } from "./helpers";
import type { WsHandlerContext, WsMessageHandler } from "./types";

export function buildObservabilityHandlers(_ctx: WsHandlerContext): Record<string, WsMessageHandler> {
  return {
    dashboard: (msg) => {
      const p = msg.payload as DashboardData & { error?: string };
      if (p && !p.error) useObservabilityStore.getState().setDashboard(p);
    },

    wake_queue_update: (msg) => {
      const wq = msg.payload as { groupId?: string; queue?: any[]; processing?: string | null; processingAgents?: string[]; queues?: Record<string, { groupId: string; groupName: string; queue: any[]; processing: string | null; processingAgents?: string[] }>; activeAgents?: Array<{ agentId: string; agentName: string; status: string; groupId?: string }>; timestamp: number };
      if (wq.queues) {
        useWakeQueueStore.getState().setQueues(wq.queues as any);
      } else if (wq.groupId) {
        useWakeQueueStore.getState().updateQueue(wq.groupId, wq.queue || [], wq.processing ?? null, undefined, wq.processingAgents);
      }
      if (wq.activeAgents) {
        useWakeQueueStore.getState().setActiveAgents(wq.activeAgents as any);
      }
    },

    group_health: (msg) => {
      window.dispatchEvent(new CustomEvent("ws-group-health", { detail: msg }));
    },

    screener_stats: (msg) => {
      window.dispatchEvent(new CustomEvent("ws-screener-stats", { detail: msg }));
    },

    agent_timeline: (msg) => {
      window.dispatchEvent(new CustomEvent("ws-agent-timeline", { detail: msg }));
    },

    agent_stopped: (msg) => {
      window.dispatchEvent(new CustomEvent("ws-agent-stopped", { detail: msg }));
    },

    search_results: (msg) => {
      window.dispatchEvent(new CustomEvent("ws-search-results", { detail: msg }));
    },

    export_result: (msg) => {
      const er = msg.payload as { exportType: string; data: string; fileCount: number };
      const blob = new Blob([er.data], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cobeing-${er.exportType}-${new Date().toISOString().split("T")[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
    },

    review_log: (msg) => {
      const rl = msg.payload as { type: string; agentId: string; groupId: string; rounds?: number; reason?: string };
      const reviewTypeMap: Record<string, { icon: string; verb: string; level: "info" | "warn" | "error" }> = {
        review_pending: { icon: "⏳", verb: "等待审核", level: "info" },
        review_passed: { icon: "✅", verb: "审核通过", level: "info" },
        review_failed_override: { icon: "⛔", verb: "审核拦截", level: "warn" },
      };
      const info = reviewTypeMap[rl.type];
      if (info) {
        const rlAgentName = useAgentsStore.getState().agents.find(a => a.id === rl.agentId)?.name || rl.agentId;
        const rlGroupName = useGroupsStore.getState().groups.find(g => g.id === rl.groupId)?.name || rl.groupId;
        const roundsText = rl.rounds ? `[第${rl.rounds}轮]` : "";
        const reasonText = rl.reason ? `: ${rl.reason}` : "";
        emitActivity(info.icon, `${rlAgentName} ${info.verb}${roundsText}${reasonText}`, info.level, "system", rl.agentId, rl.groupId, { agentName: rlAgentName, groupName: rlGroupName });
      }
    },

    sandbox_status: (msg) => {
      window.dispatchEvent(new CustomEvent("ws-sandbox-status", { detail: msg }));
    },

    workspace_bound: (msg) => {
      const wb = msg.payload as { agentId: string; path: string | null; effectiveWorkspace: string };
      const wbAgentName = useAgentsStore.getState().agents.find(a => a.id === wb.agentId)?.name || wb.agentId;
      if (wb.path) {
        emitActivity("📁", `${wbAgentName} 工作区已绑定: ${wb.path}`, "info", "system", wb.agentId, undefined, { agentName: wbAgentName });
      } else {
        emitActivity("📁", `${wbAgentName} 工作区已解绑，恢复默认路径`, "info", "system", wb.agentId, undefined, { agentName: wbAgentName });
      }
    },

    binding_added: (msg) => {
      const ba = msg.payload as { agentId: string; bindings: WorkspaceBinding[] };
      useAgentsStore.getState().updateAgentBindings(ba.agentId, ba.bindings);
      const baName = useAgentsStore.getState().agents.find(a => a.id === ba.agentId)?.name || ba.agentId;
      emitActivity("📁", `${baName} 已添加工作区绑定`, "info", "system", ba.agentId, undefined, { agentName: baName });
    },

    binding_removed: (msg) => {
      const br = msg.payload as { agentId: string; bindings: WorkspaceBinding[] };
      useAgentsStore.getState().updateAgentBindings(br.agentId, br.bindings);
      const brName = useAgentsStore.getState().agents.find(a => a.id === br.agentId)?.name || br.agentId;
      emitActivity("📁", `${brName} 已移除工作区绑定`, "info", "system", br.agentId, undefined, { agentName: brName });
    },

    bindings_list: (msg) => {
      const bl = msg.payload as { agentId: string; bindings: WorkspaceBinding[] };
      useAgentsStore.getState().updateAgentBindings(bl.agentId, bl.bindings);
    },

    channel_bound: (msg) => {
      const cb = msg.payload as { channelName: string; targetType: string; targetId: string };
      emitActivity("🔗", `Channel ${cb.channelName} 已绑定到 ${cb.targetType} ${cb.targetId}`, "info", "system");
    },

    channel_unbound: (msg) => {
      const cu = msg.payload as { channelName: string; targetType: string; targetId: string };
      emitActivity("🔗", `Channel ${cu.channelName} 已解绑`, "info", "system");
    },

    sandbox_action_result: (msg) => {
      const sr = msg.payload as { agentId: string; action: string; success: boolean; error?: string };
      const srAgentName = useAgentsStore.getState().agents.find(a => a.id === sr.agentId)?.name || sr.agentId;
      if (sr.success) {
        emitActivity("📦", `${srAgentName} 沙箱操作完成: ${sr.action}`, "info", "system", sr.agentId, undefined, { agentName: srAgentName });
      } else {
        emitActivity("📦", `${srAgentName} 沙箱操作失败 (${sr.action}): ${sr.error || "未知错误"}`, "error", "system", sr.agentId, undefined, { agentName: srAgentName });
      }
    },

    // Agent Enhancement
    agent_capability: (msg) => {
      const ac = msg.payload as { agentId: string; capability: import("@/lib/types").AgentCapabilityCard | null };
      import("@/stores/agentEnhancement").then(({ useAgentEnhancementStore }) => {
        useAgentEnhancementStore.getState().setCapability(ac.agentId, ac.capability);
      });
    },

    agent_inbox: (msg) => {
      const ai = msg.payload as { agentId: string; active: import("@/lib/types").AgentTaskInboxItem[]; archived: import("@/lib/types").AgentTaskInboxItem[] };
      import("@/stores/agentEnhancement").then(({ useAgentEnhancementStore }) => {
        useAgentEnhancementStore.getState().setInbox(ai.agentId, ai.active ?? [], ai.archived ?? []);
      });
    },

    agent_proposals: (msg) => {
      const ap = msg.payload as { agentId: string; proposals: import("@/lib/types").AgentGrowthProposal[] };
      import("@/stores/agentEnhancement").then(({ useAgentEnhancementStore }) => {
        useAgentEnhancementStore.getState().setProposals(ap.agentId, ap.proposals ?? []);
      });
    },

    proposal_applied: (msg) => {
      const pr = msg.payload as { agentId: string; proposalId: string };
      import("@/stores/agentEnhancement").then(({ useAgentEnhancementStore }) => {
        useAgentEnhancementStore.getState().fetchProposals(pr.agentId);
      });
    },

    proposal_rejected: (msg) => {
      const pr = msg.payload as { agentId: string; proposalId: string };
      import("@/stores/agentEnhancement").then(({ useAgentEnhancementStore }) => {
        useAgentEnhancementStore.getState().fetchProposals(pr.agentId);
      });
    },

    group_workspace: (msg) => {
      window.dispatchEvent(new CustomEvent("ws-group_workspace", { detail: msg }));
    },

    group_workspace_file: (msg) => {
      window.dispatchEvent(new CustomEvent("ws-group_workspace_file", { detail: msg }));
    },

    group_workspace_file_saved: (msg) => {
      window.dispatchEvent(new CustomEvent("ws-group_workspace_file_saved", { detail: msg }));
    },
  };
}
