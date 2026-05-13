import { create } from "zustand";
import type { UsageStats } from "@/lib/types";

/** DeepSeek 定价（RMB / 百万 tokens） */
const PRICING = {
  cacheHit: 0.02,   // 缓存命中
  cacheMiss: 1.0,   // 缓存未命中（读取）
  output: 2.0,      // 输出
};

interface UsageRecord extends UsageStats {
  /** 本次请求的估算费用（RMB） */
  cost: number;
}

interface UsageStore {
  /** 所有 usage 记录（按时间倒序） */
  records: UsageRecord[];
  /** 累计统计 */
  totals: {
    inputTokens: number;
    outputTokens: number;
    cacheHitTokens: number;
    cacheMissTokens: number;
    totalCost: number;
  };
  /** 按 Agent 汇总 */
  byAgent: Record<string, {
    inputTokens: number;
    outputTokens: number;
    cacheHitTokens: number;
    cacheMissTokens: number;
    cost: number;
    requestCount: number;
  }>;

  addRecord: (stats: UsageStats) => void;
  clear: () => void;
}

function calcCost(stats: { cacheHitTokens: number; cacheMissTokens: number; outputTokens: number }): number {
  const hitCost = (stats.cacheHitTokens / 1_000_000) * PRICING.cacheHit;
  const missCost = (stats.cacheMissTokens / 1_000_000) * PRICING.cacheMiss;
  const outputCost = (stats.outputTokens / 1_000_000) * PRICING.output;
  return hitCost + missCost + outputCost;
}

export const useUsageStore = create<UsageStore>((set, get) => ({
  records: [],
  totals: { inputTokens: 0, outputTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0, totalCost: 0 },
  byAgent: {},

  addRecord: (stats) => {
    const cost = calcCost(stats);
    const record: UsageRecord = { ...stats, cost };

    const prev = get();
    const newTotals = {
      inputTokens: prev.totals.inputTokens + stats.inputTokens,
      outputTokens: prev.totals.outputTokens + stats.outputTokens,
      cacheHitTokens: prev.totals.cacheHitTokens + stats.cacheHitTokens,
      cacheMissTokens: prev.totals.cacheMissTokens + stats.cacheMissTokens,
      totalCost: prev.totals.totalCost + cost,
    };

    const prevAgent = prev.byAgent[stats.agentId] ?? {
      inputTokens: 0, outputTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0, cost: 0, requestCount: 0,
    };
    const newByAgent = {
      ...prev.byAgent,
      [stats.agentId]: {
        inputTokens: prevAgent.inputTokens + stats.inputTokens,
        outputTokens: prevAgent.outputTokens + stats.outputTokens,
        cacheHitTokens: prevAgent.cacheHitTokens + stats.cacheHitTokens,
        cacheMissTokens: prevAgent.cacheMissTokens + stats.cacheMissTokens,
        cost: prevAgent.cost + cost,
        requestCount: prevAgent.requestCount + 1,
      },
    };

    set({
      records: [record, ...prev.records].slice(0, 200), // 保留最近 200 条
      totals: newTotals,
      byAgent: newByAgent,
    });
  },

  clear: () => set({
    records: [],
    totals: { inputTokens: 0, outputTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0, totalCost: 0 },
    byAgent: {},
  }),
}));
