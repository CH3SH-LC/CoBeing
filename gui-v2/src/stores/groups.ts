import { create } from "zustand";
import type { GroupInfo, GroupDetail, GroupMessage } from "@/lib/types";

interface GroupsStore {
  groups: GroupInfo[];
  selectedGroup: string | null;
  groupDetail: GroupDetail | null;
  groupMessages: GroupMessage[];

  setGroups: (groups: GroupInfo[]) => void;
  selectGroup: (id: string | null) => void;
  setGroupDetail: (detail: GroupDetail | null) => void;
  addGroupMessage: (msg: GroupMessage) => void;
  clearGroupMessages: () => void;
}

export const useGroupsStore = create<GroupsStore>((set) => ({
  groups: [],
  selectedGroup: null,
  groupDetail: null,
  groupMessages: [],

  setGroups: (groups) => set({ groups }),
  selectGroup: (id) => set({ selectedGroup: id }),
  setGroupDetail: (detail) => set({ groupDetail: detail }),
  addGroupMessage: (msg) =>
    set((s) => ({ groupMessages: [...s.groupMessages, msg] })),
  clearGroupMessages: () => set({ groupMessages: [] }),
}));
