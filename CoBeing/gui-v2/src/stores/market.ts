import { create, type StoreApi, type UseBoundStore } from "zustand";
import type {
  InstalledEntry,
  MarketDepNode,
  MarketResourceType,
  MarketResourceView,
  MarketTier,
} from "@/lib/types";
import { getWsClient } from "@/hooks/useWebSocket";

export interface MarketStore {
  resources: MarketResourceView[];
  installed: Record<string, InstalledEntry>;
  filters: { type: MarketResourceType | "all"; tier: MarketTier | "all"; query: string };
  detail: { resource: MarketResourceView; tree: MarketDepNode } | null;
  installState: "idle" | "installing" | "approval_required" | "installed" | "error";
  pendingInstall: { id: string; name: string; tree: MarketDepNode } | null;
  lastError: string | null;

  load(): void;
  setTypeFilter(type: MarketResourceType | "all"): void;
  setTierFilter(tier: MarketTier | "all"): void;
  setQuery(query: string): void;
  openDetail(id: string): void;
  closeDetail(): void;
  requestInstall(id: string): void;
  confirmInstall(): void;
  uninstall(id: string): void;
}

export const useMarketStore: UseBoundStore<StoreApi<MarketStore>> = create<MarketStore>()((set, get) => ({
  resources: [],
  installed: {},
  filters: { type: "all", tier: "all", query: "" },
  detail: null,
  installState: "idle",
  pendingInstall: null,
  lastError: null,

  load: () => {
    getWsClient()?.send({ type: "market_list", payload: { ...get().filters } });
  },

  setTypeFilter: (type) => {
    set((s) => ({ filters: { ...s.filters, type } }));
    get().load();
  },

  setTierFilter: (tier) => {
    set((s) => ({ filters: { ...s.filters, tier } }));
    get().load();
  },

  setQuery: (query) => {
    set((s) => ({ filters: { ...s.filters, query } }));
    get().load();
  },

  openDetail: (id) => {
    set({ installState: "idle", pendingInstall: null, lastError: null });
    getWsClient()?.send({ type: "market_get", payload: { id } });
  },

  closeDetail: () => {
    set({ detail: null, installState: "idle", pendingInstall: null, lastError: null });
  },

  requestInstall: (id) => {
    set({ installState: "installing", lastError: null });
    getWsClient()?.send({ type: "market_install", payload: { id } });
  },

  confirmInstall: () => {
    const pending = get().pendingInstall;
    if (!pending) return;
    set({ installState: "installing", lastError: null });
    getWsClient()?.send({ type: "market_install", payload: { id: pending.id, confirmed: true } });
  },

  uninstall: (id) => {
    getWsClient()?.send({ type: "market_uninstall", payload: { id } });
  },
}));
