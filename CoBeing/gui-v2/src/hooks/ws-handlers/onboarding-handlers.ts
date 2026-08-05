import { useOnboardingStore, type OnboardingApplyResultPayload } from "@/stores/onboarding";
import { emitActivity } from "./helpers";
import type { WsHandlerContext, WsMessageHandler } from "./types";

/**
 * onboarding / butler-persona 域 WS 消息 handler
 * onboarding_result → 问卷 store 状态机；butler_personas / butler_persona_set /
 * butler_style_updated → CustomEvent（ButlerConfigPanel 管家形象区监听）
 */
export function buildOnboardingHandlers(_ctx: WsHandlerContext): Record<string, WsMessageHandler> {
  return {
    onboarding_result: (msg) => {
      const payload = msg.payload as OnboardingApplyResultPayload | undefined;
      if (!payload) return;
      useOnboardingStore.getState().applyResult(payload);
      if (payload.status === "done" && payload.createdAgents?.length) {
        emitActivity("🎉", `已为你创建 ${payload.createdAgents.length} 个初始智能体`, "info", "system");
      }
    },

    butler_personas: (msg) => {
      window.dispatchEvent(new CustomEvent("ws-butler-personas", { detail: msg.payload }));
    },

    butler_persona_set: (msg) => {
      window.dispatchEvent(new CustomEvent("ws-butler-persona-set", { detail: msg.payload }));
    },

    butler_style_updated: (msg) => {
      window.dispatchEvent(new CustomEvent("ws-butler-style-updated", { detail: msg.payload }));
    },
  };
}
