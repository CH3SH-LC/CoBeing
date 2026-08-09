import { create } from "zustand";
import type { ViewType } from "@/lib/types";

export type SettingsSection = "user" | "general" | "theme" | "providers" | "channels" | "sandbox" | "wakequeue" | "logs" | "search" | "export" | "about" | `plugin:${string}`;
export type CloseBehavior = "minimize" | "close";

interface NotificationSettings {
  enabled: boolean;
  sound: boolean;
}

/** 进阶导航开关（决策 #11 / spec #6）— 默认折叠，仅常驻管家/设置 */
const ADVANCED_NAV_KEY = "cobeing_advanced_nav";

function loadAdvancedNav(): boolean {
  try {
    return localStorage.getItem(ADVANCED_NAV_KEY) === "1";
  } catch {
    return false;
  }
}

interface SettingsStore {
  activeView: ViewType;
  connected: boolean;
  detailPanelOpen: boolean;
  createAgentDialogOpen: boolean;
  createGroupDialogOpen: boolean;
  settingsSection: SettingsSection;
  closeBehavior: CloseBehavior;
  notifications: NotificationSettings;
  advancedNav: boolean;

  setActiveView: (view: ViewType) => void;
  setConnected: (val: boolean) => void;
  toggleDetailPanel: () => void;
  setDetailPanelOpen: (open: boolean) => void;
  setCreateAgentDialogOpen: (open: boolean) => void;
  setCreateGroupDialogOpen: (open: boolean) => void;
  setSettingsSection: (section: SettingsSection) => void;
  setCloseBehavior: (behavior: CloseBehavior) => void;
  setNotifications: (settings: Partial<NotificationSettings>) => void;
  setAdvancedNav: (val: boolean) => void;
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  activeView: "butler",
  connected: false,
  detailPanelOpen: false,
  createAgentDialogOpen: false,
  createGroupDialogOpen: false,
  settingsSection: "theme",
  closeBehavior: "close",
  notifications: { enabled: true, sound: true },
  advancedNav: loadAdvancedNav(),

  setActiveView: (view) => set({ activeView: view, detailPanelOpen: false }),
  setConnected: (val) => set({ connected: val }),
  toggleDetailPanel: () => set((s) => ({ detailPanelOpen: !s.detailPanelOpen })),
  setDetailPanelOpen: (open) => set({ detailPanelOpen: open }),
  setCreateAgentDialogOpen: (open) => set({ createAgentDialogOpen: open }),
  setCreateGroupDialogOpen: (open) => set({ createGroupDialogOpen: open }),
  setSettingsSection: (section) => set({ settingsSection: section }),
  setCloseBehavior: (behavior) => set({ closeBehavior: behavior }),
  setNotifications: (settings) =>
    set((s) => ({ notifications: { ...s.notifications, ...settings } })),
  setAdvancedNav: (val) => {
    try {
      localStorage.setItem(ADVANCED_NAV_KEY, val ? "1" : "0");
    } catch {
      /* localStorage 不可用则仅内存态 */
    }
    set({ advancedNav: val });
  },
}));
