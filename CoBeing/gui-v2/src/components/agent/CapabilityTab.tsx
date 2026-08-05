import { useEffect } from "react";
import { useAgentEnhancementStore } from "@/stores/agentEnhancement";

export function CapabilityTab({ agentId }: { agentId: string }) {
  const capability = useAgentEnhancementStore((s) => s.capabilities[agentId]);
  const loading = useAgentEnhancementStore((s) => s.loading[`cap_${agentId}`]);
  const fetchCapability = useAgentEnhancementStore((s) => s.fetchCapability);

  useEffect(() => {
    fetchCapability(agentId);
  }, [agentId, fetchCapability]);

  if (loading) {
    return <div className="p-4 text-txt-muted text-sm">加载中...</div>;
  }

  if (!capability) {
    return (
      <div className="rounded-xl bg-elevated text-center" style={{ padding: 24 }}>
        <p className="text-txt-muted text-sm mb-2">暂无能力画像</p>
        <p className="text-txt-muted text-sm">能力画像由 AgentCreator 在创建时自动生成，或由 Agent 通过 agent-update-capability 工具更新。</p>
      </div>
    );
  }

  return (
    <div className="space-y-4" style={{ padding: "16px 0" }}>
      <section className="rounded-xl bg-elevated" style={{ padding: 20 }}>
        <h3 className="text-sm font-semibold text-txt mb-2">角色与领域</h3>
        <p className="text-sm text-txt-muted mb-2">角色: {capability.role}</p>
        <div className="flex flex-wrap gap-2">
          {capability.domains.map((d) => (
            <span key={d} className="px-2.5 py-1 rounded-lg text-xs bg-accent/10 text-accent">{d}</span>
          ))}
        </div>
      </section>

      <section className="rounded-xl bg-elevated" style={{ padding: 20 }}>
        <h3 className="text-sm font-semibold text-txt mb-2">擅长</h3>
        <div className="flex flex-wrap gap-2">
          {capability.strengths.map((s) => (
            <span key={s} className="px-2.5 py-1 rounded-lg text-xs bg-success/10 text-success">{s}</span>
          ))}
        </div>
        {capability.limitations.length > 0 && (
          <>
            <h3 className="text-sm font-semibold text-txt mb-2 mt-3">不擅长</h3>
            <div className="flex flex-wrap gap-2">
              {capability.limitations.map((l) => (
                <span key={l} className="px-2.5 py-1 rounded-lg text-xs bg-danger/10 text-danger">{l}</span>
              ))}
            </div>
          </>
        )}
      </section>

      {capability.taskTypes.length > 0 && (
        <section className="rounded-xl bg-elevated" style={{ padding: 20 }}>
          <h3 className="text-sm font-semibold text-txt mb-2">可处理任务类型</h3>
          {capability.taskTypes.map((tt) => (
            <details key={tt.id} className="mb-2 text-sm">
              <summary className="cursor-pointer text-txt hover:text-accent">{tt.label}</summary>
              <div className="ml-4 mt-1 text-txt-muted">
                <p className="mb-1">示例: {tt.examples.join(", ")}</p>
                <p className="mb-1">输入要求: {tt.inputRequirements.join(", ")}</p>
                <p>输出格式: {tt.outputFormats.join(", ")}</p>
              </div>
            </details>
          ))}
        </section>
      )}

      <section className="rounded-xl bg-elevated" style={{ padding: 20 }}>
        <h3 className="text-sm font-semibold text-txt mb-2">协作属性</h3>
        <div className="text-sm text-txt-muted space-y-1">
          <p>独立工作: {capability.collaboration.canWorkAlone ? "✅" : "❌"}</p>
          <p>群组适配: {capability.collaboration.goodInGroups ? "✅" : "❌"}</p>
          {capability.collaboration.needsReviewFor.length > 0 && (
            <p>需审查: {capability.collaboration.needsReviewFor.join(", ")}</p>
          )}
          {capability.collaboration.shouldDelegate.length > 0 && (
            <p>应委托: {capability.collaboration.shouldDelegate.join(", ")}</p>
          )}
        </div>
      </section>

      {capability.reliability && (
        <section className="rounded-xl bg-elevated" style={{ padding: 20 }}>
          <h3 className="text-sm font-semibold text-txt mb-2">可靠性</h3>
          <div className="text-sm text-txt-muted space-y-1">
            <p>已完成: {capability.reliability.completedTasks} · 失败: {capability.reliability.failedTasks}</p>
            <p>最后更新: {new Date(capability.reliability.lastUpdated).toLocaleDateString()}</p>
          </div>
        </section>
      )}
    </div>
  );
}
