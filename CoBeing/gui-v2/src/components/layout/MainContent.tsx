import { useEffect } from "react";
import { useSettingsStore } from "@/stores/settings";
import { useChatStore } from "@/stores/chat";
import { useAgentsStore } from "@/stores/agents";
import { useGroupsStore } from "@/stores/groups";
import { ChatView } from "@/components/chat/ChatView";
import { GroupChatView } from "@/components/chat/GroupChatView";
import { SettingsView } from "@/components/settings/SettingsView";
import { DashboardView } from "@/components/observability/DashboardView";
import { ExtensionsView } from "@/components/extensions/ExtensionsView";
import { Sidebar } from "./Sidebar";
import { SurfaceCard, WorkbenchLayout } from "./Surface";
import { getVisibleUserAgents } from "@/lib/coreAgents";

const STANDALONE_TITLES = {
  extensions: {
    title: "\u6269\u5c55",
    subtitle: "\u6280\u80fd\u3001MCP \u548c\u63d2\u4ef6\u7684\u7ba1\u7406",
  },
  dashboard: {
    title: "\u4eea\u8868\u76d8",
    subtitle: "Agent \u534f\u4f5c\u72b6\u6001\u4e0e\u8fd0\u884c\u6307\u6807",
  },
  settings: {
    title: "\u8bbe\u7f6e",
    subtitle: "\u4e2a\u4eba\u8d44\u6599\u3001\u4e3b\u9898\u3001\u8fde\u63a5\u4e0e\u6570\u636e",
  },
} as const;

type StandaloneView = keyof typeof STANDALONE_TITLES;

function isStandaloneView(view: string): view is StandaloneView {
  return view === "extensions" || view === "dashboard" || view === "settings";
}

export function MainContent() {
  const activeView = useSettingsStore((s) => s.activeView);
  const activeConv = useChatStore((s) => s.activeConversation);
  const agents = useAgentsStore((s) => s.agents);
  const groups = useGroupsStore((s) => s.groups);
  const setActiveConv = useChatStore((s) => s.setActiveConversation);

  useEffect(() => {
    if (activeView === "butler" && activeConv !== "butler") {
      setActiveConv("butler");
    }
  }, [activeView, activeConv, setActiveConv]);

  useEffect(() => {
    const visibleAgents = getVisibleUserAgents(agents);
    if (activeView === "groups" && activeConv) {
      const isAgent = visibleAgents.some((a) => a.id === activeConv);
      const isGroup = groups.some((g) => g.id === activeConv);
      if (isAgent || (!isGroup && groups.length > 0)) {
        const firstGroup = groups[0];
        if (firstGroup) setActiveConv(firstGroup.id);
      }
    }
    if (activeView === "agents" && activeConv) {
      const isGroup = groups.some((g) => g.id === activeConv);
      const isAgent = visibleAgents.some((a) => a.id === activeConv);
      if (isGroup || (!isAgent && visibleAgents.length > 0)) {
        const firstAgent = visibleAgents[0];
        if (firstAgent) setActiveConv(firstAgent.id);
      }
    }
  }, [activeView]);

  const isGroupChat = !!groups.find((g) => g.id === activeConv) && !agents.find((a) => a.id === activeConv);

  if (activeView === "butler") {
    return (
      <main className="flex-1 h-full flex flex-col min-w-0 min-h-0 overflow-hidden">
        <ChatView key="butler" targetAgentId="butler" sideRail={<Sidebar />} />
      </main>
    );
  }

  if (activeView === "agents" || activeView === "groups") {
    return (
      <main className="flex-1 h-full flex flex-col min-w-0 min-h-0 overflow-hidden">
        {isGroupChat
          ? <GroupChatView key={activeConv ?? "group-empty"} sideRail={<Sidebar />} />
          : <ChatView key={activeConv ?? "chat-empty"} sideRail={<Sidebar />} />}
      </main>
    );
  }

  if (!isStandaloneView(activeView)) return null;

  return (
    <main className="flex-1 h-full flex flex-col min-w-0 min-h-0 overflow-hidden">
      <WorkbenchLayout
        header={
          <SurfaceCard className="shrink-0" padding="16px 24px">
            <div className="text-base font-semibold text-txt">{STANDALONE_TITLES[activeView].title}</div>
            <div className="text-sm text-txt-muted" style={{ marginTop: 6 }}>
              {STANDALONE_TITLES[activeView].subtitle}
            </div>
          </SurfaceCard>
        }
        body={
          <>
            {activeView === "extensions" && <ExtensionsView />}
            {activeView === "dashboard" && <DashboardView />}
            {activeView === "settings" && <SettingsView />}
          </>
        }
      />
    </main>
  );
}
