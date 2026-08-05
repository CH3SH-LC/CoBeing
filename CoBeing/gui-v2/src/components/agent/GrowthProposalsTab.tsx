import { useEffect } from "react";
import { useAgentEnhancementStore } from "@/stores/agentEnhancement";

const RISK_LABELS: Record<string, { text: string; color: string }> = {
  low: { text: "低", color: "text-success" },
  medium: { text: "中", color: "text-warning" },
  high: { text: "高", color: "text-danger" },
};

const STATUS_LABELS: Record<string, { text: string; color: string }> = {
  pending: { text: "待审批", color: "text-warning" },
  approved: { text: "已批准", color: "text-success" },
  rejected: { text: "已拒绝", color: "text-danger" },
  applied: { text: "已应用", color: "text-accent" },
};

export function GrowthProposalsTab({ agentId }: { agentId: string }) {
  const proposals = useAgentEnhancementStore((s) => s.proposals[agentId]) ?? [];
  const loading = useAgentEnhancementStore((s) => s.loading[`prop_${agentId}`]);
  const fetchProposals = useAgentEnhancementStore((s) => s.fetchProposals);
  const approveProposal = useAgentEnhancementStore((s) => s.approveProposal);
  const rejectProposal = useAgentEnhancementStore((s) => s.rejectProposal);

  useEffect(() => {
    fetchProposals(agentId);
  }, [agentId, fetchProposals]);

  if (loading) {
    return <div className="p-4 text-txt-muted text-sm">加载中...</div>;
  }

  if (proposals.length === 0) {
    return (
      <div className="rounded-xl bg-elevated text-center" style={{ padding: 24 }}>
        <p className="text-txt-muted text-sm">暂无成长建议</p>
        <p className="text-txt-muted text-sm mt-1">Agent 在完成复杂任务后会生成成长建议，由 GrowthReviewer 自动审批。</p>
      </div>
    );
  }

  return (
    <div style={{ padding: "16px 0" }}>
      <div className="space-y-4">
        {[...proposals]
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          .map((proposal) => {
            const risk = RISK_LABELS[proposal.risk] ?? RISK_LABELS.medium;
            const status = STATUS_LABELS[proposal.status] ?? STATUS_LABELS.pending;
            const needsUserAction = proposal.status === "approved" &&
              (proposal.targetFile === "CHARACTER.md" || proposal.targetFile === "config.json");

            return (
              <div key={proposal.id} className="border border-bdr/40 rounded-xl bg-elevated text-sm" style={{ padding: 16 }}>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-txt">{proposal.targetFile}</span>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-medium ${risk.color}`}>风险: {risk.text}</span>
                    <span className={`text-xs font-medium ${status.color}`}>{status.text}</span>
                  </div>
                </div>

                <p className="text-txt-muted mb-2">{proposal.reason}</p>

                <details className="mb-2">
                  <summary className="cursor-pointer text-txt hover:text-accent text-sm">查看修改内容</summary>
                  <pre className="mt-2 bg-surface rounded-lg border border-bdr/40 text-xs text-txt-muted overflow-x-auto max-h-32" style={{ padding: 12 }}>
                    {proposal.proposedPatch.slice(0, 500)}
                  </pre>
                </details>

                {proposal.reviewNote && (
                  <p className="text-txt-muted italic mb-2">审查意见: {proposal.reviewNote}</p>
                )}

                <div className="flex items-center justify-between text-xs text-txt-muted">
                  <span>{new Date(proposal.createdAt).toLocaleString()}</span>
                  {proposal.reviewedBy && <span>审查者: {proposal.reviewedBy}</span>}
                </div>

                {needsUserAction && (
                  <div className="flex gap-2 mt-3 pt-3 border-t border-bdr/40">
                    <button
                      onClick={() => approveProposal(agentId, proposal.id)}
                      className="px-3 py-2 rounded-lg bg-success/10 text-success hover:bg-success/20 text-sm"
                    >
                      批准并应用
                    </button>
                    <button
                      onClick={() => rejectProposal(agentId, proposal.id)}
                      className="px-3 py-2 rounded-lg bg-danger/10 text-danger hover:bg-danger/20 text-sm"
                    >
                      拒绝
                    </button>
                  </div>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}
