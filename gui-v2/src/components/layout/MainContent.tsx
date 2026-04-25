import { useEffect } from "react";
import { useSettingsStore } from "@/stores/settings";
import { useChatStore } from "@/stores/chat";
import { useAgentsStore } from "@/stores/agents";
import { useGroupsStore } from "@/stores/groups";
import { ChatView } from "@/components/chat/ChatView";
import { GroupChatView } from "@/components/chat/GroupChatView";
import { SettingsView } from "@/components/settings/SettingsView";
import { SkillCenter } from "@/components/skill/SkillCenter";

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

  // Determine if active conversation is a group
  const isGroupChat = !!groups.find((g) => g.id === activeConv) && !agents.find((a) => a.id === activeConv);

  // Butler: always show ChatView with butler conversation
  if (activeView === "butler") {
    return (
      <main className="flex-1 h-full flex flex-col min-w-0 min-h-0 overflow-hidden">
        <ChatView targetAgentId="butler" />
      </main>
    );
  }

  // Agents/Groups: show chat based on selected conversation
  if (activeView === "agents" || activeView === "groups") {
    return (
      <main className="flex-1 h-full flex flex-col min-w-0 min-h-0 overflow-hidden">
        {isGroupChat ? <GroupChatView /> : <ChatView />}
      </main>
    );
  }

  // Skills and Settings: self-contained layouts
  return (
    <main className="flex-1 h-full flex flex-col min-w-0 min-h-0 overflow-hidden">
      {activeView === "skills" && <SkillCenter />}
      {activeView === "settings" && <SettingsView />}
    </main>
  );
}
