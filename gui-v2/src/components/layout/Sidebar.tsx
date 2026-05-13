import { cn } from "@/lib/utils";
import { Fragment, useEffect } from "react";
import { useSettingsStore } from "@/stores/settings";
import { useAgentsStore } from "@/stores/agents";
import { useGroupsStore } from "@/stores/groups";
import { useChatStore } from "@/stores/chat";
import { getWsClient } from "@/hooks/useWebSocket";
import { CreateAgentDialog } from "@/components/agent/CreateAgentDialog";
import { CreateGroupDialog } from "@/components/group/CreateGroupDialog";


function ListDivider() {
  return <div style={{ height: 2, margin: "0 10px", borderRadius: 1, backgroundColor: "var(--color-divider)", flexShrink: 0 }} />;
}

export function Sidebar() {
  const activeView = useSettingsStore((s) => s.activeView);
  const agentDialogOpen = useSettingsStore((s) => s.createAgentDialogOpen);
  const groupDialogOpen = useSettingsStore((s) => s.createGroupDialogOpen);
  const setAgentDialogOpen = useSettingsStore((s) => s.setCreateAgentDialogOpen);
  const setGroupDialogOpen = useSettingsStore((s) => s.setCreateGroupDialogOpen);
  const agents = useAgentsStore((s) => s.agents);
  const selectedAgent = useAgentsStore((s) => s.selectedAgent);
  const selectAgent = useAgentsStore((s) => s.selectAgent);
  const groups = useGroupsStore((s) => s.groups);
  const selectedGroup = useGroupsStore((s) => s.selectedGroup);
  const selectGroup = useGroupsStore((s) => s.selectGroup);
  const setActiveConv = useChatStore((s) => s.setActiveConversation);

  // Auto-select first item when switching views and nothing valid is selected
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

  if (activeView !== "agents" && activeView !== "groups") return null;

  return (
    <>
      <aside className="w-64 h-full flex flex-col shrink-0" style={{ padding: "20px 16px", gap: 20 }}>
        <input
          type="text"
          placeholder="搜索..."
          className="w-full rounded-lg bg-surface-solid border border-bdr text-sm text-txt placeholder:text-txt-muted focus:outline-none focus:border-accent/50 transition-colors"
          style={{ padding: "10px 14px" }}
        />
        <div className="flex-1 rounded-xl bg-surface overflow-hidden border border-bdr/40"
             style={{ boxShadow: "var(--shadow-surface)", padding: 16 }}>
          <div className="h-full overflow-y-auto" style={{ display: "flex", flexDirection: "column" }}>
            {activeView === "agents" && <AgentList />}
            {activeView === "groups" && <GroupList />}
          </div>
        </div>
      </aside>
      <CreateAgentDialog open={agentDialogOpen} onOpenChange={setAgentDialogOpen} />
      <CreateGroupDialog open={groupDialogOpen} onOpenChange={setGroupDialogOpen} />
    </>
  );
}

function AgentList() {
  const agents = useAgentsStore((s) => s.agents);
  const selectedAgent = useAgentsStore((s) => s.selectedAgent);
  const selectAgent = useAgentsStore((s) => s.selectAgent);
  const setActiveConv = useChatStore((s) => s.setActiveConversation);
  const messageStore = useChatStore((s) => s.messageStore);
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
        + 新建 Agent
      </button>
      <button
        onClick={() => getWsClient()?.send({ type: "get_state" })}
        className="w-full shrink-0 rounded-lg text-txt-muted text-xs hover:text-txt hover:bg-hover transition-colors"
        style={{ padding: "6px 0" }}
      >
        刷新列表
      </button>
      {sortedAgents.map((agent, i) => (
        <Fragment key={agent.id}>
          {i > 0 && <ListDivider />}
          <button
            onClick={() => handleSelect(agent.id)}
            className={cn(
              "w-full shrink-0 text-left transition-colors",
              selectedAgent === agent.id ? "rounded-lg bg-elevated" : "hover:bg-hover"
            )}
            style={{ padding: "14px 20px" }}
          >
            <div className="flex items-center gap-4">
              <div className="w-8 h-8 rounded-lg bg-surface-solid flex items-center justify-center text-txt text-sm font-medium shrink-0">
                {agent.name[0]}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-txt font-medium truncate">{agent.name}</div>
              </div>
            </div>
          </button>
        </Fragment>
      ))}
      {sortedAgents.length === 0 && <p className="text-txt-muted text-sm text-center" style={{ padding: "40px 0" }}>暂无 Agent</p>}
    </>
  );
}

function GroupList() {
  const groups = useGroupsStore((s) => s.groups);
  const selectedGroup = useGroupsStore((s) => s.selectedGroup);
  const selectGroup = useGroupsStore((s) => s.selectGroup);
  const setActiveConv = useChatStore((s) => s.setActiveConversation);
  const messageStore = useChatStore((s) => s.messageStore);
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
        + 新建群组
      </button>
      <button
        onClick={() => getWsClient()?.send({ type: "get_state" })}
        className="w-full shrink-0 rounded-lg text-txt-muted text-xs hover:text-txt hover:bg-hover transition-colors"
        style={{ padding: "6px 0" }}
      >
        刷新列表
      </button>
      {sortedGroups.map((group, i) => (
        <Fragment key={group.id}>
          {i > 0 && <ListDivider />}
          <button
            onClick={() => handleSelect(group.id)}
            className={cn(
              "w-full shrink-0 text-left transition-colors",
              selectedGroup === group.id ? "rounded-lg bg-elevated" : "hover:bg-hover"
            )}
            style={{ padding: "14px 20px" }}
          >
            <div className="flex items-center gap-4">
              <div className="w-8 h-8 rounded-lg bg-purple/10 flex items-center justify-center text-purple text-sm shrink-0">
                👥
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-purple font-medium truncate">{group.name}</div>
                {group.status === 'completed' && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-success/10 text-success ml-2 shrink-0">已完成</span>
                )}
                {group.status === 'archived' && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-txt-muted/10 text-txt-muted ml-2 shrink-0">已归档</span>
                )}
              </div>
            </div>
          </button>
        </Fragment>
      ))}
      {sortedGroups.length === 0 && <p className="text-txt-muted text-sm text-center" style={{ padding: "40px 0" }}>暂无群组</p>}
    </>
  );
}
