import { create } from "zustand";
import { getWsClient } from "@/hooks/useWebSocket";

// ── 首启标记（localStorage）──

const ONBOARDING_KEY = "cobeing_onboarding_done";

/** 首次启动尚未完成问卷时返回 true */
export function isOnboardingPending(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(ONBOARDING_KEY) !== "true";
}

export function markOnboardingDone(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ONBOARDING_KEY, "true");
  } catch {
    // localStorage 不可用时静默失败（非致命）
  }
}

// ── 状态与结果类型 ──

export type OnboardingStatus = "idle" | "loading" | "done" | "already_done" | "error";

export interface OnboardingCreatedAgent {
  id: string;
  name: string;
  role: string;
}

export interface OnboardingRecommendation {
  id: string;
  name: string;
  description: string;
  tier: string;
}

/** onboarding_result 消息 payload（主线程 handler 原样传入 applyResult） */
export interface OnboardingApplyResultPayload {
  status: "done" | "already_done" | "error";
  createdAgents?: OnboardingCreatedAgent[];
  marketRecommendations?: OnboardingRecommendation[];
  message?: string;
}

// ── store ──

/** 提交后等待后端响应的超时（ms）— 超时降级为 error，避免浮层永久 loading */
const SUBMIT_TIMEOUT_MS = 20_000;

interface OnboardingStore {
  status: OnboardingStatus;
  createdAgents: OnboardingCreatedAgent[];
  recommendations: OnboardingRecommendation[];
  message: string | null;
  /** 发送 onboarding_apply 并进入 loading 态 */
  submit: (interests: string[], note?: string) => void;
  /** 供主线程 onboarding_result handler 调用 */
  applyResult: (payload: OnboardingApplyResultPayload) => void;
  reset: () => void;
}

let submitTimer: ReturnType<typeof setTimeout> | null = null;

export const useOnboardingStore = create<OnboardingStore>((set, get) => ({
  status: "idle",
  createdAgents: [],
  recommendations: [],
  message: null,

  submit: (interests, note) => {
    if (get().status === "loading") return; // 防重复提交
    if (submitTimer) clearTimeout(submitTimer);
    set({ status: "loading", createdAgents: [], recommendations: [], message: null });
    getWsClient()?.send({
      type: "onboarding_apply",
      payload: { interests, ...(note ? { note } : {}) },
    });
    // 后端未响应时的降级提示（onboarding_result 到达后由 applyResult 清除）
    submitTimer = setTimeout(() => {
      if (get().status === "loading") {
        set({ status: "error", message: "未收到后端响应，请确认后端服务已启动后重试" });
      }
    }, SUBMIT_TIMEOUT_MS);
  },

  applyResult: (payload) => {
    if (submitTimer) {
      clearTimeout(submitTimer);
      submitTimer = null;
    }
    set({
      status: payload.status,
      createdAgents: payload.createdAgents ?? [],
      recommendations: payload.marketRecommendations ?? [],
      message: payload.message ?? null,
    });
  },

  reset: () => {
    if (submitTimer) {
      clearTimeout(submitTimer);
      submitTimer = null;
    }
    set({ status: "idle", createdAgents: [], recommendations: [], message: null });
  },
}));
