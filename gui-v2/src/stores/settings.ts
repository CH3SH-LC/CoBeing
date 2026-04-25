import { create } from "zustand";
import type { ViewType } from "@/lib/types";

export type SettingsSection = "general" | "theme" | "providers" | "channels" | "mcp" | "sandbox" | "logs" | "about";
export type CloseBehavior = "minimize" | "close";

interface NotificationSettings {
  enabled: boolean;
  sound: boolean;
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

  setActiveView: (view: ViewType) => void;
  setConnected: (val: boolean) => void;
  toggleDetailPanel: () => void;
  setDetailPanelOpen: (open: boolean) => void;
  setCreateAgentDialogOpen: (open: boolean) => void;
  setCreateGroupDialogOpen: (open: boolean) => void;
  setSettingsSection: (section: SettingsSection) => void;
  setCloseBehavior: (behavior: CloseBehavior) => void;
  setNotifications: (settings: Partial<NotificationSettings>) => void;
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
}));
