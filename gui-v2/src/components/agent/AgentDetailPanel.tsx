import { useAgentsStore } from "@/stores/agents";
import { useSettingsStore } from "@/stores/settings";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AgentConfigTab } from "./AgentConfigTab";
import { AgentFilesTab } from "./AgentFilesTab";
import { TodoPanel } from "@/components/todo/TodoPanel";

export function AgentDetailPanel() {
  const detailPanelOpen = useSettingsStore((s) => s.detailPanelOpen);
  const setDetailPanelOpen = useSettingsStore((s) => s.setDetailPanelOpen);
  const selectedAgent = useAgentsStore((s) => s.selectedAgent);
  const agents = useAgentsStore((s) => s.agents);
  const activeView = useSettingsStore((s) => s.activeView);
  const agent = agents.find((a) => a.id === selectedAgent);

  // Only show for agents view
  if (activeView !== "agents") return null;

  return (
    <Sheet open={detailPanelOpen && activeView === "agents"} onOpenChange={setDetailPanelOpen}>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>
            {agent ? (
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-accent/10 flex items-center justify-center text-accent text-sm">
                  {agent.name[0]}
                </div>
                <div>
                  <div className="text-base">{agent.name}</div>
                  <div className="text-sm text-txt-muted font-normal">
                    {agent.role} · {agent.provider}/{agent.model}
                  </div>
                </div>
              </div>
            ) : (
              "Agent 详情"
            )}
          </SheetTitle>
        </SheetHeader>

        {agent && (
          <div className="flex-1 overflow-y-auto" style={{ padding: 20 }}>
            <Tabs defaultValue="config">
              <TabsList className="w-full grid grid-cols-3">
                <TabsTrigger value="config">配置</TabsTrigger>
                <TabsTrigger value="files">文件</TabsTrigger>
                <TabsTrigger value="todo">TODO</TabsTrigger>
              </TabsList>
              <TabsContent value="config">
                <AgentConfigTab agent={agent} />
              </TabsContent>
              <TabsContent value="files">
                <AgentFilesTab agentId={agent.id} />
              </TabsContent>
              <TabsContent value="todo">
                <TodoPanel agentId={agent.id} />
              </TabsContent>
            </Tabs>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
