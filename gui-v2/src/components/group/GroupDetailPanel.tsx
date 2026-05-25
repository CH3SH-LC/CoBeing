import { useGroupsStore } from "@/stores/groups";
import { useSettingsStore } from "@/stores/settings";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GroupMembersTab } from "./GroupMembersTab";
import { GroupWorkspaceTab } from "./GroupWorkspaceTab";
import { GroupConfigTab } from "./GroupConfigTab";
import { TodoPanel } from "@/components/todo/TodoPanel";

export function GroupDetailPanel() {
  const detailPanelOpen = useSettingsStore((s) => s.detailPanelOpen);
  const setDetailPanelOpen = useSettingsStore((s) => s.setDetailPanelOpen);
  const selectedGroup = useGroupsStore((s) => s.selectedGroup);
  const groups = useGroupsStore((s) => s.groups);
  const activeView = useSettingsStore((s) => s.activeView);
  const group = groups.find((g) => g.id === selectedGroup);

  // Only show for groups view
  if (activeView !== "groups") return null;

  return (
    <Sheet open={detailPanelOpen && activeView === "groups"} onOpenChange={setDetailPanelOpen}>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>
            {group ? (
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-accent/10 flex items-center justify-center text-accent text-sm">
                  {"\u{1F465}"}
                </div>
                <div>
                  <div className="text-base">{group.name}</div>
                  <div className="text-sm text-txt-muted font-normal">
                    {group.members.length} 成员
                  </div>
                </div>
              </div>
            ) : (
              "群组详情"
            )}
          </SheetTitle>
        </SheetHeader>

        {group && (
          <div className="flex-1 overflow-y-auto" style={{ padding: 20 }}>
            <Tabs defaultValue="members">
              <TabsList className="w-full grid grid-cols-4">
                <TabsTrigger value="members">成员</TabsTrigger>
                <TabsTrigger value="workspace">工作区</TabsTrigger>
                <TabsTrigger value="config">配置</TabsTrigger>
                <TabsTrigger value="todo">TODO</TabsTrigger>
              </TabsList>
              <TabsContent value="members">
                <GroupMembersTab group={group} />
              </TabsContent>
              <TabsContent value="workspace">
                <GroupWorkspaceTab groupId={group.id} />
              </TabsContent>
              <TabsContent value="config">
                <GroupConfigTab group={group} />
              </TabsContent>
              <TabsContent value="todo">
                <TodoPanel groupId={group.id} />
              </TabsContent>
            </Tabs>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
