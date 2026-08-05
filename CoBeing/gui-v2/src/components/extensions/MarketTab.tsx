import { useEffect, useState, type JSX } from "react";
import type {
  InstalledEntry,
  MarketDepNode,
  MarketResourceType,
  MarketResourceView,
  MarketRiskLevel,
  MarketTier,
} from "@/lib/types";
import { useMarketStore } from "@/stores/market";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

// ── 展示元数据（全部使用主题 token 色，不硬编码） ──

const TYPE_ICON: Record<MarketResourceType, string> = {
  agent: "👤",
  group: "👥",
  skill: "📘",
};

const TIER_META: Record<MarketTier, { label: string; className: string }> = {
  official: { label: "官方内置", className: "bg-success/10 text-success" },
  certified: { label: "官方认证", className: "bg-purple/10 text-purple" },
  community: { label: "社区", className: "bg-accent-warm/10 text-accent-warm" },
  local: { label: "本地", className: "bg-elevated text-txt-muted" },
};

const RISK_META: Record<MarketRiskLevel, { label: string; className: string }> = {
  low: { label: "低风险", className: "bg-success/10 text-success" },
  medium: { label: "中风险", className: "bg-accent-warm/10 text-accent-warm" },
  high: { label: "高风险", className: "bg-danger/10 text-danger" },
};

const TYPE_FILTERS: { value: MarketResourceType | "all"; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "agent", label: "👤 智能体" },
  { value: "group", label: "👥 群组" },
  { value: "skill", label: "📘 技能" },
];

const TIER_FILTERS: { value: MarketTier | "all"; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "official", label: "官方内置" },
  { value: "certified", label: "官方认证" },
  { value: "community", label: "社区" },
  { value: "local", label: "本地" },
];

function TierBadge({ tier }: { tier: MarketTier }) {
  return (
    <span className={cn("shrink-0 text-xs px-2 py-0.5 rounded-full", TIER_META[tier].className)}>
      {TIER_META[tier].label}
    </span>
  );
}

function RiskBadge({ risk }: { risk: MarketRiskLevel }) {
  return (
    <span className={cn("shrink-0 text-xs px-2 py-0.5 rounded-full", RISK_META[risk].className)}>
      {RISK_META[risk].label}
    </span>
  );
}

