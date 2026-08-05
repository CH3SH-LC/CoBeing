import { useSettingsStore } from "@/stores/settings";
import { useChatStore } from "@/stores/chat";

/**
 * 通知工具 — 新消息到达时按设置播放提示音 / 发送系统通知。
 * 仅在目标会话非当前查看会话，或窗口失焦时触发，避免打扰正在观看的对话。
 */

/** 播放柔和提示音（Web Audio 合成双音琶音，无需资源文件） */
export function playNotificationSound(): void {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const notes = [880, 1174.66]; // A5 → D6，两声柔和上行
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const t0 = ctx.currentTime + i * 0.12;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.12, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.4);
    });
    setTimeout(() => ctx.close(), 900);
  } catch {
    // 音频不可用时静默失败
  }
}

/** 发送系统通知（Tauri notification 插件，不可用时静默） */
export async function sendSystemNotification(title: string, body: string): Promise<void> {
  try {
    const { sendNotification } = await import("@tauri-apps/plugin-notification");
    if (sendNotification) sendNotification({ title, body });
  } catch {
    // notification 插件不可用时静默失败
  }
}

/**
 * 新消息到达入口：根据通知设置触发提示音 / 系统通知。
 * @param convId 消息所属会话（agentId / groupId）
 */
export function maybeNotify(convId: string | undefined, title: string, body: string): void {
  if (!convId) return;
  const activeConv = useChatStore.getState().activeConversation;
  const watching = convId === activeConv && document.hasFocus();
  if (watching) return; // 用户正在看这个会话，不打扰

  const s = useSettingsStore.getState().notifications;
  if (s.enabled) void sendSystemNotification(title, body);
  if (s.sound) playNotificationSound();
}
