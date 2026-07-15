import { Fragment, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settings";
import { useAgentsStore } from "@/stores/agents";
import { useGroupsStore } from "@/stores/groups";
import { useChatStore } from "@/stores/chat";
import { getWsClient } from "@/hooks/useWebSocket";
import { CreateAgentDialog } from "@/components/agent/CreateAgentDialog";
import { CreateGroupDialog } from "@/components/group/CreateGroupDialog";
import { GlobalTodoPanel } from "@/components/todo/GlobalTodoPanel";
import { getVisibleUserAgents } from "@/lib/coreAgents";
import { SurfaceCard } from "./Surface";

function ListDivider() {
  return (
    <div
      style={{
        height: 1,
        margin: "2px 8px",
        borderRadius: 1,
        backgroundColor: "var(--color-divider)",
        flexShrink: 0,
      }}
    />
  );
}

const SIDEBAR_COPY = {
  agentSubtitle: "\u9009\u62e9\u8981\u5bf9\u8bdd\u7684\u667a\u80fd\u4f53",
  groupSubtitle: "\u9009\u62e9\u8981\u534f\u4f5c\u7684\u7fa4\u7ec4",
  searchPlaceholder: "\u641c\u7d22...",
  newAgent: "\u65b0\u5efa Agent",
  newGroup: "\u65b0\u5efa\u7fa4\u7ec4",
  refresh: "\u5237\u65b0\u5217\u8868",
  emptyAgents: "\u6682\u65e0 Agent",
  emptyGroups: "\u6682\u65e0\u7fa4\u7ec4",
  groupGlyph: "\u7fa4",
  members: "\u6210\u5458",
  completed: "\u5df2\u5b8c\u6210",
  archived: "\u5df2\u5f52\u6863",
};

export function Sidebar() {
  const activeView = useSettingsStore((s) => s.activeView);
  const agentDialogOpen = useSettingsStore((s) => s.createAgentDialogOpen);
  const groupDialogOpen = useSettingsStore((s) => s.createGroupDialogOpen);
  const setAgentDialogOpen = useSettingsStore((s) => s.setCreateAgentDialogOpen);
  const setGroupDialogOpen = useSettingsStore((s) => s.setCreateGroupDialogOpen);
  const rawAgents = useAgentsStore((s) => s.agents);
  const agents = getVisibleUserAgents(rawAgents);
  const selectedAgent = useAgentsStore((s) => s.selectedAgent);
  const selectAgent = useAgentsStore((s) => s.selectAgent);
  const groups = useGroupsStore((s) => s.groups);
  const selectedGroup = useGroupsStore((s) => s.selectedGroup);
  const selectGroup = useGroupsStore((s) => s.selectGroup);
  const setActiveConv = useChatStore((s) => s.setActiveConversation);

  useEffect(() => {
    if (activeView === "agents" && agents.length > 0) {
      const isValid = agents.some((a) => a.id === selectedAgent);
      if (!isValid) {
        selectAgent(agents[0].id);
        setActiveConv(agents[0].id);
      }
    }
    if (activeView === "groups" && groups.length > 0) {
      const isValid = groups.some((g) => g.id === selectedGroup);
      if (!isValid) {
        selectGroup(groups[0].id);
        setActiveConv(groups[0].id);
      }
    }
  }, [activeView, agents, groups]);

  if (activeView === "butler") {
    return <GlobalTodoPanel />;
  }

  if (activeView !== "agents" && activeView !== "groups") return null;

  return (
    <>
      <aside className="h-full min-h-0 flex flex-col">
        <SurfaceCard className="flex h-full min-h-0 flex-col overflow-hidden" padding={20}>
          <div className="shrink-0">
            <div className="text-base font-semibold text-txt">
              {activeView === "agents" ? "Agents" : "Groups"}
            </div>
            <div className="text-sm text-txt-muted" style={{ marginTop: 6 }}>
              {activeView === "agents"
                ? SIDEBAR_COPY.agentSubtitle
                : SIDEBAR_COPY.groupSubtitle}
            </div>
          </div>
          <input
            type="text"
            placeholder={SIDEBAR_COPY.searchPlaceholder}
            className="w-full shrink-0 rounded-xl bg-input border border-bdr/40 text-sm text-txt placeholder:text-txt-muted focus:outline-none focus:border-accent/50 transition-colors"
            style={{ padding: "12px 16px", marginTop: 16 }}
          />
          <div
            className="min-h-0 flex-1 overflow-y-auto"
            style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 16 }}
          >
            {activeView === "agents" && <AgentList />}
            {activeView === "groups" && <GroupList />}
          </div>
        </SurfaceCard>
      </aside>
      <CreateAgentDialog open={agentDialogOpen} onOpenChange={setAgentDialogOpen} />
      <CreateGroupDialog open={groupDialogOpen} onOpenChange={setGroupDialogOpen} />
    </>
  );
}