/** 依赖树节点：递归缩进渲染，子层用 divider 细线连接 */
function DepTreeNode({ node }: { node: MarketDepNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 rounded-lg" style={{ padding: "6px 4px" }}>
        <span className="text-sm leading-none">{TYPE_ICON[node.type]}</span>
        <span className="text-sm text-txt font-medium truncate">{node.name}</span>
        <span className="text-xs text-txt-muted truncate">{node.id}</span>
        <TierBadge tier={node.tier} />
        <RiskBadge risk={node.riskLevel} />
        <span className="shrink-0 text-xs px-2 py-0.5 rounded-lg bg-elevated text-txt-muted">
          {node.required ? "必装" : "可选"}
        </span>
      </div>
      {node.children.length > 0 && (
        <div style={{ marginLeft: 14, paddingLeft: 14, borderLeft: "1px solid var(--color-divider)" }}>
          {node.children.map((child) => (
            <DepTreeNode key={child.id} node={child} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── 资源卡片 ──

interface ResourceCardProps {
  resource: MarketResourceView;
  installed: Record<string, InstalledEntry>;
  onOpen: (id: string) => void;
  onInstall: (id: string) => void;
  onUninstall: (id: string) => void;
}

function ResourceCard({ resource, installed, onOpen, onInstall, onUninstall }: ResourceCardProps) {
  const isLocal = resource.tier === "local";
  const isInstalled = isLocal || !!installed[resource.id] || resource.installed;

  return (
    <div
      onClick={() => onOpen(resource.id)}
      className="flex flex-col rounded-xl bg-surface border border-bdr/40 cursor-pointer transition-colors hover:bg-hover/50"
      style={{ boxShadow: "var(--shadow-surface)", padding: 20, gap: 10 }}
    >
      <div className="flex items-start justify-between gap-2 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-lg leading-none">{TYPE_ICON[resource.type]}</span>
          <h4 className="text-sm font-semibold text-txt truncate">{resource.name}</h4>
        </div>
        <TierBadge tier={resource.tier} />
      </div>

      <p className="text-sm text-txt-sub leading-relaxed line-clamp-2 min-h-0">
        {resource.description || "暂无描述"}
      </p>

      {resource.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {resource.tags.slice(0, 4).map((tag) => (
            <span key={tag} className="text-xs px-2 py-0.5 rounded-full bg-elevated text-txt-muted">
              {tag}
            </span>
          ))}
        </div>
      )}

      <div
        className="flex items-center justify-between pt-2"
        style={{ borderTop: "1px solid var(--color-divider)" }}
      >
        <RiskBadge risk={resource.riskLevel} />
        {isLocal ? (
          <span className="text-xs px-2.5 py-1 rounded-lg bg-elevated text-txt-muted cursor-not-allowed">
            本地资源
          </span>
        ) : isInstalled ? (
          <div className="flex items-center gap-2">
            <span className="text-xs px-2.5 py-1 rounded-lg bg-success/10 text-success">已安装</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onUninstall(resource.id);
              }}
              className="text-xs px-2.5 py-1 rounded-lg text-danger transition-colors hover:bg-danger/10"
            >
              卸载
            </button>
          </div>
        ) : (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onInstall(resource.id);
            }}
            className="rounded-lg px-3 py-1.5 text-sm bg-accent text-white transition-opacity hover:opacity-90"
          >
            安装
          </button>
        )}
      </div>
    </div>
  );
}

// ── 主组件 ──

export function MarketTab(): JSX.Element {
  const resources = useMarketStore((s) => s.resources);
  const installed = useMarketStore((s) => s.installed);
  const filters = useMarketStore((s) => s.filters);
  const detail = useMarketStore((s) => s.detail);
  const installState = useMarketStore((s) => s.installState);
  const pendingInstall = useMarketStore((s) => s.pendingInstall);
  const lastError = useMarketStore((s) => s.lastError);

  const load = useMarketStore((s) => s.load);
  const setTypeFilter = useMarketStore((s) => s.setTypeFilter);
  const setTierFilter = useMarketStore((s) => s.setTierFilter);
  const setQuery = useMarketStore((s) => s.setQuery);
  const openDetail = useMarketStore((s) => s.openDetail);
  const closeDetail = useMarketStore((s) => s.closeDetail);
  const requestInstall = useMarketStore((s) => s.requestInstall);
  const confirmInstall = useMarketStore((s) => s.confirmInstall);
  const uninstall = useMarketStore((s) => s.uninstall);

  // 首次加载标记：market_list 响应到达后置 true（ws-market-list 由 market-handlers 派发）
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const handler = () => setLoaded(true);
    window.addEventListener("ws-market-list", handler);
    return () => window.removeEventListener("ws-market-list", handler);
  }, []);

  // mount 时拉取一次市场列表
  useEffect(() => {
    load();
  }, [load]);

  const showLoading = !loaded && resources.length === 0;
  const isEmpty = loaded && resources.length === 0;

  const detailInstalled =
    detail != null && (installed[detail.resource.id] != null || detail.resource.installed);
  const detailIsLocal = detail?.resource.tier === "local";

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-y-auto" style={{ padding: 2 }}>
      {/* 过滤栏（Layer 3 面板） */}
      <div
        className="shrink-0 rounded-xl bg-surface border border-bdr/40"
        style={{ boxShadow: "var(--shadow-surface)", padding: 20, marginBottom: 16, gap: 12 }}
      >
        <div className="flex items-center gap-3 flex-wrap" style={{ marginBottom: 12 }}>
          <span className="text-sm text-txt-muted shrink-0">类型</span>
          <div className="flex flex-wrap gap-2">
            {TYPE_FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setTypeFilter(f.value)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-sm transition-colors",
                  filters.type === f.value
                    ? "bg-accent/10 text-accent font-medium"
                    : "bg-elevated text-txt-sub hover:bg-hover hover:text-txt",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap" style={{ marginBottom: 12 }}>
          <span className="text-sm text-txt-muted shrink-0">信任</span>
          <div className="flex flex-wrap gap-2">
            {TIER_FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setTierFilter(f.value)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-sm transition-colors",
                  filters.tier === f.value
                    ? "bg-accent/10 text-accent font-medium"
                    : "bg-elevated text-txt-sub hover:bg-hover hover:text-txt",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-sm text-txt-muted shrink-0">搜索</span>
          <input
            type="text"
            value={filters.query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="🔍 搜索名称、描述、标签..."
            className="flex-1 min-w-0 rounded-lg px-3 py-2 text-sm bg-input border border-bdr text-txt
                       focus:outline-none focus:border-accent/50"
          />
        </div>
      </div>

      {/* 错误横幅 */}
      {lastError && (
        <div
          className="shrink-0 rounded-xl bg-danger/10 text-danger text-sm"
          style={{ padding: "12px 16px", marginBottom: 16 }}
        >
          ⚠️ {lastError}
        </div>
      )}

      {/* 资源网格（卡片浮在背景之上） */}
      {showLoading ? (
        <div className="flex-1 flex items-center justify-center" style={{ padding: 60 }}>
          <p className="text-sm text-txt-muted">正在加载市场资源…</p>
        </div>
      ) : isEmpty ? (
        <div className="flex-1 flex items-center justify-center" style={{ padding: 60 }}>
          <p className="text-sm text-txt-muted">没有找到匹配的资源</p>
        </div>
      ) : (
        <div
          className="grid gap-4"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(270px, 1fr))" }}
        >
          {resources.map((r) => (
            <ResourceCard
              key={r.id}
              resource={r}
              installed={installed}
              onOpen={openDetail}
              onInstall={(id) => {
                openDetail(id);
                requestInstall(id);
              }}
              onUninstall={uninstall}
            />
          ))}
        </div>
      )}

      {/* 详情浮层 */}
      <Sheet
        open={detail !== null}
        onOpenChange={(open) => {
          if (!open) closeDetail();
        }}
      >
        <SheetContent side="right">
          {detail && (
            <>
              <SheetHeader>
                <SheetTitle>
                  <div className="flex items-center gap-3">
                    <span className="text-xl leading-none">{TYPE_ICON[detail.resource.type]}</span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-base truncate">{detail.resource.name}</span>
                        <TierBadge tier={detail.resource.tier} />
                      </div>
                      <div className="text-sm text-txt-muted font-normal">
                        {detail.resource.author} · v{detail.resource.version}
                      </div>
                    </div>
                  </div>
                </SheetTitle>
              </SheetHeader>

              <div className="flex-1 overflow-y-auto" style={{ padding: 20 }}>
                {/* 社区安装确认流：警告区 */}
                {installState === "approval_required" && pendingInstall && (
                  <div
                    className="rounded-xl border border-accent-warm/40 bg-accent-warm/10"
                    style={{ padding: 16, marginBottom: 16 }}
                  >
                    <p className="text-sm font-medium text-warning-fg">
                      ⚠️ 该资源来自社区，未经过官方审核。请确认作者、权限与依赖后安装
                    </p>
                    <p className="text-sm text-txt-sub mt-2">
                      安装「{pendingInstall.name}」将同时安装其依赖树中的全部资源，请在下方的依赖中核对风险。
                    </p>
                  </div>
                )}

                {/* 安装成功轻提示 */}
                {installState === "installed" && (
                  <div
                    className="rounded-xl bg-success/10 text-success text-sm"
                    style={{ padding: "12px 16px", marginBottom: 16 }}
                  >
                    ✅ 「{detail.resource.name}」安装成功
                  </div>
                )}

                {/* 安装失败提示 */}
                {installState === "error" && lastError && (
                  <div
                    className="rounded-xl bg-danger/10 text-danger text-sm"
                    style={{ padding: "12px 16px", marginBottom: 16 }}
                  >
                    ⚠️ {lastError}
                  </div>
                )}

                {/* 描述（子层） */}
                <div className="rounded-xl bg-elevated" style={{ padding: 16, marginBottom: 16 }}>
                  <h5 className="text-sm font-medium text-txt mb-2">描述</h5>
                  <p className="text-sm text-txt-sub leading-relaxed">
                    {detail.resource.description || "暂无描述"}
                  </p>
                </div>

                {/* 权限（子层） */}
                <div className="rounded-xl bg-elevated" style={{ padding: 16, marginBottom: 16 }}>
                  <h5 className="text-sm font-medium text-txt mb-2">权限</h5>
                  {detail.resource.permissions.length === 0 ? (
                    <p className="text-sm text-txt-muted">无特殊权限</p>
                  ) : (
                    <ul>
                      {detail.resource.permissions.map((permission) => (
                        <li
                          key={permission}
                          className="flex items-center gap-2 text-sm text-txt-sub"
                          style={{
                            padding: "7px 0",
                            borderBottom: "1px solid var(--color-divider)",
                          }}
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-accent/60 shrink-0" />
                          <span className="font-mono text-xs">{permission}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* 依赖树（子层，递归） */}
                <div className="rounded-xl bg-elevated" style={{ padding: 16 }}>
                  <h5 className="text-sm font-medium text-txt mb-2">依赖</h5>
                  {detail.tree.children.length === 0 ? (
                    <p className="text-sm text-txt-muted">无依赖</p>
                  ) : (
                    <div>
                      <div className="flex items-center gap-2 rounded-lg" style={{ padding: "6px 4px" }}>
                        <span className="text-sm leading-none">{TYPE_ICON[detail.tree.type]}</span>
                        <span className="text-sm text-txt font-medium truncate">{detail.tree.name}</span>
                        <span className="text-xs text-txt-muted">本资源</span>
                        <RiskBadge risk={detail.tree.riskLevel} />
                      </div>
                      <div
                        style={{ marginLeft: 14, paddingLeft: 14, borderLeft: "1px solid var(--color-divider)" }}
                      >
                        {detail.tree.children.map((child) => (
                          <DepTreeNode key={child.id} node={child} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* 底部操作条 */}
              <div
                className="shrink-0 flex items-center gap-2 border-t border-bdr/30"
                style={{ padding: "14px 24px" }}
              >
                {installState === "installing" ? (
                  <button
                    disabled
                    className="rounded-lg px-4 py-2 text-sm bg-accent/50 text-white cursor-not-allowed"
                  >
                    安装中…
                  </button>
                ) : installState === "approval_required" && pendingInstall ? (
                  <button
                    onClick={confirmInstall}
                    className="rounded-lg px-4 py-2 text-sm bg-accent-warm/15 text-warning-fg transition-opacity hover:opacity-90"
                  >
                    确认安装「{pendingInstall.name}」
                  </button>
                ) : detailIsLocal ? (
                  <span className="text-sm px-4 py-2 rounded-lg bg-elevated text-txt-muted cursor-not-allowed">
                    本地资源
                  </span>
                ) : detailInstalled ? (
                  <>
                    <span className="text-sm px-3 py-2 rounded-lg bg-success/10 text-success">已安装</span>
                    <button
                      onClick={() => uninstall(detail.resource.id)}
                      className="rounded-lg px-4 py-2 text-sm text-danger border border-danger/40 transition-colors hover:bg-danger/10"
                    >
                      卸载
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => requestInstall(detail.resource.id)}
                    className="rounded-lg px-4 py-2 text-sm bg-accent text-white transition-opacity hover:opacity-90"
                  >
                    安装
                  </button>
                )}
                <button
                  onClick={closeDetail}
                  className="ml-auto rounded-lg px-4 py-2 text-sm bg-elevated text-txt-sub transition-colors hover:bg-hover hover:text-txt"
                >
                  关闭
                </button>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
