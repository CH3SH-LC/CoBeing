import { TitleBar } from "./TitleBar";
import { NavBar } from "./NavBar";
import { Sidebar } from "./Sidebar";
import { MainContent } from "./MainContent";
import { AgentDetailPanel } from "@/components/agent/AgentDetailPanel";
import { GroupDetailPanel } from "@/components/group/GroupDetailPanel";
import { ButlerConfigPanel } from "@/components/agent/ButlerConfigPanel";

export function AppLayout() {
  return (
    <div
      className="flex flex-col h-screen w-screen overflow-hidden text-txt font-body"
      style={{
        background: `linear-gradient(var(--base-gradient-angle, 135deg), var(--color-base-from), var(--color-base-to))`,
      }}
    >
      <TitleBar />
      <div className="flex flex-1 min-h-0 gap-0">
        <NavBar />
        <Sidebar />
        <MainContent />
        <AgentDetailPanel />
        <GroupDetailPanel />
        <ButlerConfigPanel />
      </div>
    </div>
  );
}