function AgentList() {
  const rawAgents = useAgentsStore((s) => s.agents);
  const agents = getVisibleUserAgents(rawAgents);
  const selectedAgent = useAgentsStore((s) => s.selectedAgent);
  const selectAgent = useAgentsStore((s) => s.selectAgent);
  const setActiveConv = useChatStore((s) => s.setActiveConversation);
  const messageStore = useChatStore((s) => s.messageStore);
  const unreadCounts = useChatStore((s) => s.unreadCounts);
  const openDialog = useSettingsStore((s) => s.setCreateAgentDialogOpen);
  const handleSelect = (id: string) => { selectAgent(id); setActiveConv(id); };

  const sortedAgents = [...agents].sort((a, b) => {
    const aLast = messageStore[a.id]?.slice(-1)[0]?.timestamp ?? 0;
    const bLast = messageStore[b.id]?.slice(-1)[0]?.timestamp ?? 0;
    if (aLast !== bLast) return bLast - aLast;
    return a.name.localeCompare(b.name);
  });

  return (
    <>
      <button
        onClick={() => openDialog(true)}
        className="w-full shrink-0 rounded-lg bg-accent/10 border border-accent/30 text-accent text-sm font-medium hover:bg-accent/20 transition-colors"
        style={{ padding: "14px 20px" }}
      >
        + {SIDEBAR_COPY.newAgent}
      </button>
      <button
        onClick={() => getWsClient()?.send({ type: "get_state" })}
        className="w-full shrink-0 rounded-lg text-txt-muted text-sm hover:text-txt hover:bg-hover transition-colors"
        style={{ padding: "10px 16px" }}
      >
        {SIDEBAR_COPY.refresh}
      </button>
      {sortedAgents.map((agent, i) => (
        <Fragment key={agent.id}>
          {i > 0 && <ListDivider />}
          <button
            onClick={() => handleSelect(agent.id)}
            className={cn(
              "w-full shrink-0 rounded-lg text-left transition-colors",
              selectedAgent === agent.id ? "bg-elevated" : "hover:bg-hover",
            )}
            style={{ padding: "14px 16px" }}
          >
            <div className="flex items-center gap-4">
              <div className="w-9 h-9 rounded-lg bg-surface-solid border border-bdr/30 flex items-center justify-center text-txt text-sm font-medium shrink-0">
                {agent.name[0]}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-txt font-medium truncate">{agent.name}</div>
                <div className="text-xs text-txt-muted truncate" style={{ marginTop: 3 }}>{agent.role}</div>
              </div>
              {(unreadCounts[agent.id] ?? 0) > 0 && (
                <span className="rounded-full bg-accent text-white text-xs font-medium flex items-center justify-center shrink-0"
                      style={{ minWidth: 22, height: 22, padding: "0 6px" }}>
                  {unreadCounts[agent.id]! > 99 ? "99+" : unreadCounts[agent.id]}
                </span>
              )}
            </div>
          </button>
        </Fragment>
      ))}
      {sortedAgents.length === 0 && (
        <p className="text-txt-muted text-sm text-center" style={{ padding: "40px 0" }}>
          {SIDEBAR_COPY.emptyAgents}
        </p>
      )}
    </>
  );
}

