import { create } from "zustand";
import { emit } from "@tauri-apps/api/event";

interface TrayStore {
  /** 运行中的 Agent 数量 */
  runningAgents: number;
  /** 活跃的 Group 数量 */
  activeGroups: number;
  /** 未读消息计数 */
  unreadCount: number;
  /** 状态文本（显示在托盘菜单） */
  statusText: string;

  updateStatus: (runningAgents: number, activeGroups: number) => void;
  incrementUnread: () => void;
  clearUnread: () => void;
}

export const useTrayStore = create<TrayStore>((set, get) => ({
  runningAgents: 0,
  activeGroups: 0,
  unreadCount: 0,
  statusText: "就绪",

  updateStatus: (runningAgents, activeGroups) => {
    const parts: string[] = [];
    if (runningAgents > 0) parts.push(`${runningAgents} 个 Agent 运行中`);
    if (activeGroups > 0) parts.push(`${activeGroups} 个 Group 活跃`);
    const statusText = parts.length > 0 ? parts.join("，") : "就绪";
    set({ runningAgents, activeGroups, statusText });

    // 通知 Rust 侧更新菜单
    emit("tray-update-status", { statusText });
  },

  incrementUnread: () => {
    const unreadCount = get().unreadCount + 1;
    set({ unreadCount });
  },

  clearUnread: () => {
    set({ unreadCount: 0 });
  },
}));
