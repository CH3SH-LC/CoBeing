import { useAgentsStore } from "@/stores/agents";
import { useSettingsStore } from "@/stores/settings";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AgentConfigTab } from "./AgentConfigTab";

export function ButlerConfigPanel() {
  const detailPanelOpen = useSettingsStore((s) => s.detailPanelOpen);
  const setDetailPanelOpen = useSettingsStore((s) => s.setDetailPanelOpen);
  const activeView = useSettingsStore((s) => s.activeView);
  const agents = useAgentsStore((s) => s.agents);

  // Only show for butler view
  if (activeView !== "butler") return null;

  const butler = agents.find((a) => a.id === "butler");

  return (
    <Sheet open={detailPanelOpen && activeView === "butler"} onOpenChange={setDetailPanelOpen}>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-accent/10 flex items-center justify-center text-accent text-sm">
                {"\u{1F916}"}
              </div>
              <div>
                <div className="text-base">管家配置</div>
                <div className="text-sm text-txt-muted font-normal">
                  {butler ? `${butler.provider}/${butler.model}` : "核心管理智能体"}
                </div>
              </div>
            </div>
          </SheetTitle>
        </SheetHeader>

        {butler && (
          <div className="flex-1 overflow-y-auto" style={{ padding: 20 }}>
            <AgentConfigTab agent={butler} />
          </div>
        )}

        {!butler && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <p className="text-txt-muted text-sm">管家 Agent 未找到</p>
              <p className="text-txt-muted text-xs mt-1">请检查后端连接状态</p>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