function GroupList() {
  const groups = useGroupsStore((s) => s.groups);
  const selectedGroup = useGroupsStore((s) => s.selectedGroup);
  const selectGroup = useGroupsStore((s) => s.selectGroup);
  const setActiveConv = useChatStore((s) => s.setActiveConversation);
  const messageStore = useChatStore((s) => s.messageStore);
  const unreadCounts = useChatStore((s) => s.unreadCounts);
  const openDialog = useSettingsStore((s) => s.setCreateGroupDialogOpen);
  const handleSelect = (id: string) => { selectGroup(id); setActiveConv(id); };

  const sortedGroups = [...groups].sort((a, b) => {
    const aLast = messageStore[a.id]?.slice(-1)[0]?.timestamp ?? 0;
    const bLast = messageStore[b.id]?.slice(-1)[0]?.timestamp ?? 0;
    if (aLast !== bLast) return bLast - aLast;
    return a.name.localeCompare(b.name);
  });

  return (
    <>
      <button
        onClick={() => openDialog(true)}
        className="w-full shrink-0 rounded-lg bg-purple/10 border border-purple/30 text-purple text-sm font-medium hover:bg-purple/20 transition-colors"
        style={{ padding: "14px 20px" }}
      >
        + {SIDEBAR_COPY.newGroup}
      </button>
      <button
        onClick={() => getWsClient()?.send({ type: "get_state" })}
        className="w-full shrink-0 rounded-lg text-txt-muted text-sm hover:text-txt hover:bg-hover transition-colors"
        style={{ padding: "10px 16px" }}
      >
        {SIDEBAR_COPY.refresh}
      </button>
      {sortedGroups.map((group, i) => (
        <Fragment key={group.id}>
          {i > 0 && <ListDivider />}
          <button
            onClick={() => handleSelect(group.id)}
            className={cn(
              "w-full shrink-0 rounded-lg text-left transition-colors",
              selectedGroup === group.id ? "bg-elevated" : "hover:bg-hover",
            )}
            style={{ padding: "14px 16px" }}
          >
            <div className="flex items-center gap-4">
              <div className="w-9 h-9 rounded-lg bg-purple/10 border border-purple/20 flex items-center justify-center text-purple text-sm shrink-0">
                {SIDEBAR_COPY.groupGlyph}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-purple font-medium truncate">{group.name}</div>
                <div className="text-xs text-txt-muted truncate" style={{ marginTop: 3 }}>
                  {group.members.length} {SIDEBAR_COPY.members}
                </div>
              </div>
              {group.status === "completed" && (
                <span className="text-xs px-2 py-1 rounded-lg bg-success/10 text-success shrink-0">
                  {SIDEBAR_COPY.completed}
                </span>
              )}
              {group.status === "archived" && (
                <span className="text-xs px-2 py-1 rounded-lg bg-txt-muted/10 text-txt-muted shrink-0">
                  {SIDEBAR_COPY.archived}
                </span>
              )}
              {(unreadCounts[group.id] ?? 0) > 0 && (
                <span className="rounded-full bg-purple text-white text-xs font-medium flex items-center justify-center shrink-0"
                      style={{ minWidth: 22, height: 22, padding: "0 6px" }}>
                  {unreadCounts[group.id]! > 99 ? "99+" : unreadCounts[group.id]}
                </span>
              )}
            </div>
          </button>
        </Fragment>
      ))}
      {sortedGroups.length === 0 && (
        <p className="text-txt-muted text-sm text-center" style={{ padding: "40px 0" }}>
          {SIDEBAR_COPY.emptyGroups}
        </p>
      )}
    </>
  );
}
