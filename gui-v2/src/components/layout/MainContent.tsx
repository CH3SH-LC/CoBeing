import { useEffect } from "react";
import { useSettingsStore } from "@/stores/settings";
import { useChatStore } from "@/stores/chat";
import { useAgentsStore } from "@/stores/agents";
import { useGroupsStore } from "@/stores/groups";
import { ChatView } from "@/components/chat/ChatView";
import { GroupChatView } from "@/components/chat/GroupChatView";
import { SettingsView } from "@/components/settings/SettingsView";
import { SkillCenter } from "@/components/skill/SkillCenter";
import { DashboardView } from "@/components/observability/DashboardView";

export function MainContent() {
  const activeView = useSettingsStore((s) => s.activeView);
  const activeConv = useChatStore((s) => s.activeConversation);
  const agents = useAgentsStore((s) => s.agents);
  const groups = useGroupsStore((s) => s.groups);
  const setActiveConv = useChatStore((s) => s.setActiveConversation);

  // Auto-select butler conversation when entering butler view
  useEffect(() => {
    if (activeView === "butler" && activeConv !== "butler") {
      setActiveConv("butler");
    }
  }, [activeView, activeConv, setActiveConv]);

  // Sync active conversation when switching between agents/groups views
  useEffect(() => {
    if (activeView === "groups" && activeConv) {
      const isAgent = agents.some((a) => a.id === activeConv);
      const isGroup = groups.some((g) => g.id === activeConv);
      if (isAgent || (!isGroup && groups.length > 0)) {
        const firstGroup = groups[0];
        if (firstGroup) setActiveConv(firstGroup.id);
      }
    }
    if (activeView === "agents" && activeConv) {
      const isGroup = groups.some((g) => g.id === activeConv);
      const isAgent = agents.some((a) => a.id === activeConv);
      if (isGroup || (!isAgent && agents.length > 0)) {
        const firstAgent = agents[0];
        if (firstAgent) setActiveConv(firstAgent.id);
      }
    }
  }, [activeView]);

  // Determine if active conversation is a group
  const isGroupChat = !!groups.find((g) => g.id === activeConv) && !agents.find((a) => a.id === activeConv);

  // Butler: always show ChatView with butler conversation
  if (activeView === "butler") {
    return (
      <main className="flex-1 h-full flex flex-col min-w-0 min-h-0 overflow-hidden">
        <ChatView key="butler" targetAgentId="butler" />
      </main>
    );
  }

  // Agents/Groups: show chat based on selected conversation
  if (activeView === "agents" || activeView === "groups") {
    return (
      <main className="flex-1 h-full flex flex-col min-w-0 min-h-0 overflow-hidden">
        {isGroupChat
          ? <GroupChatView key={activeConv ?? "group-empty"} />
          : <ChatView key={activeConv ?? "chat-empty"} />}
      </main>
    );
  }

  // Skills and Settings: self-contained layouts
  return (
    <main className="flex-1 h-full flex flex-col min-w-0 min-h-0 overflow-hidden">
      {activeView === "skills" && <SkillCenter />}
      {activeView === "dashboard" && <DashboardView />}
      {activeView === "settings" && <SettingsView />}
    </main>
  );
}
