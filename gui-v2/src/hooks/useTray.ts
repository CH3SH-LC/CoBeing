import { useEffect } from "react";
import { listen, emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useSettingsStore } from "@/stores/settings";
import { useTrayStore } from "@/stores/tray";
import { useAgentsStore } from "@/stores/agents";
import { useGroupsStore } from "@/stores/groups";

/**
 * 托盘事件通信 Hook。
 * 监听前端状态变化，推送给 Rust 侧更新托盘菜单。
 */
export function useTray() {
  const agents = useAgentsStore((s) => s.agents);
  const groups = useGroupsStore((s) => s.groups);
  const updateStatus = useTrayStore((s) => s.updateStatus);
  const clearUnread = useTrayStore((s) => s.clearUnread);

  // 监听 Agent/Group 状态变化，更新托盘
  useEffect(() => {
    const runningAgents = agents.filter((a) => a.status === "running").length;
    const activeGroups = groups.filter((g) => g.members.length > 0).length;
    updateStatus(runningAgents, activeGroups);
  }, [agents, groups, updateStatus]);

  // 监听窗口焦点变化 — 获得焦点时清除未读
  useEffect(() => {
    const unlisten = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (focused) clearUnread();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [clearUnread]);

  // 监听窗口关闭请求 — 根据设置决定隐藏还是退出
  useEffect(() => {
    const unlisten = listen<void>("window-close-requested", () => {
      const closeBehavior = useSettingsStore.getState().closeBehavior;
      if (closeBehavior === "close") {
        emit("app-exit");
      } else {
        getCurrentWindow().hide();
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // 监听 Rust 侧托盘动作
  useEffect(() => {
    const unlisten = listen<string>("tray-action", (event) => {
      if (event.payload === "quit") {
        getCurrentWindow().destroy();
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);
}

/**
 * 退出应用 — 由前端发起，通知 Rust 侧退出。
 * 根据 closeBehavior 设置决定退出方式。
 */
export async function exitApp() {
  const closeBehavior = useSettingsStore.getState().closeBehavior;
  if (closeBehavior === "close") {
    await emit("app-exit");
  } else {
    await getCurrentWindow().hide();
  }
}

/**
 * 通知调用工具 — 当收到新消息时调用。
 * 根据 settings.notifications.enabled 决定是否发送系统通知。
 */
export async function sendNotification(title: string, body: string) {
  const enabled = useSettingsStore.getState().notifications.enabled;
  if (!enabled) return;

  try {
    const { sendNotification: notify } = await import("@tauri-apps/plugin-notification");
    if (notify) {
      notify({ title, body });
    }
  } catch {
    // notification 插件不可用时静默失败
  }
}
