import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useSettingsStore } from "@/stores/settings";
import { useTrayStore } from "@/stores/tray";
import { useAgentsStore } from "@/stores/agents";
import { useGroupsStore } from "@/stores/groups";
import { isTauri } from "@/lib/utils";

/**
 * 托盘事件通信 Hook。
 * 监听前端状态变化，推送给 Rust 侧更新托盘菜单。
 * 非 Tauri 环境（浏览器模式）下跳过全部 Tauri 调用，避免启动崩溃。
 */
export function useTray() {
  const agents = useAgentsStore((s) => s.agents);
  const groups = useGroupsStore((s) => s.groups);
  const updateStatus = useTrayStore((s) => s.updateStatus);
  const clearUnread = useTrayStore((s) => s.clearUnread);

  // 监听 Agent/Group 状态变化，更新托盘（仅 Tauri 环境有托盘）
  useEffect(() => {
    if (!isTauri()) return;
    const runningAgents = agents.filter((a) => a.status === "running").length;
    const activeGroups = groups.filter((g) => g.members.length > 0).length;
    updateStatus(runningAgents, activeGroups);
  }, [agents, groups, updateStatus]);

  // 监听窗口焦点变化 — 获得焦点时清除未读
  useEffect(() => {
    if (!isTauri()) return;
    const unlisten = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (focused) clearUnread();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [clearUnread]);

  // 监听窗口关闭请求 — 根据设置决定隐藏还是退出
  useEffect(() => {
    if (!isTauri()) return;
    const unlisten = listen<void>("window-close-requested", () => {
      const closeBehavior = useSettingsStore.getState().closeBehavior;
      if (closeBehavior === "close") {
        getCurrentWindow().destroy();
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
    if (!isTauri()) return;
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
 * 根据 closeBehavior 设置决定退出方式；非 Tauri 环境回退到 window.close()。
 */
export async function exitApp() {
  if (!isTauri()) {
    window.close();
    return;
  }
  const closeBehavior = useSettingsStore.getState().closeBehavior;
  if (closeBehavior === "close") {
    await getCurrentWindow().destroy();
  } else {
    await getCurrentWindow().hide();
  }
}
