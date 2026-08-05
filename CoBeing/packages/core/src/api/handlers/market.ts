/**
 * market 域 WS 命令 handler
 * market_list / market_get / market_install / market_uninstall / market_installed
 *
 * Market 分级机制：官方内置(official)/官方认证(certified)/社区(community)/本地私有(local)。
 * - 官方与认证资源可由管家轻量推荐，社区资源必须用户确认（installer 门禁）。
 * - market_list 同时返回文件型资源（data/market/<tier>/<id>/market.json）与
 *   本地私有资源（现有 Agent/技能聚合）。
 */
import type { MarketResourceView } from "../../market/types.js";
import { buildLocalResources } from "../../market/catalog.js";
import type { HandlerRegistrar } from "./types.js";

export function registerMarketHandlers(register: HandlerRegistrar): void {
  register("market_list", function (ws, msg) {
    if (!this.marketCatalog) {
      this.sendToClient(ws, { type: "error", payload: { message: "Market system not available" } });
      return;
    }
    const { type, tier, query } = (msg.payload || {}) as {
      type?: "agent" | "group" | "skill";
      tier?: "official" | "certified" | "community" | "local";
      query?: string;
    };

    const catalog = this.marketCatalog;
    const resources = catalog.list();

    // 本地私有资源：现有 Agent（排除 butler/host 系统核心）+ 现有技能
    const localAgents = (this.agentRegistry?.list() || [])
      .filter((a) => a.id !== "butler" && a.id !== "host")
      .map((a) => ({ id: a.id, name: a.name, role: (a as any).config?.role as string | undefined }));
    const localSkills = (this.skillRepo?.list() || []).map((s) => ({ name: s.name, description: s.description }));
    const localResources = buildLocalResources(localAgents, localSkills);

    let all = [...resources, ...localResources];
    if (type) all = all.filter((r) => r.type === type);
    if (tier) all = all.filter((r) => r.tier === tier);
    if (query) {
      const q = query.toLowerCase();
      all = all.filter((r) =>
        r.name.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        r.id.toLowerCase().includes(q) ||
        r.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }

    const views: MarketResourceView[] = all.map((r) => ({
      ...r,
      installed: r.tier === "local" ? true : catalog.isInstalled(r.id),
    }));

    this.sendToClient(ws, {
      type: "market_list",
      payload: { resources: views, installed: catalog.getInstalled() },
    });
  });

  register("market_get", function (ws, msg) {
    const { id } = msg.payload as { id: string };
    if (!id || !this.marketCatalog || !this.marketInstaller) {
      this.sendToClient(ws, { type: "error", payload: { message: "id is required" } });
      return;
    }
    const catalog = this.marketCatalog;
    const resource = catalog.get(id);
    if (!resource) {
      this.sendToClient(ws, { type: "error", payload: { message: `Resource not found: ${id}` } });
      return;
    }
    const tree = this.marketInstaller.buildDependencyTree(id);
    this.sendToClient(ws, {
      type: "market_get",
      payload: {
        resource: { ...resource, installed: catalog.isInstalled(id) },
        dependencyTree: tree,
      },
    });
  });

  register("market_install", function (ws, msg) {
    const { id, confirmed } = (msg.payload || {}) as { id?: string; confirmed?: boolean };
    if (!id || !this.marketInstaller) {
      this.sendToClient(ws, { type: "error", payload: { message: "id is required" } });
      return;
    }
    try {
      const result = this.marketInstaller.install(id, { confirmed: confirmed === true });
      this.sendToClient(ws, { type: "market_install", payload: result });
      // 安装成功/卸载后刷新 Agent/群组列表广播
      if (result.status === "installed" || result.status === "already_installed") {
        this.broadcastState();
      }
    } catch (err: any) {
      this.sendToClient(ws, { type: "error", payload: { message: err.message } });
    }
  });

  register("market_uninstall", function (ws, msg) {
    const { id } = msg.payload as { id: string };
    if (!id || !this.marketInstaller) {
      this.sendToClient(ws, { type: "error", payload: { message: "id is required" } });
      return;
    }
    try {
      const result = this.marketInstaller.uninstall(id);
      this.sendToClient(ws, { type: "market_uninstall", payload: result });
      this.broadcastState();
    } catch (err: any) {
      this.sendToClient(ws, { type: "error", payload: { message: err.message } });
    }
  });

  register("market_installed", function (ws, msg) {
    if (!this.marketCatalog) {
      this.sendToClient(ws, { type: "market_installed", payload: { installed: [] } });
      return;
    }
    this.sendToClient(ws, {
      type: "market_installed",
      payload: { installed: this.marketCatalog.getInstalled() },
    });
  });
}
