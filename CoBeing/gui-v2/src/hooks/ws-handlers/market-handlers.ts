import type { InstalledEntry, MarketDepNode, MarketInstallResult, MarketResourceView } from "@/lib/types";
import { useMarketStore } from "@/stores/market";
import { emitActivity } from "./helpers";
import type { WsHandlerContext, WsMessageHandler } from "./types";

interface MarketListPayload {
  resources: MarketResourceView[];
  installed: InstalledEntry[];
}

interface MarketGetPayload {
  resource: MarketResourceView;
  dependencyTree: MarketDepNode;
}

interface MarketUninstallPayload {
  id: string;
  removedIds: string[];
  message?: string;
}

interface MarketInstalledPayload {
  installed: InstalledEntry[];
}

/** InstalledEntry[] → Record<id, entry> */
function toInstalledRecord(entries: InstalledEntry[] | undefined): Record<string, InstalledEntry> {
  const record: Record<string, InstalledEntry> = {};
  for (const entry of entries ?? []) record[entry.id] = entry;
  return record;
}

export function buildMarketHandlers(_ctx: WsHandlerContext): Record<string, WsMessageHandler> {
  return {
    market_list: (msg) => {
      const p = msg.payload as MarketListPayload | undefined;
      // 供 MarketTab 本地「首次加载完成」状态使用
      window.dispatchEvent(new CustomEvent("ws-market-list", { detail: msg }));
      useMarketStore.setState({
        resources: p?.resources ?? [],
        installed: toInstalledRecord(p?.installed),
      });
    },

    market_get: (msg) => {
      const p = msg.payload as MarketGetPayload | undefined;
      if (!p?.resource) return;
      useMarketStore.setState({
        detail: {
          resource: p.resource,
          tree:
            p.dependencyTree ??
            {
              id: p.resource.id,
              type: p.resource.type,
              name: p.resource.name,
              tier: p.resource.tier,
              riskLevel: p.resource.riskLevel,
              required: true,
              children: [],
            },
        },
      });
    },

    market_install: (msg) => {
      const p = msg.payload as MarketInstallResult | undefined;
      if (!p) return;
      switch (p.status) {
        case "approval_required":
          useMarketStore.setState({
            installState: "approval_required",
            pendingInstall: { id: p.id, name: p.name, tree: p.dependencyTree },
            lastError: null,
          });
          break;

        case "installed":
        case "already_installed": {
          useMarketStore.setState((s) => {
            const detail =
              s.detail && s.detail.resource.id === p.id
                ? { ...s.detail, resource: { ...s.detail.resource, installed: true } }
                : s.detail;
            return { installState: "installed", pendingInstall: null, lastError: null, detail };
          });
          emitActivity("📦", `市场资源「${p.name}」安装成功`, "info", "system");
          useMarketStore.getState().load();
          break;
        }

        case "error":
          useMarketStore.setState({
            installState: "error",
            lastError: p.message ?? "安装失败",
          });
          emitActivity("📦", `市场资源「${p.name}」安装失败：${p.message ?? "未知错误"}`, "error", "system");
          break;
      }
    },

    market_uninstall: (msg) => {
      const p = msg.payload as MarketUninstallPayload | undefined;
      if (!p?.id) return;
      useMarketStore.setState((s) => {
        const installed = { ...s.installed };
        const removed = new Set([p.id, ...(p.removedIds ?? [])]);
        for (const rid of removed) delete installed[rid];
        const detail =
          s.detail && s.detail.resource.id === p.id
            ? { ...s.detail, resource: { ...s.detail.resource, installed: false } }
            : s.detail;
        return { installed, detail, installState: "idle", pendingInstall: null, lastError: null };
      });
      emitActivity("🗑️", p.message ?? `已卸载市场资源「${p.id}」`, "info", "system");
      useMarketStore.getState().load();
    },

    market_installed: (msg) => {
      const p = msg.payload as MarketInstalledPayload | undefined;
      useMarketStore.setState({ installed: toInstalledRecord(p?.installed) });
    },
  };
}
